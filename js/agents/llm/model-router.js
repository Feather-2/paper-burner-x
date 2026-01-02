import { assertChatMessages, assertChatResponse, assertModelEntry, assertProvider, assertUsageConfig, normalizeModelTags } from "./provider.js";
import { ModelUsage, RouterStrategy, isValidModelUsage, normalizeRouterStrategy } from "./constants.js";
import { TokenBucketRateLimiter } from "./rate-limit.js";
import { safeJsonParse } from "../shared/utils/safe-json.js";

// 浏览器兼容的 EventEmitter 简易实现
class EventEmitter {
  constructor() {
    this._events = new Map();
  }
  on(event, listener) {
    if (!this._events.has(event)) this._events.set(event, []);
    this._events.get(event).push(listener);
    return this;
  }
  off(event, listener) {
    const listeners = this._events.get(event);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
    return this;
  }
  emit(event, ...args) {
    const listeners = this._events.get(event);
    if (listeners) for (const fn of [...listeners]) fn(...args);
    return listeners?.length > 0;
  }
  removeAllListeners(event) {
    if (event) this._events.delete(event);
    else this._events.clear();
    return this;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

  // Default to console in Node.js / browsers.
  const c = typeof console !== "undefined" ? console : null;
  return {
    debug: typeof c?.debug === "function" ? c.debug.bind(c) : () => {},
    info: typeof c?.info === "function" ? c.info.bind(c) : () => {},
    warn: typeof c?.warn === "function" ? c.warn.bind(c) : () => {},
    error: typeof c?.error === "function" ? c.error.bind(c) : () => {},
  };
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

export class ModelRouter extends EventEmitter {
  constructor({
    models,
    usageConfig,
    providers,
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
  } = {}) {
    super();

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

    this._time = isPlainObject(time) && typeof time.now === "function" && typeof time.sleep === "function" ? time : defaultTime();

    const DEFAULT_BASE_COOLDOWN_MS = 60_000;
    const DEFAULT_MAX_COOLDOWN_MS = 600_000;
    const DEFAULT_BACKOFF_MULTIPLIER = 2;

    const legacyOnlyCooldownMs =
      cooldownMs !== undefined && baseCooldownMs === undefined && maxCooldownMs === undefined && backoffMultiplier === undefined;

    const baseMs = toPositiveInt(baseCooldownMs ?? cooldownMs, DEFAULT_BASE_COOLDOWN_MS);
    const maxMsRaw = legacyOnlyCooldownMs ? baseMs : toPositiveInt(maxCooldownMs, DEFAULT_MAX_COOLDOWN_MS);
    const maxMs = Math.max(baseMs, maxMsRaw);

    this._baseCooldownMs = baseMs;
    this._maxCooldownMs = maxMs;
    this._backoffMultiplier = toBackoffMultiplier(backoffMultiplier, DEFAULT_BACKOFF_MULTIPLIER);
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

    if (this._persistRoundRobin) {
      try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(this._roundRobinStorageKey) : null;
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
      console.warn(`[ModelRouter] Unknown usage type: ${u}, valid types: ${Object.values(ModelUsage).join(", ")}`);
    }
    assertChatMessages(messages);

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

        const provider = this._getProvider(entry.provider);
        if (!provider) throw new Error(`Missing provider: ${entry.provider} for model ${modelId}`);

        const limiter = this._getRateLimiter(entry);

        try {
          triedCount++;
          this._logger.debug(`[ModelRouter] try ${modelId} via ${entry.provider}`);
          const doChat = () => provider.chat({ model: entry.id, messages, images });
          const resp = limiter
            ? await limiter.schedule(doChat, { label: `${u}:${modelId}` })
            : await doChat();
          assertChatResponse(resp);
          selectedModelId = entry.id;
          this.markHealthy(modelId);
          this._logger.debug(`[ModelRouter] ok ${modelId} via ${entry.provider}`);
          return { ...resp, model: entry.id, provider: entry.provider };
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

        if (this._persistRoundRobin) {
          try {
            if (typeof localStorage !== "undefined" && this._roundRobinStorageKey) {
              const obj = {};
              for (const [k, v] of this._rrNextIndexByUsage.entries()) obj[k] = v;
              localStorage.setItem(this._roundRobinStorageKey, JSON.stringify(obj));
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }
}
