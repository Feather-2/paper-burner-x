import { getRateLimiter } from "./internal/rate-limit.js";
import {
  finalizeRoundRobin,
  findNextCandidate,
  getRequiredTags,
  logCandidateDebug,
  prepareCallContext,
  registerPerformanceCandidates,
  supportsTags,
} from "./internal/provider-selection.js";
import { toNonEmptyString } from "../shared/index.js";
import { applyModelRouterConfig, resolveEndpointTier, shouldUsePerformanceRouting } from "./internal/config-parser.js";
import {
  cleanupStaleBreakers,
  computeCooldownMsForBackoff,
  disableModel as disableModelInternal,
  evictLruBreakers,
  getCircuitBreaker,
  getCircuitBreakerState as getCircuitBreakerStateInternal,
  getHealth as getHealthInternal,
  getShortestCooldown as getShortestCooldownInternal,
  isAvailable as isAvailableInternal,
  markHealthy as markHealthyInternal,
  markUnhealthy as markUnhealthyInternal,
  maybeCleanupStaleBreakers,
  resetCircuitBreaker as resetCircuitBreakerInternal,
  resetUnhealthy as resetUnhealthyInternal,
} from "./internal/health-manager.js";
import { callWithPerformanceRouting, callWithStandardRouting, executeCall } from "./internal/call-executor.js";

/**
 * @typedef {object} LoggerLike
 * @property {(msg: string, ...args: any[]) => void} debug
 * @property {(msg: string, ...args: any[]) => void} info
 * @property {(msg: string, ...args: any[]) => void} warn
 * @property {(msg: string, ...args: any[]) => void} error
 */

/**
 * @typedef {object} StorageLike
 * @property {(key: string) => (string|null)} getItem
 * @property {(key: string, value: string) => void} setItem
 */

/**
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void> }} ModelRouterTime
 */

/**
 * @typedef {object} ModelRouterOptions
 * @property {any[]=} models
 * @property {Record<string, string[]>=} usageConfig
 * @property {Map<string, any> | Record<string, any>=} providers
 * @property {any=} cooldown
 * @property {number=} cooldownMs
 * @property {number=} baseCooldownMs
 * @property {number=} maxCooldownMs
 * @property {number=} backoffMultiplier
 * @property {Record<string, any>=} usageTags
 * @property {ModelRouterTime=} time
 * @property {any=} retryStrategy
 * @property {any=} retry
 * @property {boolean=} debug
 * @property {LoggerLike=} logger
 * @property {string=} strategy
 * @property {boolean=} persistRoundRobin
 * @property {string=} roundRobinStorageKey
 * @property {StorageLike=} storage
 * @property {boolean=} performanceRouting
 * @property {import("./performance-router.js").PerformanceRouter=} performanceRouter
 * @property {(args: { modelId: string, modelEntry: any, usage?: string, images?: any[] }) => string=} tierResolver
 */

/**
 * @typedef {object} ModelRouterCallInput
 * @property {string=} usage
 * @property {any[]=} messages
 * @property {any[]=} images
 * @property {number=} _waitRetryCount
 */

export class ModelRouter {
  /** @type {import("./model-events.js").ModelEventEmitter} */
  _events;
  /** @type {boolean} */
  _debug;
  /** @type {LoggerLike} */
  _logger;
  /** @type {string} */
  _strategy;
  /** @type {boolean | null} */
  _performanceRouting;
  /** @type {((args: { modelId: string, modelEntry: any, usage?: string, images?: any[] }) => string) | null} */
  _tierResolver;
  /** @type {import("./performance-router.js").PerformanceRouter} */
  _performanceRouter;
  /** @type {Map<string, string | number>} */
  _rrNextIndexByUsage;
  /** @type {boolean} */
  _persistRoundRobin;
  /** @type {string} */
  _roundRobinStorageKey;
  /** @type {StorageLike | null} */
  _roundRobinStorage;
  /** @type {ModelRouterTime} */
  _time;
  /** @type {import("../shared/retry-strategy.js").RetryStrategy | { execute: (fn: () => Promise<any>) => Promise<any> } | null} */
  _retryStrategy;
  /** @type {number} */
  _baseCooldownMs;
  /** @type {number} */
  _maxCooldownMs;
  /** @type {number} */
  _backoffMultiplier;
  /** @type {number} */
  _cooldownMs;
  /** @type {Map<string, any>} */
  _models;
  /** @type {Record<string, string[]>} */
  _usageConfig;
  /** @type {Map<string, any>} */
  _providers;
  /** @type {Map<string, string[]>} */
  _usageTags;
  /** @type {Map<string, any>} */
  _health;
  /** @type {Map<string, any>} */
  _rateLimiters;
  /** @type {Map<string, any>} */
  _circuitBreakers;
  /** @type {number | null} */
  _lastCircuitBreakerCleanupMs;

