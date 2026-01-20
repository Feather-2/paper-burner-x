import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";

import { formatJson } from "../../../../../js/agents/prompts/formatters/format-json.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formatJson", () => {
  it("pretty-prints JSON with default and explicit spacing", () => {
    expect(formatJson({ a: 1, b: 2 })).toBe("{\n  \"a\": 1,\n  \"b\": 2\n}");
    expect(formatJson([1, 2], { space: 4 })).toBe("[\n    1,\n    2\n]");
  });

  it("handles empty values", () => {
    expect(formatJson(null)).toBe("null");
    expect(formatJson(undefined)).toBe("");
    expect(formatJson("")).toBe("\"\"");
    expect(formatJson([])).toBe("[]");
    expect(formatJson({})).toBe("{}");
  });

  it("serializes boundary numeric and whitespace values", () => {
    expect(formatJson(0)).toBe("0");
    expect(formatJson(-1)).toBe("-1");
    expect(formatJson(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(formatJson("   ")).toBe("\"   \"");
  });

  it("normalizes space options for string, fractional, and non-finite inputs", () => {
    expect(formatJson({ a: 1 }, { space: -1 })).toBe("{\"a\":1}");
    expect(formatJson({ a: 1 }, { space: 1.9 })).toBe("{\n \"a\": 1\n}");
    expect(formatJson({ a: 1 }, { space: NaN })).toBe("{\n  \"a\": 1\n}");
    expect(formatJson({ a: 1 }, { space: "4" })).toBe("{\n  \"a\": 1\n}");
  });

  it("treats array-like objects as plain objects", () => {
    const arrayLike = { 0: "x", length: 1 };
    const out = formatJson(arrayLike);
    const parsed = JSON.parse(out);

    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed).toEqual({ 0: "x", length: 1 });
  });

  it("falls back to String(value) and calls onError on serialization failures", () => {
    const obj = {};
    obj.self = obj;
    const onError = vi.fn();

    const out = formatJson(obj, { onError });

    expect(out).toBe("[object Object]");
    expect(onError).toHaveBeenCalledTimes(1);
    const [err, value] = onError.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(value).toBe(obj);
  });

  it("ignores onError failures while still returning fallback output", () => {
    const onError = vi.fn(() => {
      throw new Error("callback boom");
    });

    const out = formatJson(10n, { onError });

    expect(out).toBe("10");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("handles concurrent calls without shared state", async () => {
    const values = [{ a: 1 }, [1, 2], "x", 0];
    const results = await Promise.all(
      values.map((value) => Promise.resolve().then(() => formatJson(value)))
    );

    expect(results).toEqual([
      "{\n  \"a\": 1\n}",
      "[\n  1,\n  2\n]",
      "\"x\"",
      "0",
    ]);
  });

  it("handles rapid consecutive calls with different spacing", () => {
    const outputs = [];
    for (let i = 0; i < 20; i += 1) {
      outputs.push(formatJson({ i }, { space: i % 2 }));
    }

    expect(outputs[0]).toBe("{\"i\":0}");
    expect(outputs[1]).toBe("{\n \"i\": 1\n}");
    outputs.forEach((output, index) => {
      expect(JSON.parse(output)).toEqual({ i: index });
    });
  });

  it("handles huge file content input", () => {
    const hugeContent = "a".repeat(250_000);
    mockedFs.readFileSync.mockReturnValueOnce(hugeContent);

    const fileContent = fs.readFileSync("/fake/large.txt", "utf8");
    const out = formatJson(fileContent);

    expect(out.length).toBe(hugeContent.length + 2);
    expect(out.startsWith("\"")).toBe(true);
    expect(out.endsWith("\"")).toBe(true);
  });

  it("handles very long strings", () => {
    const longString = "b".repeat(120_000);
    const out = formatJson(longString);

    expect(out.length).toBe(longString.length + 2);
    expect(out.slice(1, 6)).toBe("bbbbb");
  });

  it("handles deep nesting without losing data", () => {
    const root = { level: 0 };
    let current = root;
    for (let i = 1; i <= 50; i += 1) {
      current.next = { level: i };
      current = current.next;
    }

    const out = formatJson(root);
    const parsed = JSON.parse(out);

    let node = parsed;
    for (let i = 0; i <= 50; i += 1) {
      expect(node.level).toBe(i);
      node = node.next;
    }
  });
});
