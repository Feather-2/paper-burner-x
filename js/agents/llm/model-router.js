import { EventEmitter } from "node:events";
import { assertChatMessages, assertChatResponse, assertModelEntry, assertProvider, assertUsageConfig, normalizeModelTags } from "./provider.js";

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

class RateLimiter {
  constructor({ perSecond = Infinity, time } = {}) {
    this._minIntervalMs = perSecond === Infinity ? 0 : Math.max(0, Math.ceil(1000 / Math.max(1, perSecond)));
    this._time = time;
    this._nextAllowedAt = 0;
  }

  async waitTurn() {
    if (this._minIntervalMs <= 0) return;
    const now = this._time.now();
    const waitMs = Math.max(0, this._nextAllowedAt - now);
    this._nextAllowedAt = Math.max(this._nextAllowedAt, now) + this._minIntervalMs;
    if (waitMs > 0) await this._time.sleep(waitMs);
  }
}

function defaultTime() {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

export class ModelRouter extends EventEmitter {
  constructor({ models, usageConfig, providers, cooldownMs = 60_000, usageTags, time } = {}) {
    super();

    this._time = isPlainObject(time) && typeof time.now === "function" && typeof time.sleep === "function" ? time : defaultTime();
    this._cooldownMs = typeof cooldownMs === "number" && cooldownMs > 0 ? Math.floor(cooldownMs) : 60_000;

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
    this._rateLimiters = new Map(); // modelId -> RateLimiter
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
    this._health.set(id, { ...prev, unhealthyUntilMs: 0 });
  }

  isAvailable(modelId) {
    const id = toNonEmptyString(modelId);
    if (!id) return false;
    const h = this._health.get(id);
    if (!h) return true;
    const now = this._time.now();
    return !(typeof h.unhealthyUntilMs === "number" && h.unhealthyUntilMs > now);
  }

  markUnhealthy(modelId, error) {
    const id = toNonEmptyString(modelId);
    if (!id) return null;
    const now = this._time.now();
    const prev = this._health.get(id) || { failures: 0 };
    const next = {
      failures: (prev.failures || 0) + 1,
      unhealthyUntilMs: now + this._cooldownMs,
      lastError: toErrorInfo(error),
    };
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
    if (!this._rateLimiters.has(id)) this._rateLimiters.set(id, new RateLimiter({ perSecond, time: this._time }));
    return this._rateLimiters.get(id);
  }

  _requiredTags({ usage, images } = {}) {
    const u = toNonEmptyString(usage) || "worker";
    const required = new Set();

    const hasImages = Array.isArray(images) && images.length > 0;
    if (hasImages || u === "vision") required.add("vision");
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

  /**
   * @param {{usage: 'worker'|'planner'|'analyst'|'writer'|'vision', messages: Array<object>, images?: Array<any>}} input
   * @returns {Promise<{content: string, model: string, provider: string}>}
   */
  async call({ usage, messages, images } = {}) {
    const u = toNonEmptyString(usage);
    if (!u) throw new TypeError("call({usage, messages}): usage must be a non-empty string");
    assertChatMessages(messages);

    const candidates = this._usageConfig[u];
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error(`No models configured for usage: ${u}`);

    const requiredTags = this._requiredTags({ usage: u, images });
    let lastError = null;

    for (let idx = 0; idx < candidates.length; idx++) {
      const modelId = candidates[idx];
      const entry = this._models.get(modelId);
      if (!entry) throw new Error(`Unknown model id: ${modelId}`);

      if (!this._supportsTags(entry, requiredTags)) continue;
      if (!this.isAvailable(modelId)) continue;

      const provider = this._getProvider(entry.provider);
      if (!provider) throw new Error(`Missing provider: ${entry.provider} for model ${modelId}`);

      const limiter = this._getRateLimiter(entry);
      if (limiter) await limiter.waitTurn();

      try {
        const resp = await provider.chat({ model: entry.id, messages, images });
        assertChatResponse(resp);
        return { ...resp, model: entry.id, provider: entry.provider };
      } catch (err) {
        lastError = err;
        const health = this.markUnhealthy(modelId, err);
        this.emit("model.unhealthy", {
          usage: u,
          modelId,
          provider: entry.provider,
          error: toErrorInfo(err),
          cooldownMs: this._cooldownMs,
          unhealthyUntilMs: health?.unhealthyUntilMs,
        });

        const nextModelId = this._findNextCandidate(idx + 1, candidates, requiredTags);
        if (nextModelId) {
          this.emit("model.failover", {
            usage: u,
            fromModelId: modelId,
            toModelId: nextModelId,
            error: toErrorInfo(err),
          });
        }
        continue;
      }
    }

    const msg = `All models failed for usage: ${u}`;
    const e = new Error(msg);
    e.cause = lastError instanceof Error ? lastError : undefined;
    throw e;
  }
}

