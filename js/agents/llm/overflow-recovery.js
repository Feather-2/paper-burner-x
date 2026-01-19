import { toNonEmptyString } from "../shared/index.js";

/**
 * @typedef {object} ContextOverflowInfo
 * @property {number} inputLength
 * @property {number} maxTokens
 * @property {number} contextLimit
 * @property {string} [provider]
 */

function extractErrorMessage(error) {
  const direct = toNonEmptyString(error?.message);
  if (direct) return direct;
  const nested =
    toNonEmptyString(error?.error?.message) ||
    toNonEmptyString(error?.response?.data?.error?.message) ||
    toNonEmptyString(error?.response?.data?.message) ||
    toNonEmptyString(error?.data?.error?.message) ||
    toNonEmptyString(error?.data?.message);
  return nested || "";
}

/**
 * Parse common "context length exceeded" error messages into structured values.
 *
 * Supports:
 * - Anthropic: `input length and \`max_tokens\` exceed context limit: 100000 + 4096 > 100000`
 * - OpenAI-compatible: `maximum context length is 8192 tokens... requested 9000 tokens (8000 in the messages, 1000 in the completion)`
 *
 * @param {unknown} error
 * @returns {ContextOverflowInfo | null}
 */
export function parseContextOverflowError(error) {
  const message = extractErrorMessage(error);
  if (!message) return null;

  // Anthropic-style
  {
    const m = message.match(/input length and `max_tokens` exceed context limit:\s*(\d+)\s*\+\s*(\d+)\s*>\s*(\d+)/i);
    if (m) {
      const inputLength = Number(m[1]);
      const maxTokens = Number(m[2]);
      const contextLimit = Number(m[3]);
      if (Number.isFinite(inputLength) && Number.isFinite(maxTokens) && Number.isFinite(contextLimit)) {
        return { inputLength, maxTokens, contextLimit, provider: "anthropic" };
      }
    }
  }

  // OpenAI / OpenAI-compatible
  {
    const m = message.match(/maximum context length is\s*(\d+)\s*tokens?.*requested\s*(\d+)\s*tokens?.*\((\d+)\s*in the messages?,\s*(\d+)\s*in the completion\)/i);
    if (m) {
      const contextLimit = Number(m[1]);
      const requested = Number(m[2]);
      const inputLength = Number(m[3]);
      const maxTokens = Number(m[4]);
      if (Number.isFinite(inputLength) && Number.isFinite(maxTokens) && Number.isFinite(contextLimit) && Number.isFinite(requested)) {
        return { inputLength, maxTokens, contextLimit, provider: "openai" };
      }
    }
  }

  // More relaxed OpenAI-compatible variants.
  {
    const m = message.match(/maximum context length is\s*(\d+)\s*tokens?/i);
    if (m) {
      const contextLimit = Number(m[1]);
      if (Number.isFinite(contextLimit)) {
        // We don't know the exact split; surface the limit so callers can retry with truncation.
        return { inputLength: 0, maxTokens: 0, contextLimit, provider: "openai" };
      }
    }
  }

  return null;
}

/**
 * @param {ContextOverflowInfo} info
 * @param {{ minTokens?: number, bufferTokens?: number }} [options]
 * @returns {number | null}
 */
export function computeOverflowRetryMaxTokens(info, { minTokens = 256, bufferTokens = 128 } = {}) {
  const min = Number.isFinite(minTokens) ? Math.max(1, Math.floor(minTokens)) : 256;
  const buffer = Number.isFinite(bufferTokens) ? Math.max(0, Math.floor(bufferTokens)) : 128;

  const limit = Number(info?.contextLimit);
  const input = Number(info?.inputLength);

  if (!Number.isFinite(limit) || !(limit > 0)) return null;

  // If we don't know input length, we can only fall back to a conservative minimum.
  if (!Number.isFinite(input) || input <= 0) return min;

  const available = limit - input - buffer;
  return Math.max(min, Math.floor(available));
}

/**
 * Execute `fn(maxTokens)` with context-overflow recovery:
 * - Detect a context overflow error
 * - Reduce maxTokens based on the API's reported context limit
 * - Retry up to `maxRetries`
 *
 * @template T
 * @param {(maxTokens: number) => Promise<T>} fn
 * @param {{
 *   initialMaxTokens: number,
 *   minTokens?: number,
 *   bufferTokens?: number,
 *   maxRetries?: number,
 *   onOverflow?: (args: { error: unknown, info: ContextOverflowInfo, nextMaxTokens: number, attempt: number }) => (void | Promise<void>),
 * }} options
 * @returns {Promise<T>}
 */
export async function executeWithOverflowRecovery(fn, options) {
  const initial = Number(options?.initialMaxTokens);
  const minTokens = options?.minTokens ?? 256;
  const bufferTokens = options?.bufferTokens ?? 128;
  const maxRetries = Number.isFinite(options?.maxRetries) ? Math.max(0, Math.floor(options.maxRetries)) : 2;
  const onOverflow = typeof options?.onOverflow === "function" ? options.onOverflow : null;

  let currentMaxTokens = Number.isFinite(initial) ? Math.max(1, Math.floor(initial)) : 1024;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(currentMaxTokens);
    } catch (error) {
      const info = parseContextOverflowError(error);
      if (!info || attempt >= maxRetries) throw error;

      const next = computeOverflowRetryMaxTokens(info, { minTokens, bufferTokens });
      const nextMaxTokens = Number.isFinite(next) ? Math.max(1, Math.floor(next)) : Math.max(1, Math.floor(currentMaxTokens * 0.75));

      // Ensure progress: always reduce, otherwise fall back to proportional reduction.
      const reduced = nextMaxTokens < currentMaxTokens ? nextMaxTokens : Math.max(1, Math.floor(currentMaxTokens * 0.75));

      currentMaxTokens = reduced;

      if (onOverflow) {
        await onOverflow({ error, info, nextMaxTokens: currentMaxTokens, attempt: attempt + 1 });
      }
    }
  }

  // Should be unreachable, but keep the type checker happy.
  throw new Error("executeWithOverflowRecovery: exhausted retries");
}

export default {
  parseContextOverflowError,
  computeOverflowRetryMaxTokens,
  executeWithOverflowRecovery,
};

