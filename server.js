import "dotenv/config";
import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ──────────────────── Config ──────────────────── */
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error(
    "\x1b[31m✖ GEMINI_API_KEY is missing.\n  Copy .env.example → .env and paste your key.\x1b[0m"
  );
  process.exit(1);
}

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
  model: MODEL_NAME,
  systemInstruction:
    "You are Lumen, an articulate and thoughtful intellectual companion. Your responses are clear, well-structured, insightful, and concise. Avoid patronizing filler, artificial enthusiasm, and repetitive pleasantries. Prefer elegant formatting and precise explanations.",
});

/*
 * In-memory store: chatId → { session, lastActive }
 * Includes automatic expiration after 3 hours of inactivity.
 */
const chatSessions = new Map();
const SESSION_TTL_MS = 3 * 60 * 60 * 1000;

function getOrCreateChat(chatId) {
  const existing = chatSessions.get(chatId);
  if (existing) {
    existing.lastActive = Date.now();
    return existing.session;
  }

  const session = model.startChat({
    history: [],
    generationConfig: { maxOutputTokens: 2048 },
  });

  chatSessions.set(chatId, { session, lastActive: Date.now() });
  return session;
}

/* Clean up stale sessions every 30 minutes */
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of chatSessions.entries()) {
    if (now - entry.lastActive > SESSION_TTL_MS) {
      chatSessions.delete(id);
    }
  }
}, 30 * 60 * 1000);

/* ──────────────────── Simple IP Rate Limiter ──────────────────── */
const ipRequests = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30;

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
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
      error: `Too many requests. Please wait ${retryAfter}s before sending another message.`,
    });
  }

  next();
}

/* ──────────────────── Express App ──────────────────── */
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

/* POST /api/chat — stream message using SSE (Server-Sent Events) */
app.post("/api/chat", rateLimitMiddleware, async (req, res) => {
  const { message, chatId } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }
  if (!chatId) {
    return res.status(400).json({ error: "chatId is required." });
  }

  // Set SSE headers for real-time token streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  try {
    const chat = getOrCreateChat(chatId);
    const result = await chat.sendMessageStream(message.trim());

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Gemini stream error:", err.message);

    const isAuthError =
      err.message?.includes("API key") ||
      err.message?.includes("PERMISSION_DENIED");

    const errorMsg = isAuthError
      ? "Invalid API key. Check your .env file."
      : "Something went wrong while communicating with Gemini. Please try again.";

    res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
    res.end();
  }
});

/* DELETE /api/chat/:chatId — clear a specific chat session */
app.delete("/api/chat/:chatId", (req, res) => {
  chatSessions.delete(req.params.chatId);
  res.json({ ok: true });
});

/* ──────────────────── Start ──────────────────── */
app.listen(PORT, () => {
  console.log(`\n  🕯️  Lumen is running → http://localhost:${PORT}\n`);
});
