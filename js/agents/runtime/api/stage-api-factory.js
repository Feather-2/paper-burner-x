/**
 * StageApiFactory - 统一 StageApi 创建
 *
 * 解决问题：
 * 1. workflow-runtime.js 中 18 个参数手动注入
 * 2. stageApi 字段遗漏导致运行时错误
 * 3. 各 stage 重复的注入逻辑
 */

import { createStageApi } from "../../shared/utils/stage-api.js";

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
    return createStageApi({
      ...this.baseConfig,
      ...this.services,
      ...filtered,
    });
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
      console.warn(`[StageApiFactory] ${stageName} API missing fields: ${missing.join(", ")}`);
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
      storageAdapter: ctx.storageAdapter,
      ocr: ctx.ocr,
      imageProvider: ctx.imageProvider || ctx.imageService,
      svgGenerator: ctx.svgGenerator,
      archive: ctx.archive,
      logger: ctx.logger,
    });
  }
}

export function createStageApiFactory(services) {
  return new StageApiFactory(services);
}

export default StageApiFactory;
