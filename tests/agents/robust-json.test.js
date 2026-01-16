import { describe, it } from "node:test";
import assert from "node:assert/strict";

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
      assert.equal(result, '{"a":1}');
    });

    it("removes control characters", () => {
      const result = safePreprocess('{"a":\x00\x01"value"}');
      assert.equal(result, '{"a":"value"}');
    });

    it("preserves newlines, tabs, carriage returns", () => {
      const result = safePreprocess('{"a":\n\t\r"b"}');
      assert.equal(result, '{"a":\n\t\r"b"}');
    });

    it("handles null/undefined", () => {
      assert.equal(safePreprocess(null), null);
      assert.equal(safePreprocess(undefined), undefined);
    });

    it("handles non-string", () => {
      assert.equal(safePreprocess(123), 123);
    });
  });

  describe("extractJsonBlock", () => {
    it("extracts from markdown code block", () => {
      const text = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
      const result = extractJsonBlock(text);
      assert.equal(result, '{"key": "value"}');
    });

    it("extracts from generic code block", () => {
      const text = "```\n[1, 2, 3]\n```";
      const result = extractJsonBlock(text);
      assert.equal(result, "[1, 2, 3]");
    });

    it("extracts bare JSON object", () => {
      const text = 'prefix text {"a": 1} suffix';
      const result = extractJsonBlock(text);
      assert.equal(result, '{"a": 1}');
    });

    it("extracts bare JSON array", () => {
      const text = "before [1, 2, 3] after";
      const result = extractJsonBlock(text);
      assert.equal(result, "[1, 2, 3]");
    });

    it("handles nested structures", () => {
      const text = '{"outer": {"inner": [1, 2]}}';
      const result = extractJsonBlock(text);
      assert.equal(result, '{"outer": {"inner": [1, 2]}}');
    });

    it("handles strings with braces", () => {
      const text = '{"msg": "hello {world}"}';
      const result = extractJsonBlock(text);
      assert.equal(result, '{"msg": "hello {world}"}');
    });

    it("handles escaped quotes", () => {
      const text = '{"msg": "say \\"hi\\""}';
      const result = extractJsonBlock(text);
      assert.equal(result, '{"msg": "say \\"hi\\""}');
    });

    it("returns null for no JSON", () => {
      assert.equal(extractJsonBlock("no json here"), null);
    });

    it("returns null for null input", () => {
      assert.equal(extractJsonBlock(null), null);
    });

    it("returns null for unclosed structure", () => {
      const text = '{"unclosed": true';
      assert.equal(extractJsonBlock(text), null);
    });

    it("prefers object over array when object comes first", () => {
      const text = '{"a": 1} [1, 2]';
      const result = extractJsonBlock(text);
      assert.equal(result, '{"a": 1}');
    });

    it("prefers array over object when array comes first", () => {
      const text = "[1, 2] {\"a\": 1}";
      const result = extractJsonBlock(text);
      assert.equal(result, "[1, 2]");
    });
  });

  describe("parseJsonStrict", () => {
    it("parses valid JSON directly", () => {
      const result = parseJsonStrict('{"key": "value"}');
      assert.ok(result.ok);
      assert.equal(result.code, ParseResultCode.OK);
      assert.deepEqual(result.data, { key: "value" });
    });

    it("parses JSON from markdown block", () => {
      const result = parseJsonStrict('```json\n{"a": 1}\n```');
      assert.ok(result.ok);
      assert.deepEqual(result.data, { a: 1 });
    });

    it("returns EMPTY_INPUT for null", () => {
      const result = parseJsonStrict(null);
      assert.equal(result.ok, false);
      assert.equal(result.code, ParseResultCode.EMPTY_INPUT);
    });

    it("returns EMPTY_INPUT for empty string", () => {
      const result = parseJsonStrict("");
      assert.equal(result.ok, false);
      assert.equal(result.code, ParseResultCode.EMPTY_INPUT);
    });

    it("returns INPUT_TOO_LARGE for huge input", () => {
      const huge = "{" + "a".repeat(1_000_001) + "}";
      const result = parseJsonStrict(huge);
      assert.equal(result.ok, false);
      assert.equal(result.code, ParseResultCode.INPUT_TOO_LARGE);
    });

    it("respects custom maxChars", () => {
      const result = parseJsonStrict('{"a":1}', { maxChars: 5 });
      assert.equal(result.ok, false);
      assert.equal(result.code, ParseResultCode.INPUT_TOO_LARGE);
    });

    it("returns INVALID_JSON for extracted but invalid JSON", () => {
      const result = parseJsonStrict('prefix {"invalid": }');
      assert.equal(result.ok, false);
      assert.equal(result.code, ParseResultCode.INVALID_JSON);
      assert.ok(result.error);
      assert.ok(result.rawInput);
    });

    it("returns NO_JSON_FOUND when no structure found", () => {
      const result = parseJsonStrict("just plain text");
      assert.equal(result.ok, false);
      assert.equal(result.code, ParseResultCode.NO_JSON_FOUND);
    });

    it("handles BOM in input", () => {
      const result = parseJsonStrict('\uFEFF{"bom": true}');
      assert.ok(result.ok);
      assert.deepEqual(result.data, { bom: true });
    });

    it("parses arrays", () => {
      const result = parseJsonStrict("[1, 2, 3]");
      assert.ok(result.ok);
      assert.deepEqual(result.data, [1, 2, 3]);
    });
  });

  describe("robustParseJson", () => {
    it("returns parsed data on success", () => {
      const result = robustParseJson('{"a": 1}');
      assert.deepEqual(result, { a: 1 });
    });

    it("returns fallback on failure", () => {
      const result = robustParseJson("invalid", { default: "value" });
      assert.deepEqual(result, { default: "value" });
    });

    it("returns null fallback by default", () => {
      const result = robustParseJson("invalid");
      assert.equal(result, null);
    });

    it("extracts from wrapped text", () => {
      const result = robustParseJson('Here is JSON: {"key": 1}');
      assert.deepEqual(result, { key: 1 });
    });
  });

  describe("robustParseJsonWithValidation", () => {
    it("returns data when validation passes", () => {
      const result = robustParseJsonWithValidation(
        '{"count": 5}',
        (d) => typeof d.count === "number" && d.count > 0
      );
      assert.deepEqual(result, { count: 5 });
    });

    it("returns fallback when validation fails", () => {
      const result = robustParseJsonWithValidation(
        '{"count": -1}',
        (d) => d.count > 0,
        { count: 0 }
      );
      // Validation fails but parsing succeeded, returns data not fallback
      assert.deepEqual(result, { count: -1 });
    });

    it("returns data when validator is not a function", () => {
      const result = robustParseJsonWithValidation('{"a": 1}', null);
      assert.deepEqual(result, { a: 1 });
    });

    it("returns fallback when parsing fails", () => {
      const result = robustParseJsonWithValidation(
        "invalid",
        () => true,
        "fallback"
      );
      assert.equal(result, "fallback");
    });

    it("handles validator throwing error", () => {
      const result = robustParseJsonWithValidation(
        '{"a": 1}',
        () => { throw new Error("validator error"); },
        "fallback"
      );
      // Parsing succeeded, validator threw, returns data
      assert.deepEqual(result, { a: 1 });
    });
  });

  describe("extractJsonFromLlmResponse", () => {
    it("extracts from string response", () => {
      const result = extractJsonFromLlmResponse('```json\n{"result": true}\n```');
      assert.deepEqual(result, { result: true });
    });

    it("extracts from object with content field", () => {
      const result = extractJsonFromLlmResponse({
        content: '{"data": [1, 2]}',
      });
      assert.deepEqual(result, { data: [1, 2] });
    });

    it("extracts from object with text field", () => {
      const result = extractJsonFromLlmResponse({
        text: '{"key": "value"}',
      });
      assert.deepEqual(result, { key: "value" });
    });

    it("extracts from object with message field", () => {
      const result = extractJsonFromLlmResponse({
        message: '{"msg": "hello"}',
      });
      assert.deepEqual(result, { msg: "hello" });
    });

    it("returns null for null input", () => {
      assert.equal(extractJsonFromLlmResponse(null), null);
    });

    it("returns null for object without text fields", () => {
      assert.equal(extractJsonFromLlmResponse({ other: 123 }), null);
    });

    it("returns null for non-string content", () => {
      assert.equal(extractJsonFromLlmResponse({ content: 123 }), null);
    });
  });

  describe("generateJsonCorrectionPrompt", () => {
    it("includes error message", () => {
      const prompt = generateJsonCorrectionPrompt("Unexpected token", '{"bad": }');
      assert.ok(prompt.includes("Unexpected token"));
    });

    it("includes raw input preview", () => {
      const prompt = generateJsonCorrectionPrompt("Error", '{"preview": "text"}');
      assert.ok(prompt.includes('{"preview": "text"}'));
    });

    it("handles empty raw input", () => {
      const prompt = generateJsonCorrectionPrompt("Error", "");
      assert.ok(prompt.includes("Error"));
      assert.ok(!prompt.includes("problematic content"));
    });

    it("truncates long raw input", () => {
      const longInput = "x".repeat(500);
      const prompt = generateJsonCorrectionPrompt("Error", longInput);
      assert.ok(prompt.length < longInput.length + 500);
    });
  });

  describe("ParseResultCode", () => {
    it("is frozen", () => {
      assert.ok(Object.isFrozen(ParseResultCode));
    });

    it("has expected codes", () => {
      assert.equal(ParseResultCode.OK, "OK");
      assert.equal(ParseResultCode.EMPTY_INPUT, "EMPTY_INPUT");
      assert.equal(ParseResultCode.INPUT_TOO_LARGE, "INPUT_TOO_LARGE");
      assert.equal(ParseResultCode.INVALID_JSON, "INVALID_JSON");
      assert.equal(ParseResultCode.NO_JSON_FOUND, "NO_JSON_FOUND");
    });
  });
});
