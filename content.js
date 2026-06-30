// Content script - runs on ChatGPT and Claude pages

let lastProcessedText = "";
let debounceTimer = null;
let enhanceButton = null;
let currentChatKey = null;
let hasBackfilled = false;

// ─── Detect which site we're on ───────────────────────────────────────────────

function getSite() {
  const host = window.location.hostname;
  if (host.includes("claude.ai")) return "claude";
  if (host.includes("openai.com") || host.includes("chatgpt.com")) return "chatgpt";
  return null;
}

// ─── Get a stable key for the current chat (per-conversation context) ────────

function getChatKey() {
  // Use the URL path (e.g. /chat/abc123 or /c/abc123) as the unique chat id.
  // Falls back to "new-chat" if no id is present yet (chat not started).
  const path = window.location.pathname;
  const match = path.match(/\/(chat|c)\/([a-zA-Z0-9-]+)/);
  if (match) return `ctx:${getSite()}:${match[2]}`;
  return `ctx:${getSite()}:new-chat`;
}

function getStorageKeyForChat(key) {
  return key;
}

// ─── Get all user/AI message nodes ────────────────────────────────────────────

function getAllUserMessages() {
  const site = getSite();
  let nodes = [];

  if (site === "chatgpt") {
    nodes = document.querySelectorAll('[data-message-author-role="user"]');
  } else if (site === "claude") {
    nodes = document.querySelectorAll('[data-testid="user-message"]');
    if (!nodes.length) nodes = document.querySelectorAll('[class*="human-turn"]');
    if (!nodes.length) nodes = document.querySelectorAll('div[class*="pb-"][class*="human"]');
  }
  return Array.from(nodes);
}

function getAllAIMessages() {
  const site = getSite();
  let nodes = [];

  if (site === "chatgpt") {
    nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
  } else if (site === "claude") {
    nodes = document.querySelectorAll('div[class*="pb-"][class*="group"]');
    nodes = Array.from(nodes).filter(el =>
      el.querySelector('p, li, pre, code, h1, h2, h3') !== null
    );
    if (!nodes.length) nodes = document.querySelectorAll('[data-testid="assistant-message"]');
  }
  return Array.from(nodes);
}

function getLastUserMessage() {
  const nodes = getAllUserMessages();
  if (!nodes.length) return "";
  return nodes[nodes.length - 1].innerText.trim();
}

function getLastAIMessage() {
  const nodes = getAllAIMessages();
  if (!nodes.length) return "";
  return nodes[nodes.length - 1].innerText.trim();
}

// ─── Build a full transcript from the whole visible chat (for backfill) ──────

function getFullTranscript() {
  const users = getAllUserMessages();
  const ais = getAllAIMessages();
  const total = Math.max(users.length, ais.length);
  let transcript = [];

  for (let i = 0; i < total; i++) {
    if (users[i]) transcript.push(`User: ${users[i].innerText.trim()}`);
    if (ais[i]) transcript.push(`AI: ${ais[i].innerText.trim()}`);
  }
  // Cap to last ~12000 chars to keep token usage sane on long chats
  let joined = transcript.join("\n\n");
  if (joined.length > 12000) {
    joined = joined.slice(joined.length - 12000);
  }
  return joined;
}

// ─── Get input box ────────────────────────────────────────────────────────────

function getInputBox() {
  const site = getSite();

  if (site === "chatgpt") {
    return document.querySelector('#prompt-textarea') ||
           document.querySelector('[data-id="root"]') ||
           document.querySelector('div[contenteditable="true"]');
  } else if (site === "claude") {
    return document.querySelector('div[contenteditable="true"]') ||
           document.querySelector('.ProseMirror');
  }
  return null;
}

// ─── Set text in input box ────────────────────────────────────────────────────

