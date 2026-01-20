import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isPlainObject: vi.fn(),
}));

import {
  buildIndex,
  buildIndexAsync,
  search,
  serializeIndex,
  deserializeIndex,
} from "../../../../js/agents/retrieval/bm25.js";
import { isPlainObject } from "../../../../js/agents/shared/index.js";

const toPlainIndex = (idx) => ({
  chunkIds: idx.chunkIds,
  docLens: idx.docLens,
  avgDocLen: idx.avgDocLen,
  df: Array.from(idx.df.entries()),
  postings: Array.from(idx.postings.entries()),
  k1: idx.k1,
  b: idx.b,
});

beforeEach(() => {
  vi.clearAllMocks();
  isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildIndex
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIndex", () => {
  it("builds index from valid chunks", () => {
    const chunks = [
      { chunkId: "a", text: "hello world" },
      { chunkId: "b", text: "hello universe" },
    ];
    const idx = buildIndex(chunks);

    expect(idx.chunkIds).toEqual(["a", "b"]);
    expect(idx.docLens.length).toBe(2);
    expect(idx.avgDocLen).toBeGreaterThan(0);
    expect(idx.df).toBeInstanceOf(Map);
    expect(idx.postings).toBeInstanceOf(Map);
    expect(idx.df.get("hello")).toBe(2);
    expect(idx.k1).toBe(1.2);
    expect(idx.b).toBe(0.75);
  });

  it("handles empty chunks array", () => {
    const idx = buildIndex([]);
    expect(idx.chunkIds).toEqual([]);
    expect(idx.docLens).toEqual([]);
    expect(idx.avgDocLen).toBe(0);
  });

  it("auto-generates chunkId and stringifies non-string ids", () => {
    const idx = buildIndex([{ chunkId: 7, text: "alpha" }, { text: "beta" }]);
    expect(idx.chunkIds).toEqual(["7", "chunk_2"]);
  });

  it("handles null/undefined/empty/whitespace text", () => {
    const idx = buildIndex([
      { chunkId: "n", text: null },
      { chunkId: "u", text: undefined },
      { chunkId: "e", text: "" },
      { chunkId: "w", text: "   " },
    ]);
    expect(idx.docLens).toEqual([0, 0, 0, 0]);
    expect(idx.df.size).toBe(0);
  });

  it("filters stopwords and drops single-char Latin tokens but keeps digits", () => {
    const idx = buildIndex([{ chunkId: "x", text: "the a b c 1 2 world" }]);
    expect(idx.df.has("the")).toBe(false);
    expect(idx.df.has("a")).toBe(false);
    expect(idx.df.has("b")).toBe(false);
    expect(idx.df.has("c")).toBe(false);
    expect(idx.df.has("1")).toBe(true);
    expect(idx.df.has("2")).toBe(true);
    expect(idx.df.has("world")).toBe(true);
  });

  it("normalizes maxTokensPerDoc for string/zero/negative/max-safe/infinity", () => {
    const text = "t0 t1 t2 t3 t4";
    const chunks = [{ chunkId: "x", text }];

    const stringIdx = buildIndex(chunks, { maxTokensPerDoc: "3" });
    expect(stringIdx.docLens[0]).toBe(3);

    const zeroIdx = buildIndex(chunks, { maxTokensPerDoc: 0 });
    expect(zeroIdx.docLens[0]).toBe(5);

    const negativeIdx = buildIndex(chunks, { maxTokensPerDoc: -1 });
    expect(negativeIdx.docLens[0]).toBe(5);

    const maxSafeIdx = buildIndex(chunks, { maxTokensPerDoc: Number.MAX_SAFE_INTEGER });
    expect(maxSafeIdx.docLens[0]).toBe(5);

    const infinityIdx = buildIndex(chunks, { maxTokensPerDoc: Infinity });
    expect(infinityIdx.docLens[0]).toBe(5);
  });

  it("respects maxTermLength limit", () => {
    const longTerm = "a".repeat(80);
    const idx = buildIndex([{ chunkId: "x", text: `short ${longTerm}` }], {
      maxTermLength: 10,
    });
    expect(idx.df.has(longTerm)).toBe(false);
    expect(idx.df.has("short")).toBe(true);
  });

  it("respects maxUniqueTerms limit", () => {
    const terms = Array.from({ length: 20 }, (_, i) => `term${i}`).join(" ");
    const idx = buildIndex([{ chunkId: "x", text: terms }], { maxUniqueTerms: 5 });
    expect(idx.df.size).toBeLessThanOrEqual(5);
  });

  it("respects maxPostingsPerTerm limit", () => {
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      chunkId: `c${i}`,
      text: "common",
    }));
    const idx = buildIndex(chunks, { maxPostingsPerTerm: 3 });
    const postings = idx.postings.get("common");
    expect(Array.isArray(postings)).toBe(true);
    expect(postings.length).toBeLessThanOrEqual(3);
  });

  it("handles large chunk lists (resource boundary)", () => {
    const chunks = Array.from({ length: 300 }, (_, i) => ({
      chunkId: `c${i}`,
      text: "alpha beta",
    }));
    const idx = buildIndex(chunks);
    expect(idx.chunkIds.length).toBe(300);
    expect(idx.df.has("alpha")).toBe(true);
  });

  it("handles long text and deep nested chunk (resource boundary)", () => {
    const longText = "word ".repeat(5000);
    const deepChunk = {
      chunkId: "deep",
      text: longText,
      meta: { level1: { level2: { level3: { level4: [1, 2, 3] } } } },
    };
    const idx = buildIndex([deepChunk]);
    expect(idx.docLens[0]).toBeGreaterThan(1000);
    expect(idx.df.has("word")).toBe(true);
  });

  it("throws on non-array chunks and non-object options", () => {
    expect(() => buildIndex("not array")).toThrow(/chunks must be an array/);
    expect(() => buildIndex(null)).toThrow(/chunks must be an array/);
    expect(() => buildIndex([], "invalid")).toThrow(/options must be an object/);
    expect(() => buildIndex([], [])).toThrow(/options must be an object/);
  });

  it("produces consistent results across rapid consecutive calls", () => {
    const chunks = [
      { chunkId: "a", text: "hello world" },
      { chunkId: "b", text: "hello world" },
    ];
    const first = buildIndex(chunks);
    const second = buildIndex(chunks);
    expect(toPlainIndex(first)).toEqual(toPlainIndex(second));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildIndexAsync
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIndexAsync", () => {
  it("rejects non-array chunks (null/undefined/object)", async () => {
    await expect(buildIndexAsync(null)).rejects.toThrow(/chunks must be an array/);
    await expect(buildIndexAsync(undefined)).rejects.toThrow(/chunks must be an array/);
    await expect(buildIndexAsync({ 0: "a" })).rejects.toThrow(/chunks must be an array/);
  });

  it("rejects non-object options (null/array/string)", async () => {
    await expect(buildIndexAsync([], null)).rejects.toThrow(/options must be an object/);
    await expect(buildIndexAsync([], [])).rejects.toThrow(/options must be an object/);
    await expect(buildIndexAsync([], "bad")).rejects.toThrow(/options must be an object/);
  });

  it("uses workerPool buildIndex and forwards k1/b only", async () => {
    const workerPool = {
      buildIndex: vi.fn().mockResolvedValue({ ok: true }),
    };
    const chunks = [{ chunkId: "x", text: "hello" }];
    const out = await buildIndexAsync(chunks, {
      workerPool,
      k1: 1.6,
      b: 0.4,
      maxTokensPerDoc: 1,
    });
    expect(workerPool.buildIndex).toHaveBeenCalledWith(chunks, { k1: 1.6, b: 0.4 });
    expect(out).toEqual({ ok: true });
  });

  it("builds index with limits and string numeric values", async () => {
    const chunks = [{ chunkId: "x", text: "t0 t1 t2 t3" }];
    const idx = await buildIndexAsync(chunks, { maxTokensPerDoc: "2" });
    expect(idx.docLens[0]).toBe(2);
  });

  it("aborts when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildIndexAsync([{ chunkId: "x", text: "hello" }], {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });

  it("handles concurrent builds with different inputs", async () => {
    const a = [{ chunkId: "a", text: "alpha beta" }];
    const b = [{ chunkId: "b", text: "gamma delta" }];
    const [idxA, idxB] = await Promise.all([buildIndexAsync(a), buildIndexAsync(b)]);
    expect(idxA.chunkIds).toEqual(["a"]);
    expect(idxB.chunkIds).toEqual(["b"]);
    expect(idxA.df.has("alpha")).toBe(true);
    expect(idxB.df.has("gamma")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// search
// ─────────────────────────────────────────────────────────────────────────────

describe("search", () => {
  it("throws on invalid index inputs", () => {
    expect(() => search(null, "q")).toThrow(/index must be an object/);
    expect(() => search([], "q")).toThrow(/index must be an object/);
    expect(() => search("bad", "q")).toThrow(/index must be an object/);
  });

  it("throws on non-string query", () => {
    const idx = buildIndex([{ chunkId: "x", text: "hello" }]);
    expect(() => search(idx, null)).toThrow(/query must be a string/);
    expect(() => search(idx, undefined)).toThrow(/query must be a string/);
    expect(() => search(idx, 123)).toThrow(/query must be a string/);
  });

  it("throws on non-object options", () => {
    const idx = buildIndex([{ chunkId: "x", text: "hello" }]);
    expect(() => search(idx, "hello", 8, null)).toThrow(/options must be an object/);
    expect(() => search(idx, "hello", 8, [])).toThrow(/options must be an object/);
  });

  it("returns empty for empty index or empty/stopword queries", () => {
    const emptyIndex = buildIndex([]);
    expect(search(emptyIndex, "hello")).toEqual([]);

    const idx = buildIndex([{ chunkId: "x", text: "quick brown fox" }]);
    expect(search(idx, "")).toEqual([]);
    expect(search(idx, "   ")).toEqual([]);
    expect(search(idx, "the and")).toEqual([]);
  });

  it("sorts ties by chunkId", () => {
    const idx = buildIndex([
      { chunkId: "b", text: "alpha beta" },
      { chunkId: "a", text: "alpha beta" },
    ]);
    const results = search(idx, "alpha", 10);
    expect(results.map((r) => r.chunkId)).toEqual(["a", "b"]);
  });

  it("respects topK boundaries (0, -1, MAX_SAFE_INTEGER)", () => {
    const chunks = Array.from({ length: 3 }, (_, i) => ({
      chunkId: `c${i}`,
      text: "alpha",
    }));
    const idx = buildIndex(chunks);
    expect(search(idx, "alpha", 0).length).toBe(1);
    expect(search(idx, "alpha", -1).length).toBe(1);
    expect(search(idx, "alpha", Number.MAX_SAFE_INTEGER).length).toBe(3);
  });

  it("falls back to default topK when topK is a string", () => {
    const chunks = Array.from({ length: 9 }, (_, i) => ({
      chunkId: `c${i}`,
      text: "alpha",
    }));
    const idx = buildIndex(chunks);
    const results = search(idx, "alpha", "3");
    expect(results.length).toBe(8);
  });

  it("respects filterDocIndex option", () => {
    const chunks = Array.from({ length: 4 }, (_, i) => ({
      chunkId: `c${i}`,
      text: "alpha",
    }));
    const idx = buildIndex(chunks);
    const results = search(idx, "alpha", 10, {
      filterDocIndex: (di) => di % 2 === 0,
    });
    expect(results.map((r) => r.chunkId)).toEqual(["c0", "c2"]);
  });

  it("treats duplicate query terms as unique", () => {
    const idx = buildIndex([
      { chunkId: "x", text: "hello world" },
      { chunkId: "y", text: "hello" },
    ]);
    const once = search(idx, "hello", 10);
    const twice = search(idx, "hello hello", 10);
    expect(twice).toEqual(once);
  });

  it("produces consistent results across rapid consecutive calls", () => {
    const idx = buildIndex([{ chunkId: "x", text: "hello world" }]);
    const first = search(idx, "hello", 5);
    const second = search(idx, "hello", 5);
    expect(first).toEqual(second);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// serializeIndex
// ─────────────────────────────────────────────────────────────────────────────

describe("serializeIndex", () => {
  it("throws on non-object index", () => {
    expect(() => serializeIndex(null)).toThrow(/index must be an object/);
    expect(() => serializeIndex(undefined)).toThrow(/index must be an object/);
    expect(() => serializeIndex(123)).toThrow(/index must be an object/);
  });

  it("serializes maps and normalizes numeric fields", () => {
    const index = {
      chunkIds: ["a", 1, null, ""],
      docLens: [1, "2", NaN, undefined],
      avgDocLen: "3",
      df: new Map([["term", 2]]),
      postings: new Map([["term", [[0, 4]]]]),
      k1: "bad",
      b: Infinity,
    };
    const snapshot = serializeIndex(index);
    expect(snapshot.schemaVersion).toBe("0.1");
    expect(snapshot.chunkIds).toEqual(["a", "1"]);
    expect(snapshot.docLens).toEqual([1, 2, 0, 0]);
    expect(snapshot.avgDocLen).toBe(3);
    expect(snapshot.df).toEqual([["term", 2]]);
    expect(snapshot.postings).toEqual([["term", [[0, 4]]]]);
    expect(snapshot.k1).toBe(1.2);
    expect(snapshot.b).toBe(0.75);
  });

  it("passes through array-based df/postings and empty objects", () => {
    const snapshot = serializeIndex({
      chunkIds: [],
      docLens: [],
      df: [["x", 1]],
      postings: [["x", [[0, 1]]]],
    });
    expect(snapshot.chunkIds).toEqual([]);
    expect(snapshot.df).toEqual([["x", 1]]);
    expect(snapshot.postings).toEqual([["x", [[0, 1]]]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deserializeIndex
// ─────────────────────────────────────────────────────────────────────────────

describe("deserializeIndex", () => {
  it("throws on non-object snapshot", () => {
    expect(() => deserializeIndex(null)).toThrow(/snapshot must be an object/);
    expect(() => deserializeIndex(undefined)).toThrow(/snapshot must be an object/);
  });

  it("restores maps and numeric fields from a snapshot", () => {
    const snapshot = {
      chunkIds: ["a", "b"],
      docLens: [1, 3],
      avgDocLen: 2,
      df: [["alpha", "2"]],
      postings: [["alpha", [[0, "1"], [1, 2]]]],
      k1: "1.5",
      b: "0.5",
    };
    const idx = deserializeIndex(snapshot);
    expect(idx.chunkIds).toEqual(["a", "b"]);
    expect(idx.docLens).toEqual([1, 3]);
    expect(idx.avgDocLen).toBe(2);
    expect(idx.df).toBeInstanceOf(Map);
    expect(idx.df.get("alpha")).toBe(2);
    expect(idx.postings.get("alpha")).toEqual([[0, 1], [1, 2]]);
    expect(idx.k1).toBe(1.5);
    expect(idx.b).toBe(0.5);
  });

  it("computes avgDocLen when missing", () => {
    const idx = deserializeIndex({
      chunkIds: ["a", "b"],
      docLens: [2, 4],
      df: [],
      postings: [],
    });
    expect(idx.avgDocLen).toBe(3);
  });

  it("filters invalid df/postings entries", () => {
    const idx = deserializeIndex({
      chunkIds: ["c1"],
      docLens: [1],
      df: [["term", "2"], ["", 5], [null, 3], ["bad", "NaN"]],
      postings: [
        ["term", [[0, "3"], ["x"], [1, 2]]],
        ["", [[0, 1]]],
        ["bad", "nope"],
      ],
    });
    expect(idx.df.has("term")).toBe(true);
    expect(idx.df.has("")).toBe(false);
    expect(idx.df.get("bad")).toBe(0);
    expect(idx.postings.get("term")).toEqual([[0, 3], [1, 2]]);
    expect(idx.postings.has("")).toBe(false);
    expect(idx.postings.get("bad")).toEqual([]);
  });

  it("handles empty snapshots", () => {
    const idx = deserializeIndex({});
    expect(idx.chunkIds).toEqual([]);
    expect(idx.docLens).toEqual([]);
    expect(idx.avgDocLen).toBe(0);
    expect(idx.df.size).toBe(0);
    expect(idx.postings.size).toBe(0);
  });
});
