import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  stripThinkingTags,
  extractJsonCandidate,
} from "../../js/agents/shared/utils/json-candidate.js";

describe("shared/utils/json-candidate", () => {
  describe("stripThinkingTags", () => {
    it("strips <think> tags", () => {
      const input = "Before<think>thinking here</think>After";
      const result = stripThinkingTags(input);
      assert.equal(result, "BeforeAfter");
    });

    it("strips multiple <think> tags", () => {
      const input = "<think>first</think>Middle<think>second</think>End";
      const result = stripThinkingTags(input);
      assert.equal(result, "MiddleEnd");
    });

    it("handles case insensitivity", () => {
      const input = "<THINK>content</THINK>rest";
      const result = stripThinkingTags(input);
      assert.equal(result, "rest");
    });

    it("handles multiline content", () => {
      const input = "<think>\nline1\nline2\n</think>result";
      const result = stripThinkingTags(input);
      assert.equal(result, "result");
    });

    it("returns empty string for null", () => {
      assert.equal(stripThinkingTags(null), "");
    });

    it("returns empty string for undefined", () => {
      assert.equal(stripThinkingTags(undefined), "");
    });

    it("handles no think tags", () => {
      const input = "no tags here";
      assert.equal(stripThinkingTags(input), "no tags here");
    });
  });

  describe("extractJsonCandidate", () => {
    it("extracts simple object", () => {
      const result = extractJsonCandidate('{"key": "value"}');
      assert.equal(result, '{"key": "value"}');
    });

    it("extracts simple array", () => {
      const result = extractJsonCandidate('[1, 2, 3]');
      assert.equal(result, '[1, 2, 3]');
    });

    it("returns null for empty string", () => {
      assert.equal(extractJsonCandidate(""), null);
    });

    it("returns null for only whitespace", () => {
      assert.equal(extractJsonCandidate("   "), null);
    });

    it("extracts JSON from markdown code block", () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "value"}');
    });

    it("extracts JSON from unmarked code block", () => {
      const input = '```\n{"key": "value"}\n```';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "value"}');
    });

    it("strips json: prefix", () => {
      const input = 'json: {"key": "value"}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "value"}');
    });

    it("strips json prefix without colon", () => {
      const input = 'json {"key": "value"}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "value"}');
    });

    it("handles nested objects", () => {
      const input = '{"outer": {"inner": "value"}}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"outer": {"inner": "value"}}');
    });

    it("handles nested arrays", () => {
      const input = '[[1, 2], [3, 4]]';
      const result = extractJsonCandidate(input);
      assert.equal(result, '[[1, 2], [3, 4]]');
    });

    it("handles mixed nesting", () => {
      const input = '{"arr": [1, 2], "obj": {"a": 1}}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"arr": [1, 2], "obj": {"a": 1}}');
    });

    it("handles strings with escaped quotes", () => {
      const input = '{"key": "value with \\"quotes\\""}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "value with \\"quotes\\""}');
    });

    it("handles strings with escaped backslash", () => {
      const input = '{"key": "value\\\\path"}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "value\\\\path"}');
    });

    it("handles braces inside strings", () => {
      const input = '{"key": "{not a brace}"}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "{not a brace}"}');
    });

    it("handles brackets inside strings", () => {
      const input = '{"key": "[not an array]"}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "[not an array]"}');
    });

    it("strips thinking tags before extraction", () => {
      const input = '<think>reasoning</think>{"key": "value"}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "value"}');
    });

    it("extracts from text with leading noise", () => {
      const input = 'Here is the response: {"key": "value"}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "value"}');
    });

    it("extracts from text with trailing noise", () => {
      const input = '{"key": "value"} is the answer';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"key": "value"}');
    });

    it("prefers array when option set", () => {
      const input = 'obj: {"a": 1} arr: [1, 2]';
      const result = extractJsonCandidate(input, { prefer: "array" });
      assert.equal(result, "[1, 2]");
    });

    it("prefers object when option set", () => {
      const input = 'arr: [1, 2] obj: {"a": 1}';
      const result = extractJsonCandidate(input, { prefer: "object" });
      assert.equal(result, '{"a": 1}');
    });

    it("uses any preference by default (first occurrence)", () => {
      const input = '[1, 2] {"a": 1}';
      const result = extractJsonCandidate(input);
      assert.equal(result, "[1, 2]");
    });

    it("handles unbalanced braces gracefully", () => {
      const input = "{ unclosed";
      const result = extractJsonCandidate(input);
      // Returns raw string when no valid JSON found
      assert.equal(result, "{ unclosed");
    });

    it("handles mismatched braces", () => {
      const input = '{"key": [}]';
      const result = extractJsonCandidate(input);
      // Falls back to returning the string
      assert.ok(result);
    });

    it("normalizes prefer option case", () => {
      const input = '{"a": 1} [1, 2]';
      const result = extractJsonCandidate(input, { prefer: "ARRAY" });
      assert.equal(result, "[1, 2]");
    });

    it("handles prefer option with invalid value", () => {
      const input = '{"a": 1} [1, 2]';
      const result = extractJsonCandidate(input, { prefer: "invalid" });
      // Falls back to "any" behavior
      assert.equal(result, '{"a": 1}');
    });

    it("strips code fence markers only", () => {
      const input = "```json\n[]\n```";
      const result = extractJsonCandidate(input);
      assert.equal(result, "[]");
    });

    it("handles empty after json prefix strip", () => {
      const input = "json:   ";
      const result = extractJsonCandidate(input);
      assert.equal(result, null);
    });

    it("handles deeply nested structure", () => {
      const input = '{"a": {"b": {"c": {"d": [1, 2, 3]}}}}';
      const result = extractJsonCandidate(input);
      assert.equal(result, '{"a": {"b": {"c": {"d": [1, 2, 3]}}}}');
    });
  });
});
