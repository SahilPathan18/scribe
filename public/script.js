/* ═══════════════════════════════════════════════════════════════
   Scribe — Intelligent Conversational Platform
   RAG Document Intelligence · Voice STT/TTS · Live Tools ·
   Persistent Memory · Multi-User Accounts · Export & Sharing
   ═══════════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  /* ── DOM References ── */
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  // Layout & Navigation
  const messagesEl          = $("#messages");
  const welcomeEl           = $("#welcome");
  const chatForm            = $("#chat-form");
  const messageInput        = $("#message-input");
  const sendBtn             = $("#send-btn");
  const typingIndicator     = $("#typing-indicator");
  const chatListEl          = $("#chat-list");
  const newChatBtn          = $("#new-chat-btn");
  const clearAllBtn         = $("#clear-all-btn");
  const sidebar             = $("#sidebar");
  const sidebarToggle       = $("#sidebar-toggle");
  const overlay             = $("#overlay");
  const activeChatTitleEl   = $("#active-chat-title");
  const themeToggle         = $("#theme-toggle");
  const toastHub            = $("#toast-hub");

  // Status Badges & Banners
  const memoryBadge         = $("#memory-badge");
  const ragBadge            = $("#rag-badge");
  const ragBadgeText        = $("#rag-badge-text");
  const toolBanner          = $("#tool-banner");
  const toolBannerText      = $("#tool-banner-text");
  const sidebarDocCount     = $("#sidebar-doc-count");

  // Voice Elements
  const voiceInputBtn       = $("#voice-input-btn");
  const voiceOverlay        = $("#voice-overlay");
  const cancelVoiceBtn      = $("#cancel-voice-btn");
  const autoSpeakToggle     = $("#auto-speak-toggle");

  // Document (RAG) Elements
  const openDocsBtn         = $("#open-docs-btn");
  const docsModal           = $("#docs-modal");
  const closeDocsModal      = $("#close-docs-modal");
  const dropZone            = $("#drop-zone");
  const browseDocsBtn       = $("#browse-docs-btn");
  const hiddenFileInput     = $("#hidden-file-input");
  const attachDocBtn        = $("#attach-doc-btn");
  const uploadProgContainer = $("#upload-progress-container");
  const uploadStatusFile    = $("#upload-status-filename");
  const uploadStatusPct     = $("#upload-status-pct");
  const uploadProgressBar   = $("#upload-progress-bar");
  const indexedDocsList     = $("#indexed-docs-list");
  const welcomeUploadTrig   = $("#welcome-upload-trigger");
  const composerAttPreview  = $("#composer-attachment-preview");
  const attachmentName      = $("#attachment-name");
  const removeAttachmentBtn = $("#remove-attachment-btn");

  // Auth Elements
  const userProfileWidget   = $("#user-profile-widget");
  const userAvatar          = $("#user-avatar");
  const userDisplayName     = $("#user-display-name");
  const userStatusText      = $("#user-status-text");
  const authActionBtn       = $("#auth-action-btn");
  const authModal           = $("#auth-modal");
  const closeAuthModal      = $("#close-auth-modal");
  const tabLogin            = $("#tab-login");
  const tabRegister         = $("#tab-register");
  const authForm            = $("#auth-form");
  const authUsernameField   = $("#auth-username-field");
  const authUsernameInput   = $("#auth-username");
  const authIdentifierInput = $("#auth-identifier");
  const authIdentifierLabel = $("#auth-identifier-label");
  const authPasswordInput   = $("#auth-password");
  const authErrorMsg        = $("#auth-error-msg");
  const authSubmitBtn       = $("#auth-submit-btn");
  const authToggleCaption   = $("#auth-toggle-caption");
  const authSwitchTabBtn    = $("#auth-switch-tab-btn");

  // Sharing & Export Elements
  const shareChatBtn        = $("#share-chat-btn");
  const shareModal          = $("#share-modal");
  const closeShareModal     = $("#close-share-modal");
  const shareUrlInput       = $("#share-url-input");
  const copyShareBtn        = $("#copy-share-btn");
  const exportChatBtn       = $("#export-chat-btn");
  const exportDropdown      = $("#export-dropdown");
  const exportPdfBtn        = $("#export-pdf-btn");
  const exportMdBtn         = $("#export-md-btn");
  const exportJsonBtn       = $("#export-json-btn");

  // Citation Modal Elements
  const citationModal       = $("#citation-modal");
  const closeCitationModal  = $("#close-citation-modal");
  const citationModalSub    = $("#citation-modal-subtitle");
  const citationFullText    = $("#citation-full-text");

  /* ── Application State ── */
  let currentUser = null; // null for guest, or { id, username, email }
  let chats = [];
  let activeChatId = null;
  let indexedDocuments = [];
  let autoSpeakEnabled = false;
  let activeSpeechUtterance = null;
  let speechRecognition = null;
  let isRecordingVoice = false;

  const TOKEN_KEY = "scribe_token";
  const AUTO_SPEAK_KEY = "scribe_auto_speak";
  const STORAGE_KEY = "scribe_conversations";

  const GUEST_ID_KEY = "scribe_guest_id";
  function getOrCreateGuestId() {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id || id.length < 8) {
      id = "gst_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  }

  /* ── Helper: Authenticated Fetch Header ── */
  function getAuthHeaders(customHeaders = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = { ...customHeaders };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    headers["x-guest-id"] = getOrCreateGuestId();
    return headers;
  }

  /* ── Helper: Toast Notifications ── */
  function showToast(message, duration = 3200) {
    if (!toastHub) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastHub.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(8px)";
      toast.style.transition = "all .2s ease";
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  function escapeHtml(text) {
    const chars = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return String(text).replace(/[&<>"']/g, (c) => chars[c]);
  }

  function generateId() {
    return "chat_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  /* ── Markdown Formatter with Syntax Highlighting & Code Copy ── */
  function formatMarkdown(text) {
    if (!text) return "";

    const codeBlocks = [];
    let processed = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const id = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push({ lang: lang || "code", code: code.trim() });
      return id;
    });

    processed = escapeHtml(processed);

    processed = processed.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    processed = processed.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    processed = processed.replace(/^# (.*$)/gim, "<h1>$1</h1>");
    processed = processed.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");
    processed = processed.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
    processed = processed.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    processed = processed.replace(/\*([^\*]+?)\*/g, "<em>$1</em>");
    processed = processed.replace(/`([^`]+)`/g, "<code>$1</code>");
    processed = processed.replace(/^\s*[\-\*]\s+(.*)$/gim, "<li>$1</li>");
    processed = processed.replace(/(<li>[\s\S]*?<\/li>)/gi, "<ul>$1</ul>");
    processed = processed.replace(/<\/ul>\s*<ul>/gi, "");

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

  /* ── Sidebar Render & Chat Management ── */
  function renderChatList() {
    chatListEl.innerHTML = "";
    chats.forEach((chat) => {
      const item = document.createElement("button");
      item.className = "chat-item" + (chat.id === activeChatId ? " active" : "");
      item.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span>${escapeHtml(chat.title || "New Chat")}</span>
      `;

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "chat-item-delete";
      deleteBtn.title = "Delete conversation";
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

    // Toggle memory badge visibility if current chat has context memory
    if (memoryBadge) {
      if (activeChat && activeChat.summary) {
        memoryBadge.classList.remove("hidden");
        memoryBadge.title = `Persistent Context Memory Active:\n${activeChat.summary}`;
      } else {
        memoryBadge.classList.add("hidden");
      }
    }
  }

  /* ── Messages Rendering & Interactive Tools/Citations/TTS ── */
  function renderMessages() {
    const current = chats.find((c) => c.id === activeChatId);

    if (!current || !current.messages || current.messages.length === 0) {
      messagesEl.innerHTML = "";
      welcomeEl.style.display = "flex";
      return;
    }

    welcomeEl.style.display = "none";
    messagesEl.innerHTML = current.messages
      .map((msg, idx) => {
        if (msg.role === "user") {
          return `
            <div class="message-row user" data-idx="${idx}">
              <span class="message-author">You</span>
              <div class="bubble">${escapeHtml(msg.text)}</div>
            </div>`;
        } else if (msg.role === "error") {
          return `
            <div class="message-row error" data-idx="${idx}">
              <div class="bubble">${escapeHtml(msg.text)}</div>
            </div>`;
        } else {
          // Assistant Message
          let citationsHtml = "";
          if (msg.citations && msg.citations.length) {
            const tags = msg.citations
              .map(
                (c, cIdx) => `
                <button type="button" class="citation-tag" data-doc-name="${escapeHtml(c.docName)}" data-part="${c.chunkIndex}/${c.totalChunks}" data-preview="${escapeHtml(c.preview || "")}">
                  <span>📄</span>
                  <span>${escapeHtml(c.docName)}</span>
                  <span>· P${c.chunkIndex}</span>
                  <span>(${Math.round(c.similarity * 100)}%)</span>
                </button>`
              )
              .join("");
            citationsHtml = `<div class="citations-container">${tags}</div>`;
          }

          let toolLogHtml = "";
          if (msg.toolCalls && msg.toolCalls.length) {
            toolLogHtml = msg.toolCalls
              .map((t) => `<div class="tool-summary-pill">🛠️ ${escapeHtml(t.name)}</div>`)
              .join("");
          }

          return `
            <div class="message-row bot" data-idx="${idx}">
              <div class="message-header">
                <div class="bot-monogram">S</div>
                <span class="bot-name">Scribe</span>
                ${toolLogHtml}
                <button type="button" class="btn-speak-msg" data-text="${escapeHtml(msg.text)}" title="Read aloud (Text to Speech)">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                  <span>Speak</span>
                </button>
              </div>
              <div class="bubble">${formatMarkdown(msg.text)}${citationsHtml}</div>
            </div>`;
        }
      })
      .join("");

    attachCodeCopyListeners();
    attachCitationListeners();
    attachTtsListeners();
    scrollToBottom();
  }

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

  function attachCitationListeners() {
    messagesEl.querySelectorAll(".citation-tag").forEach((tag) => {
      tag.onclick = () => {
        const docName = tag.getAttribute("data-doc-name");
        const part = tag.getAttribute("data-part");
        const preview = tag.getAttribute("data-preview");

        if (citationModal && citationFullText) {
          citationModalSub.textContent = `${docName} (Part ${part})`;
          citationFullText.textContent = preview;
          citationModal.classList.remove("hidden");
        }
      };
    });
  }

  /* ── Voice Out: Text-to-Speech (TTS) ── */
  function speakText(rawText, btnElement = null) {
    if (!window.speechSynthesis) {
      showToast("Speech synthesis is not supported in this browser.");
      return;
    }

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      $$(".btn-speak-msg").forEach((b) => {
        b.classList.remove("speaking");
        b.querySelector("span").textContent = "Speak";
      });
      if (btnElement && activeSpeechUtterance) {
        activeSpeechUtterance = null;
        return;
      }
    }

    // Strip markdown code blocks and raw symbols for smooth speech
    const cleanSpeech = rawText
      .replace(/```[\s\S]*?```/g, "Code block omitted.")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*#_~>]/g, "")
      .trim();

    if (!cleanSpeech) return;

    const utterance = new SpeechSynthesisUtterance(cleanSpeech);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Samantha"))
    );
    if (naturalVoice) utterance.voice = naturalVoice;

    if (btnElement) {
      btnElement.classList.add("speaking");
      btnElement.querySelector("span").textContent = "Stop";
    }

    utterance.onend = utterance.onerror = () => {
      if (btnElement) {
        btnElement.classList.remove("speaking");
        btnElement.querySelector("span").textContent = "Speak";
      }
      activeSpeechUtterance = null;
    };

    activeSpeechUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function attachTtsListeners() {
    messagesEl.querySelectorAll(".btn-speak-msg").forEach((btn) => {
      btn.onclick = () => {
        const text = btn.getAttribute("data-text") || "";
        speakText(text, btn);
      };
    });
  }

  /* ── Voice In: Speech-to-Text (STT) ── */
  function initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      if (voiceInputBtn) voiceInputBtn.style.display = "none";
      return;
    }

    speechRecognition = new SpeechRec();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;
    speechRecognition.lang = "en-US";

    speechRecognition.onstart = () => {
      isRecordingVoice = true;
      voiceInputBtn.classList.add("recording");
      voiceOverlay.classList.remove("hidden");
    };

    speechRecognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (transcript) {
        messageInput.value = transcript;
        messageInput.dispatchEvent(new Event("input"));
      }
    };

    speechRecognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      stopVoiceRecording();
      showToast(`Voice input: ${event.error}`);
    };

    speechRecognition.onend = () => {
      stopVoiceRecording();
    };
  }

  function startVoiceRecording() {
    if (!speechRecognition) return;
    try {
      speechRecognition.start();
    } catch (e) {
      stopVoiceRecording();
    }
  }

  function stopVoiceRecording() {
    isRecordingVoice = false;
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch {}
    }
    if (voiceInputBtn) voiceInputBtn.classList.remove("recording");
    if (voiceOverlay) voiceOverlay.classList.add("hidden");
  }

  if (voiceInputBtn) {
    voiceInputBtn.addEventListener("click", () => {
      if (isRecordingVoice) {
        stopVoiceRecording();
      } else {
        startVoiceRecording();
      }
    });
  }

  if (cancelVoiceBtn) {
    cancelVoiceBtn.addEventListener("click", stopVoiceRecording);
  }

  // Auto-speak toggle
  if (autoSpeakToggle) {
    autoSpeakEnabled = localStorage.getItem(AUTO_SPEAK_KEY) === "true";
    autoSpeakToggle.classList.toggle("active", autoSpeakEnabled);

    autoSpeakToggle.addEventListener("click", () => {
      autoSpeakEnabled = !autoSpeakEnabled;
      localStorage.setItem(AUTO_SPEAK_KEY, autoSpeakEnabled ? "true" : "false");
      autoSpeakToggle.classList.toggle("active", autoSpeakEnabled);
      showToast(autoSpeakEnabled ? "Voice auto-speak enabled" : "Voice auto-speak disabled");
    });
  }

  /* ── Chat State Persistence ── */
  function persistChatsLocally() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch {}
  }

  async function syncChats() {
    try {
      const res = await fetch("/api/chats", { credentials: "omit", headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.chats && data.chats.length) {
          chats = data.chats;
          if (!activeChatId || !chats.some((c) => c.id === activeChatId)) {
            activeChatId = chats[0].id;
          }
          // Fetch messages for active chat
          await loadActiveChatMessages();
          renderChatList();
          renderMessages();
          return;
        }
      }
    } catch (e) {
      console.warn("[Sync] Server sync fallback to local storage:", e.message);
    }

    // LocalStorage Fallback
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) chats = JSON.parse(raw);
    } catch {}

    if (!chats.length) {
      createChat();
    } else {
      activeChatId = chats[0].id;
      renderChatList();
      renderMessages();
    }
  }

  async function loadActiveChatMessages() {
    if (!activeChatId) return;
    try {
      const res = await fetch(`/api/chat/${activeChatId}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const found = chats.find((c) => c.id === activeChatId);
        if (found) {
          found.messages = data.messages || [];
          found.summary = data.chat?.summary || found.summary;
        }
      }
    } catch {}
  }

  function createChat() {
    const newChat = {
      id: generateId(),
      title: "New Chat",
      messages: [],
      summary: null,
      createdAt: Date.now(),
    };
    chats.unshift(newChat);
    activeChatId = newChat.id;
    persistChatsLocally();
    renderChatList();
    renderMessages();
    messageInput.focus();
    closeMobileSidebar();
  }

  async function selectChat(id) {
    activeChatId = id;
    await loadActiveChatMessages();
    renderChatList();
    renderMessages();
    closeMobileSidebar();
  }

  async function deleteChat(id) {
    try {
      fetch(`/api/chat/${id}`, { method: "DELETE", headers: getAuthHeaders() }).catch(() => {});
    } catch {}

    chats = chats.filter((c) => c.id !== id);
    if (activeChatId === id) {
      activeChatId = chats.length ? chats[0].id : null;
      if (!activeChatId) createChat();
    }
    persistChatsLocally();
    renderChatList();
    renderMessages();
  }

  function clearAllChats() {
    if (!confirm("Clear all conversations from Scribe?")) return;
    chats.forEach((c) => {
      fetch(`/api/chat/${c.id}`, { method: "DELETE", headers: getAuthHeaders() }).catch(() => {});
    });
    chats = [];
    persistChatsLocally();
    createChat();
  }

  /* ── Sending Message & Streaming Response (SSE) ── */
  async function submitInquiry(rawText) {
    const text = rawText.trim();
    if (!text) return;

    let chat = chats.find((c) => c.id === activeChatId);
    if (!chat) {
      createChat();
      chat = chats.find((c) => c.id === activeChatId);
    }

    // Add user message
    if (!chat.messages) chat.messages = [];
    chat.messages.push({ role: "user", text });

    if (chat.messages.length === 1) {
      chat.title = text.length > 34 ? text.slice(0, 34).trim() + "…" : text;
    }

    persistChatsLocally();
    renderChatList();
    renderMessages();

    // Show indicator & lock inputs
    typingIndicator.classList.remove("hidden");
    scrollToBottom();
    messageInput.disabled = true;
    sendBtn.disabled = true;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: text,
          chatId: activeChatId,
          title: chat.title,
          enableRag: true,
        }),
      });

      if (!response.ok) {
        let errMessage = `Error (Status ${response.status})`;
        try {
          const errData = await response.json();
          if (errData.error) errMessage = errData.error;
        } catch {}
        throw new Error(errMessage);
      }

      // Append placeholder bot response
      const botMsg = { role: "bot", text: "", citations: [], toolCalls: [] };
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
        buffer = parts.pop();

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

            // Real-time Tool Call Event
            if (data.toolStart) {
              toolBanner.classList.remove("hidden");
              toolBannerText.textContent = `Tool: ${data.toolStart.name} executing…`;
              botMsg.toolCalls.push({ name: data.toolStart.name, args: data.toolStart.args });
            }

            if (data.toolResult) {
              toolBannerText.textContent = `Tool: ${data.toolResult.name} completed. Synthesizing answer…`;
              setTimeout(() => toolBanner.classList.add("hidden"), 1800);
            }

            // Citations received from RAG
            if (data.citations && data.citations.length) {
              botMsg.citations = data.citations;
            }

            // Persistent Context Memory Updated
            if (data.hasMemory) {
              chat.summary = true;
              renderChatList();
            }

            // Token chunk
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
        throw new Error("No response received from Scribe.");
      }

      // Voice Auto-Speak on completion
      if (autoSpeakEnabled) {
        speakText(botMsg.text);
      }
    } catch (err) {
      if (
        chat.messages.length &&
        chat.messages[chat.messages.length - 1].role === "bot" &&
        !chat.messages[chat.messages.length - 1].text
      ) {
        chat.messages.pop();
      }

      let errorText = err.message || "Failed to reach Scribe service. Please check your network or API key.";
      if (
        err.name === "TypeError" ||
        /networkerror|failed to fetch|network error|load failed/i.test(errorText)
      ) {
        errorText = "Connection interrupted. If your cloud server was waking up from sleep or redeploying, please wait a few seconds and try sending your message again.";
      }

      chat.messages.push({
        role: "error",
        text: errorText,
      });
    } finally {
      typingIndicator.classList.add("hidden");
      toolBanner.classList.add("hidden");
      messageInput.disabled = false;
      messageInput.value = "";
      messageInput.style.height = "auto";
      sendBtn.disabled = true;
      const frame = $(".composer-frame");
      if (frame) frame.classList.remove("has-value");
      persistChatsLocally();
      renderMessages();
      messageInput.focus();
    }
  }

  /* ── Document Management (RAG) ── */
  async function fetchDocuments() {
    try {
      const res = await fetch("/api/documents", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        indexedDocuments = data.documents || [];
        renderDocumentsList();
        updateRagBadges();
      }
    } catch (err) {
      console.warn("Failed to fetch documents:", err.message);
    }
  }

  function updateRagBadges() {
    const count = indexedDocuments.length;
    if (sidebarDocCount) sidebarDocCount.textContent = count;
    if (ragBadgeText) {
      ragBadgeText.textContent = count > 0 ? `RAG: ${count} Doc${count > 1 ? "s" : ""}` : "RAG Ready";
    }
  }

  function renderDocumentsList() {
    if (!indexedDocsList) return;
    if (!indexedDocuments.length) {
      indexedDocsList.innerHTML = `
        <div class="empty-docs-message">
          No documents indexed yet. Upload a PDF above to begin grounded Q&amp;A.
        </div>`;
      return;
    }

    indexedDocsList.innerHTML = indexedDocuments
      .map(
        (doc) => `
        <div class="doc-item-row" data-id="${doc.id}">
          <div class="doc-item-info">
            <span class="doc-item-name" title="${escapeHtml(doc.name)}">📄 ${escapeHtml(doc.name)}</span>
            <span class="doc-item-meta">${(doc.size / 1024).toFixed(1)} KB · ${doc.chunkCount} vector chunks</span>
          </div>
          <button type="button" class="btn-delete-doc" data-id="${doc.id}" title="Remove document & vectors">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>`
      )
      .join("");

    indexedDocsList.querySelectorAll(".btn-delete-doc").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-id");
        try {
          const res = await fetch(`/api/documents/${id}`, {
            method: "DELETE",
            headers: getAuthHeaders(),
          });
          if (res.ok) {
            indexedDocuments = indexedDocuments.filter((d) => d.id !== id);
            renderDocumentsList();
            updateRagBadges();
            showToast("Document removed from knowledge base.");
          }
        } catch {}
      };
    });
  }

  async function uploadDocumentFile(file) {
    if (!file) return;

    if (uploadProgContainer) {
      uploadProgContainer.classList.remove("hidden");
      uploadStatusFile.textContent = `Uploading ${file.name}…`;
      uploadStatusPct.textContent = "Processing & embedding…";
      uploadProgressBar.style.width = "40%";
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!res.ok) {
        let errMessage = `Upload failed (${res.status})`;
        try {
          const errData = await res.json();
          if (errData.error) errMessage = errData.error;
        } catch {}
        throw new Error(errMessage);
      }

      const data = await res.json();
      if (uploadProgressBar) uploadProgressBar.style.width = "100%";
      setTimeout(() => {
        if (uploadProgContainer) uploadProgContainer.classList.add("hidden");
      }, 1000);

      showToast(`Indexed '${data.document.name}' (${data.document.chunkCount} chunks)`);
      await fetchDocuments();

      // Show attachment badge in composer
      if (composerAttPreview && attachmentName) {
        attachmentName.textContent = data.document.name;
        composerAttPreview.classList.remove("hidden");
      }
    } catch (err) {
      if (uploadProgContainer) uploadProgContainer.classList.add("hidden");
      showToast(`Error: ${err.message}`);
    }
  }

  // Document Drag & Drop
  if (dropZone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
      });
    });
    dropZone.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files.length) uploadDocumentFile(files[0]);
    });
  }

  if (browseDocsBtn && hiddenFileInput) {
    browseDocsBtn.onclick = () => hiddenFileInput.click();
  }
  if (attachDocBtn && hiddenFileInput) {
    attachDocBtn.onclick = () => hiddenFileInput.click();
  }
  if (hiddenFileInput) {
    hiddenFileInput.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        uploadDocumentFile(e.target.files[0]);
      }
    };
  }

  if (removeAttachmentBtn && composerAttPreview) {
    removeAttachmentBtn.onclick = () => composerAttPreview.classList.add("hidden");
  }

  /* ── User Authentication (Login, Register, Logout) ── */
  async function checkAuthStatus() {
    try {
      const res = await fetch("/api/auth/me", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (!data.guest && data.user) {
          currentUser = data.user;
          updateUserDisplay();
          return;
        }
      }
    } catch {}

    if (localStorage.getItem(TOKEN_KEY)) {
      localStorage.removeItem(TOKEN_KEY);
    }
    currentUser = null;
    updateUserDisplay();
  }

  function updateUserDisplay() {
    if (currentUser) {
      userAvatar.textContent = (currentUser.username || "U").slice(0, 1).toUpperCase();
      userDisplayName.textContent = currentUser.username;
      userStatusText.textContent = currentUser.email;
      authActionBtn.title = "Log Out";
      authActionBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
    } else {
      userAvatar.textContent = "G";
      userDisplayName.textContent = "Guest Mode";
      userStatusText.textContent = "Local session";
      authActionBtn.title = "Sign In / Register";
      authActionBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
    }
  }

  if (authActionBtn) {
    authActionBtn.onclick = () => {
      if (currentUser) {
        if (confirm(`Log out of ${currentUser.username}?`)) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(STORAGE_KEY);
          currentUser = null;
          chats = [];
          activeChatId = null;
          updateUserDisplay();
          syncChats();
          fetchDocuments();
          showToast("Logged out.");
        }
      } else {
        openAuthModal();
      }
    };
  }

  function openAuthModal(isRegister = false) {
    if (!authModal) return;
    authErrorMsg.classList.add("hidden");
    authForm.reset();
    if (isRegister) {
      tabRegister.classList.add("active");
      tabLogin.classList.remove("active");
      authUsernameField.classList.remove("hidden");
      authIdentifierLabel.textContent = "Email Address";
      authSubmitBtn.textContent = "Create Account";
      authToggleCaption.textContent = "Already have an account?";
      authSwitchTabBtn.textContent = "Sign in";
    } else {
      tabLogin.classList.add("active");
      tabRegister.classList.remove("active");
      authUsernameField.classList.add("hidden");
      authIdentifierLabel.textContent = "Email or Username";
      authSubmitBtn.textContent = "Sign In";
      authToggleCaption.textContent = "Don't have an account yet?";
      authSwitchTabBtn.textContent = "Create one";
    }
    authModal.classList.remove("hidden");
  }

  if (tabLogin) tabLogin.onclick = () => openAuthModal(false);
  if (tabRegister) tabRegister.onclick = () => openAuthModal(true);
  if (authSwitchTabBtn) {
    authSwitchTabBtn.onclick = () => {
      const isCurrentlyRegister = tabRegister.classList.contains("active");
      openAuthModal(!isCurrentlyRegister);
    };
  }

  if (authForm) {
    authForm.onsubmit = async (e) => {
      e.preventDefault();
      authErrorMsg.classList.add("hidden");
      const isRegister = tabRegister.classList.contains("active");

      const password = authPasswordInput.value;
      const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
      const payload = isRegister
        ? {
            username: authUsernameInput.value.trim(),
            email: authIdentifierInput.value.trim(),
            password,
          }
        : {
            identifier: authIdentifierInput.value.trim(),
            password,
          };

      authSubmitBtn.disabled = true;
      authSubmitBtn.textContent = "Authenticating…";

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Authentication failed");

        if (data.token) {
          localStorage.setItem(TOKEN_KEY, data.token);
          currentUser = data.user;
          updateUserDisplay();
          authModal.classList.add("hidden");
          showToast(`Welcome, ${currentUser.username}!`);
          await syncChats();
          await fetchDocuments();
        }
      } catch (err) {
        authErrorMsg.textContent = err.message;
        authErrorMsg.classList.remove("hidden");
      } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = isRegister ? "Create Account" : "Sign In";
      }
    };
  }

  /* ── Export Conversations (PDF, Markdown, JSON) ── */
  function exportChatAsPdf() {
    window.print();
  }

  function exportChatAsMarkdown() {
    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat?.messages?.length) return showToast("No messages to export.");

    let md = `# ${chat.title || "Conversation"}\n\n`;
    md += `*Captured on ${new Date().toLocaleString()}*\n\n---\n\n`;

    chat.messages.forEach((m) => {
      const author = m.role === "user" ? "### You" : "### Scribe";
      md += `${author}\n\n${m.text}\n\n`;
    });

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(chat.title || "dialogue").toLowerCase().replace(/[^a-z0-9]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Markdown exported.");
  }

  function exportChatAsJson() {
    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat?.messages?.length) return showToast("No messages to export.");

    const jsonStr = JSON.stringify(chat, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scribe_chat_${chat.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("JSON exported.");
  }

  if (exportChatBtn && exportDropdown) {
    exportChatBtn.onclick = (e) => {
      e.stopPropagation();
      exportDropdown.classList.toggle("hidden");
    };
    document.addEventListener("click", () => exportDropdown.classList.add("hidden"));
  }

  if (exportPdfBtn) exportPdfBtn.onclick = exportChatAsPdf;
  if (exportMdBtn) exportMdBtn.onclick = exportChatAsMarkdown;
  if (exportJsonBtn) exportJsonBtn.onclick = exportChatAsJson;

  /* ── Share Snapshot Link ── */
  if (shareChatBtn) {
    shareChatBtn.onclick = async () => {
      const chat = chats.find((c) => c.id === activeChatId);
      if (!chat || !chat.messages || !chat.messages.length) {
        showToast("Cannot share an empty chat.");
        return;
      }

      try {
        const res = await fetch(`/api/chat/${activeChatId}/share`, {
          method: "POST",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to generate share link.");
        }

        const data = await res.json();
        shareUrlInput.value = data.shareUrl;
        shareModal.classList.remove("hidden");
      } catch (err) {
        showToast(`Share error: ${err.message}`);
      }
    };
  }

  if (copyShareBtn && shareUrlInput) {
    copyShareBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareUrlInput.value);
        copyShareBtn.textContent = "Copied!";
        showToast("Share link copied to clipboard!");
        setTimeout(() => (copyShareBtn.textContent = "Copy Link"), 2000);
      } catch {
        shareUrlInput.select();
        document.execCommand("copy");
        showToast("Copied to clipboard!");
      }
    };
  }

  /* ── Modal Close Handlers ── */
  if (closeDocsModal && docsModal) closeDocsModal.onclick = () => docsModal.classList.add("hidden");
  if (closeAuthModal && authModal) closeAuthModal.onclick = () => authModal.classList.add("hidden");
  if (closeShareModal && shareModal) closeShareModal.onclick = () => shareModal.classList.add("hidden");
  if (closeCitationModal && citationModal) closeCitationModal.onclick = () => citationModal.classList.add("hidden");

  if (openDocsBtn && docsModal) {
    openDocsBtn.onclick = () => {
      docsModal.classList.remove("hidden");
      fetchDocuments();
    };
  }

  if (welcomeUploadTrig && docsModal) {
    welcomeUploadTrig.onclick = () => {
      docsModal.classList.remove("hidden");
      fetchDocuments();
    };
  }

  // Close modals on backdrop click
  $$(".modal-backdrop").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
  });

  /* ── Textarea Auto-expand & Form Events ── */
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

  // Welcome prompt card click
  $$(".welcome-card[data-prompt]").forEach((card) => {
    card.onclick = () => {
      const prompt = card.getAttribute("data-prompt");
      if (prompt) {
        messageInput.value = prompt;
        messageInput.dispatchEvent(new Event("input"));
        chatForm.requestSubmit();
      }
    };
  });

  /* ── Sidebar & Responsive Drawer ── */
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
  if (overlay) overlay.addEventListener("click", closeMobileSidebar);
  if (newChatBtn) newChatBtn.addEventListener("click", createChat);
  if (clearAllBtn) clearAllBtn.addEventListener("click", clearAllChats);

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
      $$(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
    }
  });

  /* ── Theme Management ── */
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
    applyTheme("light");
  }

  if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

  /* ── App Initialization ── */
  initTheme();
  initSidebar();
  initSpeechRecognition();
  checkAuthStatus();
  syncChats();
  fetchDocuments();
})();
