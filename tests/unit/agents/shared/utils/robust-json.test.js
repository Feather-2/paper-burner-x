import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { parseJsonStrict, ParseResultCode } from "../../../../../js/agents/shared/utils/robust-json.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ParseResultCode", () => {
  it("exposes a frozen code map", () => {
    expect(Object.isFrozen(ParseResultCode)).toBe(true);
    expect(ParseResultCode).toEqual({
      OK: "OK",
      EMPTY_INPUT: "EMPTY_INPUT",
      INPUT_TOO_LARGE: "INPUT_TOO_LARGE",
      INVALID_JSON: "INVALID_JSON",
      NO_JSON_FOUND: "NO_JSON_FOUND",
    });
  });
});

describe("parseJsonStrict", () => {
  it("parses valid JSON objects directly", () => {
    const result = parseJsonStrict('{"key":"value"}');
    expect(result).toEqual({
      ok: true,
      code: ParseResultCode.OK,
      data: { key: "value" },
    });
  });

  it("parses JSON from a markdown code block", () => {
    const result = parseJsonStrict("```json\n{\"a\":1}\n```");
    expect(result.ok).toBe(true);
    expect(result.code).toBe(ParseResultCode.OK);
    expect(result.data).toEqual({ a: 1 });
  });

  it("parses JSON embedded in surrounding text", () => {
    const result = parseJsonStrict("prefix {\"b\":2} suffix");
    expect(result.ok).toBe(true);
    expect(result.code).toBe(ParseResultCode.OK);
    expect(result.data).toEqual({ b: 2 });
  });

  it("handles BOM and control characters safely", () => {
    const result = parseJsonStrict('\uFEFF{"a":\u0000"b"}');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ a: "b" });
  });

  it.each([
    ["empty array", "[]", []],
    ["empty object", "{}", {}],
  ])("parses %s", (_label, input, expected) => {
    const result = parseJsonStrict(input);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(expected);
  });

  it.each([
    ["0", 0],
    ["-1", -1],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])("parses numeric string %s", (input, expected) => {
    const result = parseJsonStrict(input);
    expect(result.ok).toBe(true);
    expect(result.data).toBe(expected);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ])("returns EMPTY_INPUT for %s", (_label, input) => {
    const result = parseJsonStrict(input);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ParseResultCode.EMPTY_INPUT);
  });

  it.each([
    ["array", []],
    ["object", {}],
    ["zero", 0],
    ["negative", -1],
    ["max safe int", Number.MAX_SAFE_INTEGER],
  ])("returns EMPTY_INPUT for non-string %s", (_label, input) => {
    const result = parseJsonStrict(input);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ParseResultCode.EMPTY_INPUT);
  });

  it("returns NO_JSON_FOUND for whitespace-only input", () => {
    const result = parseJsonStrict("  \n\t  ");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ParseResultCode.NO_JSON_FOUND);
  });

  it("returns NO_JSON_FOUND for unclosed JSON structures", () => {
    const result = parseJsonStrict('{"a":1');
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ParseResultCode.NO_JSON_FOUND);
  });

  it("returns INVALID_JSON when extracted JSON is malformed", () => {
    const result = parseJsonStrict("prefix {\"a\": } suffix");
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ParseResultCode.INVALID_JSON);
    expect(result.error).toBeTypeOf("string");
    expect(result.rawInput).toBe('{"a": }');
  });

  it("truncates rawInput to 500 chars for long invalid JSON", () => {
    const longInvalid = `{${'"a":1,'.repeat(300)}}`;
    const result = parseJsonStrict(longInvalid);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ParseResultCode.INVALID_JSON);
    expect(result.rawInput).toBe(longInvalid.slice(0, 500));
    expect(result.rawInput.length).toBe(500);
  });

  it("returns INPUT_TOO_LARGE when input exceeds default limit", () => {
    const huge = "x".repeat(1_000_001);
    const result = parseJsonStrict(huge);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ParseResultCode.INPUT_TOO_LARGE);
    expect(result.error).toContain("1000000");
  });

  it("respects custom maxChars for long input", () => {
    const result = parseJsonStrict('{"a":1}', { maxChars: 5 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(ParseResultCode.INPUT_TOO_LARGE);
  });

  it("parses a long JSON string within maxChars", () => {
    const values = Array.from({ length: 2000 }, (_, i) => i).join(",");
    const input = `[${values}]`;
    const result = parseJsonStrict(input, { maxChars: input.length });
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBe(2000);
  });

  it("parses deeply nested JSON structures", () => {
    const depth = 120;
    let json = '"end"';
    for (let i = 0; i < depth; i += 1) {
      json = `{\"level\":${json}}`;
    }

    const result = parseJsonStrict(json);
    expect(result.ok).toBe(true);

    let node = result.data;
    for (let i = 0; i < depth; i += 1) {
      expect(node).toHaveProperty("level");
      node = node.level;
    }
    expect(node).toBe("end");
  });

  it("handles concurrent calls safely", async () => {
    const inputs = [
      '{"a":1}',
      "plain text",
      "  ",
      "```json\n[1,2]\n```",
      "prefix {\"b\":2} suffix",
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => parseJsonStrict(input)))
    );

    expect(results[0]).toMatchObject({ ok: true, data: { a: 1 } });
    expect(results[1].code).toBe(ParseResultCode.NO_JSON_FOUND);
    expect(results[2].code).toBe(ParseResultCode.NO_JSON_FOUND);
    expect(results[3]).toMatchObject({ ok: true, data: [1, 2] });
    expect(results[4]).toMatchObject({ ok: true, data: { b: 2 } });
  });

  it("handles rapid sequential calls", () => {
    const inputs = ['{"i":0}', "not json", '{"i":1}', "   ", '{"i":2}'];
    const results = inputs.map((input) => parseJsonStrict(input));

    expect(results[0]).toMatchObject({ ok: true, data: { i: 0 } });
    expect(results[1].code).toBe(ParseResultCode.NO_JSON_FOUND);
    expect(results[2]).toMatchObject({ ok: true, data: { i: 1 } });
    expect(results[3].code).toBe(ParseResultCode.NO_JSON_FOUND);
    expect(results[4]).toMatchObject({ ok: true, data: { i: 2 } });
  });
});
