import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/retrieval/bm25.js", () => ({
  buildIndexAsync: vi.fn(),
  search: vi.fn(),
  serializeIndex: vi.fn(),
  deserializeIndex: vi.fn(),
}));

vi.mock("../../../../js/agents/retrieval/grep.js", () => ({
  grepChunks: vi.fn(),
  grepChunksAsync: vi.fn(),
}));

vi.mock("../../../../js/agents/retrieval/readaround.js", () => ({
  readAround: vi.fn(),
}));

vi.mock("../../../../js/agents/retrieval/scope.js", () => ({
  chunksInScope: vi.fn(),
  selectScope: vi.fn(),
}));

vi.mock("../../../../js/agents/retrieval/toc-builder.js", () => ({
  buildTocAsync: vi.fn(),
}));

vi.mock("../../../../js/agents/retrieval/mmr.js", () => ({
  mmrSelect: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isPlainObject: vi.fn(),
  checkCancelled: vi.fn(),
}));

import { retrieve, retrieveAsync, RetrievalRouter } from "../../../../js/agents/retrieval/retrieval-router.js";
import * as bm25 from "../../../../js/agents/retrieval/bm25.js";
import * as grep from "../../../../js/agents/retrieval/grep.js";
import * as readaround from "../../../../js/agents/retrieval/readaround.js";
import * as scope from "../../../../js/agents/retrieval/scope.js";
import * as toc from "../../../../js/agents/retrieval/toc-builder.js";
import * as mmr from "../../../../js/agents/retrieval/mmr.js";
import * as shared from "../../../../js/agents/shared/index.js";

const makeChunk = (chunkId, charStart, text = `text ${chunkId}`) => ({
  chunkId,
  text,
  locator: { charStart },
});

const makeSourceIndex = (chunks, extras = {}) => ({
  sourceId: "src1",
  chunks,
  ...extras,
});

