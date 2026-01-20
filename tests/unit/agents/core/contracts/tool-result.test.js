import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  normalizeToolResult,
  validateToolResult,
} from "../../../../../js/agents/core/contracts/tool-result.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => new Uint8Array(1024 * 1024)),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function buildDeepObject(depth) {
  let current = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    current = { level: i, child: current };
  }
  return current;
}

describe("validateToolResult", () => {
  it("rejects non-objects including null/undefined/empty string", () => {
    const invalids = [null, undefined, ""];

    for (const value of invalids) {
      expect(validateToolResult(value)).toEqual({
        ok: false,
        error: "ToolResult: expected object",
      });
    }
  });

  it("accepts empty object/array but defaults ok/success to false", () => {
    const emptyObject = validateToolResult({});
    expect(emptyObject.ok).toBe(true);
    expect(emptyObject.value).toEqual({
      ok: false,
      success: false,
      data: undefined,
      error: undefined,
      meta: undefined,
    });

    const emptyArray = validateToolResult([]);
    expect(emptyArray.ok).toBe(true);
    expect(emptyArray.value).toEqual({
      ok: false,
      success: false,
      data: undefined,
      error: undefined,
      meta: undefined,
    });
  });

  it("treats ok/success as compatible with explicit failure precedence", () => {
    const okOnly = validateToolResult({ ok: true, data: 1 });
    expect(okOnly.ok).toBe(true);
    expect(okOnly.value).toMatchObject({ ok: true, success: true, data: 1 });

    const successOnly = validateToolResult({ success: true, data: 2 });
    expect(successOnly.value).toMatchObject({ ok: true, success: true, data: 2 });

    const explicitFailure = validateToolResult({ ok: true, success: false, data: 3 });
    expect(explicitFailure.value).toMatchObject({ ok: false, success: false, data: 3 });
  });

  it("sanitizes error/meta types while preserving boundary data", () => {
    const result = validateToolResult({
      ok: true,
      data: {
        zero: 0,
        negative: -1,
        max: Number.MAX_SAFE_INTEGER,
        numericString: "123",
      },
      error: 123,
      meta: [],
    });

    expect(result.ok).toBe(true);
    expect(result.value.data).toEqual({
      zero: 0,
      negative: -1,
      max: Number.MAX_SAFE_INTEGER,
      numericString: "123",
    });
    expect(result.value.error).toBeUndefined();
    expect(result.value.meta).toBeUndefined();
  });

  it("handles concurrent validations consistently", async () => {
    const inputs = [
      { ok: true, data: "ok" },
      { success: false, error: "fail" },
      {},
      [],
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => validateToolResult(input)))
    );

    expect(results[0].value).toMatchObject({ ok: true, success: true, data: "ok" });
    expect(results[1].value).toMatchObject({ ok: false, success: false, error: "fail" });
    expect(results[2].value).toMatchObject({ ok: false, success: false });
    expect(results[3].value).toMatchObject({ ok: false, success: false });
  });
});

describe("normalizeToolResult", () => {
  it("returns a validated ToolResult when ok/success is present", () => {
    expect(normalizeToolResult({ ok: true, data: "ok" })).toEqual({
      ok: true,
      success: true,
      data: "ok",
      error: undefined,
      meta: undefined,
    });

    expect(normalizeToolResult({ success: true, data: 2 })).toEqual({
      ok: true,
      success: true,
      data: 2,
      error: undefined,
      meta: undefined,
    });

    expect(normalizeToolResult({ ok: true, success: false, data: 3 })).toEqual({
      ok: false,
      success: false,
      data: 3,
      error: undefined,
      meta: undefined,
    });
  });

  it("normalizes error-string objects as failures with meta", () => {
    const result = normalizeToolResult({
      error: "boom",
      data: { id: 1 },
      meta: { trace: "x" },
    });

    expect(result).toEqual({
      ok: false,
      success: false,
      data: { id: 1 },
      error: "boom",
      meta: { trace: "x" },
    });
  });

  it("wraps Error instances as failures", () => {
    const error = new Error("kaboom");
    const result = normalizeToolResult(error);

    expect(result.ok).toBe(false);
    expect(result.success).toBe(false);
    expect(result.error).toBe("kaboom");
    expect(result.data).toBeUndefined();
    expect(result.meta).toBeUndefined();
  });

  it("normalizes null/undefined to ok:true with data:null", () => {
    expect(normalizeToolResult(null)).toEqual({ ok: true, success: true, data: null });
    expect(normalizeToolResult(undefined)).toEqual({ ok: true, success: true, data: null });
  });

  it("wraps primitives and boundary values as data", () => {
    const samples = [0, -1, Number.MAX_SAFE_INTEGER, "", "   ", "123"];

    for (const value of samples) {
      expect(normalizeToolResult(value)).toEqual({ ok: true, success: true, data: value });
    }
  });

  it("wraps arrays, empty objects, and array-like inputs without ok/success", () => {
    const array = [];
    const emptyObject = {};
    const arrayLike = { 0: "a", length: 1 };

    expect(normalizeToolResult(array)).toEqual({ ok: true, success: true, data: array });
    expect(normalizeToolResult(emptyObject)).toEqual({
      ok: true,
      success: true,
      data: emptyObject,
    });
    expect(normalizeToolResult(arrayLike)).toEqual({ ok: true, success: true, data: arrayLike });
  });

  it("preserves deep nested data and meta via data-object path", () => {
    const deep = buildDeepObject(50);
    const result = normalizeToolResult({
      data: deep,
      meta: { source: "deep" },
    });

    expect(result.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(deep);
    expect(result.error).toBeUndefined();
    expect(result.meta).toEqual({ source: "deep" });
  });

  it("handles large file buffers and long strings", () => {
    const largeBuffer = readFileSync("/virtual/large.bin");
    const longString = "x".repeat(200000);

    const bufferResult = normalizeToolResult(largeBuffer);
    expect(readFileSync).toHaveBeenCalledWith("/virtual/large.bin");
    expect(bufferResult.ok).toBe(true);
    expect(bufferResult.success).toBe(true);
    expect(bufferResult.data).toBe(largeBuffer);
    expect(bufferResult.data.length).toBe(1024 * 1024);

    const stringResult = normalizeToolResult(longString);
    expect(stringResult).toEqual({ ok: true, success: true, data: longString });
    expect(stringResult.data.length).toBe(200000);
  });

  it("handles concurrent and rapid sequential calls without shared state", async () => {
    const inputs = [
      { ok: true, data: 1 },
      { success: false, error: "fail" },
      null,
      "value",
    ];

    const concurrent = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => normalizeToolResult(input)))
    );

    expect(concurrent[0]).toMatchObject({ ok: true, success: true, data: 1 });
    expect(concurrent[1]).toMatchObject({ ok: false, success: false, error: "fail" });
    expect(concurrent[2]).toEqual({ ok: true, success: true, data: null });
    expect(concurrent[3]).toEqual({ ok: true, success: true, data: "value" });

    const sequentialResults = [];
    for (let i = 0; i < 20; i += 1) {
      sequentialResults.push(normalizeToolResult({ ok: true, data: i }));
    }

    expect(sequentialResults[0]).toMatchObject({ ok: true, data: 0 });
    expect(sequentialResults[19]).toMatchObject({ ok: true, data: 19 });
  });
});
