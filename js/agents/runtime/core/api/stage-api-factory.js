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
import { createLogger, CircuitBreakerRegistry } from "../../../shared/index.js";
import { ToolQuotaManager } from "../../tools/tool-quotas.js";
import {
  filterDefinedValues,
  resolveTraceContext,
  resolveRetryStrategy,
  resolveErrorBoundary,
  resolveToolQuotaManager,
  resolveMessageBus,
  ensureEventBusBackpressure,
  ensureAiApiServiceTokenTracking,
  ensureAiApiServiceRetry,
  ensureMcpClientRetry,
} from "./stage-api-helpers.js";

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

const DEFAULT_TOOL_QUOTAS = Object.freeze({
  search: { maxCalls: 10, windowMs: 60_000 },
  "search-docs": { maxCalls: 10, windowMs: 60_000 },
  "search.query": { maxCalls: 10, windowMs: 60_000 },
  "search.fetch": { maxCalls: 30, windowMs: 60_000 },
});

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
 * Create a StageApiFactory.
 *
 * Preferred: `createStageApiFactory({ stageName, services })`
 * Legacy:    `createStageApiFactory(services)`, `createStageApiFactory(stageName, services)`, `createStageApiFactory(services, stageName)`
 *
 * @param {StageApiFactoryServices|{stageName?:string, services:StageApiFactoryServices}|string} first
 * @param {string|Object} [second]
 * @returns {StageApiFactory|object}
 */
export function createStageApiFactory(first, second) {
  // ── New preferred form: options object { stageName, services } ──
  if (
    arguments.length === 1 &&
    first &&
    typeof first === "object" &&
    ("stageName" in first || "services" in first) &&
    !("signal" in first) // disambiguate from legacy services-only form
  ) {
    const stageName = typeof first.stageName === "string" && first.stageName ? first.stageName : "runtime";
    const svc = first.services && typeof first.services === "object" ? first.services : {};
    return new StageApiFactory(svc);
  }

  // ── Legacy forms (preserved as-is) ──
  const a = arguments[0];
  const b = arguments[1];

  if (arguments.length <= 1) {
    return new StageApiFactory(first);
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
    if (svc.container && typeof svc.container.tryGet === "function") {
      aiApiService = svc.container.tryGet("aiApiService") ?? svc.container.tryGet("llm");
    }
    if (!aiApiService || typeof aiApiService !== "object" || typeof aiApiService.chat !== "function") {
      logger.warn(
        `createStageApiFactory: aiApiService missing/invalid for stage "${normalizedStage}". ` +
          `Stage-specific API creation may fail.`
      );
    }
  }

  const factory = new StageApiFactory(svc);

  switch (normalizedStage) {
    case "deepsearch":
      return factory.createDeepSearchApi({ ...svc, aiApiService });
    case "design":
      return factory.createDesignApi({ ...svc, aiApiService });
    case "textprep":
    case "text-prep":
      return factory.createTextPrepApi(svc);
    default:
      return factory.createBaseApi(svc);
  }
}

export default StageApiFactory;
