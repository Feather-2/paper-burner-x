import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import { formatCodeBlock } from "../../../../../js/agents/prompts/formatters/format-code-block.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

describe("formatCodeBlock", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("formats a code block with a trimmed language", () => {
    const out = formatCodeBlock("const x = 1;", { lang: " js " });
    expect(out).toBe("```js\nconst x = 1;\n```");
  });

  it("omits language when lang is whitespace or non-string", () => {
    expect(formatCodeBlock("x", { lang: "   " })).toBe("```\nx\n```");
    expect(formatCodeBlock("x", { lang: 123 })).toBe("```\nx\n```");
    expect(formatCodeBlock("x", { lang: { lang: "js" } })).toBe("```\nx\n```");
  });

  it("handles null, undefined, and empty values", () => {
    expect(formatCodeBlock(null)).toBe("```\n\n```");
    expect(formatCodeBlock(undefined)).toBe("```\n\n```");
    expect(formatCodeBlock("")).toBe("```\n\n```");
    expect(formatCodeBlock([], { lang: "" })).toBe("```\n\n```");
    expect(formatCodeBlock({}, { lang: "" })).toBe("```\n[object Object]\n```");
  });

  it("handles numeric boundary values and whitespace content", () => {
    expect(formatCodeBlock(0)).toBe("```\n0\n```");
    expect(formatCodeBlock(-1)).toBe("```\n-1\n```");
    expect(formatCodeBlock(Number.MAX_SAFE_INTEGER)).toBe("```\n9007199254740991\n```");
    expect(formatCodeBlock("   ")).toBe("```\n   \n```");
  });

  it("treats numeric strings as strings and array-like objects as objects", () => {
    expect(formatCodeBlock("123")).toBe("```\n123\n```");
    expect(formatCodeBlock(["1", "2"])).toBe("```\n1,2\n```");

    const arrayLike = { 0: "1", 1: "2", length: 2 };
    expect(formatCodeBlock(arrayLike)).toBe("```\n[object Object]\n```");
  });

  it("throws when options is null", () => {
    expect(() => formatCodeBlock("x", null)).toThrow(TypeError);
  });

  it("handles concurrent calls without shared state", async () => {
    const inputs = [
      { value: "a", lang: "js" },
      { value: "b", lang: "ts" },
      { value: "c", lang: "" },
    ];

    const outputs = await Promise.all(
      inputs.map(({ value, lang }) => Promise.resolve().then(() => formatCodeBlock(value, { lang })))
    );

    expect(outputs).toEqual([
      "```js\na\n```",
      "```ts\nb\n```",
      "```\nc\n```"
    ]);
  });

  it("handles rapid successive calls", () => {
    const expected = "```js\nx\n```";
    const results = [];
    for (let i = 0; i < 500; i += 1) {
      results.push(formatCodeBlock("x", { lang: "js" }));
    }

    expect(new Set(results)).toEqual(new Set([expected]));
  });

  it("handles huge file content from an external dependency", () => {
    const prefix = "START-";
    const suffix = "-END";
    const body = "x".repeat(200000);
    const content = `${prefix}${body}${suffix}`;
    readFileSync.mockReturnValue(content);

    const fileContent = readFileSync("/fake/path.txt", "utf8");
    const out = formatCodeBlock(fileContent, { lang: "txt" });

    const prefixLen = "```txt\n".length;
    expect(out.slice(0, prefixLen)).toBe("```txt\n");
    expect(out.slice(prefixLen, prefixLen + prefix.length)).toBe(prefix);
    expect(out.slice(prefixLen + content.length - suffix.length, prefixLen + content.length)).toBe(suffix);
    expect(out.slice(prefixLen + content.length)).toBe("\n```");
    expect(out.length).toBe(content.length + "txt".length + 8);
  });

  it("handles very long strings", () => {
    const longText = "y".repeat(120000);
    const out = formatCodeBlock(longText);

    expect(out.length).toBe(longText.length + 8);
    expect(out.startsWith("```\n")).toBe(true);
    expect(out.endsWith("\n```")).toBe(true);
  });

  it("handles deep nested objects", () => {
    let nested = { level: 0 };
    for (let i = 1; i <= 100; i += 1) {
      nested = { level: i, child: nested };
    }

    const out = formatCodeBlock(nested);
    expect(out).toBe("```\n[object Object]\n```");
  });
});
