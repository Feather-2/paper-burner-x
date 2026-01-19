/**
 * Schema Validator - Pre-execution JSON Schema 验证
 *
 * 在 Tool 调用前验证参数，减少无效 API 往返。
 * 支持简化参数描述和完整 JSON Schema 两种格式。
 */

import { createSafeRegex } from "../../shared/index.js";

/**
 * 验证参数是否符合 schema
 * @param {Object} args - 待验证参数
 * @param {Object} schema - JSON Schema 或简化参数定义
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateArgs(args, schema) {
  if (!schema || typeof schema !== "object") {
    return { valid: true, errors: [] };
  }

  const errors = [];
  const normalizedSchema = normalizeSchema(schema);

  // 检查必需字段
  if (normalizedSchema.required) {
    for (const field of normalizedSchema.required) {
      if (args[field] === undefined || args[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // 检查类型
  if (normalizedSchema.properties) {
    for (const [key, prop] of Object.entries(normalizedSchema.properties)) {
      const value = args[key];
      if (value === undefined) continue;

      const typeError = validateType(value, prop, key);
      if (typeError) errors.push(typeError);

      // 枚举检查
      if (prop.enum && !prop.enum.includes(value)) {
        errors.push(`${key}: must be one of [${prop.enum.join(", ")}]`);
      }

      // 范围检查
      if (prop.minimum !== undefined && value < prop.minimum) {
        errors.push(`${key}: must be >= ${prop.minimum}`);
      }
      if (prop.maximum !== undefined && value > prop.maximum) {
        errors.push(`${key}: must be <= ${prop.maximum}`);
      }

      // 字符串长度
      if (prop.minLength !== undefined && typeof value === "string" && value.length < prop.minLength) {
        errors.push(`${key}: length must be >= ${prop.minLength}`);
      }
      if (prop.maxLength !== undefined && typeof value === "string" && value.length > prop.maxLength) {
        errors.push(`${key}: length must be <= ${prop.maxLength}`);
      }

      // 数组长度
      if (prop.minItems !== undefined && Array.isArray(value) && value.length < prop.minItems) {
        errors.push(`${key}: must have >= ${prop.minItems} items`);
      }
      if (prop.maxItems !== undefined && Array.isArray(value) && value.length > prop.maxItems) {
        errors.push(`${key}: must have <= ${prop.maxItems} items`);
      }

      // Pattern 检查
      if (prop.pattern && typeof value === "string") {
        try {
          const regex = createSafeRegex(prop.pattern, "u");
          if (!regex.test(value)) {
            errors.push(`${key}: does not match pattern ${prop.pattern}`);
          }
        } catch (err) {
          errors.push(`${key}: invalid pattern ${prop.pattern} (${err?.message || String(err)})`);
        }
      }
    }
  }

  // 检查额外字段 (additionalProperties: false)
  if (normalizedSchema.additionalProperties === false && normalizedSchema.properties) {
    const allowed = new Set(Object.keys(normalizedSchema.properties));
    for (const key of Object.keys(args)) {
      if (!allowed.has(key)) {
        errors.push(`Unknown field: ${key}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 验证单个值的类型
 */
function validateType(value, prop, key) {
  const expectedType = prop.type;
  if (!expectedType) return null;

  const actualType = getJsonType(value);

  // 支持多类型 (type: ["string", "null"])
  const types = Array.isArray(expectedType) ? expectedType : [expectedType];

  if (!types.includes(actualType)) {
    // 特殊处理: integer 可以接受整数 number
    if (types.includes("integer") && actualType === "number" && Number.isInteger(value)) {
      return null;
    }
    return `${key}: expected ${types.join("|")}, got ${actualType}`;
  }

  return null;
}

/**
 * 获取 JSON Schema 类型
 */
function getJsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * 将简化参数定义转换为 JSON Schema
 *
 * 简化格式: { fieldName: "描述" } 或 { fieldName: { type, description, required } }
 *
 * @param {Object} schema - 简化参数定义或已规范化的 JSON Schema
 * @returns {{ type: string, properties?: Object, required?: string[] }} 规范化的 JSON Schema 对象
 */
export function normalizeSchema(schema) {
  // 已经是 JSON Schema 格式
  if (schema.type === "object" || schema.properties) {
    return schema;
  }

  // 简化格式转换
  const properties = {};
  const required = [];

  for (const [key, value] of Object.entries(schema)) {
    if (typeof value === "string") {
      // 简单描述: "文档 ID（必需）"
      const isRequired = value.includes("必需") || value.includes("required");
      properties[key] = {
        type: inferType(key, value),
        description: value,
      };
      if (isRequired) required.push(key);
    } else if (typeof value === "object") {
      // 完整定义
      properties[key] = value;
      if (value.required) required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * 从字段名和描述推断类型
 */
function inferType(key, description) {
  const desc = description.toLowerCase();
  const keyLower = key.toLowerCase();

  if (desc.includes("数组") || desc.includes("array") || desc.includes("列表") || keyLower.endsWith("s") || keyLower.endsWith("ids")) {
    return "array";
  }
  if (desc.includes("数字") || desc.includes("number") || desc.includes("位置") || desc.includes("行号") || desc.includes("长度")) {
    return "number";
  }
  if (desc.includes("布尔") || desc.includes("boolean") || desc.includes("true") || desc.includes("false") || keyLower.startsWith("is") || keyLower.startsWith("has")) {
    return "boolean";
  }
  if (desc.includes("对象") || desc.includes("object")) {
    return "object";
  }
  return "string";
}

/**
 * 创建验证 hook (用于 ToolExecutor)
 *
 * @param {Object} [options] - 配置选项
 * @param {boolean} [options.strict=false] - 严格模式：验证失败时直接跳过执行并返回错误
 * @param {(details: { tool: string, params: Object, errors: string[] }) => void} [options.onError] - 验证失败回调
 * @returns {(hookContext: { tool: string, params: Object, context: Object }) => Promise<{ params?: Object, skip?: boolean, value?: Object }>} 验证 hook 函数
 */
export function createValidationHook(options = {}) {
  const { strict = false, onError } = options;

  return async ({ tool, params, context }) => {
    const toolDef = context?.toolDefinition || context?.tools?.[tool];
    const schema = toolDef?.parameters || toolDef?.definition?.parameters;

    if (!schema) return { params };

    const { valid, errors } = validateArgs(params, schema);

    if (!valid) {
      if (onError) {
        onError({ tool, params, errors });
      }

      if (strict) {
        return {
          skip: true,
          value: {
            success: false,
            error: `Validation failed: ${errors.join("; ")}`,
            validationErrors: errors,
          },
        };
      }
    }

    return { params };
  };
}

export default { validateArgs, normalizeSchema, createValidationHook };
