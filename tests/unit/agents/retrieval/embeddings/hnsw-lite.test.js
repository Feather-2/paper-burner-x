import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/utils/value-utils.js");
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    toPositiveInt: vi.fn(actual.toPositiveInt),
  };
});

import hnswLiteDefault, {
  DimensionMismatchError,
  HnswLiteIndex,
  HnswLiteIndexError,
  InvalidIndexError,
} from "../../../../../js/agents/retrieval/embeddings/hnsw-lite.js";
import * as valueUtils from "../../../../../js/agents/shared/utils/value-utils.js";

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function makeZeroHyperplanes(dim, numBits) {
  return Array.from({ length: numBits }, () => new Float32Array(dim));
}

describe("HnswLiteIndexError", () => {
  it("sets name and preserves message", () => {
    const err = new HnswLiteIndexError("boom");

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HnswLiteIndexError");
    expect(err.message).toBe("boom");
  });

  it.each([null, undefined, "", "   ", [], {}, 0, -1, Number.MAX_SAFE_INTEGER])(
    "coerces non-string messages without throwing: %p",
    (message) => {
      const err = new HnswLiteIndexError(message);
      const expectedMessage = message === undefined ? "" : String(message);

      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("HnswLiteIndexError");
      expect(err.message).toBe(expectedMessage);
    },
  );

  it("handles very long messages (resource boundary)", () => {
    const msg = "x".repeat(1024 * 1024);
    const err = new HnswLiteIndexError(msg);

    expect(err.message.length).toBe(msg.length);
    expect(err.message.slice(0, 3)).toBe("xxx");
  });

  it("is safe to construct concurrently", async () => {
    const messages = Array.from({ length: 50 }, (_, i) => `m-${i}`);
    const errors = await Promise.all(messages.map((m) => Promise.resolve(new HnswLiteIndexError(m))));

    expect(errors).toHaveLength(50);
    expect(new Set(errors.map((e) => e.message)).size).toBe(50);
  });
});

describe("DimensionMismatchError", () => {
  it("sets name and formats message", () => {
    const err = new DimensionMismatchError(2, 3);

    expect(err).toBeInstanceOf(HnswLiteIndexError);
    expect(err.name).toBe("DimensionMismatchError");
    expect(err.message).toBe("HnswLiteIndex dimension mismatch: expected 2, got 3");
  });

  it.each([
    [0, Number.MAX_SAFE_INTEGER],
    [-1, 0],
    ["2", "3"],
    [{}, []],
  ])("handles boundary/type edge values: expected=%p actual=%p", (expected, actual) => {
    const err = new DimensionMismatchError(expected, actual);

    expect(err.message).toBe(`HnswLiteIndex dimension mismatch: expected ${expected}, got ${actual}`);
  });
});

describe("InvalidIndexError", () => {
  it("sets name and preserves message", () => {
    const err = new InvalidIndexError("invalid index");

    expect(err).toBeInstanceOf(HnswLiteIndexError);
    expect(err.name).toBe("InvalidIndexError");
    expect(err.message).toBe("invalid index");
  });

  it.each([null, undefined, "", "   ", [], {}, "x".repeat(1024)])(
    "coerces boundary messages without throwing: %p",
    (message) => {
      const err = new InvalidIndexError(message);
      const expectedMessage = message === undefined ? "" : String(message);

      expect(err).toBeInstanceOf(HnswLiteIndexError);
      expect(err.name).toBe("InvalidIndexError");
      expect(err.message).toBe(expectedMessage);
    },
  );
});

