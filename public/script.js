/* ═══════════════════════════════════════════════════════════════
   Scribe — Frontend Logic & Conversation Manager
   ═══════════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  /* ── DOM References ── */
  const $ = (selector) => document.querySelector(selector);
  const messagesEl        = $("#messages");
  const welcomeEl         = $("#welcome");
  const chatForm          = $("#chat-form");
  const messageInput      = $("#message-input");
  const sendBtn           = $("#send-btn");
  const typingIndicator   = $("#typing-indicator");
  const chatListEl        = $("#chat-list");
  const newChatBtn        = $("#new-chat-btn");
  const clearAllBtn       = $("#clear-all-btn");
  const sidebar           = $("#sidebar");
  const sidebarToggle     = $("#sidebar-toggle");
  const overlay           = $("#overlay");
  const activeChatTitleEl = $("#active-chat-title");
  const themeToggle       = $("#theme-toggle");

  /* ── Application State ── */
  let chats = [];
  let activeChatId = null;

  const STORAGE_KEY = "scribe_conversations";
  const LEGACY_STORAGE_KEY = "lumen_conversations";

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch (e) {
      console.warn("Storage quota exceeded or disabled", e);
    }
  }

  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        chats = JSON.parse(raw);
        // Automatically migrate any legacy stored titles
        let changed = false;
        chats.forEach((c) => {
          if (c.title === "New Dialogue") {
            c.title = "New Chat";
            changed = true;
          }
        });
        if (changed) persist();
      }
    } catch {
      chats = [];
    }
  }

  function generateId() {
    return "chat_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function escapeHtml(text) {
    const chars = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return String(text).replace(/[&<>"']/g, (c) => chars[c]);
  }

  /**
   * Refined markdown parser supporting headers, quotes, lists, code blocks with copy
   */
  function formatMarkdown(text) {
    if (!text) return "";

    // 1. Extract and preserve code blocks
    const codeBlocks = [];
    let processed = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const id = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push({ lang: lang || "code", code: code.trim() });
      return id;
    });

    // 2. Escape standard HTML in the remaining text
    processed = escapeHtml(processed);

    // 3. Headers: ###, ##, #
    processed = processed.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    processed = processed.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    processed = processed.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // 4. Blockquotes: > quote
    processed = processed.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");

    // 5. Bold & Italics
    processed = processed.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
    processed = processed.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    processed = processed.replace(/\*([^\*]+?)\*/g, "<em>$1</em>");

    // 6. Inline code
    processed = processed.replace(/`([^`]+)`/g, "<code>$1</code>");

    // 7. Unordered lists: - item or * item
    processed = processed.replace(/^\s*[\-\*]\s+(.*)$/gim, "<li>$1</li>");
    processed = processed.replace(/(<li>[\s\S]*?<\/li>)/gi, "<ul>$1</ul>");
    // Merge consecutive <ul> tags
    processed = processed.replace(/<\/ul>\s*<ul>/gi, "");

    // 8. Paragraphs & Line Breaks
    processed = processed
      .split(/\n{2,}/)
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return "";
        if (
          trimmed.startsWith("<h1") ||
          trimmed.startsWith("<h2") ||
          trimmed.startsWith("<h3") ||
          trimmed.startsWith("<blockquote") ||
          trimmed.startsWith("<ul") ||
          trimmed.startsWith("__CODE_BLOCK_")
        ) {
          return trimmed;
        }
        return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
      })
      .join("");

    // 9. Reinsert syntax code blocks with Copy button
    codeBlocks.forEach((item, index) => {
      const placeholder = `__CODE_BLOCK_${index}__`;
      const htmlBlock = `
        <div class="code-wrapper">
          <div class="code-header">
            <span>${escapeHtml(item.lang)}</span>
            <button class="btn-copy-code" type="button" data-code="${escapeHtml(item.code)}">Copy</button>
          </div>
          <pre><code>${escapeHtml(item.code)}</code></pre>
        </div>`;
      processed = processed.replace(placeholder, htmlBlock);
    });

    return processed;
  }

  function scrollToBottom() {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  }

  /* ── Sidebar Render ── */
  function renderChatList() {
    chatListEl.innerHTML = "";
    chats.forEach((chat) => {
      const item = document.createElement("button");
      item.className = "chat-item" + (chat.id === activeChatId ? " active" : "");
      item.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span>${escapeHtml(chat.title)}</span>
      `;

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "chat-item-delete";
      deleteBtn.title = "Delete chat";
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>`;

      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });

      item.appendChild(deleteBtn);
      item.addEventListener("click", () => selectChat(chat.id));
      chatListEl.appendChild(item);
    });

    const activeChat = chats.find((c) => c.id === activeChatId);
    if (activeChatTitleEl) {
      activeChatTitleEl.textContent = activeChat ? activeChat.title : "New Chat";
    }
  }

  /* ── Messages Render ── */
  function renderMessages() {
    const current = chats.find((c) => c.id === activeChatId);

    if (!current || current.messages.length === 0) {
      messagesEl.innerHTML = "";
      welcomeEl.style.display = "flex";
      return;
    }

    welcomeEl.style.display = "none";
    messagesEl.innerHTML = current.messages
      .map((msg) => {
        if (msg.role === "user") {
          return `
            <div class="message-row user">
              <span class="message-author">You</span>
              <div class="bubble">${escapeHtml(msg.text)}</div>
            </div>`;
        } else if (msg.role === "error") {
          return `
            <div class="message-row error">
              <div class="bubble">${escapeHtml(msg.text)}</div>
            </div>`;
        } else {
          return `
            <div class="message-row bot">
              <div class="message-header">
                <div class="bot-monogram">S</div>
                <span class="bot-name">Scribe</span>
              </div>
              <div class="bubble">${formatMarkdown(msg.text)}</div>
            </div>`;
        }
      })
      .join("");

    attachCodeCopyListeners();
    scrollToBottom();
  }

  /* ── Copy to Clipboard for Code Blocks ── */
  function attachCodeCopyListeners() {
    messagesEl.querySelectorAll(".btn-copy-code").forEach((btn) => {
      btn.onclick = async () => {
        const rawCode = btn.getAttribute("data-code") || "";
        try {
          await navigator.clipboard.writeText(rawCode);
          btn.textContent = "Copied";
          setTimeout(() => (btn.textContent = "Copy"), 1800);
        } catch {
          btn.textContent = "Failed";
          setTimeout(() => (btn.textContent = "Copy"), 1800);
        }
      };
    });
  }

  /* ── Chat Management ── */
  function createChat() {
    const newChat = {
      id: generateId(),
      title: "New Chat",
      messages: [],
      createdAt: Date.now(),
    };
    chats.unshift(newChat);
    activeChatId = newChat.id;
    persist();
    renderChatList();
    renderMessages();
    messageInput.focus();
    closeMobileSidebar();
  }

  function selectChat(id) {
    activeChatId = id;
    renderChatList();
    renderMessages();
    closeMobileSidebar();
  }

  function deleteChat(id) {
    fetch(`/api/chat/${id}`, { method: "DELETE" }).catch(() => {});
    chats = chats.filter((c) => c.id !== id);
    if (activeChatId === id) {
      activeChatId = chats.length ? chats[0].id : null;
      if (!activeChatId) createChat();
    }
    persist();
    renderChatList();
    renderMessages();
  }

  function clearAllChats() {
    if (!confirm("Clear all chats?")) return;
    chats.forEach((c) => {
      fetch(`/api/chat/${c.id}`, { method: "DELETE" }).catch(() => {});
    });
    chats = [];
    createChat();
  }

  /* ── Sending Messages ── */
  async function submitInquiry(rawText) {
    const text = rawText.trim();
    if (!text) return;

    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat) return;

    // Append user message
    chat.messages.push({ role: "user", text });

    // Set title on first message
    if (chat.messages.length === 1) {
      chat.title = text.length > 34 ? text.slice(0, 34).trim() + "…" : text;
    }

    persist();
    renderChatList();
    renderMessages();

    // Show indicator
    typingIndicator.classList.remove("hidden");
    scrollToBottom();
    messageInput.disabled = true;
    sendBtn.disabled = true;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, chatId: activeChatId }),
      });

      if (!response.ok) {
        let errMessage = `Server responded with status ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.error) errMessage = errData.error;
        } catch {}
        throw new Error(errMessage);
      }

      // Add placeholder bot message to render container
      const botMsg = { role: "bot", text: "" };
      chat.messages.push(botMsg);
      renderMessages();

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let hasReceivedFirstChunk = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop(); // keep incomplete remainder

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.error) {
              throw new Error(data.error);
            }
            if (data.text) {
              if (!hasReceivedFirstChunk) {
                hasReceivedFirstChunk = true;
                typingIndicator.classList.add("hidden");
              }
              botMsg.text += data.text;

              const botBubbles = messagesEl.querySelectorAll(".message-row.bot .bubble");
              const currentBubble = botBubbles[botBubbles.length - 1];
              if (currentBubble) {
                currentBubble.innerHTML = formatMarkdown(botMsg.text);
              }
              scrollToBottom();
            }
          } catch (e) {
            if (e.message && !e.message.includes("JSON")) throw e;
          }
        }
      }

      if (!botMsg.text) {
        throw new Error("Empty response received from Scribe.");
      }
    } catch (err) {
      if (
        chat.messages.length &&
        chat.messages[chat.messages.length - 1].role === "bot" &&
        !chat.messages[chat.messages.length - 1].text
      ) {
        chat.messages.pop();
      }
      chat.messages.push({
        role: "error",
        text: err.message || "Unable to reach Scribe service. Please verify your connection or API key.",
      });
    } finally {
      typingIndicator.classList.add("hidden");
      messageInput.disabled = false;
      messageInput.value = "";
      messageInput.style.height = "auto";
      sendBtn.disabled = true;
      const frame = document.querySelector(".composer-frame");
      if (frame) frame.classList.remove("has-value");
      persist();
      renderMessages();
      messageInput.focus();
    }
  }

  /* ── Textarea Auto-expand & Typing Popup Animation ── */
  const composerFrame = $(".composer-frame");
  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
    const hasText = messageInput.value.trim().length > 0;
    sendBtn.disabled = !hasText;
    if (composerFrame) {
      composerFrame.classList.toggle("has-value", hasText);
    }
  });

  /* ── Form Events ── */
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitInquiry(messageInput.value);
  });

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });


  /* ── Sidebar & Responsive Drawer ── */
  function openMobileSidebar() {
    sidebar.classList.add("open");
    overlay.classList.add("active");
  }

  /* ── Sidebar Toggle Management ── */
  const SIDEBAR_PREF_KEY = "scribe_sidebar_collapsed";

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function openMobileSidebar() {
    sidebar.classList.add("open");
    overlay.classList.add("active");
  }

  function closeMobileSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("active");
  }

  function toggleSidebar() {
    if (isMobile()) {
      sidebar.classList.contains("open") ? closeMobileSidebar() : openMobileSidebar();
    } else {
      const isCollapsed = document.body.classList.toggle("sidebar-collapsed");
      try {
        localStorage.setItem(SIDEBAR_PREF_KEY, isCollapsed ? "true" : "false");
      } catch {}
    }
  }

  function initSidebar() {
    if (!isMobile()) {
      try {
        if (localStorage.getItem(SIDEBAR_PREF_KEY) === "true") {
          document.body.classList.add("sidebar-collapsed");
        }
      } catch {}
    }
  }

  if (sidebarToggle) sidebarToggle.addEventListener("click", toggleSidebar);
  overlay.addEventListener("click", closeMobileSidebar);
  newChatBtn.addEventListener("click", createChat);
  clearAllBtn.addEventListener("click", clearAllChats);

  /* Touch Swipe Gesture to close sidebar on mobile */
  let touchStartX = 0;
  let touchStartY = 0;

  sidebar.addEventListener("touchstart", (e) => {
    if (!e.changedTouches || !e.changedTouches[0]) return;
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
  }, { passive: true });

  sidebar.addEventListener("touchend", (e) => {
    if (!e.changedTouches || !e.changedTouches[0]) return;
    const diffX = e.changedTouches[0].clientX - touchStartX;
    const diffY = e.changedTouches[0].clientY - touchStartY;
    // Swiped left by > 45px with predominantly horizontal motion
    if (diffX < -45 && Math.abs(diffX) > Math.abs(diffY)) {
      closeMobileSidebar();
    }
  }, { passive: true });

  /* Global Keyboard Shortcuts */
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      createChat();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      toggleSidebar();
    }
    if (e.key === "Escape") {
      closeMobileSidebar();
    }
  });

  /* ── Theme Management (Light / Dark) ── */
  const THEME_KEY = "scribe_theme";

  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }

  function toggleTheme() {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    applyTheme(isLight ? "dark" : "light");
  }

  function initTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) {
        applyTheme(saved);
        return;
      }
    } catch {}

    // Default to the warm, eye-pleasing oat parchment theme
    applyTheme("light");
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }

  /* ── Initialization ── */
  initTheme();
  initSidebar();
  restore();
  if (!chats.length) {
    createChat();
  } else {
    activeChatId = chats[0].id;
    renderChatList();
    renderMessages();
  }
})();
