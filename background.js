// Background service worker - handles Groq API calls

async function callGroq(messages) {
  const stored = await chrome.storage.local.get("groqApiKey");
  const apiKey = stored.groqApiKey || "";

  if (!apiKey || apiKey === "YOUR_GROQ_API_KEY_HERE") {
    throw new Error("No API key set. Open the extension popup and add your Groq API key.");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1500,
      messages: messages
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error: ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "buildContextFromTranscript") {
    const { transcript } = message;

    const messages = [
      {
        role: "system",
        content: `You are a context manager building an initial summary from an existing chat transcript.
Read the full transcript and produce a context document.
Rules:
- Use clear sections: Current Goal, Key Decisions, Important Context, Recent Changes
- Capture names, specific values, and decisions exactly as stated
- Keep it under 600 words
- Return ONLY the context document, no preamble or explanation`
      },
      {
        role: "user",
        content: `Chat transcript:
${transcript}

Produce the context document summarizing this conversation so far.`
      }
    ];

    callGroq(messages)
      .then(result => sendResponse({ success: true, context: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true;
  }

  if (message.action === "updateContext") {
    const { exchange, currentContext } = message;

    const messages = [
      {
        role: "system",
        content: `You are a context manager for an AI chat session. 
Given a new exchange and the existing context document, update the context document.
Rules:
- Replace outdated entries with new information
- Add new decisions, goals, or changes
- Remove things that are no longer relevant
- Keep it under 600 words
- Use clear sections: Current Goal, Key Decisions, Important Context, Recent Changes
- Return ONLY the updated context document, no preamble or explanation`
      },
      {
        role: "user",
        content: `Existing context document:
${currentContext || "Empty - this is the first exchange."}

New exchange:
User: ${exchange.userMessage}
AI: ${exchange.aiMessage}

Return the updated context document.`
      }
    ];

    callGroq(messages)
      .then(result => sendResponse({ success: true, context: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true; // keep channel open for async
  }

  if (message.action === "enhancePrompt") {
    const { rawPrompt, currentContext } = message;

    if (!currentContext || currentContext.trim().length === 0) {
      // No context yet — nothing to append, return prompt as-is.
      sendResponse({ success: true, enhanced: rawPrompt });
      return true;
    }

    const messages = [
      {
        role: "system",
        content: `You extract relevant background context for an AI assistant about to respond to a user's next message.
You are NOT writing to the user. You are writing a context briefing FOR the AI that will answer them.
Rules:
- Read the full session context document and the user's upcoming prompt
- Extract every fact, decision, constraint, name, number, or prior agreement from the context document that is relevant to answering this specific prompt well
- Do not compress aggressively or artificially limit length — include as much relevant detail as actually matters. A simple prompt may need 2 lines. A complex one may need 15-20 lines. Use your judgment based on relevance, not a fixed length.
- Do not include irrelevant background just because it exists in the context document
- Do not rewrite or comment on the user's prompt itself
- Write it as a clear briefing document, using short factual lines or bullet points, not prose paragraphs
- Return ONLY the context briefing, no preamble, no "Context:" label, no explanation`
      },
      {
        role: "user",
        content: `Full session context document:
${currentContext}

User's upcoming prompt (for relevance reference only — do not respond to it, do not modify it):
${rawPrompt}

Extract the relevant context briefing for the AI that will answer this prompt.`
      }
    ];

    callGroq(messages)
      .then(contextBriefing => {
        // Guarantee the user's original prompt is never altered — concatenation happens in code, not the model.
        const trimmedBriefing = contextBriefing.trim();
        const enhanced = trimmedBriefing
          ? `${rawPrompt}\n\n---\nContext for you (the AI) — not written by the user:\n${trimmedBriefing}`
          : rawPrompt;
        sendResponse({ success: true, enhanced });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true;
  }
});
