import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  cryptoRandomHex: vi.fn(),
}));

import { generateId, truncate } from "../../../../../js/agents/plugins/memory/state-engine.utils.js";
import { cryptoRandomHex } from "../../../../../js/agents/shared/index.js";

beforeEach(() => {
  cryptoRandomHex.mockReset();
  cryptoRandomHex.mockReturnValue("abc123");
});

describe("generateId", () => {
  it("builds an id with default prefix, base36 timestamp, and random hex", () => {
    const now = 1700000000000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

    const id = generateId();

    expect(cryptoRandomHex).toHaveBeenCalledTimes(1);
    expect(cryptoRandomHex).toHaveBeenCalledWith(3);
    expect(id).toBe(`id_${now.toString(36)}_abc123`);

    nowSpy.mockRestore();
  });

  it("propagates errors from cryptoRandomHex", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(42);
    cryptoRandomHex.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => generateId("prefix")).toThrow("boom");

    nowSpy.mockRestore();
  });

  it("creates unique ids for simultaneous calls", async () => {
    const now = 4242;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    cryptoRandomHex
      .mockImplementationOnce(() => "aaa111")
      .mockImplementationOnce(() => "bbb222")
      .mockImplementationOnce(() => "ccc333");

    const ids = await Promise.all(
      [1, 2, 3].map(() =>
        Promise.resolve().then(() => generateId("batch"))
      )
    );

    const ts = now.toString(36);
    expect(ids).toEqual([
      `batch_${ts}_aaa111`,
      `batch_${ts}_bbb222`,
      `batch_${ts}_ccc333`,
    ]);
    expect(new Set(ids).size).toBe(3);

    nowSpy.mockRestore();
  });

  it("handles rapid consecutive calls without collisions", () => {
    const now = 9000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    cryptoRandomHex
      .mockImplementationOnce(() => "111111")
      .mockImplementationOnce(() => "222222")
      .mockImplementationOnce(() => "333333")
      .mockImplementationOnce(() => "444444");

    const ids = [
      generateId("fast"),
      generateId("fast"),
      generateId("fast"),
      generateId("fast"),
    ];

    expect(cryptoRandomHex).toHaveBeenCalledTimes(4);
    expect(new Set(ids).size).toBe(4);
    ids.forEach((id) => {
      expect(id.startsWith(`fast_${now.toString(36)}_`)).toBe(true);
    });

    nowSpy.mockRestore();
  });
});

describe("truncate", () => {
  it("returns empty values unchanged", () => {
    const emptyArray = [];

    expect(truncate(null)).toBeNull();
    expect(truncate(undefined)).toBeUndefined();
    expect(truncate("")).toBe("");
    expect(truncate(emptyArray)).toBe(emptyArray);
  });

  it("throws when given a non-sliceable object", () => {
    expect(() => truncate({})).toThrow(TypeError);
  });

  it("truncates text longer than maxLen", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("handles boundary maxLen values", () => {
    expect(truncate("abcdef", 0)).toBe("abc...");
    expect(truncate("abcdef", -1)).toBe("ab...");
  });

  it("handles whitespace-only strings", () => {
    expect(truncate("   ", 2)).toBe("  ...");
  });

  it("coerces numeric maxLen when passed as a string", () => {
    expect(truncate("abcdef", "3")).toBe("...");
  });

  it("truncates very large input", () => {
    const largeText = "a".repeat(1024 * 1024);
    const result = truncate(largeText, 64);

    expect(result).toHaveLength(64);
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns long strings unchanged with MAX_SAFE_INTEGER", () => {
    const longText = "b".repeat(10000);
    const result = truncate(longText, Number.MAX_SAFE_INTEGER);

    expect(result).toBe(longText);
  });

  it("returns deep nested arrays unchanged when within maxLen", () => {
    const deepNested = [[[[["x"]]]]];
    const result = truncate(deepNested, 10);

    expect(result).toBe(deepNested);
  });
});
