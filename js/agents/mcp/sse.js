import { createLogger, toNonEmptyString, toPositiveInt, protoSafeReviver} from "../shared/index.js";

const DEFAULT_MAX_LINE_BYTES = 256 * 1024; // 256KiB
const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024; // 2MiB
const DEFAULT_MAX_EVENT_CHARS = 1 * 1024 * 1024; // 1M chars

const logger = createLogger("mcp/sse");

function isTextDecoderAvailable() {
  return typeof TextDecoder !== "undefined";
}

function normalizeSseLimit(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = toPositiveInt(value, 0);
  return n > 0 ? n : fallback;
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

function sleepMs(ms, options = {}) {
  const { signal } = options;
  const delay = Math.max(0, Math.floor(Number(ms) || 0));
  if (delay <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let t = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (t) clearTimeout(t);
      t = null;
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    };
    const onAbort = () => finish();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    t = setTimeout(finish, delay);
    if (signal?.aborted) finish();
  });
}

function makeReadTimeoutError(timeoutMs) {
  const ms = toPositiveInt(timeoutMs, 0);
  /** @type {Error & { code?: string, readTimeoutMs?: number }} */
  const err = new Error(`SSE: read timeout after ${ms}ms`);
  err.name = "SseReadTimeoutError";
  err.code = "SSE_READ_TIMEOUT";
  err.readTimeoutMs = ms;
  return err;
}

function makeSizeLimitError(message, code) {
  /** @type {Error & { code?: string }} */
  const err = new Error(message);
  err.name = "SseSizeLimitError";
  err.code = code || "SSE_SIZE_LIMIT";
  return err;
}

/**
 * A minimal, spec-aligned SSE decoder (line-based).
 *
 * - Supports multi-line `data:`
 * - Supports `event:`, `id:` and `retry:`
 * - Keeps `id` and `retry` across events (per SSE spec)
 */
export class SseDecoder {
  constructor({ maxEventChars = 0 } = {}) {
    const limit = toPositiveInt(maxEventChars, 0);
    this._maxEventChars = limit > 0 ? limit : Infinity;

    this._eventType = null;
    this._dataLines = [];
    this._eventId = null;
    this._retry = null;
    this._dataChars = 0;
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
      const next = this._dataChars + value.length + 1;
      if (next > this._maxEventChars) {
        throw makeSizeLimitError(`SSE: event data exceeds maxEventChars (${this._maxEventChars})`, "SSE_EVENT_LIMIT");
      }
      this._dataChars = next;
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
    this._dataChars = 0;
    // id/retry persist across events (per spec).
  }
}

/**
 * Byte-level newline decoder (CRLF + LF).
 */
export class NewlineDecoder {
  constructor({ maxBufferBytes = 0, maxLineBytes = 0 } = {}) {
    const bufferLimit = toPositiveInt(maxBufferBytes, 0);
    const lineLimit = toPositiveInt(maxLineBytes, 0);
    this._maxBufferBytes = bufferLimit > 0 ? bufferLimit : Infinity;
    this._maxLineBytes = lineLimit > 0 ? lineLimit : Infinity;
    this._buffer = new Uint8Array();
    this._carriageIndex = null;
  }

  decode(chunk) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array();
    if (bytes.length) {
      const next = this._buffer.length + bytes.length;
      if (next > this._maxBufferBytes) {
        throw makeSizeLimitError(`SSE: buffer exceeds maxBufferBytes (${this._maxBufferBytes})`, "SSE_BUFFER_LIMIT");
      }
      this._buffer = concatUint8Arrays([this._buffer, bytes]);
    }

    const lines = [];
    while (true) {
      const lineEnd = this._findNewline();
      if (!lineEnd) break;

      const lineBytes = this._buffer.subarray(0, lineEnd.preceding);
      if (lineBytes.length > this._maxLineBytes) {
        throw makeSizeLimitError(`SSE: line exceeds maxLineBytes (${this._maxLineBytes})`, "SSE_LINE_LIMIT");
      }
      lines.push(decodeUtf8(lineBytes));

      this._buffer = this._buffer.subarray(lineEnd.index);
      this._carriageIndex = null;
    }

