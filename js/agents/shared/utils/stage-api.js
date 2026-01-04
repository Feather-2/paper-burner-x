/**
 * stageApi 接口定义与工厂
 *
 * stageApi 是各 Stage 的服务注入点，提供：
 * - 事件发射
 * - 取消信号
 * - 外部服务
 */

import { isPlainObject } from "./value-utils.js";
import { createLogger } from "./logger.js";
import { checkCancelled } from "./cancellation.js";

const logger = createLogger("shared/utils/stage-api");

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
    runTool: null, // (toolName, args) => Promise - AI 工具调用
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
          checkCancelled(api.signal);
        };

  if (strict) {
    const { valid, missing, warnings } = validateStageApi(api);
    if (!valid) {
      throw new Error(`Invalid stageApi: missing ${missing.join(", ")}`);
    }
    if (warnings.length > 0) {
      logger.warn("stageApi warnings:", { warnings });
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
    runTool: typeof api.runTool === "function" ? api.runTool : null,
    checkCancelled:
      typeof api.checkCancelled === "function"
        ? api.checkCancelled
        : () => {
            checkCancelled(signal);
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

/**
 * 创建基于 modelRouter 的 runTool 实现
 * @param {object} options - { modelRouter, signal, logger }
 * @returns {function} runTool 函数
 */
export function createRunTool({ modelRouter, signal, logger } = {}) {
  if (!modelRouter || typeof modelRouter.call !== "function") {
    return null;
  }

  const toolSchemas = {
    synthesize_claims: {
      name: "synthesize_claims",
      description: "合并语义相似的论点为更全面的表述",
      parameters: {
        type: "object",
        properties: {
          claims: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                importance: { type: "string" },
              },
            },
          },
        },
        required: ["claims"],
      },
    },
    analyze_conflicts: {
      name: "analyze_conflicts",
      description: "分析论点对之间的语义冲突",
      parameters: {
        type: "object",
        properties: {
          pairs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                a: { type: "object" },
                b: { type: "object" },
              },
            },
          },
        },
        required: ["pairs"],
      },
    },
  };

  return async function runTool(toolName, args) {
    const schema = toolSchemas[toolName];
    if (!schema) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const systemPrompt =
      toolName === "synthesize_claims"
        ? `你是一个知识综合助手。分析给定的论点，识别语义重复或高度相似的论点，并将它们合并为更全面的表述。
输出格式：{"mergedClaims":[{"id":"新ID","text":"合并后文本","importance":"core或support","sourceIds":["原始ID1","原始ID2"]}]}`
        : `你是一个冲突检测助手。分析给定的论点对，判断它们是否存在语义冲突。
输出格式：{"conflicts":[{"claimId1":"ID1","claimId2":"ID2","reason":"冲突原因","resolutionTask":"解决任务"}]}`;

    try {
      const result = await modelRouter.call({
        taskType: "tool_call",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(args) },
        ],
        responseFormat: { type: "json_object" },
        signal,
      });

      const content = result?.choices?.[0]?.message?.content || result?.content;
      if (typeof content === "string") {
        return JSON.parse(content);
      }
      return content;
    } catch (err) {
      logger?.warn?.(`runTool(${toolName}) failed:`, err?.message);
      throw err;
    }
  };
}
