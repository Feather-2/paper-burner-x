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
import { getGlobalTokenTracker } from "../telemetry/token-tracker.js";

const logger = createLogger("runtime/api/stage-api-factory");

// 必需字段验证
const REQUIRED_FIELDS = ["signal", "emit"];
const DEEPSEARCH_REQUIRED = [...REQUIRED_FIELDS, "aiApiService"];
const DESIGN_REQUIRED = [...REQUIRED_FIELDS, "aiApiService"];

/**
 * 过滤掉 undefined 和 null 的值，避免覆盖已有配置
 */
function filterDefinedValues(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  );
}

function toNonNegativeInt(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
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
  if (originalChat.__tokenTrackerWrapped === true) return;

  async function chat(opts = {}) {
    const startedAt = Date.now();
    try {
      const resp = await originalChat.call(aiApiService, opts);
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
  aiApiService.chat = chat;
}

export class StageApiFactory {
  constructor(services = {}) {
    this.services = services;
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

    // Browser-first: if a VFS is present, derive Node-like fs/globFn for CodeSearch tools.
    if (!api.fs && api.vfs) {
      const adapter = createFsAdapterFromVfs(api.vfs);
      if (adapter) api.fs = adapter;
    }
    if (!api.globFn && api.vfs) {
      const globFn = createVfsGlobFn(api.vfs);
      if (globFn) api.globFn = globFn;
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
      aiApiService: ctx.aiApiService,
      modelRouter: ctx.modelRouter,
      localRetriever: ctx.localRetriever,
      externalSearchProvider: ctx.externalSearchProvider,
      mcpClient: ctx.mcpClient,
      mcpResources: ctx.mcpResources,
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
