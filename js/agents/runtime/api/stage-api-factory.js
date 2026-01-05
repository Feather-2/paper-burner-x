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

const logger = createLogger("runtime/api/stage-api-factory");

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
function filterDefinedValues(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  );
}

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

export class StageApiFactory {
  constructor(services = {}) {
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
    };
    this.baseConfig = {
      signal: services.signal || null,
      eventBus: services.eventBus || null,
      emit: services.emit || services.eventBus?.emit || null,
    };
  }

  /**
   * 创建基础 StageApi
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

    return api;
  }

  /**
   * 创建 DeepSearch 专用 StageApi
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
   */
  createTextPrepApi(overrides = {}) {
    return this.createBaseApi(overrides);
  }

  /**
   * 验证 StageApi 必需字段
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

export function createStageApiFactory(services) {
  return new StageApiFactory(services);
}

export default StageApiFactory;
