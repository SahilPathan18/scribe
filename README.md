# Scribe — Thoughtful Intelligence Suite ✒️

A high-performance, editorial conversational AI workspace powered by **Google Gemini** (`gemini-3.5-flash-lite`), engineered with production-ready **RAG (Chat with Documents)**, **Persistent Long-Term Memory**, **Real-Time Streaming**, **Voice In/Out**, **Function Calling & Live Tools**, **Multi-User Auth**, **Export/Share**, and **DevOps Docker CI/CD**.

Styled with an editorial warm paper & stone aesthetic inspired by Claude, bespoke journals, and typography-first reading tools.

---

## 🌟 Capabilities & Architecture Overview

| Feature | Implementation Highlights |
| :--- | :--- |
| **📚 RAG (Chat with Documents)** | PDF, TXT, and Markdown upload, text chunking with semantic boundaries, 3072-dim embeddings via `gemini-embedding-001`/`2`, embedded persistent vector store with cosine similarity, and clickable citations with excerpt inspection. |
| **🧠 Persistent Memory** | User-scoped conversation histories saved in a persistent database store. Auto-summarizes dialogue across sessions to retain long-term memory without context bloat. |
| **⚡ Real-Time Streaming** | Server-Sent Events (SSE) token streaming, real-time typing indicators, and instant token rendering. |
| **🎙️ Voice In/Out** | Speech-to-text dictation via Web Speech API with audio visualizer + Text-to-speech voice playback for any response, with auto-speak toggle. |
| **🛠️ Function Calling & Live Tools** | Gemini function declarations for **Live Weather** (Open-Meteo), **Web Search** (DuckDuckGo & Wikipedia), **Email Dispatch Simulator**, **Database Queries**, and **Safe Calculator**. Tool invocation states stream live to the client. |
| **🔐 Auth & Multi-User Accounts** | JWT-authenticated accounts, password hashing with bcrypt, guest mode fallback, and user-scoped conversation archiving. |
| **📤 Export & Sharing** | Instant PDF export via tailored `@media print` layout (`window.print()`), Markdown export, JSON export, and shareable snapshot links (`/share.html?id=...`). |
| **🛡️ Safety & Rate Limiting** | API key kept strictly server-side, token-bucket sliding-window IP rate limiter (60 req/min), input sanitization, and Gemini safety filters. |
| **🐳 DevOps Docker & CI/CD** | Multi-stage production `Dockerfile` with non-root user, `docker-compose.yml` with persistent volume mount, and `.github/workflows/ci-cd.yml` pipeline. |

---

## 📁 Project Structure

```text
gemini-chatbot/
├── .github/workflows/
│   └── ci-cd.yml        # Automated testing, linting, Docker build & deployment
├── data/
│   └── db.json          # Persistent file-backed database (users, chats, docs, embeddings)
├── lib/
│   ├── auth.js          # Authentication, password hashing (bcrypt), JWT middleware
│   ├── db.js            # Atomic persistent data layer
│   ├── gemini.js        # Gemini client, tool calling loops, memory summarization, SSE
│   ├── rag.js           # PDF parsing (pdf-parse), text chunking, and grounded context retrieval
│   ├── tools.js         # Weather, Web Search, Email simulator, Database, Calculator
│   └── vectorStore.js   # Cosine similarity vector engine and top-k semantic search
├── public/
│   ├── index.html       # Semantic editorial layout, RAG modal, Voice, Auth & Share
│   ├── share.html       # Standalone public read-only conversation viewer
│   ├── style.css        # Warm stone, editorial typography, modals, and print stylesheet
│   └── script.js        # Voice STT/TTS, streaming parser, RAG management, copy helpers
├── .dockerignore        # Docker build exclusions
├── .env                 # Secret environment variables (API Key)
├── .env.example         # Example configuration template
├── docker-compose.yml   # Multi-container orchestration with persistent volumes
├── Dockerfile           # Multi-stage production Docker image
├── package.json         # Node.js manifest with ESM enabled
├── server.js            # Express server, route controllers, SSE streaming
└── README.md            # Comprehensive documentation
```

---

## 🚀 Getting Started

### 1. Requirements
- **Node.js** v20+
- **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/apikey)

### 2. Configuration
Copy `.env.example` to `.env` and provide your API key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
GEMINI_MODEL=gemini-3.5-flash-lite
JWT_SECRET=your_secure_jwt_secret
```

### 3. Run Locally
```bash
# Start server in watch mode
npm run dev
```
Visit **[http://localhost:3000](http://localhost:3000)**.

---

## 🐳 Docker Deployment

### Run with Docker Compose:
```bash
docker compose up -d --build
```
Your persistent data (users, indexed documents, chat histories) will be persisted in the `scribe-data` named Docker volume.

### Run Single Container:
```bash
docker build -t scribe-ai:latest .
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data --name scribe-app scribe-ai:latest
```

---

## 🔄 CI/CD Pipeline

The included `.github/workflows/ci-cd.yml` workflow automatically runs on every push and pull request:
1. **Automated Syntax & Static Checks**: Validates ESM modules and syntax integrity.
2. **Unit & Chunking Verification**: Tests chunking algorithms and vector similarity computations.
3. **Docker Build Validation**: Verifies that the container image builds with zero warnings.
4. **Deploy Step**: Triggers automated deployment hooks (e.g., Render, Railway, or VPS webhook).

---

## 🛡️ Security & Hardening Highlights
- **Strict Server-Side Isolation**: The Google Gemini API key is never exposed to the client browser.
- **Sliding-Window Rate Limiter**: IP and token-based rate limiting with `Retry-After` headers prevents abuse.
- **Strict Content-Security-Policy & OWASP Headers**: Enforces `nosniff`, `frame-ancestors 'none'`, and granular `connect-src`.
- **Upload Hardening**: Maximum 10MB file limit, verified MIME types (PDF, plain text, markdown), and safe sanitized memory buffers.
