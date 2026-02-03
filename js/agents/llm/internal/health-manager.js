import { CircuitBreaker } from "../../shared/index.js";
import { toNonEmptyString } from "../../shared/index.js";
import {
  computeCooldownMs,
  disableModel as disableModelInternal,
  getShortestCooldown as getShortestCooldownInternal,
  isPermanentAuthError,
  markHealthy as markHealthyInternal,
  markUnhealthy as markUnhealthyInternal,
  resetUnhealthy as resetUnhealthyInternal,
} from "./fallback.js";

const CIRCUIT_BREAKER_POOL_MAX = 100;
const CIRCUIT_BREAKER_STALE_MS = 30 * 60_000;
const CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS = 60_000;

/**
 * @param {{ healthMap: Map<string, any>, modelId: string }} input
 * @returns {any | null}
 */
export function getHealth({ healthMap, modelId }) {
  const id = toNonEmptyString(modelId);
  return id ? healthMap.get(id) || null : null;
}

/**
 * @param {{ healthMap: Map<string, any>, modelId: string }} input
 * @returns {any | null}
 */
export function resetUnhealthy({ healthMap, modelId }) {
  return resetUnhealthyInternal({ healthMap, modelId });
}

/**
 * @param {{ healthMap: Map<string, any>, modelId: string, time: { now: () => number } }} input
 * @returns {boolean}
 */
export function isAvailable({ healthMap, modelId, time }) {
  const id = toNonEmptyString(modelId);
  if (!id) return false;
  const h = healthMap.get(id);
  if (!h) return true;
  if (h.disabled === true) return false;
  const now = time.now();
  return !(typeof h.unhealthyUntilMs === "number" && h.unhealthyUntilMs > now);
}

/**
 * @param {{ backoffLevel: number, baseCooldownMs: number, maxCooldownMs: number, backoffMultiplier: number }} input
 * @returns {number}
 */
export function computeCooldownMsForBackoff({ backoffLevel, baseCooldownMs, maxCooldownMs, backoffMultiplier }) {
  return computeCooldownMs({ backoffLevel, baseCooldownMs, maxCooldownMs, backoffMultiplier });
}

/**
 * @param {{
 *   healthMap: Map<string, any>,
 *   time: { now: () => number },
 *   modelId: string,
 *   error: unknown,
 *   baseCooldownMs: number,
 *   maxCooldownMs: number,
 *   backoffMultiplier: number,
 * }} input
 * @returns {any | null}
 */
export function markUnhealthy({ healthMap, time, modelId, error, baseCooldownMs, maxCooldownMs, backoffMultiplier }) {
  return markUnhealthyInternal({
    healthMap,
    time: /** @type {any} */ (time),
    modelId,
    error,
    baseCooldownMs,
    maxCooldownMs,
    backoffMultiplier,
  });
}

/**
 * @param {{ healthMap: Map<string, any>, modelId: string, error: unknown, reason?: string }} input
 * @returns {any | null}
 */
export function disableModel({ healthMap, modelId, error, reason } = /** @type {any} */ ({})) {
  return disableModelInternal({ healthMap, modelId, error, reason });
}

/**
 * @param {{ healthMap: Map<string, any>, modelId: string }} input
 * @returns {any | null}
 */
export function markHealthy({ healthMap, modelId }) {
  return markHealthyInternal({ healthMap, modelId });
}

/**
 * @param {{ healthMap: Map<string, any>, time: { now: () => number }, candidates: string[] }} input
 * @returns {{ modelId: string, remainingMs: number } | null}
 */
export function getShortestCooldown({ healthMap, time, candidates }) {
  return getShortestCooldownInternal({ healthMap, time: /** @type {any} */ (time), candidates });
}

/**
 * @param {{ circuitBreakers: Map<string, any>, time: { now: () => number }, nowMs?: number | null }} input
 * @returns {void}
 */
export function cleanupStaleBreakers({ circuitBreakers, time, nowMs = null }) {
  const now = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : time.now();
  for (const [id, record] of circuitBreakers.entries()) {
    const lastUsedMs = record?.lastUsedMs;
    if (typeof lastUsedMs !== "number" || !Number.isFinite(lastUsedMs) || now - lastUsedMs > CIRCUIT_BREAKER_STALE_MS) {
      circuitBreakers.delete(id);
    }
  }
}

