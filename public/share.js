(() => {
  "use strict";

  const urlParams = new URLSearchParams(window.location.search);
  const shareId = urlParams.get("id");
  const titleEl = document.getElementById("share-title");
  const metaEl = document.getElementById("share-meta");
  const contentEl = document.getElementById("share-content");
  const themeToggle = document.getElementById("theme-toggle");

  // Theme Management
  const savedTheme = localStorage.getItem("scribe_theme") || "light";
  if (savedTheme === "light") document.documentElement.setAttribute("data-theme", "light");
  if (themeToggle) {
    themeToggle.onclick = () => {
      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      const next = isLight ? "dark" : "light";
      if (next === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("scribe_theme", next);
    };
  }

  function escapeHtml(text) {
    const chars = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return String(text).replace(/[&<>"']/g, (c) => chars[c]);
  }

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
      .map((b) => {
        const t = b.trim();
        if (!t) return "";
        if (t.startsWith("<h1") || t.startsWith("<h2") || t.startsWith("<h3") || t.startsWith("<blockquote") || t.startsWith("<ul") || t.startsWith("__CODE_BLOCK_")) return t;
        return `<p>${t.replace(/\n/g, "<br>")}</p>`;
      })
      .join("");

    codeBlocks.forEach((item, idx) => {
      const placeholder = `__CODE_BLOCK_${idx}__`;
      const block = `
        <div class="code-wrapper">
          <div class="code-header">
            <span>${escapeHtml(item.lang)}</span>
            <button class="btn-copy-code" type="button" data-code="${escapeHtml(item.code)}">Copy</button>
          </div>
          <pre><code>${escapeHtml(item.code)}</code></pre>
        </div>`;
      processed = processed.replace(placeholder, block);
    });

    return processed;
  }

  async function loadShare() {
    if (!shareId) {
      if (titleEl) titleEl.textContent = "Invalid Share Link";
      if (contentEl) contentEl.innerHTML = `<div class="share-loading">No conversation ID was provided in the URL.</div>`;
      return;
    }

    try {
      const res = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
      if (!res.ok) throw new Error("Conversation snapshot not found or expired.");
      const data = await res.json();
      const shared = data.shared;

      if (titleEl) titleEl.textContent = shared.title || "Shared Conversation";
      if (metaEl) metaEl.textContent = `Captured on ${new Date(shared.createdAt).toLocaleDateString()} · ${shared.messages.length} messages`;

      if (contentEl) {
        contentEl.innerHTML = shared.messages.map((m) => {
          if (m.role === "user") {
            return `
              <div class="message-row user">
                <span class="message-author">User</span>
                <div class="bubble">${escapeHtml(m.text)}</div>
              </div>`;
          } else {
            return `
              <div class="message-row bot">
                <div class="message-header">
                  <div class="bot-monogram">S</div>
                  <span class="bot-name">Scribe</span>
                </div>
                <div class="bubble">${formatMarkdown(m.text)}</div>
              </div>`;
          }
        }).join("");
      }

      document.querySelectorAll(".btn-copy-code").forEach((btn) => {
        btn.onclick = async () => {
          const code = btn.getAttribute("data-code") || "";
          try {
            await navigator.clipboard.writeText(code);
            btn.textContent = "Copied";
            setTimeout(() => (btn.textContent = "Copy"), 1800);
          } catch {
            btn.textContent = "Failed";
          }
        };
      });
    } catch (err) {
      if (titleEl) titleEl.textContent = "Unable to Load";
      if (contentEl) contentEl.innerHTML = `<div class="share-loading">${escapeHtml(err.message)}</div>`;
    }
  }

  loadShare();
})();
