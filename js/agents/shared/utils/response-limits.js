import { checkCancelled } from "./cancellation.js";
import { protoSafeReviver } from "./safe-json.js";
import { toNonEmptyString } from "./value-utils.js";

/**
 * @typedef {object} ResponseLimitError
 * @property {string} [code]
 * @property {number} [maxBytes]
 * @property {number} [observedBytes]
 */

/**
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeMaxBytes(value, fallback) {
  if (value === Infinity) return Infinity;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const n = Math.floor(parsed);
  return n > 0 ? n : fallback;
}

/**
 * @param {any} response
 * @param {string} name
 * @returns {string|null}
 */
function tryGetHeader(response, name) {
  try {
    const headers = response?.headers;
    if (headers && typeof headers.get === "function") return headers.get(name);
  } catch {
    // ignore
  }
  return null;
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isJsonContainer(value) {
  return value !== null && typeof value === "object";
}

/**
 * @param {string} context
 * @param {number} maxBytes
 * @param {number} observedBytes
 * @param {string} [code]
 * @returns {Error & ResponseLimitError}
 */
export function createResponseTooLargeError(context, maxBytes, observedBytes, code = "ERESPONSE_TOO_LARGE") {
  const label = toNonEmptyString(context) || "Response body";
  const err = /** @type {Error & ResponseLimitError} */ (
    new Error(`${label} exceeds limit (${observedBytes} > ${maxBytes} bytes)`)
  );
  err.name = "ResponseTooLargeError";
  err.code = code;
  err.maxBytes = maxBytes;
  err.observedBytes = observedBytes;
  return err;
}

/**
 * Read response text with a byte limit when streams are available.
 * Falls back to response.text() when streams are unavailable (e.g. unit tests).
 *
 * Note: response.text() fallback uses string length as a best-effort approximation of bytes.
 *
 * @param {any} response
 * @param {{ maxBytes?: number, context?: string, signal?: AbortSignal, code?: string }=} options
 * @returns {Promise<string|null>}
 */
export async function readTextWithLimit(response, { maxBytes = Infinity, context, signal, code } = {}) {
  const limit = normalizeMaxBytes(maxBytes, Infinity);
  const label = toNonEmptyString(context) || "Response body";

  checkCancelled(signal);

  if (limit !== Infinity) {
    const declared = (() => {
      const raw = tryGetHeader(response, "content-length");
      const n = raw ? Number.parseInt(String(raw), 10) : NaN;
      return Number.isFinite(n) ? n : null;
    })();
    if (declared !== null && declared > limit) {
      throw createResponseTooLargeError(label, limit, declared, code);
    }
  }

  const body = response?.body;
  if (body && typeof body.getReader === "function" && typeof TextDecoder === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    const parts = [];

    try {
      while (true) {
        checkCancelled(signal);
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        bytes += value.byteLength || 0;
        if (limit !== Infinity && bytes > limit) {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel errors
          }
          throw createResponseTooLargeError(label, limit, bytes, code);
        }

        parts.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      parts.push(decoder.decode());
    }

    return parts.join("");
  }

  if (typeof response?.text === "function") {
    checkCancelled(signal);
    const text = await response.text();
    if (limit !== Infinity && text.length > limit) {
      throw createResponseTooLargeError(label, limit, text.length, code);
    }
    return text;
  }

  return null;
}

/**
 * @param {any} response
 * @param {{ maxBytes?: number, context?: string, signal?: AbortSignal, code?: string, validate?: (data: any) => boolean }=} options
 * @returns {Promise<any>}
 */
export async function readJsonWithLimit(response, { maxBytes, context, signal, code, validate } = {}) {
  const label = toNonEmptyString(context) || "JSON response body";
  const text = await readTextWithLimit(response, { maxBytes, context: label, signal, code });
  if (text === null) throw new Error(`${label} is empty`);
  const data = JSON.parse(text, protoSafeReviver);
  if (!isJsonContainer(data)) {
    throw new Error(`${label} must be a JSON object or array`);
  }
  if (typeof validate === "function") {
    let ok = false;
    try {
      ok = validate(data);
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new Error(`${label} failed validation`);
    }
  }
  return data;
}

export default {
  normalizeMaxBytes,
  readTextWithLimit,
  readJsonWithLimit,
  createResponseTooLargeError,
};
