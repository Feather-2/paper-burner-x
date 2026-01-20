// Tests for formatUpper in js/agents/prompts/formatters/format-upper.js.
// Covers nullish inputs, boundary values, type edges, concurrency, and resource limits.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EOL } from "node:os";
import { formatUpper } from "../../../../../js/agents/prompts/formatters/format-upper.js";

vi.mock("node:os", () => ({ EOL: "\n" }));

describe("formatUpper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string for nullish values", () => {
    expect(formatUpper(null)).toBe("");
    expect(formatUpper(undefined)).toBe("");
  });

  it("handles empty string and empty array", () => {
    expect(formatUpper("")).toBe("");
    expect(formatUpper([])).toBe("");
  });

  it("uppercases normal strings", () => {
    expect(formatUpper("hello")).toBe("HELLO");
    expect(formatUpper("Hello World")).toBe("HELLO WORLD");
  });

  it("handles whitespace-only strings", () => {
    const whitespace = `${EOL}\t  `;
    expect(formatUpper(whitespace)).toBe(whitespace);
  });

  it("handles numeric boundary values", () => {
    expect(formatUpper(0)).toBe("0");
    expect(formatUpper(-1)).toBe("-1");
    expect(formatUpper(Number.MAX_SAFE_INTEGER)).toBe(
      String(Number.MAX_SAFE_INTEGER),
    );
  });

  it("handles type boundaries for numeric strings and array-like objects", () => {
    expect(formatUpper("123")).toBe("123");
    const arrayLike = {
      0: "a",
      1: "b",
      length: 2,
      join: Array.prototype.join,
      toString: Array.prototype.toString,
    };
    expect(formatUpper(arrayLike)).toBe("A,B");
  });

  it("handles empty object input", () => {
    expect(formatUpper({})).toBe("[OBJECT OBJECT]");
  });

  it("handles arrays with mixed values", () => {
    expect(formatUpper(["a", "b", 1])).toBe("A,B,1");
  });

  it("throws when toString throws", () => {
    const bad = {
      toString() {
        throw new Error("boom");
      },
    };
    expect(() => formatUpper(bad)).toThrow("boom");
  });

  it("handles concurrent calls consistently", async () => {
    const values = ["a", "b", "c", 1, null, "MiXeD"];
    const expected = values.map((value) =>
      value == null ? "" : String(value).toUpperCase(),
    );
    const results = await Promise.all(
      values.map((value) => Promise.resolve().then(() => formatUpper(value))),
    );
    expect(results).toEqual(expected);
  });

  it("handles rapid consecutive calls without shared state", () => {
    let result = "";
    for (let i = 0; i < 1000; i += 1) {
      result = formatUpper(`v${i}`);
    }
    expect(result).toBe("V999");
  });

  it("handles very long strings", () => {
    const input = "a".repeat(200000);
    const result = formatUpper(input);
    expect(result.length).toBe(input.length);
    expect(result.slice(0, 5)).toBe("AAAAA");
    expect(result.slice(-5)).toBe("AAAAA");
  });

  it("handles huge buffer-like input", () => {
    const buffer = Buffer.alloc(256 * 1024, "b");
    const result = formatUpper(buffer);
    expect(result.length).toBe(buffer.length);
    expect(result.slice(0, 4)).toBe("BBBB");
    expect(result.slice(-4)).toBe("BBBB");
  });

  it("handles deep nested arrays", () => {
    let nested = "x";
    for (let i = 0; i < 200; i += 1) {
      nested = [nested];
    }
    expect(formatUpper(nested)).toBe("X");
  });
});
