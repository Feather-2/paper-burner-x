import { describe, it, expect } from "vitest";

import {
  DEFAULT_FORMATTERS,
  escapeTemplateDelimiters,
  formatBullets,
  formatCodeBlock,
  formatJson,
  formatLines,
  formatTrim,
  formatUpper,
} from '../../../../js/agents/prompts/formatters/index.js';

describe("agents/prompts/formatters", () => {
  describe("escapeTemplateDelimiters", () => {
    it("returns empty string for null/undefined", () => {
      expect(escapeTemplateDelimiters(null)).toBe("");
      expect(escapeTemplateDelimiters(undefined)).toBe("");
    });

    it("escapes {{ and }} with a zero-width break", () => {
      const out = escapeTemplateDelimiters("a {{b}} c");
      expect(out).toBe(`a {\\u200B{b}\\u200B} c`.replaceAll("\\u200B", "\u200B"));
    });

    it("leaves strings without delimiters unchanged", () => {
      expect(escapeTemplateDelimiters("hello")).toBe("hello");
    });
  });

  describe("formatBullets", () => {
    it("formats arrays into bullet lines (skipping empty items)", () => {
      expect(formatBullets(["a", "", null, "b"])).toBe("- a\n- b");
    });

    it("formats newline-separated strings into bullet lines", () => {
      expect(formatBullets("a\nb\n")).toBe("- a\n- b");
    });

    it("formats scalars into a single bullet", () => {
      expect(formatBullets(123)).toBe("- 123");
    });

    it("returns empty string when scalar stringification is empty/whitespace", () => {
      expect(formatBullets({ toString: () => "   " })).toBe("");
    });

    it("returns empty string for null/undefined", () => {
      expect(formatBullets(null)).toBe("");
      expect(formatBullets(undefined)).toBe("");
    });
  });

  describe("formatCodeBlock", () => {
    it("wraps content in fenced code blocks with language", () => {
      expect(formatCodeBlock("x", { lang: "js" })).toBe("```js\nx\n```");
    });

    it("supports empty language", () => {
      expect(formatCodeBlock("x")).toBe("```\nx\n```");
    });

    it("treats non-string lang as empty", () => {
      expect(formatCodeBlock("x", { lang: null })).toBe("```\nx\n```");
    });

    it("treats null content as empty", () => {
      expect(formatCodeBlock(null, { lang: "txt" })).toBe("```txt\n\n```");
    });
  });

  describe("formatJson", () => {
    it("pretty-prints JSON", () => {
      expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
      expect(formatJson({ a: 1 }, { space: 4 })).toBe('{\n    "a": 1\n}');
    });

    it("falls back to String(value) for circular references", () => {
      const obj = {};
      obj.self = obj;
      expect(formatJson(obj)).toBe("[object Object]");
    });

    it("uses a default indentation for non-finite space values", () => {
      expect(formatJson({ a: 1 }, { space: NaN })).toBe('{\n  "a": 1\n}');
    });

    it("normalizes JSON.stringify(undefined) to empty string", () => {
      expect(formatJson(undefined)).toBe("");
    });
  });

  describe("formatLines", () => {
    it("joins arrays with newlines and skips empty items", () => {
      expect(formatLines(["a", " ", "", "b"])).toBe("a\nb");
    });

    it("handles null/undefined items inside arrays", () => {
      expect(formatLines(["a", null, "b", undefined])).toBe("a\nb");
    });

    it("stringifies non-arrays", () => {
      expect(formatLines(0)).toBe("0");
    });

    it("returns empty string for null/undefined", () => {
      expect(formatLines(null)).toBe("");
      expect(formatLines(undefined)).toBe("");
    });
  });

  describe("formatTrim / formatUpper", () => {
    it("normalizes string output", () => {
      expect(formatTrim("  x ")).toBe("x");
      expect(formatUpper("a")).toBe("A");
    });

    it("returns empty string for null/undefined", () => {
      expect(formatTrim(null)).toBe("");
      expect(formatUpper(undefined)).toBe("");
    });
  });

  describe("DEFAULT_FORMATTERS", () => {
    it("provides the expected built-in formatter names", () => {
      expect(Object.keys(DEFAULT_FORMATTERS).sort()).toEqual(
        ["bullets", "code", "json", "lines", "trim", "upper"].sort()
      );
    });

    it("supports formatter arguments via ctx.args", () => {
      expect(DEFAULT_FORMATTERS.code("x", { args: ["js"] })).toBe("```js\nx\n```");
      expect(DEFAULT_FORMATTERS.json({ a: 1 }, { args: ["4"] })).toBe('{\n    "a": 1\n}');
    });

    it("covers remaining built-in formatter helpers", () => {
      expect(DEFAULT_FORMATTERS.code("x")).toBe("```\nx\n```");
      expect(DEFAULT_FORMATTERS.lines(["a", "b"])).toBe("a\nb");
      expect(DEFAULT_FORMATTERS.trim("  x ")).toBe("x");
      expect(DEFAULT_FORMATTERS.upper("a")).toBe("A");
      expect(DEFAULT_FORMATTERS.bullets(["a"], { args: ["ignored"] })).toBe("- a");
    });
  });
});
