import { createLogger, isPlainObject, toNonNegativeInt } from "../../../shared/index.js";
import { getGlobalTokenTracker, TraceContext } from "../../../plugins/telemetry/index.js";
import { withRetry } from "../../../shared/retry-strategy.js";
import { getErrorBoundary } from "../error-boundary.js";
import { MessageBus } from "../../../core/message-bus.js";

const logger = createLogger("runtime/api/stage-api-factory");

// P4.6: Default EventBus backpressure config (coalesce high-frequency progress events).
const DEFAULT_EVENTBUS_BACKPRESSURE = Object.freeze({
  coalescePattern: /\.progress$/,
  deferNonCoalesced: false,
  maxQueueSize: 10000,
});

/**
 * 过滤掉 undefined 和 null 的值，避免覆盖已有配置
 * @private
 * @param {Record<string, any> | null | undefined} obj - object to filter
 * @returns {Record<string, any>} filtered object with only defined values
 */
export function filterDefinedValues(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  );
}

/**
 * @private
 * @param {any} value - value to check
 * @returns {boolean} true if value has TraceContext-like interface
 */
export function isTraceContextLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.startSpan === "function" &&
    typeof value.endSpan === "function" &&
    typeof value.withSpan === "function" &&
    typeof value.getTraceparent === "function"
  );
}

/**
 * @private
 * @param {ServiceContainerLike | null | undefined} container - DI container to resolve from
 * @returns {any | null} resolved TraceContext or null
 */
export function resolveTraceContextFromContainer(container) {
  const c = container && typeof container === "object" ? container : null;
  if (!c) return null;
  if (typeof c.tryGet === "function") {
    const candidate = c.tryGet("traceContext");
    return isTraceContextLike(candidate) ? candidate : null;
  }
  if (typeof c.get === "function") {
    try {
      const candidate = c.get("traceContext");
      return isTraceContextLike(candidate) ? candidate : null;
    } catch (e) {
      // container.get may throw if key not registered; safe to ignore
      logger.debug("[resolveTraceContextFromContainer] container.get threw", e);
      return null;
    }
  }
  return null;
}

/**
 * @private
 * @param {{ traceContext?: any, traceparent?: string, container?: ServiceContainerLike }} [options] - resolution options
 * @returns {any} resolved TraceContext (creates new one if not found)
 */
export function resolveTraceContext({ traceContext, traceparent, container } = {}) {
  if (isTraceContextLike(traceContext)) return traceContext;

  const fromContainer = resolveTraceContextFromContainer(container);
  if (fromContainer) return fromContainer;

  if (typeof traceparent === "string" && traceparent.trim()) {
    const parsed = TraceContext.parseTraceparent(traceparent.trim());
    if (parsed?.traceId && parsed?.spanId) {
      return new TraceContext({ traceId: parsed.traceId, parentSpanId: parsed.spanId });
    }
  }

  return new TraceContext();
}

/**
 * @private
 * @param {any} value - value to check
 * @returns {boolean} true if value has RetryStrategy-like interface
 */
export function isRetryStrategyLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.execute === "function"
  );
}

/**
 * @private
 * @param {ServiceContainerLike | null | undefined} container - DI container to resolve from
 * @returns {any | null} resolved RetryStrategy or null
 */
export function resolveRetryStrategyFromContainer(container) {
  const c = container && typeof container === "object" ? container : null;
  if (!c) return null;
  if (typeof c.tryGet === "function") {
    const candidate = c.tryGet("retryStrategy");
    return isRetryStrategyLike(candidate) ? candidate : null;
  }
  if (typeof c.get === "function") {
    try {
      const candidate = c.get("retryStrategy");
      return isRetryStrategyLike(candidate) ? candidate : null;
    } catch (e) {
      // container.get may throw if key not registered; safe to ignore
      logger.debug("[resolveRetryStrategyFromContainer] container.get threw", e);
      return null;
    }
  }
  return null;
}

/**
 * @private
 * @param {{ retryStrategy?: any, container?: ServiceContainerLike }} [options] - resolution options
 * @returns {any | null} resolved RetryStrategy or null
 */
export function resolveRetryStrategy({ retryStrategy, container } = {}) {
  if (isRetryStrategyLike(retryStrategy)) return retryStrategy;
  const fromContainer = resolveRetryStrategyFromContainer(container);
  if (fromContainer) return fromContainer;
  return null;
}

/**
 * @private
 * @param {any} value - value to check
 * @returns {boolean} true if value has ErrorBoundary-like interface
 */
export function isErrorBoundaryLike(value) {
  return value !== null && typeof value === "object" && typeof value.wrap === "function";
}

/**
 * @private
 * @param {ServiceContainerLike | null | undefined} container - DI container to resolve from
 * @returns {any | null} resolved ErrorBoundary or null
 */
