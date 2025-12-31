import { toNonEmptyString } from "../shared/utils/value-utils.js";

function isTextDecoderAvailable() {
  return typeof TextDecoder !== "undefined";
}

function asHeadersObject(headers) {
  if (headers && typeof headers === "object" && !Array.isArray(headers)) return headers;
  return {};
}

/**
 * Create a minimal SSE parser.
 *
 * - Accepts arbitrary chunk boundaries.
 * - Emits one event per SSE "dispatch" block (separated by blank line).
 *
 * @param {object} opts
 * @param {(evt: {event: string, data: string, id: string|null, retry: number|null}) => void} opts.onEvent
 */
export function createSseParser({ onEvent } = {}) {
  const emit = typeof onEvent === "function" ? onEvent : () => {};

  let buffer = "";

  const drainBlock = (block) => {
    const lines = block.split("\n");
    let event = "message";
    let id = null;
    let retry = null;
    const dataLines = [];

    for (const raw of lines) {
      const line = typeof raw === "string" ? raw : String(raw ?? "");
      if (!line) continue;
      if (line.startsWith(":")) continue; // comment

      const idx = line.indexOf(":");
      const field = (idx === -1 ? line : line.slice(0, idx)).trim();
      const valueRaw = idx === -1 ? "" : line.slice(idx + 1);
      const value = valueRaw.startsWith(" ") ? valueRaw.slice(1) : valueRaw;

      if (field === "event") event = toNonEmptyString(value) || "message";
      else if (field === "data") dataLines.push(value);
      else if (field === "id") id = toNonEmptyString(value) || null;
      else if (field === "retry") {
        const n = Number(value);
        retry = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
      }
    }

    const data = dataLines.join("\n");
    emit({ event, data, id, retry });
  };

  const feed = (chunkText) => {
    const text = typeof chunkText === "string" ? chunkText : String(chunkText ?? "");
    if (!text) return;
    buffer += text;

    // SSE events are separated by a blank line (double LF). Normalize CRLF.
    buffer = buffer.replace(/\r\n/g, "\n");

    while (true) {
      const sep = buffer.indexOf("\n\n");
      if (sep === -1) break;
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (block.trim()) drainBlock(block);
    }
  };

  const flush = () => {
    const rest = buffer.replace(/\r\n/g, "\n").trim();
    buffer = "";
    if (rest) drainBlock(rest);
  };

  return { feed, flush };
}

async function* readStreamTextChunks(stream, { signal } = {}) {
  if (!stream || typeof stream.getReader !== "function") {
    throw new Error("SSE: response body is not a readable stream");
  }
  if (!isTextDecoderAvailable()) {
    throw new Error("SSE: TextDecoder unavailable");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");

  while (true) {
    if (signal?.aborted) {
      try {
        reader.cancel();
      } catch {
        // ignore
      }
      return;
    }
    const { done, value } = await reader.read();
    if (done) return;
    if (!value) continue;
    yield decoder.decode(value, { stream: true });
  }
}

/**
 * Consume an SSE endpoint with fetch streaming.
 *
 * @param {object} opts
 * @param {Function} [opts.fetchImpl] - fetch implementation (defaults to global fetch)
 * @param {string} opts.url
 * @param {object} [opts.headers]
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.connectTimeoutMs=10000]
 * @param {(evt: {event: string, data: string, id: string|null, retry: number|null}) => void} opts.onEvent
 */
export async function consumeSse({
  fetchImpl,
  url,
  headers,
  signal,
  connectTimeoutMs = 10_000,
  onEvent,
} = {}) {
  const endpoint = toNonEmptyString(url);
  if (!endpoint) throw new Error("consumeSse: url is required");
  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("consumeSse: fetch unavailable");

  const hdrs = asHeadersObject(headers);
  const parser = createSseParser({ onEvent });

  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason || "aborted");
  if (signal?.aborted) onAbort();
  else signal?.addEventListener?.("abort", onAbort, { once: true });

  let timeoutId = null;
  if (Number.isFinite(connectTimeoutMs) && connectTimeoutMs > 0 && !controller.signal.aborted) {
    timeoutId = setTimeout(() => controller.abort("connect_timeout"), Math.floor(connectTimeoutMs));
  }

  try {
    const res = await fetchFn(endpoint, {
      method: "GET",
      headers: { Accept: "text/event-stream", ...hdrs },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`SSE: HTTP ${res.status}`);
    const ctype = res.headers?.get?.("content-type") || "";
    if (!ctype.toLowerCase().includes("text/event-stream")) {
      throw new Error(`SSE: unexpected content-type: ${ctype || "unknown"}`);
    }

    for await (const chunkText of readStreamTextChunks(res.body, { signal: controller.signal })) {
      if (controller.signal.aborted) break;
      parser.feed(chunkText);
    }

    parser.flush();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

/**
 * Consume SSE and parse each event's data as JSON.
 */
export async function consumeSseJson({
  fetchImpl,
  url,
  headers,
  signal,
  connectTimeoutMs = 10_000,
  onJson,
} = {}) {
  const onData = typeof onJson === "function" ? onJson : () => {};
  return consumeSse({
    fetchImpl,
    url,
    headers,
    signal,
    connectTimeoutMs,
    onEvent: (evt) => {
      const data = toNonEmptyString(evt?.data);
      if (!data) return;
      try {
        const parsed = JSON.parse(data);
        onData(parsed, evt);
      } catch {
        // ignore invalid JSON payloads
      }
    },
  });
}

export default {
  createSseParser,
  consumeSse,
  consumeSseJson,
};
