/**
 * stageApi 接口定义与工厂
 *
 * stageApi 是各 Stage 的服务注入点，提供：
 * - 事件发射
 * - 取消信号
 * - 外部服务
 */

import { isPlainObject } from "./value-utils.js";

/**
 * stageApi 接口规范
 */
export const StageApiSpec = {
  // 必需字段
  required: [
    "signal", // AbortSignal - 取消信号
  ],

  // 可选字段（带默认行为）
  optional: {
    emit: null, // (name, record) => void
    eventBus: null, // EventEmitter 实例
    modelRouter: null, // { call: (opts) => Promise }
    aiApiService: null, // { chat: (opts) => Promise }
    localRetriever: null, // (sourceIndex, gaps, config) => Promise
    externalSearchProvider: null, // MCP provider
    logger: null, // Logger 实例
    checkCancelled: null, // () => void (throws if cancelled)
  },
};

/**
 * 验证 stageApi 是否符合规范
 * @param {object} api - 待验证的 stageApi
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
export function validateStageApi(api) {
  const missing = [];
  const warnings = [];

  const isObjectLike = api !== null && typeof api === "object" && !Array.isArray(api);
  if (!isPlainObject(api) && !isObjectLike) {
    return { valid: false, missing: ["stageApi must be an object"], warnings: [] };
  }

  for (const field of StageApiSpec.required) {
    if (!(field in api) || api[field] === undefined) {
      missing.push(field);
    }
  }

  if (api.emit && typeof api.emit !== "function") {
    warnings.push("emit should be a function");
  }
  if (api.modelRouter && typeof api.modelRouter?.call !== "function") {
    warnings.push("modelRouter.call should be a function");
  }
  if (api.aiApiService && typeof api.aiApiService?.chat !== "function") {
    warnings.push("aiApiService.chat should be a function");
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

function defaultCheckCancelled(signal) {
  if (signal?.aborted) {
    const reason = signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
}

function resolveEmit(partial) {
  if (typeof partial?.emit === "function") return partial.emit.bind(partial);
  if (typeof partial?.eventBus?.emit === "function") return partial.eventBus.emit.bind(partial.eventBus);
  return null;
}

/**
 * 创建带默认值的 stageApi
 * @param {object} partial - 部分 stageApi 配置
 * @param {object} options - 额外选项
 * @returns {object} 完整的 stageApi
 */
export function createStageApi(partial = {}, { strict = false } = {}) {
  const api = { ...(partial && typeof partial === "object" ? partial : {}) };

  if (!api.signal) {
    api.signal = new AbortController().signal;
  }

  for (const [key, defaultValue] of Object.entries(StageApiSpec.optional)) {
    if (!(key in api) || api[key] === undefined) {
      api[key] = defaultValue;
    }
  }

  api.emit = resolveEmit(api) || (() => {});

  api.checkCancelled =
    typeof api.checkCancelled === "function"
      ? api.checkCancelled
      : () => {
          defaultCheckCancelled(api.signal);
        };

  if (strict) {
    const { valid, missing, warnings } = validateStageApi(api);
    if (!valid) {
      throw new Error(`Invalid stageApi: missing ${missing.join(", ")}`);
    }
    if (warnings.length > 0) {
      console.warn("stageApi warnings:", warnings);
    }
  }

  return api;
}

/**
 * 从 stageApi 提取常用服务
 * @param {object} stageApi
 * @returns {object} 解构后的服务
 */
export function extractServices(stageApi) {
  const api = stageApi && typeof stageApi === "object" ? stageApi : {};
  const signal = api.signal || null;

  return {
    signal,
    emit: resolveEmit(api) || (() => {}),
    eventBus: api.eventBus || null,
    modelRouter: api.modelRouter || null,
    aiApiService: api.aiApiService || null,
    localRetriever: api.localRetriever || null,
    externalSearchProvider: api.externalSearchProvider || null,
    logger: api.logger || null,
    checkCancelled:
      typeof api.checkCancelled === "function"
        ? api.checkCancelled
        : () => {
            defaultCheckCancelled(signal);
          },
  };
}

/**
 * 合并多个 stageApi 配置
 * @param  {...object} apis - 多个部分配置
 * @returns {object} 合并后的 stageApi
 */
export function mergeStageApis(...apis) {
  const merged = {};
  for (const api of apis) {
    if (!api) continue;
    for (const [key, value] of Object.entries(api)) {
      if (value !== undefined && value !== null) {
        merged[key] = value;
      }
    }
  }
  return createStageApi(merged);
}

/**
 * 创建子阶段的 stageApi（继承父级，可覆盖部分）
 * @param {object} parentApi - 父级 stageApi
 * @param {object} overrides - 覆盖配置
 * @returns {object} 子阶段 stageApi
 */
export function createChildApi(parentApi, overrides = {}) {
  return createStageApi({ ...parentApi, ...overrides });
}

