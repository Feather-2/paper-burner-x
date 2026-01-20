import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn((size) => Buffer.alloc(size, 0x61)),
}));

import { randomBytes } from "node:crypto";
import {
  stripThinkingTags,
  extractJsonCandidate,
  default as jsonCandidateDefault,
} from "../../../../../js/agents/shared/utils/json-candidate.js";

beforeEach(() => {
  vi.clearAllMocks();
});

const buildLargeNoise = (size) => randomBytes(size).toString("hex");
const buildDeepNestedArray = (depth) => `${"[".repeat(depth)}0${"]".repeat(depth)}`;

describe("stripThinkingTags", () => {
  it("strips think blocks and trims output", () => {
    const input = "  start <think>secret\nline</think> end  ";
    expect(stripThinkingTags(input)).toBe("start  end");
  });

  it("removes multiple tags with mixed case", () => {
    const input = "A<Think>1</Think>B<THINK>2</THINK>C";
    expect(stripThinkingTags(input)).toBe("ABC");
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["   \n\t"],
    [[]],
  ])("returns empty string for %p", (input) => {
    expect(stripThinkingTags(input)).toBe("");
  });

  it("treats numeric 0 as empty input", () => {
    expect(stripThinkingTags(0)).toBe("");
  });

  it.each([
    [-1, "-1"],
    [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)],
    [{}, "[object Object]"],
    ["123", "123"],
  ])("stringifies %p", (input, expected) => {
    expect(stripThinkingTags(input)).toBe(expected);
  });

  it("leaves unterminated tags untouched", () => {
    const input = "start <think>no end";
    expect(stripThinkingTags(input)).toBe("start <think>no end");
  });
});

describe("extractJsonCandidate", () => {
  it.each([
    [null],
    [undefined],
    [""],
    ["   \n\t"],
    [[]],
  ])("returns null for empty input %p", (input) => {
    expect(extractJsonCandidate(input)).toBeNull();
  });

  it("treats numeric 0 as empty input", () => {
    expect(extractJsonCandidate(0)).toBeNull();
  });

  it.each([
    [-1, "-1"],
    [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)],
    ["123", "123"],
  ])("returns string for primitive input %p", (input, expected) => {
    expect(extractJsonCandidate(input)).toBe(expected);
  });

  it("returns stringified empty object input", () => {
    expect(extractJsonCandidate({})).toBe("[object Object]");
  });

  it("extracts JSON from fenced code block", () => {
    const input = "noise\n```json\n{\"a\":1}\n```\nmore";
    expect(extractJsonCandidate(input)).toBe("{\"a\":1}");
  });

  it.each([
    ["json with colon", "json:\n{\"a\":1}"],
    ["json without colon", "json {\"a\":1}"],
  ])("strips %s prefix", (_label, input) => {
    expect(extractJsonCandidate(input)).toBe("{\"a\":1}");
  });

  it("removes think tags before extraction", () => {
    const input = "<think>ignore me</think>\n{\"a\":1}";
    expect(extractJsonCandidate(input)).toBe("{\"a\":1}");
  });

  it("prefers earliest candidate when prefer is any", () => {
    const input = "prefix [1,2] middle {\"a\":1} tail";
    expect(extractJsonCandidate(input)).toBe("[1,2]");
  });

  it("prefers arrays when prefer is array", () => {
    const input = "{\"a\":1} [1,2]";
    expect(extractJsonCandidate(input, { prefer: "ARRAY" })).toBe("[1,2]");
  });

  it("prefers objects when prefer is object", () => {
    const input = "[1] {\"a\":1}";
    expect(extractJsonCandidate(input, { prefer: "object" })).toBe("{\"a\":1}");
  });

  it("falls back to next candidate when first is invalid", () => {
    const input = "{'a':1} [1]";
    expect(extractJsonCandidate(input, { prefer: "object" })).toBe("[1]");
  });

  it("ignores braces inside strings", () => {
    const input = "prefix {\"text\":\"} [ ]\"} suffix";
    expect(extractJsonCandidate(input)).toBe("{\"text\":\"} [ ]\"}");
  });

  it.each([
    ["unclosed object", "{", "{"],
    ["invalid JSON", "prefix {oops} suffix", "prefix {oops} suffix"],
  ])("returns cleaned string when no parsable candidate (%s)", (_label, input, expected) => {
    expect(extractJsonCandidate(input)).toBe(expected);
  });

  it("accepts array as options parameter", () => {
    expect(extractJsonCandidate("{\"a\":1}", [])).toBe("{\"a\":1}");
  });

  it("handles large input with embedded JSON", () => {
    const noise = buildLargeNoise(100000);
    const input = `${noise}\n{\"ok\":true}\n${noise}`;
    const result = extractJsonCandidate(input);
    expect(result).toBe("{\"ok\":true}");
    expect(randomBytes).toHaveBeenCalledWith(100000);
  });

  it("handles deeply nested arrays", () => {
    const deep = buildDeepNestedArray(200);
    const input = `prefix ${deep} suffix`;
    expect(extractJsonCandidate(input, { prefer: "array" })).toBe(deep);
  });

  it("handles concurrent calls safely", async () => {
    const inputs = [
      { text: "{\"a\":1}" },
      { text: "json [1,2]", options: { prefer: "array" } },
      { text: "<think>x</think>{\"b\":2}" },
      { text: "  " },
      { text: "no json here" },
    ];

    const results = await Promise.all(
      inputs.map((item) => Promise.resolve().then(() => extractJsonCandidate(item.text, item.options)))
    );

    expect(results).toEqual(["{\"a\":1}", "[1,2]", "{\"b\":2}", null, "no json here"]);
  });

  it("handles rapid sequential calls", () => {
    const input = "prefix {\"i\":1} suffix";
    const outputs = Array.from({ length: 50 }, () => extractJsonCandidate(input));
    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toBe("{\"i\":1}");
  });
});

describe("default export", () => {
  it("exposes the named utilities", () => {
    expect(jsonCandidateDefault.stripThinkingTags).toBe(stripThinkingTags);
    expect(jsonCandidateDefault.extractJsonCandidate).toBe(extractJsonCandidate);
  });
});
