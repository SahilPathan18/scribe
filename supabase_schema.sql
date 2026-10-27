-- ==============================================================================
-- Scribe Chatbot Database Schema for Supabase
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run
-- ==============================================================================

-- 1. Users Table (Multi-User Authentication)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users (LOWER(username));

-- 2. Chats Table (Conversation Threads)
CREATE TABLE IF NOT EXISTS public.chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Chat',
  summary TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_user_id ON public.chats (user_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON public.chats (updated_at DESC);

-- 3. Messages Table (Conversation History)
CREATE TABLE IF NOT EXISTS public.messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'bot', 'system')),
  text TEXT NOT NULL,
  tool_calls JSONB,
  citations JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON public.messages (chat_id, created_at ASC);

-- 4. Documents Table (RAG Uploads)
CREATE TABLE IF NOT EXISTS public.documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size BIGINT NOT NULL,
  chunk_count INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents (user_id);

-- 5. Embeddings Table (Vector Chunks for Semantic Search)
CREATE TABLE IF NOT EXISTS public.embeddings (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  text TEXT NOT NULL,
  vector JSONB NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_user_id ON public.embeddings (user_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_doc_id ON public.embeddings (doc_id);

-- 6. Shared Chats Table (Public Share Links)
CREATE TABLE IF NOT EXISTS public.shared_chats (
  share_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Shared Conversation',
  messages JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_chats_share_id ON public.shared_chats (share_id);

-- 7. Row Level Security (RLS) Configuration
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_chats ENABLE ROW LEVEL SECURITY;

-- Allow backend service role & API key access
DROP POLICY IF EXISTS "Allow server access to users" ON public.users;
CREATE POLICY "Allow server access to users" ON public.users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow server access to chats" ON public.chats;
CREATE POLICY "Allow server access to chats" ON public.chats FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow server access to messages" ON public.messages;
CREATE POLICY "Allow server access to messages" ON public.messages FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow server access to documents" ON public.documents;
CREATE POLICY "Allow server access to documents" ON public.documents FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow server access to embeddings" ON public.embeddings;
CREATE POLICY "Allow server access to embeddings" ON public.embeddings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow server access to shared_chats" ON public.shared_chats;
CREATE POLICY "Allow server access to shared_chats" ON public.shared_chats FOR ALL USING (true) WITH CHECK (true);
