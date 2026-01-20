import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/retrieval/bm25.js", () => ({
  search: vi.fn(),
}));
vi.mock("../../../../js/agents/retrieval/vector-search.js", () => ({
  searchAsync: vi.fn(),
}));

import { rrfFuse, hybridSearch } from "../../../../js/agents/retrieval/hybrid-retrieval.js";
import { search as bm25Search } from "../../../../js/agents/retrieval/bm25.js";
import { searchAsync as vectorSearchAsync } from "../../../../js/agents/retrieval/vector-search.js";

const bm25SearchMock = bm25Search;
const vectorSearchMock = vectorSearchAsync;

describe("rrfFuse", () => {
  it("fuses lists and ranks overlap higher", () => {
    const bm25 = [
      { chunkId: "x", score: 1.2 },
      { chunkId: "y", score: 0.4 },
    ];
    const vector = [
      { chunkId: "x", score: 0.9 },
      { chunkId: "z", score: 0.1 },
    ];

    const fused = rrfFuse(bm25, vector);

    const itemX = fused.find((r) => r.chunkId === "x");
    const itemY = fused.find((r) => r.chunkId === "y");
    const itemZ = fused.find((r) => r.chunkId === "z");

    expect(fused).toHaveLength(3);
    expect(itemX).toBeDefined();
    expect(itemY).toBeDefined();
    expect(itemZ).toBeDefined();
    expect(itemX.rrfScore).toBeGreaterThan(itemY.rrfScore);
    expect(itemX.rrfScore).toBeGreaterThan(itemZ.rrfScore);
    expect(itemX.bm25Score).toBe(1.2);
    expect(itemX.vectorScore).toBe(0.9);
  });

  it("breaks ties by chunkId for deterministic order", () => {
    const bm25 = [{ chunkId: "b" }];
    const vector = [{ chunkId: "a" }];

    const fused = rrfFuse(bm25, vector);

    expect(fused).toHaveLength(2);
    expect(fused[0].chunkId).toBe("a");
    expect(fused[1].chunkId).toBe("b");
    expect(fused[0].rrfScore).toBeCloseTo(fused[1].rrfScore, 12);
  });

  it("skips invalid chunkIds and accepts numeric ids", () => {
    const bm25 = [
      { chunkId: " " },
      { chunkId: null },
      { chunkId: 123 },
      { chunkId: "ok" },
    ];
    const vector = [{ chunkId: "" }, { chunkId: undefined }, { chunkId: "ok2" }];

    const fused = rrfFuse(bm25, vector);

    const ids = fused.map((r) => r.chunkId).sort();
    expect(ids).toEqual(["123", "ok", "ok2"].sort());
  });

  it("accumulates duplicates and keeps max scores", () => {
    const bm25 = [
      { chunkId: "dup", score: 0.5 },
      { chunkId: "dup", score: 1.2 },
    ];
    const vector = [{ chunkId: "dup", score: 0.9 }];

    const fused = rrfFuse(bm25, vector);
    const item = fused.find((r) => r.chunkId === "dup");

    const expected = 1 / (60 + 1) + 1 / (60 + 2) + 1 / (60 + 1);
    expect(item.rrfScore).toBeCloseTo(expected, 12);
    expect(item.bm25Score).toBe(1.2);
    expect(item.vectorScore).toBe(0.9);
  });

  it("honors limit values and falls back for invalid limits", () => {
    const bm25 = Array.from({ length: 6 }, (_, i) => ({ chunkId: `b${i}` }));
    const vector = Array.from({ length: 6 }, (_, i) => ({ chunkId: `v${i}` }));

    expect(rrfFuse(bm25, vector, { limit: "2" })).toHaveLength(2);
    expect(rrfFuse(bm25, vector, { limit: 0 })).toHaveLength(8);
    expect(rrfFuse(bm25, vector, { limit: -1 })).toHaveLength(8);
  });

  it("returns all results for Infinity limit with large inputs", () => {
    const bm25 = Array.from({ length: 5000 }, (_, i) => ({ chunkId: `b${i}` }));

    const fused = rrfFuse(bm25, [], { limit: Infinity });

    expect(fused).toHaveLength(5000);
  });

  it("falls back for negative weights and allows zero weight", () => {
    const bm25 = [{ chunkId: "bm" }];
    const vector = [{ chunkId: "vec" }];

    const fused = rrfFuse(bm25, vector, { bm25Weight: -1, vectorWeight: 0 });
    const bm = fused.find((r) => r.chunkId === "bm");
    const vec = fused.find((r) => r.chunkId === "vec");

    const expected = 1 / (60 + 1);
    expect(bm.rrfScore).toBeCloseTo(expected, 12);
    expect(vec.rrfScore).toBe(0);
  });

  it("accepts MAX_SAFE_INTEGER rrfK values", () => {
    const bm25 = [{ chunkId: "a" }];

    const fusedDefault = rrfFuse(bm25, []);
    const fusedHuge = rrfFuse(bm25, [], { rrfK: Number.MAX_SAFE_INTEGER });

    expect(fusedHuge[0].rrfScore).toBeGreaterThan(0);
    expect(fusedHuge[0].rrfScore).toBeLessThan(fusedDefault[0].rrfScore);
  });

  it("ignores non-finite and non-number scores", () => {
    const bm25 = [
      { chunkId: "a", score: "1" },
      { chunkId: "b", score: NaN },
      { chunkId: "c", score: Infinity },
    ];
    const vector = [
      { chunkId: "a", score: undefined },
      { chunkId: "d", score: 0 },
    ];

    const fused = rrfFuse(bm25, vector);
    const itemA = fused.find((r) => r.chunkId === "a");
    const itemD = fused.find((r) => r.chunkId === "d");

    expect(Object.prototype.hasOwnProperty.call(itemA, "bm25Score")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(itemA, "vectorScore")).toBe(false);
    expect(itemD.vectorScore).toBe(0);
  });

  it("throws on invalid inputs and handles empty defaults", () => {
    expect(rrfFuse()).toEqual([]);
    expect(rrfFuse([], [])).toEqual([]);
    expect(() => rrfFuse({}, [])).toThrow(/bm25Results must be an array/);
    expect(() => rrfFuse([], {})).toThrow(/vectorResults must be an array/);
    expect(() => rrfFuse([], [], null)).toThrow(/options must be an object/);
    expect(() => rrfFuse([], [], [])).toThrow(/options must be an object/);
  });
});

