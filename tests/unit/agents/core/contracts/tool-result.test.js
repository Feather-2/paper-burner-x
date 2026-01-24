import { describe, it, expect } from "vitest";

import { normalizeToolResult, validateToolResult } from "../../../../../js/agents/core/contracts/tool-result.js";

function buildDeepObject(depth) {
  let current = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    current = { level: i, child: current };
  }
  return current;
}

describe("validateToolResult", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty_string", ""],
    ["whitespace_string", "   "],
    ["number_zero", 0],
    ["number_negative_one", -1],
    ["number_max_safe_integer", Number.MAX_SAFE_INTEGER],
    ["boolean_false", false],
    ["boolean_true", true],
  ])("should_return_invalid_when_input_is_%s", (_label, value) => {
    // Arrange

    // Act
    const result = validateToolResult(value);

    // Assert
    expect(result).toEqual({ ok: false, error: "ToolResult: expected object" });
  });

  it("should_return_default_failure_when_input_is_empty_object", () => {
    // Arrange

    // Act
    const result = validateToolResult({});

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: false, success: false, data: undefined, error: undefined, meta: undefined },
    });
  });

  it("should_return_default_failure_when_input_is_array_without_ok_or_success", () => {
    // Arrange

    // Act
    const result = validateToolResult([]);

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: false, success: false, data: undefined, error: undefined, meta: undefined },
    });
  });

  it("should_return_success_when_input_ok_is_true", () => {
    // Arrange

    // Act
    const result = validateToolResult({ ok: true, data: 1 });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: true, success: true, data: 1, error: undefined, meta: undefined },
    });
  });

  it("should_return_success_when_input_success_is_true", () => {
    // Arrange

    // Act
    const result = validateToolResult({ success: true, data: 2 });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: true, success: true, data: 2, error: undefined, meta: undefined },
    });
  });

  it("should_return_failure_when_ok_true_and_success_false", () => {
    // Arrange

    // Act
    const result = validateToolResult({ ok: true, success: false, data: 3 });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: false, success: false, data: 3, error: undefined, meta: undefined },
    });
  });

  it("should_return_failure_when_ok_false_and_success_true", () => {
    // Arrange

    // Act
    const result = validateToolResult({ ok: false, success: true, data: 4 });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: false, success: false, data: 4, error: undefined, meta: undefined },
    });
  });

  it("should_return_error_string_when_error_is_string", () => {
    // Arrange

    // Act
    const result = validateToolResult({ ok: false, error: "boom" });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: false, success: false, data: undefined, error: "boom", meta: undefined },
    });
  });

  it("should_return_error_undefined_when_error_is_not_string", () => {
    // Arrange

    // Act
    const result = validateToolResult({ ok: false, error: 123 });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: false, success: false, data: undefined, error: undefined, meta: undefined },
    });
  });

  it("should_return_meta_when_meta_is_plain_object", () => {
    // Arrange

    // Act
    const result = validateToolResult({ ok: true, meta: { trace: "x" } });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: true, success: true, data: undefined, error: undefined, meta: { trace: "x" } },
    });
  });

  it("should_return_meta_undefined_when_meta_is_array", () => {
    // Arrange

    // Act
    const result = validateToolResult({ ok: true, meta: [] });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: true, success: true, data: undefined, error: undefined, meta: undefined },
    });
  });

  it("should_return_meta_undefined_when_meta_is_null", () => {
    // Arrange

    // Act
    const result = validateToolResult({ ok: true, meta: null });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: true, success: true, data: undefined, error: undefined, meta: undefined },
    });
  });

  it("should_preserve_boundary_data_when_error_and_meta_are_invalid", () => {
    // Arrange
    const boundaryData = {
      zero: 0,
      negative: -1,
      max: Number.MAX_SAFE_INTEGER,
      numericString: "123",
    };

    // Act
    const result = validateToolResult({ ok: true, data: boundaryData, error: 123, meta: [] });

    // Assert
    expect(result).toEqual({
      ok: true,
      value: { ok: true, success: true, data: boundaryData, error: undefined, meta: undefined },
    });
  });

  it("should_return_consistent_results_when_validating_concurrently", async () => {
    // Arrange
    const inputs = [{ ok: true, data: "ok" }, { success: false, error: "fail" }, {}, [], null];

    // Act
    const results = await Promise.all(inputs.map((input) => Promise.resolve().then(() => validateToolResult(input))));

    // Assert
    expect(results).toEqual([
      { ok: true, value: { ok: true, success: true, data: "ok", error: undefined, meta: undefined } },
      { ok: true, value: { ok: false, success: false, data: undefined, error: "fail", meta: undefined } },
      { ok: true, value: { ok: false, success: false, data: undefined, error: undefined, meta: undefined } },
      { ok: true, value: { ok: false, success: false, data: undefined, error: undefined, meta: undefined } },
      { ok: false, error: "ToolResult: expected object" },
    ]);
  });
});

