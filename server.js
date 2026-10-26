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

/* POST /api/chat — send message with rate limiting and safety handling */
app.post("/api/chat", rateLimitMiddleware, async (req, res) => {
  const { message, chatId } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }
  if (!chatId) {
    return res.status(400).json({ error: "chatId is required." });
  }

  try {
    const chat = getOrCreateChat(chatId);
    const result = await chat.sendMessage(message.trim());

    // Inspect candidates for safety blocks
    const candidate = result.response.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      if (candidate.finishReason === "SAFETY") {
        return res.json({
          reply:
            "This inquiry could not be fulfilled due to safety guardrails. Please consider rephrasing your question.",
        });
      }
      if (candidate.finishReason === "RECITATION") {
        return res.json({
          reply:
            "The response was halted due to copyrighted recitation policy. Please ask for an original summary instead.",
        });
      }
    }

    const reply = result.response.text();
    res.json({ reply });
  } catch (err) {
    console.error("Gemini API error:", err.message);

    const isAuthError =
      err.message?.includes("API key") ||
      err.message?.includes("PERMISSION_DENIED");

    const status = isAuthError ? 401 : 502;

    res.status(status).json({
      error: isAuthError
        ? "Invalid API key. Check your .env file."
        : "Something went wrong while communicating with Gemini. Please try again.",
    });
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
