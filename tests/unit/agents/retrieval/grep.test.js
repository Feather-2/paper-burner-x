import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isPlainObject: vi.fn(),
  toPositiveInt: vi.fn(),
  createSafeRegex: vi.fn(),
  isPotentiallyDangerous: vi.fn(),
}));

import { grepChunks, grepChunksAsync } from "../../../../js/agents/retrieval/grep.js";
import {
  isPlainObject,
  toPositiveInt,
  createSafeRegex,
  isPotentiallyDangerous,
} from "../../../../js/agents/shared/index.js";

beforeEach(() => {
  vi.clearAllMocks();
  isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
  toPositiveInt.mockImplementation((value, fallback) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
  });
  createSafeRegex.mockImplementation((src, flags) => new RegExp(src, flags));
  isPotentiallyDangerous.mockImplementation(() => false);
});

describe("grepChunks", () => {
  it("throws on non-array chunks (null/undefined/object)", () => {
    expect(() => grepChunks(null, "a")).toThrow(/chunks must be an array/);
    expect(() => grepChunks(undefined, "a")).toThrow(/chunks must be an array/);
    expect(() => grepChunks({ 0: "a" }, "a")).toThrow(/chunks must be an array/);
  });

  it("throws on non-object options (null/array/string)", () => {
    expect(() => grepChunks([], "a", null)).toThrow(/options must be an object/);
    expect(() => grepChunks([], "a", [])).toThrow(/options must be an object/);
    expect(() => grepChunks([], "a", "bad")).toThrow(/options must be an object/);
  });

  it("returns empty results for empty chunks or empty pattern", () => {
    expect(grepChunks([], "a")).toEqual([]);
    expect(grepChunks([{ chunkId: "c1", text: "abc" }], "")).toEqual([]);
    expect(grepChunks([{ chunkId: "c1", text: "abc" }], undefined)).toEqual([]);
    expect(grepChunks([], "", {})).toEqual([]);
  });

  it("matches literals case-insensitively by default and finds whitespace spans", () => {
    const spaceOut = grepChunks([{ chunkId: "c1", text: "A b  c" }], " ");
    expect(spaceOut[0].chunkId).toBe("c1");
    expect(spaceOut[0].spans).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 4, end: 5 },
    ]);

    const helloOut = grepChunks([{ chunkId: "c2", text: "hello" }], "HELLO");
    expect(helloOut[0].matchCount).toBe(1);
  });

  it("respects caseSensitive for literal search", () => {
    const out = grepChunks([{ chunkId: "c1", text: "hello" }], "HELLO", {
      caseSensitive: true,
    });
    expect(out).toEqual([]);
  });

  it("normalizes maxMatchesPerChunk for string/zero/negative/max-safe", () => {
    const chunks = [{ chunkId: "c1", text: "aaaa" }];

    const stringOut = grepChunks(chunks, "a", { maxMatchesPerChunk: "2" });
    expect(stringOut[0].matchCount).toBe(2);

    const zeroOut = grepChunks(chunks, "a", { maxMatchesPerChunk: 0 });
    expect(zeroOut[0].matchCount).toBe(4);

    const negativeOut = grepChunks(chunks, "a", { maxMatchesPerChunk: -1 });
    expect(negativeOut[0].matchCount).toBe(4);

    const maxSafeOut = grepChunks(chunks, "a", {
      maxMatchesPerChunk: Number.MAX_SAFE_INTEGER,
    });
    expect(maxSafeOut[0].matchCount).toBe(4);
  });

  it("uses createSafeRegex for string patterns when regex option is true", () => {
    const out = grepChunks([{ chunkId: "c1", text: "aA" }], "a", { regex: true });
    expect(createSafeRegex).toHaveBeenCalledWith("a", "giu");
    expect(out[0].matchCount).toBe(2);
  });

  it("adds global flag and toggles case sensitivity for RegExp patterns", () => {
    const out = grepChunks([{ chunkId: "c1", text: "aa" }], /a/);
    expect(out[0].matchCount).toBe(2);

    const caseSensitiveOut = grepChunks([{ chunkId: "c2", text: "A" }], /a/i, {
      caseSensitive: true,
    });
    expect(caseSensitiveOut).toEqual([]);
  });

  it("handles empty regex matches without infinite loops and respects maxMatchesPerChunk", () => {
    const out = grepChunks([{ chunkId: "c1", text: "abc" }], /(?:)/, {
      maxMatchesPerChunk: 3,
    });
    expect(out[0].spans).toEqual([
      { start: 0, end: 0 },
      { start: 1, end: 1 },
      { start: 2, end: 2 },
    ]);
  });

  it("throws when RegExp pattern is flagged as dangerous", () => {
    isPotentiallyDangerous.mockReturnValueOnce(true);
    expect(() => grepChunks([{ chunkId: "c1", text: "abc" }], /a/)).toThrow(
      /Potential ReDoS/,
    );
  });

  it("produces consistent results across rapid consecutive calls", () => {
    const chunks = [{ chunkId: "c1", text: "aba" }];
    const pattern = /a/g;
    const first = grepChunks(chunks, pattern);
    const second = grepChunks(chunks, pattern);
    expect(first).toEqual(second);
  });

  it("handles large text and deep nested chunks", () => {
    const longText = "a".repeat(10000);
    const deepChunk = {
      chunkId: "deep",
      text: longText,
      meta: { level1: { level2: { level3: [1, 2, 3] } } },
    };
    const out = grepChunks([deepChunk], "a");
    expect(out[0].matchCount).toBe(50);
  });
});

