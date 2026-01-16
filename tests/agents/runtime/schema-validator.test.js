/**
 * Schema Validator 单元测试
 *
 * 覆盖:
 * - validateArgs: 类型检查、required、enum、范围、长度、pattern、additionalProperties
 * - normalizeSchema: JSON Schema 透传、简化格式转换、类型推断
 * - createValidationHook: strict 模式、onError 回调、context 路径
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  validateArgs,
  normalizeSchema,
  createValidationHook,
} from "../../../js/agents/runtime/tools/schema-validator.js";

describe("schema-validator", () => {
  describe("validateArgs", () => {
    describe("basic validation", () => {
      it("should pass with valid args", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name"],
        };

        const { valid, errors } = validateArgs({ name: "test", age: 25 }, schema);
        expect(valid).toBe(true);
        expect(errors.length).toBe(0);
      });

      it("should pass with empty args when no required fields", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
          },
        };

        const { valid, errors } = validateArgs({}, schema);
        expect(valid).toBe(true);
        expect(errors.length).toBe(0);
      });

      it("should skip undefined values in type checking", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
        };

        const { valid, errors } = validateArgs({ name: "test" }, schema);
        expect(valid).toBe(true);
        expect(errors.length).toBe(0);
      });
    });

    describe("null/undefined schema handling", () => {
      it("should handle null schema gracefully", () => {
        const { valid, errors } = validateArgs({ any: "value" }, null);
        expect(valid).toBe(true);
        expect(errors.length).toBe(0);
      });

      it("should handle undefined schema gracefully", () => {
        const { valid, errors } = validateArgs({ any: "value" }, undefined);
        expect(valid).toBe(true);
        expect(errors.length).toBe(0);
      });

      it("should handle non-object schema gracefully", () => {
        const { valid: v1 } = validateArgs({}, "string");
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({}, 123);
        expect(v2).toBe(true);

        const { valid: v3 } = validateArgs({}, true);
        expect(v3).toBe(true);
      });
    });

    describe("required fields", () => {
      it("should fail on missing required field", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        };

        const { valid, errors } = validateArgs({}, schema);
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes("Missing required field: name")).toBeTruthy());
      });

      it("should fail when required field is null", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        };

        const { valid, errors } = validateArgs({ name: null }, schema);
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes("Missing required field: name")).toBeTruthy());
      });

      it("should fail when required field is undefined", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        };

        const { valid, errors } = validateArgs({ name: undefined }, schema);
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes("Missing required field: name")).toBeTruthy());
      });

      it("should pass when required field has falsy but valid value", () => {
        const schema = {
          type: "object",
          properties: {
            count: { type: "number" },
            flag: { type: "boolean" },
            text: { type: "string" },
          },
          required: ["count", "flag", "text"],
        };

        const { valid, errors } = validateArgs({ count: 0, flag: false, text: "" }, schema);
        expect(valid).toBe(true);
        expect(errors.length).toBe(0);
      });

      it("should check multiple required fields", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name", "age"],
        };

        const { valid, errors } = validateArgs({}, schema);
        expect(valid).toBe(false);
        expect(errors.length).toBe(2);
        expect(errors.some(e => e.includes("name")).toBeTruthy());
        expect(errors.some(e => e.includes("age")).toBeTruthy());
      });
    });

    describe("type validation", () => {
      it("should fail on type mismatch", () => {
        const schema = {
          type: "object",
          properties: {
            age: { type: "number" },
          },
        };

        const { valid, errors } = validateArgs({ age: "not a number" }, schema);
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes("expected number")).toBeTruthy());
      });

      it("should accept integer as number type when integer is expected", () => {
        const schema = {
          type: "object",
          properties: {
            count: { type: "integer" },
          },
        };

        const { valid: valid1, errors: e1 } = validateArgs({ count: 5 }, schema);
        expect(valid1).toBe(true);
        expect(e1.length).toBe(0);

        const { valid: valid2 } = validateArgs({ count: 5.5 }, schema);
        expect(valid2).toBe(false);
      });

      it("should support multi-type fields", () => {
        const schema = {
          type: "object",
          properties: {
            value: { type: ["string", "null"] },
          },
        };

        const { valid: valid1 } = validateArgs({ value: "test" }, schema);
        expect(valid1).toBe(true);

        const { valid: valid2 } = validateArgs({ value: null }, schema);
        expect(valid2).toBe(true);

        const { valid: valid3 } = validateArgs({ value: 123 }, schema);
        expect(valid3).toBe(false);
      });

      it("should validate null type correctly", () => {
        const schema = {
          type: "object",
          properties: {
            nullable: { type: "null" },
          },
        };

        const { valid: v1 } = validateArgs({ nullable: null }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ nullable: "not null" }, schema);
        expect(v2).toBe(false);
      });

      it("should validate array type correctly", () => {
        const schema = {
          type: "object",
          properties: {
            items: { type: "array" },
          },
        };

        const { valid: v1 } = validateArgs({ items: [1, 2, 3] }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ items: "not an array" }, schema);
        expect(v2).toBe(false);
      });

      it("should validate object type correctly", () => {
        const schema = {
          type: "object",
          properties: {
            config: { type: "object" },
          },
        };

        const { valid: v1 } = validateArgs({ config: { key: "value" } }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ config: "not an object" }, schema);
        expect(v2).toBe(false);
      });

      it("should validate boolean type correctly", () => {
        const schema = {
          type: "object",
          properties: {
            flag: { type: "boolean" },
          },
        };

        const { valid: v1 } = validateArgs({ flag: true }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ flag: false }, schema);
        expect(v2).toBe(true);

        const { valid: v3 } = validateArgs({ flag: "true" }, schema);
        expect(v3).toBe(false);
      });

      it("should skip type validation when type is not defined", () => {
        const schema = {
          type: "object",
          properties: {
            anything: { description: "can be anything" },
          },
        };

        const { valid: v1 } = validateArgs({ anything: "string" }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ anything: 123 }, schema);
        expect(v2).toBe(true);

        const { valid: v3 } = validateArgs({ anything: null }, schema);
        expect(v3).toBe(true);
      });

      it("should handle integer type with multi-type array", () => {
        const schema = {
          type: "object",
          properties: {
            value: { type: ["integer", "null"] },
          },
        };

        const { valid: v1 } = validateArgs({ value: 5 }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ value: null }, schema);
        expect(v2).toBe(true);

        const { valid: v3 } = validateArgs({ value: 5.5 }, schema);
        expect(v3).toBe(false);
      });
    });

    describe("enum validation", () => {
      it("should validate enum values", () => {
        const schema = {
          type: "object",
          properties: {
            status: { type: "string", enum: ["active", "inactive"] },
          },
        };

        const { valid: valid1 } = validateArgs({ status: "active" }, schema);
        expect(valid1).toBe(true);

        const { valid: valid2, errors } = validateArgs({ status: "unknown" }, schema);
        expect(valid2).toBe(false);
        expect(errors.some(e => e.includes("must be one of")).toBeTruthy());
      });

      it("should validate enum with different types", () => {
        const schema = {
          type: "object",
          properties: {
            level: { type: "number", enum: [1, 2, 3] },
          },
        };

        const { valid: v1 } = validateArgs({ level: 2 }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ level: 4 }, schema);
        expect(v2).toBe(false);
      });

      it("should include enum values in error message", () => {
        const schema = {
          type: "object",
          properties: {
            color: { enum: ["red", "green", "blue"] },
          },
        };

        const { errors } = validateArgs({ color: "yellow" }, schema);
        expect(errors[0].includes("red")).toBeTruthy();
        expect(errors[0].includes("green")).toBeTruthy();
        expect(errors[0].includes("blue")).toBeTruthy();
      });
    });

    describe("number range validation", () => {
      it("should validate number ranges", () => {
        const schema = {
          type: "object",
          properties: {
            count: { type: "number", minimum: 0, maximum: 100 },
          },
        };

        const { valid: valid1 } = validateArgs({ count: 50 }, schema);
        expect(valid1).toBe(true);

        const { valid: valid2, errors: e2 } = validateArgs({ count: -1 }, schema);
        expect(valid2).toBe(false);
        expect(e2.some(e => e.includes(">= 0")).toBeTruthy());

        const { valid: valid3, errors: e3 } = validateArgs({ count: 101 }, schema);
        expect(valid3).toBe(false);
        expect(e3.some(e => e.includes("<= 100")).toBeTruthy());
      });

      it("should allow boundary values", () => {
        const schema = {
          type: "object",
          properties: {
            count: { type: "number", minimum: 0, maximum: 100 },
          },
        };

        const { valid: v1 } = validateArgs({ count: 0 }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ count: 100 }, schema);
        expect(v2).toBe(true);
      });

      it("should validate only minimum", () => {
        const schema = {
          type: "object",
          properties: {
            count: { type: "number", minimum: 0 },
          },
        };

        const { valid: v1 } = validateArgs({ count: 1000 }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ count: -1 }, schema);
        expect(v2).toBe(false);
      });

      it("should validate only maximum", () => {
        const schema = {
          type: "object",
          properties: {
            count: { type: "number", maximum: 100 },
          },
        };

        const { valid: v1 } = validateArgs({ count: -1000 }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ count: 101 }, schema);
        expect(v2).toBe(false);
      });
    });

    describe("string length validation", () => {
      it("should validate string length", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string", minLength: 2, maxLength: 10 },
          },
        };

        const { valid: valid1 } = validateArgs({ name: "test" }, schema);
        expect(valid1).toBe(true);

        const { valid: valid2, errors: e2 } = validateArgs({ name: "a" }, schema);
        expect(valid2).toBe(false);
        expect(e2.some(e => e.includes(">= 2")).toBeTruthy());

        const { valid: valid3, errors: e3 } = validateArgs({ name: "verylongname" }, schema);
        expect(valid3).toBe(false);
        expect(e3.some(e => e.includes("<= 10")).toBeTruthy());
      });

      it("should allow boundary lengths", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string", minLength: 2, maxLength: 5 },
          },
        };

        const { valid: v1 } = validateArgs({ name: "ab" }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ name: "abcde" }, schema);
        expect(v2).toBe(true);
      });

      it("should skip length check for non-string values", () => {
        const schema = {
          type: "object",
          properties: {
            value: { minLength: 2, maxLength: 10 },
          },
        };

        const { valid: v1 } = validateArgs({ value: 12345 }, schema);
        expect(v1).toBe(true);
      });
    });

    describe("array items validation", () => {
      it("should validate array items count", () => {
        const schema = {
          type: "object",
          properties: {
            items: { type: "array", minItems: 1, maxItems: 3 },
          },
        };

        const { valid: valid1 } = validateArgs({ items: [1, 2] }, schema);
        expect(valid1).toBe(true);

        const { valid: valid2, errors: e2 } = validateArgs({ items: [] }, schema);
        expect(valid2).toBe(false);
        expect(e2.some(e => e.includes(">= 1")).toBeTruthy());

        const { valid: valid3, errors: e3 } = validateArgs({ items: [1, 2, 3, 4] }, schema);
        expect(valid3).toBe(false);
        expect(e3.some(e => e.includes("<= 3")).toBeTruthy());
      });

      it("should allow boundary items count", () => {
        const schema = {
          type: "object",
          properties: {
            items: { type: "array", minItems: 1, maxItems: 3 },
          },
        };

        const { valid: v1 } = validateArgs({ items: [1] }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ items: [1, 2, 3] }, schema);
        expect(v2).toBe(true);
      });

      it("should skip items check for non-array values", () => {
        const schema = {
          type: "object",
          properties: {
            value: { minItems: 1, maxItems: 3 },
          },
        };

        const { valid } = validateArgs({ value: "not an array" }, schema);
        expect(valid).toBe(true);
      });
    });

    describe("pattern validation", () => {
      it("should validate pattern", () => {
        const schema = {
          type: "object",
          properties: {
            email: { type: "string", pattern: "^[^@]+@[^@]+$" },
          },
        };

        const { valid: valid1 } = validateArgs({ email: "test@example.com" }, schema);
        expect(valid1).toBe(true);

        const { valid: valid2, errors } = validateArgs({ email: "invalid" }, schema);
        expect(valid2).toBe(false);
        expect(errors.some(e => e.includes("does not match pattern")).toBeTruthy());
      });

      it("should handle invalid pattern gracefully", () => {
        const schema = {
          type: "object",
          properties: {
            value: { type: "string", pattern: "[invalid" },
          },
        };

        const { valid, errors } = validateArgs({ value: "test" }, schema);
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes("invalid pattern")).toBeTruthy());
      });

      it("should skip pattern check for non-string values", () => {
        const schema = {
          type: "object",
          properties: {
            value: { pattern: "^\\d+$" },
          },
        };

        const { valid } = validateArgs({ value: 12345 }, schema);
        expect(valid).toBe(true);
      });

      it("should handle complex patterns", () => {
        const schema = {
          type: "object",
          properties: {
            uuid: { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" },
          },
        };

        const { valid: v1 } = validateArgs({ uuid: "550e8400-e29b-41d4-a716-446655440000" }, schema);
        expect(v1).toBe(true);

        const { valid: v2 } = validateArgs({ uuid: "not-a-uuid" }, schema);
        expect(v2).toBe(false);
      });
    });

    describe("additionalProperties validation", () => {
      it("should reject unknown fields when additionalProperties is false", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          additionalProperties: false,
        };

        const { valid, errors } = validateArgs({ name: "test", extra: "field" }, schema);
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes("Unknown field: extra")).toBeTruthy());
      });

      it("should allow additional properties by default", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
          },
        };

        const { valid, errors } = validateArgs({ name: "test", extra: "field" }, schema);
        expect(valid).toBe(true);
        expect(errors.length).toBe(0);
      });

      it("should allow additional properties when additionalProperties is true", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          additionalProperties: true,
        };

        const { valid, errors } = validateArgs({ name: "test", extra: "field" }, schema);
        expect(valid).toBe(true);
        expect(errors.length).toBe(0);
      });

      it("should detect multiple unknown fields", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          additionalProperties: false,
        };

        const { valid, errors } = validateArgs({ name: "test", extra1: "a", extra2: "b" }, schema);
        expect(valid).toBe(false);
        expect(errors.length).toBe(2);
      });
    });

    describe("combined validations", () => {
      it("should report multiple errors", () => {
        const schema = {
          type: "object",
          properties: {
            name: { type: "string", minLength: 2 },
            age: { type: "number", minimum: 0 },
          },
          required: ["name", "age"],
        };

        const { valid, errors } = validateArgs({ name: "a", age: -1 }, schema);
        expect(valid).toBe(false);
        expect(errors.length).toBe(2);
      });

      it("should validate complex schema", () => {
        const schema = {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^[A-Z]{2}\\d{4}$" },
            status: { type: "string", enum: ["active", "inactive", "pending"] },
            priority: { type: "integer", minimum: 1, maximum: 5 },
            tags: { type: "array", minItems: 1, maxItems: 10 },
          },
          required: ["id", "status"],
          additionalProperties: false,
        };

        const { valid: v1, errors: e1 } = validateArgs(
          { id: "AB1234", status: "active", priority: 3, tags: ["test"] },
          schema
        );
        expect(v1).toBe(true);
        expect(e1.length).toBe(0);

        const { valid: v2, errors: e2 } = validateArgs(
          { id: "invalid", status: "unknown", priority: 10, tags: [], extra: "field" },
          schema
        );
        expect(v2).toBe(false);
        expect(e2.length >= 5).toBeTruthy();
      });
    });
  });

  describe("normalizeSchema", () => {
    describe("JSON Schema passthrough", () => {
      it("should pass through JSON Schema format with type: object", () => {
        const schema = {
          type: "object",
          properties: { name: { type: "string" } },
        };

        const normalized = normalizeSchema(schema);
        expect(normalized).toEqual(schema);
      });

      it("should pass through JSON Schema format with properties", () => {
        const schema = {
          properties: { name: { type: "string" } },
          required: ["name"],
        };

        const normalized = normalizeSchema(schema);
        expect(normalized).toEqual(schema);
      });
    });

    describe("simplified format conversion", () => {
      it("should convert simple description format", () => {
        const schema = {
          sourceId: "文档 ID（必需）",
          maxLength: "最大返回长度（默认 5000）",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.type).toBe("object");
        expect(normalized.properties.sourceId).toBeTruthy();
        expect(normalized.required.includes("sourceId")).toBeTruthy();
        expect(!normalized.required.includes("maxLength")).toBeTruthy();
      });

      it("should detect required from English keyword", () => {
        const schema = {
          docId: "Document ID (required)",
          optional: "Optional field",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.required.includes("docId")).toBeTruthy();
        expect(!normalized.required.includes("optional")).toBeTruthy();
      });

      it("should convert object format with required property", () => {
        const schema = {
          name: { type: "string", description: "User name", required: true },
          age: { type: "number", description: "User age" },
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.required.includes("name")).toBeTruthy();
        expect(!normalized.required.includes("age")).toBeTruthy();
      });

      it("should preserve property definitions in object format", () => {
        const schema = {
          count: { type: "integer", minimum: 0, maximum: 100 },
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.count.type).toBe("integer");
        expect(normalized.properties.count.minimum).toBe(0);
        expect(normalized.properties.count.maximum).toBe(100);
      });

      it("should not add required array when no required fields", () => {
        const schema = {
          optional1: "Optional field 1",
          optional2: "Optional field 2",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.required).toBe(undefined);
      });
    });

    describe("type inference", () => {
      it("should infer types from descriptions", () => {
        const schema = {
          count: "数字类型",
          items: "数组列表",
          isActive: "布尔值",
          config: "配置对象",
          name: "名称",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.count.type).toBe("number");
        expect(normalized.properties.items.type).toBe("array");
        expect(normalized.properties.isActive.type).toBe("boolean");
        expect(normalized.properties.config.type).toBe("object");
        expect(normalized.properties.name.type).toBe("string");
      });

      it("should infer array type from English description", () => {
        const schema = {
          tags: "Array of tags",
          items: "Item list",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.tags.type).toBe("array");
        expect(normalized.properties.items.type).toBe("array");
      });

      it("should infer number type from English description", () => {
        const schema = {
          count: "Number of items",
          position: "位置索引",
          lineNo: "行号",
          length: "字符串长度",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.count.type).toBe("number");
        expect(normalized.properties.position.type).toBe("number");
        expect(normalized.properties.lineNo.type).toBe("number");
        expect(normalized.properties.length.type).toBe("number");
      });

      it("should infer boolean type from English description", () => {
        const schema = {
          enabled: "Boolean flag",
          active: "Set to true to enable",
          disabled: "Set to false to disable",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.enabled.type).toBe("boolean");
        expect(normalized.properties.active.type).toBe("boolean");
        expect(normalized.properties.disabled.type).toBe("boolean");
      });

      it("should infer object type from English description", () => {
        const schema = {
          config: "Configuration object",
          setting: "对象类型",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.config.type).toBe("object");
        expect(normalized.properties.setting.type).toBe("object");
      });

      it("should infer array type from key name ending with 's'", () => {
        const schema = {
          users: "User collection",
          documents: "Document list",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.users.type).toBe("array");
        expect(normalized.properties.documents.type).toBe("array");
      });

      it("should infer array type from key name ending with 'ids'", () => {
        const schema = {
          userIds: "User identifiers",
          documentIds: "Document identifiers",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.userIds.type).toBe("array");
        expect(normalized.properties.documentIds.type).toBe("array");
      });

      it("should infer boolean type from key name starting with 'is'", () => {
        const schema = {
          isEnabled: "Whether enabled",
          isActive: "Whether active",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.isEnabled.type).toBe("boolean");
        expect(normalized.properties.isActive.type).toBe("boolean");
      });

      it("should infer boolean type from key name starting with 'has'", () => {
        const schema = {
          hasPermission: "Whether permission granted",
          hasToken: "Whether token available",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.hasPermission.type).toBe("boolean");
        expect(normalized.properties.hasToken.type).toBe("boolean");
      });

      it("should default to string type when no hints", () => {
        const schema = {
          title: "The title",
          description: "The description",
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.title.type).toBe("string");
        expect(normalized.properties.description.type).toBe("string");
      });
    });

    describe("edge cases", () => {
      it("should handle empty schema", () => {
        const schema = {};
        const normalized = normalizeSchema(schema);
        expect(normalized.type).toBe("object");
        expect(normalized.properties).toEqual({});
      });

      it("should handle mixed format", () => {
        const schema = {
          name: "名称（必需）",
          count: { type: "number", minimum: 0 },
        };

        const normalized = normalizeSchema(schema);
        expect(normalized.properties.name.type).toBe("string");
        expect(normalized.properties.count.type).toBe("number");
        expect(normalized.required.includes("name")).toBeTruthy();
      });
    });
  });

  describe("createValidationHook", () => {
    describe("basic functionality", () => {
      it("should create a before hook that returns params", async () => {
        const hook = createValidationHook();
        const result = await hook({
          tool: "test",
          params: { name: "test" },
          context: {},
        });

        expect(result.params).toBeTruthy();
        expect(result.params).toEqual({ name: "test" });
      });

      it("should pass through when no schema is available", async () => {
        const hook = createValidationHook();
        const result = await hook({
          tool: "test",
          params: { any: "value" },
          context: {},
        });

        expect(result.params).toBeTruthy();
        expect(result.skip).toBe(undefined);
      });
    });

    describe("schema resolution", () => {
      it("should resolve schema from toolDefinition.parameters", async () => {
        const hook = createValidationHook({ strict: true });
        const result = await hook({
          tool: "test",
          params: {},
          context: {
            toolDefinition: {
              parameters: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        });

        expect(result.skip).toBe(true);
        expect(result.value.validationErrors.length > 0).toBeTruthy();
      });

      it("should resolve schema from context.tools[tool]", async () => {
        const hook = createValidationHook({ strict: true });
        const result = await hook({
          tool: "myTool",
          params: {},
          context: {
            tools: {
              myTool: {
                parameters: {
                  type: "object",
                  required: ["id"],
                },
              },
            },
          },
        });

        expect(result.skip).toBe(true);
      });

      it("should resolve schema from toolDefinition.definition.parameters", async () => {
        const hook = createValidationHook({ strict: true });
        const result = await hook({
          tool: "test",
          params: {},
          context: {
            toolDefinition: {
              definition: {
                parameters: {
                  type: "object",
                  required: ["query"],
                },
              },
            },
          },
        });

        expect(result.skip).toBe(true);
      });

      it("should resolve schema from context.tools[tool].definition.parameters", async () => {
        const hook = createValidationHook({ strict: true });
        const result = await hook({
          tool: "searchTool",
          params: {},
          context: {
            tools: {
              searchTool: {
                definition: {
                  parameters: {
                    type: "object",
                    required: ["query"],
                  },
                },
              },
            },
          },
        });

        expect(result.skip).toBe(true);
      });
    });

    describe("strict mode", () => {
      it("should skip execution in strict mode on validation failure", async () => {
        const hook = createValidationHook({ strict: true });
        const result = await hook({
          tool: "test",
          params: {},
          context: {
            toolDefinition: {
              parameters: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        });

        expect(result.skip).toBe(true);
        expect(result.value.success).toBe(false);
        expect(result.value.error.includes("Validation failed")).toBeTruthy();
        expect(result.value.validationErrors.length > 0).toBeTruthy();
      });

      it("should not skip execution when validation passes", async () => {
        const hook = createValidationHook({ strict: true });
        const result = await hook({
          tool: "test",
          params: { name: "valid" },
          context: {
            toolDefinition: {
              parameters: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        });

        expect(result.skip).toBe(undefined);
        expect(result.params).toEqual({ name: "valid" });
      });

      it("should not skip execution in non-strict mode on validation failure", async () => {
        const hook = createValidationHook({ strict: false });
        const result = await hook({
          tool: "test",
          params: {},
          context: {
            toolDefinition: {
              parameters: {
                type: "object",
                required: ["name"],
              },
            },
          },
        });

        expect(result.skip).toBe(undefined);
        expect(result.params).toBeTruthy();
      });
    });

    describe("onError callback", () => {
      it("should call onError callback on validation failure", async () => {
        let errorData = null;
        const hook = createValidationHook({
          onError: (data) => {
            errorData = data;
          },
        });

        await hook({
          tool: "testTool",
          params: { count: "not a number" },
          context: {
            toolDefinition: {
              parameters: {
                type: "object",
                properties: { count: { type: "number" } },
                required: ["count"],
              },
            },
          },
        });

        expect(errorData).toBeTruthy();
        expect(errorData.tool).toBe("testTool");
        expect(errorData.params).toEqual({ count: "not a number" });
        expect(errorData.errors.length > 0).toBeTruthy();
      });

      it("should not call onError callback when validation passes", async () => {
        let errorCalled = false;
        const hook = createValidationHook({
          onError: () => {
            errorCalled = true;
          },
        });

        await hook({
          tool: "test",
          params: { name: "valid" },
          context: {
            toolDefinition: {
              parameters: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        });

        expect(errorCalled).toBe(false);
      });

      it("should call onError even in non-strict mode", async () => {
        let errorCalled = false;
        const hook = createValidationHook({
          strict: false,
          onError: () => {
            errorCalled = true;
          },
        });

        await hook({
          tool: "test",
          params: {},
          context: {
            toolDefinition: {
              parameters: {
                type: "object",
                required: ["name"],
              },
            },
          },
        });

        expect(errorCalled).toBe(true);
      });
    });

    describe("combined options", () => {
      it("should handle strict mode with onError callback", async () => {
        let errorData = null;
        const hook = createValidationHook({
          strict: true,
          onError: (data) => {
            errorData = data;
          },
        });

        const result = await hook({
          tool: "test",
          params: {},
          context: {
            toolDefinition: {
              parameters: {
                type: "object",
                required: ["name"],
              },
            },
          },
        });

        expect(result.skip).toBe(true);
        expect(errorData).toBeTruthy();
        expect(errorData.errors.length > 0).toBeTruthy();
      });
    });
  });
});
