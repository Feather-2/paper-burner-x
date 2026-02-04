/**
 * StageApiFactory - 统一 StageApi 创建
 *
 * 解决问题：
 * 1. workflow-runtime.js 中 18 个参数手动注入
 * 2. stageApi 字段遗漏导致运行时错误
 * 3. 各 stage 重复的注入逻辑
 */

import { createStageApi } from "../../../shared/index.js";
import { createFsAdapterFromVfs } from "../../../vfs/fs-adapter.js";
import { createVfsGlobFn } from "../../../vfs/glob.js";
import { createLogger } from "../../../shared/index.js";
import { isPlainObject, toNonNegativeInt } from "../../../shared/index.js";
import { getGlobalTokenTracker, TraceContext } from "../../../plugins/telemetry/index.js";
import { CircuitBreakerRegistry } from "../../../shared/index.js";
import { withRetry } from "../retry-strategy.js";
import { getErrorBoundary } from "../error-boundary.js";
import { ToolQuotaManager } from "../../tools/tool-quotas.js";
import { MessageBus } from "../../../core/message-bus.js";

const logger = createLogger("runtime/api/stage-api-factory");

/**
 * @typedef {Object} ServiceContainerLike
 * @property {(key: string) => unknown} [get]
 * @property {(key: string) => unknown} [tryGet]
 */

/**
 * @typedef {Object} EventBusBackpressureConfig
 * @property {RegExp} [coalescePattern]
 * @property {boolean} [deferNonCoalesced]
 * @property {number} [maxQueueSize]
 */

/**
 * @typedef {Object} EventBusLike
 * @property {(name: string, record: Record<string, unknown>) => void} emit
 * @property {(config: EventBusBackpressureConfig) => void} [enableBackpressure]
 * @property {{ enabled?: boolean }} [_backpressure]
 */

/**
 * @typedef {Object} TraceContextLike
 * @property {(name: string, attrs?: Record<string, unknown>) => unknown} startSpan
 * @property {(span: unknown) => void} endSpan
 * @property {(name: string, fn: (...args: unknown[]) => unknown) => unknown} withSpan
 * @property {() => string} getTraceparent
 */

/**
 * @typedef {Object} RetryStrategyLike
 * @property {(fn: () => Promise<unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>} execute
 */

/**
 * @typedef {Object} ErrorBoundaryLike
 * @property {(fn: (...args: unknown[]) => unknown) => unknown} wrap
 */

/**
 * @typedef {Object} ToolQuotaManagerLike
 * @property {(toolName: string, fn: () => Promise<unknown>) => Promise<unknown>} tryCall
 */

/**
 * @typedef {Object} MessageBusLike
 * @property {(name: string, payload: unknown) => Promise<unknown>} request
 * @property {(name: string, handler: (payload: unknown) => Promise<unknown>) => void} handle
 */

/**
 * @typedef {Object} CircuitBreakerRegistryLike
 * @property {(key: string, options?: Record<string, unknown>) => { execute: (fn: () => Promise<unknown>) => Promise<unknown> } | null} get
 */

/**
 * @typedef {Object} AiApiServiceLike
 * @property {(opts?: Record<string, unknown>) => Promise<unknown>} chat
 * @property {CircuitBreakerRegistryLike} [circuitBreakerRegistry]
 */

/**
 * @typedef {Object} McpClientLike
 * @property {(toolName: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>} callTool
 */

/**
 * @typedef {Object} LoggerLike
 * @property {(message: string, err?: unknown) => void} debug
 * @property {(message: string, err?: unknown) => void} warn
 */

/**
 * @typedef {unknown} UnknownService
 */

/**
 * @typedef {Object} StageApiFactoryServices
 * @property {AbortSignal|null} [signal]
 * @property {EventBusLike} [eventBus]
 * @property {(name: string, record: Record<string, unknown>) => void} [emit]
 * @property {TraceContextLike} [traceContext]
 * @property {string} [traceparent]
 * @property {ServiceContainerLike} [container]
 * @property {AiApiServiceLike} [aiApiService]
 * @property {UnknownService} [modelRouter]
 * @property {UnknownService} [localRetriever]
 * @property {McpClientLike} [externalSearchProvider]
 * @property {McpClientLike} [mcpClient]
 * @property {UnknownService} [mcpResources]
 * @property {CircuitBreakerRegistryLike} [circuitBreakerRegistry]
 * @property {RetryStrategyLike} [retryStrategy]
 * @property {ErrorBoundaryLike} [errorBoundary]
 * @property {ToolQuotaManagerLike} [toolQuotaManager]
 * @property {MessageBusLike} [messageBus]
 * @property {EventBusBackpressureConfig | false} [eventBusBackpressure]
 * @property {EventBusBackpressureConfig | false} [backpressure]
 * @property {UnknownService} [storageAdapter]
 * @property {UnknownService} [ocr]
 * @property {UnknownService} [imageProvider]
 * @property {UnknownService} [svgGenerator]
 * @property {UnknownService} [archive]
 * @property {LoggerLike} [logger]
 * @property {UnknownService} [vfs]
 * @property {UnknownService} [policy]
 * @property {UnknownService} [runtimeScheduler]
 * @property {UnknownService} [pythonSkillExecutor]
 * @property {UnknownService} [jsAdapter]
 * @property {UnknownService} [hnswIndex]
 * @property {UnknownService} [schemaValidator]
 * @property {UnknownService} [deltaSyncSession]
 * @property {UnknownService} [fileLock]
 * @property {UnknownService} [tocBuilder]
 * @property {UnknownService} [policyManager]
 * @property {UnknownService} [replayController]
 * @property {UnknownService} [sharedMemoryBridge]
 */

