
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  parseJsonStrict,
  ParseResultCode,
  robustParseJson,
  robustParseJsonWithValidation,
  extractJsonFromLlmResponse,
  generateJsonCorrectionPrompt,
  __test,
} from "../../js/agents/shared/utils/robust-json.js";

const { extractJsonBlock, safePreprocess } = __test;

describe("shared/utils/robust-json", () => {
  describe("safePreprocess", () => {
    it("removes BOM", () => {
      const result = safePreprocess("\uFEFF{\"a\":1}");
      expect(result).toBe('{"a":1}');
    });

    it("removes control characters", () => {
      const result = safePreprocess('{"a":\x00\x01"value"}');
      expect(result).toBe('{"a":"value"}');
    });

    it("preserves newlines, tabs, carriage returns", () => {
      const result = safePreprocess('{"a":\n\t\r"b"}');
      expect(result).toBe('{"a":\n\t\r"b"}');
    });

    it("handles null/undefined", () => {
      expect(safePreprocess(null)).toBe(null);
      expect(safePreprocess(undefined)).toBe(undefined);
    });

    it("handles non-string", () => {
      expect(safePreprocess(123)).toBe(123);
    });
  });

  describe("extractJsonBlock", () => {
    it("extracts from markdown code block", () => {
      const text = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
      const result = extractJsonBlock(text);
      expect(result).toBe('{"key": "value"}');
    });

    it("extracts from generic code block", () => {
      const text = "```\n[1, 2, 3]\n```";
      const result = extractJsonBlock(text);
      expect(result).toBe("[1, 2, 3]");
    });

    it("extracts bare JSON object", () => {
      const text = 'prefix text {"a": 1} suffix';
      const result = extractJsonBlock(text);
      expect(result).toBe('{"a": 1}');
    });

    it("extracts bare JSON array", () => {
      const text = "before [1, 2, 3] after";
      const result = extractJsonBlock(text);
      expect(result).toBe("[1, 2, 3]");
    });

    it("handles nested structures", () => {
      const text = '{"outer": {"inner": [1, 2]}}';
      const result = extractJsonBlock(text);
      expect(result).toBe('{"outer": {"inner": [1, 2]}}');
    });

    it("handles strings with braces", () => {
      const text = '{"msg": "hello {world}"}';
      const result = extractJsonBlock(text);
      expect(result).toBe('{"msg": "hello {world}"}');
    });

    it("handles escaped quotes", () => {
      const text = '{"msg": "say \\"hi\\""}';
      const result = extractJsonBlock(text);
      expect(result).toBe('{"msg": "say \\"hi\\""}');
    });

    it("returns null for no JSON", () => {
      expect(extractJsonBlock("no json here")).toBe(null);
    });

    it("returns null for null input", () => {
      expect(extractJsonBlock(null)).toBe(null);
    });

    it("returns null for unclosed structure", () => {
      const text = '{"unclosed": true';
      expect(extractJsonBlock(text)).toBe(null);
    });

    it("prefers object over array when object comes first", () => {
      const text = '{"a": 1} [1, 2]';
      const result = extractJsonBlock(text);
      expect(result).toBe('{"a": 1}');
    });

    it("prefers array over object when array comes first", () => {
      const text = "[1, 2] {\"a\": 1}";
      const result = extractJsonBlock(text);
      expect(result).toBe("[1, 2]");
    });
  });

  describe("parseJsonStrict", () => {
    it("parses valid JSON directly", () => {
      const result = parseJsonStrict('{"key": "value"}');
      expect(result.ok).toBe(true);
      expect(result.code).toBe(ParseResultCode.OK);
      expect(result.data).toEqual({ key: "value" });
    });

    it("parses JSON from markdown block", () => {
      const result = parseJsonStrict('```json\n{"a": 1}\n```');
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ a: 1 });
    });

    it("returns EMPTY_INPUT for null", () => {
      const result = parseJsonStrict(null);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ParseResultCode.EMPTY_INPUT);
    });

    it("returns EMPTY_INPUT for empty string", () => {
      const result = parseJsonStrict("");
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ParseResultCode.EMPTY_INPUT);
    });

    it("returns INPUT_TOO_LARGE for huge input", () => {
      const huge = "{" + "a".repeat(1_000_001) + "}";
      const result = parseJsonStrict(huge);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ParseResultCode.INPUT_TOO_LARGE);
    });

    it("respects custom maxChars", () => {
      const result = parseJsonStrict('{"a":1}', { maxChars: 5 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ParseResultCode.INPUT_TOO_LARGE);
    });

    it("returns INVALID_JSON for extracted but invalid JSON", () => {
      const result = parseJsonStrict('prefix {"invalid": }');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ParseResultCode.INVALID_JSON);
      expect(result.error).toBeTypeOf("string");
      expect(result.error).toMatch(/\S/);
      expect(result.rawInput).toBe('{"invalid": }');
    });

    it("returns NO_JSON_FOUND when no structure found", () => {
      const result = parseJsonStrict("just plain text");
      expect(result.ok).toBe(false);
      expect(result.code).toBe(ParseResultCode.NO_JSON_FOUND);
    });

    it("handles BOM in input", () => {
      const result = parseJsonStrict('\uFEFF{"bom": true}');
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ bom: true });
    });

    it("parses arrays", () => {
      const result = parseJsonStrict("[1, 2, 3]");
      expect(result.ok).toBe(true);
      expect(result.data).toEqual([1, 2, 3]);
    });
  });

  describe("robustParseJson", () => {
    it("returns parsed data on success", () => {
      const result = robustParseJson('{"a": 1}');
      expect(result).toEqual({ a: 1 });
    });

    it("returns fallback on failure", () => {
      const result = robustParseJson("invalid", { default: "value" });
      expect(result).toEqual({ default: "value" });
    });

    it("returns null fallback by default", () => {
      const result = robustParseJson("invalid");
      expect(result).toBe(null);
    });

    it("extracts from wrapped text", () => {
      const result = robustParseJson('Here is JSON: {"key": 1}');
      expect(result).toEqual({ key: 1 });
    });
  });

  describe("robustParseJsonWithValidation", () => {
    it("returns data when validation passes", () => {
      const result = robustParseJsonWithValidation(
        '{"count": 5}',
        (d) => typeof d.count === "number" && d.count > 0
      );
      expect(result).toEqual({ count: 5 });
    });

    it("returns fallback when validation fails", () => {
      const result = robustParseJsonWithValidation(
        '{"count": -1}',
        (d) => d.count > 0,
        { count: 0 }
      );
      // Validation fails but parsing succeeded, returns data not fallback
      expect(result).toEqual({ count: -1 });
    });

    it("returns data when validator is not a function", () => {
      const result = robustParseJsonWithValidation('{"a": 1}', null);
      expect(result).toEqual({ a: 1 });
    });

    it("returns fallback when parsing fails", () => {
      const result = robustParseJsonWithValidation(
        "invalid",
        () => true,
        "fallback"
      );
      expect(result).toBe("fallback");
    });

    it("handles validator throwing error", () => {
      const result = robustParseJsonWithValidation(
        '{"a": 1}',
        () => { throw new Error("validator error"); },
        "fallback"
      );
      // Parsing succeeded, validator threw, returns data
      expect(result).toEqual({ a: 1 });
    });
  });

  describe("extractJsonFromLlmResponse", () => {
    it("extracts from string response", () => {
      const result = extractJsonFromLlmResponse('```json\n{"result": true}\n```');
      expect(result).toEqual({ result: true });
    });

    it("extracts from object with content field", () => {
      const result = extractJsonFromLlmResponse({
        content: '{"data": [1, 2]}',
      });
      expect(result).toEqual({ data: [1, 2] });
    });

    it("extracts from object with text field", () => {
      const result = extractJsonFromLlmResponse({
        text: '{"key": "value"}',
      });
      expect(result).toEqual({ key: "value" });
    });

    it("extracts from object with message field", () => {
      const result = extractJsonFromLlmResponse({
        message: '{"msg": "hello"}',
      });
      expect(result).toEqual({ msg: "hello" });
    });

    it("returns null for null input", () => {
      expect(extractJsonFromLlmResponse(null)).toBe(null);
    });

    it("returns null for object without text fields", () => {
      expect(extractJsonFromLlmResponse({ other: 123 })).toBe(null);
    });

    it("returns null for non-string content", () => {
      expect(extractJsonFromLlmResponse({ content: 123 })).toBe(null);
    });
  });

  describe("generateJsonCorrectionPrompt", () => {
    it("includes error message", () => {
      const prompt = generateJsonCorrectionPrompt("Unexpected token", '{"bad": }');
      expect(prompt).toContain("Unexpected token");
    });

    it("includes raw input preview", () => {
      const prompt = generateJsonCorrectionPrompt("Error", '{"preview": "text"}');
      expect(prompt).toContain('{"preview": "text"}');
    });

    it("handles empty raw input", () => {
      const prompt = generateJsonCorrectionPrompt("Error", "");
      expect(prompt).toContain("Error");
      expect(prompt).not.toContain("problematic content");
    });

    it("truncates long raw input", () => {
      const longInput = "x".repeat(500);
      const prompt = generateJsonCorrectionPrompt("Error", longInput);
      expect(prompt.length).toBeLessThan(longInput.length + 500);
    });
  });

  describe("ParseResultCode", () => {
    it("is frozen", () => {
      expect(Object.isFrozen(ParseResultCode)).toBe(true);
    });

    it("has expected codes", () => {
      expect(ParseResultCode.OK).toBe("OK");
      expect(ParseResultCode.EMPTY_INPUT).toBe("EMPTY_INPUT");
      expect(ParseResultCode.INPUT_TOO_LARGE).toBe("INPUT_TOO_LARGE");
      expect(ParseResultCode.INVALID_JSON).toBe("INVALID_JSON");
      expect(ParseResultCode.NO_JSON_FOUND).toBe("NO_JSON_FOUND");
    });
  });
});
