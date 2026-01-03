const fs = require("node:fs");
const path = require("node:path");

function toNonEmptyString(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

function normalizeMode(mode) {
  const m = toNonEmptyString(mode)?.toLowerCase();
  if (!m) return "replay";
  if (m === "record" || m === "replay") return m;
  throw new Error(`VcrRecorder: invalid VCR_MODE=${JSON.stringify(mode)} (expected "record" or "replay")`);
}

function sanitizeCassetteName(name) {
  const raw = toNonEmptyString(name);
  if (!raw) throw new TypeError("VcrRecorder: cassette name must be a non-empty string");
  const normalized = raw.replace(/\\/g, "/").replace(/^\//, "");
  if (normalized.includes("..")) throw new Error("VcrRecorder: cassette name must not include '..'");
  return normalized.replace(/[^a-zA-Z0-9/_-]+/g, "_");
}

function looksTextContentType(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (!ct) return false;
  return (
    ct.startsWith("text/") ||
    ct.includes("application/json") ||
    ct.includes("+json") ||
    ct.includes("application/xml") ||
    ct.includes("+xml") ||
    ct.includes("application/javascript") ||
    ct.includes("application/x-www-form-urlencoded")
  );
}

function headersToObject(headers) {
  const out = {};
  if (!headers) return out;
  for (const [k, v] of headers.entries()) out[String(k).toLowerCase()] = String(v);
  return out;
}

function sanitizeHeaders(headerObj) {
  const headers = headerObj && typeof headerObj === "object" ? { ...headerObj } : {};
  const SENSITIVE = new Set([
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "openai-api-key",
    "anthropic-api-key",
  ]);
  for (const k of Object.keys(headers)) {
    if (SENSITIVE.has(String(k).toLowerCase())) headers[k] = "__redacted__";
  }
  return headers;
}

async function serializeBodyFromArrayBuffer(buf, { contentType } = {}) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
  const byteLength = u8.byteLength;
  if (!byteLength) return { type: "empty", byteLength: 0 };

  const asText = looksTextContentType(contentType);
  if (asText) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(u8);
    return { type: "text", encoding: "utf8", text, byteLength };
  }

  const base64 = Buffer.from(u8).toString("base64");
  return { type: "base64", encoding: "base64", base64, byteLength };
}

async function serializeRequest(request) {
  const headers = headersToObject(request.headers);
  const contentType = headers["content-type"] || null;
  let body = { type: "empty", byteLength: 0 };
  try {
    const buf = await request.clone().arrayBuffer();
    body = await serializeBodyFromArrayBuffer(buf, { contentType });
  } catch {
    // Some Request bodies may be non-cloneable; omit body for safety.
    body = { type: "unavailable" };
  }

  return {
    url: request.url,
    method: request.method,
    headers: sanitizeHeaders(headers),
    body,
  };
}

async function serializeResponse(response) {
  const headers = headersToObject(response.headers);
  const contentType = headers["content-type"] || null;
  let body = { type: "empty", byteLength: 0 };
  try {
    const buf = await response.arrayBuffer();
    body = await serializeBodyFromArrayBuffer(buf, { contentType });
  } catch {
    body = { type: "unavailable" };
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers: sanitizeHeaders(headers),
    body,
  };
}

function deserializeResponse(serialized) {
  if (!serialized || typeof serialized !== "object") throw new TypeError("VcrRecorder: invalid serialized response");
  const status = typeof serialized.status === "number" ? serialized.status : 200;
  const statusText = typeof serialized.statusText === "string" ? serialized.statusText : "";
  const headers = serialized.headers && typeof serialized.headers === "object" ? serialized.headers : {};
  const body = serialized.body || { type: "empty" };

  let payload = "";
  if (body.type === "text") payload = String(body.text ?? "");
  else if (body.type === "base64") payload = Buffer.from(String(body.base64 ?? ""), "base64");
  else payload = "";

  return new Response(payload, { status, statusText, headers });
}

function stringifyForCompare(body) {
  if (!body || typeof body !== "object") return "";
  if (body.type === "text") return String(body.text ?? "");
  if (body.type === "base64") return `base64:${String(body.base64 ?? "")}`;
  return "";
}

function matchRequest(expected, actual) {
  if (!expected || typeof expected !== "object") return false;
  if (!actual || typeof actual !== "object") return false;

  const expUrl = String(expected.url || "");
  const actUrl = String(actual.url || "");
  if (expUrl !== actUrl) return false;

  const expMethod = String(expected.method || "GET").toUpperCase();
  const actMethod = String(actual.method || "GET").toUpperCase();
  if (expMethod !== actMethod) return false;

  const expBody = stringifyForCompare(expected.body);
  const actBody = stringifyForCompare(actual.body);
  if (expBody !== actBody) return false;

  return true;
}

