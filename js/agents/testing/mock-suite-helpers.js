/**
 * Mock Suite Helpers - 可复用工具与工厂函数
 */

export const DEFAULT_MOCK_BASE_URL = "http://mock.local";

export class MockHeaders {
  constructor(init = {}) {
    this._map = new Map();
    for (const [key, value] of Object.entries(init || {})) {
      this.set(key, value);
    }
  }

  set(name, value) {
    const key = String(name || "").toLowerCase();
    if (!key) return;
    this._map.set(key, String(value ?? ""));
  }

  get(name) {
    const key = String(name || "").toLowerCase();
    return this._map.has(key) ? this._map.get(key) : null;
  }

  has(name) {
    const key = String(name || "").toLowerCase();
    return this._map.has(key);
  }

  entries() {
    return Array.from(this._map.entries());
  }
}

export function normalizeMethod(method) {
  const m = typeof method === "string" && method.trim() ? method.trim().toUpperCase() : "GET";
  return m;
}

export function normalizePath(input, baseUrl) {
  const raw = typeof input === "string" ? input : String(input ?? "");
  if (!raw) return "/";
  try {
    const url = new URL(raw, baseUrl || DEFAULT_MOCK_BASE_URL);
    return url.pathname + url.search;
  } catch {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
}

export function normalizeBody(body) {
  if (body === null || body === undefined) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

export class MockResponse {
  constructor({ status = 200, headers = {}, body = "", stream = null, delay = 0 } = {}) {
    this.status = Number.isFinite(status) ? status : 200;
    this.headers = new MockHeaders(headers);
    this._body = normalizeBody(body);
    this._delay = Number.isFinite(delay) ? Math.max(0, Math.floor(delay)) : 0;
    this._streamChunks = Array.isArray(stream) ? stream.slice() : stream ? [stream] : null;
  }

  get ok() {
    return this.status >= 200 && this.status < 300;
  }

  async text() {
    if (this._delay) await new Promise((r) => setTimeout(r, this._delay));
    if (!this._streamChunks) return this._body;
    let out = "";
    for await (const chunk of this.stream()) {
      out += String(chunk ?? "");
    }
    return out;
  }

  async json() {
    const text = await this.text();
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`MockResponse.json(): Invalid JSON body - ${err.message}. Body was: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`);
    }
  }

  async arrayBuffer() {
    const text = await this.text();
    return new TextEncoder().encode(text).buffer;
  }

  async *stream() {
    if (!this._streamChunks) {
      yield this._body;
      return;
    }
    for (const chunk of this._streamChunks) {
      yield chunk;
    }
  }
}

export function deepMatch(actual, expected) {
  const matchAny = (act, exp, path = "") => {
    if (exp instanceof RegExp) {
      const ok = exp.test(String(act ?? ""));
      return ok ? { ok: true } : { ok: false, error: `Expected ${path || "value"} to match ${exp}, got ${String(act)}` };
    }
    if (typeof exp === "function") {
      try {
        const ok = !!exp(act);
        return ok ? { ok: true } : { ok: false, error: `Expected ${path || "value"} to satisfy predicate` };
      } catch (err) {
        return { ok: false, error: `Predicate threw at ${path || "value"}: ${err?.message || err}` };
      }
    }
    if (exp && typeof exp === "object") {
      if (Array.isArray(exp)) {
        if (!Array.isArray(act)) return { ok: false, error: `Expected ${path || "value"} to be an array` };
        for (let i = 0; i < exp.length; i++) {
          const r = matchAny(act[i], exp[i], `${path}[${i}]`);
          if (!r.ok) return r;
        }
        return { ok: true };
      }
      if (!act || typeof act !== "object") return { ok: false, error: `Expected ${path || "value"} to be an object` };
      for (const [k, v] of Object.entries(exp)) {
        const nextPath = path ? `${path}.${k}` : k;
        const r = matchAny(act[k], v, nextPath);
        if (!r.ok) return r;
      }
      return { ok: true };
    }

    const ok = act === exp;
    return ok ? { ok: true } : { ok: false, error: `Expected ${path || "value"}=${String(exp)}, got ${String(act)}` };
  };

  const r = matchAny(actual, expected, "");
  return r.ok ? { passed: true } : { passed: false, error: r.error };
}

export function createStageApiCompat(eventBus, modelClient, overrides = {}) {
  return {
    signal: new AbortController().signal,
    emit: (name, payload) => eventBus.emit(name, payload),
    eventBus,
    modelRouter: { call: (msgs, opts) => modelClient.chat({ messages: msgs, ...opts }) },
    aiApiService: { chat: opts => modelClient.chat(opts) },
    ...overrides,
  };
}