beforeEach(() => {
  vi.clearAllMocks();

  shared.isPlainObject.mockImplementation((value) => {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  });

  shared.checkCancelled.mockImplementation((signal) => {
    if (signal && typeof signal === "object" && signal.aborted) {
      throw new Error("aborted");
    }
  });

  toc.buildTocAsync.mockResolvedValue({ tocNodes: [{ id: "root" }] });

  scope.selectScope.mockImplementation((tocNodes, targetId) => {
    return targetId ? { id: targetId } : null;
  });

  scope.chunksInScope.mockImplementation((chunks) => chunks);

  grep.grepChunks.mockReturnValue([]);
  grep.grepChunksAsync.mockResolvedValue([]);

  bm25.buildIndexAsync.mockImplementation(async (chunks) => ({
    chunkIds: Array.isArray(chunks) ? chunks.map((c) => String(c.chunkId)) : [],
  }));

  bm25.search.mockReturnValue([]);

  bm25.serializeIndex.mockImplementation((index) => ({
    schemaVersion: "0.1",
    chunkIds: Array.isArray(index?.chunkIds) ? index.chunkIds : [],
  }));

  bm25.deserializeIndex.mockImplementation((snapshot) => snapshot);

  mmr.mmrSelect.mockImplementation((items) => items || []);

  readaround.readAround.mockImplementation((chunks, hitIds, windowSize) => {
    if (!Array.isArray(chunks) || !Array.isArray(hitIds)) return [];
    const idSet = new Set(hitIds.map((id) => String(id)));
    const posById = new Map(chunks.map((c, idx) => [String(c.chunkId), idx]));
    const expanded = new Set();

    for (const id of idSet) {
      const pos = posById.get(String(id));
      if (pos === undefined) continue;
      const lo = Math.max(0, pos - windowSize);
      const hi = Math.min(chunks.length - 1, pos + windowSize);
      for (let i = lo; i <= hi; i++) expanded.add(String(chunks[i].chunkId));
    }

    return chunks.filter((c) => expanded.has(String(c.chunkId)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retrieve
// ─────────────────────────────────────────────────────────────────────────────

describe("retrieve", () => {
  it("throws on invalid input types", async () => {
    const chunks = [makeChunk("a", 0)];
    await expect(retrieve(null, [], {})).rejects.toThrow(/sourceIndex must be an object/);
    await expect(retrieve({ chunks: "nope" }, [], {})).rejects.toThrow(/sourceIndex\.chunks must be an array/);
    await expect(retrieve({ chunks }, {}, {})).rejects.toThrow(/gaps must be an array/);
    await expect(retrieve({ chunks }, [], [])).rejects.toThrow(/config must be an object/);
  });

  it("returns empty for empty gaps and blank queries", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks);
    const gaps = [null, undefined, "", "   ", {}, [], { query: "   " }];

    const result = await retrieve(sourceIndex, gaps, { useBm25: false });

    expect(result).toEqual([]);
    expect(grep.grepChunks).not.toHaveBeenCalled();
    expect(bm25.search).not.toHaveBeenCalled();
  });

  it("builds toc from large fullText when missing", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks, { fullText: "x".repeat(10000) });

    const result = await retrieve(sourceIndex, [], { useBm25: false });

    expect(result).toEqual([]);
    expect(toc.buildTocAsync).toHaveBeenCalledTimes(1);
    const [text, options] = toc.buildTocAsync.mock.calls[0];
    expect(text.length).toBe(10000);
    expect(options).toMatchObject({ yieldEveryLines: 800 });
  });

  it("uses grep sync, scores hits, merges gap ids, and sorts by charStart", async () => {
    const chunks = [makeChunk("b", 10, "hello b"), makeChunk("a", 0, "hello a")];
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunks.mockReturnValue([
      { chunkId: "a", matchCount: 2 },
      { chunkId: "b", matchCount: 1 },
    ]);

    const result = await retrieve(sourceIndex, [{ id: "gap-1", query: "hello" }], {
      useBm25: false,
      windowSize: 0,
    });

    expect(result.map((row) => row.chunkId)).toEqual(["a", "b"]);
    const a = result.find((row) => row.chunkId === "a");
    const b = result.find((row) => row.chunkId === "b");
    expect(a.relevance).toBe("hit");
    expect(b.relevance).toBe("hit");
    expect(a.matchedGapIds).toEqual(["gap-1"]);
    expect(b.matchedGapIds).toEqual(["gap-1"]);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("dedupes query hints and respects target section id", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks, { toc: [{ id: "sec1" }] });
    const gap = {
      gapId: "g1",
      queryHints: ["foo", " foo ", "bar", ""],
      query: "foo",
      targetSectionId: "sec1",
    };

    const result = await retrieve(sourceIndex, [gap], { useBm25: false });

    expect(result).toEqual([]);
    expect(toc.buildTocAsync).not.toHaveBeenCalled();
    expect(scope.selectScope).toHaveBeenCalledWith(sourceIndex.toc, "sec1");
    const queries = grep.grepChunks.mock.calls.map((call) => call[1]).sort();
    expect(queries).toEqual(["bar", "foo"]);
  });

  it("uses async grep when threshold forces async and passes options", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunksAsync.mockResolvedValue([{ chunkId: "a", matchCount: 3 }]);

    const result = await retrieve(sourceIndex, [{ query: "alpha" }], {
      useBm25: false,
      grepAsyncThreshold: -1,
      grepRegex: true,
      caseSensitive: true,
      grepYieldEvery: 5,
      windowSize: 0,
    });

    expect(grep.grepChunksAsync).toHaveBeenCalledTimes(1);
    expect(grep.grepChunks).not.toHaveBeenCalled();
    const options = grep.grepChunksAsync.mock.calls[0][2];
    expect(options).toMatchObject({ regex: true, caseSensitive: true, yieldEvery: 5 });
    expect(result.map((row) => row.chunkId)).toEqual(["a"]);
  });

  it("uses bm25 when grep hits are low and filters by scope and min score", async () => {
    const chunks = [makeChunk("a", 0), makeChunk("b", 10)];
    const sourceIndex = makeSourceIndex(chunks);
    scope.chunksInScope.mockImplementation((all) => [all[0]]);
    bm25.search.mockImplementation((index, query, limit, options) => {
      const out = [];
      for (let i = 0; i < index.chunkIds.length; i++) {
        if (options?.filterDocIndex && !options.filterDocIndex(i)) continue;
        out.push({ chunkId: index.chunkIds[i], score: i === 0 ? 0.6 : 0.4 });
      }
      return out;
    });

    const result = await retrieve(sourceIndex, [{ query: "bm25", sectionId: "secA" }], {
      useGrep: false,
      topK: 3,
      bm25MinScore: 0.5,
      windowSize: 0,
    });

    expect(scope.selectScope).toHaveBeenCalledWith([], "secA");
    expect(bm25.search).toHaveBeenCalled();
    expect(bm25.search.mock.calls[0][2]).toBe(15);
    expect(result.map((row) => row.chunkId)).toEqual(["a"]);
  });

  it("skips bm25 when grep hits meet minGrepHits", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunks.mockReturnValue([{ chunkId: "a", matchCount: 1 }]);

    await retrieve(sourceIndex, [{ query: "q" }], { minGrepHits: 1, windowSize: 0 });

    expect(bm25.search).not.toHaveBeenCalled();
  });

  it("defaults topK when non-numeric and limits results", async () => {
    const chunks = Array.from({ length: 9 }, (_, i) => makeChunk(`c${i}`, i));
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunks.mockReturnValue(chunks.map((c, idx) => ({ chunkId: c.chunkId, matchCount: idx + 1 })));

    const result = await retrieve(sourceIndex, [{ query: "q" }], {
      useBm25: false,
      topK: "2",
      windowSize: 0,
    });

    expect(result.length).toBe(8);
  });

  it("expands context with readAround and propagates gap ids", async () => {
    const chunks = [makeChunk("a", 0), makeChunk("b", 10), makeChunk("c", 20)];
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunks.mockReturnValue([{ chunkId: "b", matchCount: 2 }]);

    const result = await retrieve(sourceIndex, [{ gapId: "g1", query: "hit" }], {
      useBm25: false,
      windowSize: Number.MAX_SAFE_INTEGER,
    });

    expect(readaround.readAround).toHaveBeenCalledTimes(1);
    expect(result.map((row) => row.chunkId)).toEqual(["a", "b", "c"]);
    const a = result.find((row) => row.chunkId === "a");
    const b = result.find((row) => row.chunkId === "b");
    const c = result.find((row) => row.chunkId === "c");
    expect(a.relevance).toBe("context");
    expect(b.relevance).toBe("hit");
    expect(c.relevance).toBe("context");
    expect(a.matchedGapIds).toEqual(["g1"]);
    expect(c.matchedGapIds).toEqual(["g1"]);
  });

  it("skips context expansion when windowSize is zero", async () => {
    const chunks = [makeChunk("a", 0), makeChunk("b", 10)];
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunks.mockReturnValue([{ chunkId: "a", matchCount: 1 }]);

    const result = await retrieve(sourceIndex, [{ query: "q" }], { useBm25: false, windowSize: 0 });

    expect(readaround.readAround).not.toHaveBeenCalled();
    expect(result.map((row) => row.chunkId)).toEqual(["a"]);
  });

  it("applies mmr selection to filter hits", async () => {
    const chunks = [makeChunk("a", 0), makeChunk("b", 10)];
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunks.mockReturnValue([
      { chunkId: "a", matchCount: 2 },
      { chunkId: "b", matchCount: 1 },
    ]);
    mmr.mmrSelect.mockImplementation((items) => items.slice(0, 1));

    const result = await retrieve(sourceIndex, [{ gapId: "g1", query: "q" }], {
      useBm25: false,
      windowSize: 0,
      mmr: { topK: 1, lambda: 0.5, seedByGap: false },
    });

    expect(mmr.mmrSelect).toHaveBeenCalledTimes(1);
    expect(result.length).toBe(1);
    expect(result[0].chunkId).toBe("a");
  });

  it("uses compatible bm25 cache and persists by key", async () => {
    const chunks = [makeChunk("a", 0), makeChunk("b", 10)];
    const sourceIndex = makeSourceIndex(chunks, { sourceId: "srcA", textHash: "hash1" });
    const cache = { get: vi.fn(), set: vi.fn() };
    const store = { get: vi.fn(), set: vi.fn() };
    const index = { chunkIds: ["a", "b"] };
    cache.get.mockReturnValue(index);

    const result = await retrieve(sourceIndex, [{ query: "q" }], {
      useGrep: false,
      bm25IndexCache: cache,
      bm25IndexStore: store,
      windowSize: 0,
    });

    expect(bm25.buildIndexAsync).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
    expect(cache.get).toHaveBeenCalledTimes(1);
    const key = cache.get.mock.calls[0][0];
    expect(key).toContain("bm25|srcA|hash1|");
    expect(cache.set).toHaveBeenCalledWith(key, index);
    expect(result).toEqual([]);
  });

  it("falls back when store snapshot is too large", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks);
    const store = { get: vi.fn(), set: vi.fn() };
    const logger = { warn: vi.fn() };
    store.get.mockResolvedValue("a".repeat(2 * 1024 * 1024 + 1));

    await retrieve(sourceIndex, [{ query: "q" }], {
      bm25IndexStore: store,
      logger,
      useGrep: false,
      windowSize: 0,
    });

    expect(logger.warn).toHaveBeenCalled();
    expect(bm25.buildIndexAsync).toHaveBeenCalled();
    expect(store.set).toHaveBeenCalled();
  });

  it("propagates cancellation errors", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks);
    const controller = new AbortController();
    controller.abort();

    await expect(
      retrieve(sourceIndex, [{ query: "q" }], { signal: controller.signal })
    ).rejects.toThrow(/aborted/);
  });

  it("handles long queries and deep nested hints", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks);
    const longQuery = "x".repeat(10000);
    const gap = { queryHints: [[[{ key: "nested" }]]], query: longQuery };

    const result = await retrieve(sourceIndex, [gap], { useBm25: false, windowSize: 0 });

    expect(result).toEqual([]);
    const queries = grep.grepChunks.mock.calls.map((call) => call[1]);
    expect(queries).toEqual(["[object Object]", longQuery]);
  });

  it("handles concurrent calls independently", async () => {
    const chunks = [makeChunk("a", 0), makeChunk("b", 10)];
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunks.mockImplementation((scopedChunks, query) => {
      if (query === "alpha") return [{ chunkId: "a", matchCount: 2 }];
      if (query === "beta") return [{ chunkId: "b", matchCount: 3 }];
      return [];
    });

    const [res1, res2] = await Promise.all([
      retrieve(sourceIndex, [{ query: "alpha" }], { useBm25: false, windowSize: 0 }),
      retrieve(sourceIndex, [{ query: "beta" }], { useBm25: false, windowSize: 0 }),
    ]);

    expect(res1.map((row) => row.chunkId)).toEqual(["a"]);
    expect(res2.map((row) => row.chunkId)).toEqual(["b"]);
  });

  it("handles rapid sequential calls with topK bounds", async () => {
    const chunks = [makeChunk("a", 0), makeChunk("b", 10)];
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunks.mockReturnValue([
      { chunkId: "a", matchCount: 2 },
      { chunkId: "b", matchCount: 1 },
    ]);

    const res1 = await retrieve(sourceIndex, [{ query: "q" }], { useBm25: false, topK: 0, windowSize: 0 });
    const res2 = await retrieve(sourceIndex, [{ query: "q" }], { useBm25: false, topK: -1, windowSize: 0 });

    expect(res1.length).toBe(1);
    expect(res2.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retrieveAsync
// ─────────────────────────────────────────────────────────────────────────────

describe("retrieveAsync", () => {
  it("delegates to retrieve", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks);
    grep.grepChunks.mockReturnValue([{ chunkId: "a", matchCount: 1 }]);

    const result = await retrieveAsync(sourceIndex, [{ query: "q" }], { useBm25: false, windowSize: 0 });

    expect(result.map((row) => row.chunkId)).toEqual(["a"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RetrievalRouter
// ─────────────────────────────────────────────────────────────────────────────

describe("RetrievalRouter", () => {
  it("merges default config with per-call overrides", async () => {
    const chunks = [makeChunk("a", 0), makeChunk("b", 10)];
    const sourceIndex = makeSourceIndex(chunks);
    const router = new RetrievalRouter({ useGrep: false, useBm25: false, topK: 2, windowSize: 0 });
    grep.grepChunks.mockReturnValue([{ chunkId: "a", matchCount: 1 }]);

    const result = await router.retrieve(sourceIndex, [{ query: "q" }], { useGrep: true, topK: 1 });

    expect(grep.grepChunks).toHaveBeenCalledTimes(1);
    expect(result.length).toBe(1);
  });

  it("uses default config when provided config is not an object", async () => {
    const chunks = [makeChunk("a", 0)];
    const sourceIndex = makeSourceIndex(chunks);
    const router = new RetrievalRouter({ useGrep: false, useBm25: false, windowSize: 0 });

    const result = await router.retrieveAsync(sourceIndex, [{ query: "q" }], "invalid");

    expect(result).toEqual([]);
    expect(grep.grepChunks).not.toHaveBeenCalled();
  });
});
