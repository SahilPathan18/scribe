import "dotenv/config";
import crypto from "crypto";
import express from "express";
import multer from "multer";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { db } from "./lib/db.js";
import { authMiddleware, handleRegister, handleLogin, handleGetMe } from "./lib/auth.js";
import { processAndIndexDocument } from "./lib/rag.js";
import { streamChatResponse, MODEL_NAME } from "./lib/gemini.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ──────────────────── Config & Validation ──────────────────── */
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error(
    "\x1b[31m✖ GEMINI_API_KEY is missing.\n  Copy .env.example → .env and paste your key.\x1b[0m"
  );
  process.exit(1);
}

/* ──────────────────── Rate Limiter ──────────────────── */
const ipRequests = new Map();
const MAX_TRACKED_IPS = 5000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60; // 60 requests per minute

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();

  if (ipRequests.size >= MAX_TRACKED_IPS) {
    ipRequests.clear();
  }

  const windowData = ipRequests.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

  if (now > windowData.resetTime) {
    windowData.count = 1;
    windowData.resetTime = now + RATE_LIMIT_WINDOW_MS;
  } else {
    windowData.count++;
  }

  ipRequests.set(ip, windowData);

  if (windowData.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((windowData.resetTime - now) / 1000);
    res.setHeader("Retry-After", retryAfter);
    return res.status(429).json({
      error: `Too many requests. Please wait ${retryAfter}s before sending another inquiry.`,
    });
  }

  next();
}

/* ──────────────────── Express App Setup ──────────────────── */
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB maximum upload
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["application/pdf", "text/plain", "text/markdown"];
    const allowedExts = /\.(pdf|txt|md)$/i;
    const ok = allowedMimes.includes(file.mimetype) || allowedExts.test(file.originalname || "");
    if (ok) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, TXT, and MD files are supported."));
    }
  },
});

const handleUpload = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File exceeds 10MB limit." });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message || "File upload failed." });
    }
    next();
  });
};

app.disable("x-powered-by");
app.set("trust proxy", 1);

// Security Headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://en.wikipedia.org https://api.duckduckgo.com; frame-ancestors 'none';"
  );
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(authMiddleware);

// Serve static assets from public
app.use(express.static(join(__dirname, "public")));

/* ──────────────────── User / Guest Scoping & Ownership ──────────────────── */
function currentUserId(req) {
  if (req.user && req.user.id) {
    return req.user.id;
  }
  const clientGuestId = req.headers["x-guest-id"];
  if (clientGuestId && typeof clientGuestId === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(clientGuestId)) {
    return `guest_${clientGuestId}`;
  }
  return null;
}

async function loadOwnedChat(req, res) {
  const chatId = req.params.chatId || req.body?.chatId;
  if (!chatId || typeof chatId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(chatId)) {
    res.status(400).json({ error: "Invalid chatId format." });
    return null;
  }
  const userId = currentUserId(req);
  if (!userId) {
    res.status(400).json({ error: "Authentication or valid x-guest-id header is required." });
    return null;
  }
  const chat = await db.getChat(chatId);
  if (!chat || chat.userId !== userId) {
    res.status(404).json({ error: "Conversation not found." });
    return null;
  }
  return chat;
}

/* ──────────────────── Auth Routes ──────────────────── */
app.post("/api/auth/register", rateLimitMiddleware, handleRegister);
app.post("/api/auth/login", rateLimitMiddleware, handleLogin);
app.get("/api/auth/me", handleGetMe);

/* ──────────────────── Chat Routes ──────────────────── */

// GET /api/chats — List chats for authenticated user (or guest)
app.get("/api/chats", async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) {
    return res.status(400).json({ error: "Authentication or valid x-guest-id header is required." });
  }
  const chats = await db.getUserChats(userId);
  res.json({ chats });
});

// GET /api/chat/:chatId — Get single chat with messages
app.get("/api/chat/:chatId", async (req, res) => {
  const chat = await loadOwnedChat(req, res);
  if (!chat) return;
  const messages = await db.getMessages(chat.id);
  res.json({ chat, messages });
});

// POST /api/chat — Stream message using Server-Sent Events (SSE)
app.post("/api/chat", rateLimitMiddleware, async (req, res) => {
  const { message, chatId, title, enableRag = true } = req.body || {};

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }

  const cleanMessage = message.trim();
  if (cleanMessage.length > 8000) {
    return res.status(400).json({ error: "Message exceeds maximum allowed length of 8000 characters." });
  }

  if (!chatId || typeof chatId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(chatId)) {
    return res.status(400).json({ error: "Invalid chatId format." });
  }

  const userId = currentUserId(req);
  if (!userId) {
    return res.status(400).json({ error: "Authentication or valid x-guest-id header is required." });
  }

  // Ensure chat belongs to user or create new
  let chat = await db.getChat(chatId);
  if (chat && chat.userId !== userId) {
    return res.status(403).json({ error: "Access denied to this conversation." });
  }

  if (!chat) {
    const chatTitle =
      typeof title === "string" && title.trim()
        ? title.trim().slice(0, 120)
        : cleanMessage.slice(0, 36) + (cleanMessage.length > 36 ? "…" : "");

    chat = await db.saveChat({
      id: chatId,
      userId,
      title: chatTitle,
      summary: null,
      createdAt: Date.now(),
    });
  }

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Send initial keepalive immediately so reverse proxies (Render, Cloudflare) don't drop the connection
  res.write(": keepalive\n\n");

  // Keep connection alive with periodic heartbeat comments while Gemini processes multi-turn tools
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      try {
        res.write(": heartbeat\n\n");
      } catch {}
    }
  }, 5000);

  try {
    await streamChatResponse({
      chatId,
      message: cleanMessage,
      userId,
      res,
      enableRag,
    });
  } finally {
    clearInterval(keepAlive);
  }
});