    return lines;
  }

  flush() {
    if (this._buffer.length === 0) return [];
    if (this._buffer.length > this._maxLineBytes) {
      throw makeSizeLimitError(`SSE: line exceeds maxLineBytes (${this._maxLineBytes})`, "SSE_LINE_LIMIT");
    }
    const lines = [decodeUtf8(this._buffer)];
    this._buffer = new Uint8Array();
    this._carriageIndex = null;
    return lines;
  }

  _findNewline() {
    const startIndex = this._carriageIndex ?? 0;
    for (let i = startIndex; i < this._buffer.length; i++) {
      const byte = this._buffer[i];
      if (this._carriageIndex !== null && i === this._carriageIndex + 1) {
        // We saw a CR previously. If it's followed by LF, treat as CRLF.
        if (byte === 0x0a) return { index: i + 1, preceding: this._carriageIndex };
        // Otherwise, treat the CR as a standalone newline.
        return { index: this._carriageIndex + 1, preceding: this._carriageIndex };
      }

      if (byte === 0x0d) {
        // CR: may be followed by LF (CRLF) or stand alone.
        this._carriageIndex = i;
        continue;
      }

      if (byte === 0x0a) {
        // LF
        return { index: i + 1, preceding: i };
      }
    }
    return null;
  }
}

/**
 * @typedef {object} ParseSseStreamOptions
 * @property {AbortSignal=} signal
 * @property {number=} readTimeoutMs
 * @property {number=} maxLineBytes
 * @property {number=} maxBufferBytes
 * @property {number=} maxEventChars
 */

/**
 * @typedef {object} ConsumeSseOptions
 * @property {(input: RequestInfo, init?: RequestInit) => Promise<Response>=} fetchImpl - fetch implementation (defaults to global fetch)
 * @property {string} url
 * @property {Record<string, string>=} headers
 * @property {AbortSignal=} signal
 * @property {number=} connectTimeoutMs
 * @property {number=} readTimeoutMs
 * @property {number=} maxLineBytes
 * @property {number=} maxBufferBytes
 * @property {number=} maxEventChars
 * @property {boolean=} reconnect
 * @property {number=} maxReconnects
 * @property {number=} reconnectBackoffMs
 * @property {number=} maxReconnectBackoffMs
 * @property {(evt: {event: string, data: string, id: string|null, retry: number|null}) => void=} onEvent
 */

/**
 * @typedef {object} ConsumeSseJsonOptions
 * @property {(input: RequestInfo, init?: RequestInit) => Promise<Response>=} fetchImpl
 * @property {string} url
 * @property {Record<string, string>=} headers
 * @property {AbortSignal=} signal
 * @property {number=} connectTimeoutMs
 * @property {(json: unknown, evt: {event: string, data: string, id: string|null, retry: number|null}) => void=} onJson
 * @property {number=} maxJsonChars
 * @property {(msg: unknown) => (string|null)=} validateMessage
 * @property {(err: unknown, context: Record<string, unknown>) => void=} onError
 */

/**
 * @param {ReadableStream<Uint8Array>} stream
 * @param {ParseSseStreamOptions=} options
 */
