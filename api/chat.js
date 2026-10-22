const DEFAULT_MODEL = "gemini-3.8-flash";
const AVAILABLE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
];
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 12000;
const MAX_TOTAL_CHARS = 50000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;
const requests = new Map();

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function getClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "unknown";
  return ip || "unknown";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Only POST requests are supported." });
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return send(res, 403, { error: "Cross-origin requests are not allowed." });
      }
    } catch {
      return send(res, 403, { error: "Invalid request origin." });
    }
  }

  const now = Date.now();
  const key = getClientKey(req);
  const entry = requests.get(key);
  if (entry && now - entry.start < WINDOW_MS && entry.count >= MAX_REQUESTS_PER_WINDOW) {
    res.setHeader("Retry-After", "60");
    return send(res, 429, { error: "Too many messages in a short time. Please wait a minute and try again." });
  }
  if (!entry || now - entry.start >= WINDOW_MS) requests.set(key, { start: now, count: 1 });
  else entry.count += 1;
  if (requests.size > 5000) {
    for (const [ip, record] of requests) {
      if (now - record.start >= WINDOW_MS) requests.delete(ip);
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return send(res, 503, { error: "AURA cloud AI is not configured yet. The site owner must add GEMINI_API_KEY in Vercel project settings." });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const requestedModel = typeof body.model === "string" && AVAILABLE_MODELS.includes(body.model)
    ? body.model
    : DEFAULT_MODEL;
  const candidateModels = [
    requestedModel,
    ...AVAILABLE_MODELS.filter((candidate) => candidate !== requestedModel),
  ];
  const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
  if (!messages.length) return send(res, 400, { error: "Add a message before sending." });

  let totalChars = 0;
  const systemParts = [];
  const contents = [];
  for (const item of messages) {
    if (!item || typeof item.content !== "string" || !["system", "user", "assistant"].includes(item.role)) continue;
    const content = item.content.trim();
    if (!content) continue;
    if (content.length > MAX_MESSAGE_CHARS) return send(res, 413, { error: "A message is too long. Please shorten it and try again." });
    totalChars += content.length;
    if (totalChars > MAX_TOTAL_CHARS) return send(res, 413, { error: "This conversation is too long for one request. Start a new chat or shorten the context." });
    if (item.role === "system") {
      systemParts.push(content);
      continue;
    }
    const role = item.role === "assistant" ? "model" : "user";
    const previous = contents[contents.length - 1];
    if (previous && previous.role === role) previous.parts[0].text += "\n\n" + content;
    else contents.push({ role, parts: [{ text: content }] });
  }

  if (!contents.some((item) => item.role === "user")) return send(res, 400, { error: "A user message is required." });
  while (contents.length && contents[0].role !== "user") contents.shift();
  if (!contents.length) return send(res, 400, { error: "A user message is required." });

  const requestBody = JSON.stringify({
    systemInstruction: systemParts.length ? { parts: [{ text: systemParts.join("\n\n") }] } : undefined,
    contents,
    generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
  });

  const deadline = Date.now() + 25_000;
  let lastStatus = 502;
  let lastMessage = "No provider error details were returned.";
  let sawRateLimit = false;
  let sawTimeout = false;

  for (const activeModel of candidateModels) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) break;

    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(activeModel) + ":streamGenerateContent?alt=sse";
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: requestBody,
        signal: AbortSignal.timeout(remaining),
      });

      if (!upstream.ok) {
        const result = await upstream.json().catch(() => ({}));
        lastStatus = upstream.status;
        lastMessage = typeof result.error?.message === "string" ? result.error.message.slice(0, 240) : "No provider error details were returned.";
        if (upstream.status === 429) sawRateLimit = true;
        console.error("AURA generation request failed", { status: upstream.status, code: result.error?.status ?? "unknown", message: lastMessage });
        if (![429, 500, 502, 503, 504, 404].includes(upstream.status)) break;
        continue;
      }

      if (!upstream.body) {
        lastStatus = 502;
        lastMessage = "The response stream was unavailable.";
        continue;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstText = "";
      let streamStarted = false;
      let gotText = false;
      const emitText = (text) => {
        if (!text) return;
        gotText = true;
        if (!streamStarted) {
          firstText += text;
          return;
        }
        if (!res.destroyed) res.write(text);
      };
      const processEvents = (final = false) => {
        const lines = buffer.split(/\r?\n/);
        buffer = final ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload);
            const parts = event.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) if (typeof part.text === "string") emitText(part.text);
          } catch {
            // Ignore malformed/incomplete SSE events; the next event may still be valid.
          }
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          processEvents();
          if (firstText && !streamStarted) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.flushHeaders?.();
            res.write(firstText);
            firstText = "";
            streamStarted = true;
          }
          if (res.destroyed) {
            await reader.cancel().catch(() => undefined);
            return;
          }
        }
        buffer += decoder.decode();
        processEvents(true);
        if (firstText && !streamStarted) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.setHeader("X-Accel-Buffering", "no");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.flushHeaders?.();
          res.write(firstText);
          streamStarted = true;
        }
        if (streamStarted && gotText) {
          if (!res.destroyed) res.end();
          return;
        }
        if (res.headersSent) {
          if (!res.destroyed) res.end();
          return;
        }
        lastStatus = 502;
        lastMessage = "The response was empty.";
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed) res.end();
        return;
      }
      lastStatus = 504;
      sawTimeout = true;
      lastMessage = error instanceof Error ? error.message.slice(0, 180) : "The request timed out.";
      console.error("AURA generation stream failed", { message: lastMessage });
    }
  }

  if (sawRateLimit) {
    return send(res, 429, {
      error: "The available Gemini models are rate-limited right now. Please wait a little and try again.",
      providerStatus: 429,
    });
  }
  if (lastStatus === 401 || lastStatus === 403) {
    return send(res, 502, { error: "Gemini denied access. Check that GEMINI_API_KEY is valid and enabled for the Gemini API.", providerStatus: lastStatus });
  }
  if (lastStatus === 404) {
    return send(res, 502, { error: "None of the configured Gemini models is available to this API key. Check model access in Google AI Studio.", providerStatus: 404 });
  }
  if (lastStatus >= 500 || sawTimeout) {
    return send(res, 502, { error: "Gemini is temporarily unavailable across the configured models. Please retry shortly.", providerStatus: lastStatus, providerMessage: lastMessage });
  }
  return send(res, 502, { error: "Gemini rejected the request. Check the selected model and message format.", providerStatus: lastStatus, providerMessage: lastMessage });
}
