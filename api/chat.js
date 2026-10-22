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

  const relayApiKey = process.env.AURA_RELAY_API_KEY;
  if (!relayApiKey) {
    return send(res, 503, { error: "AURA AI is not configured yet. The site owner must add AURA_RELAY_API_KEY in the Vercel project environment variables." });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
  if (!messages.length) return send(res, 400, { error: "Add a message before sending." });

  let totalChars = 0;
  const systemParts = [];
  const transcript = [];
  let hasUserMessage = false;
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
    if (item.role === "user") hasUserMessage = true;
    transcript.push((item.role === "assistant" ? "AURA" : "User") + ":\n" + content);
  }
  if (!hasUserMessage) return send(res, 400, { error: "A user message is required." });

  const relayBody = {
    prompt: "Respond to the latest user message using the conversation context. Be accurate, useful, and natural. Preserve Markdown formatting when it improves readability. Do not mention internal API providers or implementation details.",
    data: transcript.join("\n\n"),
    system: systemParts.join("\n\n") || "You are AURA, a thoughtful, capable personal AI. Be warm, clear, honest about uncertainty, and practical. Use headings, lists, code blocks, and tables when they improve readability.",
    json: false,
  };

  let upstream;
  try {
    upstream = await fetch("https://aura-replier.lovable.app/api/public/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": relayApiKey,
      },
      body: JSON.stringify(relayBody),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.error("AURA relay connection failed", { message: error instanceof Error ? error.message.slice(0, 160) : "network error" });
    return send(res, 502, { error: "AURA could not reach its AI service. Please try again shortly." });
  }

  const result = await upstream.json().catch(() => null);
  if (!upstream.ok || !result || result.ok !== true || typeof result.reply !== "string") {
    const relayError = typeof result?.error === "string" ? result.error : "upstream_error";
    console.error("AURA relay request rejected", { status: upstream.status, code: relayError });
    if (upstream.status === 401 || upstream.status === 403 || relayError === "invalid_api_key") {
      return send(res, 502, { error: "AURA AI authentication is not configured correctly. The site owner should check the relay API key." });
    }
    if (upstream.status === 402 || relayError === "ai_credits_exhausted") {
      return send(res, 503, { error: "AURA AI is temporarily out of service. Please try again later." });
    }
    if (upstream.status === 429) {
      res.setHeader("Retry-After", "30");
      return send(res, 429, { error: "AURA AI is receiving too many requests right now. Please wait and try again." });
    }
    if (upstream.status === 400 || relayError === "invalid_request") {
      return send(res, 502, { error: "AURA could not process that request. Please try rephrasing your message." });
    }
    if (upstream.status >= 500) {
      return send(res, 503, { error: "AURA AI is temporarily unavailable. Please retry in a moment." });
    }
    return send(res, 502, { error: "AURA received an unexpected response from its AI service. Please try again." });
  }

  // The frontend consumes plain-text streaming responses from this route.
  // Keep that contract stable while the relay itself returns JSON.
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(result.reply);
}