  /**
   * @param {ModelRouterOptions} [options]
   */
  constructor(options = {}) {
    applyModelRouterConfig(this, options);
  }

  /**
   * @param {string} modelId
   * @param {any} entry
   * @param {{ usage?: string, images?: any[] }} [options]
   * @returns {string}
   */
  _resolveEndpointTier(modelId, entry, { usage, images } = {}) {
    return resolveEndpointTier({
      tierResolver: this._tierResolver,
      modelId,
      modelEntry: entry,
      usage,
      images,
    });
  }

  _shouldUsePerformanceRouting(strategy) {
    return shouldUsePerformanceRouting({ strategy, performanceRouting: this._performanceRouting });
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
    return getHealthInternal({ healthMap: this._health, modelId });
  }

  resetUnhealthy(modelId) {
    resetUnhealthyInternal({ healthMap: this._health, modelId });
  }

  isAvailable(modelId) {
    return isAvailableInternal({ healthMap: this._health, modelId, time: this._time });
  }

  _computeCooldownMs(backoffLevel) {
    return computeCooldownMsForBackoff({
      backoffLevel,
      baseCooldownMs: this._baseCooldownMs,
      maxCooldownMs: this._maxCooldownMs,
      backoffMultiplier: this._backoffMultiplier,
    });
  }

  markUnhealthy(modelId, error) {
    return markUnhealthyInternal({
      healthMap: this._health,
      time: this._time,
      modelId,
      error,
      baseCooldownMs: this._baseCooldownMs,
      maxCooldownMs: this._maxCooldownMs,
      backoffMultiplier: this._backoffMultiplier,
    });
  }

  /**
   * @param {string} modelId
   * @param {unknown} error
   * @param {{ reason?: string }} [options]
   */
  disableModel(modelId, error, { reason } = {}) {
    return disableModelInternal({ healthMap: this._health, modelId, error, reason });
  }

  markHealthy(modelId) {
    return markHealthyInternal({ healthMap: this._health, modelId });
  }

  _getProvider(providerId) {
    const pid = toNonEmptyString(providerId);
    if (!pid) return null;
    return this._providers.get(pid) || null;
  }

  _getRateLimiter(modelEntry) {
    return getRateLimiter({ rateLimiters: this._rateLimiters, modelEntry, time: this._time });
  }

  _cleanupStaleBreakers(nowMs = null) {
    cleanupStaleBreakers({ circuitBreakers: this._circuitBreakers, time: this._time, nowMs });
  }

  _maybeCleanupStaleBreakers() {
    this._lastCircuitBreakerCleanupMs = maybeCleanupStaleBreakers({
      circuitBreakers: this._circuitBreakers,
      time: this._time,
      lastCleanupMs: this._lastCircuitBreakerCleanupMs,
    });
  }

  _evictLruBreakers() {
    evictLruBreakers({ circuitBreakers: this._circuitBreakers });
  }

  /**
   * P3.3: Get or create model circuit breaker.
   * @param {string} modelId
   * @returns {any}
   */
  _getCircuitBreaker(modelId) {
    return getCircuitBreaker({
      modelId,
      circuitBreakers: this._circuitBreakers,
      time: this._time,
      logger: this._logger,
      emit: this.emit.bind(this),
    });
  }

  /**
   * Get circuit breaker state.
   */
  getCircuitBreakerState(modelId) {
    return getCircuitBreakerStateInternal({ modelId, circuitBreakers: this._circuitBreakers, time: this._time });
  }

  /**
   * Reset circuit breaker.
   */
  resetCircuitBreaker(modelId) {
    resetCircuitBreakerInternal({ modelId, circuitBreakers: this._circuitBreakers, time: this._time });
  }

  /**
   * @param {{ usage?: string, images?: any[] }} [options]
   * @returns {Set<string>}
   */
  _requiredTags({ usage, images } = {}) {
    return getRequiredTags({ usage, images, usageTags: this._usageTags });
  }

