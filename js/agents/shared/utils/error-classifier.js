import { toNonEmptyString } from "./value-utils.js";

function toError(err) {
  if (err instanceof Error) return err;
  return new Error(toNonEmptyString(err) ?? String(err));
}

function getErrorMessage(err) {
  const e = toError(err);
  return toNonEmptyString(e.message) ?? "Unknown error";
}

function collectCauseChain(err, maxDepth = 8) {
  const chain = [];
  const seen = new Set();

  let cur = err;
  let depth = 0;
  while (cur && depth < maxDepth) {
    if (seen.has(cur)) break;
    seen.add(cur);
    chain.push(cur);

    const next = cur instanceof Error ? cur.cause : cur?.cause;
    if (!next) break;
    cur = next;
    depth += 1;
  }

  return chain;
}

function extractStatusCodeFromValue(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function extractStatusCode(err) {
  const chain = collectCauseChain(err);
  for (const item of chain) {
    if (!item) continue;

    const direct = extractStatusCodeFromValue(item.status ?? item.statusCode ?? item.httpStatus);
    if (direct !== null) return direct;

    const nested = item?.response?.status ?? item?.response?.statusCode;
    const nestedStatus = extractStatusCodeFromValue(nested);
    if (nestedStatus !== null) return nestedStatus;
  }
  return null;
}

function extractErrorCode(err) {
  const chain = collectCauseChain(err);
  for (const item of chain) {
    const code = toNonEmptyString(item?.code);
    if (code) return code;
  }
  return null;
}

function normalizeMessageForMatch(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function messageIncludes(message, patterns) {
  const m = normalizeMessageForMatch(message);
  return patterns.some((p) => m.includes(p));
}

/**
 * DeepSearch error classifier (stages/deepsearch)
 * @param {unknown} err - The error to classify.
 * @returns {{ recoverable: boolean, category: string, statusCode: number | null, code: string | null, message: string }} Classification result.
 */
export function classifyDeepSearchError(err) {
  const chain = collectCauseChain(err);
  const message = chain.map(getErrorMessage).filter(Boolean).join(" | ");
  const normalizedMessage = normalizeMessageForMatch(message);

  const statusCode = extractStatusCode(err);
  const code = extractErrorCode(err);

  // Non-recoverable system/config/auth/billing errors.
  if (
    messageIncludes(normalizedMessage, [
      "no model available",
      "no models configured for usage",
      "unknown model id",
      "missing provider:",
    ])
  ) {
    return { recoverable: false, category: "config", statusCode, code, message };
  }

  if (code === "ENOSPC" || messageIncludes(normalizedMessage, ["no space left on device", "disk quota exceeded"])) {
    return { recoverable: false, category: "system", statusCode, code, message };
  }

  if (statusCode === 401 || statusCode === 403) {
    return { recoverable: false, category: "auth", statusCode, code, message };
  }

  if (
    messageIncludes(normalizedMessage, [
      "invalid api key",
      "incorrect api key",
      "api key invalid",
      "unauthorized",
      "forbidden",
      "authentication",
      "missing api key",
      "no api key",
    ])
  ) {
    return { recoverable: false, category: "auth", statusCode, code, message };
  }

  if (
    messageIncludes(normalizedMessage, [
      "insufficient_quota",
      "insufficient quota",
      "quota exceeded",
      "exceeded your current quota",
      "billing",
      "payment required",
      "account has been deactivated",
    ])
  ) {
    return { recoverable: false, category: "quota", statusCode, code, message };
  }

  // Recoverable transient errors.
  if (
    statusCode === 429 ||
    messageIncludes(normalizedMessage, [
      "rate limit",
      "too many requests",
      "throttl",
      "overloaded",
      "temporarily unavailable",
      "try again later",
    ])
  ) {
    return { recoverable: true, category: "rate_limit", statusCode, code, message };
  }

  if (statusCode === 408) return { recoverable: true, category: "timeout", statusCode, code, message };
  if (statusCode !== null && statusCode >= 500) {
    return { recoverable: true, category: "server", statusCode, code, message };
  }

  if (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    messageIncludes(normalizedMessage, ["timeout", "timed out", "fetch failed", "networkerror", "socket hang up"])
  ) {
    return { recoverable: true, category: "network", statusCode, code, message };
  }

  if (statusCode === 400 || statusCode === 404 || statusCode === 405 || statusCode === 409 || statusCode === 422) {
    return { recoverable: false, category: "invalid_request", statusCode, code, message };
  }

  return { recoverable: true, category: "unknown", statusCode, code, message };
}

/**
 * Check if a DeepSearch error is non-recoverable.
 * @param {unknown} err - The error to check.
 * @returns {boolean} True if the error is non-recoverable.
 */
export function isNonRecoverableDeepSearchError(err) {
  return classifyDeepSearchError(err).recoverable === false;
}

/**
 * Extract the error message from a DeepSearch error.
 * @param {unknown} err - The error to extract message from.
 * @returns {string} The formatted error message.
 */
export function toDeepSearchErrorMessage(err) {
  return classifyDeepSearchError(err).message;
}

function toMessage(err) {
  if (err instanceof Error) return err.message || err.name || "Error";
  return String(err ?? "Error");
}

function hasStatusCode(msg, code) {
  return msg.includes(String(code));
}

/**
 * Design error classifier (stages/design)
 *
 * @param {unknown} err
 * @returns {{ kind: "auth"|"config"|"rate_limit"|"network"|"timeout"|"unknown", code: string, canRetry: boolean }}
 */
export function classifyDesignError(err) {
  const msg = toMessage(err);
  const lower = msg.toLowerCase();

  if (
    hasStatusCode(msg, 401) ||
    hasStatusCode(msg, 403) ||
    lower.includes("invalid api key") ||
    lower.includes("api key") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  ) {
    return { kind: "auth", code: "AUTH", canRetry: false };
  }

  if (lower.includes("no available model") || lower.includes("no available model config") || lower.includes("not available")) {
    return { kind: "config", code: "CONFIG", canRetry: false };
  }

  if (hasStatusCode(msg, 429) || lower.includes("rate limit") || lower.includes("too many requests")) {
    return { kind: "rate_limit", code: "RATE_LIMIT", canRetry: true };
  }

  if (lower.includes("timeout") || lower.includes("etimedout")) {
    return { kind: "timeout", code: "TIMEOUT", canRetry: true };
  }

  if (
    lower.includes("econnreset") ||
    lower.includes("network") ||
    hasStatusCode(msg, 502) ||
    hasStatusCode(msg, 503) ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable")
  ) {
    return { kind: "network", code: "NETWORK", canRetry: true };
  }

  return { kind: "unknown", code: "UNKNOWN", canRetry: false };
}

/**
 * Check if a Design error is non-retryable (auth or config errors).
 * @param {unknown} err - The error to check.
 * @returns {boolean} True if the error should not be retried.
 */
export function isNonRetryableError(err) {
  const c = classifyDesignError(err);
  return c.kind === "auth" || c.kind === "config";
}

