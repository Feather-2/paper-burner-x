import { toNonEmptyString } from "../shared/utils/value-utils.js";

function isTextDecoderAvailable() {
  return typeof TextDecoder !== "undefined";
}

function asHeadersObject(headers) {
  if (headers && typeof headers === "object" && !Array.isArray(headers)) return headers;
  return {};
}

function splitFirst(str, separator) {
  const s = typeof str === "string" ? str : String(str ?? "");
  const idx = s.indexOf(separator);
  if (idx === -1) return [s, "", ""];
  return [s.slice(0, idx), separator, s.slice(idx + separator.length)];
}

let _utf8Decoder = null;
function decodeUtf8(bytes) {
  if (!isTextDecoderAvailable()) throw new Error("SSE: TextDecoder unavailable");
  if (!_utf8Decoder) _utf8Decoder = new TextDecoder("utf-8");
  return _utf8Decoder.decode(bytes);
}

function concatUint8Arrays(arrays) {
  let totalLength = 0;
  for (const arr of arrays) totalLength += arr?.length || 0;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    if (!arr || arr.length === 0) continue;
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * A minimal, spec-aligned SSE decoder (line-based).
 *
 * - Supports multi-line `data:`
 * - Supports `event:`, `id:` and `retry:`
 * - Keeps `id` and `retry` across events (per SSE spec)
 */
export class SseDecoder {
  constructor() {
    this._eventType = null;
    this._dataLines = [];
    this._eventId = null;
    this._retry = null;
  }

  decode(line) {
    const text = typeof line === "string" ? line : String(line ?? "");

    // Empty line dispatches the event.
    if (!text.trim()) {
      if (this._dataLines.length === 0) {
        this._resetCurrent();
        return null;
      }

      const evt = {
        event: this._eventType || "message",
        data: this._dataLines.join("\n"),
        id: this._eventId,
        retry: this._retry,
      };

      this._resetCurrent();
      return evt;
    }

    // Comment line (": ...").
    if (text.startsWith(":")) return null;

    const [field, , valueRaw] = splitFirst(text, ":");
    const value = valueRaw.startsWith(" ") ? valueRaw.slice(1) : valueRaw;

    if (field === "event") {
      this._eventType = toNonEmptyString(value) || "message";
    } else if (field === "data") {
      this._dataLines.push(value);
    } else if (field === "id") {
      this._eventId = toNonEmptyString(value) || null;
    } else if (field === "retry") {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n) && n >= 0) this._retry = Math.floor(n);
    }

    return null;
  }

  flush() {
    if (this._dataLines.length === 0) return null;
    const evt = {
      event: this._eventType || "message",
      data: this._dataLines.join("\n"),
      id: this._eventId,
      retry: this._retry,
    };
    this._resetCurrent();
    return evt;
  }

  _resetCurrent() {
    this._eventType = null;
    this._dataLines = [];
    // id/retry persist across events (per spec).
  }
}

/**
 * Byte-level newline decoder (CRLF + LF).
 */
export class NewlineDecoder {
  constructor() {
    this._buffer = new Uint8Array();
    this._carriageIndex = null;
  }

  decode(chunk) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array();
    if (bytes.length) this._buffer = concatUint8Arrays([this._buffer, bytes]);

    const lines = [];
    while (true) {
      const lineEnd = this._findNewline();
      if (!lineEnd) break;

      const lineBytes = this._buffer.subarray(0, lineEnd.preceding);
      lines.push(decodeUtf8(lineBytes));

      this._buffer = this._buffer.subarray(lineEnd.index);
      this._carriageIndex = null;
    }

    return lines;
  }

  flush() {
    if (this._buffer.length === 0) return [];
    const lines = [decodeUtf8(this._buffer)];
    this._buffer = new Uint8Array();
    this._carriageIndex = null;
    return lines;
  }

  _findNewline() {
    const startIndex = this._carriageIndex ?? 0;
    for (let i = startIndex; i < this._buffer.length; i++) {
      const byte = this._buffer[i];
      if (byte === 0x0d) {
        this._carriageIndex = i;
      } else if (byte === 0x0a) {
        const preceding = this._carriageIndex !== null && this._carriageIndex === i - 1 ? i - 1 : i;
        return { index: i + 1, preceding };
      }
    }
    return null;
  }
}

export async function* parseSseStream(stream, { signal } = {}) {
  if (!stream || typeof stream.getReader !== "function") {
    throw new Error("SSE: response body is not a readable stream");
  }
  if (!isTextDecoderAvailable()) {
    throw new Error("SSE: TextDecoder unavailable");
  }

  const reader = stream.getReader();
  const newlineDecoder = new NewlineDecoder();
  const decoder = new SseDecoder();

  try {
    while (true) {
      if (signal?.aborted) {
        try {
          await reader.cancel(signal.reason);
        } catch {
          // ignore
        }
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      for (const line of newlineDecoder.decode(value)) {
        const evt = decoder.decode(line);
        if (evt) yield evt;
      }
    }

    for (const line of newlineDecoder.flush()) {
      const evt = decoder.decode(line);
      if (evt) yield evt;
    }

    const last = decoder.flush();
    if (last) yield last;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

/**
 * Create an SSE parser that can be fed with text chunks (for tests / manual usage).
 *
 * @param {object} opts
 * @param {(evt: {event: string, data: string, id: string|null, retry: number|null}) => void} opts.onEvent
 */
export function createSseParser({ onEvent } = {}) {
  const emit = typeof onEvent === "function" ? onEvent : () => {};
  const decoder = new SseDecoder();
  let buffer = "";

  const emitIfReady = (evt) => {
    if (!evt) return;
    emit({
      event: evt.event,
      data: evt.data,
      id: evt.id ?? null,
      retry: evt.retry ?? null,
    });
  };

  const processLine = (line) => emitIfReady(decoder.decode(line));

  const feed = (chunkText) => {
    const text = typeof chunkText === "string" ? chunkText : String(chunkText ?? "");
    if (!text) return;
    buffer += text;

    let i = 0;
    while (i < buffer.length) {
      const c = buffer.charCodeAt(i);
      if (c === 0x0a) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        i = 0;
        processLine(line);
        continue;
      }
      if (c === 0x0d) {
        if (i + 1 >= buffer.length) break;
        const hasLf = buffer.charCodeAt(i + 1) === 0x0a;
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + (hasLf ? 2 : 1));
        i = 0;
        processLine(line);
        continue;
      }
      i += 1;
    }
  };

  const flush = () => {
    const rest = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    buffer = "";
    if (rest) processLine(rest);
    emitIfReady(decoder.flush());
  };

  return { feed, flush };
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
  const emit = typeof onEvent === "function" ? onEvent : () => {};

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

    for await (const evt of parseSseStream(res.body, { signal: controller.signal })) {
      if (controller.signal.aborted) break;
      emit({
        event: evt.event,
        data: evt.data,
        id: evt.id ?? null,
        retry: evt.retry ?? null,
      });
    }
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
  parseSseStream,
  SseDecoder,
  NewlineDecoder,
};