  _supportsTags(modelEntry, requiredTags) {
    return supportsTags(modelEntry, requiredTags);
  }

  _findNextCandidate(fromIndex, candidates, requiredTags) {
    return findNextCandidate({
      fromIndex,
      candidates,
      requiredTags,
      models: this._models,
      isAvailable: (modelId) => this.isAvailable(modelId),
    });
  }

  _getShortestCooldown(candidates) {
    return getShortestCooldownInternal({ candidates, healthMap: this._health, time: this._time });
  }

  /**
   * @param {ModelRouterCallInput} [input]
   * @returns {{ usage: string, requiredTags: Set<string>, waitRetryCount: number, baseCandidates: string[], orderedCandidates: string[], strategy: string, startIndex: number, usePerformanceRouting: boolean }}
   */
  _prepareCallContext({ usage, messages, images, _waitRetryCount } = {}) {
    return prepareCallContext({
      usage,
      messages,
      images,
      waitRetryCount: _waitRetryCount,
      usageConfig: this._usageConfig,
      usageTags: this._usageTags,
      logger: this._logger,
      strategy: this._strategy,
      rrNextIndexByUsage: this._rrNextIndexByUsage,
      usePerformanceRouting: this._shouldUsePerformanceRouting(this._strategy),
      beforeCandidates: () => this._maybeCleanupStaleBreakers(),
    });
  }

  /**
   * @param {{ usage: string, baseCandidates: string[], images?: any }} input
   * @returns {void}
   */
  _registerPerformanceCandidates({ usage, baseCandidates, images }) {
		    registerPerformanceCandidates({
		      usage,
		      baseCandidates,
		      images,
		      models: this._models,
		      performanceRouter: /** @type {{ registerEndpoint: (id: string, meta: { tier: string, weight: number }) => void }} */ (this._performanceRouter),
		      resolveEndpointTier: (modelId, entry, options) => this._resolveEndpointTier(modelId, entry, options),
		    });
		  }

  /**
   * @param {{ usage: string, strategy: string, startIndex: number, baseCandidates: string[], requiredTags: Set<string> }} input
   * @returns {void}
   */
  _logCandidateDebug({ usage, strategy, startIndex, baseCandidates, requiredTags }) {
    logCandidateDebug({
      usage,
      strategy,
      startIndex,
      baseCandidates,
      requiredTags,
      models: this._models,
      health: this._health,
      isAvailable: (modelId) => this.isAvailable(modelId),
      logger: this._logger,
    });
  }

  /**
   * @param {{ usage: string, strategy: string, baseCandidates: string[], startIndex: number, selectedModelId: string | null }} input
   * @returns {void}
   */
  _finalizeRoundRobin({ usage, strategy, baseCandidates, startIndex, selectedModelId }) {
    finalizeRoundRobin({
      usage,
      strategy,
      baseCandidates,
      startIndex,
      selectedModelId,
      rrNextIndexByUsage: this._rrNextIndexByUsage,
      persistRoundRobin: this._persistRoundRobin,
      roundRobinStorage: this._roundRobinStorage,
      roundRobinStorageKey: this._roundRobinStorageKey,
    });
  }

  /**
   * @param {ModelRouterCallInput} [input]
   * @returns {Promise<{content: string, model: string, provider: string}>}
   */
  async call({ usage, messages, images, _waitRetryCount } = {}) {
    return executeCall({ router: this, usage, messages, images, waitRetryCount: _waitRetryCount });
  }

  /**
   * @param {{ usage: string, messages: any[], images?: any, requiredTags: Set<string>, orderedCandidates: string[], taskComplexity: any, waitRetryCount: number }} input
   * @returns {Promise<{content: string, model: string, provider: string, latencyMs: number}>}
   */
  async _callWithPerformanceRouting(input) {
    return callWithPerformanceRouting({ router: this, ...input });
  }

  /**
   * @param {{ usage: string, messages: any[], images?: any, requiredTags: Set<string>, orderedCandidates: string[], waitRetryCount: number }} input
   * @returns {Promise<{content: string, model: string, provider: string, latencyMs: number}>}
   */
  async _callWithStandardRouting(input) {
    return callWithStandardRouting({ router: this, ...input });
  }
}
