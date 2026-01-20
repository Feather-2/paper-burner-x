import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "x".repeat(5000)),
}));

import {
  toNonEmptyString,
  normalizeKeywords,
  truncate,
  getSummary,
  isMissingPathError,
  validateRunId,
} from "../../../../../../js/agents/plugins/memory/l3-storage/utils.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toNonEmptyString", () => {
  it("trims and returns non-empty strings", () => {
    expect(toNonEmptyString("  hello ")).toBe("hello");
  });

  it("returns null for empty, whitespace, or non-string values", () => {
    expect(toNonEmptyString("")).toBeNull();
    expect(toNonEmptyString("   ")).toBeNull();
    expect(toNonEmptyString(null)).toBeNull();
    expect(toNonEmptyString(undefined)).toBeNull();
    expect(toNonEmptyString(0)).toBeNull();
    expect(toNonEmptyString(-1)).toBeNull();
    expect(toNonEmptyString(Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(toNonEmptyString({})).toBeNull();
  });

  it("handles concurrent calls consistently", async () => {
    const values = [" a ", "b", "   ", null];
    const results = await Promise.all(values.map((value) => Promise.resolve(toNonEmptyString(value))));

    expect(results).toEqual(["a", "b", null, null]);
  });
});

describe("normalizeKeywords", () => {
  it("normalizes strings, de-dupes, and skips blanks/non-strings", () => {
    const input = [" Foo ", "foo", "BAR", "  ", "", null, 123, "BaR"];

    expect(normalizeKeywords(input)).toEqual(["foo", "bar"]);
  });

  it("returns empty array for empty or non-array input", () => {
    expect(normalizeKeywords([])).toEqual([]);
    expect(normalizeKeywords({})).toEqual([]);
  });

  it("remains isolated across concurrent calls", async () => {
    const calls = [
      ["Apple", "apple", "banana"],
      ["BANANA", "cherry", "cherry", "  "],
    ];

    const results = await Promise.all(calls.map((list) => Promise.resolve(normalizeKeywords(list))));

    expect(results).toEqual([
      ["apple", "banana"],
      ["banana", "cherry"],
    ]);
  });
});

describe("truncate", () => {
  it("returns empty string when maxLen is invalid or non-positive", () => {
    expect(truncate("abc", 0)).toBe("");
    expect(truncate("abc", -1)).toBe("");
    expect(truncate("abc", "2")).toBe("");
  });

  it("stringifies non-string input and respects maxLen flooring", () => {
    expect(truncate(12345, 3.7)).toBe("123");
    expect(truncate(null, 3)).toBe("");
    expect(truncate("abc", Number.MAX_SAFE_INTEGER)).toBe("abc");
  });

  it("truncates large content such as file data", () => {
    const huge = readFileSync("/tmp/huge.txt", "utf8");
    const result = truncate(huge, 200);

    expect(readFileSync).toHaveBeenCalledWith("/tmp/huge.txt", "utf8");
    expect(result.length).toBe(200);
    expect(result).toBe(huge.slice(0, 200));
  });

  it("handles rapid consecutive calls without shared state", () => {
    const outputs = [1, 2, 3, 4, 5].map((len) => truncate("abcdef", len));

    expect(outputs).toEqual(["a", "ab", "abc", "abcd", "abcde"]);
  });
});

describe("getSummary", () => {
  it("returns trimmed summary when present", () => {
    expect(getSummary({ summary: "  Quick note  " })).toBe("Quick note");
  });

  it("truncates long string input to 200 characters", () => {
    const longText = "a".repeat(250);

    expect(getSummary(longText)).toBe("a".repeat(200));
  });

  it("handles null, undefined, and empty object inputs", () => {
    expect(getSummary(null)).toBe("null");
    expect(getSummary(undefined)).toBe("");
    expect(getSummary({})).toBe("{}");
  });

  it("stringifies objects and truncates deeply nested data", () => {
    const root = { level: 0, payload: "x".repeat(500) };
    let node = root;
    for (let i = 1; i <= 20; i++) {
      node.child = { level: i };
      node = node.child;
    }

    const summary = getSummary(root);

    expect(summary.length).toBe(200);
    expect(summary.startsWith("{")).toBe(true);
  });

  it("falls back to String() when JSON.stringify throws", () => {
    const circular = {};
    circular.self = circular;

    expect(getSummary(circular)).toBe("[object Object]");
  });
});

describe("isMissingPathError", () => {
  it("detects missing path errors from message content", () => {
    expect(isMissingPathError(new Error("ENOENT: no such file or directory"))).toBe(true);
    expect(isMissingPathError({ message: "NotFoundError: missing resource" })).toBe(true);
    expect(isMissingPathError("NOT_FOUND: missing path")).toBe(true);
  });

  it("returns false for unrelated or empty errors", () => {
    expect(isMissingPathError(new Error("EACCES: permission denied"))).toBe(false);
    expect(isMissingPathError("not_found")).toBe(false);
    expect(isMissingPathError(null)).toBe(false);
    expect(isMissingPathError(undefined)).toBe(false);
  });
});

describe("validateRunId", () => {
  it("returns trimmed id for valid input", () => {
    expect(validateRunId("  run_123  ")).toBe("run_123");
  });

  it("throws when runId is missing or not a string", () => {
    expect(() => validateRunId(null)).toThrow("L3Storage requires { runId }");
    expect(() => validateRunId(undefined)).toThrow("L3Storage requires { runId }");
    expect(() => validateRunId("")).toThrow("L3Storage requires { runId }");
    expect(() => validateRunId("   ")).toThrow("L3Storage requires { runId }");
    expect(() => validateRunId(0)).toThrow("L3Storage requires { runId }");
    expect(() => validateRunId(Number.MAX_SAFE_INTEGER)).toThrow("L3Storage requires { runId }");
  });

  it("throws on path traversal characters", () => {
    expect(() => validateRunId("../escape")).toThrow(
      "L3Storage runId contains invalid characters (path traversal attempt)"
    );
    expect(() => validateRunId("run/escape")).toThrow(
      "L3Storage runId contains invalid characters (path traversal attempt)"
    );
    expect(() => validateRunId("run\\escape")).toThrow(
      "L3Storage runId contains invalid characters (path traversal attempt)"
    );
  });
});