export function resolveErrorBoundaryFromContainer(container) {
  const c = container && typeof container === "object" ? container : null;
  if (!c) return null;
  if (typeof c.tryGet === "function") {
    const candidate = c.tryGet("errorBoundary");
    return isErrorBoundaryLike(candidate) ? candidate : null;
  }
  if (typeof c.get === "function") {
    try {
      const candidate = c.get("errorBoundary");
      return isErrorBoundaryLike(candidate) ? candidate : null;
    } catch (e) {
      // container.get may throw if key not registered; safe to ignore
      logger.debug("[resolveErrorBoundaryFromContainer] container.get threw", e);
      return null;
    }
  }
  return null;
}

/**
 * @private
 * @param {{ errorBoundary?: any, container?: ServiceContainerLike }} [options] - resolution options
 * @returns {any} resolved ErrorBoundary (uses global fallback if not found)
 */
export function resolveErrorBoundary({ errorBoundary, container } = {}) {
  if (isErrorBoundaryLike(errorBoundary)) return errorBoundary;
  const fromContainer = resolveErrorBoundaryFromContainer(container);
  if (fromContainer) return fromContainer;
  return getErrorBoundary();
}

/**
 * @private
 * @param {any} value - value to check
 * @returns {boolean} true if value has ToolQuotaManager-like interface
 */
export function isToolQuotaManagerLike(value) {
  return value !== null && typeof value === "object" && typeof value.tryCall === "function";
}

/**
 * @private
 * @param {ServiceContainerLike | null | undefined} container - DI container to resolve from
 * @returns {any | null} resolved ToolQuotaManager or null
 */
export function resolveToolQuotaManagerFromContainer(container) {
  const c = container && typeof container === "object" ? container : null;
  if (!c) return null;
  if (typeof c.tryGet === "function") {
    const candidate = c.tryGet("toolQuotaManager");
    return isToolQuotaManagerLike(candidate) ? candidate : null;
  }
  if (typeof c.get === "function") {
    try {
      const candidate = c.get("toolQuotaManager");
      return isToolQuotaManagerLike(candidate) ? candidate : null;
    } catch (e) {
      // container.get may throw if key not registered; safe to ignore
      logger.debug("[resolveToolQuotaManagerFromContainer] container.get threw", e);
      return null;
    }
  }
  return null;
}

/**
 * @private
 * @param {{ toolQuotaManager?: any, container?: ServiceContainerLike }} [options] - resolution options
 * @returns {any | null} resolved ToolQuotaManager or null
 */
export function resolveToolQuotaManager({ toolQuotaManager, container } = {}) {
  if (isToolQuotaManagerLike(toolQuotaManager)) return toolQuotaManager;
  const fromContainer = resolveToolQuotaManagerFromContainer(container);
  if (fromContainer) return fromContainer;
  return null;
}

// P6.3: MessageBus 解析
/**
 * @private
 * @param {any} value - value to check
 * @returns {boolean} true if value has MessageBus-like interface
 */
export function isMessageBusLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.request === "function" &&
    typeof value.handle === "function"
  );
}

/**
 * @private
 * @param {ServiceContainerLike | null | undefined} container - DI container to resolve from
 * @returns {any | null} resolved MessageBus or null
 */
export function resolveMessageBusFromContainer(container) {
  const c = container && typeof container === "object" ? container : null;
  if (!c) return null;
  if (typeof c.tryGet === "function") {
    const candidate = c.tryGet("messageBus");
    return isMessageBusLike(candidate) ? candidate : null;
  }
  if (typeof c.get === "function") {
    try {
      const candidate = c.get("messageBus");
      return isMessageBusLike(candidate) ? candidate : null;
    } catch (e) {
      // container.get may throw if key not registered; safe to ignore
      logger.debug("[resolveMessageBusFromContainer] container.get threw", e);
      return null;
    }
  }
  return null;
}

/**
 * @private
 * @param {{ messageBus?: any, eventBus?: any, container?: ServiceContainerLike }} [options] - resolution options
 * @returns {any | null} resolved MessageBus or null
 */
export function resolveMessageBus({ messageBus, eventBus, container } = {}) {
  if (isMessageBusLike(messageBus)) return messageBus;
  const fromContainer = resolveMessageBusFromContainer(container);
  if (fromContainer) return fromContainer;
  // 如果有 eventBus，创建新的 MessageBus
  if (eventBus && typeof eventBus.emit === "function") {
    try {
      return new MessageBus(eventBus);
    } catch (e) {
      // MessageBus construction may fail; log and fall through
      logger.debug("[resolveMessageBus] MessageBus construction failed", e);
      return null;
    }
  }
  return null;
}

