import { toNonEmptyString } from "../shared/index.js";

const OVERFLOW_RETRY_STATE_VERSION = 1;
const DEFAULT_OVERFLOW_RETRY_ARCHIVE_KEY = "llm:overflow-recovery";

/**
 * @typedef {object} ContextOverflowInfo
 * @property {number} inputLength
 * @property {number} maxTokens
 * @property {number} contextLimit
 * @property {string} [provider]
 */

/**
 * @typedef {object} OverflowRetryState
 * @property {number} version
 * @property {boolean} inProgress
 * @property {number} attempt
 * @property {number} [currentMaxTokens]
 * @property {number} [updatedAt]
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

function normalizeArchiveKey(key) {
  return toNonEmptyString(key) || DEFAULT_OVERFLOW_RETRY_ARCHIVE_KEY;
}

/**
 * @param {unknown} raw
 * @returns {OverflowRetryState | null}
 */
function normalizeOverflowRetryState(raw) {
  const fromNodeStates = raw?.nodeStates?.overflowRecovery;
  const fromPayload = raw?.overflowRecovery;
  const candidate =
    fromNodeStates && typeof fromNodeStates === "object"
      ? fromNodeStates
      : fromPayload && typeof fromPayload === "object"
        ? fromPayload
        : raw && typeof raw === "object"
          ? raw
          : null;

  if (!candidate || typeof candidate !== "object") return null;

  const attempt = Number(candidate.attempt);
  if (!Number.isFinite(attempt) || attempt < 0) return null;

  const out = {
    version: OVERFLOW_RETRY_STATE_VERSION,
    inProgress: candidate.inProgress === undefined ? attempt > 0 : Boolean(candidate.inProgress),
    attempt: Math.max(0, Math.floor(attempt)),
  };

  const currentMaxTokens = Number(candidate.currentMaxTokens);
  if (Number.isFinite(currentMaxTokens) && currentMaxTokens > 0) {
    out.currentMaxTokens = Math.max(1, Math.floor(currentMaxTokens));
  }

  const updatedAt = Number(candidate.updatedAt);
  if (Number.isFinite(updatedAt) && updatedAt > 0) {
    out.updatedAt = Math.floor(updatedAt);
  }

  return out;
}

/**
 * @param {object | null | undefined} archive
 * @param {string} archiveKey
 * @returns {Promise<OverflowRetryState | null>}
 */
async function loadOverflowRetryState(archive, archiveKey) {
  if (!archive || typeof archive !== "object") return null;

  try {
    let raw = null;
    if (typeof archive.get === "function") {
      raw = await archive.get(archiveKey);
    } else if (typeof archive.load === "function") {
      raw = await archive.load(archiveKey);
    } else if (typeof archive.restore === "function") {
      raw = await archive.restore(archiveKey);
    } else {
      return null;
    }
    return normalizeOverflowRetryState(raw);
  } catch {
    return null;
  }
}

/**
 * @param {object | null | undefined} archive
 * @param {string} archiveKey
 * @param {Partial<OverflowRetryState>} state
 * @returns {Promise<boolean>}
 */
