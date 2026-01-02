function toMessage(err) {
  if (err instanceof Error) return err.message || err.name || "Error";
  return String(err ?? "Error");
}

function hasStatusCode(msg, code) {
  return msg.includes(String(code));
}

/**
 * Classify model/tool errors into stable buckets so retry/degrade logic is consistent across generators.
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

export function isNonRetryableError(err) {
  const c = classifyDesignError(err);
  return c.kind === "auth" || c.kind === "config";
}

