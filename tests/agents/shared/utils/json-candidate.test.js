
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  stripThinkingTags,
  extractJsonCandidate,
} from "../../js/agents/shared/utils/json-candidate.js";

describe("shared/utils/json-candidate", () => {
  describe("stripThinkingTags", () => {
    it("strips <think> tags", () => {
      const input = "Before<think>thinking here</think>After";
      const result = stripThinkingTags(input);
      expect(result).toBe("BeforeAfter");
    });

    it("strips multiple <think> tags", () => {
      const input = "<think>first</think>Middle<think>second</think>End";
      const result = stripThinkingTags(input);
      expect(result).toBe("MiddleEnd");
    });

    it("handles case insensitivity", () => {
      const input = "<THINK>content</THINK>rest";
      const result = stripThinkingTags(input);
      expect(result).toBe("rest");
    });

    it("handles multiline content", () => {
      const input = "<think>\nline1\nline2\n</think>result";
      const result = stripThinkingTags(input);
      expect(result).toBe("result");
    });

    it("returns empty string for null", () => {
      expect(stripThinkingTags(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(stripThinkingTags(undefined)).toBe("");
    });

    it("handles no think tags", () => {
      const input = "no tags here";
      expect(stripThinkingTags(input)).toBe("no tags here");
    });
  });

  describe("extractJsonCandidate", () => {
    it("extracts simple object", () => {
      const result = extractJsonCandidate('{"key": "value"}');
      expect(result).toBe('{"key": "value"}');
    });

    it("extracts simple array", () => {
      const result = extractJsonCandidate('[1, 2, 3]');
      expect(result).toBe('[1, 2, 3]');
    });

    it("returns null for empty string", () => {
      expect(extractJsonCandidate("")).toBe(null);
    });

    it("returns null for only whitespace", () => {
      expect(extractJsonCandidate("   ")).toBe(null);
    });

    it("extracts JSON from markdown code block", () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "value"}');
    });

    it("extracts JSON from unmarked code block", () => {
      const input = '```\n{"key": "value"}\n```';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "value"}');
    });

    it("strips json: prefix", () => {
      const input = 'json: {"key": "value"}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "value"}');
    });

    it("strips json prefix without colon", () => {
      const input = 'json {"key": "value"}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "value"}');
    });

    it("handles nested objects", () => {
      const input = '{"outer": {"inner": "value"}}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"outer": {"inner": "value"}}');
    });

    it("handles nested arrays", () => {
      const input = '[[1, 2], [3, 4]]';
      const result = extractJsonCandidate(input);
      expect(result).toBe('[[1, 2], [3, 4]]');
    });

    it("handles mixed nesting", () => {
      const input = '{"arr": [1, 2], "obj": {"a": 1}}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"arr": [1, 2], "obj": {"a": 1}}');
    });

    it("handles strings with escaped quotes", () => {
      const input = '{"key": "value with \\"quotes\\""}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "value with \\"quotes\\""}');
    });

    it("handles strings with escaped backslash", () => {
      const input = '{"key": "value\\\\path"}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "value\\\\path"}');
    });

    it("handles braces inside strings", () => {
      const input = '{"key": "{not a brace}"}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "{not a brace}"}');
    });

    it("handles brackets inside strings", () => {
      const input = '{"key": "[not an array]"}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "[not an array]"}');
    });

    it("strips thinking tags before extraction", () => {
      const input = '<think>reasoning</think>{"key": "value"}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "value"}');
    });

    it("extracts from text with leading noise", () => {
      const input = 'Here is the response: {"key": "value"}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "value"}');
    });

    it("extracts from text with trailing noise", () => {
      const input = '{"key": "value"} is the answer';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"key": "value"}');
    });

    it("prefers array when option set", () => {
      const input = 'obj: {"a": 1} arr: [1, 2]';
      const result = extractJsonCandidate(input, { prefer: "array" });
      expect(result).toBe("[1, 2]");
    });

    it("prefers object when option set", () => {
      const input = 'arr: [1, 2] obj: {"a": 1}';
      const result = extractJsonCandidate(input, { prefer: "object" });
      expect(result).toBe('{"a": 1}');
    });

    it("uses any preference by default (first occurrence)", () => {
      const input = '[1, 2] {"a": 1}';
      const result = extractJsonCandidate(input);
      expect(result).toBe("[1, 2]");
    });

    it("handles unbalanced braces gracefully", () => {
      const input = "{ unclosed";
      const result = extractJsonCandidate(input);
      // Returns raw string when no valid JSON found
      expect(result).toBe("{ unclosed");
    });

    it("handles mismatched braces", () => {
      const input = '{"key": [}]';
      const result = extractJsonCandidate(input);
      // Falls back to returning the string
      expect(result).toBe(input);
    });

    it("normalizes prefer option case", () => {
      const input = '{"a": 1} [1, 2]';
      const result = extractJsonCandidate(input, { prefer: "ARRAY" });
      expect(result).toBe("[1, 2]");
    });

    it("handles prefer option with invalid value", () => {
      const input = '{"a": 1} [1, 2]';
      const result = extractJsonCandidate(input, { prefer: "invalid" });
      // Falls back to "any" behavior
      expect(result).toBe('{"a": 1}');
    });

    it("strips code fence markers only", () => {
      const input = "```json\n[]\n```";
      const result = extractJsonCandidate(input);
      expect(result).toBe("[]");
    });

    it("handles empty after json prefix strip", () => {
      const input = "json:   ";
      const result = extractJsonCandidate(input);
      expect(result).toBe(null);
    });

    it("handles deeply nested structure", () => {
      const input = '{"a": {"b": {"c": {"d": [1, 2, 3]}}}}';
      const result = extractJsonCandidate(input);
      expect(result).toBe('{"a": {"b": {"c": {"d": [1, 2, 3]}}}}');
    });
  });
});
