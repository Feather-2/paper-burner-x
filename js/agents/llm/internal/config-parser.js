import { assertModelEntry, assertProvider, assertUsageConfig, normalizeModelTags } from "../provider.js";
import { RouterStrategy, normalizeRouterStrategy } from "../constants.js";
import { safeJsonParse } from "../../shared/index.js";
import { ModelEventEmitter } from "../model-events.js";
import { RetryStrategy } from "../../shared/retry-strategy.js";
import { PerformanceRouter, ModelTier } from "../performance-router.js";
import { isPlainObject, toNonEmptyString, toPositiveInt } from "../../shared/index.js";

const DEFAULT_BASE_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_COOLDOWN_MS = 600_000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_COOLDOWN_WAIT_MAX_RETRIES = 1;
const DEFAULT_COOLDOWN_WAIT_MAX_MS = 30_000;
const DEFAULT_COOLDOWN_WAIT_BUFFER_MS = 100;
const DEFAULT_COOLDOWN_WAIT_BACKOFF_MULTIPLIER = 1;

/**
 * @param {unknown} value
 * @returns {value is { getItem: (key: string) => string | null, setItem: (key: string, value: string) => void }}
 */
function isStorageLike(value) {
  const v =
    value && typeof value === "object" ? /** @type {{ getItem?: unknown, setItem?: unknown }} */ (value) : null;
  return !!v && typeof v.getItem === "function" && typeof v.setItem === "function";
}

function isRetryStrategyLike(value) {
  return value !== null && typeof value === "object" && typeof value.execute === "function";
}

function resolveRetryStrategy(retryStrategy, retryConfig) {
  if (isRetryStrategyLike(retryStrategy)) return retryStrategy;
  const cfg = isPlainObject(retryConfig)
    ? retryConfig
    : isPlainObject(retryStrategy) && !isRetryStrategyLike(retryStrategy)
      ? retryStrategy
      : null;
  if (!cfg) return null;
  try {
    return new RetryStrategy(cfg);
  } catch {
    return null;
  }
}

function toBackoffMultiplier(v, fallback) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : NaN;
  if (n >= 1) return n;
  if (n > 0) return 1;
  return fallback;
}

function toNonNegativeInt(v, fallback) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
function createNoopLogger() {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}

/**
 * @param {unknown} logger
 * @returns {asserts logger is { debug: Function, info: Function, warn: Function, error: Function }}
 */
function assertLoggerLike(logger) {
  if (!isPlainObject(logger)) throw new TypeError("ModelRouter: logger must be an object");
  for (const k of ["debug", "info", "warn", "error"]) {
    if (typeof logger[k] !== "function") throw new TypeError(`ModelRouter: logger.${k} must be a function`);
  }
}

/**
 * @param {{ debug?: boolean, logger?: any }} [options]
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
function resolveLogger({ debug, logger } = {}) {
  if (!debug) return createNoopLogger();
  if (logger !== undefined) {
    assertLoggerLike(logger);
    return logger;
  }

  // No implicit console fallback in kernel code.
  return createNoopLogger();
}

function isValidModelTier(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (Object.values(ModelTier)).includes(value);
}

function normalizeTierFromTagsOrId(modelId, modelEntry) {
  const explicit = toNonEmptyString(modelEntry?.tier);
  if (explicit && isValidModelTier(explicit)) return explicit;

  const tags = Array.isArray(modelEntry?.tags) ? modelEntry.tags : [];
  const tagSet = new Set(tags.map((t) => String(t).toLowerCase()));
  if (tagSet.has("fallback")) return ModelTier.FALLBACK;
  if (tagSet.has("fast") || tagSet.has("cheap")) return ModelTier.FAST;

  const id = String(modelId || "").toLowerCase();
  // Best-effort heuristic for PPT "site:model" and common provider naming.
  if (/(^|[^a-z])(flash|turbo|mini|small|lite)([^a-z]|$)/.test(id)) return ModelTier.FAST;

  return ModelTier.POWER;
}

function defaultTime() {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/**
 * @param {{ tierResolver: any, modelId: string, modelEntry: any, usage?: string, images?: any[] }} input
 * @returns {string}
 */
