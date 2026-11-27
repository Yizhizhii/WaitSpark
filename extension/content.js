/**
 * WaitSpark Chrome Content Script — Refined Light Glass Bubble above Chat Input
 *
 * - Collapsed: ZERO top text header — just 1~2 crisp question rows (「灵感」 + 「查漏」) + subtle corner ×
 * - Motion: silky spring-deceleration entrance, staggered row reveal, upward morph expand,
 *           steady in-place quiz answer bloom, gentle collapse, and mist-like exit dissolve.
 */

(() => {
  if (window.__WAITSPARK_EXT_LOADED__) return;
  window.__WAITSPARK_EXT_LOADED__ = true;

  const LETTERS = ["A", "B", "C", "D"];
  const HOST_ID = "waitspark-chatbox-bubble-host";

  const state = {
    cards: [],
    topic: "",
    view: "hidden", // "hidden" | "collapsed" | "expanded"
    activeIdx: 0,
    selectedOption: {},
    answerRevealed: {},
    requestSeq: 0,
    lastSentText: "",
    lastSentAt: 0,
    lastUrl: location.href,
    navigatedAt: Date.now(),
    seenUserCount: 0,
    lastDraftText: "",
    placedOnce: false,
    closingTimer: 0,
  };

  let hostEl = null;
  let shadow = null;
  let containerEl = null;
  let anchorRaf = 0;

  // ---------------- Composer & Context Detection ----------------

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 10;
  }

  function findComposerInput() {
    const selectors = [
      'div#prompt-textarea[contenteditable="true"]',
      "#prompt-textarea",
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-testid="textbox"]',
      'rich-textarea div[contenteditable="true"]',
      'form div[contenteditable="true"]',
      'form textarea:not([readonly]):not([disabled])',
      'main div[contenteditable="true"]',
      'main textarea:not([readonly]):not([disabled])',
    ];
    for (const sel of selectors) {
      const matches = document.querySelectorAll(sel);
      for (const el of matches) {
        if (isVisible(el)) return el;
      }
    }
    return null;
  }

  function findComposerContainer() {
    const input = findComposerInput();
    if (!input) return null;
    const candidates = [
      input.closest('[data-type="unified-composer"]'),
      input.closest('form[data-type="unified-composer"]'),
      input.closest("form"),
      input.closest('[class*="composer"]'),
      input.closest("fieldset"),
      input.parentElement?.parentElement,
      input,
    ];
    for (const el of candidates) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 240 && r.height >= 34 && r.height <= 420 && r.top > 40) {
        return el;
      }
    }
    return input;
  }

  function readInputText(el) {
    if (!el) return "";
    if ("value" in el && typeof el.value === "string") {
      return el.value.trim();
    }
    return (el.innerText || el.textContent || "").trim();
  }

  function getUserMessageElements() {
    const els = document.querySelectorAll(
      '[data-message-author-role="user"], [data-testid="user-message"], user-query'
    );
    return Array.from(els);
  }

  function collectPageContext() {
    const nodes = document.querySelectorAll(
      '[data-message-author-role], [data-testid="user-message"], .font-claude-message, message-content'
    );
    const tail = Array.from(nodes).slice(-3);
    return tail
      .map((n) => (n.innerText || "").replace(/\s+/g, " ").trim().slice(0, 260))
      .filter(Boolean)
      .join("\n");
  }

  function insertIntoComposer(text) {
    const input = findComposerInput();
    if (!input || !text) return;
    input.focus();
    if ("value" in input && (input.tagName === "TEXTAREA" || input.tagName === "INPUT")) {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
      if (proto && proto.set) {
        proto.set.call(input, text);
      } else {
        input.value = text;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (input.isContentEditable) {
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      } catch (_) {
        input.textContent = text;
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
      }
    }
  }

  // ---------------- Shadow DOM Light-Theme Bubble ----------------

  function ensureShadowHost() {
    if (hostEl && document.documentElement.contains(hostEl)) return;
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    hostEl.style.cssText =
      "position:fixed;z-index:2147483000;pointer-events:none;left:0;bottom:0;margin:0;padding:0;will-change:width,left,bottom;";
    document.documentElement.appendChild(hostEl);
    shadow = hostEl.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
      }
      * { box-sizing: border-box; }

      .ws-wrap {
        pointer-events: auto;
        width: 100%;
        transform-origin: left bottom;
      }

      /* Silky Apple / Linear motion curves */
      @keyframes wsAppear {
        0% {
          opacity: 0;
          transform: translate3d(0, 12px, 0) scale(0.962);
          filter: blur(4px);
        }
        60% {
          opacity: 1;
          filter: blur(0px);
        }
        100% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0px);
        }
      }

      @keyframes wsRowCascade {
        0% {
          opacity: 0;
          transform: translate3d(0, 6px, 0);
        }
        100% {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
      }

      @keyframes wsExpandIn {
        0% {
          opacity: 0.72;
          transform: translate3d(0, 8px, 0) scale(0.978);
        }
        100% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
      }

      @keyframes wsFoldIn {
        0% {
          opacity: 0.75;
          transform: translate3d(0, -5px, 0) scale(0.985);
        }
        100% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
      }

      @keyframes wsContentBloom {
        0% {
          opacity: 0;
          transform: translate3d(0, 6px, 0);
        }
        100% {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
      }

      @keyframes wsExitMist {
        0% {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0px);
        }
        100% {
          opacity: 0;
          transform: translate3d(0, 8px, 0) scale(0.965);
          filter: blur(3px);
        }
      }

      @keyframes wsPulseOk {
        0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.28); }
        100% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
      }

      .ws-bubble {
        position: relative;
        transform-origin: left bottom;
        background: rgba(255, 255, 255, 0.94);
        backdrop-filter: blur(18px) saturate(1.25);
        -webkit-backdrop-filter: blur(18px) saturate(1.25);
        border: 1px solid rgba(226, 232, 240, 0.95);
        border-radius: 15px;
        box-shadow:
          0 10px 28px -8px rgba(15, 23, 42, 0.10),
          0 2px 6px rgba(15, 23, 42, 0.04),
          inset 0 1px 0 rgba(255, 255, 255, 0.9);
        color: #0f172a;
        font-size: 13px;
        line-height: 1.55;
        overflow: hidden;
        transition:
          border-color 220ms ease,
          box-shadow 260ms cubic-bezier(0.16, 1, 0.3, 1),
          background 220ms ease;
      }

      .ws-bubble.anim-appear {
        animation: wsAppear 380ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .ws-bubble.anim-expand {
        animation: wsExpandIn 300ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .ws-bubble.anim-collapse {
        animation: wsFoldIn 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }

      .ws-bubble.is-closing {
        animation: wsExitMist 190ms cubic-bezier(0.4, 0, 1, 1) forwards;
        pointer-events: none;
      }

      .ws-bubble.is-expanded {
        background: rgba(255, 255, 255, 0.985);
        border-color: rgba(203, 213, 225, 0.95);
        box-shadow:
          0 18px 42px -10px rgba(15, 23, 42, 0.14),
          0 4px 12px -2px rgba(15, 23, 42, 0.05),
          inset 0 1px 0 rgba(255, 255, 255, 0.95);
      }

      /* Collapsed state: ZERO top header text — only 1~2 question rows + quiet corner × */
      .ws-compact {
        display: flex;
        align-items: flex-start;
        gap: 4px;
        padding: 7px 6px 7px 8px;
      }
      .ws-list {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .ws-close-corner {
        flex-shrink: 0;
        appearance: none;
        border: none;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        width: 22px;
        height: 22px;
        margin-top: 5px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: inherit;
        opacity: 0.72;
        transition: background 160ms ease, color 160ms ease, opacity 160ms ease, transform 160ms ease;
      }
      .ws-close-corner:hover {
        background: #f1f5f9;
        color: #0f172a;
        opacity: 1;
      }
      .ws-close-corner:active {
        transform: scale(0.9);
      }

      .ws-ibtn {
        appearance: none; border: none; background: transparent; color: #64748b;
        cursor: pointer; font-size: 12px; line-height: 1; padding: 4px 7px;
        border-radius: 8px; font-family: inherit;
        transition: background 160ms ease, color 160ms ease, transform 140ms ease;
      }
      .ws-ibtn:hover { background: #f1f5f9; color: #0f172a; }
      .ws-ibtn:active { transform: scale(0.95); }

      .ws-row {
        appearance: none; width: 100%; text-align: left;
        display: flex; align-items: center; gap: 8px;
        padding: 7.5px 10px;
        background: rgba(248, 250, 252, 0.88);
        border: 1px solid rgba(226, 232, 240, 0.9);
        border-radius: 10px; cursor: pointer; color: #0f172a;
        font-family: inherit; font-size: 12.8px;
        transition:
          background 180ms ease,
          border-color 180ms ease,
          box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1),
          transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .ws-bubble.anim-appear .ws-row {
        opacity: 0;
        animation: wsRowCascade 320ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .ws-bubble.anim-appear .ws-row:nth-child(1) { animation-delay: 45ms; }
      .ws-bubble.anim-appear .ws-row:nth-child(2) { animation-delay: 110ms; }

      .ws-row:hover {
        background: #ffffff;
        transform: translate3d(0, -1px, 0);
      }
      .ws-row:active {
        transform: translate3d(0, 0, 0) scale(0.99);
      }
      .ws-row.is-wild:hover {
        border-color: rgba(245, 158, 11, 0.55);
        box-shadow: 0 4px 12px -4px rgba(245, 158, 11, 0.16);
      }
      .ws-row.is-quiz:hover {
        border-color: rgba(14, 165, 233, 0.55);
        box-shadow: 0 4px 12px -4px rgba(14, 165, 233, 0.16);
      }
      .ws-badge {
        flex-shrink: 0; font-size: 10.5px; font-weight: 600;
        padding: 1.5px 7px; border-radius: 999px; line-height: 1.35;
        transition: transform 180ms ease;
      }
      .ws-badge.wild { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
      .ws-badge.quiz { background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }
      .ws-rtitle {
        flex: 1; min-width: 0; font-weight: 500; color: #0f172a;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ws-chev {
        flex-shrink: 0; color: #94a3b8; font-size: 15px; line-height: 1;
        transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms ease;
      }
      .ws-row:hover .ws-chev {
        color: #334155;
        transform: translateX(2.5px);
      }

      /* Expanded state */
      .ws-exp { padding: 12px 14px; }
      .ws-exp-body.anim-tab {
        animation: wsContentBloom 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      .ws-top {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; margin-bottom: 10px;
      }
      .ws-tabs { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .ws-tab {
        appearance: none; border: 1px solid transparent; background: transparent;
        color: #64748b; font-family: inherit; font-size: 12px; font-weight: 500;
        padding: 4px 11px; border-radius: 999px; cursor: pointer;
        transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .ws-tab:hover { background: #f1f5f9; color: #0f172a; }
      .ws-tab:active { transform: scale(0.96); }
      .ws-tab.active.wild {
        background: #fef3c7; color: #b45309; border-color: #fde68a; font-weight: 600;
      }
      .ws-tab.active.quiz {
        background: #e0f2fe; color: #0369a1; border-color: #bae6fd; font-weight: 600;
      }
      .ws-actions { display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0; }
      .ws-qbox {
        appearance: none; width: 100%; text-align: left;
        background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px;
        padding: 9px 12px; margin-bottom: 10px;
        color: #0f172a; font-family: inherit; font-size: 13.5px; font-weight: 600;
        line-height: 1.5; cursor: pointer;
        transition: background 160ms ease, border-color 160ms ease;
      }
      .ws-qbox:hover { background: #f1f5f9; border-color: #cbd5e1; }
      .ws-opts { display: flex; flex-direction: column; gap: 6px; margin-bottom: 9px; }
      .ws-opt {
        appearance: none; width: 100%; text-align: left;
        display: flex; align-items: flex-start; gap: 8px;
        padding: 8px 11px; background: #ffffff; border: 1px solid #e5e7eb;
        border-radius: 9px; color: #334155; font-family: inherit;
        font-size: 12.8px; line-height: 1.45; cursor: pointer;
        transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .ws-opt:not(:disabled):hover {
        background: #f0f9ff; border-color: #7dd3fc; color: #0f172a;
        transform: translate3d(2px, 0, 0);
      }
      .ws-opt:not(:disabled):active { transform: scale(0.99); }
      .ws-opt:disabled { cursor: default; }
      .ws-opt.ok { background: #ecfdf5; border-color: #10b981; color: #047857; font-weight: 500; }
      .ws-opt.ok.just-picked { animation: wsPulseOk 520ms cubic-bezier(0.16, 1, 0.3, 1); }
      .ws-opt.err { background: #fef2f2; border-color: #f87171; color: #b91c1c; }
      .ws-opt.dim { opacity: 0.58; }
      .ws-opt-k { font-weight: 600; flex-shrink: 0; }

      .ws-verdict { font-size: 12px; font-weight: 600; margin: 2px 0 8px 2px; }
      .ws-verdict.ok { color: #047857; }
      .ws-verdict.warn { color: #b45309; }
      .ws-verdict.anim-bloom,
      .ws-ans.anim-bloom {
        animation: wsContentBloom 280ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .ws-skip { display: flex; justify-content: flex-end; margin-bottom: 4px; }
      .ws-lbtn {
        appearance: none; border: none; background: transparent; color: #64748b;
        font-family: inherit; font-size: 12px; cursor: pointer; padding: 3px 7px;
        border-radius: 7px; transition: all 160ms ease;
      }
      .ws-lbtn:hover { color: #0369a1; background: #f1f5f9; }
      .ws-lbtn:active { transform: scale(0.96); }

      .ws-ans {
        color: #334155; font-size: 13px; line-height: 1.68;
        padding: 2px 2px 4px 2px; max-height: 250px; overflow-y: auto;
      }
      .ws-ans::-webkit-scrollbar { width: 5px; }
      .ws-ans::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
      .ws-ans p { margin: 0 0 8px 0; }
      .ws-ans p:last-child { margin-bottom: 0; }
      .ws-ans strong { color: #0f172a; font-weight: 600; }
      .ws-ans code {
        font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 11.8px;
        background: #f1f5f9; color: #0369a1; padding: 1px 5px; border-radius: 5px;
      }
      .ws-foot {
        display: flex; align-items: center; justify-content: space-between;
        border-top: 1px solid #f1f5f9; margin-top: 10px; padding-top: 8px;
      }

      @media (prefers-reduced-motion: reduce) {
        .ws-bubble, .ws-row, .ws-exp-body, .ws-verdict, .ws-ans, .ws-opt {
          animation: none !important;
          transition: none !important;
        }
      }
    `;
    shadow.appendChild(style);
    containerEl = document.createElement("div");
    containerEl.className = "ws-wrap";
    shadow.appendChild(containerEl);
  }

  function repositionAboveComposer() {
    if (!hostEl || state.view === "hidden") return;
    const composer = findComposerContainer();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const expanded = state.view === "expanded";
    const targetMax = expanded ? 560 : 440;

    // Enable smooth geometry gliding only after the initial placement so it never flies across screen
    if (state.placedOnce) {
      hostEl.style.transition =
        "width 260ms cubic-bezier(0.16, 1, 0.3, 1), left 220ms cubic-bezier(0.16, 1, 0.3, 1), bottom 220ms cubic-bezier(0.16, 1, 0.3, 1)";
    } else {
      hostEl.style.transition = "none";
    }

    if (composer) {
      const rect = composer.getBoundingClientRect();
      if (rect.width > 180 && rect.height > 20 && rect.bottom <= vh + 40) {
        const width = Math.max(290, Math.min(targetMax, rect.width));
        let left = rect.left;
        if (left + width > vw - 14) left = vw - width - 14;
        left = Math.max(14, left);

        let bottom = vh - rect.top + 10;
        bottom = Math.max(76, Math.min(vh - 110, bottom));

        hostEl.style.width = `${Math.round(width)}px`;
        hostEl.style.left = `${Math.round(left)}px`;
        hostEl.style.bottom = `${Math.round(bottom)}px`;
        state.placedOnce = true;
        return;
      }
    }

    const width = Math.min(targetMax, vw - 28);
    hostEl.style.width = `${Math.round(width)}px`;
    hostEl.style.left = `${Math.round((vw - width) / 2)}px`;
    hostEl.style.bottom = "108px";
    state.placedOnce = true;
  }

  function scheduleReposition() {
    if (anchorRaf) cancelAnimationFrame(anchorRaf);
    anchorRaf = requestAnimationFrame(() => {
      anchorRaf = 0;
      repositionAboveComposer();
    });
  }

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMdLite(md) {
    return String(md || "")
      .trim()
      .split(/\n{2,}/)
      .filter((b) => b.trim())
      .map((block) => {
        const html = escHtml(block.trim())
          .replace(/^#+\s+/gm, "")
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
          .replace(/`([^`]+)`/g, "<code>$1</code>")
          .replace(/^[-*]\s+/gm, "• ")
          .replace(/\n/g, "<br/>");
        return `<p>${html}</p>`;
      })
      .join("");
  }

  function closeGracefully() {
    if (!containerEl || state.view === "hidden") return;
    const bubble = containerEl.querySelector(".ws-bubble");
    if (bubble) {
      bubble.classList.remove("anim-appear", "anim-expand", "anim-collapse");
      bubble.classList.add("is-closing");
      clearTimeout(state.closingTimer);
      state.closingTimer = setTimeout(() => {
        state.view = "hidden";
        state.placedOnce = false;
        if (hostEl) hostEl.style.display = "none";
      }, 190);
    } else {
      state.view = "hidden";
      state.placedOnce = false;
      if (hostEl) hostEl.style.display = "none";
    }
  }

  function renderBubble(transition = "none") {
    clearTimeout(state.closingTimer);
    if (state.view === "hidden" || !state.cards.length) {
      state.placedOnce = false;
      if (hostEl) hostEl.style.display = "none";
      return;
    }

    ensureShadowHost();
    hostEl.style.display = "block";
    // Compute exact coordinates BEFORE animating appear so it blooms straight upward in place
    if (transition === "appear") {
      state.placedOnce = false;
      repositionAboveComposer();
    }

    if (state.view === "collapsed") {
      const animCls =
        transition === "appear"
          ? "anim-appear"
          : transition === "collapse"
          ? "anim-collapse"
          : "";
      const rows = state.cards
        .map((c, idx) => {
          const isWild = c.mode === "wild";
          const tag = isWild ? "灵感" : "查漏";
          return `
            <button type="button" class="ws-row ${isWild ? "is-wild" : "is-quiz"}" data-act="expand" data-idx="${idx}">
              <span class="ws-badge ${isWild ? "wild" : "quiz"}">${tag}</span>
              <span class="ws-rtitle">${escHtml(c.title)}</span>
              <span class="ws-chev" aria-hidden="true">›</span>
            </button>
          `;
        })
        .join("");

      containerEl.innerHTML = `
        <div class="ws-bubble ${animCls}">
          <div class="ws-compact">
            <div class="ws-list">${rows}</div>
            <button type="button" class="ws-close-corner" data-act="close" title="关闭">×</button>
          </div>
        </div>
      `;
    } else {
      const idx = Math.max(0, Math.min(state.cards.length - 1, state.activeIdx));
      const card = state.cards[idx];
      const isQuiz = card.kind === "quiz" && Array.isArray(card.options) && card.options.length >= 2;
      const chosen = state.selectedOption[idx];
      const revealed = Boolean(state.answerRevealed[idx] || !isQuiz);

      const bubbleAnimCls = transition === "expand" ? "anim-expand" : "";
      const bodyAnimCls = transition === "tab" ? "anim-tab" : "";
      const revealBloomCls =
        transition === "reveal" || transition === "pick" ? "anim-bloom" : "";

      const tabsHtml = state.cards
        .map((c, i) => {
          const isWild = c.mode === "wild";
          const label = isWild ? "灵感" : "查漏";
          return `<button type="button" class="ws-tab ${i === idx ? "active" : ""} ${isWild ? "wild" : "quiz"}" data-act="tab" data-idx="${i}">${label}</button>`;
        })
        .join("");

      let quizHtml = "";
      if (isQuiz) {
        const optsHtml = card.options
          .map((opt, oi) => {
            const L = LETTERS[oi] || String(oi + 1);
            let cls = "";
            let pre = `${L}.`;
            if (chosen !== undefined) {
              if (oi === card.correct_index) {
                cls = transition === "pick" ? "ok just-picked" : "ok";
                pre = `✓ ${L}.`;
              } else if (oi === chosen) {
                cls = "err";
                pre = `✗ ${L}.`;
              } else {
                cls = "dim";
              }
            }
            return `
              <button type="button" class="ws-opt ${cls}" data-act="pick" data-opt="${oi}" ${chosen !== undefined ? "disabled" : ""}>
                <span class="ws-opt-k">${pre}</span>
                <span>${escHtml(opt)}</span>
              </button>
            `;
          })
          .join("");

        let tailHtml = "";
        if (chosen !== undefined) {
          const ok = chosen === card.correct_index;
          const corrL = LETTERS[card.correct_index] || "?";
          tailHtml = `<div class="ws-verdict ${ok ? "ok" : "warn"} ${revealBloomCls}">${
            ok ? "✓ 精准命中直觉" : `· 思路接近，正解是 ${corrL}`
          }</div>`;
        } else if (!revealed) {
          tailHtml = `<div class="ws-skip"><button type="button" class="ws-lbtn" data-act="reveal">跳过作答，直接看详解 ↓</button></div>`;
        }
        quizHtml = `<div class="ws-opts">${optsHtml}</div>${tailHtml}`;
      }

      const ansHtml = revealed
        ? `<div class="ws-ans ${revealBloomCls}">${renderMdLite(card.answer || "点击右下角「填入聊天框追问 ↗」即可围绕此问题展开深聊。")}</div>`
        : "";

      containerEl.innerHTML = `
        <div class="ws-bubble is-expanded ${bubbleAnimCls}">
          <div class="ws-exp">
            <div class="ws-top">
              <div class="ws-tabs">${tabsHtml}</div>
              <div class="ws-actions">
                <button type="button" class="ws-ibtn" data-act="collapse" title="单击折叠收起">收起 ▾</button>
                <button type="button" class="ws-ibtn" data-act="close" title="关闭">×</button>
              </div>
            </div>
            <div class="ws-exp-body ${bodyAnimCls}">
              <button type="button" class="ws-qbox" data-act="collapse" title="单击折叠收起">${escHtml(card.question)}</button>
              ${quizHtml}
              ${ansHtml}
            </div>
            <div class="ws-foot">
              <button type="button" class="ws-lbtn" data-act="collapse">▾ 折叠收起</button>
              <button type="button" class="ws-lbtn" data-act="followup">填入聊天框追问 ↗</button>
            </div>
          </div>
        </div>
      `;
    }

    containerEl.querySelectorAll("[data-act]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = el.getAttribute("data-act");
        if (act === "expand") {
          state.activeIdx = Number(el.getAttribute("data-idx") || 0);
          state.view = "expanded";
          renderBubble("expand");
        } else if (act === "tab") {
          const nextIdx = Number(el.getAttribute("data-idx") || 0);
          if (nextIdx !== state.activeIdx) {
            state.activeIdx = nextIdx;
            renderBubble("tab");
          }
        } else if (act === "collapse") {
          state.view = "collapsed";
          renderBubble("collapse");
        } else if (act === "close") {
          closeGracefully();
        } else if (act === "pick") {
          state.selectedOption[state.activeIdx] = Number(el.getAttribute("data-opt"));
          state.answerRevealed[state.activeIdx] = true;
          renderBubble("pick");
        } else if (act === "reveal") {
          state.answerRevealed[state.activeIdx] = true;
          renderBubble("reveal");
        } else if (act === "followup") {
          const cur = state.cards[state.activeIdx];
          if (cur) {
            insertIntoComposer(cur.follow_up_prompt || cur.question || cur.title);
            state.view = "collapsed";
            renderBubble("collapse");
          }
        }
      });
    });

    if (transition !== "appear") {
      scheduleReposition();
    }
    setTimeout(scheduleReposition, 280);
  }

  // ---------------- Trigger Flow (WaitChatter `i sent`, 4-way detection) ----------------

  function triggerSilentThinking(promptText, { forceDemo = false, reason = "" } = {}) {
    const text = String(promptText || "").trim();
    if (!forceDemo && text.length < 1) return;

    const now = Date.now();
    if (
      !forceDemo &&
      now - state.lastSentAt < 2500 &&
      (text === state.lastSentText || state.lastSentText.includes(text) || text.includes(state.lastSentText))
    ) {
      return;
    }
    state.lastSentText = text;
    state.lastSentAt = now;
    state.lastDraftText = "";

    const seq = ++state.requestSeq;
    state.view = "hidden";
    renderBubble("none");

    const context = collectPageContext();
    try {
      chrome.runtime.sendMessage(
        {
          type: "WAITSPARK_GENERATE",
          prompt: text || "当前对话技术主题",
          context,
          forceDemo,
        },
        (res) => {
          if (chrome.runtime.lastError || seq !== state.requestSeq) return;
          if (!res || res.skipped || !res.ok || !Array.isArray(res.cards) || !res.cards.length) {
            return;
          }
          state.cards = res.cards.slice(0, 2);
          state.topic = res.topic || "";
          state.activeIdx = 0;
          state.selectedOption = {};
          state.answerRevealed = {};
          state.cards.forEach((c, i) => {
            if (c.kind !== "quiz") state.answerRevealed[i] = true;
          });
          state.view = "collapsed";
          renderBubble("appear");
        }
      );
    } catch (_) {}
  }

  function isSendButton(target) {
    const btn = target?.closest?.("button");
    if (!btn || btn.disabled) return false;
    const id = (btn.id || "").toLowerCase();
    const testId = (btn.getAttribute("data-testid") || "").toLowerCase();
    const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (id.includes("composer-submit") || id.includes("send")) return true;
    if (testId.includes("send") || testId.includes("submit")) return true;
    if (aria.includes("send") || aria.includes("发送") || aria.includes("提交")) return true;
    if (btn.type === "submit" && btn.closest("form")) return true;
    return false;
  }

  document.addEventListener(
    "input",
    (e) => {
      const input = findComposerInput();
      if (input && (e.target === input || input.contains(e.target))) {
        const txt = readInputText(input);
        if (txt) state.lastDraftText = txt;
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing || e.keyCode === 229) return;
      const input = findComposerInput();
      if (!input) return;
      if (e.target === input || input.contains(e.target)) {
        const text = readInputText(input) || state.lastDraftText;
        if (text.length >= 1) {
          triggerSilentThinking(text, { reason: "keydown-enter" });
        }
      }
    },
    true
  );

  function handlePotentialSendClick(e) {
    if (!isSendButton(e.target)) return;
    const input = findComposerInput();
    const text = readInputText(input) || state.lastDraftText;
    if (text.length >= 1) {
      triggerSilentThinking(text, { reason: "send-button" });
    }
  }
  document.addEventListener("pointerdown", handlePotentialSendClick, true);
  document.addEventListener("click", handlePotentialSendClick, true);

  document.addEventListener(
    "submit",
    (e) => {
      const input = findComposerInput();
      if (input && e.target?.contains?.(input)) {
        const text = readInputText(input) || state.lastDraftText;
        if (text.length >= 1) {
          triggerSilentThinking(text, { reason: "form-submit" });
        }
      }
    },
    true
  );

  state.seenUserCount = getUserMessageElements().length;

  function checkNewDomUserMessage() {
    const curUrl = location.href;
    if (curUrl !== state.lastUrl) {
      const wasHomepage = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\/?(\?.*)?$/.test(state.lastUrl);
      state.lastUrl = curUrl;
      state.navigatedAt = Date.now();
      if (!wasHomepage) {
        state.view = "hidden";
        renderBubble("none");
        state.seenUserCount = getUserMessageElements().length;
        return;
      }
    }

    const userEls = getUserMessageElements();
    const count = userEls.length;
    if (count > state.seenUserCount) {
      const delta = count - state.seenUserCount;
      state.seenUserCount = count;
      const isFreshNav = Date.now() - state.navigatedAt < 1200 && delta > 1;
      if (!isFreshNav && delta === 1) {
        const latestEl = userEls[userEls.length - 1];
        const msgText = (latestEl?.innerText || "").trim();
        if (msgText.length >= 1) {
          triggerSilentThinking(msgText, { reason: "dom-user-turn" });
        }
      }
    } else if (count < state.seenUserCount) {
      state.seenUserCount = count;
    }
  }

  window.addEventListener("resize", scheduleReposition, { passive: true });
  window.addEventListener("scroll", scheduleReposition, { passive: true, capture: true });

  let domCheckTimer = 0;
  const mo = new MutationObserver(() => {
    if (state.view !== "hidden") scheduleReposition();
    if (!domCheckTimer) {
      domCheckTimer = setTimeout(() => {
        domCheckTimer = 0;
        checkNewDomUserMessage();
      }, 150);
    }
  });
  if (document.body) {
    mo.observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "WAITSPARK_PREVIEW_NOW") {
      const input = findComposerInput();
      const draft =
        readInputText(input) ||
        state.lastDraftText ||
        collectPageContext().slice(0, 80) ||
        "MuJoCo 接触摩擦与柔性杆体仿真";
      triggerSilentThinking(draft, { forceDemo: Boolean(msg.forceDemo), reason: "popup-preview" });
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
})();