/**
 * @private
 * @param {any} eventBus - EventBus instance to configure
 * @param {any} config - backpressure configuration
 * @returns {void}
 */
export function ensureEventBusBackpressure(eventBus, config) {
  if (!eventBus || typeof eventBus.enableBackpressure !== "function") return;

  // Avoid overriding a bus that has already been configured (e.g. Orchestrator defaults).
  if (eventBus?._backpressure?.enabled) return;

  const cfg = config === false ? false : isPlainObject(config) ? { ...config } : {};
  if (cfg === false) return;

  if (cfg.maxQueueSize !== undefined) {
    cfg.maxQueueSize = toNonNegativeInt(cfg.maxQueueSize);
  }

  try {
    eventBus.enableBackpressure({ ...DEFAULT_EVENTBUS_BACKPRESSURE, ...cfg });
  } catch (e) {
    // Backpressure setup may fail on incompatible buses; non-fatal
    logger.debug("[ensureEventBusBackpressure] enableBackpressure failed", e);
  }
}

/**
 * @private
 * @param {any} resp - LLM response object
 * @returns {{ promptTokens: number, completionTokens: number }} extracted token counts
 */
export function extractTokenUsage(resp) {
  const usage = resp && typeof resp === "object" ? resp.usage : null;
  if (!usage || typeof usage !== "object") return { promptTokens: 0, completionTokens: 0 };

  const promptTokens =
    usage.promptTokens ??
    usage.prompt_tokens ??
    usage.inputTokens ??
    usage.input_tokens ??
    usage.input ??
    usage.prompt ??
    0;

  const completionTokens =
    usage.completionTokens ??
    usage.completion_tokens ??
    usage.outputTokens ??
    usage.output_tokens ??
    usage.output ??
    usage.completion ??
    0;

  return {
    promptTokens: toNonNegativeInt(promptTokens, 0),
    completionTokens: toNonNegativeInt(completionTokens, 0),
  };
}

/**
 * @private
 * @param {any} breakerRegistry - circuit breaker registry
 * @param {string} usage - usage context identifier
 * @param {string} model - model identifier
 * @returns {any | null} circuit breaker instance or null
 */
export function createCircuitBreaker(breakerRegistry, usage, model) {
  if (!breakerRegistry || typeof breakerRegistry.get !== "function") return null;
  return breakerRegistry.get(`aiApiService:chat:${usage}:${model}`, {
    failureThreshold: 4,
    successThreshold: 1,
    openDurationMs: 15_000,
    halfOpenMaxCalls: 1,
    isFailure: (err) => err?.name !== "AbortError",
  });
}

/**
 * @private
 * @param {any} resp - LLM response
 * @param {any} opts - request options
 * @param {number} latencyMs - request latency in ms
 * @returns {void}
 */
export function recordTokenTrackingSuccess(resp, opts, latencyMs) {
  try {
    const { promptTokens, completionTokens } = extractTokenUsage(resp);
    getGlobalTokenTracker().record({
      model: typeof resp?.model === "string" ? resp.model : typeof opts?.model === "string" ? opts.model : "unknown",
      provider: typeof resp?.provider === "string" ? resp.provider : "aiApiService",
      usage: typeof opts?.usage === "string" ? opts.usage : "unknown",
      promptTokens,
      completionTokens,
      latencyMs,
      success: true,
    });
  } catch (err) {
    // Ignore tracker errors
    logger.debug("[recordTokenTrackingSuccess] token tracker failed", err);
  }
}

/**
 * @private
 * @param {any} opts - request options
 * @param {number} latencyMs - request latency in ms
 * @param {Error | any} err - error that occurred
 * @returns {void}
 */