describe("hybridSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws on invalid indexes, query, and options", async () => {
    const badIndexes = [null, undefined, [], 0, "x", () => {}];
    for (const idx of badIndexes) {
      await expect(hybridSearch(idx, "q")).rejects.toThrow(/indexes must be an object/);
    }

    const badQueries = [null, undefined, 123, {}, []];
    for (const q of badQueries) {
      await expect(hybridSearch({}, q)).rejects.toThrow(/query must be a string/);
    }

    const badOptions = [null, [], "nope", 1];
    for (const opt of badOptions) {
      await expect(hybridSearch({}, "q", opt)).rejects.toThrow(/options must be an object/);
    }
  });

  it("returns empty for blank query and skips searches", async () => {
    const indexes = { bm25Index: {}, vectorIndex: {} };

    const result = await hybridSearch(indexes, "   ");

    expect(result).toEqual([]);
    expect(bm25SearchMock).not.toHaveBeenCalled();
    expect(vectorSearchMock).not.toHaveBeenCalled();
  });

  it("uses default search functions with fetchK min 10 and passes options", async () => {
    const indexes = { bm25Index: { id: 1 }, vectorIndex: { id: 2 } };
    bm25SearchMock.mockReturnValue([{ chunkId: "b1", score: 1 }]);
    vectorSearchMock.mockResolvedValue([{ chunkId: "v1", score: 1 }]);

    const result = await hybridSearch(indexes, "  query  ", {
      limit: 1,
      bm25Options: { foo: "bar" },
      vectorOptions: { nested: { deep: true } },
    });

    expect(bm25SearchMock).toHaveBeenCalledWith(indexes.bm25Index, "query", 10, { foo: "bar" });
    expect(vectorSearchMock).toHaveBeenCalledWith(indexes.vectorIndex, "query", 10, { nested: { deep: true } });
    expect(result).toHaveLength(1);
  });

  it("uses 10000 fetchK when limit is Infinity", async () => {
    const indexes = { bm25Index: {}, vectorIndex: {} };
    bm25SearchMock.mockReturnValue([{ chunkId: "b1" }, { chunkId: "b2" }]);
    vectorSearchMock.mockResolvedValue([]);

    const result = await hybridSearch(indexes, "query", { limit: Infinity });

    expect(bm25SearchMock).toHaveBeenCalledWith(indexes.bm25Index, "query", 10000, {});
    expect(vectorSearchMock).toHaveBeenCalledWith(indexes.vectorIndex, "query", 10000, {});
    expect(result).toHaveLength(2);
  });

  it("returns empty when indexes are missing", async () => {
    const result = await hybridSearch({}, "query");

    expect(result).toEqual([]);
    expect(bm25SearchMock).not.toHaveBeenCalled();
    expect(vectorSearchMock).not.toHaveBeenCalled();
  });

  it("calls only bm25 when vector index is missing", async () => {
    bm25SearchMock.mockReturnValue([{ chunkId: "b1" }]);

    const result = await hybridSearch({ bm25Index: {} }, "query");

    expect(bm25SearchMock).toHaveBeenCalledTimes(1);
    expect(vectorSearchMock).not.toHaveBeenCalled();
    expect(result.some((r) => r.chunkId === "b1")).toBe(true);
  });

  it("calls only vector search when bm25 index is missing", async () => {
    vectorSearchMock.mockResolvedValue([{ chunkId: "v1" }]);

    const result = await hybridSearch({ vectorIndex: {} }, "query");

    expect(vectorSearchMock).toHaveBeenCalledTimes(1);
    expect(bm25SearchMock).not.toHaveBeenCalled();
    expect(result.some((r) => r.chunkId === "v1")).toBe(true);
  });

  it("continues when bm25 fails if fallback=true and logs", async () => {
    const indexes = { bm25Index: {}, vectorIndex: {} };
    const logger = { warn: vi.fn() };
    bm25SearchMock.mockImplementation(() => {
      throw new Error("bm25 boom");
    });
    vectorSearchMock.mockResolvedValue([{ chunkId: "v1" }]);

    const result = await hybridSearch(indexes, "query", { fallback: true, logger });

    expect(result.some((r) => r.chunkId === "v1")).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith("hybridSearch: bm25 failed", { error: "bm25 boom" });
  });

  it("continues when vector search fails if fallback=true and logs", async () => {
    const indexes = { bm25Index: {}, vectorIndex: {} };
    const logger = { warn: vi.fn() };
    bm25SearchMock.mockReturnValue([{ chunkId: "b1" }]);
    vectorSearchMock.mockRejectedValue(new Error("vec boom"));

    const result = await hybridSearch(indexes, "query", { fallback: true, logger });

    expect(result.some((r) => r.chunkId === "b1")).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith("hybridSearch: vector search failed", { error: "vec boom" });
  });

  it("throws when fallback=false for bm25 failures", async () => {
    bm25SearchMock.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(hybridSearch({ bm25Index: {} }, "query", { fallback: false })).rejects.toThrow("hybridSearch: bm25 failed");
  });

  it("throws when fallback=false for vector failures", async () => {
    vectorSearchMock.mockRejectedValue(new Error("boom"));

    await expect(hybridSearch({ vectorIndex: {} }, "query", { fallback: false })).rejects.toThrow("hybridSearch: vector search failed");
  });

  it("drops non-array bm25 results but keeps vector results", async () => {
    bm25SearchMock.mockReturnValue(null);
    vectorSearchMock.mockResolvedValue([{ chunkId: "v1" }]);

    const result = await hybridSearch({ bm25Index: {}, vectorIndex: {} }, "query");

    expect(result.some((r) => r.chunkId === "v1")).toBe(true);
  });

  it("drops non-array vector results but keeps bm25 results", async () => {
    bm25SearchMock.mockReturnValue([{ chunkId: "b1" }]);
    vectorSearchMock.mockResolvedValue("nope");

    const result = await hybridSearch({ bm25Index: {}, vectorIndex: {} }, "query");

    expect(result.some((r) => r.chunkId === "b1")).toBe(true);
  });

  it("passes embeddingService and deep vectorOptions to vector search", async () => {
    const indexes = { vectorIndex: {} };
    const embeddingService = { embed: vi.fn(async () => [[]]) };
    const vectorOptions = { level1: { level2: { level3: "deep" } } };
    const vectorSearchFn = vi.fn(async () => [{ chunkId: "v1" }]);

    await hybridSearch(indexes, "query", { vectorSearchFn, embeddingService, vectorOptions });

    expect(vectorSearchFn).toHaveBeenCalledTimes(1);
    const [, , , opts] = vectorSearchFn.mock.calls[0];
    expect(opts).toMatchObject({ embeddingService, level1: { level2: { level3: "deep" } } });
  });

  it("supports concurrent calls without leaking state", async () => {
    const indexes = { bm25Index: {}, vectorIndex: {} };
    const bm25SearchFn = vi.fn((_, q) => [{ chunkId: `b-${q}` }]);
    const vectorSearchFn = vi.fn(async (_, q) => [{ chunkId: `v-${q}` }]);

    const [resA, resB] = await Promise.all([
      hybridSearch(indexes, "alpha", { bm25SearchFn, vectorSearchFn }),
      hybridSearch(indexes, "beta", { bm25SearchFn, vectorSearchFn }),
    ]);

    expect(bm25SearchFn).toHaveBeenCalledTimes(2);
    expect(vectorSearchFn).toHaveBeenCalledTimes(2);
    expect(resA.some((r) => r.chunkId === "b-alpha")).toBe(true);
    expect(resB.some((r) => r.chunkId === "b-beta")).toBe(true);
  });

  it("handles rapid sequential calls without shared state", async () => {
    const indexes = { bm25Index: {}, vectorIndex: {} };
    const bm25SearchFn = vi.fn(() => [{ chunkId: "b1" }]);
    const vectorSearchFn = vi.fn(async () => [{ chunkId: "v1" }]);

    const first = await hybridSearch(indexes, "q", { bm25SearchFn, vectorSearchFn });
    const second = await hybridSearch(indexes, "q", { bm25SearchFn, vectorSearchFn });

    expect(bm25SearchFn).toHaveBeenCalledTimes(2);
    expect(vectorSearchFn).toHaveBeenCalledTimes(2);
    expect(first).toEqual(second);
  });

  it("handles very long query strings", async () => {
    const longQuery = `  ${"x".repeat(10000)}  `;
    const bm25SearchFn = vi.fn(() => [{ chunkId: "b1" }]);

    const result = await hybridSearch({ bm25Index: {} }, longQuery, { bm25SearchFn });

    expect(bm25SearchFn).toHaveBeenCalledTimes(1);
    expect(bm25SearchFn.mock.calls[0][1]).toBe("x".repeat(10000));
    expect(result.some((r) => r.chunkId === "b1")).toBe(true);
  });
});
