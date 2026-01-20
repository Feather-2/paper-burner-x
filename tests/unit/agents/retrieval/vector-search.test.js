import { describe, it, expect, vi, beforeEach } from "vitest";

const modulePath = "../../../../js/agents/retrieval/vector-search.js";

vi.mock("../../../../js/agents/shared/index.js", () => {
  const isPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const toNonEmptyString = (value) => {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
  };

  const toPositiveInt = (value, fallback = 1) => {
    const raw = typeof value === "string" ? value.trim() : value;
    const num = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(num)) {
      if (typeof raw === "string" && raw.length) {
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
      }
      return fallback;
    }
    const floored = Math.floor(num);
    return floored > 0 ? floored : fallback;
  };

  const VectorIndex = vi.fn().mockImplementation(function ({ maxItems } = {}) {
    this.maxItems = maxItems;
    this.items = new Map();
    this.size = 0;
    this.upsert = vi.fn((id, vector, meta) => {
      if (vector && vector.throwOnUpsert) {
        throw new Error("bad vector");
      }
      this.items.set(id, { vector, meta });
      this.size = this.items.size;
    });
    this.search = vi.fn((_queryVector, _opts) => []);
  });

  return { isPlainObject, toNonEmptyString, toPositiveInt, VectorIndex };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("buildIndex", () => {
  it("throws on invalid chunks/options types", async () => {
    const { buildIndex } = await import(modulePath);

    expect(() => buildIndex()).toThrow(/chunks must be an array/i);
    expect(() => buildIndex(null)).toThrow(/chunks must be an array/i);
    expect(() => buildIndex({})).toThrow(/chunks must be an array/i);
    expect(() => buildIndex([], null)).toThrow(/options must be an object/i);
    expect(() => buildIndex([], [])).toThrow(/options must be an object/i);
  });

  it("handles empty chunks with default options", async () => {
    const { buildIndex } = await import(modulePath);

    const index = buildIndex([], {});

    expect(index.chunkIds).toEqual([]);
    expect(index.vectorIndex.size).toBe(0);
    expect(index.vectorIndex.maxItems).toBe(1000);
  });

  it("uses maxItems boundaries and numeric strings", async () => {
    const { buildIndex } = await import(modulePath);

    const fromString = buildIndex([], { maxItems: "7" });
    const fromZero = buildIndex([], { maxItems: 0 });
    const fromNegative = buildIndex([], { maxItems: -1 });
    const fromMax = buildIndex([], { maxItems: Number.MAX_SAFE_INTEGER });

    expect(fromString.vectorIndex.maxItems).toBe(7);
    expect(fromZero.vectorIndex.maxItems).toBe(1000);
    expect(fromNegative.vectorIndex.maxItems).toBe(1000);
    expect(fromMax.vectorIndex.maxItems).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("normalizes chunkIds, handles deep embeddings, and skips invalid upserts", async () => {
    const { buildIndex } = await import(modulePath);

    const longId = `id_${"x".repeat(1024)}`;
    const index = buildIndex(
      [
        { chunkId: "", vector: [1] },
        { chunkId: "   ", vector: [2] },
        { chunkId: longId, vector: [3] },
        { chunkId: "deep", meta: { inner: { embedding: [4] } } },
        { chunkId: "error", vector: { throwOnUpsert: true } },
        { chunkId: "missing" },
      ],
      { getEmbedding: (chunk) => chunk.vector ?? chunk.meta?.inner?.embedding }
    );

    expect(index.chunkIds).toEqual(["chunk_1", "chunk_2", longId, "deep", "error", "missing"]);
    expect(index.vectorIndex.items.has("chunk_1")).toBe(true);
    expect(index.vectorIndex.items.has("chunk_2")).toBe(true);
    expect(index.vectorIndex.items.has(longId)).toBe(true);
    expect(index.vectorIndex.items.has("deep")).toBe(true);
    expect(index.vectorIndex.items.has("error")).toBe(false);
    expect(index.vectorIndex.items.has("missing")).toBe(false);
    expect(index.vectorIndex.size).toBe(4);
    expect(index.vectorIndex.upsert).toHaveBeenCalledTimes(5);
  });

  it("uses an injected vector index instance", async () => {
    const { buildIndex } = await import(modulePath);

    const injected = { upsert: vi.fn(), search: vi.fn() };
    const index = buildIndex([{ chunkId: "c1", embedding: [1] }], { vectorIndex: injected });

    expect(index.vectorIndex).toBe(injected);
    expect(injected.upsert).toHaveBeenCalledWith("c1", [1], { chunkId: "c1", docIndex: 0 });
  });
});

describe("buildIndexAsync", () => {
  it("throws on invalid chunks/options and missing embeddingService", async () => {
    const { buildIndexAsync } = await import(modulePath);

    await expect(buildIndexAsync()).rejects.toThrow(/chunks must be an array/i);
    await expect(buildIndexAsync(null)).rejects.toThrow(/chunks must be an array/i);
    await expect(buildIndexAsync({})).rejects.toThrow(/chunks must be an array/i);
    await expect(buildIndexAsync([], null)).rejects.toThrow(/options must be an object/i);
    await expect(buildIndexAsync([], [])).rejects.toThrow(/options must be an object/i);
    await expect(buildIndexAsync([], {})).rejects.toThrow(/embeddingService must provide embed/i);
    await expect(buildIndexAsync([], { embeddingService: {} })).rejects.toThrow(/embeddingService must provide embed/i);
  });

  it("embeds texts with normalization and forwards timeout/signal", async () => {
    const { buildIndexAsync } = await import(modulePath);

    const controller = new AbortController();
    const longText = "l".repeat(10000);
    const embeddingService = {
      embed: vi.fn().mockResolvedValue([[1], [2], [3], [4]]),
    };

    const index = await buildIndexAsync(
      [
        { chunkId: "", text: "alpha" },
        { chunkId: "   ", text: null },
        { chunkId: "c3", text: 0 },
        { chunkId: "c4", text: longText },
      ],
      { embeddingService, timeoutMs: 500, signal: controller.signal }
    );

    expect(embeddingService.embed).toHaveBeenCalledWith(["alpha", "", "0", longText], {
      timeoutMs: 500,
      signal: controller.signal,
    });
    expect(index.chunkIds).toEqual(["chunk_1", "chunk_2", "c3", "c4"]);
    expect(index.vectorIndex.size).toBe(4);
  });

  it("skips missing vectors and ignores upsert errors on injected indexes", async () => {
    const { buildIndexAsync } = await import(modulePath);

    const embeddingService = {
      embed: vi.fn().mockResolvedValue([[1], null, { throwOnUpsert: true }]),
    };
    const injected = {
      upsert: vi.fn((id, vector) => {
        if (vector && vector.throwOnUpsert) throw new Error("bad vector");
      }),
      search: vi.fn(),
    };

    const index = await buildIndexAsync(
      [
        { chunkId: "a", text: "t1" },
        { chunkId: "b", text: "t2" },
        { chunkId: "c", text: "t3" },
      ],
      { embeddingService, vectorIndex: injected }
    );

    expect(index.vectorIndex).toBe(injected);
    expect(index.chunkIds).toEqual(["a", "b", "c"]);
    expect(injected.upsert).toHaveBeenCalledTimes(2);
    expect(injected.upsert).toHaveBeenCalledWith("a", [1], { chunkId: "a", docIndex: 0 });
    expect(injected.upsert).toHaveBeenCalledWith("c", { throwOnUpsert: true }, { chunkId: "c", docIndex: 2 });
  });

  it("treats non-array embedding responses as empty", async () => {
    const { buildIndexAsync } = await import(modulePath);

    const embeddingService = { embed: vi.fn().mockResolvedValue("nope") };
    const index = await buildIndexAsync([{ chunkId: "x", text: "t" }], { embeddingService });

    expect(index.vectorIndex.size).toBe(0);
  });

  it("supports concurrent builds with independent indexes", async () => {
    const { buildIndexAsync } = await import(modulePath);

    const embeddingService = {
      embed: vi.fn(async (texts) => texts.map((text) => [text.length])),
    };

    const [first, second] = await Promise.all([
      buildIndexAsync([{ chunkId: "a", text: "alpha" }], { embeddingService }),
      buildIndexAsync([{ text: "beta" }, { text: "gamma" }], { embeddingService }),
    ]);

    expect(embeddingService.embed).toHaveBeenCalledTimes(2);
    const calls = embeddingService.embed.mock.calls.map((call) => call[0]);
    expect(calls).toEqual(expect.arrayContaining([["alpha"], ["beta", "gamma"]]));
    for (const call of embeddingService.embed.mock.calls) {
      expect(call[1]).toEqual({});
    }
    expect(first.chunkIds).toEqual(["a"]);
    expect(second.chunkIds).toEqual(["chunk_1", "chunk_2"]);
    expect(first.vectorIndex).not.toBe(second.vectorIndex);
    expect(first.vectorIndex.size).toBe(1);
    expect(second.vectorIndex.size).toBe(2);
  });
});

describe("search", () => {
  it("throws on invalid index/options types and tolerates non-array results", async () => {
    const { search } = await import(modulePath);

    expect(() => search(null, [1])).toThrow(/VectorIndex-like/i);
    expect(() => search(undefined, [1])).toThrow(/VectorIndex-like/i);
    expect(() => search({}, [1])).toThrow(/VectorIndex-like/i);

    const idx = { upsert: vi.fn(), search: vi.fn().mockReturnValue("nope"), size: 1 };
    expect(() => search(idx, [1], 3, null)).toThrow(/options must be an object/i);
    expect(() => search(idx, [1], 3, [])).toThrow(/options must be an object/i);
    expect(search(idx, [1], 3, {})).toEqual([]);
  });

  it("normalizes topK, forwards partitions/minScore, and handles edge values", async () => {
    const { search } = await import(modulePath);

    const idx = { upsert: vi.fn(), search: vi.fn().mockReturnValue([]), size: 9 };
    const hugeVector = new Array(5000).fill(1);

    search(idx, hugeVector, "3", { minScore: 0.25, partitions: "p1" });
    expect(idx.search.mock.calls[0][1]).toEqual({ topK: 3, minScore: 0.25, partitions: "p1" });

    search(idx, [1], 0, {});
    expect(idx.search.mock.calls[1][1].topK).toBe(8);

    search(idx, [1], -1, {});
    expect(idx.search.mock.calls[2][1].topK).toBe(8);

    search(idx, [1], Infinity, {});
    expect(idx.search.mock.calls[3][1].topK).toBe(9);

    search(idx, [1], Number.MAX_SAFE_INTEGER, {});
    expect(idx.search.mock.calls[4][1].topK).toBe(Number.MAX_SAFE_INTEGER);

    search(idx, [1], 2, { minScore: "0.5" });
    expect("minScore" in idx.search.mock.calls[5][1]).toBe(false);
  });

  it("maps hits, applies filterChunkId, and supports wrapper indexes", async () => {
    const { search } = await import(modulePath);

    const hits = [
      null,
      { id: "keep", score: "0.9" },
      { id: 123, score: 0.5 },
      { id: "", score: 1 },
      { score: 0.2 },
      { id: "zero", score: 0 },
    ];
    const idx = {
      size: hits.length,
      upsert: vi.fn(),
      search: vi.fn((_queryVector, opts) => {
        if (opts?.filter) {
          return hits.filter((hit) => hit && hit.id && opts.filter({}, hit.id));
        }
        return hits;
      }),
    };
    const filterChunkId = vi.fn((id) => id !== "123");

    const result = search({ vectorIndex: idx }, [0], 5, { filterChunkId });

    expect(filterChunkId).toHaveBeenCalledWith("keep");
    expect(filterChunkId).toHaveBeenCalledWith("123");
    expect(filterChunkId).toHaveBeenCalledWith("zero");
    expect(result).toEqual([
      { chunkId: "keep", score: 0.9 },
      { chunkId: "zero", score: 0 },
    ]);
  });
});