describe("grepChunksAsync", () => {
  it("rejects non-array chunks (null/undefined/object)", async () => {
    await expect(grepChunksAsync(null, "a")).rejects.toThrow(/chunks must be an array/);
    await expect(grepChunksAsync(undefined, "a")).rejects.toThrow(/chunks must be an array/);
    await expect(grepChunksAsync({ 0: "a" }, "a")).rejects.toThrow(/chunks must be an array/);
  });

  it("rejects non-object options (null/array)", async () => {
    await expect(grepChunksAsync([], "a", null)).rejects.toThrow(/options must be an object/);
    await expect(grepChunksAsync([], "a", [])).rejects.toThrow(/options must be an object/);
  });

  it("returns empty results for empty chunks or empty pattern", async () => {
    await expect(grepChunksAsync([], "a")).resolves.toEqual([]);
    await expect(grepChunksAsync([{ chunkId: "c1", text: "abc" }], "")).resolves.toEqual(
      [],
    );
    await expect(grepChunksAsync([], "", {})).resolves.toEqual([]);
  });

  it("uses createSafeRegex for regex option with string patterns", async () => {
    const out = await grepChunksAsync([{ chunkId: "c1", text: "aA" }], "a", {
      regex: true,
      caseSensitive: true,
    });
    expect(createSafeRegex).toHaveBeenCalledWith("a", "gu");
    expect(out[0].matchCount).toBe(1);
  });

  it("aborts when signal is already aborted", async () => {
    await expect(
      grepChunksAsync([{ chunkId: "c1", text: "a" }], "a", { signal: { aborted: true } }),
    ).rejects.toThrow(/aborted/);
  });

  it("yields based on yieldEvery and uses toPositiveInt", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    try {
      const chunks = Array.from({ length: 3 }, (_, i) => ({
        chunkId: `c${i}`,
        text: "a",
      }));
      const promise = grepChunksAsync(chunks, "a", { yieldEvery: "1" });
      await vi.runAllTimersAsync();
      const out = await promise;
      expect(toPositiveInt).toHaveBeenCalledWith("1", 200);
      expect(setTimeoutSpy).toHaveBeenCalled();
      expect(out.length).toBe(3);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("handles concurrent calls without shared state", async () => {
    const chunks = [
      { chunkId: "c1", text: "abc" },
      { chunkId: "c2", text: "aba" },
    ];
    const [outA, outB] = await Promise.all([
      grepChunksAsync(chunks, "a"),
      grepChunksAsync(chunks, /b/g),
    ]);
    expect(outA.map((item) => item.matchCount)).toEqual([1, 2]);
    expect(outB.map((item) => item.matchCount)).toEqual([1, 1]);
  });
});
