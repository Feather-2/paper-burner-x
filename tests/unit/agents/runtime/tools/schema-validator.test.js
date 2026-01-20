import { describe, it, expect, vi, beforeEach } from "vitest";

const { createSafeRegex } = vi.hoisted(() => ({
  createSafeRegex: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createSafeRegex,
}));

import {
  validateArgs,
  validateToolSchema,
  normalizeSchema,
} from "../../../../../js/agents/runtime/tools/schema-validator.js";

beforeEach(() => {
  createSafeRegex.mockReset();
  createSafeRegex.mockImplementation((pattern, flags) => new RegExp(pattern, flags));
});

describe("validateArgs", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "schema"],
    ["number", 42],
    ["boolean", true],
  ])("returns valid for non-object schema (%s)", (_label, schema) => {
    const { valid, errors } = validateArgs({ any: "value" }, schema);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array", []],
    ["string", "value"],
  ])("treats %s args as empty object", (_label, args) => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };

    const { valid, errors } = validateArgs(args, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("Missing required field: name");
  });

  it("flags required fields when value is null or undefined", () => {
    const schema = {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
      required: ["id", "name"],
    };

    const { valid, errors } = validateArgs({ id: null, name: undefined }, schema);
    expect(valid).toBe(false);
    expect(errors).toEqual(
      expect.arrayContaining([
        "Missing required field: id",
        "Missing required field: name",
      ]),
    );
  });

  it("skips type validation for undefined optional fields", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "number" },
      },
    };

    const { valid, errors } = validateArgs({}, schema);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it("reports type errors for string as number and object as array", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "number" },
        items: { type: "array" },
      },
    };

    const { valid, errors } = validateArgs({ count: "7", items: {} }, schema);
    expect(valid).toBe(false);
    expect(errors).toEqual(
      expect.arrayContaining([
        "count: expected number, got string",
        "items: expected array, got object",
      ]),
    );
  });

  it("accepts integer numbers for integer type", () => {
    const schema = {
      type: "object",
      properties: { size: { type: "integer" } },
    };

    const { valid, errors } = validateArgs({ size: 10 }, schema);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it("rejects non-integer numbers for integer type", () => {
    const schema = {
      type: "object",
      properties: { size: { type: "integer" } },
    };

    const { valid, errors } = validateArgs({ size: 1.5 }, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("size: expected integer, got number");
  });

  it("validates enum values", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["fast", "slow"] },
      },
    };

    const { valid, errors } = validateArgs({ mode: "medium" }, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("mode: must be one of [fast, slow]");
  });

  it("accepts boundary numbers including 0 and MAX_SAFE_INTEGER", () => {
    const schema = {
      type: "object",
      properties: {
        count: {
          type: "number",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
    };

    const zeroResult = validateArgs({ count: 0 }, schema);
    expect(zeroResult.valid).toBe(true);
    expect(zeroResult.errors).toEqual([]);

    const maxResult = validateArgs({ count: Number.MAX_SAFE_INTEGER }, schema);
    expect(maxResult.valid).toBe(true);
    expect(maxResult.errors).toEqual([]);
  });

  it.each([
    [-1, "count: must be >= 0"],
    [
      Number.MAX_SAFE_INTEGER + 1,
      `count: must be <= ${Number.MAX_SAFE_INTEGER}`,
    ],
  ])("rejects out-of-range number %s", (value, message) => {
    const schema = {
      type: "object",
      properties: {
        count: {
          type: "number",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
    };

    const { valid, errors } = validateArgs({ count: value }, schema);
    expect(valid).toBe(false);
    expect(errors).toContain(message);
  });

  it("validates string lengths and pattern for whitespace", () => {
    const schema = {
      type: "object",
      properties: {
        empty: { type: "string", minLength: 1 },
        long: { type: "string", maxLength: 2 },
        code: { type: "string", pattern: "^\\S+$" },
      },
    };

    const { valid, errors } = validateArgs(
      { empty: "", long: "tool", code: "   " },
      schema,
    );
    expect(valid).toBe(false);
    expect(errors).toEqual(
      expect.arrayContaining([
        "empty: length must be >= 1",
        "long: length must be <= 2",
        "code: does not match pattern ^\\S+$",
      ]),
    );
    expect(createSafeRegex).toHaveBeenCalledTimes(1);
    expect(createSafeRegex).toHaveBeenCalledWith("^\\S+$", "u");
  });

  it("validates array minItems", () => {
    const schema = {
      type: "object",
      properties: {
        items: { type: "array", minItems: 1 },
      },
    };

    const { valid, errors } = validateArgs({ items: [] }, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("items: must have >= 1 items");
  });

  it("validates array maxItems", () => {
    const schema = {
      type: "object",
      properties: {
        items: { type: "array", maxItems: 2 },
      },
    };

    const { valid, errors } = validateArgs({ items: [1, 2, 3] }, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("items: must have <= 2 items");
  });

  it("reports invalid patterns", () => {
    createSafeRegex.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const schema = {
      type: "object",
      properties: {
        name: { type: "string", pattern: "[" },
      },
    };

    const { valid, errors } = validateArgs({ name: "x" }, schema);
    expect(valid).toBe(false);
    expect(errors[0]).toContain("name: invalid pattern [");
    expect(errors[0]).toContain("boom");
    expect(createSafeRegex).toHaveBeenCalledWith("[", "u");
  });

  it("flags unknown fields when additionalProperties is false", () => {
    const schema = {
      type: "object",
      properties: {
        known: { type: "string" },
      },
      additionalProperties: false,
    };

    const { valid, errors } = validateArgs({ known: "ok", extra: 1 }, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("Unknown field: extra");
  });

  it("supports simplified schema normalization and inferred types", () => {
    const schema = {
      ids: "identifiers required",
    };

    const { valid, errors } = validateArgs({ ids: "not-array" }, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("ids: expected array, got string");
  });

  it("marks simplified required fields by description", () => {
    const schema = {
      title: "title required",
    };

    const { valid, errors } = validateArgs({}, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("Missing required field: title");
  });

  it("handles empty object and deep nested object values", () => {
    const schema = {
      type: "object",
      properties: {
        meta: { type: "object" },
        emptyObj: { type: "object" },
      },
    };

    const deep = {
      level1: { level2: { level3: { level4: "x" } } },
    };

    const { valid, errors } = validateArgs({ meta: deep, emptyObj: {} }, schema);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  it("handles concurrent validations", async () => {
    const schema = {
      type: "object",
      properties: {
        value: { type: "number", minimum: 0 },
      },
      required: ["value"],
    };

    const paramsList = [{ value: 1 }, { value: -1 }, {}, { value: 0 }];
    const results = await Promise.all(
      paramsList.map((params) =>
        Promise.resolve().then(() => validateArgs(params, schema)),
      ),
    );

    expect(results[0].valid).toBe(true);
    expect(results[1].errors).toContain("value: must be >= 0");
    expect(results[2].errors).toContain("Missing required field: value");
    expect(results[3].valid).toBe(true);
  });

  it("handles rapid successive calls", () => {
    const schema = {
      type: "object",
      properties: {
        flag: { type: "boolean" },
      },
      required: ["flag"],
    };

    const results = [];
    for (let i = 0; i < 20; i += 1) {
      const params = i % 2 === 0 ? { flag: true } : {};
      results.push(validateArgs(params, schema));
    }

    const validResults = results.filter((result) => result.valid);
    const invalidResults = results.filter((result) => !result.valid);

    expect(validResults).toHaveLength(10);
    expect(invalidResults).toHaveLength(10);
    expect(invalidResults[0].errors).toContain("Missing required field: flag");
  });

  it("handles large payloads with very long strings", () => {
    const longText = "a".repeat(20000);
    const schema = {
      type: "object",
      properties: {
        file: { type: "string", maxLength: 1024 },
      },
    };

    const { valid, errors } = validateArgs({ file: longText }, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("file: length must be <= 1024");
  });
});

describe("validateToolSchema", () => {
  it("returns the same validation result as validateArgs", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "number", minimum: 1 },
      },
      required: ["count"],
    };

    const params = { count: 0 };
    const expected = validateArgs(params, schema);
    const result = validateToolSchema(params, schema);

    expect(result).toEqual(expected);
  });

  it("works with simplified schemas", () => {
    const schema = {
      size: "size required",
    };

    const { valid, errors } = validateToolSchema({}, schema);
    expect(valid).toBe(false);
    expect(errors).toContain("Missing required field: size");
  });
});

describe("normalizeSchema", () => {
  it("returns original schema when type is object", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
    };

    expect(normalizeSchema(schema)).toBe(schema);
  });

  it("returns original schema when properties exist", () => {
    const schema = {
      properties: { name: { type: "string" } },
    };

    expect(normalizeSchema(schema)).toBe(schema);
  });

  it("converts simplified descriptions and infers types", () => {
    const schema = {
      ids: "identifiers required",
      count: "number of items",
      isActive: "flag",
      meta: "object payload",
      title: "title",
    };

    const normalized = normalizeSchema(schema);

    expect(normalized.type).toBe("object");
    expect(normalized.required).toEqual(["ids"]);
    expect(normalized.properties.ids.type).toBe("array");
    expect(normalized.properties.count.type).toBe("number");
    expect(normalized.properties.isActive.type).toBe("boolean");
    expect(normalized.properties.meta.type).toBe("object");
    expect(normalized.properties.title.type).toBe("string");
  });

  it("preserves full definitions and required flags", () => {
    const limitDef = { type: "number", required: true };
    const schema = {
      limit: limitDef,
      note: { type: "string" },
    };

    const normalized = normalizeSchema(schema);

    expect(normalized.properties.limit).toBe(limitDef);
    expect(normalized.required).toEqual(["limit"]);
  });

  it("leaves required undefined when none are set", () => {
    const schema = {
      title: "title",
      count: { type: "number" },
    };

    const normalized = normalizeSchema(schema);

    expect(normalized.required).toBeUndefined();
  });

  it("handles empty schema objects", () => {
    const normalized = normalizeSchema({});

    expect(normalized.type).toBe("object");
    expect(normalized.properties).toEqual({});
    expect(normalized.required).toBeUndefined();
  });
});