export function resolveEndpointTier({ tierResolver, modelId, modelEntry, usage, images }) {
  if (typeof tierResolver === "function") {
    try {
      const custom = tierResolver({ modelId, modelEntry, usage, images });
      if (isValidModelTier(custom)) return custom;
    } catch {
      // ignore tier resolver errors
    }
  }
  return normalizeTierFromTagsOrId(modelId, modelEntry);
}

/**
 * @param {{ strategy: string, performanceRouting: boolean | null }} input
 * @returns {boolean}
 */
export function shouldUsePerformanceRouting({ strategy, performanceRouting }) {
  if (performanceRouting === false) return false;
  if (performanceRouting === true) return true;
  return strategy === RouterStrategy.LATENCY_OPTIMIZED;
}

/**
 * @param {any} router
 * @param {import("../model-router.js").ModelRouterOptions} [options]
 * @returns {any}
 */
export function applyModelRouterConfig(
  router,
  {
    models,
    usageConfig,
    providers,
    cooldown,
    cooldownMs,
    baseCooldownMs,
    maxCooldownMs,
    backoffMultiplier,
    cooldownWaitMaxRetries,
    cooldownWaitMaxMs,
    cooldownWaitBufferMs,
    cooldownWaitBackoffMultiplier,
    usageTags,
    time,
    retryStrategy = null,
    retry = null,
    debug = false,
    logger,
    strategy = "round_robin",
    persistRoundRobin = false,
    roundRobinStorageKey = "paperburner_modelrouter_rr_v1",
    storage = null,
    performanceRouting,
    performanceRouter = null,
    tierResolver = null,
  } = {}
) {
  router._events = new ModelEventEmitter();

  if (debug !== undefined && typeof debug !== "boolean") throw new TypeError("ModelRouter: debug must be a boolean");
  const normalizedStrategy = normalizeRouterStrategy(strategy, "");
  if (!normalizedStrategy) {
    throw new TypeError(`ModelRouter: strategy must be one of ${Object.values(RouterStrategy).join(", ")}`);
  }

  router._debug = debug;
  router._logger = resolveLogger({ debug, logger });
  router._strategy = normalizedStrategy;
  router._performanceRouting = typeof performanceRouting === "boolean" ? performanceRouting : null;
  router._tierResolver = typeof tierResolver === "function" ? tierResolver : null;
  router._performanceRouter =
    performanceRouter instanceof PerformanceRouter
      ? performanceRouter
      : new PerformanceRouter({
          preferFastTier: true,
          ...(debug
            ? {
                onRouteDecision: ({ endpointId, reason, complexity }) => {
                  router._logger.debug(`[ModelRouter] perfRoute ${endpointId} (${complexity}): ${reason}`);
                },
              }
            : {}),
        });

  // Round-robin cursor per usage. Values are either:
  // - number: legacy "next start index" (persisted as number)
  // - string: next start model id (preferred, resilient to list reordering)
  router._rrNextIndexByUsage = new Map();
  router._persistRoundRobin = !!persistRoundRobin;
  router._roundRobinStorageKey = toNonEmptyString(roundRobinStorageKey) || "paperburner_modelrouter_rr_v1";
  router._roundRobinStorage = isStorageLike(storage) ? storage : null;

  router._time = isPlainObject(time) && typeof time.now === "function" && typeof time.sleep === "function" ? time : defaultTime();
  router._retryStrategy = resolveRetryStrategy(retryStrategy, retry);

  const cooldownCfg = isPlainObject(cooldown) ? cooldown : null;
  const hasCooldownCfg = !!cooldownCfg && Object.keys(cooldownCfg).length > 0;
  const legacyOnlyCooldownMs =
    !hasCooldownCfg &&
    cooldownMs !== undefined &&
    baseCooldownMs === undefined &&
    maxCooldownMs === undefined &&
    backoffMultiplier === undefined;

  const baseMs = toPositiveInt(
    cooldownCfg?.baseMs ?? cooldownCfg?.baseCooldownMs ?? baseCooldownMs ?? cooldownMs,
    DEFAULT_BASE_COOLDOWN_MS
  );
  const maxMsRaw = legacyOnlyCooldownMs
    ? baseMs
    : toPositiveInt(cooldownCfg?.maxMs ?? cooldownCfg?.maxCooldownMs ?? maxCooldownMs, DEFAULT_MAX_COOLDOWN_MS);
  const maxMs = Math.max(baseMs, maxMsRaw);

  router._baseCooldownMs = baseMs;
  router._maxCooldownMs = maxMs;
  router._backoffMultiplier = toBackoffMultiplier(
    cooldownCfg?.multiplier ?? cooldownCfg?.backoffMultiplier ?? backoffMultiplier,
    DEFAULT_BACKOFF_MULTIPLIER
  );
  const cooldownWaitCfg = isPlainObject(cooldownCfg?.wait) ? cooldownCfg.wait : null;
  router._cooldownWaitMaxRetries = toNonNegativeInt(
    cooldownWaitCfg?.maxRetries ?? cooldownCfg?.waitMaxRetries ?? cooldownWaitMaxRetries,
    DEFAULT_COOLDOWN_WAIT_MAX_RETRIES
  );
  router._cooldownWaitMaxMs = toNonNegativeInt(
    cooldownWaitCfg?.maxMs ?? cooldownCfg?.waitMaxMs ?? cooldownWaitMaxMs,
    DEFAULT_COOLDOWN_WAIT_MAX_MS
  );
  router._cooldownWaitBufferMs = toNonNegativeInt(
    cooldownWaitCfg?.bufferMs ?? cooldownCfg?.waitBufferMs ?? cooldownWaitBufferMs,
    DEFAULT_COOLDOWN_WAIT_BUFFER_MS
  );
  router._cooldownWaitBackoffMultiplier = toBackoffMultiplier(
    cooldownWaitCfg?.backoffMultiplier ?? cooldownCfg?.waitBackoffMultiplier ?? cooldownWaitBackoffMultiplier,
    DEFAULT_COOLDOWN_WAIT_BACKOFF_MULTIPLIER
  );
  // Backward-compatible alias (legacy callers/events).
  router._cooldownMs = baseMs;

  router._models = new Map();
  for (const m of Array.isArray(models) ? models : []) {
    assertModelEntry(m);
    router._models.set(m.id, { ...m, tags: normalizeModelTags(m.tags) });
  }

  assertUsageConfig(usageConfig || {});
  router._usageConfig = usageConfig || {};

  router._providers = new Map();
  if (providers instanceof Map) {
    for (const [id, p] of providers.entries()) router._providers.set(String(id), p);
  } else if (isPlainObject(providers)) {
    for (const [id, p] of Object.entries(providers)) router._providers.set(String(id), p);
  }
  for (const p of router._providers.values()) assertProvider(p);

  router._usageTags = new Map();
  if (isPlainObject(usageTags)) {
    for (const [usage, tags] of Object.entries(usageTags)) {
      const u = toNonEmptyString(usage);
      if (!u) continue;
      const list = normalizeModelTags(tags);
      router._usageTags.set(u, list);
    }
  }

  router._health = new Map(); // modelId -> {unhealthyUntilMs, failures, lastError}
  router._rateLimiters = new Map(); // modelId -> TokenBucketRateLimiter
  router._circuitBreakers = new Map(); // modelId -> { breaker: CircuitBreaker, lastUsedMs: number }
  router._lastCircuitBreakerCleanupMs = null;
  router._stateSyncVersion = 0;

  if (router._persistRoundRobin && router._roundRobinStorage) {
    try {
      const raw = router._roundRobinStorage.getItem(router._roundRobinStorageKey);
      const parsed = safeJsonParse(raw, { maxChars: 200_000 });
      if (parsed && typeof parsed === "object") {
        for (const [usage, idx] of Object.entries(parsed)) {
          const u = toNonEmptyString(usage);
          if (!u) continue;
          if (typeof idx === "string") {
            const m = toNonEmptyString(idx);
            if (m) router._rrNextIndexByUsage.set(u, m);
            continue;
          }
          const n = Number(idx);
          if (!Number.isFinite(n) || n < 0) continue;
          router._rrNextIndexByUsage.set(u, Math.floor(n));
        }
      }
    } catch {
      // ignore
    }
  }

  return router;
}