describe("HnswLiteIndex", () => {
  it("default export exposes HnswLiteIndex", () => {
    expect(hnswLiteDefault).toMatchObject({ HnswLiteIndex });
  });

  it("parses options via value-utils and initializes empty state", () => {
    const index = new HnswLiteIndex("not-an-object");

    expect(index.size).toBe(0);
    expect(index.dimension).toBe(null);
    expect(valueUtils.isPlainObject).toHaveBeenCalledWith("not-an-object");
    expect(valueUtils.toPositiveInt).toHaveBeenCalledWith(undefined, 5000);
  });

  it("clamps options and serializes config", () => {
    const index = new HnswLiteIndex({
      maxItems: "2",
      numHashBits: 2,
      numProbes: 100,
      seed: "7",
      rebuildThreshold: "0.05",
    });

    expect(index.upsert("a", [1, 0])).toBe(true);

    const json = index.toJSON();
    expect(json.version).toBe(1);
    expect(json.dim).toBe(2);
    expect(json.numHashBits).toBe(4);
    expect(json.numProbes).toBe(32);
    expect(json.seed).toBe(7);
  });

  it.each([null, undefined, "", "   "])("rejects invalid ids: %p", (id) => {
    const index = new HnswLiteIndex();

    expect(index.has(id)).toBe(false);
    expect(index.delete(id)).toBe(false);
    expect(index.upsert(id, [1, 0])).toBe(false);
    expect(index.dimension).toBe(null);
    expect(index.size).toBe(0);
  });

  it("supports boundary ids and whitespace trimming", () => {
    const index = new HnswLiteIndex();

    expect(index.upsert(0, [1, 0])).toBe(true);
    expect(index.has("0")).toBe(true);

    expect(index.upsert("  spaced  ", [0, 1])).toBe(true);
    expect(index.has("spaced")).toBe(true);
    expect(index.delete("   spaced")).toBe(true);
    expect(index.has("spaced")).toBe(false);
  });

  it.each([
    null,
    undefined,
    [],
    {},
    { length: 2 },
    { 0: 1, 1: 0, length: 2 },
    [0, 0],
    [Number.POSITIVE_INFINITY, 1],
    new Float32Array([1, Number.NaN]),
    new Float32Array([1, Number.POSITIVE_INFINITY]),
    new Float32Array([]),
  ])("rejects invalid vectors: %p", (vector) => {
    const index = new HnswLiteIndex();

    expect(index.upsert("a", vector)).toBe(false);
    expect(index.size).toBe(0);
    expect(index.dimension).toBe(null);
  });

  it("accepts numeric-string arrays, ArrayBuffers, and subarray views", () => {
    const index = new HnswLiteIndex();

    expect(index.upsert("string-array", ["1", "0"])).toBe(true);
    // Array inputs coerce falsy values (including NaN) to 0 via `v || 0`.
    expect(index.upsert("nan-coerced", [Number.NaN, 1])).toBe(true);
    expect(index.upsert("buffer", new Float32Array([0, 2]).buffer)).toBe(true);

    const base = new Float32Array([1, 2, 3, 4]);
    const sub = base.subarray(1, 3);
    expect(index.upsert("subarray", sub)).toBe(true);

    const byY = index.search([0, 1], { topK: 3 });
    const bufferRow = byY.find((r) => r.id === "buffer");
    const coercedRow = byY.find((r) => r.id === "nan-coerced");
    expect(bufferRow?.score).toBeCloseTo(1, 6);
    expect(coercedRow?.score).toBeCloseTo(1, 6);

    const bySub = index.search([2, 3], { topK: 1 });
    expect(bySub[0].id).toBe("subarray");
    expect(bySub[0].score).toBeCloseTo(1, 6);
  });

  it("updates existing entries without growing size", () => {
    const index = new HnswLiteIndex();
    const firstMeta = { ts: 1, tag: "first" };
    const secondMeta = { ts: 2, tag: "second" };

    expect(index.upsert("dup", [1, 0], firstMeta)).toBe(true);
    expect(index.size).toBe(1);

    expect(index.upsert("dup", [0, 1], secondMeta)).toBe(true);
    expect(index.size).toBe(1);
    expect(index.getStats().deletes).toBe(1);

    const results = index.search([0, 1], { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("dup");
    expect(results[0].meta).toBe(secondMeta);
  });

  it("throws DimensionMismatchError for mismatched dimensions without mutating existing state", () => {
    const index = new HnswLiteIndex();

    expect(index.upsert("a", [1, 0])).toBe(true);
    expect(() => index.upsert("b", [1, 0, 0])).toThrow(DimensionMismatchError);
    expect(index.size).toBe(1);
    expect(index.has("a")).toBe(true);
  });

  it("clear resets dimension and buckets, allowing a new dimension to be inserted", () => {
    const index = new HnswLiteIndex();

    expect(index.upsert("a", [1, 0])).toBe(true);
    expect(index.dimension).toBe(2);
    expect(index.size).toBe(1);

    index.clear();
    expect(index.dimension).toBe(null);
    expect(index.size).toBe(0);
    expect(index.getStats().numBuckets).toBe(0);

    expect(index.upsert("b", [1, 0, 0])).toBe(true);
    expect(index.dimension).toBe(3);
  });

  it("delete removes entries, is idempotent for missing ids, and updates search results", () => {
    const index = new HnswLiteIndex({ numHashBits: 4 });
    index._dim = 2;
    index._hyperplanes = makeZeroHyperplanes(2, 4);

    expect(index.upsert("a", [1, 0])).toBe(true);
    expect(index.upsert("b", [0, 1])).toBe(true);
    expect(index.size).toBe(2);

    expect(index.delete("a")).toBe(true);
    expect(index.delete("a")).toBe(false);
    expect(index.has("a")).toBe(false);
    expect(index.size).toBe(1);

    const results = index.search([1, 0], { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("b");
  });

  it("evicts oldest entries when maxItems is exceeded", () => {
    const index = new HnswLiteIndex({ maxItems: 2 });

    index.upsert("a", [1, 0]);
    index.upsert("b", [0, 1]);
    index.upsert("c", [1, 1]);

    expect(index.size).toBe(2);
    expect(index.has("a")).toBe(false);
    expect(index.has("b")).toBe(true);
    expect(index.has("c")).toBe(true);
    expect(index.getStats().deletes).toBeGreaterThanOrEqual(1);
  });

  it("clamps rebuildThreshold low values to 0.1 (behavioral check)", () => {
    const index = new HnswLiteIndex({ rebuildThreshold: 0.05 });

    for (let i = 0; i < 14; i++) {
      index.upsert(`id-${i}`, [1, i + 1]);
    }

    expect(index.getStats().rebuilds).toBe(0);
    expect(index.delete("id-0")).toBe(true);
    // 1 / 14 ~= 0.071: should NOT rebuild if threshold is clamped to >= 0.1
    expect(index.getStats().rebuilds).toBe(0);

    expect(index.delete("id-1")).toBe(true);
    // 2 / 14 ~= 0.143: should rebuild once threshold (0.1) is exceeded
    expect(index.getStats().rebuilds).toBe(1);
  });

  it("clamps rebuildThreshold high values to 0.5 (behavioral check)", () => {
    const index = new HnswLiteIndex({ rebuildThreshold: 0.9 });

    for (let i = 0; i < 4; i++) {
      index.upsert(`id-${i}`, [1, i + 1]);
    }

    expect(index.getStats().rebuilds).toBe(0);
    expect(index.delete("id-0")).toBe(true);
    expect(index.delete("id-1")).toBe(true);
    expect(index.getStats().rebuilds).toBe(0);

    // 3 / 4 = 0.75: should rebuild once threshold is clamped to 0.5
    expect(index.delete("id-2")).toBe(true);
    expect(index.getStats().rebuilds).toBe(1);
  });

  it("search returns sorted results and matches brute-force when all candidates are in-bucket", () => {
    const index = new HnswLiteIndex({ numHashBits: 4, numProbes: 1 });
    index._dim = 2;
    index._hyperplanes = makeZeroHyperplanes(2, 4);

    index.upsert("best", [1, 0], { ts: 1 });
    index.upsert("mid", [1, 1], { ts: 1 });
    index.upsert("low", [0, 1], { ts: 1 });

    const approx = index.search([1, 0], { topK: 3, efSearch: 1 });
    const brute = index.searchBruteForce([1, 0], { topK: 3 });

    expect(approx.map((r) => r.id)).toEqual(brute.map((r) => r.id));
    for (let i = 0; i < approx.length; i++) {
      expect(approx[i].score).toBeCloseTo(brute[i].score, 7);
    }
  });

  it("search respects filters, minScore, and partitions (including type edges)", () => {
    vi.useFakeTimers();
    const now = 1_000_000_000;
    vi.setSystemTime(now);

    const index = new HnswLiteIndex({ numHashBits: 4 });
    index._dim = 2;
    index._hyperplanes = makeZeroHyperplanes(2, 4);

    index.upsert("hot", [1, 0], { tag: "keep", ts: now - 1000 });
    index.upsert("warm", [0, 1], { tag: "skip", ts: now - 2 * 60 * 60 * 1000 });
    index.upsert("cold", [1, 1], { tag: "keep", ts: now - 2 * 24 * 60 * 60 * 1000 });

    const predicate = vi.fn((meta, id) => meta.tag === "keep" && typeof id === "string");
    const results = index.search([1, 0], {
      topK: 5,
      filter: predicate,
      minScore: 0.1,
      partitions: ["hot", null, 123, {}, []],
    });

    expect(predicate).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("hot");

    const warmResults = index.search([0, 1], { partitions: "warm", topK: 5 });
    expect(warmResults).toHaveLength(1);
    expect(warmResults[0].id).toBe("warm");
  });

  it("treats non-finite minScore as unset and ignores non-function filters", () => {
    const index = new HnswLiteIndex({ numHashBits: 4 });
    index._dim = 2;
    index._hyperplanes = makeZeroHyperplanes(2, 4);

    index.upsert("only", [1, 0], { ts: 1 });

    const results = index.search([-1, 0], { topK: 1, minScore: Number.NaN, filter: "not-a-function" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("only");
    expect(results[0].score).toBeLessThan(0);
  });

  it("returns empty results for invalid queries and dimension mismatches", () => {
    const index = new HnswLiteIndex();
    expect(index.search([1, 0], { topK: 1 })).toEqual([]);

    index.upsert("a", [1, 0]);

    expect(index.search(null)).toEqual([]);
    expect(index.search(undefined)).toEqual([]);
    expect(index.search([])).toEqual([]);
    expect(index.search([Number.NaN, 1])).toEqual([]);
    expect(index.search([1, 0, 0])).toEqual([]);
  });

  it("returns [] when toPositiveInt unexpectedly yields 0 (guard branch)", () => {
    const index = new HnswLiteIndex();
    index.upsert("a", [1, 0]);

    valueUtils.toPositiveInt.mockImplementationOnce(() => 0);
    const results = index.search([1, 0], { topK: 123 });
    expect(results).toEqual([]);
    expect(index.getStats().searches).toBe(0);
  });

  it("uses extra probing when initial candidates are too few (fallback expansion)", () => {
    const index = new HnswLiteIndex({ numHashBits: 4, numProbes: 1 });
    index._dim = 2;
    index._hyperplanes = [
      new Float32Array([1, 0]),
      new Float32Array([0, 1]),
      new Float32Array([-1, 0]),
      new Float32Array([0, -1]),
    ];

    // This vector hashes to a different bucket than the query, but is within Hamming distance <= 2,
    // so it should be found by the fallback extra probing path.
    index.upsert("candidate", [0, 1], { ts: 1 });

    const results = index.search([1, 0], { topK: 1, efSearch: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("candidate");
  });

  it("searchBruteForce returns sorted results and honors filters, partitions, and minScore", () => {
    vi.useFakeTimers();
    const now = 1_000_000_000;
    vi.setSystemTime(now);

    const index = new HnswLiteIndex();
    index.upsert("best", [1, 0], { tag: "keep", ts: now - 1000 });
    index.upsert("mid", [1, 1], { tag: "keep", ts: now - 1000 });
    index.upsert("low", [0, 1], { tag: "skip", ts: now - 2 * 24 * 60 * 60 * 1000 });

    const results = index.searchBruteForce([1, 0], {
      topK: "10px",
      filter: (meta) => meta.tag === "keep",
      partitions: ["hot", 123, null, {}],
      minScore: 0.1,
    });

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("best");
    expect(results[0].score).toBeGreaterThan(results[1].score);

    const none = index.searchBruteForce([1, 0], { minScore: 1.1 });
    expect(none).toEqual([]);
  });

  it("getPartitionStats classifies hot/warm/cold and treats missing/invalid ts as cold", () => {
    vi.useFakeTimers();
    const now = 1_000_000_000;
    vi.setSystemTime(now);

    const index = new HnswLiteIndex();
    index.upsert("hot", [1, 0], { ts: now - 1000 });
    index.upsert("warm", [0, 1], { ts: now - 2 * 60 * 60 * 1000 });
    index.upsert("cold", [1, 1], { ts: now - 2 * 24 * 60 * 60 * 1000 });
    index.upsert("no-ts", [1, 1], {});
    index.upsert("nan-ts", [1, 1], { ts: Number.NaN });

    expect(index.getPartitionStats()).toEqual({ hot: 1, warm: 1, cold: 3, total: 5 });
  });

  it("handles concurrent and rapid searches consistently", async () => {
    const index = new HnswLiteIndex({ numHashBits: 4 });
    index._dim = 2;
    index._hyperplanes = makeZeroHyperplanes(2, 4);
    index.upsert("a", [1, 0], { ts: 1 });

    const query = [1, 0];
    const concurrent = await Promise.all([
      Promise.resolve(index.search(query, { topK: 1 })),
      Promise.resolve(index.search(query, { topK: 1 })),
      Promise.resolve(index.search(query, { topK: 1 })),
    ]);

    for (const result of concurrent) {
      expect(result[0].id).toBe("a");
    }

    for (let i = 0; i < 5; i++) {
      index.search(query, { topK: 1 });
    }

    const stats = index.getStats();
    expect(stats.searches).toBe(8);
    expect(Number.isFinite(stats.avgCandidates)).toBe(true);
  });

  it("fromJSON restores index, supports large payloads, and rejects invalid versions", () => {
    const index = new HnswLiteIndex({ maxItems: 2000, numHashBits: 8, numProbes: 8, seed: 123 });

    for (let i = 0; i < 500; i++) {
      const v = i % 2 === 0 ? [1, 0] : [0, 1];
      index.upsert(`id-${i}`, v, { i, ts: i });
    }

    const json = index.toJSON();
    const serialized = JSON.stringify(json);
    expect(serialized.length).toBeGreaterThan(10_000);

    const restored = HnswLiteIndex.fromJSON(json);
    expect(restored.size).toBe(500);
    expect(restored.dimension).toBe(2);
    expect(restored.has("id-0")).toBe(true);

    const top = restored.search([1, 0], { topK: 1 });
    expect(top).toHaveLength(1);
    expect(top[0].score).toBeCloseTo(1, 6);

    expect(() => HnswLiteIndex.fromJSON(null)).toThrow(InvalidIndexError);
    expect(() => HnswLiteIndex.fromJSON({})).toThrow(InvalidIndexError);
    expect(() => HnswLiteIndex.fromJSON({ version: 2 })).toThrow(InvalidIndexError);
  });

  it("handles large vectors, long ids, and deep metadata (resource boundary)", () => {
    const index = new HnswLiteIndex();
    const longId = "x".repeat(10_000);
    const largeVector = Array.from({ length: 1024 }, (_, i) => (i % 2 === 0 ? 2 : 1));
    const deepMeta = {
      level1: { level2: { level3: { level4: { note: "deep" } } } },
      payload: "y".repeat(20_000),
    };

    expect(index.upsert(longId, largeVector, deepMeta)).toBe(true);
    const results = index.search(largeVector, { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(longId);
    expect(results[0].meta).toBe(deepMeta);
  });
});
