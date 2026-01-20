import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedFs = vi.hoisted(() => ({
  readFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: mockedFs.readFileSync,
}));

import { readFileSync } from "node:fs";

import {
  isPotentiallyDangerous,
  createSafeRegex,
  safeMatch,
  globToRegex,
} from "../../../../../js/agents/shared/utils/safe-regex.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockedFs.readFileSync.mockReset();
});

describe("isPotentiallyDangerous", () => {
  it("returns false for empty, whitespace, and non-string inputs", () => {
    const inputs = [null, undefined, "", "   ", [], {}, 0, -1, Number.MAX_SAFE_INTEGER];

    for (const value of inputs) {
      expect(isPotentiallyDangerous(value)).toBe(false);
    }
  });

  it("returns true for patterns exceeding max length", () => {
    const longPattern = "a".repeat(1001);
    expect(isPotentiallyDangerous(longPattern)).toBe(true);
  });

  it("detects nested quantifiers", () => {
    expect(isPotentiallyDangerous("(a+)+")).toBe(true);
  });

  it("detects repeated alternation", () => {
    expect(isPotentiallyDangerous("(a|ab)*")).toBe(true);
  });

  it("detects many alternation groups", () => {
    expect(isPotentiallyDangerous("(a|b)(c|d)(e|f)")).toBe(true);
  });

  it("detects nested repetition ranges", () => {
    expect(isPotentiallyDangerous("a{1,2}{3,4}")).toBe(true);
  });

  it("returns false for safe patterns", () => {
    expect(isPotentiallyDangerous("^[a-z]+$")).toBe(false);
  });

  it("handles concurrent checks consistently", async () => {
    const patterns = ["simple", "(a+)+", "(a|ab)*", "a{1,2}{3,4}"];
    const results = await Promise.all(
      patterns.map((pattern) => Promise.resolve(isPotentiallyDangerous(pattern))),
    );

    expect(results).toEqual([false, true, true, true]);
  });
});

describe("createSafeRegex", () => {
  it("creates regex with default flags for safe patterns", () => {
    const regex = createSafeRegex("hello\\s+world");

    expect(regex).toBeInstanceOf(RegExp);
    expect(regex.source).toBe("hello\\s+world");
    expect(regex.flags.includes("g")).toBe(true);
    expect(regex.flags.includes("u")).toBe(true);
  });

  it("honors explicit flags", () => {
    const regex = createSafeRegex("test", "im");

    expect(regex.flags.includes("i")).toBe(true);
    expect(regex.flags.includes("m")).toBe(true);
    expect(regex.flags.includes("g")).toBe(false);
  });

  it("throws for potentially dangerous patterns", () => {
    expect(() => createSafeRegex("(a+)+")).toThrow(
      "RegExp pattern exceeds complexity limits (Potential ReDoS)",
    );
  });

  it("throws for patterns exceeding max length", () => {
    const longPattern = "a".repeat(1001);
    expect(() => createSafeRegex(longPattern)).toThrow(/Potential ReDoS/);
  });

  it("throws for invalid regex syntax", () => {
    expect(() => createSafeRegex("(")).toThrow(/Invalid RegExp/);
  });

  it("accepts numeric boundary patterns", () => {
    const values = [0, -1, Number.MAX_SAFE_INTEGER];

    for (const value of values) {
      const regex = createSafeRegex(value);
      expect(regex.test(String(value))).toBe(true);
    }
  });
});

describe("safeMatch", () => {
  it("returns a match array for matching text", () => {
    const result = safeMatch("hello world", /world/);

    expect(result).toBeInstanceOf(Array);
    expect(result?.[0]).toBe("world");
  });

  it("returns null for non-matching text", () => {
    expect(safeMatch("hello", /world/)).toBe(null);
  });

  it("coerces empty values to strings", () => {
    expect(safeMatch(null, /a/)).toBe(null);
    expect(safeMatch(undefined, /a/)).toBe(null);
    expect(safeMatch("", /a/)).toBe(null);
    expect(safeMatch([], /a/)).toBe(null);

    const objectMatch = safeMatch({}, /\[object Object\]/);
    expect(objectMatch?.[0]).toBe("[object Object]");
  });

  it("matches numeric boundary values", () => {
    expect(safeMatch(0, /0/)?.[0]).toBe("0");
    expect(safeMatch(-1, /-1/)?.[0]).toBe("-1");

    const maxSafe = Number.MAX_SAFE_INTEGER;
    const maxMatch = safeMatch(maxSafe, new RegExp(String(maxSafe)));
    expect(maxMatch?.[0]).toBe(String(maxSafe));
  });

  it("ignores timeout even when passed as a string", () => {
    const result = safeMatch("value", /value/, "100");
    expect(result?.[0]).toBe("value");
  });

  it("handles large file-like input", () => {
    const largeContent = "a".repeat(200000) + "END";
    mockedFs.readFileSync.mockReturnValue(largeContent);

    const text = readFileSync("/fake/large.txt", "utf8");
    const result = safeMatch(text, /END$/);

    expect(result?.[0]).toBe("END");
  });

  it("supports concurrent and rapid consecutive calls", async () => {
    const regex = /a/;
    const concurrent = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(safeMatch("a", regex))),
    );

    expect(concurrent.every((match) => Array.isArray(match))).toBe(true);

    const rapid = [];
    for (let i = 0; i < 20; i += 1) {
      rapid.push(safeMatch("a", regex)?.[0]);
    }

    expect(rapid).toEqual(Array.from({ length: 20 }, () => "a"));
  });
});

describe("globToRegex", () => {
  it("converts * to avoid matching nested path segments", () => {
    const regex = globToRegex("src/*.js");

    expect(regex.test("src/file.js")).toBe(true);
    expect(regex.test("src/nested/file.js")).toBe(false);
  });

  it("supports ** across path separators", () => {
    const regex = globToRegex("src/**/file?.txt");

    expect(regex.test("src/a/b/file1.txt")).toBe(true);
  });

  it("supports ? for single characters", () => {
    const regex = globToRegex("file?.txt");

    expect(regex.test("file1.txt")).toBe(true);
    expect(regex.test("file10.txt")).toBe(false);
  });

  it("escapes regex metacharacters", () => {
    const regex = globToRegex("file.name+test");

    expect(regex.test("file.name+test")).toBe(true);
    expect(regex.test("fileXname+test")).toBe(false);
  });

  it("falls back to '*' for empty or non-string inputs", () => {
    const inputs = [null, undefined, "", [], {}, { 0: "a", length: 1 }];

    for (const input of inputs) {
      const regex = globToRegex(input);
      expect(regex.test("anything")).toBe(true);
    }
  });

  it("treats whitespace-only patterns as literal", () => {
    const regex = globToRegex("   ");

    expect(regex.test("   ")).toBe(true);
    expect(regex.test("x")).toBe(false);
  });

  it("matches deep nested path patterns", () => {
    const depth = 30;
    const prefix = Array.from({ length: depth }, (_, index) => `dir${index}`).join("/");
    const regex = globToRegex(`${prefix}/**/file.txt`);

    expect(regex.test(`${prefix}/a/b/file.txt`)).toBe(true);
  });
});
