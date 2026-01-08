/**
 * StageApiFactory - 统一 StageApi 创建
 *
 * 解决问题：
 * 1. workflow-runtime.js 中 18 个参数手动注入
 * 2. stageApi 字段遗漏导致运行时错误
 * 3. 各 stage 重复的注入逻辑
 */

import { createStageApi } from "../../shared/utils/stage-api.js";
import { createFsAdapterFromVfs } from "../../vfs/fs-adapter.js";
import { createVfsGlobFn } from "../../vfs/glob.js";
import { createLogger } from "../../shared/utils/logger.js";
import { isPlainObject, toNonNegativeInt } from "../../shared/utils/value-utils.js";
import { getGlobalTokenTracker } from "../telemetry/token-tracker.js";
import { CircuitBreakerRegistry } from "../../shared/utils/circuit-breaker.js";
import { TraceContext } from "../telemetry/trace-context.js";
import { withRetry } from "../core/retry-strategy.js";
import { getErrorBoundary } from "../core/error-boundary.js";
import { ToolQuotaManager } from "../tools/tool-quotas.js";
import { MessageBus } from "../../core/message-bus.js";

const logger = createLogger("runtime/api/stage-api-factory");

/**
 * @typedef {Object} ServiceContainerLike
 * @property {(key: string) => any} [get]
 * @property {(key: string) => any} [tryGet]
 */

/**
 * @typedef {Object} StageApiFactoryServices
 * @property {AbortSignal|null} [signal]
 * @property {any} [eventBus]
 * @property {(name: string, record: any) => void} [emit]
 * @property {any} [traceContext]
 * @property {string} [traceparent]
 * @property {ServiceContainerLike} [container]
 * @property {any} [aiApiService]
 * @property {any} [modelRouter]
 * @property {any} [localRetriever]
 * @property {any} [externalSearchProvider]
 * @property {any} [mcpClient]
 * @property {any} [mcpResources]
 * @property {any} [circuitBreakerRegistry]
 * @property {any} [retryStrategy]
 * @property {any} [errorBoundary]
 * @property {any} [toolQuotaManager]
 * @property {any} [messageBus]
 * @property {any} [eventBusBackpressure]
 * @property {any} [backpressure]
 * @property {any} [storageAdapter]
 * @property {any} [ocr]
 * @property {any} [imageProvider]
 * @property {any} [svgGenerator]
 * @property {any} [archive]
 * @property {any} [logger]
 * @property {any} [vfs]
 * @property {any} [policy]
 * @property {any} [runtimeScheduler]
 * @property {any} [pythonSkillExecutor]
 * @property {any} [jsAdapter]
 * @property {any} [hnswIndex]
 * @property {any} [schemaValidator]
 * @property {any} [deltaSyncSession]
 * @property {any} [fileLock]
 * @property {any} [tocBuilder]
 * @property {any} [policyManager]
 * @property {any} [replayController]
 * @property {any} [sharedMemoryBridge]
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
 */
/**
 * @param {Record<string, any> | null | undefined} obj
 * @returns {Record<string, any>}
 */
function filterDefinedValues(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  );
}

/**
 * @param {any} value
 * @returns {boolean}
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
 * @param {ServiceContainerLike | null | undefined} container
 * @returns {any | null}
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
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {{ traceContext?: any, traceparent?: string, container?: ServiceContainerLike } | undefined} [options]
 * @returns {any}
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
 * @param {any} value
 * @returns {boolean}
 */
function isRetryStrategyLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.execute === "function"
  );
}

/**
 * @param {ServiceContainerLike | null | undefined} container
 * @returns {any | null}
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
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {{ retryStrategy?: any, container?: ServiceContainerLike } | undefined} [options]
 * @returns {any | null}
 */