async function persistOverflowRetryState(archive, archiveKey, state) {
  if (!archive || typeof archive !== "object") return false;

  const payload = {
    version: OVERFLOW_RETRY_STATE_VERSION,
    inProgress: Boolean(state?.inProgress),
    attempt: Number.isFinite(state?.attempt) ? Math.max(0, Math.floor(state.attempt)) : 0,
    updatedAt: Date.now(),
  };

  if (Number.isFinite(state?.currentMaxTokens) && state.currentMaxTokens > 0) {
    payload.currentMaxTokens = Math.max(1, Math.floor(state.currentMaxTokens));
  }

  if (Number.isFinite(state?.updatedAt) && state.updatedAt > 0) {
    payload.updatedAt = Math.floor(state.updatedAt);
  }

  try {
    if (typeof archive.set === "function") {
      await archive.set(archiveKey, payload);
      return true;
    }
    if (typeof archive.save === "function") {
      await archive.save(archiveKey, {
        nodeStates: { overflowRecovery: payload },
        timestamp: String(payload.updatedAt),
        metadata: {
          kind: "overflow_recovery_retry_state",
          version: OVERFLOW_RETRY_STATE_VERSION,
        },
      });
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * @param {object | null | undefined} archive
 * @param {string} archiveKey
 * @param {number} currentMaxTokens
 * @returns {Promise<void>}
 */
async function clearOverflowRetryState(archive, archiveKey, currentMaxTokens) {
  if (!archive || typeof archive !== "object") return;

  if (typeof archive.delete === "function" && typeof archive.set === "function") {
    try {
      await archive.delete(archiveKey);
      return;
    } catch {
      // Ignore delete failures and fall back to reset marker.
    }
  }

  await persistOverflowRetryState(archive, archiveKey, {
    inProgress: false,
    attempt: 0,
    currentMaxTokens,
  });
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
 *   archive?: { get?: (key: string) => Promise<unknown>, set?: (key: string, value: unknown) => Promise<unknown>, delete?: (key: string) => Promise<unknown>, load?: (key: string) => Promise<unknown>, save?: (runId: string, value: unknown) => Promise<unknown>, restore?: (checkpointId: string) => Promise<unknown> },
 *   archiveKey?: string,
 * }} options
 * @returns {Promise<T>}
 */
export async function executeWithOverflowRecovery(fn, options) {
  const initial = Number(options?.initialMaxTokens);
  const minTokens = options?.minTokens ?? 256;
  const bufferTokens = options?.bufferTokens ?? 128;
  const maxRetries = Number.isFinite(options?.maxRetries) ? Math.max(0, Math.floor(options.maxRetries)) : 2;
  const onOverflow = typeof options?.onOverflow === "function" ? options.onOverflow : null;
  const archive = options?.archive && typeof options.archive === "object" ? options.archive : null;
  const archiveKey = normalizeArchiveKey(options?.archiveKey);

  let currentMaxTokens = Number.isFinite(initial) ? Math.max(1, Math.floor(initial)) : 1024;
  let startAttempt = 0;

  const persistedState = await loadOverflowRetryState(archive, archiveKey);
  if (persistedState?.inProgress && persistedState.attempt > 0) {
    if (persistedState.attempt <= maxRetries) {
      startAttempt = persistedState.attempt;
      if (Number.isFinite(persistedState.currentMaxTokens) && persistedState.currentMaxTokens > 0) {
        currentMaxTokens = Math.max(1, Math.floor(persistedState.currentMaxTokens));
      }
    } else {
      await clearOverflowRetryState(archive, archiveKey, currentMaxTokens);
    }
  }

  for (let attempt = startAttempt; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn(currentMaxTokens);
      await clearOverflowRetryState(archive, archiveKey, currentMaxTokens);
      return result;
    } catch (error) {
      const info = parseContextOverflowError(error);
      if (!info || attempt >= maxRetries) {
        await clearOverflowRetryState(archive, archiveKey, currentMaxTokens);
        throw error;
      }

      const next = computeOverflowRetryMaxTokens(info, { minTokens, bufferTokens });
      const nextMaxTokens = Number.isFinite(next) ? Math.max(1, Math.floor(next)) : Math.max(1, Math.floor(currentMaxTokens * 0.75));

      // Ensure progress: always reduce, otherwise fall back to proportional reduction.
      const reduced = nextMaxTokens < currentMaxTokens ? nextMaxTokens : Math.max(1, Math.floor(currentMaxTokens * 0.75));

      currentMaxTokens = reduced;
      await persistOverflowRetryState(archive, archiveKey, {
        inProgress: true,
        attempt: attempt + 1,
        currentMaxTokens,
      });

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
