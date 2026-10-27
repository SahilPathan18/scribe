import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, "..", "data");
const DB_FILE = join(DATA_DIR, "db.json");
const EMBEDDINGS_FILE = join(DATA_DIR, "embeddings.json");

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

/* ──────────────────────────────────────────────────────────────────────────
   Local JSON-file Persistent Storage (Default & Offline Fallback)
────────────────────────────────────────────────────────────────────────── */
class LocalDB {
  constructor() {
    this.data = structuredClone(defaultSchema);
    this.embeddings = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        const parsed = JSON.parse(raw);
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
      console.error("[LocalDB] Error reading db.json:", err.message);
      this.data = structuredClone(defaultSchema);
      this.saveSync();
    }

    try {
      if (fs.existsSync(EMBEDDINGS_FILE)) {
        const rawEmb = fs.readFileSync(EMBEDDINGS_FILE, "utf-8");
        this.embeddings = JSON.parse(rawEmb);
      }
    } catch (err) {
      console.error("[LocalDB] Error reading embeddings.json:", err.message);
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
      console.error("[LocalDB] Persistence failure:", err.message);
    }
  }

  saveEmbeddingsFile() {
    try {
      const tmpFile = `${EMBEDDINGS_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.embeddings), "utf-8");
      fs.renameSync(tmpFile, EMBEDDINGS_FILE);
    } catch (err) {
      console.error("[LocalDB] Embeddings persistence failure:", err.message);
    }
  }

  async findUserByEmail(email) {
    if (!email) return null;
    return this.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
  }

  async findUserByUsername(username) {
    if (!username) return null;
    return this.data.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
  }

  async findUserById(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  async createUser({ id, username, email, passwordHash }) {
    const user = { id, username, email, passwordHash, createdAt: Date.now() };
    this.data.users.push(user);
    this.save();
    return user;
  }

  async getUserChats(userId) {
    return this.data.chats
      .filter((c) => c.userId === userId)
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  }

  async getChat(chatId) {
    return this.data.chats.find((c) => c.id === chatId) || null;
  }

  async saveChat(chat) {
    const idx = this.data.chats.findIndex((c) => c.id === chat.id);
    const updated = { ...chat, updatedAt: Date.now(), createdAt: chat.createdAt || Date.now() };
    if (idx >= 0) {
      this.data.chats[idx] = updated;
    } else {
      this.data.chats.push(updated);
    }
    this.save();
    return updated;
  }

  async deleteChat(chatId) {
    this.data.chats = this.data.chats.filter((c) => c.id !== chatId);
    this.data.messages = this.data.messages.filter((m) => m.chatId !== chatId);
    this.save();
  }

  async updateChatSummary(chatId, summary) {
    const chat = this.data.chats.find((c) => c.id === chatId);
    if (chat) {
      chat.summary = summary;
      chat.updatedAt = Date.now();
      this.save();
    }
  }

  async getMessages(chatId) {
    return this.data.messages
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async addMessage(chatId, { role, text, toolCalls, citations }) {
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

    const chat = this.data.chats.find((c) => c.id === chatId);
    if (chat) chat.updatedAt = Date.now();

    this.save();
    return msg;
  }

  async getUserDocuments(userId) {
    if (!userId) return [];
    return this.data.documents.filter((d) => d.userId === userId || d.userId === "public");
  }

  async getDocument(docId) {
    return this.data.documents.find((d) => d.id === docId) || null;
  }

  async saveDocument(doc) {
    const idx = this.data.documents.findIndex((d) => d.id === doc.id);
    if (idx >= 0) {
      this.data.documents[idx] = doc;
    } else {
      this.data.documents.push(doc);
    }
    this.save();
    return doc;
  }

  async deleteDocument(docId) {
    this.data.documents = this.data.documents.filter((d) => d.id !== docId);
    this.embeddings = this.embeddings.filter((e) => e.docId !== docId);
    this.save();
    this.saveEmbeddingsFile();
  }

  async saveEmbeddings(items) {
    if (!Array.isArray(items) || !items.length) return;
    this.embeddings.push(...items);
    this.saveEmbeddingsFile();
  }

  async getEmbeddings(userId = null) {
    if (!userId) return this.embeddings;
    return this.embeddings.filter((e) => !e.userId || e.userId === userId || e.userId === "public");
  }

  async createSharedChat({ shareId, chatId, title, messages }) {
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

  async getSharedChat(shareId) {
    return this.data.sharedChats.find((s) => s.shareId === shareId) || null;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   Supabase PostgreSQL Storage Adapter
────────────────────────────────────────────────────────────────────────── */
function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: Number(row.created_at),
  };
}

function toChat(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    summary: row.summary,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at || row.created_at),
  };
}

function toMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    text: row.text,
    toolCalls: row.tool_calls || null,
    citations: row.citations || null,
    createdAt: Number(row.created_at),
  };
}

function toDoc(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    size: Number(row.size),
    chunkCount: Number(row.chunk_count || 0),
    createdAt: Number(row.created_at),
  };
}

function toEmbedding(row) {
  if (!row) return null;
  return {
    id: row.id,
    docId: row.doc_id,
    userId: row.user_id,
    docName: row.doc_name,
    text: row.text,
    vector: typeof row.vector === "string" ? JSON.parse(row.vector) : row.vector,
    chunkIndex: Number(row.chunk_index || 0),
    createdAt: Number(row.created_at),
  };
}

function toShared(row) {
  if (!row) return null;
  return {
    shareId: row.share_id,
    chatId: row.chat_id,
    title: row.title,
    messages: typeof row.messages === "string" ? JSON.parse(row.messages) : row.messages,
    createdAt: Number(row.created_at),
  };
}

class SupabaseDB {
  constructor(client, localFallback) {
    this.client = client;
    this.local = localFallback;
  }

  async findUserByEmail(email) {
    try {
      const { data, error } = await this.client
        .from("users")
        .select("*")
        .ilike("email", email.trim())
        .maybeSingle();
      if (error) throw error;
      return toUser(data);
    } catch (err) {
      console.warn("[Supabase] findUserByEmail fallback:", err.message);
      return this.local.findUserByEmail(email);
    }
  }

  async findUserByUsername(username) {
    try {
      const { data, error } = await this.client
        .from("users")
        .select("*")
        .ilike("username", username.trim())
        .maybeSingle();
      if (error) throw error;
      return toUser(data);
    } catch (err) {
      console.warn("[Supabase] findUserByUsername fallback:", err.message);
      return this.local.findUserByUsername(username);
    }
  }

  async findUserById(id) {
    try {
      const { data, error } = await this.client
        .from("users")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return toUser(data);
    } catch (err) {
      console.warn("[Supabase] findUserById fallback:", err.message);
      return this.local.findUserById(id);
    }
  }

  async createUser({ id, username, email, passwordHash }) {
    const user = { id, username, email, passwordHash, createdAt: Date.now() };
    try {
      const { error } = await this.client.from("users").insert({
        id: user.id,
        username: user.username,
        email: user.email,
        password_hash: user.passwordHash,
        created_at: user.createdAt,
      });
      if (error) throw error;
      // Also mirror to local fallback
      this.local.createUser(user).catch(() => {});
      return user;
    } catch (err) {
      console.warn("[Supabase] createUser fallback:", err.message);
      return this.local.createUser(user);
    }
  }

  async getUserChats(userId) {
    try {
      const { data, error } = await this.client
        .from("chats")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(toChat);
    } catch (err) {
      console.warn("[Supabase] getUserChats fallback:", err.message);
      return this.local.getUserChats(userId);
    }
  }

  async getChat(chatId) {
    try {
      const { data, error } = await this.client
        .from("chats")
        .select("*")
        .eq("id", chatId)
        .maybeSingle();
      if (error) throw error;
      return toChat(data);
    } catch (err) {
      console.warn("[Supabase] getChat fallback:", err.message);
      return this.local.getChat(chatId);
    }
  }

  async saveChat(chat) {
    const updated = {
      ...chat,
      updatedAt: Date.now(),
      createdAt: chat.createdAt || Date.now(),
    };
    try {
      const { error } = await this.client.from("chats").upsert({
        id: updated.id,
        user_id: updated.userId,
        title: updated.title,
        summary: updated.summary || null,
        created_at: updated.createdAt,
        updated_at: updated.updatedAt,
      });
      if (error) throw error;
      this.local.saveChat(updated).catch(() => {});
      return updated;
    } catch (err) {
      console.warn("[Supabase] saveChat fallback:", err.message);
      return this.local.saveChat(updated);
    }
  }

  async deleteChat(chatId) {
    try {
      await this.client.from("messages").delete().eq("chat_id", chatId);
      const { error } = await this.client.from("chats").delete().eq("id", chatId);
      if (error) throw error;
      this.local.deleteChat(chatId).catch(() => {});
    } catch (err) {
      console.warn("[Supabase] deleteChat fallback:", err.message);
      return this.local.deleteChat(chatId);
    }
  }

  async updateChatSummary(chatId, summary) {
    try {
      const { error } = await this.client
        .from("chats")
        .update({ summary, updated_at: Date.now() })
        .eq("id", chatId);
      if (error) throw error;
      this.local.updateChatSummary(chatId, summary).catch(() => {});
    } catch (err) {
      console.warn("[Supabase] updateChatSummary fallback:", err.message);
      return this.local.updateChatSummary(chatId, summary);
    }
  }

  async getMessages(chatId) {
    try {
      const { data, error } = await this.client
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map(toMessage);
    } catch (err) {
      console.warn("[Supabase] getMessages fallback:", err.message);
      return this.local.getMessages(chatId);
    }
  }

  async addMessage(chatId, { role, text, toolCalls, citations }) {
    const msg = {
      id: "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      chatId,
      role,
      text,
      toolCalls: toolCalls || null,
      citations: citations || null,
      createdAt: Date.now(),
    };
    try {
      const { error } = await this.client.from("messages").insert({
        id: msg.id,
        chat_id: msg.chatId,
        role: msg.role,
        text: msg.text,
        tool_calls: msg.toolCalls,
        citations: msg.citations,
        created_at: msg.createdAt,
      });
      if (error) throw error;
      await this.client
        .from("chats")
        .update({ updated_at: Date.now() })
        .eq("id", chatId);
      this.local.addMessage(chatId, msg).catch(() => {});
      return msg;
    } catch (err) {
      console.warn("[Supabase] addMessage fallback:", err.message);
      return this.local.addMessage(chatId, msg);
    }
  }

  async getUserDocuments(userId) {
    try {
      const { data, error } = await this.client
        .from("documents")
        .select("*")
        .or(`user_id.eq.${userId},user_id.eq.public`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(toDoc);
    } catch (err) {
      console.warn("[Supabase] getUserDocuments fallback:", err.message);
      return this.local.getUserDocuments(userId);
    }
  }

  async getDocument(docId) {
    try {
      const { data, error } = await this.client
        .from("documents")
        .select("*")
        .eq("id", docId)
        .maybeSingle();
      if (error) throw error;
      return toDoc(data);
    } catch (err) {
      console.warn("[Supabase] getDocument fallback:", err.message);
      return this.local.getDocument(docId);
    }
  }

  async saveDocument(doc) {
    try {
      const { error } = await this.client.from("documents").upsert({
        id: doc.id,
        user_id: doc.userId,
        name: doc.name,
        type: doc.type,
        size: doc.size,
        chunk_count: doc.chunkCount || 0,
        created_at: doc.createdAt || Date.now(),
      });
      if (error) throw error;
      this.local.saveDocument(doc).catch(() => {});
      return doc;
    } catch (err) {
      console.warn("[Supabase] saveDocument fallback:", err.message);
      return this.local.saveDocument(doc);
    }
  }

  async deleteDocument(docId) {
    try {
      await this.client.from("embeddings").delete().eq("doc_id", docId);
      const { error } = await this.client.from("documents").delete().eq("id", docId);
      if (error) throw error;
      this.local.deleteDocument(docId).catch(() => {});
    } catch (err) {
      console.warn("[Supabase] deleteDocument fallback:", err.message);
      return this.local.deleteDocument(docId);
    }
  }

  async saveEmbeddings(items) {
    if (!Array.isArray(items) || !items.length) return;
    try {
      const rows = items.map((e) => ({
        id: e.id,
        doc_id: e.docId,
        user_id: e.userId,
        doc_name: e.docName,
        text: e.text,
        vector: e.vector,
        chunk_index: e.chunkIndex || 0,
        created_at: e.createdAt || Date.now(),
      }));
      const { error } = await this.client.from("embeddings").insert(rows);
      if (error) throw error;
      this.local.saveEmbeddings(items).catch(() => {});
    } catch (err) {
      console.warn("[Supabase] saveEmbeddings fallback:", err.message);
      return this.local.saveEmbeddings(items);
    }
  }

  async getEmbeddings(userId = null) {
    try {
      let query = this.client.from("embeddings").select("*");
      if (userId) {
        query = query.or(`user_id.eq.${userId},user_id.eq.public`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(toEmbedding);
    } catch (err) {
      console.warn("[Supabase] getEmbeddings fallback:", err.message);
      return this.local.getEmbeddings(userId);
    }
  }

  async createSharedChat({ shareId, chatId, title, messages }) {
    const shared = {
      shareId,
      chatId,
      title: title || "Shared Conversation",
      messages,
      createdAt: Date.now(),
    };
    try {
      const { error } = await this.client.from("shared_chats").insert({
        share_id: shared.shareId,
        chat_id: shared.chatId,
        title: shared.title,
        messages: shared.messages,
        created_at: shared.createdAt,
      });
      if (error) throw error;
      this.local.createSharedChat(shared).catch(() => {});
      return shared;
    } catch (err) {
      console.warn("[Supabase] createSharedChat fallback:", err.message);
      return this.local.createSharedChat(shared);
    }
  }

  async getSharedChat(shareId) {
    try {
      const { data, error } = await this.client
        .from("shared_chats")
        .select("*")
        .eq("share_id", shareId)
        .maybeSingle();
      if (error) throw error;
      return toShared(data);
    } catch (err) {
      console.warn("[Supabase] getSharedChat fallback:", err.message);
      return this.local.getSharedChat(shareId);
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   Database Instance Factory
────────────────────────────────────────────────────────────────────────── */
const localInstance = new LocalDB();

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)?.trim();

let activeDb = localInstance;

if (supabaseUrl && supabaseKey) {
  try {
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    activeDb = new SupabaseDB(supabaseClient, localInstance);
    console.log(`  🗄️   Database: Connected to Supabase (${supabaseUrl})`);
  } catch (err) {
    console.error("[Database] Failed to initialize Supabase client; using local fallback:", err.message);
    activeDb = localInstance;
  }
} else {
  console.log("  🗄️   Database: Local file store (data/db.json) — add SUPABASE_URL to .env to connect Supabase");
}

export const db = activeDb;
