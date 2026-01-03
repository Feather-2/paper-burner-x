import { assertChatMessages, assertChatResponse, assertModelEntry, assertProvider, assertUsageConfig, normalizeModelTags } from "./provider.js";
import { ModelUsage, RouterStrategy, isValidModelUsage, normalizeRouterStrategy } from "./constants.js";
import { TokenBucketRateLimiter } from "./rate-limit.js";
import { safeJsonParse } from "../shared/utils/safe-json.js";
import { CircuitBreaker, CircuitState } from "../shared/utils/circuit-breaker.js";
import { getGlobalTokenTracker } from "../runtime/telemetry/token-tracker.js";
import { ModelEventEmitter } from "./model-events.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStorageLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.getItem === "function" &&
    typeof value.setItem === "function"
  );
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function toErrorInfo(err) {
  const e = err instanceof Error ? err : new Error(String(err));
  return { name: e.name, message: e.message };
}

function toPositiveInt(v, fallback) {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : NaN;
  return n > 0 ? n : fallback;
}

function toBackoffMultiplier(v, fallback) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : NaN;
  if (n >= 1) return n;
  if (n > 0) return 1;
  return fallback;
}

function extractHttpStatus(err) {
  if (!err || typeof err !== "object") return null;
  const direct = err.status ?? err.statusCode ?? err.httpStatus ?? null;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const nested = err.response?.status ?? err.response?.statusCode ?? null;
  if (typeof nested === "number" && Number.isFinite(nested)) return nested;
  return null;
}

function isPermanentAuthError(err) {
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

function createNoopLogger() {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}

function assertLoggerLike(logger) {
  if (!isPlainObject(logger)) throw new TypeError("ModelRouter: logger must be an object");
  for (const k of ["debug", "info", "warn", "error"]) {
    if (typeof logger[k] !== "function") throw new TypeError(`ModelRouter: logger.${k} must be a function`);
  }
}

function resolveLogger({ debug, logger } = {}) {
  if (!debug) return createNoopLogger();
  if (logger !== undefined) {
    assertLoggerLike(logger);
    return logger;
  }

  // No implicit console fallback in kernel code.
  return createNoopLogger();
}

function rotateFromIndex(list, startIndex) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length <= 1) return arr.slice();
  const start = ((startIndex || 0) % arr.length + arr.length) % arr.length;
  return arr.slice(start).concat(arr.slice(0, start));
}

