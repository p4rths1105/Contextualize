document.addEventListener("DOMContentLoaded", async () => {
  const apiKeyInput = document.getElementById("api-key-input");
  const saveKeyBtn = document.getElementById("save-key-btn");
  const keyStatus = document.getElementById("key-status");
  const contextTextarea = document.getElementById("context-doc");
  const saveBtn = document.getElementById("save-btn");
  const clearBtn = document.getElementById("clear-btn");
  const enhanceBtn = document.getElementById("enhance-btn");
  const enhanceStatus = document.getElementById("enhance-status");

  // ─── Load saved data ───────────────────────────────────────────────────────
  const stored = await chrome.storage.local.get(["contextDoc", "groqApiKey"]);
  contextTextarea.value = stored.contextDoc || "";
  if (stored.groqApiKey) {
    apiKeyInput.value = stored.groqApiKey;
    keyStatus.textContent = "✓ API key saved";
    keyStatus.className = "status-msg success";
  }

  // ─── Save API key ──────────────────────────────────────────────────────────
  saveKeyBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      keyStatus.textContent = "Please enter a key.";
      keyStatus.className = "status-msg error";
      return;
    }
    chrome.storage.local.set({ groqApiKey: key }, () => {
      keyStatus.textContent = "✓ Saved!";
      keyStatus.className = "status-msg success";
    });
  });

  // ─── Save context doc ──────────────────────────────────────────────────────
  saveBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.storage.local.set({ contextDoc: contextTextarea.value }, () => {
      saveBtn.textContent = "Saved!";
      setTimeout(() => (saveBtn.textContent = "Save"), 1200);
    });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: "getActiveChatKey" }, (resp) => {
        if (chrome.runtime.lastError || !resp) return;
        chrome.storage.local.set({ [resp.key]: contextTextarea.value });
      });
    }
  });

  // ─── Clear context doc ─────────────────────────────────────────────────────
  clearBtn.addEventListener("click", () => {
    if (confirm("Clear all context? This cannot be undone.")) {
      chrome.storage.local.set({ contextDoc: "" }, () => {
        contextTextarea.value = "";
      });
    }
  });

  // ─── Enhance prompt from popup ─────────────────────────────────────────────
  enhanceBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      enhanceStatus.textContent = "No active tab found.";
      enhanceStatus.className = "status-msg error";
      return;
    }

    const url = tab.url || "";
    const isSupportedSite = url.includes("chat.openai.com") || url.includes("chatgpt.com") || url.includes("claude.ai");

    if (!isSupportedSite) {
      enhanceStatus.textContent = "Open ChatGPT or Claude first.";
      enhanceStatus.className = "status-msg error";
      return;
    }

    enhanceBtn.textContent = "⏳ Enhancing...";
    enhanceBtn.disabled = true;
    enhanceStatus.textContent = "";

    chrome.tabs.sendMessage(tab.id, { action: "enhance" }, (response) => {
      enhanceBtn.textContent = "⚡ Enhance Current Prompt";
      enhanceBtn.disabled = false;

      if (chrome.runtime.lastError) {
        enhanceStatus.textContent = "Refresh the ChatGPT/Claude tab and try again.";
        enhanceStatus.className = "status-msg error";
        return;
      }

      if (response && response.success) {
        enhanceStatus.textContent = "✓ Prompt enhanced!";
        enhanceStatus.className = "status-msg success";
      } else {
        enhanceStatus.textContent = "Error: " + (response?.error || "Unknown");
        enhanceStatus.className = "status-msg error";
      }
    });
  });

  // ─── Auto-refresh context display every 2 seconds ─────────────────────────
  setInterval(async () => {
    const data = await chrome.storage.local.get("contextDoc");
    if (typeof data.contextDoc === "string" && data.contextDoc !== contextTextarea.value) {
      contextTextarea.value = data.contextDoc;
    }
  }, 2000);
});