function resolveRetryStrategy({ retryStrategy, container } = {}) {
  if (isRetryStrategyLike(retryStrategy)) return retryStrategy;
  const fromContainer = resolveRetryStrategyFromContainer(container);
  if (fromContainer) return fromContainer;
  return null;
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isErrorBoundaryLike(value) {
  return value !== null && typeof value === "object" && typeof value.wrap === "function";
}

/**
 * @param {ServiceContainerLike | null | undefined} container
 * @returns {any | null}
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
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {{ errorBoundary?: any, container?: ServiceContainerLike } | undefined} [options]
 * @returns {any}
 */
function resolveErrorBoundary({ errorBoundary, container } = {}) {
  if (isErrorBoundaryLike(errorBoundary)) return errorBoundary;
  const fromContainer = resolveErrorBoundaryFromContainer(container);
  if (fromContainer) return fromContainer;
  return getErrorBoundary();
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isToolQuotaManagerLike(value) {
  return value !== null && typeof value === "object" && typeof value.tryCall === "function";
}

/**
 * @param {ServiceContainerLike | null | undefined} container
 * @returns {any | null}
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
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {{ toolQuotaManager?: any, container?: ServiceContainerLike } | undefined} [options]
 * @returns {any | null}
 */
function resolveToolQuotaManager({ toolQuotaManager, container } = {}) {
  if (isToolQuotaManagerLike(toolQuotaManager)) return toolQuotaManager;
  const fromContainer = resolveToolQuotaManagerFromContainer(container);
  if (fromContainer) return fromContainer;
  return null;
}

// P6.3: MessageBus 解析
function isMessageBusLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.request === "function" &&
    typeof value.handle === "function"
  );
}

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
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {{ messageBus?: any, eventBus?: any, container?: ServiceContainerLike } | undefined} [options]
 * @returns {any | null}
 */
function resolveMessageBus({ messageBus, eventBus, container } = {}) {
  if (isMessageBusLike(messageBus)) return messageBus;
  const fromContainer = resolveMessageBusFromContainer(container);
  if (fromContainer) return fromContainer;
  // 如果有 eventBus，创建新的 MessageBus
  if (eventBus && typeof eventBus.emit === "function") {
    return new MessageBus(eventBus);
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
 * @param {any} eventBus
 * @param {any} config
 * @returns {void}
 */
function ensureEventBusBackpressure(eventBus, config) {
  if (!eventBus || typeof eventBus.enableBackpressure !== "function") return;

  // Avoid overriding a bus that has already been configured (e.g. Orchestrator defaults).
  if (eventBus?._backpressure?.enabled) return;

  const cfg = config === false ? false : isPlainObject(config) ? config : {};
  if (cfg === false) return;

  try {
    eventBus.enableBackpressure({ ...DEFAULT_EVENTBUS_BACKPRESSURE, ...cfg });
  } catch {
    // ignore
  }
}

/**
 * @param {any} resp
 * @returns {{ promptTokens: number, completionTokens: number }}
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
 * @param {any} aiApiService
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
    // Allow updating the active registry even after wrapping.
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
    const breaker = breakerRegistry
      ? breakerRegistry.get(`aiApiService:chat:${usage}:${model}`, {
          failureThreshold: 4,
          successThreshold: 1,
          openDurationMs: 15_000,
          halfOpenMaxCalls: 1,
          isFailure: (err) => {
            if (err?.name === "AbortError") return false;
            return true;
          },
        })
      : null;

    try {
      const call = () => originalChat.call(aiApiService, opts);
      const resp = breaker ? await breaker.execute(call) : await call();
      const latencyMs = Date.now() - startedAt;
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
      } catch {
        // Ignore tracker errors.
      }
      return resp;
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
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
      } catch {
        // Ignore tracker errors.
      }
      throw err;
    }
  }

  chat.__tokenTrackerWrapped = true;
  chat.__tokenTrackerOriginal = originalChat;
  if (registryLike) chat.__pbCircuitBreakerRegistry = registryLike;
  aiApiService.chat = chat;
}

/**
 * @param {any} aiApiService
 * @param {any} retryStrategy
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
 * @param {any} mcpClient
 * @param {any} retryStrategy
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
   * @param {StageApiFactoryServices} [services]
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
   * 创建基础 StageApi
   * @param {Record<string, any>} [overrides]
   * @returns {any}
   */
  createBaseApi(overrides = {}) {
    // 过滤 undefined 值，避免覆盖已有配置
    const filtered = filterDefinedValues(overrides);
    const api = createStageApi({
      ...this.baseConfig,
      ...this.services,
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
   * 创建 DeepSearch 专用 StageApi
   * @param {Record<string, any>} [overrides]
   * @returns {any}
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
   * 创建 Design 专用 StageApi
   * @param {Record<string, any>} [overrides]
   * @returns {any}
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
   * @param {Record<string, any>} [overrides]
   * @returns {any}
   */
  createTextPrepApi(overrides = {}) {
    return this.createBaseApi(overrides);
  }

  /**
   * 验证 StageApi 必需字段
   * @param {any} api
   * @param {string[]} requiredFields
   * @param {string} [stageName]
   * @returns {boolean}
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
   * 从 workflow context 创建 Factory
   * @param {any} ctx
   * @returns {StageApiFactory}
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
 * @param {StageApiFactoryServices} services
 * @returns {StageApiFactory}
 */
export function createStageApiFactory(services) {
  return new StageApiFactory(services);
}

export default StageApiFactory;
