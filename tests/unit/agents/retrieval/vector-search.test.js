import { afterEach, describe, expect, it, vi } from "vitest";

import { VectorIndex } from '../../../../js/agents/shared/embeddings/vector-index.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("agents/retrieval/vector-search", () => {
  it("buildIndex indexes provided embeddings and search returns highest cosine matches", async () => {
    const { buildIndex, search } = await import("../../../js/agents/retrieval/vector-search.js");

    const chunks = [
      { chunkId: "a", text: "A", embedding: [1, 0] },
      { chunkId: "b", text: "B", embedding: [0, 1] },
      { chunkId: "c", text: "C", embedding: [1, 1] },
    ];

    const index = buildIndex(chunks, { maxItems: 10 });
    const hits = search(index, [1, 0], 3);

    expect(hits.map((h) => h.chunkId)).toEqual(["a", "c", "b"]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("buildIndex generates fallback chunkIds and skips dimension mismatches", async () => {
    const { buildIndex } = await import("../../../js/agents/retrieval/vector-search.js");

    const index = buildIndex([
      { text: "no id", embedding: [1, 0] },
      { chunkId: "bad", text: "bad dim", embedding: [1, 0, 0] },
    ]);

    expect(index.chunkIds[0]).toBe("chunk_1");
    expect(index.vectorIndex.has("chunk_1")).toBe(true);

    // Second vector mismatches first dim; upsert throws and buildIndex skips it.
    expect(index.vectorIndex.has("bad")).toBe(false);
    expect(index.vectorIndex.size).toBe(1);
  });

  it("search supports filterChunkId, minScore, and partition filtering (delegates to VectorIndex)", async () => {
    const { search } = await import("../../../js/agents/retrieval/vector-search.js");

    const idx = new VectorIndex({ maxItems: 10 });
    const now = Date.now();

    // Two normalized orthogonal vectors; only one is 'hot'.
    idx.upsert("hot", [1, 0], { ts: now });
    idx.upsert("cold", [0, 1], { ts: now - 10 * 24 * 60 * 60 * 1000 });

    expect(search(idx, [1, 0], 10, { partitions: "hot" }).map((h) => h.chunkId)).toEqual(["hot"]);
    expect(search(idx, [1, 0], 10, { partitions: "warm" })).toEqual([]);

    expect(search(idx, [1, 0], 10, { filterChunkId: (id) => id === "cold" })).toEqual([{ chunkId: "cold", score: 0 }]);
    expect(search(idx, [1, 0], 10, { filterChunkId: () => false })).toEqual([]);
    expect(search(idx, [1, 0], 10, { minScore: 0.9 }).map((h) => h.chunkId)).toEqual(["hot"]);
  });

  it("buildIndexAsync embeds chunk texts and tolerates short embedding responses", async () => {
    const { buildIndexAsync, search } = await import("../../../js/agents/retrieval/vector-search.js");

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([
        [1, 0],
        // Second vector intentionally missing to simulate a partial response.
      ]),
    };

    const index = await buildIndexAsync(
      [
        { chunkId: "c1", text: "alpha" },
        { chunkId: "c2", text: "beta" },
      ],
      { embeddingService }
    );

    expect(embeddingService.embed).toHaveBeenCalledWith(["alpha", "beta"], {});
    expect(index.vectorIndex.size).toBe(1);
    expect(search(index, [1, 0], 10).map((h) => h.chunkId)).toEqual(["c1"]);
  });

  it("validates inputs and forwards timeout/signal options to the embedding service", async () => {
    const { buildIndex, buildIndexAsync, search, searchAsync } = await import("../../../js/agents/retrieval/vector-search.js");

    expect(() => buildIndex(null)).toThrow(/chunks must be an array/i);
    expect(() => buildIndex([], null)).toThrow(/options must be an object/i);
    expect(() => search({}, [1, 0], 3)).toThrow(/VectorIndex-like/i);
    expect(() => search(new VectorIndex({ maxItems: 10 }), [1, 0], 3, null)).toThrow(/options must be an object/i);

    const controller = new AbortController();
    const svc = { embed: vi.fn().mockResolvedValue([[1, 0]]) };

    await buildIndexAsync([{ chunkId: "c1", text: "alpha" }], { embeddingService: svc, timeoutMs: 123, signal: controller.signal });
    expect(svc.embed).toHaveBeenCalledWith(["alpha"], { timeoutMs: 123, signal: controller.signal });

    svc.embed.mockClear();
    const index = buildIndex([{ chunkId: "c1", text: "alpha", embedding: [1, 0] }]);
    await searchAsync(index, "alpha", 1, { embeddingService: svc, timeoutMs: 5, signal: controller.signal });
    expect(svc.embed).toHaveBeenCalledWith(["alpha"], { timeoutMs: 5, signal: controller.signal });

    // Infinity means "up to index size".
    expect(search(index, [1, 0], Infinity).length).toBe(1);
  });

  it("searchAsync embeds the query and returns [] for missing service / blank query / empty vectors", async () => {
    const { buildIndex, buildIndexAsync, searchAsync } = await import("../../../js/agents/retrieval/vector-search.js");

    const index = buildIndex([{ chunkId: "c1", text: "alpha", embedding: [1, 0] }]);

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([[1, 0]]),
    };

    await expect(searchAsync(index, " alpha ", 3, { embeddingService })).resolves.toEqual([{ chunkId: "c1", score: 1 }]);
    expect(embeddingService.embed).toHaveBeenCalledWith(["alpha"], {});

    // Blank query is rejected early (no embed call).
    await expect(searchAsync(index, "   ", 3, { embeddingService })).resolves.toEqual([]);

    // Empty embedding responses yield no hits.
    const emptySvc = { embed: vi.fn().mockResolvedValue([]) };
    await expect(searchAsync(index, "alpha", 3, { embeddingService: emptySvc })).resolves.toEqual([]);

    await expect(searchAsync(index, "alpha", 3, {})).resolves.toEqual([]);
    await expect(searchAsync(index, "alpha", 3, { embeddingService: null })).resolves.toEqual([]);

    await expect(searchAsync(index, 123)).rejects.toThrow(/query must be a string/i);
    await expect(searchAsync(index, "alpha", 3, null)).rejects.toThrow(/options must be an object/i);

    await expect(buildIndexAsync([], {})).rejects.toThrow(/embeddingService must provide embed/i);
  });

  it("buildIndex can use an injected VectorIndex-like instance and a custom getEmbedding accessor", async () => {
    const { buildIndex } = await import("../../../js/agents/retrieval/vector-search.js");

    const injected = {
      upsert: vi.fn(),
      search: vi.fn(),
    };

    const index = buildIndex(
      [
        { chunkId: "c1", vector: [1, 0] },
        { text: "no id", vector: [0, 1] },
        { chunkId: "c3" }, // no embedding => skipped
      ],
      { vectorIndex: injected, getEmbedding: (c) => c?.vector }
    );

    expect(index.vectorIndex).toBe(injected);
    expect(index.chunkIds).toEqual(["c1", "chunk_2", "c3"]);
    expect(injected.upsert).toHaveBeenCalledWith("c1", [1, 0], { chunkId: "c1", docIndex: 0 });
    expect(injected.upsert).toHaveBeenCalledWith("chunk_2", [0, 1], { chunkId: "chunk_2", docIndex: 1 });
    expect(injected.upsert).toHaveBeenCalledTimes(2);
  });

  it("search filters out invalid hit entries (missing id) and supports wrapper { vectorIndex } inputs", async () => {
    const { search } = await import("../../../js/agents/retrieval/vector-search.js");

    const injected = {
      upsert: vi.fn(),
      search: vi.fn().mockReturnValue([null, { id: "x", score: 0.5 }, { id: "", score: 1 }, { id: "y" }]),
      size: 123,
    };

    const out = search({ vectorIndex: injected }, [0, 0], 5);
    expect(injected.search).toHaveBeenCalledWith([0, 0], { topK: 5 });
    expect(out).toEqual([
      { chunkId: "x", score: 0.5 },
      { chunkId: "y", score: 0 },
    ]);
  });

  it("buildIndexAsync tolerates non-array embedding responses and ignores upsert errors", async () => {
    const { buildIndexAsync } = await import("../../../js/agents/retrieval/vector-search.js");

    const injected = {
      upsert: vi
        .fn()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw new Error("bad vector");
        }),
      search: vi.fn(),
    };

    const svc = { embed: vi.fn().mockResolvedValue([[1], [2]]) };
    const index = await buildIndexAsync(
      [
        { chunkId: "a", text: "t1" },
        { chunkId: "b", text: "t2" },
      ],
      { embeddingService: svc, vectorIndex: injected }
    );

    expect(index.chunkIds).toEqual(["a", "b"]);
    expect(injected.upsert).toHaveBeenCalledTimes(2);

    // Non-array embed response => treated as [] (no upserts).
    injected.upsert.mockClear();
    const svcBad = { embed: vi.fn().mockResolvedValue("nope") };
    await buildIndexAsync([{ chunkId: "c", text: "t" }], { embeddingService: svcBad, vectorIndex: injected });
    expect(injected.upsert).not.toHaveBeenCalled();
  });

  it("searchAsync returns [] when embeddingService.embed does not return an array", async () => {
    const { buildIndex, searchAsync } = await import("../../../js/agents/retrieval/vector-search.js");

    const index = buildIndex([{ chunkId: "c1", text: "alpha", embedding: [1, 0] }]);
    const badSvc = { embed: vi.fn().mockResolvedValue("nope") };

    await expect(searchAsync(index, "alpha", 3, { embeddingService: badSvc })).resolves.toEqual([]);
  });
});