function defaultTime() {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

const CIRCUIT_BREAKER_POOL_MAX = 100;
const CIRCUIT_BREAKER_STALE_MS = 30 * 60_000;
const CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS = 60_000;

export class ModelRouter {
  constructor({
    models,
    usageConfig,
    providers,
    cooldown,
    cooldownMs,
    baseCooldownMs,
    maxCooldownMs,
    backoffMultiplier,
    usageTags,
    time,
    debug = false,
    logger,
    strategy = "round_robin",
    persistRoundRobin = false,
    roundRobinStorageKey = "paperburner_modelrouter_rr_v1",
    storage = null,
  } = {}) {
    this._events = new ModelEventEmitter();

    if (debug !== undefined && typeof debug !== "boolean") throw new TypeError("ModelRouter: debug must be a boolean");
    const normalizedStrategy = normalizeRouterStrategy(strategy, "");
    if (!normalizedStrategy) {
      throw new TypeError(`ModelRouter: strategy must be one of ${Object.values(RouterStrategy).join(", ")}`);
    }

    this._debug = debug;
    this._logger = resolveLogger({ debug, logger });
    this._strategy = normalizedStrategy;
    // Round-robin cursor per usage. Values are either:
    // - number: legacy "next start index" (persisted as number)
    // - string: next start model id (preferred, resilient to list reordering)
    this._rrNextIndexByUsage = new Map();
    this._persistRoundRobin = !!persistRoundRobin;
    this._roundRobinStorageKey = toNonEmptyString(roundRobinStorageKey) || "paperburner_modelrouter_rr_v1";
    this._roundRobinStorage = isStorageLike(storage) ? storage : null;

    this._time = isPlainObject(time) && typeof time.now === "function" && typeof time.sleep === "function" ? time : defaultTime();

    const DEFAULT_BASE_COOLDOWN_MS = 60_000;
    const DEFAULT_MAX_COOLDOWN_MS = 600_000;
    const DEFAULT_BACKOFF_MULTIPLIER = 2;

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

    this._baseCooldownMs = baseMs;
    this._maxCooldownMs = maxMs;
    this._backoffMultiplier = toBackoffMultiplier(
      cooldownCfg?.multiplier ?? cooldownCfg?.backoffMultiplier ?? backoffMultiplier,
      DEFAULT_BACKOFF_MULTIPLIER
    );
    // Backward-compatible alias (legacy callers/events).
    this._cooldownMs = baseMs;

    this._models = new Map();
    for (const m of Array.isArray(models) ? models : []) {
      assertModelEntry(m);
      this._models.set(m.id, { ...m, tags: normalizeModelTags(m.tags) });
    }

    assertUsageConfig(usageConfig || {});
    this._usageConfig = usageConfig || {};

    this._providers = new Map();
    if (providers instanceof Map) {
      for (const [id, p] of providers.entries()) this._providers.set(String(id), p);
    } else if (isPlainObject(providers)) {
      for (const [id, p] of Object.entries(providers)) this._providers.set(String(id), p);
    }
    for (const p of this._providers.values()) assertProvider(p);

    this._usageTags = new Map();
    if (isPlainObject(usageTags)) {
      for (const [usage, tags] of Object.entries(usageTags)) {
        const u = toNonEmptyString(usage);
        if (!u) continue;
        const list = normalizeModelTags(tags);
        this._usageTags.set(u, list);
      }
    }

    this._health = new Map(); // modelId -> {unhealthyUntilMs, failures, lastError}
    this._rateLimiters = new Map(); // modelId -> TokenBucketRateLimiter
    this._circuitBreakers = new Map(); // modelId -> { breaker: CircuitBreaker, lastUsedMs: number }
    this._lastCircuitBreakerCleanupMs = null;

    if (this._persistRoundRobin && this._roundRobinStorage) {
      try {
        const raw = this._roundRobinStorage.getItem(this._roundRobinStorageKey);
        const parsed = safeJsonParse(raw, { maxChars: 200_000 });
        if (parsed && typeof parsed === "object") {
          for (const [usage, idx] of Object.entries(parsed)) {
            const u = toNonEmptyString(usage);
            if (!u) continue;
            if (typeof idx === "string") {
              const m = toNonEmptyString(idx);
              if (m) this._rrNextIndexByUsage.set(u, m);
              continue;
            }
            const n = Number(idx);
            if (!Number.isFinite(n) || n < 0) continue;
            this._rrNextIndexByUsage.set(u, Math.floor(n));
          }
        }
      } catch {
        // ignore
      }
    }
  }

  on(event, listener) {
    this._events.on(event, listener);
    return this;
  }

  off(event, listener) {
    this._events.off(event, listener);
    return this;
  }

  emit(event, ...args) {
    this._events.emit(event, ...args);
    return this;
  }

  removeAllListeners(event) {
    this._events.removeAllListeners(event);
    return this;
  }

  getModelEntry(modelId) {
    const id = toNonEmptyString(modelId);
    return id ? this._models.get(id) || null : null;
  }

  getHealth(modelId) {
    const id = toNonEmptyString(modelId);
    return id ? this._health.get(id) || null : null;
  }

  resetUnhealthy(modelId) {
    const id = toNonEmptyString(modelId);
    if (!id) return;
    const prev = this._health.get(id);
    if (!prev) return;
    const next = { ...prev, unhealthyUntilMs: 0 };
    if (next.disabled) {
      next.disabled = false;
      delete next.disabledReason;
    }
    this._health.set(id, next);
  }

  isAvailable(modelId) {
    const id = toNonEmptyString(modelId);
    if (!id) return false;
    const h = this._health.get(id);
    if (!h) return true;
    if (h.disabled === true) return false;
    const now = this._time.now();
    return !(typeof h.unhealthyUntilMs === "number" && h.unhealthyUntilMs > now);
  }

  _computeCooldownMs(backoffLevel) {
    const level = typeof backoffLevel === "number" && Number.isFinite(backoffLevel) ? Math.max(0, Math.floor(backoffLevel)) : 0;
    const baseMs = this._baseCooldownMs;
    const maxMs = this._maxCooldownMs;
    const multiplier = this._backoffMultiplier;

    const pow = level === 0 ? 1 : Math.pow(multiplier, level);
    let ms = baseMs * pow;

    if (!Number.isFinite(ms) || ms <= 0) ms = maxMs;
    ms = Math.floor(ms);
    if (ms > maxMs) ms = maxMs;
    return ms;
  }

  markUnhealthy(modelId, error) {
    const id = toNonEmptyString(modelId);
    if (!id) return null;
    const now = this._time.now();
    const prev = this._health.get(id) || { failures: 0 };
    if (prev.disabled === true) return { ...prev, cooldownMs: null, backoffLevel: null };
    const backoffLevel =
      typeof prev.failures === "number" && Number.isFinite(prev.failures) ? Math.max(0, Math.floor(prev.failures)) : 0;
    const cooldownMs = this._computeCooldownMs(backoffLevel);
    const next = {
      failures: backoffLevel + 1,
      unhealthyUntilMs: now + cooldownMs,
      lastError: toErrorInfo(error),
    };
    this._health.set(id, next);
    return { ...next, cooldownMs, backoffLevel };
  }

  disableModel(modelId, error, { reason } = {}) {
    const id = toNonEmptyString(modelId);
    if (!id) return null;
    const prev = this._health.get(id) || { failures: 0, unhealthyUntilMs: 0 };
    const failures =
      typeof prev.failures === "number" && Number.isFinite(prev.failures) ? Math.max(0, Math.floor(prev.failures)) + 1 : 1;
    const next = {
      ...prev,
      failures,
      unhealthyUntilMs: 0,
      lastError: toErrorInfo(error),
      disabled: true,
      ...(toNonEmptyString(reason) ? { disabledReason: toNonEmptyString(reason) } : {}),
    };
    this._health.set(id, next);
    return next;
  }

  markHealthy(modelId) {
    const id = toNonEmptyString(modelId);
    if (!id) return null;
    const prev = this._health.get(id);
    if (!prev) return null;
    const next = { ...prev, failures: 0, unhealthyUntilMs: 0 };
    if (next.disabled) {
      next.disabled = false;
      delete next.disabledReason;
    }
    this._health.set(id, next);
    return next;
  }

  _getProvider(providerId) {
    const pid = toNonEmptyString(providerId);
    if (!pid) return null;
    return this._providers.get(pid) || null;
  }

  _getRateLimiter(modelEntry) {
    const id = modelEntry?.id;
    if (!id) return null;
    const perSecond = modelEntry?.limits?.rateLimit;
    if (!perSecond) return null;
    if (!this._rateLimiters.has(id)) {
      const rps = perSecond === Infinity ? Infinity : Number(perSecond);
      if (!Number.isFinite(rps) && rps !== Infinity) return null;
      if (rps !== Infinity && rps <= 0) return null;
      this._rateLimiters.set(
        id,
        new TokenBucketRateLimiter({
          rps,
          burst: 1,
          concurrency: 1,
          maxQueue: 500,
          time: this._time,
        })
      );
    }
    return this._rateLimiters.get(id) || null;
  }

  _cleanupStaleBreakers(nowMs = null) {
    const now = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : this._time.now();
    for (const [id, record] of this._circuitBreakers.entries()) {
      const lastUsedMs = record?.lastUsedMs;
      if (typeof lastUsedMs !== "number" || !Number.isFinite(lastUsedMs) || now - lastUsedMs > CIRCUIT_BREAKER_STALE_MS) {
        this._circuitBreakers.delete(id);
      }
    }
  }

  _maybeCleanupStaleBreakers() {
    const now = this._time.now();
    const last = this._lastCircuitBreakerCleanupMs;
    if (typeof last === "number" && Number.isFinite(last) && now - last < CIRCUIT_BREAKER_CLEANUP_INTERVAL_MS) return;
    this._lastCircuitBreakerCleanupMs = now;
    this._cleanupStaleBreakers(now);
  }

  _evictLruBreakers() {
    while (this._circuitBreakers.size > CIRCUIT_BREAKER_POOL_MAX) {
      let lruKey = null;
      let lruLastUsedMs = Infinity;
      for (const [id, record] of this._circuitBreakers.entries()) {
        const lastUsedMs =
          typeof record?.lastUsedMs === "number" && Number.isFinite(record.lastUsedMs) ? record.lastUsedMs : 0;
        if (lastUsedMs < lruLastUsedMs) {
          lruLastUsedMs = lastUsedMs;
          lruKey = id;
        }
      }
      if (lruKey === null) break;
      this._circuitBreakers.delete(lruKey);
    }
  }

  /**
   * P3.3: 获取或创建模型的熔断器
   * @param {string} modelId
   * @returns {CircuitBreaker}
   */
  _getCircuitBreaker(modelId) {
    const id = toNonEmptyString(modelId);
    if (!id) return null;

    const now = this._time.now();
    const existing = this._circuitBreakers.get(id);
    if (existing?.breaker) {
      existing.lastUsedMs = now;
      return existing.breaker;
    }

    const breaker = new CircuitBreaker({
      name: `model:${id}`,
      failureThreshold: 5,      // 连续 5 次失败触发熔断
      successThreshold: 2,      // 半开状态下 2 次成功恢复
      openDurationMs: 30_000,   // 熔断 30 秒
      halfOpenMaxCalls: 3,      // 半开状态允许 3 个探测请求
      isFailure: (err) => {
        // 排除取消和超时，这些不应触发熔断
        if (err?.name === "AbortError") return false;
        if (err?.code === "TIMEOUT") return false;
        // 认证错误也不应触发熔断（已由 disableModel 处理）
        if (isPermanentAuthError(err)) return false;
        return true;
      },
      onStateChange: (event) => {
        this._logger.info(`[ModelRouter] Circuit breaker ${event.name}: ${event.from} → ${event.to} (${event.reason})`);
        this.emit("circuit.stateChange", event);
      },
      time: this._time,
    });

    this._circuitBreakers.set(id, { breaker, lastUsedMs: now });
    this._evictLruBreakers();
    return breaker;
  }

  /**
   * 获取熔断器状态
   */
  getCircuitBreakerState(modelId) {
    const id = toNonEmptyString(modelId);
    if (!id) return null;
    const record = this._circuitBreakers.get(id);
    if (!record?.breaker) return null;
    record.lastUsedMs = this._time.now();
    return record.breaker.getStats();
  }

  /**
   * 重置熔断器
   */
  resetCircuitBreaker(modelId) {
    const id = toNonEmptyString(modelId);
    if (!id) return;
    const record = this._circuitBreakers.get(id);
    if (!record?.breaker) return;
    record.lastUsedMs = this._time.now();
    record.breaker.reset();
  }

  _requiredTags({ usage, images } = {}) {
    const u = toNonEmptyString(usage) || ModelUsage.WORKER;
    const required = new Set();

    const hasImages = Array.isArray(images) && images.length > 0;
    if (hasImages || u === ModelUsage.VISION) required.add("vision");
    else required.add("text");

    const extra = this._usageTags.get(u) || [];
    for (const t of extra) required.add(t);
    return required;
  }

  _supportsTags(modelEntry, requiredTags) {
    const tags = new Set(Array.isArray(modelEntry?.tags) ? modelEntry.tags : []);
    for (const t of requiredTags) if (!tags.has(t)) return false;
    return true;
  }

  _findNextCandidate(fromIndex, candidates, requiredTags) {
    for (let i = fromIndex; i < candidates.length; i++) {
      const id = candidates[i];
      const entry = this._models.get(id);
      if (!entry) continue;
      if (!this._supportsTags(entry, requiredTags)) continue;
      if (!this.isAvailable(id)) continue;
      return id;
    }
    return null;
  }

  _getShortestCooldown(candidates) {
    const now = this._time.now();
    let shortest = null;
    for (const modelId of candidates) {
      const h = this._health.get(modelId);
      if (h?.unhealthyUntilMs > now) {
        const remaining = h.unhealthyUntilMs - now;
        if (!shortest || remaining < shortest.remainingMs) {
          shortest = { modelId, remainingMs: remaining };
        }
      }
    }
    return shortest;
  }

  /**
   * @param {{usage: 'worker'|'planner'|'analyst'|'writer'|'vision', messages: Array<object>, images?: Array<any>}} input
   * @returns {Promise<{content: string, model: string, provider: string}>}
   */
  async call({ usage, messages, images, _waitRetryCount } = {}) {
    const u = toNonEmptyString(usage);
    if (!u) throw new TypeError("call({usage, messages}): usage must be a non-empty string");
    if (!isValidModelUsage(u)) {
      this._logger.warn(`[ModelRouter] Unknown usage type: ${u}, valid types: ${Object.values(ModelUsage).join(", ")}`);
    }
    assertChatMessages(messages);

    // 惰性清理熔断器（每 60 秒最多一次）
    this._maybeCleanupStaleBreakers();

    const candidates = this._usageConfig[u];
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error(`No models configured for usage: ${u}`);

    const requiredTags = this._requiredTags({ usage: u, images });
    let lastError = null;
    const waitRetryCount = typeof _waitRetryCount === "number" && Number.isFinite(_waitRetryCount) ? _waitRetryCount : 0;
    let triedCount = 0;
    let eligibleCount = 0;
    let cooldownCount = 0;
    const eligibleCandidates = [];

    const baseCandidates = candidates;
    const strategy = this._strategy;
    const cursor = this._rrNextIndexByUsage.get(u);
    let startIndex = 0;
    if (strategy === "round_robin") {
      if (typeof cursor === "string") {
        const idx = baseCandidates.indexOf(cursor);
        startIndex = idx >= 0 ? idx : 0;
      } else {
        const raw = typeof cursor === "number" && Number.isFinite(cursor) ? Math.floor(cursor) : 0;
        startIndex = ((raw % baseCandidates.length) + baseCandidates.length) % baseCandidates.length;
      }
    }
    const orderedCandidates = strategy === "round_robin" ? rotateFromIndex(baseCandidates, startIndex) : baseCandidates;

    let selectedModelId = null;

    // Debug: 记录候选模型和健康状态
    const debugCandidates = baseCandidates.map((id) => {
      const entry = this._models.get(id);
      const health = this._health.get(id);
      const available = this.isAvailable(id);
      const hasRequiredTags = entry ? this._supportsTags(entry, requiredTags) : false;
      return {
        id,
        available,
        hasRequiredTags,
        unhealthyUntilMs: health?.unhealthyUntilMs,
        failures: health?.failures,
        disabled: health?.disabled === true,
      };
    });
    this._logger.debug(`[ModelRouter] call usage=${u} strategy=${strategy} startIndex=${startIndex}`, {
      candidates: debugCandidates,
      requiredTags: Array.from(requiredTags),
    });

    try {
      for (let idx = 0; idx < orderedCandidates.length; idx++) {
        const modelId = orderedCandidates[idx];
        const entry = this._models.get(modelId);
        if (!entry) throw new Error(`Unknown model id: ${modelId}`);

        if (!this._supportsTags(entry, requiredTags)) {
          this._logger.debug(`[ModelRouter] skip ${modelId}: missing required tags`);
          continue;
        }
        eligibleCount++;
        eligibleCandidates.push(modelId);
        if (!this.isAvailable(modelId)) {
          const h = this._health.get(modelId);
          const until =
            h?.disabled === true
              ? "disabled"
              : typeof h?.unhealthyUntilMs === "number" && Number.isFinite(h.unhealthyUntilMs)
                ? new Date(h.unhealthyUntilMs).toISOString()
                : "unknown";
          this._logger.debug(`[ModelRouter] skip ${modelId}: unhealthy until ${until}`);
          cooldownCount++;
          continue;
        }

        // P3.3: 检查熔断器状态
        const circuitBreaker = this._getCircuitBreaker(modelId);
        if (circuitBreaker && !circuitBreaker.canExecute()) {
          const cbState = circuitBreaker.state;
          this._logger.debug(`[ModelRouter] skip ${modelId}: circuit breaker ${cbState}`);
          cooldownCount++;
          continue;
        }

        const provider = this._getProvider(entry.provider);
        if (!provider) throw new Error(`Missing provider: ${entry.provider} for model ${modelId}`);

        const limiter = this._getRateLimiter(entry);

        try {
          triedCount++;
          this._logger.debug(`[ModelRouter] try ${modelId} via ${entry.provider}`);

          // P3.3: 使用熔断器包装调用
          const doChat = () => provider.chat({ model: entry.id, messages, images });
          const doChatWithCircuitBreaker = circuitBreaker
            ? () => circuitBreaker.execute(doChat)
            : doChat;

          // P4.3: 计时
          const callStartMs = this._time.now();

          const resp = limiter
            ? await limiter.schedule(doChatWithCircuitBreaker, { label: `${u}:${modelId}` })
            : await doChatWithCircuitBreaker();
          assertChatResponse(resp);

          const callEndMs = this._time.now();
          const latencyMs = callEndMs - callStartMs;

          // P4.3: 记录 token 使用
          try {
            getGlobalTokenTracker().record({
              model: entry.id,
              provider: entry.provider,
              usage: u,
              promptTokens: resp.usage?.promptTokens || resp.usage?.prompt_tokens || 0,
              completionTokens: resp.usage?.completionTokens || resp.usage?.completion_tokens || 0,
              latencyMs,
              success: true,
            });
          } catch {
            // 忽略 tracker 错误
          }

          selectedModelId = entry.id;
          this.markHealthy(modelId);
          this._logger.debug(`[ModelRouter] ok ${modelId} via ${entry.provider} (${latencyMs}ms)`);
          return { ...resp, model: entry.id, provider: entry.provider, latencyMs };
        } catch (err) {
          lastError = err;
          const retryAfterMs =
            typeof err?.retryAfterMs === "number" && Number.isFinite(err.retryAfterMs) && err.retryAfterMs > 0
              ? Math.floor(err.retryAfterMs)
              : null;
          if (retryAfterMs && limiter && typeof limiter.blockFor === "function") {
            limiter.blockFor(retryAfterMs);
          }
          this._logger.warn(`[ModelRouter] fail ${modelId} via ${entry.provider}: ${toErrorInfo(err).message}`);
          const permanent = isPermanentAuthError(err);
          const health = permanent ? this.disableModel(modelId, err, { reason: "auth" }) : this.markUnhealthy(modelId, err);
          this.emit("model.unhealthy", {
            usage: u,
            modelId,
            provider: entry.provider,
            error: toErrorInfo(err),
            cooldownMs: health?.cooldownMs ?? this._cooldownMs,
            backoffLevel: health?.backoffLevel,
            unhealthyUntilMs: health?.unhealthyUntilMs,
            ...(health?.disabled ? { disabled: true, disabledReason: health.disabledReason || "auth" } : {}),
          });

          const nextModelId = this._findNextCandidate(idx + 1, orderedCandidates, requiredTags);
          if (nextModelId) {
            this.emit("model.failover", {
              usage: u,
              fromModelId: modelId,
              toModelId: nextModelId,
              error: toErrorInfo(err),
            });
            this._logger.info(`[ModelRouter] failover ${modelId} -> ${nextModelId}`);
          }
          continue;
        }
      }

    // 遍历完所有候选后：若所有可用候选都处于 cooldown，则按最短剩余时间等待并重试一次
    if (triedCount === 0 && eligibleCount > 0 && cooldownCount === eligibleCount) {
      const waitInfo = this._getShortestCooldown(eligibleCandidates);
      if (waitRetryCount < 1 && waitInfo && waitInfo.remainingMs > 0 && waitInfo.remainingMs < 30_000) {
        const waitMs = Math.ceil(waitInfo.remainingMs);
        this._logger.info(`[ModelRouter] all models in cooldown, waiting ${waitMs}ms for ${waitInfo.modelId}`);
        await this._time.sleep(waitMs + 100);
        this._logger.info(`[ModelRouter] retry after cooldown wait`);
        return this.call({ usage: u, messages, images, _waitRetryCount: waitRetryCount + 1 });
      }
    }

    const msg = `All models failed for usage: ${u}`;
    const e = new Error(msg);
    e.cause = lastError instanceof Error ? lastError : undefined;
    throw e;
    } finally {
      if (strategy === "round_robin" && baseCandidates.length > 0) {
        const start = ((startIndex || 0) % baseCandidates.length + baseCandidates.length) % baseCandidates.length;
        let next = (start + 1) % baseCandidates.length;
        if (selectedModelId) {
          const usedIdx = baseCandidates.indexOf(selectedModelId);
          if (usedIdx >= 0) next = (usedIdx + 1) % baseCandidates.length;
        }
        const nextModelId = baseCandidates[next];
        this._rrNextIndexByUsage.set(u, toNonEmptyString(nextModelId) || next);

        if (this._persistRoundRobin && this._roundRobinStorage) {
          try {
            if (this._roundRobinStorageKey) {
              const obj = {};
              for (const [k, v] of this._rrNextIndexByUsage.entries()) obj[k] = v;
              this._roundRobinStorage.setItem(this._roundRobinStorageKey, JSON.stringify(obj));
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }
}
