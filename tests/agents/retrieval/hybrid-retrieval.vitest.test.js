import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("agents/retrieval/hybrid-retrieval", () => {
  it("rrfFuse merges two ranked lists with weights and keeps per-source scores", async () => {
    const { rrfFuse } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const fused = rrfFuse(
      [
        { chunkId: "a", score: 10 },
        { chunkId: "b", score: 9 },
      ],
      [
        { chunkId: "b", score: 0.9 },
        { chunkId: "c", score: 0.8 },
      ],
      { limit: 10, rrfK: 1, bm25Weight: 1, vectorWeight: 1 }
    );

    expect(fused.map((r) => r.chunkId)).toEqual(["b", "a", "c"]);
    expect(fused[0].rrfScore).toBeCloseTo(0.8333333, 6);
    expect(fused[0].bm25Score).toBe(9);
    expect(fused[0].vectorScore).toBe(0.9);
  });

  it("hybridSearch calls both retrievers and returns fused topK results", async () => {
    const { hybridSearch } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const bm25Index = { kind: "bm25" };
    const vectorIndex = { kind: "vector" };

    const bm25SearchFn = vi.fn().mockReturnValue([
      { chunkId: "a", score: 2 },
      { chunkId: "b", score: 1 },
    ]);
    const vectorSearchFn = vi.fn().mockResolvedValue([
      { chunkId: "b", score: 0.9 },
      { chunkId: "c", score: 0.8 },
    ]);

    const embeddingService = { embed: vi.fn() };

    const out = await hybridSearch(
      { bm25Index, vectorIndex },
      " query ",
      { limit: 2, rrfK: 1, bm25Weight: 2, vectorWeight: 1, bm25SearchFn, vectorSearchFn, embeddingService }
    );

    expect(bm25SearchFn).toHaveBeenCalledWith(bm25Index, "query", 10, {});
    expect(vectorSearchFn).toHaveBeenCalledWith(vectorIndex, "query", 10, { embeddingService });

    expect(out.map((r) => r.chunkId)).toEqual(["b", "a"]);
    expect(out[0].rrfScore).toBeGreaterThan(out[1].rrfScore);
    expect(out[0].bm25Score).toBe(1);
    expect(out[0].vectorScore).toBe(0.9);
    expect(out[1].bm25Score).toBe(2);
  });

  it("hybridSearch keeps the other side when a retriever fails (fallback=true)", async () => {
    const { hybridSearch } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const bm25SearchFn = vi.fn().mockReturnValue([{ chunkId: "a", score: 1 }]);
    const vectorSearchFn = vi.fn().mockRejectedValue(new Error("boom"));

    const out = await hybridSearch(
      { bm25Index: { ok: true }, vectorIndex: { ok: true } },
      "alpha",
      { limit: 3, rrfK: 1, bm25SearchFn, vectorSearchFn, fallback: true }
    );

    expect(vectorSearchFn).toHaveBeenCalled();
    expect(out.map((r) => r.chunkId)).toEqual(["a"]);
  });

  it("hybridSearch throws when fallback=false and a retriever fails", async () => {
    const { hybridSearch } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const bm25SearchFn = vi.fn().mockReturnValue([{ chunkId: "a", score: 1 }]);
    const vectorSearchFn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      hybridSearch(
        { bm25Index: { ok: true }, vectorIndex: { ok: true } },
        "alpha",
        { limit: 3, rrfK: 1, bm25SearchFn, vectorSearchFn, fallback: false }
      )
    ).rejects.toThrow(/vector search failed/i);
  });

  it("hybridSearch throws when fallback=false and bm25 fails", async () => {
    const { hybridSearch } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const bm25SearchFn = vi.fn(() => {
      throw new Error("bm25 boom");
    });

    await expect(
      hybridSearch(
        { bm25Index: { ok: true } },
        "alpha",
        { limit: 3, rrfK: 1, bm25SearchFn, fallback: false }
      )
    ).rejects.toThrow(/bm25 failed/i);
  });

  it("hybridSearch returns [] for blank queries and validates inputs", async () => {
    const { hybridSearch, rrfFuse } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    await expect(hybridSearch({ bm25Index: {} }, "   ", {})).resolves.toEqual([]);

    expect(() => rrfFuse(null, [], {})).toThrow(/bm25Results must be an array/i);
    await expect(hybridSearch(null, "q", {})).rejects.toThrow(/indexes must be an object/i);
    await expect(hybridSearch({}, 123, {})).rejects.toThrow(/query must be a string/i);
    await expect(hybridSearch({}, "q", null)).rejects.toThrow(/options must be an object/i);
  });

  it("rrfFuse returns all results when limit=Infinity and breaks ties by chunkId", async () => {
    const { rrfFuse } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const out = rrfFuse(
      [
        { chunkId: "a", score: 1 },
        { chunkId: "b", score: 1 },
      ],
      [
        { chunkId: "b", score: 2 },
        { chunkId: "a", score: 2 },
      ],
      { limit: Infinity, rrfK: 1 }
    );

    expect(out.map((r) => r.chunkId)).toEqual(["a", "b"]);
  });

  it("rrfFuse ignores invalid chunkIds, drops non-finite scores, and normalizes weights", async () => {
    const { rrfFuse } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const out = rrfFuse(
      [
        { chunkId: "   ", score: 10 }, // invalid id => ignored
        { chunkId: "a", score: Number.NaN }, // non-finite => no bm25Score
        { chunkId: "a", score: 2 }, // duplicate id => keeps max score
      ],
      [
        { chunkId: "a", score: 1 },
        { chunkId: null, score: 5 }, // invalid id => ignored
      ],
      { limit: 10, rrfK: 1, bm25Weight: -5, vectorWeight: "2" }
    );

    expect(out).toHaveLength(1);
    expect(out[0].chunkId).toBe("a");
    expect(out[0].bm25Score).toBe(2);
    expect(out[0].vectorScore).toBe(1);
  });

  it("hybridSearch supports limit=Infinity and forwards options (incl. embeddingService override)", async () => {
    const { hybridSearch } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const bm25SearchFn = vi.fn().mockReturnValue([{ chunkId: "a", score: 2 }]);
    const vectorSearchFn = vi.fn().mockResolvedValue([{ chunkId: "b", score: 0.5 }]);
    const embeddingService = { embed: vi.fn() };

    const out = await hybridSearch(
      { bm25Index: { kind: "bm25" }, vectorIndex: { kind: "vector" } },
      " query ",
      {
        limit: Infinity,
        rrfK: 1,
        bm25SearchFn,
        vectorSearchFn,
        bm25Options: "nope",
        vectorOptions: { partitions: "p1", embeddingService: { embed: vi.fn() } },
        embeddingService,
      }
    );

    expect(bm25SearchFn).toHaveBeenCalledWith({ kind: "bm25" }, "query", 10_000, {});
    expect(vectorSearchFn).toHaveBeenCalledWith({ kind: "vector" }, "query", 10_000, { partitions: "p1", embeddingService });
    expect(out.map((r) => r.chunkId)).toEqual(["a", "b"]);
  });

  it("hybridSearch coerces limit and converts non-array retriever results to []", async () => {
    const { hybridSearch } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const bm25SearchFn = vi.fn().mockReturnValue(null);
    const vectorSearchFn = vi.fn().mockResolvedValue("not-an-array");

    const out = await hybridSearch(
      { bm25Index: { ok: true }, vectorIndex: { ok: true } },
      "alpha",
      { limit: "3", bm25SearchFn, vectorSearchFn }
    );

    expect(bm25SearchFn).toHaveBeenCalledWith({ ok: true }, "alpha", 10, {});
    expect(vectorSearchFn).toHaveBeenCalledWith({ ok: true }, "alpha", 10, {});
    expect(out).toEqual([]);
  });

  it("hybridSearch keeps vector results when bm25 fails and fallback=true (default)", async () => {
    const { hybridSearch } = await import("../../../js/agents/retrieval/hybrid-retrieval.js");

    const bm25SearchFn = vi.fn(() => {
      throw new Error("bm25 boom");
    });
    const vectorSearchFn = vi.fn().mockResolvedValue([{ chunkId: "a", score: 1 }]);

    const out = await hybridSearch(
      { bm25Index: { ok: true }, vectorIndex: { ok: true } },
      "alpha",
      { bm25SearchFn, vectorSearchFn }
    );

    expect(out.map((r) => r.chunkId)).toEqual(["a"]);
  });
});
