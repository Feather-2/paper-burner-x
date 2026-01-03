const fs = require("node:fs");
const path = require("node:path");

function toNonEmptyString(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

function sanitizeCassetteName(name) {
  const raw = toNonEmptyString(name);
  if (!raw) throw new TypeError("LLM mock: cassette name must be a non-empty string");
  const normalized = raw.replace(/\\/g, "/").replace(/^\//, "");
  if (normalized.includes("..")) throw new Error("LLM mock: cassette name must not include '..'");
  return normalized.replace(/[^a-zA-Z0-9/_-]+/g, "_");
}

function isChatCompletionsUrl(url) {
  const u = String(url || "");
  return /\/chat\/completions\b/i.test(u);
}

function buildOpenAiChatCompletion({ content, model = "mock-model" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const text = String(content ?? "");
  return {
    id: `chatcmpl_mock_${now}`,
    object: "chat.completion",
    created: now,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function extractPromptText(bodyJson) {
  const messages = Array.isArray(bodyJson?.messages) ? bodyJson.messages : [];
  const parts = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const c = m.content;
    if (typeof c === "string") parts.push(c);
    else if (Array.isArray(c)) {
      for (const seg of c) {
        const t = seg?.text;
        if (typeof t === "string") parts.push(t);
      }
    }
  }
  return parts.join("\n");
}

function toMatcher(pattern) {
  if (typeof pattern === "function") return pattern;
  if (pattern instanceof RegExp) {
    return (ctx) => pattern.test(ctx.prompt || "") || pattern.test(ctx.url || "");
  }
  const s = toNonEmptyString(pattern);
  if (s) {
    return (ctx) => String(ctx.prompt || "").includes(s) || String(ctx.url || "").includes(s);
  }
  throw new TypeError("mockLlmResponse(pattern, response): pattern must be a string, RegExp, or function");
}

function normalizeResponseQueue(response) {
  if (Array.isArray(response)) return response.slice();
  return [response];
}

function loadLlmResponsesFromVcrCassette(cassetteName, { fixturesDir } = {}) {
  const dir = fixturesDir ? path.resolve(String(fixturesDir)) : path.resolve(process.cwd(), "tests", "fixtures", "vcr");
  const cassettePath = path.join(dir, `${sanitizeCassetteName(cassetteName)}.json`);
  if (!fs.existsSync(cassettePath)) throw new Error(`LLM mock: cassette not found: ${cassettePath}`);
  const cassette = JSON.parse(fs.readFileSync(cassettePath, "utf8"));
  const interactions = Array.isArray(cassette?.interactions) ? cassette.interactions : [];
  const llmFetches = interactions.filter((i) => i?.kind === "fetch" && isChatCompletionsUrl(i?.request?.url));
  const out = [];
  for (const entry of llmFetches) {
    const body = entry?.response?.body;
    if (body?.type === "text") {
      try {
        out.push(JSON.parse(String(body.text || "")));
      } catch {
        // keep as string fallback (still JSON-response-like)
        out.push({ raw: String(body.text || "") });
      }
      continue;
    }
    if (body?.type === "base64") {
      const text = Buffer.from(String(body.base64 || ""), "base64").toString("utf8");
      try {
        out.push(JSON.parse(text));
      } catch {
        out.push({ raw: text });
      }
    }
  }
  return out;
}

function ensureState() {
  if (!globalThis.__PB_LLM_MOCK_STATE__) {
    globalThis.__PB_LLM_MOCK_STATE__ = { installed: false, restore: null, mocks: [] };
  }
  return globalThis.__PB_LLM_MOCK_STATE__;
}

function installFetchHookIfNeeded() {
  const state = ensureState();
  if (state.installed) return state;

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") throw new Error("LLM mock: global fetch() is not available in this runtime");

  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = req.url;
    const method = req.method || "GET";

    let bodyJson = null;
    try {
      const rawText = await req.clone().text();
      bodyJson = rawText ? JSON.parse(rawText) : null;
    } catch {
      bodyJson = null;
    }

    const ctx = {
      url,
      method,
      bodyJson,
      prompt: extractPromptText(bodyJson),
      headers: Object.fromEntries(req.headers.entries()),
    };

    for (const mock of [...state.mocks]) {
      if (!isChatCompletionsUrl(url)) continue;
      if (!mock.matcher(ctx)) continue;

      const next = mock.queue.length ? mock.queue.shift() : mock.fallback;
      const resolved = typeof next === "function" ? await next(ctx) : next;

      // VCR-backed mode: each call consumes the next recorded response.
      if (resolved && typeof resolved === "object" && resolved.vcr && resolved.vcr.cassette) {
        if (!mock.vcrCache) mock.vcrCache = loadLlmResponsesFromVcrCassette(resolved.vcr.cassette, resolved.vcr);
        const item = mock.vcrCache[mock.vcrCursor++] || null;
        if (!item) throw new Error(`LLM mock: VCR cassette exhausted: ${resolved.vcr.cassette}`);
        return new Response(JSON.stringify(item), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (typeof resolved === "string") {
        const json = buildOpenAiChatCompletion({ content: resolved });
        return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (resolved && typeof resolved === "object") {
        if (typeof resolved.content === "string") {
          const json = buildOpenAiChatCompletion({ content: resolved.content, model: resolved.model || "mock-model" });
          return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
        }

        const status = typeof resolved.status === "number" ? resolved.status : 200;
        const headers = resolved.headers && typeof resolved.headers === "object" ? resolved.headers : { "content-type": "application/json" };
        const body = resolved.body !== undefined ? resolved.body : resolved;
        return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
      }

      const json = buildOpenAiChatCompletion({ content: String(resolved ?? "") });
      return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
    }

    return originalFetch(input, init);
  };

  state.restore = () => {
    globalThis.fetch = originalFetch;
  };
  state.installed = true;
  return state;
}

/**
 * Mock OpenAI-compatible chat completions (requests to /chat/completions).
 *
 * @param {string|RegExp|function(ctx:{url:string,method:string,prompt:string,bodyJson:any}):boolean} pattern
 * @param {any} response
 *  - string => assistant content (OpenAI chat.completion JSON)
 *  - {content:string, model?} => assistant content (OpenAI chat.completion JSON)
 *  - {vcr:{cassette:string, fixturesDir?}} => consume recorded JSON responses from a VCR cassette
 *  - array => queue of responses (each call shifts one)
 *  - function(ctx) => response
 * @returns {function():void} cleanup
 */
function mockLlmResponse(pattern, response) {
  const matcher = toMatcher(pattern);
  const queue = normalizeResponseQueue(response);
  const mock = { matcher, queue, fallback: queue.length ? queue[queue.length - 1] : response, vcrCursor: 0, vcrCache: null };

  const state = installFetchHookIfNeeded();
  state.mocks.push(mock);

  return () => {
    const idx = state.mocks.indexOf(mock);
    if (idx !== -1) state.mocks.splice(idx, 1);
    if (state.mocks.length === 0 && state.restore) {
      state.restore();
      state.installed = false;
      state.restore = null;
    }
  };
}

function resetLlmMocks() {
  const state = ensureState();
  state.mocks.length = 0;
  if (state.installed && state.restore) state.restore();
  state.installed = false;
  state.restore = null;
}

module.exports = { mockLlmResponse, resetLlmMocks, loadLlmResponsesFromVcrCassette };
