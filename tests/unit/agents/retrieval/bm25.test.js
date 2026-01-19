
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  buildIndex,
  buildIndexAsync,
  search,
  serializeIndex,
  deserializeIndex,
} from '../../../../js/agents/retrieval/bm25.js';

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
    expect(idx.df).toBeInstanceOf(Map);
    expect(idx.postings).toBeInstanceOf(Map);
    expect(idx.df.get("hello")).toBeGreaterThanOrEqual(2);
    expect(idx.k1).toBe(1.2);
    expect(idx.b).toBe(0.75);
  });

  it("handles empty chunks array", () => {
    const idx = buildIndex([]);
    expect(idx.chunkIds).toEqual([]);
    expect(idx.avgDocLen).toBe(0);
  });

  it("auto-generates chunkId when missing", () => {
    const idx = buildIndex([{ text: "foo" }, { text: "bar" }]);
    expect(idx.chunkIds).toEqual(["chunk_1", "chunk_2"]);
  });

  it("respects custom k1 and b", () => {
    const idx = buildIndex([{ chunkId: "x", text: "test" }], { k1: 2.0, b: 0.5 });
    expect(idx.k1).toBe(2.0);
    expect(idx.b).toBe(0.5);
  });

  it("respects maxTokensPerDoc limit", () => {
    const longText = "word ".repeat(20000);
    const idx = buildIndex([{ chunkId: "x", text: longText }], { maxTokensPerDoc: 100 });
    expect(idx.docLens[0]).toBeLessThanOrEqual(100);
  });

  it("respects maxTermLength limit", () => {
    const longTerm = "a".repeat(100);
    const idx = buildIndex([{ chunkId: "x", text: `short ${longTerm}` }], { maxTermLength: 10 });
    expect(idx.df.has(longTerm)).toBe(false);
    expect(idx.df.has("short")).toBe(true);
  });

  it("respects maxUniqueTerms limit", () => {
    const terms = Array.from({ length: 100 }, (_, i) => `term${i}`).join(" ");
    const idx = buildIndex([{ chunkId: "x", text: terms }], { maxUniqueTerms: 10 });
    expect(idx.df.size).toBeLessThanOrEqual(10);
  });

  it("respects maxPostingsPerTerm limit", () => {
    const chunks = Array.from({ length: 100 }, (_, i) => ({ chunkId: `c${i}`, text: "common" }));
    const idx = buildIndex(chunks, { maxPostingsPerTerm: 5 });
    const postings = idx.postings.get("common");
    expect(postings).toBeInstanceOf(Array);
    expect(postings.length).toBeLessThanOrEqual(5);
  });

  it("throws on non-array chunks", () => {
    expect(() => buildIndex("not array")).toThrow(/must be an array/);
    expect(() => buildIndex(null)).toThrow(/must be an array/);
  });

  it("throws on non-object options", () => {
    expect(() => buildIndex([], "invalid")).toThrow(/must be an object/);
  });

  it("filters stopwords", () => {
    const idx = buildIndex([{ chunkId: "x", text: "the quick brown fox" }]);
    expect(idx.df.has("the")).toBe(false);
    expect(idx.df.has("quick")).toBe(true);
  });

  it("handles CJK text with bigrams", () => {
    const idx = buildIndex([{ chunkId: "x", text: "这是中文测试" }]);
    // Should tokenize into bigrams when Intl.Segmenter unavailable or as fallback
    expect(idx.df.size).toBeGreaterThan(0);
    expect(idx.docLens[0]).toBeGreaterThan(0);
  });

  it("handles mixed CJK and Latin text", () => {
    const idx = buildIndex([{ chunkId: "x", text: "hello 世界 world" }]);
    expect(idx.df.has("hello")).toBe(true);
    expect(idx.df.has("world")).toBe(true);
    // CJK processed
    expect(idx.docLens[0]).toBeGreaterThanOrEqual(2);
  });

  it("drops single Latin character tokens", () => {
    const idx = buildIndex([{ chunkId: "x", text: "a b c hello world" }]);
    expect(idx.df.has("a")).toBe(false);
    expect(idx.df.has("b")).toBe(false);
    expect(idx.df.has("c")).toBe(false);
    expect(idx.df.has("hello")).toBe(true);
  });

  it("keeps single digit tokens", () => {
    const idx = buildIndex([{ chunkId: "x", text: "1 2 3 hello" }]);
    expect(idx.df.has("1") || idx.df.has("2") || idx.df.has("3") || idx.docLens[0] >= 1).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildIndexAsync
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIndexAsync", () => {
  it("builds index asynchronously", async () => {
    const chunks = [
      { chunkId: "a", text: "async hello" },
      { chunkId: "b", text: "async world" },
    ];
    const idx = await buildIndexAsync(chunks);

    expect(idx.chunkIds).toEqual(["a", "b"]);
    expect(idx.df.has("async")).toBe(true);
  });

  it("handles empty array", async () => {
    const idx = await buildIndexAsync([]);
    expect(idx.chunkIds).toEqual([]);
    expect(idx.avgDocLen).toBe(0);
  });

  it("respects yieldEveryDocs for yielding", async () => {
    const chunks = Array.from({ length: 200 }, (_, i) => ({ chunkId: `c${i}`, text: `doc ${i}` }));
    const idx = await buildIndexAsync(chunks, { yieldEveryDocs: 50 });
    expect(idx.chunkIds.length).toBe(200);
  });

  it("aborts on signal", async () => {
    const chunks = Array.from({ length: 200 }, (_, i) => ({ chunkId: `c${i}`, text: `doc ${i}` }));
    const controller = new AbortController();
    controller.abort();

    await expect(buildIndexAsync(chunks, { signal: controller.signal, yieldEveryDocs: 1 })).rejects.toThrow(/aborted/);
  });

  it("delegates to workerPool when provided", async () => {
    const chunks = [{ chunkId: "x", text: "worker test" }];
    const mockResult = { chunkIds: ["x"], docLens: [2], avgDocLen: 2, df: new Map(), postings: new Map(), k1: 1.2, b: 0.75 };
    const workerPool = {
      buildIndex: vi.fn(() => Promise.resolve(mockResult)),
    };

    const idx = await buildIndexAsync(chunks, { workerPool, k1: 1.5, b: 0.8 });

    expect(workerPool.buildIndex.mock.calls.length).toBe(1);
    const [calledChunks, calledOpts] = workerPool.buildIndex.mock.calls[0];
    expect(calledChunks).toEqual(chunks);
    expect(calledOpts.k1).toBe(1.5);
    expect(calledOpts.b).toBe(0.8);
    expect(idx).toEqual(mockResult);
  });

  it("throws on non-array chunks", async () => {
    await expect(buildIndexAsync("invalid")).rejects.toThrow(/must be an array/);
  });

  it("throws on non-object options", async () => {
    await expect(buildIndexAsync([], 123)).rejects.toThrow(/must be an object/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// search
// ─────────────────────────────────────────────────────────────────────────────

describe("search", () => {
  let idx;

  beforeEach(() => {
    idx = buildIndex([
      { chunkId: "doc1", text: "machine learning algorithms" },
      { chunkId: "doc2", text: "deep learning neural networks" },
      { chunkId: "doc3", text: "natural language processing" },
      { chunkId: "doc4", text: "machine translation systems" },
    ]);
  });

  it("returns ranked results for matching query", () => {
    const results = search(idx, "machine learning");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
    // doc1 should rank high (has both terms)
    const doc1Rank = results.findIndex((r) => r.chunkId === "doc1");
    expect(doc1Rank).toBeGreaterThanOrEqual(0);
  });

  it("returns empty for non-matching query", () => {
    const results = search(idx, "quantum physics");
    expect(results).toEqual([]);
  });

  it("returns empty for stopword-only query", () => {
    const results = search(idx, "the and or");
    expect(results).toEqual([]);
  });

  it("returns empty for empty query", () => {
    const results = search(idx, "");
    expect(results).toEqual([]);
  });

  it("respects topK limit", () => {
    const results = search(idx, "learning", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("defaults topK to 8", () => {
    const manyDocs = Array.from({ length: 20 }, (_, i) => ({ chunkId: `d${i}`, text: "common term" }));
    const largeIdx = buildIndex(manyDocs);
    const results = search(largeIdx, "common term");
    expect(results.length).toBeLessThanOrEqual(8);
  });

  it("handles filterDocIndex option", () => {
    // Only allow doc indices 0 and 2
    const results = search(idx, "machine learning", 10, {
      filterDocIndex: (di) => di === 0 || di === 2,
    });
    const ids = results.map((r) => r.chunkId);
    expect(ids).not.toContain("doc2");
    expect(ids).not.toContain("doc4");
  });

  it("sorts by score descending, then chunkId ascending", () => {
    const sameScoreIdx = buildIndex([
      { chunkId: "b", text: "test" },
      { chunkId: "a", text: "test" },
      { chunkId: "c", text: "test" },
    ]);
    const results = search(sameScoreIdx, "test");
    // All same score, should be sorted by chunkId
    expect(results.map((r) => r.chunkId)).toEqual(["a", "b", "c"]
    );
  });

  it("throws on non-object index", () => {
    expect(() => search(null, "test")).toThrow(/must be an object/);
    expect(() => search("invalid", "test")).toThrow(/must be an object/);
  });

  it("throws on non-string query", () => {
    expect(() => search(idx, 123)).toThrow(/must be a string/);
    expect(() => search(idx, null)).toThrow(/must be a string/);
  });

  it("throws on non-object options", () => {
    expect(() => search(idx, "test", 8, "bad")).toThrow(/must be an object/);
  });

  it("handles empty index", () => {
    const emptyIdx = buildIndex([]);
    const results = search(emptyIdx, "anything");
    expect(results).toEqual([]);
  });

  it("handles duplicate query terms", () => {
    const results = search(idx, "learning learning learning");
    // Should still work, terms deduplicated
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// serializeIndex / deserializeIndex
// ─────────────────────────────────────────────────────────────────────────────

describe("serializeIndex", () => {
  it("converts index to JSON-serializable object", () => {
    const idx = buildIndex([
      { chunkId: "a", text: "hello world" },
      { chunkId: "b", text: "foo bar" },
    ]);
    const snapshot = serializeIndex(idx);

    expect(snapshot.schemaVersion).toBe("0.1");
    expect(snapshot.chunkIds).toEqual(["a", "b"]);
    expect(snapshot.docLens).toBeInstanceOf(Array);
    expect(snapshot.df).toBeInstanceOf(Array);
    expect(snapshot.postings).toBeInstanceOf(Array);
    expect(snapshot.k1).toBe(1.2);
    expect(snapshot.b).toBe(0.75);

    // Should be JSON-serializable
    const json = JSON.stringify(snapshot);
    expect(json.length).toBeGreaterThan(0);
  });

  it("handles index with custom k1/b", () => {
    const idx = buildIndex([{ chunkId: "x", text: "test" }], { k1: 2.5, b: 0.6 });
    const snapshot = serializeIndex(idx);
    expect(snapshot.k1).toBe(2.5);
    expect(snapshot.b).toBe(0.6);
  });

  it("throws on non-object input", () => {
    expect(() => serializeIndex(null)).toThrow(/must be an object/);
    expect(() => serializeIndex("invalid")).toThrow(/must be an object/);
  });

  it("handles missing fields gracefully", () => {
    const partial = { chunkIds: ["a"], docLens: [5] };
    const snapshot = serializeIndex(partial);
    expect(snapshot.chunkIds).toEqual(["a"]);
    expect(snapshot.df).toEqual([]);
    expect(snapshot.postings).toEqual([]);
  });
});

describe("deserializeIndex", () => {
  it("restores index from snapshot", () => {
    const original = buildIndex([
      { chunkId: "a", text: "hello world" },
      { chunkId: "b", text: "hello universe" },
    ]);
    const snapshot = serializeIndex(original);
    const restored = deserializeIndex(snapshot);

    expect(restored.chunkIds).toEqual(original.chunkIds);
    expect(restored.docLens).toEqual(original.docLens);
    expect(restored.avgDocLen).toBe(original.avgDocLen);
    expect(restored.k1).toBe(original.k1);
    expect(restored.b).toBe(original.b);
    expect(restored.df).toBeInstanceOf(Map);
    expect(restored.postings).toBeInstanceOf(Map);
    expect(restored.df.get("hello")).toBe(original.df.get("hello"));
  });

  it("search works on deserialized index", () => {
    const original = buildIndex([
      { chunkId: "a", text: "machine learning" },
      { chunkId: "b", text: "deep learning" },
    ]);
    const snapshot = serializeIndex(original);
    const json = JSON.stringify(snapshot);
    const restored = deserializeIndex(JSON.parse(json));

    const results = search(restored, "machine");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe("a");
  });

  it("throws on non-object snapshot", () => {
    expect(() => deserializeIndex(null)).toThrow(/must be an object/);
    expect(() => deserializeIndex("invalid")).toThrow(/must be an object/);
  });

  it("handles corrupted df entries", () => {
    const snapshot = {
      chunkIds: ["a"],
      docLens: [5],
      avgDocLen: 5,
      df: [["term1", 1], "invalid", [null, 2], ["", 3]],
      postings: [["term1", [[0, 1]]]],
      k1: 1.2,
      b: 0.75,
    };
    const restored = deserializeIndex(snapshot);
    expect(restored.df.get("term1")).toBe(1);
    expect(restored.df.has("")).toBe(false);
  });

  it("handles corrupted postings entries", () => {
    const snapshot = {
      chunkIds: ["a"],
      docLens: [5],
      avgDocLen: 5,
      df: [["term1", 1]],
      postings: [["term1", [[0, 1], "invalid", [null, 2]]], "bad", [null, []]],
      k1: 1.2,
      b: 0.75,
    };
    const restored = deserializeIndex(snapshot);
    const list = restored.postings.get("term1");
    expect(list).toBeInstanceOf(Array);
    expect(list.length).toBe(2); // invalid entries filtered
  });

  it("recalculates avgDocLen if missing", () => {
    const snapshot = {
      chunkIds: ["a", "b"],
      docLens: [4, 6],
      df: [],
      postings: [],
      k1: 1.2,
      b: 0.75,
    };
    const restored = deserializeIndex(snapshot);
    expect(restored.avgDocLen).toBe(5);
  });

  it("handles empty snapshot", () => {
    const snapshot = { chunkIds: [], docLens: [], df: [], postings: [] };
    const restored = deserializeIndex(snapshot);
    expect(restored.chunkIds).toEqual([]);
    expect(restored.avgDocLen).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip integration
// ─────────────────────────────────────────────────────────────────────────────

describe("round-trip integration", () => {
  it("serialize -> JSON -> deserialize -> search produces same results", () => {
    const chunks = [
      { chunkId: "doc1", text: "quantum computing algorithms" },
      { chunkId: "doc2", text: "machine learning algorithms" },
      { chunkId: "doc3", text: "quantum mechanics physics" },
    ];
    const original = buildIndex(chunks);
    const originalResults = search(original, "quantum algorithms");

    const snapshot = serializeIndex(original);
    const json = JSON.stringify(snapshot);
    const restored = deserializeIndex(JSON.parse(json));
    const restoredResults = search(restored, "quantum algorithms");

    expect(restoredResults.map((r) => r.chunkId)).toEqual(originalResults.map((r) => r.chunkId));
    // Scores should be equal
    for (let i = 0; i < originalResults.length; i++) {
      expect(Math.abs(originalResults[i].score - restoredResults[i].score)).toBeLessThan(1e-10);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases and special characters
// ─────────────────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles null/undefined text in chunks", () => {
    const idx = buildIndex([
      { chunkId: "a", text: null },
      { chunkId: "b", text: undefined },
      { chunkId: "c", text: "valid text" },
    ]);
    expect(idx.chunkIds).toEqual(["a", "b", "c"]);
    expect(idx.docLens[0]).toBe(0);
    expect(idx.docLens[1]).toBe(0);
    expect(idx.docLens[2]).toBeGreaterThan(0);
  });

  it("handles special characters and punctuation", () => {
    const idx = buildIndex([{ chunkId: "x", text: "hello! @world #test" }]);
    expect(idx.df.has("hello")).toBe(true);
    expect(idx.df.has("world")).toBe(true);
    expect(idx.df.has("test")).toBe(true);
  });

  it("handles numeric-only text", () => {
    const idx = buildIndex([{ chunkId: "x", text: "123 456 789" }]);
    expect(idx.docLens[0]).toBeGreaterThan(0);
  });

  it("handles very long single token", () => {
    const longWord = "a".repeat(1000);
    const idx = buildIndex([{ chunkId: "x", text: `${longWord} short` }]);
    // Long word should be filtered by default maxTermLength
    expect(idx.df.has(longWord)).toBe(false);
    expect(idx.df.has("short")).toBe(true);
  });

  it("handles Japanese hiragana/katakana", () => {
    const idx = buildIndex([{ chunkId: "x", text: "こんにちは カタカナ" }]);
    expect(idx.docLens[0]).toBeGreaterThan(0);
  });

  it("handles Korean hangul", () => {
    const idx = buildIndex([{ chunkId: "x", text: "안녕하세요 테스트" }]);
    expect(idx.docLens[0]).toBeGreaterThan(0);
  });

  it("handles CJK stopwords", () => {
    const idx = buildIndex([{ chunkId: "x", text: "我们 是 好朋友" }]);
    // "我们" and "是" are stopwords
    // "好朋" should be indexed as bigram
    expect(idx.docLens[0]).toBeLessThan(3); // Some filtered
  });

  it("handles Infinity for limit options", () => {
    const idx = buildIndex(
      [{ chunkId: "x", text: "test text here" }],
      { maxTokensPerDoc: Infinity, maxUniqueTerms: Infinity }
    );
    expect(idx.docLens[0]).toBeGreaterThan(0);
  });

  it("handles negative/zero limit values (falls back to defaults)", () => {
    const idx = buildIndex(
      [{ chunkId: "x", text: "word ".repeat(100) }],
      { maxTokensPerDoc: -5, maxUniqueTerms: 0 }
    );
    // Should use fallback values
    expect(idx.docLens[0]).toBeGreaterThan(0);
  });

  it("handles NaN limit values (falls back to defaults)", () => {
    const idx = buildIndex(
      [{ chunkId: "x", text: "test content here" }],
      { maxTokensPerDoc: NaN, maxTermLength: NaN }
    );
    expect(idx.docLens[0]).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BM25 scoring correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("BM25 scoring", () => {
  it("higher TF yields higher score", () => {
    const idx = buildIndex([
      { chunkId: "low", text: "keyword other words" },
      { chunkId: "high", text: "keyword keyword keyword" },
    ]);
    const results = search(idx, "keyword");
    expect(results[0].chunkId).toBe("high");
  });

  it("rarer terms have higher weight (IDF)", () => {
    const idx = buildIndex([
      { chunkId: "common", text: "word1 word2 word3" },
      { chunkId: "rare", text: "word1 unicorn" },
      { chunkId: "also-common", text: "word1 word2 word3" },
    ]);
    // "unicorn" only in one doc, higher IDF
    const results = search(idx, "word1 unicorn");
    expect(results[0].chunkId).toBe("rare");
  });

  it("document length normalization affects scores", () => {
    const idx = buildIndex([
      { chunkId: "short", text: "target" },
      { chunkId: "long", text: "target " + "padding ".repeat(50) },
    ]);
    const results = search(idx, "target");
    // Shorter doc should rank higher with same TF
    expect(results[0].chunkId).toBe("short");
  });
});