function setInputText(text) {
  const input = getInputBox();
  if (!input) return;

  input.focus();

  if (input.getAttribute("contenteditable") === "true") {
    input.innerText = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  nativeInputValueSetter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ─── Storage helpers (per-chat context) ───────────────────────────────────────

async function getContextForCurrentChat() {
  const key = getChatKey();
  const stored = await chrome.storage.local.get(key);
  return stored[key] || "";
}

async function setContextForCurrentChat(text) {
  const key = getChatKey();
  await chrome.storage.local.set({ [key]: text });
  // Also mirror to "contextDoc" so the popup (which watches that key) shows the active chat's context
  await chrome.storage.local.set({ contextDoc: text, activeContextKey: key });
}

// ─── Backfill: build context from existing chat history if none exists ───────

async function backfillContextIfNeeded() {
  if (hasBackfilled) return;
  const existing = await getContextForCurrentChat();
  if (existing && existing.trim().length > 0) {
    hasBackfilled = true;
    // make sure popup mirror is in sync even if we didn't generate anything new
    chrome.storage.local.set({ contextDoc: existing, activeContextKey: getChatKey() });
    return;
  }

  const transcript = getFullTranscript();
  if (!transcript || transcript.trim().length < 20) {
    // Nothing to summarize yet (empty/new chat)
    hasBackfilled = true;
    chrome.storage.local.set({ contextDoc: "", activeContextKey: getChatKey() });
    return;
  }

  console.log("[Contextualize] No saved context for this chat — building from existing history...");

  chrome.runtime.sendMessage({
    action: "buildContextFromTranscript",
    transcript
  }, async (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.success) {
      await setContextForCurrentChat(response.context);
      console.log("[Contextualize] Backfilled context from chat history.");
    }
  });

  hasBackfilled = true;
}

// ─── Trigger context update after AI reply ────────────────────────────────────

async function triggerContextUpdate() {
  const userMsg = getLastUserMessage();
  const aiMsg = getLastAIMessage();

  if (!aiMsg || aiMsg === lastProcessedText) return;
  lastProcessedText = aiMsg;

  console.log("[Contextualize] New message detected, updating context...");

  const currentContext = await getContextForCurrentChat();

  chrome.runtime.sendMessage({
    action: "updateContext",
    exchange: { userMessage: userMsg, aiMessage: aiMsg },
    currentContext
  }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.success) {
      setContextForCurrentChat(response.context);
    }
  });
}

// ─── Inject Enhance button near input ────────────────────────────────────────

function injectEnhanceButton() {
  if (enhanceButton && document.contains(enhanceButton)) return;

  const input = getInputBox();
  if (!input) return;

  enhanceButton = document.createElement("button");
  enhanceButton.id = "contextualize-enhance-btn";
  enhanceButton.innerText = "⚡ Enhance";
  enhanceButton.title = "Add session context to your prompt (keeps your wording intact)";

  enhanceButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const input = getInputBox();
    if (!input) return;

    const rawPrompt = input.innerText || input.value || "";
    if (!rawPrompt.trim()) {
      alert("Type something in the chat box first.");
      return;
    }

    enhanceButton.innerText = "⏳ Enhancing...";
    enhanceButton.disabled = true;

    const currentContext = await getContextForCurrentChat();

    chrome.runtime.sendMessage({
      action: "enhancePrompt",
      rawPrompt,
      currentContext
    }, (response) => {
      enhanceButton.innerText = "⚡ Enhance";
      enhanceButton.disabled = false;

      if (chrome.runtime.lastError) return;

      if (response && response.success) {
        setInputText(response.enhanced);
      } else {
        alert("Error: " + (response?.error || "Unknown error"));
      }
    });
  });

  const parent = input.closest("form") || input.parentElement;
  if (parent) {
    parent.style.position = "relative";
    parent.appendChild(enhanceButton);
  }
}

// ─── Handle chat switching (URL change) ───────────────────────────────────────

function checkForChatSwitch() {
  const newKey = getChatKey();
  if (newKey !== currentChatKey) {
    console.log("[Contextualize] Chat switched:", currentChatKey, "->", newKey);
    currentChatKey = newKey;
    lastProcessedText = "";
    hasBackfilled = false;
    backfillContextIfNeeded();
  }
}

// ─── MutationObserver to watch for new AI messages + URL changes ─────────────

const observer = new MutationObserver(() => {
  checkForChatSwitch();

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    triggerContextUpdate();
    injectEnhanceButton();
  }, 2000);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Also poll for URL changes (covers SPA navigation that doesn't trigger DOM mutation immediately)
setInterval(checkForChatSwitch, 1500);

// ─── Listen for messages from popup ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "enhance") {
    const input = getInputBox();
    if (!input) {
      sendResponse({ success: false, error: "Input box not found" });
      return;
    }

    const rawPrompt = input.innerText || input.value || "";
    if (!rawPrompt.trim()) {
      sendResponse({ success: false, error: "Input box is empty" });
      return;
    }

    getContextForCurrentChat().then(currentContext => {
      chrome.runtime.sendMessage({
        action: "enhancePrompt",
        rawPrompt,
        currentContext
      }, (response) => {
        if (response && response.success) {
          setInputText(response.enhanced);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: response?.error });
        }
      });
    });

    return true;
  }

  if (message.action === "getActiveChatKey") {
    sendResponse({ key: getChatKey() });
    return true;
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

currentChatKey = getChatKey();
setTimeout(() => {
  injectEnhanceButton();
  backfillContextIfNeeded();
}, 2000);
