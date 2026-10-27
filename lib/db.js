import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, "..", "data");
const DB_FILE = join(DATA_DIR, "db.json");
const EMBEDDINGS_FILE = join(DATA_DIR, "embeddings.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultSchema = {
  users: [],
  chats: [],
  messages: [],
  documents: [],
  sharedChats: [],
};

class PersistentDB {
  constructor() {
    this.data = defaultSchema;
    this.embeddings = [];
    this.saveTimeout = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        // Migrate legacy embeddings from db.json if present
        if (Array.isArray(parsed.embeddings) && parsed.embeddings.length) {
          this.embeddings = parsed.embeddings;
          delete parsed.embeddings;
          this.saveEmbeddingsFile();
        }
        this.data = { ...defaultSchema, ...parsed };
      } else {
        this.saveSync();
      }
    } catch (err) {
      console.error("[DB] Failed to load db.json; creating backup and reinitializing:", err.message);
      try {
        fs.renameSync(DB_FILE, `${DB_FILE}.corrupt-${Date.now()}`);
      } catch {}
      this.data = structuredClone(defaultSchema);
      this.saveSync();
    }

    try {
      if (fs.existsSync(EMBEDDINGS_FILE)) {
        const rawEmb = fs.readFileSync(EMBEDDINGS_FILE, "utf-8");
        this.embeddings = JSON.parse(rawEmb);
      }
    } catch (err) {
      console.error("[DB] Failed to load embeddings.json; creating backup and resetting embeddings:", err.message);
      try {
        fs.renameSync(EMBEDDINGS_FILE, `${EMBEDDINGS_FILE}.corrupt-${Date.now()}`);
      } catch {}
      this.embeddings = [];
    }
  }

  saveSync() {
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(this.data), "utf-8");
    fs.renameSync(tmpFile, DB_FILE);
  }

  save() {
    try {
      this.saveSync();
    } catch (err) {
      console.error("[DB] Failed to persist data:", err.message);
      throw new Error(`Database persistence failure: ${err.message}`);
    }
  }

  saveEmbeddingsFile() {
    try {
      const tmpFile = `${EMBEDDINGS_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.embeddings), "utf-8");
      fs.renameSync(tmpFile, EMBEDDINGS_FILE);
    } catch (err) {
      console.error("[DB] Failed to persist embeddings:", err.message);
      throw new Error(`Embeddings persistence failure: ${err.message}`);
    }
  }

  /* ──────────────── User Operations ──────────────── */
  findUserByEmail(email) {
    if (!email) return null;
    return this.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
  }

  findUserByUsername(username) {
    if (!username) return null;
    return this.data.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
  }

  findUserById(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  createUser({ id, username, email, passwordHash }) {
    const user = {
      id,
      username,
      email,
      passwordHash,
      createdAt: Date.now(),
    };
    this.data.users.push(user);
    this.save();
    return user;
  }

  /* ──────────────── Chat Operations ──────────────── */
  getUserChats(userId) {
    return this.data.chats
      .filter((c) => c.userId === userId)
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  }

  getChat(chatId) {
    return this.data.chats.find((c) => c.id === chatId) || null;
  }

  saveChat(chat) {
    const idx = this.data.chats.findIndex((c) => c.id === chat.id);
    const updated = { ...chat, updatedAt: Date.now() };
    if (idx >= 0) {
      this.data.chats[idx] = updated;
    } else {
      this.data.chats.push(updated);
    }
    this.save();
    return updated;
  }

  deleteChat(chatId) {
    this.data.chats = this.data.chats.filter((c) => c.id !== chatId);
    this.data.messages = this.data.messages.filter((m) => m.chatId !== chatId);
    this.save();
  }

  updateChatSummary(chatId, summary) {
    const chat = this.getChat(chatId);
    if (chat) {
      chat.summary = summary;
      chat.updatedAt = Date.now();
      this.save();
    }
  }

  /* ──────────────── Message Operations ──────────────── */
  getMessages(chatId) {
    return this.data.messages
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  addMessage(chatId, { role, text, toolCalls, citations }) {
    const msg = {
      id: "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      chatId,
      role,
      text,
      toolCalls: toolCalls || null,
      citations: citations || null,
      createdAt: Date.now(),
    };
    this.data.messages.push(msg);

    const chat = this.getChat(chatId);
    if (chat) {
      chat.updatedAt = Date.now();
    }

    this.save();
    return msg;
  }

  /* ──────────────── Document Operations (RAG) ──────────────── */
  getUserDocuments(userId) {
    if (!userId) return [];
    return this.data.documents.filter((d) => d.userId === userId || d.userId === "public");
  }

  getDocument(docId) {
    return this.data.documents.find((d) => d.id === docId) || null;
  }

  saveDocument(doc) {
    const idx = this.data.documents.findIndex((d) => d.id === doc.id);
    if (idx >= 0) {
      this.data.documents[idx] = doc;
    } else {
      this.data.documents.push(doc);
    }
    this.save();
    return doc;
  }

  deleteDocument(docId) {
    this.data.documents = this.data.documents.filter((d) => d.id !== docId);
    this.embeddings = this.embeddings.filter((e) => e.docId !== docId);
    this.save();
    this.saveEmbeddingsFile();
  }

  /* ──────────────── Embeddings / Vector Store Operations ──────────────── */
  saveEmbeddings(items) {
    if (!Array.isArray(items) || !items.length) return;
    this.embeddings.push(...items);
    this.saveEmbeddingsFile();
  }

  getEmbeddings(userId = null) {
    if (!userId) return this.embeddings;
    return this.embeddings.filter((e) => !e.userId || e.userId === userId || e.userId === "public");
  }

  /* ──────────────── Shared Chats ──────────────── */
  createSharedChat({ shareId, chatId, title, messages }) {
    const shared = {
      shareId,
      chatId,
      title: title || "Shared Conversation",
      messages,
      createdAt: Date.now(),
    };
    this.data.sharedChats.push(shared);
    this.save();
    return shared;
  }

  getSharedChat(shareId) {
    return this.data.sharedChats.find((s) => s.shareId === shareId) || null;
  }
}

export const db = new PersistentDB();