export function recordTokenTrackingFailure(opts, latencyMs, err) {
  try {
    getGlobalTokenTracker().record({
      model: typeof opts?.model === "string" ? opts.model : "unknown",
      provider: "aiApiService",
      usage: typeof opts?.usage === "string" ? opts.usage : "unknown",
      promptTokens: 0,
      completionTokens: 0,
      latencyMs,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  } catch (err) {
    // Ignore tracker errors
    logger.debug("[recordTokenTrackingFailure] token tracker failed", err);
  }
}

/**
 * @private
 * @param {any} aiApiService - AI API service to wrap with token tracking
 * @returns {void}
 */
export function ensureAiApiServiceTokenTracking(aiApiService) {
  if (!aiApiService || typeof aiApiService !== "object") return;
  const originalChat = aiApiService.chat;
  if (typeof originalChat !== "function") return;

  const registryLike =
    aiApiService?.circuitBreakerRegistry && typeof aiApiService.circuitBreakerRegistry.get === "function"
      ? aiApiService.circuitBreakerRegistry
      : null;

  if (originalChat.__tokenTrackerWrapped === true) {
    if (registryLike) originalChat.__pbCircuitBreakerRegistry = registryLike;
    return;
  }

  async function chat(opts = {}) {
    const startedAt = Date.now();
    const breakerRegistry =
      chat.__pbCircuitBreakerRegistry && typeof chat.__pbCircuitBreakerRegistry.get === "function"
        ? chat.__pbCircuitBreakerRegistry
        : null;
    const usage = typeof opts?.usage === "string" && opts.usage ? opts.usage : "unknown";
    const model = typeof opts?.model === "string" && opts.model ? opts.model : "auto";
    const breaker = createCircuitBreaker(breakerRegistry, usage, model);

    try {
      const call = () => originalChat.call(aiApiService, opts);
      const resp = breaker ? await breaker.execute(call) : await call();
      recordTokenTrackingSuccess(resp, opts, Date.now() - startedAt);
      return resp;
    } catch (err) {
      recordTokenTrackingFailure(opts, Date.now() - startedAt, err);
      throw err;
    }
  }

  chat.__tokenTrackerWrapped = true;
  chat.__tokenTrackerOriginal = originalChat;
  if (registryLike) chat.__pbCircuitBreakerRegistry = registryLike;
  aiApiService.chat = chat;
}

/**
 * @private
 * @param {any} aiApiService - AI API service to wrap
 * @param {any} retryStrategy - retry strategy to apply
 * @returns {void}
 */
export function ensureAiApiServiceRetry(aiApiService, retryStrategy) {
  if (!aiApiService || typeof aiApiService !== "object") return;
  const originalChat = aiApiService.chat;
  if (typeof originalChat !== "function") return;

  if (originalChat.__pbRetryWrapped === true) {
    // Allow updating the active retry strategy even after wrapping.
    if (isRetryStrategyLike(retryStrategy)) originalChat.__pbRetryStrategy = retryStrategy;
    return;
  }

  async function chat(opts = {}) {
    const signal = opts?.signal;
    const strat = isRetryStrategyLike(chat.__pbRetryStrategy) ? chat.__pbRetryStrategy : null;

    const call = () => originalChat.call(aiApiService, opts);
    if (strat) {
      return await strat.execute(call, { ...(signal ? { signal } : {}) });
    }
    return await withRetry(call, { ...(signal ? { signal } : {}) });
  }

  chat.__pbRetryWrapped = true;
  chat.__pbRetryOriginal = originalChat;
  if (isRetryStrategyLike(retryStrategy)) chat.__pbRetryStrategy = retryStrategy;

  // Preserve token-tracker marker so ensureAiApiServiceTokenTracking stays idempotent.
  if (originalChat.__tokenTrackerWrapped === true) {
    chat.__tokenTrackerWrapped = true;
    chat.__tokenTrackerOriginal = originalChat.__tokenTrackerOriginal || originalChat;
    // Forward registry updates to the token-tracker wrapper, which owns the breaker lookup.
    if ("__pbCircuitBreakerRegistry" in originalChat) {
      try {
        Object.defineProperty(chat, "__pbCircuitBreakerRegistry", {
          get() {
            return originalChat.__pbCircuitBreakerRegistry;
          },
          set(v) {
            originalChat.__pbCircuitBreakerRegistry = v;
          },
          configurable: true,
        });
      } catch {
        // ignore
      }
    }
  }

  aiApiService.chat = chat;
}

/**
 * @private
 * @param {any} mcpClient - MCP client to wrap
 * @param {any} retryStrategy - retry strategy to apply
 * @returns {void}
 */
export function ensureMcpClientRetry(mcpClient, retryStrategy) {
  if (!mcpClient || typeof mcpClient !== "object") return;
  if (typeof mcpClient.callTool !== "function") return;

  const originalCallTool = mcpClient.callTool;
  if (typeof originalCallTool !== "function") return;

  if (originalCallTool.__pbRetryWrapped === true) {
    if (isRetryStrategyLike(retryStrategy)) originalCallTool.__pbRetryStrategy = retryStrategy;
    return;
  }

  async function callTool(toolName, args = {}, options = {}) {
    const signal = options?.signal;
    const strat = isRetryStrategyLike(callTool.__pbRetryStrategy) ? callTool.__pbRetryStrategy : null;
    const call = () => originalCallTool.call(mcpClient, toolName, args, options);
    if (strat) {
      return await strat.execute(call, { ...(signal ? { signal } : {}) });
    }
    return await withRetry(call, { ...(signal ? { signal } : {}) });
  }

  callTool.__pbRetryWrapped = true;
  callTool.__pbRetryOriginal = originalCallTool;
  if (isRetryStrategyLike(retryStrategy)) callTool.__pbRetryStrategy = retryStrategy;
  mcpClient.callTool = callTool;
}
