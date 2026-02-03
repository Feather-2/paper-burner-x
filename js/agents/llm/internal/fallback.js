import { toNonEmptyString } from "../../shared/index.js";

/**
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void> }} ModelRouterTime
 */

/**
 * @typedef {{
 *   status?: unknown,
 *   statusCode?: unknown,
 *   httpStatus?: unknown,
 *   response?: { status?: unknown, statusCode?: unknown } | null,
 * }} HttpErrorLike
 */

/**
 * @param {unknown} err
 * @returns {{ name: string, message: string }}
 */
export function toErrorInfo(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  return { name: e.name, message: e.message };
}

/**
 * @param {unknown} err
 * @returns {number | null}
 */
export function extractHttpStatus(err) {
  if (!err || typeof err !== "object") return null;
  const e = /** @type {HttpErrorLike} */ (err);
  const direct = e.status ?? e.statusCode ?? e.httpStatus ?? null;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const nested = e.response?.status ?? e.response?.statusCode ?? null;
  if (typeof nested === "number" && Number.isFinite(nested)) return nested;
  return null;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isPermanentAuthError(err) {
  const status = extractHttpStatus(err);
  if (status === 401 || status === 403) return true;
  const msg = toErrorInfo(err).message.toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("invalid api key") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    (msg.includes("api key") && msg.includes("invalid")) ||
    (msg.includes("authentication") && msg.includes("fail"))
  );
}

/**
 * @param {{ backoffLevel: number, baseCooldownMs: number, maxCooldownMs: number, backoffMultiplier: number }} input
 * @returns {number}
 */
export function computeCooldownMs({ backoffLevel, baseCooldownMs, maxCooldownMs, backoffMultiplier }) {
  const level =
    typeof backoffLevel === "number" && Number.isFinite(backoffLevel) ? Math.max(0, Math.floor(backoffLevel)) : 0;
  const pow = level === 0 ? 1 : Math.pow(backoffMultiplier, level);
  let ms = baseCooldownMs * pow;

  if (!Number.isFinite(ms) || ms <= 0) ms = maxCooldownMs;
  ms = Math.floor(ms);
  if (ms > maxCooldownMs) ms = maxCooldownMs;
  return ms;
}

/**
 * @param {{
 *   healthMap: Map<string, any>,
 *   time: ModelRouterTime,
 *   modelId: string,
 *   error: unknown,
 *   baseCooldownMs: number,
 *   maxCooldownMs: number,
 *   backoffMultiplier: number,
 * }} input
 * @returns {{ failures: number, unhealthyUntilMs: number, lastError: { name: string, message: string }, cooldownMs: number, backoffLevel: number } | { cooldownMs: null, backoffLevel: null } | null}
 */
export function markUnhealthy({
  healthMap,
  time,
  modelId,
  error,
  baseCooldownMs,
  maxCooldownMs,
  backoffMultiplier,
}) {
  const id = toNonEmptyString(modelId);
  if (!id) return null;
  const now = time.now();
  const prev = healthMap.get(id) || { failures: 0 };
  if (prev.disabled === true) return { ...prev, cooldownMs: null, backoffLevel: null };
  const backoffLevel =
    typeof prev.failures === "number" && Number.isFinite(prev.failures) ? Math.max(0, Math.floor(prev.failures)) : 0;
  const cooldownMs = computeCooldownMs({ backoffLevel, baseCooldownMs, maxCooldownMs, backoffMultiplier });
  const next = {
    failures: backoffLevel + 1,
    unhealthyUntilMs: now + cooldownMs,
    lastError: toErrorInfo(error),
  };
  healthMap.set(id, next);
  return { ...next, cooldownMs, backoffLevel };
}

/**
 * @param {{ healthMap: Map<string, any>, modelId: string, error: unknown, reason?: string }} input
 * @returns {any | null}
 */
export function disableModel({ healthMap, modelId, error, reason } = /** @type {any} */ ({})) {
  const id = toNonEmptyString(modelId);
  if (!id) return null;
  const prev = healthMap.get(id) || { failures: 0, unhealthyUntilMs: 0 };
  const failures =
    typeof prev.failures === "number" && Number.isFinite(prev.failures) ? Math.max(0, Math.floor(prev.failures)) + 1 : 1;
  const reasonText = toNonEmptyString(reason);
  const next = {
    ...prev,
    failures,
    unhealthyUntilMs: 0,
    lastError: toErrorInfo(error),
    disabled: true,
    ...(reasonText ? { disabledReason: reasonText } : {}),
  };
  healthMap.set(id, next);
  return next;
}

/**
 * @param {{ healthMap: Map<string, any>, modelId: string }} input
 * @returns {any | null}
 */
export function markHealthy({ healthMap, modelId }) {
  const id = toNonEmptyString(modelId);
  if (!id) return null;
  const prev = healthMap.get(id);
  if (!prev) return null;
  const next = { ...prev, failures: 0, unhealthyUntilMs: 0 };
  if (next.disabled) {
    next.disabled = false;
    delete next.disabledReason;
  }
  healthMap.set(id, next);
  return next;
}

/**
 * @param {{ healthMap: Map<string, any>, modelId: string }} input
 * @returns {any | null}
 */
export function resetUnhealthy({ healthMap, modelId }) {
  const id = toNonEmptyString(modelId);
  if (!id) return null;
  const prev = healthMap.get(id);
  if (!prev) return null;
  const next = { ...prev, unhealthyUntilMs: 0 };
  if (next.disabled) {
    next.disabled = false;
    delete next.disabledReason;
  }
  healthMap.set(id, next);
  return next;
}

/**
 * @param {{ healthMap: Map<string, any>, time: ModelRouterTime, candidates: string[] }} input
 * @returns {{ modelId: string, remainingMs: number } | null}
 */
export function getShortestCooldown({ healthMap, time, candidates }) {
  const now = time.now();
  let shortest = null;
  for (const modelId of candidates) {
    const h = healthMap.get(modelId);
    if (h?.unhealthyUntilMs > now) {
      const remaining = h.unhealthyUntilMs - now;
      if (!shortest || remaining < shortest.remainingMs) {
        shortest = { modelId, remainingMs: remaining };
      }
    }
  }
  return shortest;
}