class VcrRecorder {
  constructor({ fixturesDir, mode } = {}) {
    this.fixturesDir = fixturesDir
      ? path.resolve(String(fixturesDir))
      : path.resolve(process.cwd(), "tests", "fixtures", "vcr");
    this.mode = normalizeMode(mode ?? process.env.VCR_MODE);
  }

  cassettePath(name) {
    const safe = sanitizeCassetteName(name);
    return path.join(this.fixturesDir, `${safe}.json`);
  }

  async record(name, fn) {
    if (typeof fn !== "function") throw new TypeError("VcrRecorder.record(name, fn): fn must be a function");
    if (this.mode === "replay") return this.replay(name, fn);
    return this._record(name, fn);
  }

  async replay(name, fn) {
    if (typeof fn !== "function") throw new TypeError("VcrRecorder.replay(name, fn): fn must be a function");
    return this._replay(name, fn);
  }

  _patchFetch(makeFetch) {
    const originalFetch = globalThis.fetch;
    if (typeof originalFetch !== "function") throw new Error("VcrRecorder: global fetch() is not available in this runtime");
    const wrapped = makeFetch(originalFetch);
    if (typeof wrapped !== "function") throw new TypeError("VcrRecorder: makeFetch must return a function");

    globalThis.fetch = wrapped;
    return () => {
      globalThis.fetch = originalFetch;
    };
  }

  async _record(name, fn) {
    const cassettePath = this.cassettePath(name);
    fs.mkdirSync(path.dirname(cassettePath), { recursive: true });

    const interactions = [];
    const restore = this._patchFetch((originalFetch) => {
      return async (input, init) => {
        const req = new Request(input, init);
        const request = await serializeRequest(req);
        const startedAtNs = process.hrtime.bigint();
        const resp = await originalFetch(input, init);
        const endedAtNs = process.hrtime.bigint();
        const response = await serializeResponse(resp.clone());
        interactions.push({
          kind: "fetch",
          request,
          response,
          timing: { durationMs: Number(endedAtNs - startedAtNs) / 1e6 },
        });
        return resp;
      };
    });

    let result;
    let error;
    try {
      result = await fn();
    } catch (err) {
      error = err;
    } finally {
      restore();
    }

    if (!error) {
      const payload = {
        meta: {
          schemaVersion: "1.0",
          name: sanitizeCassetteName(name),
          createdAt: new Date().toISOString(),
          mode: "record",
          node: process.version,
        },
        interactions,
      };
      fs.writeFileSync(cassettePath, JSON.stringify(payload, null, 2));
    }

    if (error) throw error;
    return result;
  }

  async _replay(name, fn) {
    const cassettePath = this.cassettePath(name);
    if (!fs.existsSync(cassettePath)) {
      throw new Error(`VcrRecorder: cassette not found: ${cassettePath}`);
    }

    const cassette = JSON.parse(fs.readFileSync(cassettePath, "utf8"));
    const interactions = Array.isArray(cassette?.interactions) ? cassette.interactions : [];
    let cursor = 0;

    const restore = this._patchFetch(() => {
      return async (input, init) => {
        const req = new Request(input, init);
        const actual = await serializeRequest(req);

        if (cursor >= interactions.length) {
          throw new Error(
            `[VCR] No more recorded interactions in ${path.basename(cassettePath)} (got ${actual.method} ${actual.url})`
          );
        }

        const expected = interactions[cursor];
        if (!expected || expected.kind !== "fetch") {
          throw new Error(`[VCR] Expected a fetch interaction at #${cursor + 1} in ${path.basename(cassettePath)}`);
        }

        if (!matchRequest(expected.request, actual)) {
          const exp = expected.request || {};
          throw new Error(
            `[VCR] Request mismatch at #${cursor + 1} in ${path.basename(cassettePath)}\n` +
              `Expected: ${String(exp.method || "GET").toUpperCase()} ${String(exp.url || "")}\n` +
              `Actual:   ${String(actual.method || "GET").toUpperCase()} ${String(actual.url || "")}`
          );
        }

        cursor += 1;
        return deserializeResponse(expected.response);
      };
    });

    let result;
    try {
      result = await fn();
    } finally {
      restore();
    }

    const remaining = interactions.length - cursor;
    if (remaining > 0) {
      throw new Error(
        `[VCR] Unused recorded interactions in ${path.basename(cassettePath)}: ${remaining} (consumed ${cursor}/${interactions.length})`
      );
    }

    return result;
  }
}

module.exports = { VcrRecorder };