export async function* parseSseStream(
  stream,
  { signal, readTimeoutMs = 0, maxLineBytes = 0, maxBufferBytes = 0, maxEventChars = 0 } = {}
) {
  if (!stream || typeof stream.getReader !== "function") {
    throw new Error("SSE: response body is not a readable stream");
  }
  if (!isTextDecoderAvailable()) {
    throw new Error("SSE: TextDecoder unavailable");
  }

  const reader = stream.getReader();
  const newlineDecoder = new NewlineDecoder({
    maxLineBytes: normalizeSseLimit(maxLineBytes, DEFAULT_MAX_LINE_BYTES),
    maxBufferBytes: normalizeSseLimit(maxBufferBytes, DEFAULT_MAX_BUFFER_BYTES),
  });
  const decoder = new SseDecoder({ maxEventChars: normalizeSseLimit(maxEventChars, DEFAULT_MAX_EVENT_CHARS) });

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

      const timeoutMs = toPositiveInt(readTimeoutMs, 0);
      let timeoutId = null;
      const readPromise = reader.read();
      const timeoutPromise =
        timeoutMs > 0
          ? new Promise((_, reject) => {
              timeoutId = setTimeout(() => reject(makeReadTimeoutError(timeoutMs)), timeoutMs);
            })
          : null;

      let result;
      try {
        result = timeoutPromise ? await Promise.race([readPromise, timeoutPromise]) : await readPromise;
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "SSE_READ_TIMEOUT") {
          try {
            await reader.cancel("read_timeout");
          } catch {
            // ignore
          }
        }
        throw err;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      const { done, value } = result || {};
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
 * @param {{ onEvent?: (evt: {event: string, data: string, id: string|null, retry: number|null}) => void }=} opts
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
 * @param {Partial<ConsumeSseOptions>} opts
 */
export async function consumeSse({
  fetchImpl,
  url,
  headers,
  signal,
  connectTimeoutMs = 10_000,
  readTimeoutMs = 60_000,
  maxLineBytes = 0,
  maxBufferBytes = 0,
  maxEventChars = 0,
  reconnect = true,
  maxReconnects = 3,
  reconnectBackoffMs = 1000,
  maxReconnectBackoffMs = 30_000,
  onEvent,
} = {}) {
  const endpoint = toNonEmptyString(url);
  if (!endpoint) throw new Error("consumeSse: url is required");
  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("consumeSse: fetch unavailable");

  const hdrs = asHeadersObject(headers);
  const emit = typeof onEvent === "function" ? onEvent : () => {};

  const reconnectEnabled = reconnect !== false;
  const maxRetries = maxReconnects === Infinity ? Infinity : Math.max(0, Math.floor(Number(maxReconnects) || 0));
  const baseBackoffMs = Math.max(0, Math.floor(Number(reconnectBackoffMs) || 0));
  const maxBackoffMs = Math.max(baseBackoffMs, Math.floor(Number(maxReconnectBackoffMs) || 0));
  const timeoutMs = toPositiveInt(readTimeoutMs, 0);

  let attempt = 0;
  let retryHintMs = null;

  while (true) {
    if (signal?.aborted) return;

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

      retryHintMs = null;
      for await (const evt of parseSseStream(res.body, {
        signal: controller.signal,
        readTimeoutMs: timeoutMs,
        maxLineBytes,
        maxBufferBytes,
        maxEventChars,
      })) {
        if (controller.signal.aborted) break;
        retryHintMs = typeof evt.retry === "number" && Number.isFinite(evt.retry) ? Math.max(0, Math.floor(evt.retry)) : retryHintMs;
        emit({
          event: evt.event,
          data: evt.data,
          id: evt.id ?? null,
          retry: evt.retry ?? null,
        });
      }

      // Normal end-of-stream: stop retrying.
      return;
    } catch (err) {
      if (signal?.aborted) return;
      if (controller.signal.aborted && (signal?.aborted || controller.signal.reason === "aborted")) return;

      if (!reconnectEnabled || attempt >= maxRetries) {
        throw err;
      }

      attempt += 1;
      const hint = typeof retryHintMs === "number" && Number.isFinite(retryHintMs) ? retryHintMs : null;
      const base = hint !== null ? hint : baseBackoffMs;
      const backoff = base > 0 ? Math.min(maxBackoffMs, base * Math.pow(2, attempt - 1)) : 0;
      await sleepMs(backoff, { signal });
      continue;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }
}

/**
 * Consume SSE and parse each event's data as JSON.
 *
 * @param {Partial<ConsumeSseJsonOptions>} opts
 */
export async function consumeSseJson({
  fetchImpl,
  url,
  headers,
  signal,
  connectTimeoutMs = 10_000,
  onJson,
  maxJsonChars = 0,
  validateMessage,
  onError,
} = {}) {
  const onData = typeof onJson === "function" ? onJson : () => {};
  const onFailure =
    typeof onError === "function"
      ? onError
      : (err, context) => {
          logger.warn("SSE JSON payload rejected", { error: err?.message || String(err), ...context });
        };
  const jsonLimit = normalizeSseLimit(maxJsonChars, DEFAULT_MAX_EVENT_CHARS);
  const validate = typeof validateMessage === "function" ? validateMessage : null;
  return consumeSse({
    fetchImpl,
    url,
    headers,
    signal,
    connectTimeoutMs,
    onEvent: (evt) => {
      const data = toNonEmptyString(evt?.data);
      if (!data) return;
      if (jsonLimit !== Infinity && data.length > jsonLimit) {
        const err = makeSizeLimitError(`SSE: JSON payload exceeds maxJsonChars (${jsonLimit})`, "SSE_JSON_LIMIT");
        onFailure(err, { size: data.length, limit: jsonLimit });
        return;
      }
      try {
        const parsed = JSON.parse(data, protoSafeReviver);
        if (validate) {
          const validationError = validate(parsed);
          if (validationError) {
            onFailure(new Error(`Invalid SSE JSON payload: ${validationError}`), { reason: "schema" });
            return;
          }
        }
        onData(parsed, evt);
      } catch (err) {
        onFailure(err, { reason: "invalid_json" });
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
