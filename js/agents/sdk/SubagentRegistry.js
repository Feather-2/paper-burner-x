/**
 * SubagentRegistry - 子代理注册表
 *
 * 管理可用的子代理类型及其工厂函数。
 * 允许模型通过 Task 工具动态启动特定类型的子代理。
 *
 * Phase 2: 添加输出检疫机制，防止脏数据通过 L2 记忆传染系统。
 */

import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";

/**
 * Default output schema for subagent results.
 * Subagents can register custom schemas to override.
 */
const DEFAULT_OUTPUT_SCHEMA = {
  ok: { type: "boolean", required: true },
  summary: { type: "string", required: false, maxLength: 2000 },
  report: { type: "string", required: false, maxLength: 50000 },
  error: { type: "string", required: false, maxLength: 1000 },
};

/**
 * Validate a value against a schema field definition.
 */
function validateField(value, fieldDef, fieldName) {
  const errors = [];

  if (value === undefined || value === null) {
    if (fieldDef.required) {
      errors.push(`Missing required field: ${fieldName}`);
    }
    return errors;
  }

  const expectedType = fieldDef.type;
  const actualType = Array.isArray(value) ? "array" : typeof value;

  if (expectedType === "boolean" && actualType !== "boolean") {
    errors.push(`Field ${fieldName}: expected boolean, got ${actualType}`);
  } else if (expectedType === "string" && actualType !== "string") {
    errors.push(`Field ${fieldName}: expected string, got ${actualType}`);
  } else if (expectedType === "number" && actualType !== "number") {
    errors.push(`Field ${fieldName}: expected number, got ${actualType}`);
  } else if (expectedType === "array" && actualType !== "array") {
    errors.push(`Field ${fieldName}: expected array, got ${actualType}`);
  } else if (expectedType === "object" && !isPlainObject(value)) {
    errors.push(`Field ${fieldName}: expected object, got ${actualType}`);
  }

  if (expectedType === "string" && typeof value === "string") {
    if (fieldDef.maxLength && value.length > fieldDef.maxLength) {
      errors.push(`Field ${fieldName}: exceeds maxLength ${fieldDef.maxLength} (got ${value.length})`);
    }
  }

  if (expectedType === "array" && Array.isArray(value)) {
    if (fieldDef.maxItems && value.length > fieldDef.maxItems) {
      errors.push(`Field ${fieldName}: exceeds maxItems ${fieldDef.maxItems} (got ${value.length})`);
    }
  }

  return errors;
}

/**
 * Validate subagent output against schema.
 * @param {any} output - Raw output from subagent
 * @param {object} schema - Schema definition
 * @returns {{valid: boolean, errors: string[], sanitized: object}}
 */
function validateOutput(output, schema = DEFAULT_OUTPUT_SCHEMA) {
  const errors = [];
  const sanitized = {};

  if (!isPlainObject(output)) {
    return {
      valid: false,
      errors: ["Subagent output must be a plain object"],
      sanitized: { ok: false, error: "Invalid output format" },
    };
  }

  // Validate each field in schema
  for (const [fieldName, fieldDef] of Object.entries(schema)) {
    const fieldErrors = validateField(output[fieldName], fieldDef, fieldName);
    errors.push(...fieldErrors);

    // Copy valid fields to sanitized output
    if (fieldErrors.length === 0 && output[fieldName] !== undefined) {
      let value = output[fieldName];

      // Truncate strings that exceed maxLength
      if (fieldDef.type === "string" && typeof value === "string" && fieldDef.maxLength) {
        value = value.slice(0, fieldDef.maxLength);
      }

      sanitized[fieldName] = value;
    }
  }

  // Copy unknown fields with warning (allow extensibility but flag it)
  const knownFields = new Set(Object.keys(schema));
  for (const key of Object.keys(output)) {
    if (!knownFields.has(key)) {
      // Allow but don't include potentially dangerous fields
      if (key.startsWith("_") || key === "constructor" || key === "__proto__") {
        errors.push(`Suspicious field rejected: ${key}`);
        continue;
      }
      sanitized[key] = output[key];
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Quarantine wrapper for subagent output.
 * Validates and sanitizes output before passing to parent agent.
 */
function quarantineOutput(output, schema, subagentType) {
  const result = validateOutput(output, schema);

  if (!result.valid) {
    console.warn(
      `[SubagentRegistry] Quarantine warnings for ${subagentType}:`,
      result.errors
    );
  }

  // Always return sanitized output, even with warnings
  return {
    ...result.sanitized,
    _quarantine: {
      valid: result.valid,
      warnings: result.errors,
      subagentType,
      timestamp: Date.now(),
    },
  };
}

export class SubagentRegistry {
  constructor() {
    /** @type {Map<string, {factory: Function, description: string, schema?: object}>} */
    this._subagents = new Map();
    this._quarantineEnabled = true;
  }

  /**
   * Enable/disable output quarantine (for testing)
   */
  setQuarantineEnabled(enabled) {
    this._quarantineEnabled = Boolean(enabled);
  }

  /**
   * 注册子代理类型
   * @param {string} type - 子代理类型 (如 "Explore", "Coder")
   * @param {Function} factory - 创建 AgentInstance 的工厂函数
   * @param {string} [description] - 子代理用途描述
   * @param {object} [schema] - 输出 schema（可选，默认使用 DEFAULT_OUTPUT_SCHEMA）
   */
  register(type, factory, description = "", schema = null) {
    const normalizedType = type.toLowerCase();

    // Wrap factory to add quarantine on output
    const wrappedFactory = async (...args) => {
      const instance = await factory(...args);

      if (!instance || typeof instance.run !== "function") {
        return instance;
      }

      // Wrap run method to quarantine output
      const originalRun = instance.run.bind(instance);
      const outputSchema = schema || DEFAULT_OUTPUT_SCHEMA;
      const quarantineEnabled = this._quarantineEnabled;

      instance.run = async (...runArgs) => {
        const rawOutput = await originalRun(...runArgs);

        if (!quarantineEnabled) {
          return rawOutput;
        }

        return quarantineOutput(rawOutput, outputSchema, normalizedType);
      };

      return instance;
    };

    this._subagents.set(normalizedType, {
      factory: wrappedFactory,
      description,
      schema: schema || DEFAULT_OUTPUT_SCHEMA,
    });
  }

  /**
   * 获取子代理工厂函数
   * @param {string} type
   * @returns {Function|null}
   */
  getFactory(type) {
    const entry = this._subagents.get(type.toLowerCase());
    return entry ? entry.factory : null;
  }

  /**
   * 获取所有可用的子代理类型及描述
   * @returns {Array<{type: string, description: string}>}
   */
  getAvailableTypes() {
    return Array.from(this._subagents.entries()).map(([type, entry]) => ({
      type,
      description: entry.description,
    }));
  }

  /**
   * 生成子代理目录 Prompt
   * @returns {string}
   */
  getSubagentCatalogPrompt() {
    if (this._subagents.size === 0) return "";

    const lines = ["## 可用子代理 (Subagents)", "当需要处理复杂、多步或需要独立上下文的任务时，使用 Task 工具启动这些专用的子代理："];
    for (const [type, entry] of this._subagents) {
      const displayType = type.toLowerCase();
      lines.push(`- **${displayType}**: ${entry.description}`);
    }
    return lines.join("\n");
  }
}

export { validateOutput, quarantineOutput, DEFAULT_OUTPUT_SCHEMA };
export const globalSubagentRegistry = new SubagentRegistry();
export default SubagentRegistry;
