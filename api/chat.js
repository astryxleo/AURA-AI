const DEFAULT_MODEL = "gemini-3.8-flash";
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
  const model = typeof body.model === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(body.model)
    ? body.model
    : DEFAULT_MODEL;
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

  const candidateModels = [...new Set([model, "gemini-3.6-flash", "gemini-3.5-flash-lite"])];
  const requestBody = JSON.stringify({
    systemInstruction: systemParts.length ? { parts: [{ text: systemParts.join("\n\n") }] } : undefined,
    contents,
    generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
  });

  try {
    let lastStatus = 502;
    let lastMessage = "No provider error details were returned.";
    for (let index = 0; index < candidateModels.length; index += 1) {
      const activeModel = candidateModels[index];
      const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(activeModel) + ":generateContent";
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: requestBody,
      });
      const result = await upstream.json().catch(() => ({}));
      if (upstream.ok) {
        const answer = (result.candidates?.[0]?.content?.parts ?? [])
          .map((part) => typeof part.text === "string" ? part.text : "")
          .join("")
          .trim();
        if (!answer) return send(res, 502, { error: "The AI provider returned an empty response. Please try again." });
        return send(res, 200, { message: { role: "assistant", content: answer }, model: activeModel });
      }

      lastStatus = upstream.status;
      lastMessage = typeof result.error?.message === "string"
        ? result.error.message.slice(0, 240)
        : "No provider error details were returned.";
      console.error("Gemini request failed", {
        status: upstream.status,
        code: result.error?.status ?? "unknown",
        message: lastMessage,
        model: activeModel,
      });

      // Try a stable alternative if the selected model is temporarily overloaded or unavailable.
      if (![429, 500, 502, 503, 504, 404].includes(upstream.status)) break;
    }

    if (lastStatus === 429) {
      return send(res, 429, { error: "The AI provider is rate-limiting requests across available models. Please wait a minute and try again.", providerStatus: 429 });
    }
    if (lastStatus === 401 || lastStatus === 403) {
      return send(res, 502, { error: "Gemini denied access (" + lastStatus + "). Check that GEMINI_API_KEY is valid and enabled for the Gemini API.", providerStatus: lastStatus });
    }
    if (lastStatus === 404) {
      return send(res, 502, { error: "None of the configured Gemini models is available to this API key. Check model access in Google AI Studio.", providerStatus: 404 });
    }
    if (lastStatus >= 500) {
      return send(res, 502, { error: "Gemini is temporarily unavailable across the configured models. Please retry shortly.", providerStatus: lastStatus, providerMessage: lastMessage });
    }
    return send(res, 502, { error: "Gemini rejected the request. Check the selected model and message format.", providerStatus: lastStatus, providerMessage: lastMessage });
  } catch (error) {
    console.error("Gemini connection failed", error instanceof Error ? error.message : "Unknown error");
    return send(res, 502, { error: "AURA could not connect to the cloud AI provider. Please try again." });
  }
}