// 必需字段验证
const REQUIRED_FIELDS = ["signal", "emit"];
const DEEPSEARCH_REQUIRED = [...REQUIRED_FIELDS, "aiApiService"];
const DESIGN_REQUIRED = [...REQUIRED_FIELDS, "aiApiService"];

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
function filterDefinedValues(obj) {
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
function isTraceContextLike(value) {
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
function resolveTraceContextFromContainer(container) {
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
function resolveTraceContext({ traceContext, traceparent, container } = {}) {
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
function isRetryStrategyLike(value) {
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
function resolveRetryStrategyFromContainer(container) {
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
function resolveRetryStrategy({ retryStrategy, container } = {}) {
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
function isErrorBoundaryLike(value) {
  return value !== null && typeof value === "object" && typeof value.wrap === "function";
}

/**
 * @private
 * @param {ServiceContainerLike | null | undefined} container - DI container to resolve from
 * @returns {any | null} resolved ErrorBoundary or null
 */
function resolveErrorBoundaryFromContainer(container) {
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
function resolveErrorBoundary({ errorBoundary, container } = {}) {
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
function isToolQuotaManagerLike(value) {
  return value !== null && typeof value === "object" && typeof value.tryCall === "function";
}

/**
 * @private
 * @param {ServiceContainerLike | null | undefined} container - DI container to resolve from
 * @returns {any | null} resolved ToolQuotaManager or null
 */
function resolveToolQuotaManagerFromContainer(container) {
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
function resolveToolQuotaManager({ toolQuotaManager, container } = {}) {
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
function isMessageBusLike(value) {
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
function resolveMessageBusFromContainer(container) {
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
function resolveMessageBus({ messageBus, eventBus, container } = {}) {
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

const DEFAULT_TOOL_QUOTAS = Object.freeze({
  search: { maxCalls: 10, windowMs: 60_000 },
  "search-docs": { maxCalls: 10, windowMs: 60_000 },
  "search.query": { maxCalls: 10, windowMs: 60_000 },
  "search.fetch": { maxCalls: 30, windowMs: 60_000 },
});

/**
 * @private
 * @param {any} eventBus - EventBus instance to configure
 * @param {any} config - backpressure configuration
 * @returns {void}
 */
function ensureEventBusBackpressure(eventBus, config) {
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
function extractTokenUsage(resp) {
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
function createCircuitBreaker(breakerRegistry, usage, model) {
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
function recordTokenTrackingSuccess(resp, opts, latencyMs) {
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
function recordTokenTrackingFailure(opts, latencyMs, err) {
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
function ensureAiApiServiceTokenTracking(aiApiService) {
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
function ensureAiApiServiceRetry(aiApiService, retryStrategy) {
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
function ensureMcpClientRetry(mcpClient, retryStrategy) {
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

export class StageApiFactory {
  /**
   * 创建 StageApiFactory 实例
   * @param {StageApiFactoryServices} [services] - 服务配置与依赖注入
   */
  constructor(services = {}) {
    /** @type {StageApiFactoryServices} */
    const base = services && typeof services === "object" ? services : {};
    this.services = {
      ...base,
      circuitBreakerRegistry:
        base?.circuitBreakerRegistry && typeof base.circuitBreakerRegistry.get === "function"
          ? base.circuitBreakerRegistry
          : new CircuitBreakerRegistry(),
      traceContext: resolveTraceContext({
        traceContext: base?.traceContext,
        traceparent: base?.traceparent,
        container: base?.container,
      }),
      retryStrategy: resolveRetryStrategy({ retryStrategy: base?.retryStrategy, container: base?.container }),
      errorBoundary: resolveErrorBoundary({ errorBoundary: base?.errorBoundary, container: base?.container }),
      toolQuotaManager:
        resolveToolQuotaManager({ toolQuotaManager: base?.toolQuotaManager, container: base?.container }) ||
        new ToolQuotaManager({
          defaultMaxCalls: 100,
          defaultWindowMs: 60_000,
          quotas: DEFAULT_TOOL_QUOTAS,
        }),
      // P6.3: MessageBus 用于跨 Stage IPC
      messageBus: resolveMessageBus({
        messageBus: base?.messageBus,
        eventBus: base?.eventBus,
        container: base?.container,
      }),
      // P6.4-P6.7: 运行时服务（从 container 惰性解析或直接传入）
      runtimeScheduler: base?.runtimeScheduler || null,
      pythonSkillExecutor: base?.pythonSkillExecutor || null,
      jsAdapter: base?.jsAdapter || null,
      hnswIndex: base?.hnswIndex || null,
      schemaValidator: base?.schemaValidator || null,
      deltaSyncSession: base?.deltaSyncSession || null,
      fileLock: base?.fileLock || null,
      tocBuilder: base?.tocBuilder || null,
      // P7: 高级功能
      policyManager: base?.policyManager || null,
      replayController: base?.replayController || null,
      sharedMemoryBridge: base?.sharedMemoryBridge || null,
    };
    this.baseConfig = {
      signal: base.signal || null,
      eventBus: base.eventBus || null,
      emit: base.emit || base.eventBus?.emit || null,
    };
  }

  /**
   * 创建基础 StageApi，包含运行时增强（回压、重试、遥测）
   * @param {Record<string, any>} [overrides] - 覆盖或扩展默认服务配置
   * @returns {any} 增强后的 StageApi 实例
   */
  createBaseApi(overrides = {}) {
    // 过滤 undefined 值，避免覆盖已有配置
    const filteredServices = filterDefinedValues(this.services);
    const filtered = filterDefinedValues(overrides);
    const api = createStageApi({
      ...this.baseConfig,
      ...filteredServices,
      ...filtered,
    });

    // P4.6: Ensure EventBus passed via StageApiFactory has backpressure enabled.
    ensureEventBusBackpressure(api.eventBus, this.services?.eventBusBackpressure ?? this.services?.backpressure);

    // Browser-first: if a VFS is present, derive Node-like fs/globFn for CodeSearch tools.
    if (!api.fs && api.vfs) {
      const adapter = createFsAdapterFromVfs(api.vfs);
      if (adapter) api.fs = adapter;
    }
    if (!api.globFn && api.vfs) {
      const globFn = createVfsGlobFn(api.vfs);
      if (globFn) api.globFn = globFn;
    }

    // Ensure aiApiService.chat has token tracking + circuit breaker protection.
    if (api.aiApiService && api.circuitBreakerRegistry && typeof api.circuitBreakerRegistry.get === "function") {
      try {
        api.aiApiService.circuitBreakerRegistry = api.circuitBreakerRegistry;
      } catch {
        // ignore (non-extensible services)
      }
    }
    ensureAiApiServiceTokenTracking(api.aiApiService);
    ensureAiApiServiceRetry(api.aiApiService, this.services?.retryStrategy);
    ensureMcpClientRetry(api.mcpClient, this.services?.retryStrategy);
    ensureMcpClientRetry(api.externalSearchProvider, this.services?.retryStrategy);

    return api;
  }

  /**
   * 创建 DeepSearch 专用 StageApi，包含检索与 OCR 服务
   * @param {Record<string, any>} [overrides] - 覆盖或扩展默认服务配置
   * @returns {any} DeepSearch 专用 StageApi 实例
   */
  createDeepSearchApi(overrides = {}) {
    const api = this.createBaseApi({
      localRetriever: this.services.localRetriever || null,
      externalSearchProvider: this.services.externalSearchProvider || null,
      storageAdapter: this.services.storageAdapter || null,
      ocr: this.services.ocr || null,
      ...overrides,
    });
    
    this.validate(api, DEEPSEARCH_REQUIRED, "DeepSearch");
    return api;
  }

  /**
   * 创建 Design 专用 StageApi，包含图像与 SVG 服务
   * @param {Record<string, any>} [overrides] - 覆盖或扩展默认服务配置
   * @returns {any} Design 专用 StageApi 实例
   */
  createDesignApi(overrides = {}) {
    const api = this.createBaseApi({
      imageProvider: this.services.imageProvider || null,
      svgGenerator: this.services.svgGenerator || null,
      modelRouter: this.services.modelRouter || null,
      ...overrides,
    });
    
    this.validate(api, DESIGN_REQUIRED, "Design");
    return api;
  }

  /**
   * 创建 TextPrep 专用 StageApi
   * @param {Record<string, any>} [overrides] - 覆盖或扩展默认服务配置
   * @returns {any} TextPrep 专用 StageApi 实例
   */
  createTextPrepApi(overrides = {}) {
    return this.createBaseApi(overrides);
  }

  /**
   * 验证 StageApi 必需字段，缺失时记录警告
   * @param {any} api - 待验证的 StageApi 实例
   * @param {string[]} requiredFields - 必需字段名数组
   * @param {string} [stageName] - Stage 名称，用于日志
   * @returns {boolean} 所有必需字段都存在则返回 true
   */
  validate(api, requiredFields, stageName = "Stage") {
    const missing = requiredFields.filter((field) => {
      const value = api[field];
      return value === undefined || value === null;
    });
    
    if (missing.length > 0) {
      logger.warn(`[StageApiFactory] ${stageName} API missing fields: ${missing.join(", ")}`);
    }
    
    return missing.length === 0;
  }

  /**
   * 从 workflow context 创建 Factory，自动提取常用服务
   * @param {any} ctx - workflow context 对象
   * @returns {StageApiFactory} 新的 Factory 实例
   */
  static fromWorkflowContext(ctx) {
    return new StageApiFactory({
      signal: ctx.signal,
      eventBus: ctx.eventBus,
      emit: ctx.emit || ctx.eventBus?.emit,
      traceContext: ctx.traceContext,
      traceparent: ctx.traceparent,
      container: ctx.container,
      aiApiService: ctx.aiApiService,
      modelRouter: ctx.modelRouter,
      localRetriever: ctx.localRetriever,
      externalSearchProvider: ctx.externalSearchProvider,
      mcpClient: ctx.mcpClient,
      mcpResources: ctx.mcpResources,
      circuitBreakerRegistry: ctx.circuitBreakerRegistry,
      storageAdapter: ctx.storageAdapter,
      ocr: ctx.ocr,
      imageProvider: ctx.imageProvider || ctx.imageService,
      svgGenerator: ctx.svgGenerator,
      archive: ctx.archive,
      logger: ctx.logger,
      vfs: ctx.vfs,
      policy: ctx.policy,
    });
  }
}

/**
 * 创建 StageApiFactory 的工厂函数
 * @param {StageApiFactoryServices} services - 服务配置与依赖注入
 * @returns {StageApiFactory} 新的 Factory 实例
 */
export function createStageApiFactory(services) {
  // Back-compat: keep the original behavior when called with just services.
  // The test harness (and some callsites) may also invoke this as a stage-aware factory:
  //   createStageApiFactory(stageName, services) -> StageApi
  //   createStageApiFactory(services, stageName) -> StageApi
  const a = arguments[0];
  const b = arguments[1];

  if (arguments.length <= 1) {
    return new StageApiFactory(services);
  }

  const stageName = typeof a === "string" ? a : typeof b === "string" ? b : "";
  const svc = a && typeof a === "object" ? a : b && typeof b === "object" ? b : null;

  if (!svc) {
    throw new TypeError("[StageApiFactory] Expected services to be an object.");
  }

  // Required: signal must be explicitly provided (null is allowed).
  if (!Object.prototype.hasOwnProperty.call(svc, "signal")) {
    throw new Error("[StageApiFactory] Missing required field: signal");
  }

  // Required: emit can come from explicit emit or eventBus.emit.
  const hasEmit =
    typeof svc.emit === "function" || (svc.eventBus && typeof svc.eventBus.emit === "function");
  if (!hasEmit) {
    throw new Error("[StageApiFactory] Missing required field: emit (or eventBus.emit)");
  }

  const normalizedStage = typeof stageName === "string" ? stageName.trim().toLowerCase() : "";
  const requiresAiApiService = normalizedStage === "deepsearch" || normalizedStage === "design";

  let aiApiService = svc.aiApiService;
  if (
    requiresAiApiService &&
    (!aiApiService || typeof aiApiService !== "object" || typeof aiApiService.chat !== "function")
  ) {
    const container = svc.container;
    const c = container && typeof container === "object" ? container : null;

    let candidate = null;
    if (c && typeof c.tryGet === "function") {
      candidate = c.tryGet("aiApiService");
    } else if (c && typeof c.get === "function") {
      try {
        candidate = c.get("aiApiService");
      } catch {
        candidate = null;
      }
    }

    if (candidate && typeof candidate === "object" && typeof candidate.chat === "function") {
      aiApiService = candidate;
    } else {
      throw new Error("[StageApiFactory] Missing required field: aiApiService");
    }
  }

  const factory = new StageApiFactory(svc);
  const overrides =
    requiresAiApiService &&
    aiApiService &&
    (!svc.aiApiService || typeof svc.aiApiService.chat !== "function")
      ? { aiApiService }
      : {};

  if (!normalizedStage) return factory.createBaseApi(overrides);
  if (normalizedStage === "deepsearch") return factory.createDeepSearchApi(overrides);
  if (normalizedStage === "design") return factory.createDesignApi(overrides);
  if (normalizedStage === "textprep") return factory.createTextPrepApi(overrides);
  return factory.createBaseApi(overrides);
}

export default StageApiFactory;