// POST /api/chat/rename — Rename chat title
app.post("/api/chat/rename", async (req, res) => {
  const chat = await loadOwnedChat(req, res);
  if (!chat) return;
  const { title } = req.body || {};
  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "Valid title is required." });
  }
  chat.title = title.trim().slice(0, 120);
  await db.saveChat(chat);
  res.json({ ok: true });
});

// DELETE /api/chat/:chatId — Delete specific chat session
app.delete("/api/chat/:chatId", rateLimitMiddleware, async (req, res) => {
  const chat = await loadOwnedChat(req, res);
  if (!chat) return;
  await db.deleteChat(chat.id);
  res.json({ ok: true });
});

/* ──────────────────── Document / RAG Routes ──────────────────── */

// POST /api/documents/upload — Upload and embed document (PDF or text)
app.post("/api/documents/upload", rateLimitMiddleware, handleUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file was uploaded." });
    }

    const userId = currentUserId(req);
    if (!userId) {
      return res.status(400).json({ error: "Authentication or valid x-guest-id header is required." });
    }

    const docRecord = await processAndIndexDocument({
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      userId,
    });

    res.status(201).json({
      ok: true,
      document: docRecord,
      message: `Document '${docRecord.name}' processed and indexed into ${docRecord.chunkCount} vector chunks.`,
    });
  } catch (err) {
    console.error("[Document Upload Error]:", err.message);
    res.status(400).json({ error: err.message || "Failed to process document." });
  }
});

// GET /api/documents — List documents
app.get("/api/documents", async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) {
    return res.status(400).json({ error: "Authentication or valid x-guest-id header is required." });
  }
  const documents = await db.getUserDocuments(userId);
  res.json({ documents });
});

// DELETE /api/documents/:docId — Delete document & vector embeddings
app.delete("/api/documents/:docId", async (req, res) => {
  const userId = currentUserId(req);
  if (!userId) {
    return res.status(400).json({ error: "Authentication or valid x-guest-id header is required." });
  }
  const { docId } = req.params;
  const doc = await db.getDocument(docId);
  if (!doc || doc.userId !== userId) {
    return res.status(404).json({ error: "Document not found." });
  }
  await db.deleteDocument(docId);
  res.json({ ok: true });
});

/* ──────────────────── Sharing Routes ──────────────────── */

// POST /api/chat/:chatId/share — Create shareable snapshot link
app.post("/api/chat/:chatId/share", rateLimitMiddleware, async (req, res) => {
  const chat = await loadOwnedChat(req, res);
  if (!chat) return;

  const messages = await db.getMessages(chat.id);
  if (!messages.length) {
    return res.status(400).json({ error: "Cannot share an empty chat." });
  }

  const shareId = "sh_" + crypto.randomBytes(16).toString("base64url");
  const sanitizedMessages = messages.map((m) => ({
    role: m.role,
    text: m.text,
    createdAt: m.createdAt,
  }));

  const shared = await db.createSharedChat({
    shareId,
    chatId: chat.id,
    title: chat.title,
    messages: sanitizedMessages,
  });

  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.get("host");
  const shareUrl = `${protocol}://${host}/share.html?id=${shareId}`;

  res.json({
    ok: true,
    shareId,
    shareUrl,
    title: shared.title,
  });
});

// GET /api/share/:shareId — Fetch shared conversation data
app.get("/api/share/:shareId", async (req, res) => {
  const { shareId } = req.params;
  const shared = await db.getSharedChat(shareId);
  if (!shared) {
    return res.status(404).json({ error: "Shared conversation not found or expired." });
  }
  res.json({ shared });
});

/* ──────────────────── Error Handling Middleware ──────────────────── */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File exceeds 10MB limit." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message || "Request failed." });
  }
  next();
});

/* ──────────────────── Health Check ──────────────────── */
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
  });
});

/* ──────────────────── Start Server ──────────────────── */
app.listen(PORT, () => {
  console.log(`\n  ✒️   Scribe is running → http://localhost:${PORT}`);
  console.log(`  🧠  Model: ${MODEL_NAME}`);
  console.log(`  📚  RAG Vector Store & Tools active\n`);

  const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  if (keepAliveUrl) {
    const PING_INTERVAL_MS = 13 * 60 * 1000;
    console.log(`  💓  Auto keep-alive active: pinging ${keepAliveUrl}/api/health every 13m\n`);
    setInterval(async () => {
      try {
        await fetch(`${keepAliveUrl}/api/health`);
      } catch (err) {
        console.warn("[Heartbeat] Keep-alive ping error:", err.message);
      }
    }, PING_INTERVAL_MS);
  }
});
