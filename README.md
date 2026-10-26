# Scribe — Thoughtful Intelligence ✒️

A refined, editorial conversational workspace built for college project demonstration and evaluation. Built on Node.js/Express and Google Gemini (`gemini-3.5-flash-lite`), styled with an editorial warm paper & stone aesthetic inspired by Claude, bespoke journals, and modern reading tools.

---

## 🌿 Design & Aesthetic Philosophy

Rather than using generic neon gradients, glow effects, or cliché AI prompts, **Scribe** is crafted with intentional, human-centered editorial design:
- **Typography**: Paired editorial serif (**Newsreader**) for headers & dialogues with clean neutral sans (**Plus Jakarta Sans**) and monospaced code blocks (**JetBrains Mono**).
- **Color Palette**: Warm oat parchment (`#f8f6f0`) & charcoal canvas (`#23201d`), stone surfaces, soft linen ink, and refined Royal Blue accents (`#2563eb`).
- **Reading-First Flow**: Longform responses stream in real-time token-by-token with comfortable measure, syntax-highlighted code blocks with a one-click **Copy** button, blockquotes, and graceful markdown hierarchy.
- **Thoughtful Design**: Center stage minimal welcome, subtle typing elevation animations, and left-side framed shadows.

---

## ✨ Features

- **Gemini Real-Time SSE Streaming**: Express backend streams tokens in real-time using `sendMessageStream` and Server-Sent Events.
- **Multi-Chat Archive**: Create, switch, and delete multiple conversations stored in the collapsible sidebar.
- **Context Memory**: Backend retains active multi-turn session history in memory per `chatId`.
- **Keyboard Shortcuts**: `Ctrl+B` toggles sidebar, `Ctrl+N` starts a new chat, `Enter` sends message, `Shift+Enter` creates a newline.
- **Copyable Code Blocks**: Clean syntax blocks with instant clipboard copy functionality.
- **Browser Persistence**: Conversations are saved to browser `localStorage`.
- **Responsive Drawer**: Accessible mobile drawer with auto-dimming overlay.
- **Secure Configuration**: API keys are isolated on the server in `.env`.

---

## 📁 Project Structure

```text
gemini-chatbot/
├── public/
│   ├── index.html       # Semantic editorial layout & SVG icon system
│   ├── style.css        # Warm stone, terracotta accents & custom typography
│   └── script.js        # Markdown formatting, state management & copy helpers
├── .env                 # Secret environment variables (API Key)
├── .env.example         # Example configuration template
├── .gitignore           # Prevents committing secrets or node_modules
├── package.json         # Node.js project manifest (ES modules enabled)
├── server.js            # Express server & Gemini API integration
└── README.md            # Project documentation & presentation guide
```

---

## 🚀 Setup & Execution

### 1. Requirements
- **Node.js** v18+
- **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/apikey)

### 2. Dependencies
Dependencies are already installed. If running on a new machine:
```bash
npm install
```

### 3. Configure API Key
Ensure [.env](file:///d:/projects/gemini-chatbot/.env) has your Gemini API key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
```

### 4. Run the Server
```bash
npm run dev
```

### 5. Open in Browser
Visit **[http://localhost:3000](http://localhost:3000)**.
