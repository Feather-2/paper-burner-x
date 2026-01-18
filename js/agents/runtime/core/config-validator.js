/**
 * Config Validator - 配置校验
 *
 * 特性：
 * - JSON Schema 风格的校验
 * - 类型检查
 * - 默认值填充
 * - 自定义校验规则
 */

import { createLogger } from "../../shared/utils/logger.js";
import { createSafeRegex } from "../../shared/utils/safe-regex.js";

const logger = createLogger("runtime/core/config-validator");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SchemaField
 * @property {'string'|'number'|'boolean'|'array'|'object'|'function'|'any'} type
 * @property {boolean} [required=false]
 * @property {any} [default]
 * @property {function} [validate] - Custom validator (value) => true | string
 * @property {SchemaField} [items] - For arrays
 * @property {Object<string, SchemaField>} [properties] - For objects
 * @property {number} [min] - For numbers
 * @property {number} [max] - For numbers
 * @property {number} [minLength] - For strings/arrays
 * @property {number} [maxLength] - For strings/arrays
 * @property {string} [pattern] - Regex pattern for strings
 * @property {any[]} [enum] - Allowed values
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} path
 * @property {string} message
 * @property {any} [value]
 */

// ─────────────────────────────────────────────────────────────────────────────
// Type Checkers
// ─────────────────────────────────────────────────────────────────────────────

function getType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isValidType(value, expectedType) {
  if (expectedType === "any") return true;
  const actualType = getType(value);
  return actualType === expectedType;
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfigValidator
// ─────────────────────────────────────────────────────────────────────────────

export class ConfigValidator {
  /**
   * @param {Object<string, SchemaField>} schema
   * @param {object} [options]
   * @param {boolean} [options.strict=false] - Reject unknown fields
   * @param {boolean} [options.coerce=false] - Try to coerce types
   */
  constructor(schema, { strict = false, coerce = false } = {}) {
    this._schema = schema;
    this._strict = strict;
    this._coerce = coerce;
  }

  /**
   * Validate and fill defaults
   * @param {object} config
   * @returns {{ valid: boolean, errors: ValidationError[], config: object }}
   */
  validate(config) {
    const errors = [];
    const result = this._validateObject(config, this._schema, "", errors);

    return {
      valid: errors.length === 0,
      errors,
      config: result,
    };
  }

  /**
   * Validate object against schema
   * @private
   */
  _validateObject(obj, schema, path, errors) {
    if (obj === null || obj === undefined) {
      obj = {};
    }

    if (typeof obj !== "object" || Array.isArray(obj)) {
      errors.push({ path: path || "root", message: "Expected object", value: obj });
      return {};
    }

    const result = {};

    // Check schema fields
    for (const [key, fieldSchema] of Object.entries(schema)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const value = obj[key];

      if (value === undefined) {
        if (fieldSchema.required) {
          errors.push({ path: fieldPath, message: "Required field missing" });
        } else if (fieldSchema.default !== undefined) {
          result[key] = typeof fieldSchema.default === "function"
            ? fieldSchema.default()
            : (typeof globalThis.structuredClone === "function"
                ? globalThis.structuredClone(fieldSchema.default)
                : JSON.parse(JSON.stringify(fieldSchema.default)));
        }
        continue;
      }

      result[key] = this._validateField(value, fieldSchema, fieldPath, errors);
    }

    // Check for unknown fields in strict mode
    if (this._strict) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema)) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: "Unknown field",
            value: obj[key],
          });
        }
      }
    } else {
      // Copy unknown fields
      for (const key of Object.keys(obj)) {
        if (!(key in schema) && !(key in result)) {
          result[key] = obj[key];
        }
      }
    }

    return result;
  }

  /**
   * Validate single field
   * @private
   */
  _validateField(value, schema, path, errors) {
    // Type check
    if (schema.type && !isValidType(value, schema.type)) {
      if (this._coerce) {
        const coerced = this._coerceType(value, schema.type);
        if (coerced !== undefined) {
          value = coerced;
        } else {
          errors.push({
            path,
            message: `Expected ${schema.type}, got ${getType(value)}`,
            value,
          });
          return value;
        }
      } else {
        errors.push({
          path,
          message: `Expected ${schema.type}, got ${getType(value)}`,
          value,
        });
        return value;
      }
    }

    // Enum check
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({
        path,
        message: `Value must be one of: ${schema.enum.join(", ")}`,
        value,
      });
      return value;
    }

    // Number constraints
    if (schema.type === "number") {
      if (schema.min !== undefined && value < schema.min) {
        errors.push({ path, message: `Value must be >= ${schema.min}`, value });
      }
      if (schema.max !== undefined && value > schema.max) {
        errors.push({ path, message: `Value must be <= ${schema.max}`, value });
      }
    }

    // String constraints
    if (schema.type === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push({ path, message: `Length must be >= ${schema.minLength}`, value });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push({ path, message: `Length must be <= ${schema.maxLength}`, value });
      }
      if (schema.pattern) {
        try {
          const regex = createSafeRegex(schema.pattern, "u");
          if (!regex.test(value)) {
            errors.push({ path, message: `Value must match pattern: ${schema.pattern}`, value });
          }
        } catch (err) {
          errors.push({ path, message: `Invalid pattern: ${schema.pattern} (${err?.message || String(err)})`, value });
        }
      }
    }

    // Array constraints and items
    if (schema.type === "array" && Array.isArray(value)) {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push({ path, message: `Array length must be >= ${schema.minLength}`, value });
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push({ path, message: `Array length must be <= ${schema.maxLength}`, value });
      }
      if (schema.items) {
        return value.map((item, i) =>
          this._validateField(item, schema.items, `${path}[${i}]`, errors)
        );
      }
    }

    // Object properties
    if (schema.type === "object" && schema.properties) {
      return this._validateObject(value, schema.properties, path, errors);
    }

    // Custom validator
    if (schema.validate) {
      const result = schema.validate(value);
      if (result !== true) {
        errors.push({ path, message: result || "Custom validation failed", value });
      }
    }

    return value;
  }

  /**
   * Try to coerce value to expected type
   * @private
   */
  _coerceType(value, type) {
    switch (type) {
      case "string":
        return String(value);
      case "number": {
        const n = Number(value);
        return Number.isNaN(n) ? undefined : n;
      }
      case "boolean":
        return Boolean(value);
      case "array":
        return Array.isArray(value) ? value : undefined;
      default:
        return undefined;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Common Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const CommonSchemas = {
  positiveNumber: { type: "number", min: 0 },
  positiveInt: {
    type: "number",
    min: 1,
    validate: (v) => (Number.isInteger(v) ? true : "Must be an integer"),
  },
  nonNegativeInt: {
    type: "number",
    min: 0,
    validate: (v) => (Number.isInteger(v) ? true : "Must be an integer"),
  },
  ratio: { type: "number", min: 0, max: 1 },
  nonEmptyString: { type: "string", minLength: 1 },
  url: {
    type: "string",
    pattern: "^https?://",
    validate: (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return "Invalid URL";
      }
    },
  },
  email: {
    type: "string",
    pattern: "^[^@]+@[^@]+\\.[^@]+$",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate config against schema
 * @param {object} config
 * @param {Object<string, SchemaField>} schema
 * @param {object} [options]
 * @returns {{ valid: boolean, errors: ValidationError[], config: object }}
 */
export function validateConfig(config, schema, options) {
  const validator = new ConfigValidator(schema, options);
  return validator.validate(config);
}

export default ConfigValidator;