/**
 * @param {{ circuitBreakers: Map<string, any>, time: { now: () => number }, lastCleanupMs: number | null }} input
 * @returns {number | null}
 */
export function maybeCleanupStaleBreakers({ circuitBreakers, time, lastCleanupMs }) {
  const now = time.now();
  if (typeof lastCleanupMs === "number" && Number.isFinite(lastCleanupMs) && now - lastCleanupMs < CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS) {
    return lastCleanupMs;
  }
  cleanupStaleBreakers({ circuitBreakers, time, nowMs: now });
  return now;
}

/**
 * @param {{ circuitBreakers: Map<string, any> }} input
 * @returns {void}
 */
export function evictLruBreakers({ circuitBreakers }) {
  while (circuitBreakers.size > CIRCUIT_BREAKER_POOL_MAX) {
    let lruKey = null;
    let lruLastUsedMs = Infinity;
    for (const [id, record] of circuitBreakers.entries()) {
      const lastUsedMs =
        typeof record?.lastUsedMs === "number" && Number.isFinite(record.lastUsedMs) ? record.lastUsedMs : 0;
      if (lastUsedMs < lruLastUsedMs) {
        lruLastUsedMs = lastUsedMs;
        lruKey = id;
      }
    }
    if (lruKey === null) break;
    circuitBreakers.delete(lruKey);
  }
}

/**
 * @param {{
 *   modelId: string,
 *   circuitBreakers: Map<string, any>,
 *   time: { now: () => number },
 *   logger: { info: (msg: string, ...args: any[]) => void },
 *   emit: (event: string, ...args: any[]) => void,
 * }} input
 * @returns {CircuitBreaker | null}
 */
export function getCircuitBreaker({ modelId, circuitBreakers, time, logger, emit }) {
  const id = toNonEmptyString(modelId);
  if (!id) return null;

  const now = time.now();
  const existing = circuitBreakers.get(id);
  if (existing?.breaker) {
    existing.lastUsedMs = now;
    return existing.breaker;
  }

  const breaker = new CircuitBreaker({
    name: `model:${id}`,
    failureThreshold: 5, // 5 consecutive failures trip the breaker
    successThreshold: 2, // 2 successes in half-open to recover
    openDurationMs: 30_000, // open for 30 seconds
    halfOpenMaxCalls: 3, // allow 3 probe calls while half-open
    isFailure: (err) => {
      const e = /** @type {any} */ (err);
      // Exclude cancellations/timeouts from breaker accounting.
      if (e?.name === "AbortError") return false;
      if (e?.code === "TIMEOUT") return false;
      // Auth errors are handled by disableModel, not breaker.
      if (isPermanentAuthError(e)) return false;
      return true;
    },
    onStateChange: (event) => {
      logger.info(`[ModelRouter] Circuit breaker ${event.name}: ${event.from} \u2192 ${event.to} (${event.reason})`);
      emit("circuit:stateChange", event);
    },
    time,
  });

  circuitBreakers.set(id, { breaker, lastUsedMs: now });
  evictLruBreakers({ circuitBreakers });
  return breaker;
}

/**
 * @param {{ modelId: string, circuitBreakers: Map<string, any>, time: { now: () => number } }} input
 * @returns {any | null}
 */
export function getCircuitBreakerState({ modelId, circuitBreakers, time }) {
  const id = toNonEmptyString(modelId);
  if (!id) return null;
  const record = circuitBreakers.get(id);
  if (!record?.breaker) return null;
  record.lastUsedMs = time.now();
  return record.breaker.getStats();
}

/**
 * @param {{ modelId: string, circuitBreakers: Map<string, any>, time: { now: () => number } }} input
 * @returns {void}
 */
export function resetCircuitBreaker({ modelId, circuitBreakers, time }) {
  const id = toNonEmptyString(modelId);
  if (!id) return;
  const record = circuitBreakers.get(id);
  if (!record?.breaker) return;
  record.lastUsedMs = time.now();
  record.breaker.reset();
}
