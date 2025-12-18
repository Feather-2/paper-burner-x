/**
 * DeepSearch 配置 Schema 定义与验证
 */

import { isPlainObject, toNonEmptyString, safeInt } from "../../shared/value-utils.js";

/**
 * 配置项类型定义
 */
const ConfigTypes = {
  INT: "int",
  FLOAT: "float",
  BOOL: "bool",
  STRING: "string",
  ENUM: "enum",
  OBJECT: "object",
  ARRAY: "array",
};

/**
 * 配置 Schema
 */
export const CONFIG_SCHEMA = {
  // 迭代控制
  maxIterations: { type: ConfigTypes.INT, default: 5, min: 1, max: 20 },

  // 检索配置
  retrieval: {
    type: ConfigTypes.OBJECT,
    schema: {
      chunkSize: { type: ConfigTypes.INT, default: 1600, min: 200, max: 8000 },
      overlap: { type: ConfigTypes.INT, default: 180, min: 0, max: 500 },
      topK: { type: ConfigTypes.INT, default: 6, min: 1, max: 50 },
      windowSize: { type: ConfigTypes.INT, default: 3, min: 1, max: 10 },
      maxChunks: { type: ConfigTypes.INT, default: 200, min: 10, max: 1000 },
      useBm25: { type: ConfigTypes.BOOL, default: true },
      useGrep: { type: ConfigTypes.BOOL, default: true },
      enableToolChain: { type: ConfigTypes.BOOL, default: false },
      rerank: {
        type: ConfigTypes.OBJECT,
        schema: {
          enabled: { type: ConfigTypes.BOOL, default: false },
          topK: { type: ConfigTypes.INT, default: 10, min: 1, max: 50 },
          timeoutMs: { type: ConfigTypes.INT, default: 12000, min: 1000, max: 60000 },
          minChunksToRerank: { type: ConfigTypes.INT, default: 4, min: 1, max: 20 },
        },
      },
      shadow: {
        type: ConfigTypes.OBJECT,
        schema: {
          enabled: { type: ConfigTypes.BOOL, default: false },
          budgetPerIteration: { type: ConfigTypes.INT, default: 5, min: 1, max: 20 },
        },
      },
    },
  },

  // Gap 配置
  gaps: {
    type: ConfigTypes.OBJECT,
    schema: {
      maxGaps: { type: ConfigTypes.INT, default: 10, min: 1, max: 50 },
      blockAfterMisses: { type: ConfigTypes.INT, default: 3, min: 1, max: 10 },
      minEvidenceToFill: { type: ConfigTypes.INT, default: 2, min: 1, max: 10 },
    },
  },

  // Budget 配置
  budget: {
    type: ConfigTypes.OBJECT,
    schema: {
      maxInputTokens: { type: ConfigTypes.INT, default: 500000, min: 10000, max: 5000000 },
      maxOutputTokens: { type: ConfigTypes.INT, default: 200000, min: 5000, max: 2000000 },
      maxTotalTokens: { type: ConfigTypes.INT, default: 700000, min: 20000, max: 7000000 },
      degradeThreshold: { type: ConfigTypes.FLOAT, default: 0.8, min: 0.1, max: 0.99 },
    },
  },

  // 外部搜索配置
  externalSearch: {
    type: ConfigTypes.OBJECT,
    schema: {
      enabled: { type: ConfigTypes.BOOL, default: false },
      provider: { type: ConfigTypes.ENUM, default: "tavily", options: ["tavily", "serper", "brave", "mcp"] },
      maxResults: { type: ConfigTypes.INT, default: 5, min: 1, max: 20 },
      timeoutMs: { type: ConfigTypes.INT, default: 10000, min: 1000, max: 60000 },
    },
  },

  // 写作配置
  write: {
    type: ConfigTypes.OBJECT,
    schema: {
      maxSections: { type: ConfigTypes.INT, default: 10, min: 1, max: 30 },
      maxWordsPerSection: { type: ConfigTypes.INT, default: 1000, min: 100, max: 5000 },
      style: { type: ConfigTypes.ENUM, default: "professional", options: ["academic", "professional", "casual"] },
    },
  },

  // Trajectory 配置
  trajectory: {
    type: ConfigTypes.OBJECT,
    schema: {
      enabled: { type: ConfigTypes.BOOL, default: false },
      n: { type: ConfigTypes.INT, default: 3, min: 2, max: 10 },
      mergeStrategy: { type: ConfigTypes.ENUM, default: "vote", options: ["union", "vote", "best"] },
    },
  },
};

/**
 * 验证单个配置项
 */
