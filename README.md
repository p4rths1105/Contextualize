Contextualize

A Chrome extension that fixes context loss in long AI chats.

If you've ever had ChatGPT or Claude "forget" something you decided 20 messages ago, or start hallucinating outdated details mid-project — this is built for that.

What it does

Live Context Tracker — after every AI reply, the extension reads the exchange and updates a running context document for that specific conversation. Decisions, goals, and key facts stay fresh even in very long chats.

Prompt Enhancer — before you send a message, click ⚡ Enhance and it appends a relevant context briefing beneath your prompt. Your original wording is never touched — the briefing is generated and attached in code, not rewritten by the model.

Per-chat memory — context is saved separately for every conversation. Reopen an old chat and it automatically rebuilds context from the existing history if none is saved yet.

How it works


Runs as a content script on claude.ai and chat.openai.com
Uses Groq (free tier) for context extraction — fast and free for personal use
Everything is stored locally via chrome.storage.local — nothing leaves your browser except the API calls to Groq


Setup


Clone or download this repo
Go to chrome://extensions, enable Developer mode, click Load unpacked, select the folder
Get a free Groq API key at console.groq.com (no card required)
Click the extension icon, paste your key, hit Save
Open Claude or ChatGPT — you're set


Why

Long AI chats degrade. Context windows fill up, models lose track of earlier decisions, and you end up re-explaining yourself or catching hallucinated details. This is a lightweight fix that runs entirely client-side.

Contributing

Open to PRs, especially around:


Supporting more chat platforms (Gemini, Perplexity, etc.)
Smarter context merging logic
A shared backend option so users don't need their own API key


License

MIT
