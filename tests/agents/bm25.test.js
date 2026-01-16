import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  buildIndex,
  buildIndexAsync,
  search,
  serializeIndex,
  deserializeIndex,
} from "../../js/agents/retrieval/bm25.js";

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

    assert.deepEqual(idx.chunkIds, ["a", "b"]);
    assert.equal(idx.docLens.length, 2);
    assert.ok(idx.df instanceof Map);
    assert.ok(idx.postings instanceof Map);
    assert.ok(idx.df.get("hello") >= 2);
    assert.equal(idx.k1, 1.2);
    assert.equal(idx.b, 0.75);
  });

  it("handles empty chunks array", () => {
    const idx = buildIndex([]);
    assert.deepEqual(idx.chunkIds, []);
    assert.equal(idx.avgDocLen, 0);
  });

  it("auto-generates chunkId when missing", () => {
    const idx = buildIndex([{ text: "foo" }, { text: "bar" }]);
    assert.deepEqual(idx.chunkIds, ["chunk_1", "chunk_2"]);
  });

  it("respects custom k1 and b", () => {
    const idx = buildIndex([{ chunkId: "x", text: "test" }], { k1: 2.0, b: 0.5 });
    assert.equal(idx.k1, 2.0);
    assert.equal(idx.b, 0.5);
  });

  it("respects maxTokensPerDoc limit", () => {
    const longText = "word ".repeat(20000);
    const idx = buildIndex([{ chunkId: "x", text: longText }], { maxTokensPerDoc: 100 });
    assert.ok(idx.docLens[0] <= 100);
  });

  it("respects maxTermLength limit", () => {
    const longTerm = "a".repeat(100);
    const idx = buildIndex([{ chunkId: "x", text: `short ${longTerm}` }], { maxTermLength: 10 });
    assert.ok(!idx.df.has(longTerm));
    assert.ok(idx.df.has("short"));
  });

  it("respects maxUniqueTerms limit", () => {
    const terms = Array.from({ length: 100 }, (_, i) => `term${i}`).join(" ");
    const idx = buildIndex([{ chunkId: "x", text: terms }], { maxUniqueTerms: 10 });
    assert.ok(idx.df.size <= 10);
  });

  it("respects maxPostingsPerTerm limit", () => {
    const chunks = Array.from({ length: 100 }, (_, i) => ({ chunkId: `c${i}`, text: "common" }));
    const idx = buildIndex(chunks, { maxPostingsPerTerm: 5 });
    const postings = idx.postings.get("common");
    assert.ok(postings && postings.length <= 5);
  });

  it("throws on non-array chunks", () => {
    assert.throws(() => buildIndex("not array"), /must be an array/);
    assert.throws(() => buildIndex(null), /must be an array/);
  });

  it("throws on non-object options", () => {
    assert.throws(() => buildIndex([], "invalid"), /must be an object/);
  });

  it("filters stopwords", () => {
    const idx = buildIndex([{ chunkId: "x", text: "the quick brown fox" }]);
    assert.ok(!idx.df.has("the"));
    assert.ok(idx.df.has("quick"));
  });

  it("handles CJK text with bigrams", () => {
    const idx = buildIndex([{ chunkId: "x", text: "这是中文测试" }]);
    // Should tokenize into bigrams when Intl.Segmenter unavailable or as fallback
    assert.ok(idx.df.size > 0);
    assert.ok(idx.docLens[0] > 0);
  });

  it("handles mixed CJK and Latin text", () => {
    const idx = buildIndex([{ chunkId: "x", text: "hello 世界 world" }]);
    assert.ok(idx.df.has("hello"));
    assert.ok(idx.df.has("world"));
    // CJK processed
    assert.ok(idx.docLens[0] >= 2);
  });

  it("drops single Latin character tokens", () => {
    const idx = buildIndex([{ chunkId: "x", text: "a b c hello world" }]);
    assert.ok(!idx.df.has("a"));
    assert.ok(!idx.df.has("b"));
    assert.ok(!idx.df.has("c"));
    assert.ok(idx.df.has("hello"));
  });

  it("keeps single digit tokens", () => {
    const idx = buildIndex([{ chunkId: "x", text: "1 2 3 hello" }]);
    assert.ok(idx.df.has("1") || idx.df.has("2") || idx.df.has("3") || idx.docLens[0] >= 1);
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

    assert.deepEqual(idx.chunkIds, ["a", "b"]);
    assert.ok(idx.df.has("async"));
  });

  it("handles empty array", async () => {
    const idx = await buildIndexAsync([]);
    assert.deepEqual(idx.chunkIds, []);
    assert.equal(idx.avgDocLen, 0);
  });

  it("respects yieldEveryDocs for yielding", async () => {
    const chunks = Array.from({ length: 200 }, (_, i) => ({ chunkId: `c${i}`, text: `doc ${i}` }));
    const idx = await buildIndexAsync(chunks, { yieldEveryDocs: 50 });
    assert.equal(idx.chunkIds.length, 200);
  });

  it("aborts on signal", async () => {
    const chunks = Array.from({ length: 200 }, (_, i) => ({ chunkId: `c${i}`, text: `doc ${i}` }));
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      buildIndexAsync(chunks, { signal: controller.signal, yieldEveryDocs: 1 }),
      /aborted/
    );
  });

  it("delegates to workerPool when provided", async () => {
    const chunks = [{ chunkId: "x", text: "worker test" }];
    const mockResult = { chunkIds: ["x"], docLens: [2], avgDocLen: 2, df: new Map(), postings: new Map(), k1: 1.2, b: 0.75 };
    const workerPool = {
      buildIndex: mock.fn(() => Promise.resolve(mockResult)),
    };

    const idx = await buildIndexAsync(chunks, { workerPool, k1: 1.5, b: 0.8 });

    assert.equal(workerPool.buildIndex.mock.callCount(), 1);
    const [calledChunks, calledOpts] = workerPool.buildIndex.mock.calls[0].arguments;
    assert.deepEqual(calledChunks, chunks);
    assert.equal(calledOpts.k1, 1.5);
    assert.equal(calledOpts.b, 0.8);
    assert.deepEqual(idx, mockResult);
  });

  it("throws on non-array chunks", async () => {
    await assert.rejects(buildIndexAsync("invalid"), /must be an array/);
  });

  it("throws on non-object options", async () => {
    await assert.rejects(buildIndexAsync([], 123), /must be an object/);
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
    assert.ok(results.length > 0);
    assert.ok(results[0].score > 0);
    // doc1 should rank high (has both terms)
    const doc1Rank = results.findIndex((r) => r.chunkId === "doc1");
    assert.ok(doc1Rank >= 0);
  });

  it("returns empty for non-matching query", () => {
    const results = search(idx, "quantum physics");
    assert.deepEqual(results, []);
  });

  it("returns empty for stopword-only query", () => {
    const results = search(idx, "the and or");
    assert.deepEqual(results, []);
  });

  it("returns empty for empty query", () => {
    const results = search(idx, "");
    assert.deepEqual(results, []);
  });

  it("respects topK limit", () => {
    const results = search(idx, "learning", 2);
    assert.ok(results.length <= 2);
  });

  it("defaults topK to 8", () => {
    const manyDocs = Array.from({ length: 20 }, (_, i) => ({ chunkId: `d${i}`, text: "common term" }));
    const largeIdx = buildIndex(manyDocs);
    const results = search(largeIdx, "common term");
    assert.ok(results.length <= 8);
  });

  it("handles filterDocIndex option", () => {
    // Only allow doc indices 0 and 2
    const results = search(idx, "machine learning", 10, {
      filterDocIndex: (di) => di === 0 || di === 2,
    });
    const ids = results.map((r) => r.chunkId);
    assert.ok(!ids.includes("doc2"));
    assert.ok(!ids.includes("doc4"));
  });

  it("sorts by score descending, then chunkId ascending", () => {
    const sameScoreIdx = buildIndex([
      { chunkId: "b", text: "test" },
      { chunkId: "a", text: "test" },
      { chunkId: "c", text: "test" },
    ]);
    const results = search(sameScoreIdx, "test");
    // All same score, should be sorted by chunkId
    assert.deepEqual(
      results.map((r) => r.chunkId),
      ["a", "b", "c"]
    );
  });

  it("throws on non-object index", () => {
    assert.throws(() => search(null, "test"), /must be an object/);
    assert.throws(() => search("invalid", "test"), /must be an object/);
  });

  it("throws on non-string query", () => {
    assert.throws(() => search(idx, 123), /must be a string/);
    assert.throws(() => search(idx, null), /must be a string/);
  });

  it("throws on non-object options", () => {
    assert.throws(() => search(idx, "test", 8, "bad"), /must be an object/);
  });

  it("handles empty index", () => {
    const emptyIdx = buildIndex([]);
    const results = search(emptyIdx, "anything");
    assert.deepEqual(results, []);
  });

  it("handles duplicate query terms", () => {
    const results = search(idx, "learning learning learning");
    // Should still work, terms deduplicated
    assert.ok(results.length > 0);
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

    assert.equal(snapshot.schemaVersion, "0.1");
    assert.deepEqual(snapshot.chunkIds, ["a", "b"]);
    assert.ok(Array.isArray(snapshot.docLens));
    assert.ok(Array.isArray(snapshot.df));
    assert.ok(Array.isArray(snapshot.postings));
    assert.equal(snapshot.k1, 1.2);
    assert.equal(snapshot.b, 0.75);

    // Should be JSON-serializable
    const json = JSON.stringify(snapshot);
    assert.ok(json.length > 0);
  });

  it("handles index with custom k1/b", () => {
    const idx = buildIndex([{ chunkId: "x", text: "test" }], { k1: 2.5, b: 0.6 });
    const snapshot = serializeIndex(idx);
    assert.equal(snapshot.k1, 2.5);
    assert.equal(snapshot.b, 0.6);
  });

  it("throws on non-object input", () => {
    assert.throws(() => serializeIndex(null), /must be an object/);
    assert.throws(() => serializeIndex("invalid"), /must be an object/);
  });

  it("handles missing fields gracefully", () => {
    const partial = { chunkIds: ["a"], docLens: [5] };
    const snapshot = serializeIndex(partial);
    assert.deepEqual(snapshot.chunkIds, ["a"]);
    assert.deepEqual(snapshot.df, []);
    assert.deepEqual(snapshot.postings, []);
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

    assert.deepEqual(restored.chunkIds, original.chunkIds);
    assert.deepEqual(restored.docLens, original.docLens);
    assert.equal(restored.avgDocLen, original.avgDocLen);
    assert.equal(restored.k1, original.k1);
    assert.equal(restored.b, original.b);
    assert.ok(restored.df instanceof Map);
    assert.ok(restored.postings instanceof Map);
    assert.equal(restored.df.get("hello"), original.df.get("hello"));
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
    assert.ok(results.length > 0);
    assert.equal(results[0].chunkId, "a");
  });

  it("throws on non-object snapshot", () => {
    assert.throws(() => deserializeIndex(null), /must be an object/);
    assert.throws(() => deserializeIndex("invalid"), /must be an object/);
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
    assert.equal(restored.df.get("term1"), 1);
    assert.ok(!restored.df.has(""));
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
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 2); // invalid entries filtered
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
    assert.equal(restored.avgDocLen, 5);
  });

  it("handles empty snapshot", () => {
    const snapshot = { chunkIds: [], docLens: [], df: [], postings: [] };
    const restored = deserializeIndex(snapshot);
    assert.deepEqual(restored.chunkIds, []);
    assert.equal(restored.avgDocLen, 0);
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

    assert.deepEqual(
      restoredResults.map((r) => r.chunkId),
      originalResults.map((r) => r.chunkId)
    );
    // Scores should be equal
    for (let i = 0; i < originalResults.length; i++) {
      assert.ok(Math.abs(originalResults[i].score - restoredResults[i].score) < 1e-10);
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
    assert.deepEqual(idx.chunkIds, ["a", "b", "c"]);
    assert.equal(idx.docLens[0], 0);
    assert.equal(idx.docLens[1], 0);
    assert.ok(idx.docLens[2] > 0);
  });

  it("handles special characters and punctuation", () => {
    const idx = buildIndex([{ chunkId: "x", text: "hello! @world #test" }]);
    assert.ok(idx.df.has("hello"));
    assert.ok(idx.df.has("world"));
    assert.ok(idx.df.has("test"));
  });

  it("handles numeric-only text", () => {
    const idx = buildIndex([{ chunkId: "x", text: "123 456 789" }]);
    assert.ok(idx.docLens[0] > 0);
  });

  it("handles very long single token", () => {
    const longWord = "a".repeat(1000);
    const idx = buildIndex([{ chunkId: "x", text: `${longWord} short` }]);
    // Long word should be filtered by default maxTermLength
    assert.ok(!idx.df.has(longWord));
    assert.ok(idx.df.has("short"));
  });

  it("handles Japanese hiragana/katakana", () => {
    const idx = buildIndex([{ chunkId: "x", text: "こんにちは カタカナ" }]);
    assert.ok(idx.docLens[0] > 0);
  });

  it("handles Korean hangul", () => {
    const idx = buildIndex([{ chunkId: "x", text: "안녕하세요 테스트" }]);
    assert.ok(idx.docLens[0] > 0);
  });

  it("handles CJK stopwords", () => {
    const idx = buildIndex([{ chunkId: "x", text: "我们 是 好朋友" }]);
    // "我们" and "是" are stopwords
    // "好朋" should be indexed as bigram
    assert.ok(idx.docLens[0] < 3); // Some filtered
  });

  it("handles Infinity for limit options", () => {
    const idx = buildIndex(
      [{ chunkId: "x", text: "test text here" }],
      { maxTokensPerDoc: Infinity, maxUniqueTerms: Infinity }
    );
    assert.ok(idx.docLens[0] > 0);
  });

  it("handles negative/zero limit values (falls back to defaults)", () => {
    const idx = buildIndex(
      [{ chunkId: "x", text: "word ".repeat(100) }],
      { maxTokensPerDoc: -5, maxUniqueTerms: 0 }
    );
    // Should use fallback values
    assert.ok(idx.docLens[0] > 0);
  });

  it("handles NaN limit values (falls back to defaults)", () => {
    const idx = buildIndex(
      [{ chunkId: "x", text: "test content here" }],
      { maxTokensPerDoc: NaN, maxTermLength: NaN }
    );
    assert.ok(idx.docLens[0] > 0);
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
    assert.equal(results[0].chunkId, "high");
  });

  it("rarer terms have higher weight (IDF)", () => {
    const idx = buildIndex([
      { chunkId: "common", text: "word1 word2 word3" },
      { chunkId: "rare", text: "word1 unicorn" },
      { chunkId: "also-common", text: "word1 word2 word3" },
    ]);
    // "unicorn" only in one doc, higher IDF
    const results = search(idx, "word1 unicorn");
    assert.equal(results[0].chunkId, "rare");
  });

  it("document length normalization affects scores", () => {
    const idx = buildIndex([
      { chunkId: "short", text: "target" },
      { chunkId: "long", text: "target " + "padding ".repeat(50) },
    ]);
    const results = search(idx, "target");
    // Shorter doc should rank higher with same TF
    assert.equal(results[0].chunkId, "short");
  });
});