function validateField(value, schema, path) {
  const issues = [];

  if (value === undefined || value === null) {
    if (schema.type === ConfigTypes.OBJECT && schema.schema) {
      return { value: buildDefaults(schema.schema), issues };
    }
    if (schema.type === ConfigTypes.ARRAY) {
      return { value: schema.default || [], issues };
    }
    return { value: schema.default, issues };
  }

  switch (schema.type) {
    case ConfigTypes.INT: {
      const n = safeInt(value);
      if (n === null) {
        issues.push({ path, issue: "must be an integer", got: typeof value });
        return { value: schema.default, issues };
      }
      const clamped = Math.max(schema.min ?? -Infinity, Math.min(schema.max ?? Infinity, n));
      if (clamped !== n) {
        issues.push({ path, issue: `clamped from ${n} to ${clamped}`, reason: `range [${schema.min}, ${schema.max}]` });
      }
      return { value: clamped, issues };
    }

    case ConfigTypes.FLOAT: {
      const f = parseFloat(value);
      if (!Number.isFinite(f)) {
        issues.push({ path, issue: "must be a number", got: typeof value });
        return { value: schema.default, issues };
      }
      const clamped = Math.max(schema.min ?? -Infinity, Math.min(schema.max ?? Infinity, f));
      if (clamped !== f) {
        issues.push({ path, issue: `clamped from ${f} to ${clamped}`, reason: `range [${schema.min}, ${schema.max}]` });
      }
      return { value: clamped, issues };
    }

    case ConfigTypes.BOOL: {
      if (typeof value !== "boolean") {
        issues.push({ path, issue: "must be a boolean", got: typeof value });
        return { value: schema.default, issues };
      }
      return { value, issues };
    }

    case ConfigTypes.STRING: {
      const s = toNonEmptyString(value);
      if (!s && schema.required) {
        issues.push({ path, issue: "required string is empty" });
        return { value: schema.default || "", issues };
      }
      return { value: s || schema.default || "", issues };
    }

    case ConfigTypes.ENUM: {
      const s = String(value || "").toLowerCase();
      if (!schema.options.includes(s)) {
        issues.push({ path, issue: `must be one of [${schema.options.join(", ")}]`, got: s });
        return { value: schema.default, issues };
      }
      return { value: s, issues };
    }

    case ConfigTypes.OBJECT: {
      if (!isPlainObject(value)) {
        issues.push({ path, issue: "must be an object", got: typeof value });
        return { value: buildDefaults(schema.schema), issues };
      }
      const { config: nested, issues: nestedIssues } = validateConfig(value, schema.schema, path);
      return { value: nested, issues: [...issues, ...nestedIssues] };
    }

    case ConfigTypes.ARRAY: {
      if (!Array.isArray(value)) {
        issues.push({ path, issue: "must be an array", got: typeof value });
        return { value: schema.default || [], issues };
      }
      return { value, issues };
    }

    default:
      return { value: schema.default, issues };
  }
}

/**
 * 构建默认配置
 */
function buildDefaults(schema) {
  const defaults = {};
  for (const [key, fieldSchema] of Object.entries(schema)) {
    if (fieldSchema.type === ConfigTypes.OBJECT && fieldSchema.schema) {
      defaults[key] = buildDefaults(fieldSchema.schema);
    } else {
      defaults[key] = fieldSchema.default;
    }
  }
  return defaults;
}

/**
 * 验证配置对象
 */
function validateConfig(input, schema, prefix = "") {
  const config = {};
  const issues = [];

  for (const [key, fieldSchema] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const { value, issues: fieldIssues } = validateField(input?.[key], fieldSchema, path);
    config[key] = value;
    issues.push(...fieldIssues);
  }

  return { config, issues };
}

/**
 * 验证并归一化 DeepSearch 用户配置
 * @param {object} userConfig - 用户提供的原始配置
 * @param {object} options - 验证选项
 * @returns {{ config: object, issues: Array, valid: boolean }}
 */
export function validateUserConfig(userConfig, { strict = false, emit, logger } = {}) {
  const input = isPlainObject(userConfig) ? userConfig : {};
  const { config, issues } = validateConfig(input, CONFIG_SCHEMA);

  if (issues.length > 0) {
    emit?.("deepsearch.config.validation", { issuesCount: issues.length, issues });
    logger?.warn?.("Config validation issues", { data: { issuesCount: issues.length, issues } });
  }

  return {
    config,
    issues,
    valid: strict ? issues.length === 0 : true,
  };
}

/**
 * 获取默认配置
 */
export function getDefaultConfig() {
  return buildDefaults(CONFIG_SCHEMA);
}
