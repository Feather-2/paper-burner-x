/**
 * Schema Validator 单元测试
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { validateArgs, normalizeSchema, createValidationHook } from "../../../js/agents/runtime/tools/schema-validator.js";

describe("schema-validator", () => {
  describe("validateArgs", () => {
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
      assert.strictEqual(valid, true);
      assert.strictEqual(errors.length, 0);
    });

    it("should fail on missing required field", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      };

      const { valid, errors } = validateArgs({}, schema);
      assert.strictEqual(valid, false);
      assert.ok(errors.some(e => e.includes("Missing required field: name")));
    });

    it("should fail on type mismatch", () => {
      const schema = {
        type: "object",
        properties: {
          age: { type: "number" },
        },
      };

      const { valid, errors } = validateArgs({ age: "not a number" }, schema);
      assert.strictEqual(valid, false);
      assert.ok(errors.some(e => e.includes("expected number")));
    });

    it("should validate enum values", () => {
      const schema = {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive"] },
        },
      };

      const { valid: valid1 } = validateArgs({ status: "active" }, schema);
      assert.strictEqual(valid1, true);

      const { valid: valid2, errors } = validateArgs({ status: "unknown" }, schema);
      assert.strictEqual(valid2, false);
      assert.ok(errors.some(e => e.includes("must be one of")));
    });

    it("should validate number ranges", () => {
      const schema = {
        type: "object",
        properties: {
          count: { type: "number", minimum: 0, maximum: 100 },
        },
      };

      const { valid: valid1 } = validateArgs({ count: 50 }, schema);
      assert.strictEqual(valid1, true);

      const { valid: valid2 } = validateArgs({ count: -1 }, schema);
      assert.strictEqual(valid2, false);

      const { valid: valid3 } = validateArgs({ count: 101 }, schema);
      assert.strictEqual(valid3, false);
    });

    it("should validate string length", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string", minLength: 2, maxLength: 10 },
        },
      };

      const { valid: valid1 } = validateArgs({ name: "test" }, schema);
      assert.strictEqual(valid1, true);

      const { valid: valid2 } = validateArgs({ name: "a" }, schema);
      assert.strictEqual(valid2, false);

      const { valid: valid3 } = validateArgs({ name: "verylongname" }, schema);
      assert.strictEqual(valid3, false);
    });

    it("should validate array items count", () => {
      const schema = {
        type: "object",
        properties: {
          items: { type: "array", minItems: 1, maxItems: 3 },
        },
      };

      const { valid: valid1 } = validateArgs({ items: [1, 2] }, schema);
      assert.strictEqual(valid1, true);

      const { valid: valid2 } = validateArgs({ items: [] }, schema);
      assert.strictEqual(valid2, false);

      const { valid: valid3 } = validateArgs({ items: [1, 2, 3, 4] }, schema);
      assert.strictEqual(valid3, false);
    });

    it("should validate pattern", () => {
      const schema = {
        type: "object",
        properties: {
          email: { type: "string", pattern: "^[^@]+@[^@]+$" },
        },
      };

      const { valid: valid1 } = validateArgs({ email: "test@example.com" }, schema);
      assert.strictEqual(valid1, true);

      const { valid: valid2 } = validateArgs({ email: "invalid" }, schema);
      assert.strictEqual(valid2, false);
    });

    it("should reject unknown fields when additionalProperties is false", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        additionalProperties: false,
      };

      const { valid, errors } = validateArgs({ name: "test", extra: "field" }, schema);
      assert.strictEqual(valid, false);
      assert.ok(errors.some(e => e.includes("Unknown field: extra")));
    });

    it("should handle null schema gracefully", () => {
      const { valid } = validateArgs({ any: "value" }, null);
      assert.strictEqual(valid, true);
    });

    it("should accept integer as number type", () => {
      const schema = {
        type: "object",
        properties: {
          count: { type: "integer" },
        },
      };

      const { valid: valid1 } = validateArgs({ count: 5 }, schema);
      assert.strictEqual(valid1, true);

      const { valid: valid2 } = validateArgs({ count: 5.5 }, schema);
      assert.strictEqual(valid2, false);
    });

    it("should support multi-type fields", () => {
      const schema = {
        type: "object",
        properties: {
          value: { type: ["string", "null"] },
        },
      };

      const { valid: valid1 } = validateArgs({ value: "test" }, schema);
      assert.strictEqual(valid1, true);

      const { valid: valid2 } = validateArgs({ value: null }, schema);
      assert.strictEqual(valid2, true);

      const { valid: valid3 } = validateArgs({ value: 123 }, schema);
      assert.strictEqual(valid3, false);
    });
  });

  describe("normalizeSchema", () => {
    it("should pass through JSON Schema format", () => {
      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
      };

      const normalized = normalizeSchema(schema);
      assert.deepStrictEqual(normalized, schema);
    });

    it("should convert simple description format", () => {
      const schema = {
        sourceId: "文档 ID（必需）",
        maxLength: "最大返回长度（默认 5000）",
      };

      const normalized = normalizeSchema(schema);
      assert.strictEqual(normalized.type, "object");
      assert.ok(normalized.properties.sourceId);
      assert.ok(normalized.required.includes("sourceId"));
      assert.ok(!normalized.required.includes("maxLength"));
    });

    it("should infer types from descriptions", () => {
      const schema = {
        count: "数字类型",
        items: "数组列表",
        isActive: "布尔值",
        config: "配置对象",
        name: "名称",
      };

      const normalized = normalizeSchema(schema);
      assert.strictEqual(normalized.properties.count.type, "number");
      assert.strictEqual(normalized.properties.items.type, "array");
      assert.strictEqual(normalized.properties.isActive.type, "boolean");
      assert.strictEqual(normalized.properties.config.type, "object");
      assert.strictEqual(normalized.properties.name.type, "string");
    });
  });

  describe("createValidationHook", () => {
    it("should create a before hook", async () => {
      const hook = createValidationHook();
      const result = await hook({
        tool: "test",
        params: { name: "test" },
        context: {},
      });

      assert.ok(result.params);
    });

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

      assert.strictEqual(result.skip, true);
      assert.strictEqual(result.value.success, false);
      assert.ok(result.value.validationErrors.length > 0);
    });

    it("should call onError callback", async () => {
      let errorCalled = false;
      const hook = createValidationHook({
        onError: () => { errorCalled = true; },
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

      assert.strictEqual(errorCalled, true);
    });
  });
});
