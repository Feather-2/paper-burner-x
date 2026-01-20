import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/utils/value-utils.js");
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    toPositiveInt: vi.fn(actual.toPositiveInt),
  };
});

import { DimensionMismatchError, VectorIndex } from "../../../../../js/agents/retrieval/embeddings/vector-index.js";
import * as valueUtils from "../../../../../js/agents/shared/utils/value-utils.js";

describe("DimensionMismatchError", () => {
  it("sets name and message", () => {
    const err = new DimensionMismatchError(2, 3);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DimensionMismatchError");
    expect(err.message).toBe("VectorIndex dimension mismatch: expected 2, got 3");
  });
});

describe("VectorIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses options via value-utils and initializes empty state", () => {
    const index = new VectorIndex("not-an-object");

    expect(index.size).toBe(0);
    expect(index.dimension).toBe(null);
    expect(valueUtils.isPlainObject).toHaveBeenCalledWith("not-an-object");
    expect(valueUtils.toPositiveInt).toHaveBeenCalledWith(undefined, 1000);
  });

  it("honors maxItems when provided as a numeric string", () => {
    const index = new VectorIndex({ maxItems: "2" });

    index.upsert("a", [1, 0]);
    index.upsert("b", [0, 1]);
    index.upsert("c", [1, 1]);

    expect(index.size).toBe(2);
    expect(index.has("a")).toBe(false);
    expect(index.has("b")).toBe(true);
    expect(index.has("c")).toBe(true);
  });

  it.each([null, undefined, "", "   "])("rejects invalid ids: %p", (id) => {
    const index = new VectorIndex();

    expect(index.upsert(id, [1, 0])).toBe(false);
    expect(index.size).toBe(0);
  });

  it("supports boundary ids and whitespace trimming", () => {
    const index = new VectorIndex();

    expect(index.upsert(0, [1, 0])).toBe(true);
    expect(index.has("0")).toBe(true);
    expect(index.upsert("  spaced  ", [0, 1])).toBe(true);
    expect(index.has("spaced")).toBe(true);
  });

  it.each([
    null,
    undefined,
    [],
    {},
    [0, 0],
    [Number.POSITIVE_INFINITY, 1],
    new Float32Array([Number.NaN, 1]),
    new Float32Array([Number.POSITIVE_INFINITY, 1]),
    new Float32Array([]),
  ])("rejects invalid vectors: %p", (vector) => {
    const index = new VectorIndex();

    expect(index.upsert("a", vector)).toBe(false);
    expect(index.size).toBe(0);
  });

  it("accepts numeric-string arrays, ArrayBuffers, and subarray views", () => {
    const index = new VectorIndex();

    expect(index.upsert("string-array", ["1", "0"])).toBe(true);
    expect(index.upsert("buffer", new Float32Array([0, 2]).buffer)).toBe(true);

    const base = new Float32Array([1, 2, 3, 4]);
    const sub = base.subarray(1, 3);
    expect(index.upsert("subarray", sub)).toBe(true);

    const byBuffer = index.search([0, 1], { topK: 1 });
    expect(byBuffer[0].id).toBe("buffer");
    expect(byBuffer[0].score).toBeCloseTo(1, 6);

    const bySub = index.search([2, 3], { topK: 1 });
    expect(bySub[0].id).toBe("subarray");
    expect(bySub[0].score).toBeCloseTo(1, 6);
  });

  it("throws DimensionMismatchError on mismatched dimensions and resets on clear", () => {
    const index = new VectorIndex();

    expect(index.upsert("a", [1, 0])).toBe(true);
    expect(() => index.upsert("b", [1, 0, 0])).toThrow(DimensionMismatchError);

    index.clear();
    expect(index.dimension).toBe(null);
    expect(index.upsert("c", [1, 0, 0])).toBe(true);
    expect(index.dimension).toBe(3);
  });

  it("handles has/delete with invalid ids and removes entries", () => {
    const index = new VectorIndex();

    expect(index.has("")).toBe(false);
    expect(index.delete(null)).toBe(false);

    index.upsert("keep", [1, 0]);
    expect(index.has("keep")).toBe(true);
    expect(index.delete("keep")).toBe(true);
    expect(index.has("keep")).toBe(false);
  });

  it("ranks results by cosine score and respects large topK values", () => {
    const index = new VectorIndex();

    index.upsert("v1", [1, 0], { tag: "a" });
    index.upsert("v2", [0, 1], { tag: "b" });
    index.upsert("v3", [1, 1], { tag: "c" });

    const results = index.search([1, 0], { topK: 2 });
    expect(results.map((row) => row.id)).toEqual(["v1", "v3"]);
    expect(results[0].score).toBeCloseTo(1, 6);
    expect(results[0].meta).toEqual({ tag: "a" });

    const all = index.search([1, 0], { topK: Number.MAX_SAFE_INTEGER });
    expect(all.map((row) => row.id)).toEqual(["v1", "v3", "v2"]);
  });

  it("applies filter and minScore while accepting topK as string input", () => {
    const index = new VectorIndex();

    index.upsert("keep", [1, 0], { tag: "keep" });
    index.upsert("low", [1, 1], { tag: "keep" });
    index.upsert("skip", [1, 0], { tag: "skip" });

    const filter = vi.fn((meta, id) => meta.tag === "keep" && id !== "skip");
    const results = index.search([1, 0], {
      topK: "1",
      filter,
      minScore: 0.9,
    });

    expect(valueUtils.toPositiveInt).toHaveBeenCalledWith("1", 5);
    expect(filter).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("keep");
    expect(results[0].score).toBeCloseTo(1, 6);
  });

  it("supports partition filters and partition stats", () => {
    const index = new VectorIndex();
    const baseTime = new Date("2024-01-01T00:00:00.000Z");

    vi.useFakeTimers();
    vi.setSystemTime(baseTime);

    const now = baseTime.getTime();
    index.upsert("hot", [1, 0], { ts: now - 30 * 60 * 1000 });
    index.upsert("warm", [1, 0], { ts: now - 2 * 60 * 60 * 1000 });
    index.upsert("cold", [1, 0], { ts: now - 2 * 24 * 60 * 60 * 1000 });
    index.upsert("cold-nan", [1, 0], { ts: "not-a-number" });

    const onlyHot = index.search([1, 0], { partitions: "hot" });
    expect(onlyHot.map((row) => row.id)).toEqual(["hot"]);

    const warmAndCold = index.search([1, 0], { partitions: ["warm", "cold"] });
    expect(warmAndCold.map((row) => row.id)).toEqual(["warm", "cold", "cold-nan"]);

    expect(index.getPartitionStats()).toEqual({
      hot: 1,
      warm: 1,
      cold: 2,
      total: 4,
    });
  });

  it("returns empty results for invalid queries, empty index, or dimension mismatch", () => {
    const index = new VectorIndex();

    expect(index.search([1, 0], { topK: 1 })).toEqual([]);

    index.upsert("a", [1, 0]);

    expect(index.search([1, 0], { topK: 0 })[0].id).toBe("a");
    expect(index.search([1, 0], { topK: -1 })[0].id).toBe("a");
    expect(index.search([1, 0, 0])).toEqual([]);

    const invalidQueries = [null, undefined, [], {}, new Float32Array([Number.NaN, 1])];
    for (const query of invalidQueries) {
      expect(index.search(query)).toEqual([]);
    }
  });

  it("handles concurrent upserts and rapid updates without state corruption", async () => {
    const index = new VectorIndex({ maxItems: 3 });

    const results = await Promise.all([
      Promise.resolve().then(() => index.upsert("a", [1, 0], { seq: 0 })),
      Promise.resolve().then(() => index.upsert("b", [0, 1], { seq: 1 })),
      Promise.resolve().then(() => index.upsert("c", [1, 1], { seq: 2 })),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(index.size).toBe(3);

    for (let i = 0; i < 5; i++) {
      index.upsert("b", [0, 1], { seq: i });
    }

    expect(index.search([0, 1], { topK: 1 })[0].meta.seq).toBe(4);
  });

  it("handles long ids, large vectors, and deep metadata structures", () => {
    const index = new VectorIndex();
    const longId = `id-${"x".repeat(10000)}`;
    const largeVector = Array.from({ length: 2048 }, (_, i) => (i % 2 === 0 ? 1 : 0));
    const deepMeta = {
      level1: { level2: { level3: { level4: { value: "ok" } } } },
    };

    expect(index.upsert(longId, largeVector, deepMeta)).toBe(true);

    const found = index.search(largeVector, {
      topK: 1,
      filter: (meta, id) => id === longId && meta.level1.level2.level3.level4.value === "ok",
    });

    expect(index.has(longId)).toBe(true);
    expect(found[0].id).toBe(longId);
  });
});