describe("normalizeToolResult", () => {
  it("should_return_validated_result_when_input_contains_ok", () => {
    // Arrange

    // Act
    const result = normalizeToolResult({ ok: true, data: "ok" });

    // Assert
    expect(result).toEqual({ ok: true, success: true, data: "ok", error: undefined, meta: undefined });
  });

  it("should_return_validated_result_when_input_contains_success", () => {
    // Arrange

    // Act
    const result = normalizeToolResult({ success: true, data: 2 });

    // Assert
    expect(result).toEqual({ ok: true, success: true, data: 2, error: undefined, meta: undefined });
  });

  it("should_apply_explicit_failure_precedence_when_input_contains_conflicting_ok_success", () => {
    // Arrange

    // Act
    const result = normalizeToolResult({ ok: true, success: false, data: 3 });

    // Assert
    expect(result).toEqual({ ok: false, success: false, data: 3, error: undefined, meta: undefined });
  });

  it("should_return_failure_when_ok_property_is_non_boolean", () => {
    // Arrange

    // Act
    const result = normalizeToolResult({ ok: "true", data: 1 });

    // Assert
    expect(result).toEqual({ ok: false, success: false, data: 1, error: undefined, meta: undefined });
  });

  it("should_return_failure_when_input_is_error_string_object", () => {
    // Arrange
    const input = { error: "boom", data: { id: 1 }, meta: { trace: "x" } };

    // Act
    const result = normalizeToolResult(input);

    // Assert
    expect(result).toEqual({ ok: false, success: false, data: { id: 1 }, error: "boom", meta: { trace: "x" } });
  });

  it("should_sanitize_meta_when_error_string_object_meta_is_array", () => {
    // Arrange
    const input = { error: "boom", meta: [] };

    // Act
    const result = normalizeToolResult(input);

    // Assert
    expect(result).toEqual({ ok: false, success: false, data: undefined, error: "boom", meta: undefined });
  });

  it("should_return_success_when_input_contains_data_without_ok_success_or_error", () => {
    // Arrange
    const deep = buildDeepObject(50);

    // Act
    const result = normalizeToolResult({ data: deep, meta: { source: "deep" } });

    // Assert
    expect(result).toEqual({ ok: true, success: true, data: deep, error: undefined, meta: { source: "deep" } });
  });

  it("should_return_failure_with_stack_meta_when_input_is_error_instance", () => {
    // Arrange
    const error = new Error("kaboom");

    // Act
    const result = normalizeToolResult(error);

    // Assert
    expect(result).toEqual({
      ok: false,
      success: false,
      error: "kaboom",
      data: undefined,
      meta: { stack: error.stack },
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("should_return_data_null_when_input_is_%s", (_label, value) => {
    // Arrange

    // Act
    const result = normalizeToolResult(value);

    // Assert
    expect(result).toEqual({ ok: true, success: true, data: null });
  });

  it.each([
    ["empty_string", ""],
    ["whitespace_string", "   "],
    ["numeric_string", "123"],
    ["number_zero", 0],
    ["number_negative_one", -1],
    ["number_max_safe_integer", Number.MAX_SAFE_INTEGER],
    ["boolean_false", false],
    ["boolean_true", true],
  ])("should_wrap_%s_as_data_when_input_is_primitive", (_label, value) => {
    // Arrange

    // Act
    const result = normalizeToolResult(value);

    // Assert
    expect(result).toEqual({ ok: true, success: true, data: value });
  });

  it.each([
    ["empty_array", []],
    ["empty_object", {}],
    ["array_like_object", { 0: "a", length: 1 }],
  ])("should_wrap_%s_as_data_when_input_is_unknown_object", (_label, value) => {
    // Arrange

    // Act
    const result = normalizeToolResult(value);

    // Assert
    expect(result).toEqual({ ok: true, success: true, data: value });
  });

  it("should_wrap_large_typed_array_as_data_when_input_is_large_buffer", () => {
    // Arrange
    const largeBuffer = new Uint8Array(1024 * 1024);

    // Act
    const result = normalizeToolResult(largeBuffer);

    // Assert
    expect(result).toEqual({ ok: true, success: true, data: largeBuffer });
  });

  it("should_wrap_long_string_as_data_when_input_is_long_string", () => {
    // Arrange
    const longString = "x".repeat(200000);

    // Act
    const result = normalizeToolResult(longString);

    // Assert
    expect(result).toEqual({ ok: true, success: true, data: longString });
  });

  it("should_return_consistent_results_when_normalizing_concurrently", async () => {
    // Arrange
    const inputs = [{ ok: true, data: 1 }, { success: false, error: "fail" }, null, "value"];

    // Act
    const results = await Promise.all(inputs.map((input) => Promise.resolve().then(() => normalizeToolResult(input))));

    // Assert
    expect(results).toEqual([
      { ok: true, success: true, data: 1, error: undefined, meta: undefined },
      { ok: false, success: false, data: undefined, error: "fail", meta: undefined },
      { ok: true, success: true, data: null },
      { ok: true, success: true, data: "value" },
    ]);
  });

  it("should_return_consistent_results_when_normalizing_rapidly_in_sequence", () => {
    // Arrange
    const inputs = Array.from({ length: 20 }, (_unused, i) => ({ ok: true, data: i }));

    // Act
    const results = inputs.map((input) => normalizeToolResult(input));

    // Assert
    expect(results).toEqual(
      Array.from({ length: 20 }, (_unused, i) => ({
        ok: true,
        success: true,
        data: i,
        error: undefined,
        meta: undefined,
      }))
    );
  });
});