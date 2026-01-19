import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("isPlainObject: basic shape checks", async () => {
  const { isPlainObject } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(isPlainObject(null)).toBe(false);
  expect(isPlainObject(undefined)).toBe(false);
  expect(isPlainObject([])).toBe(false);
  expect(isPlainObject(() => {})).toBe(false);
  expect(isPlainObject({})).toBe(true);
  expect(isPlainObject(Object.create(null))).toBe(true);
});

it("isPlainObject: excludes built-ins and custom prototypes", async () => {
  const { isPlainObject } = await import("../../../js/agents/shared/utils/value-utils.js");

  class X {}

  expect(isPlainObject(new Date())).toBe(false);
  expect(isPlainObject(new Map())).toBe(false);
  expect(isPlainObject(new Set())).toBe(false);
  expect(isPlainObject(/re/)).toBe(false);
  expect(isPlainObject(new Error("x"))).toBe(false);
  expect(isPlainObject(new X())).toBe(false);
  expect(isPlainObject(Object.create({ a: 1 }))).toBe(false);
  expect(isPlainObject(Object.create(Object.create(null)))).toBe(false);
});

it("toNonEmptyString: nullish and empty values -> undefined", async () => {
  const { toNonEmptyString } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(toNonEmptyString(undefined)).toBe(undefined);
  expect(toNonEmptyString(null)).toBe(undefined);
  expect(toNonEmptyString("")).toBe(undefined);
  expect(toNonEmptyString("   \t\n  ")).toBe(undefined);
});

it("toNonEmptyString: trims and converts via String()", async () => {
  const { toNonEmptyString } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(toNonEmptyString("  hello  ")).toBe("hello");
  expect(toNonEmptyString(0)).toBe("0");
  expect(toNonEmptyString(false)).toBe("false");
  expect(toNonEmptyString({ toString: () => "  ok  " })).toBe("ok");
  expect(toNonEmptyString("汉字")).toBe("汉字");
});

it("safeNumber: accepts finite numbers and numeric strings", async () => {
  const { safeNumber } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(safeNumber(0)).toBe(0);
  expect(safeNumber(-2.5)).toBe(-2.5);
  expect(safeNumber(3.1)).toBe(3.1);

  expect(safeNumber("  42  ")).toBe(42);
  expect(safeNumber("3.25")).toBe(3.25);
  expect(safeNumber("1e2")).toBe(100);
});

it("safeNumber: rejects invalid, non-finite, and non-string non-number", async () => {
  const { safeNumber } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(safeNumber(NaN)).toBe(null);
  expect(safeNumber(Infinity)).toBe(null);
  expect(safeNumber(-Infinity)).toBe(null);

  expect(safeNumber("")).toBe(null);
  expect(safeNumber("   ")).toBe(null);
  expect(safeNumber("nope")).toBe(null);
  expect(safeNumber("1e309")).toBe(null);

  expect(safeNumber(true)).toBe(null);
  expect(safeNumber({ valueOf: () => 2 })).toBe(null);
  expect(safeNumber(null)).toBe(null);
  expect(safeNumber(undefined)).toBe(null);
});

it("safeInt: floors finite numeric input and rejects invalid", async () => {
  const { safeInt } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(safeInt(2)).toBe(2);
  expect(safeInt(2.9)).toBe(2);
  expect(safeInt(-1.2)).toBe(-2);
  expect(safeInt(-0.1)).toBe(-1);

  expect(safeInt(" 3.9 ")).toBe(3);
  expect(safeInt("0")).toBe(0);

  expect(safeInt(NaN)).toBe(null);
  expect(safeInt(Infinity)).toBe(null);
  expect(safeInt("")).toBe(null);
  expect(safeInt("abc")).toBe(null);
  expect(safeInt(null)).toBe(null);
  expect(safeInt(undefined)).toBe(null);
});

it("normalizeRenderType: handles ai-image variants", async () => {
  const { normalizeRenderType } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(normalizeRenderType("ai-image")).toBe("ai-image");
  expect(normalizeRenderType("ai_image")).toBe("ai-image");
  expect(normalizeRenderType("image")).toBe("ai-image");
  expect(normalizeRenderType("IMAGE")).toBe("ai-image");
  expect(normalizeRenderType("  AI-IMAGE  ")).toBe("ai-image");
});

it("normalizeRenderType: handles svg", async () => {
  const { normalizeRenderType } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(normalizeRenderType("svg")).toBe("svg");
  expect(normalizeRenderType("SVG")).toBe("svg");
  expect(normalizeRenderType("  svg  ")).toBe("svg");
});

it("normalizeRenderType: handles asset variants", async () => {
  const { normalizeRenderType } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(normalizeRenderType("asset")).toBe("asset");
  expect(normalizeRenderType("doc-asset")).toBe("asset");
  expect(normalizeRenderType("document-asset")).toBe("asset");
  expect(normalizeRenderType("ASSET")).toBe("asset");
});

it("normalizeRenderType: defaults to ai-image for unknown/empty", async () => {
  const { normalizeRenderType } = await import("../../../js/agents/shared/utils/value-utils.js");

  expect(normalizeRenderType("")).toBe("ai-image");
  expect(normalizeRenderType(null)).toBe("ai-image");
  expect(normalizeRenderType(undefined)).toBe("ai-image");
  expect(normalizeRenderType("unknown")).toBe("ai-image");
  expect(normalizeRenderType(123)).toBe("ai-image");
});

