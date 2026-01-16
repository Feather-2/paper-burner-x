import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadBm25({ segmenter } = {}) {
  vi.resetModules();

  if (segmenter === "fake") {
    class FakeSegmenter {
      segment(text) {
        const s = String(text ?? "");
        // Emit words and punctuation so we can exercise the `isWordLike === false` path.
        const parts = s.match(/[a-z0-9]+|[^\s]/gi) || [];
        return parts.map((p) => ({
          segment: p,
          isWordLike: /^[a-z0-9]+$/i.test(p),
        }));
      }
    }
    vi.stubGlobal("Intl", { Segmenter: FakeSegmenter });
  } else if (segmenter === "none") {
    vi.stubGlobal("Intl", {});
  }

  // Use a single module specifier so coverage maps cleanly to the source file.
  return import("../../../js/agents/retrieval/bm25.js");
}

describe("agents/retrieval/bm25", () => {
  it("Intl.Segmenter tokenization skips non-word-like segments and blank segments (empty-result queries stay empty)", async () => {
    vi.resetModules();

    const segment = vi.fn((text) => {
      const parts = [];
      for (const w of String(text || "").split(/\s+/).filter(Boolean)) {
        if (w === ".") parts.push({ segment: w, isWordLike: false });
        else parts.push({ segment: w, isWordLike: true });

        // Exercise `part?.segment || ""` + `if (!t) continue` paths.
        parts.push({ isWordLike: true });
      }
      return parts;
    });

    const Segmenter = vi.fn(function SegmenterCtor() {
      return { segment };
    });
    vi.stubGlobal("Intl", { Segmenter });

    const { buildIndex, search } = await import("../../../js/agents/retrieval/bm25.js");

    const index = buildIndex([{ chunkId: "c1", text: "Alpha . the x 7" }]);

    // Word-like segments: alpha + 7 are indexed; stopwords/noise/punctuation are skipped.
    expect(search(index, "alpha", 8).map((h) => h.chunkId)).toEqual(["c1"]);
    expect(search(index, "the", 8)).toEqual([]);
    expect(search(index, "x", 8)).toEqual([]);
    expect(search(index, "7", 8).map((h) => h.chunkId)).toEqual(["c1"]);

    // Query with only punctuation produces no terms => [].
    expect(search(index, ".", 8)).toEqual([]);
  });

  it("buildIndex/search ranks and tie-breaks by chunkId", async () => {
    const { buildIndex, search } = await loadBm25({ segmenter: "fake" });

    const index = buildIndex([
      { chunkId: "b", text: "alpha beta" },
      { chunkId: "a", text: "alpha beta" },
    ]);

    const hits = search(index, "alpha", 2);
    expect(hits.map((h) => h.chunkId)).toEqual(["a", "b"]);
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("drops stopwords and noisy single-char Latin tokens (keeps digits)", async () => {
    const { buildIndex, search } = await loadBm25({ segmenter: "fake" });

    const index = buildIndex([{ chunkId: "c1", text: "the x 7" }]);

    expect(search(index, "the", 8)).toEqual([]);
    expect(search(index, "x", 8)).toEqual([]);

    const hits = search(index, "7", 8);
    expect(hits.map((h) => h.chunkId)).toEqual(["c1"]);
  });

  it("generates fallback chunkIds when missing", async () => {
    const { buildIndex } = await loadBm25({ segmenter: "fake" });

    const index = buildIndex([
      { text: "alpha" },
      { chunkId: "c2", text: "beta" },
    ]);

    expect(index.chunkIds).toEqual(["chunk_1", "c2"]);
  });

  it("uses regex fallback tokenization and CJK bigrams when Intl.Segmenter is unavailable", async () => {
    const { buildIndex, search } = await loadBm25({ segmenter: "none" });

    const index = buildIndex([{ chunkId: "c1", text: "你好世界" }]);
    const hits = search(index, "好世", 8);
    expect(hits.map((h) => h.chunkId)).toEqual(["c1"]);
  });

  it("falls back to legacy token regex when Unicode property escapes are unavailable", async () => {
    vi.resetModules();

    const OriginalRegExp = globalThis.RegExp;
    function ThrowOnUnicodeProps(pattern, flags) {
      const p = String(pattern ?? "");
      const f = String(flags ?? "");
      if (p.includes("\\p{L}") && f.includes("u")) throw new Error("no unicode property escapes");
      return new OriginalRegExp(pattern, flags);
    }
    // Keep basic `instanceof RegExp` behavior sane for any incidental checks.
    ThrowOnUnicodeProps.prototype = OriginalRegExp.prototype;

    vi.stubGlobal("RegExp", ThrowOnUnicodeProps);
    vi.stubGlobal("Intl", {}); // force regex path

    const { buildIndex, search } = await import("../../../js/agents/retrieval/bm25.js");

    const index = buildIndex([{ chunkId: "c1", text: "abc 你好" }]);
    expect(search(index, "你好", 8).map((h) => h.chunkId)).toEqual(["c1"]);
  });

  it("tokenize fallback indexes non-CJK tokens and truncates long CJK bigram expansions", async () => {
    const { buildIndex, search } = await loadBm25({ segmenter: "none" });

    const longCjk = "你".repeat(70);
    const index = buildIndex([
      { chunkId: "latin", text: "alpha beta" },
      { chunkId: "cjk", text: longCjk },
    ]);

    // Non-CJK tokens use the plain `out.push(t)` branch in the regex path.
    expect(search(index, "beta", 8).map((h) => h.chunkId)).toEqual(["latin"]);

    // Very long CJK strings trigger the capped head/tail bigram expansion path.
    expect(search(index, "你你", 8).map((h) => h.chunkId)).toEqual(["cjk"]);
  });

  it("respects index limits (maxTokensPerDoc / maxUniqueTerms / maxTermLength / maxPostingsPerTerm)", async () => {
    const { buildIndex, search } = await loadBm25({ segmenter: "fake" });

    const indexTokenCap = buildIndex([{ chunkId: "c1", text: "alpha beta gamma" }], { maxTokensPerDoc: 2 });
    expect(indexTokenCap.docLens[0]).toBe(2);

    const indexUniqueCap = buildIndex([{ chunkId: "c1", text: "alpha beta gamma" }], { maxUniqueTerms: 2 });
    expect(indexUniqueCap.df.size).toBe(2);
    expect(indexUniqueCap.df.has("gamma")).toBe(false);

    const indexTermLen = buildIndex([{ chunkId: "c1", text: "toolong ok" }], { maxTermLength: 3 });
    expect(search(indexTermLen, "toolong", 8)).toEqual([]);
    expect(search(indexTermLen, "ok", 8).map((h) => h.chunkId)).toEqual(["c1"]);

    const indexPostingsCap = buildIndex(
      [
        { chunkId: "c1", text: "alpha" },
        { chunkId: "c2", text: "alpha" },
      ],
      { maxPostingsPerTerm: 1 }
    );
    expect(indexPostingsCap.postings.get("alpha").length).toBe(1);
    expect(indexPostingsCap.df.get("alpha")).toBe(1);
    expect(search(indexPostingsCap, "alpha", 10).map((h) => h.chunkId)).toEqual(["c1"]);
  });

  it("normalizeIndexLimits: Infinity disables caps; numeric strings are coerced; invalid values fall back", async () => {
    const { buildIndex, search } = await loadBm25({ segmenter: "fake" });

    // Default maxTokensPerDoc is 10_000; ensure it actually caps.
    const longText = "alpha ".repeat(10_001);
    expect(buildIndex([{ chunkId: "c1", text: longText }]).docLens[0]).toBe(10_000);

    // Infinity bypasses the slice guard (`limits.maxTokensPerDoc !== Infinity`).
    const inf = buildIndex([{ chunkId: "c1", text: longText }], { maxTokensPerDoc: Infinity, k1: 2, b: 0 });
    expect(inf.docLens[0]).toBe(10_001);
    expect(inf.k1).toBe(2);
    expect(inf.b).toBe(0);

    // String values are coerced via Number(...).
    expect(buildIndex([{ chunkId: "c1", text: "alpha beta gamma" }], { maxTokensPerDoc: "2" }).docLens[0]).toBe(2);

    // Non-finite / <=0 values fall back to defaults (they do NOT become hard limits).
    const badCap = buildIndex([{ chunkId: "c1", text: "alpha beta gamma" }], { maxTokensPerDoc: 0, maxTermLength: 0 });
    expect(badCap.docLens[0]).toBe(3);
    expect(search(badCap, "alpha", 8).map((h) => h.chunkId)).toEqual(["c1"]);

    const badNan = buildIndex([{ chunkId: "c1", text: "alpha beta" }], { maxTokensPerDoc: "nope" });
    expect(badNan.docLens[0]).toBe(2);
  });

  it("search de-dupes query terms and normalizes topK (0 => 1, NaN => default); empty index returns []", async () => {
    const { buildIndex, search } = await loadBm25({ segmenter: "fake" });

    const index = buildIndex([
      { chunkId: "b", text: "alpha beta" },
      { chunkId: "a", text: "alpha beta" },
    ]);

    const once = search(index, "alpha", 8);
    const dupes = search(index, "alpha alpha", 8);
    expect(dupes[0].score).toBeCloseTo(once[0].score, 10);

    expect(search(index, "alpha", 0).map((h) => h.chunkId)).toEqual(["a"]);
    expect(search(index, "alpha", Number.NaN).map((h) => h.chunkId)).toEqual(["a", "b"]);

    const empty = buildIndex([]);
    expect(search(empty, "alpha", 8)).toEqual([]);
  });

  it("search handles scoring boundary cases (missing postings, df=0, denom=0, avgDocLen=0) and returns []", async () => {
    const { search } = await loadBm25({ segmenter: "fake" });

    // index.chunkIds missing => nDocs=0 => [] (covers `index.chunkIds ? ... : 0`)
    expect(
      search(
        { docLens: [], avgDocLen: 1, df: new Map(), postings: new Map(), k1: 1.2, b: 0.75 },
        "alpha",
        8
      )
    ).toEqual([]);

    // postings missing => no term list => [] (also exercises avgDocLen fallback via `|| 1`).
    expect(
      search(
        { chunkIds: ["c1"], docLens: [1], avgDocLen: 0, df: new Map([["alpha", 1]]), postings: null, k1: 1.2, b: 0.75 },
        "alpha",
        8
      )
    ).toEqual([]);

    // df=0 => term ignored even if postings exist (corrupt snapshot defensive behavior).
    expect(
      search(
        { chunkIds: ["c1"], docLens: [1], avgDocLen: 0, df: new Map([["alpha", 0]]), postings: new Map([["alpha", [[0, 1]]]]), k1: 1.2, b: 0.75 },
        "alpha",
        8
      )
    ).toEqual([]);

    // denom=0 => `denom || 1` fallback should avoid divide-by-zero and not throw.
    expect(
      search(
        { chunkIds: ["c1"], docLens: [0], avgDocLen: 0, df: new Map([["alpha", 1]]), postings: new Map([["alpha", [[0, 0]]]]), k1: 0, b: 1 },
        "alpha",
        8
      )
    ).toEqual([]);
  });

  it("search supports filterDocIndex and rejects invalid inputs", async () => {
    const { buildIndex, search } = await loadBm25({ segmenter: "fake" });

    const index = buildIndex([
      { chunkId: "c1", text: "alpha" },
      { chunkId: "c2", text: "alpha" },
    ]);

    const hits = search(index, "alpha", 8, { filterDocIndex: (i) => i === 1 });
    expect(hits.map((h) => h.chunkId)).toEqual(["c2"]);

    // Type safety / contract checks
    expect(() => buildIndex("nope")).toThrow(/chunks must be an array/i);
    expect(() => buildIndex([], null)).toThrow(/options must be an object/i);
    expect(() => search(null, "alpha", 8)).toThrow(/index must be an object/i);
    expect(() => search(index, 123)).toThrow(/query must be a string/i);
    expect(() => search(index, "alpha", 8, null)).toThrow(/options must be an object/i);
  });

  it("buildIndexAsync: workerPool omits non-finite k1/b; local path preserves k1/b and fills chunkIds", async () => {
    const { buildIndexAsync } = await loadBm25({ segmenter: "fake" });

    const chunks = [{ chunkId: "c1", text: "alpha" }];
    const workerPool = { buildIndex: vi.fn().mockResolvedValue({ ok: true }) };

    await expect(buildIndexAsync(chunks, { workerPool, k1: "nope", b: Number.NaN })).resolves.toEqual({ ok: true });
    expect(workerPool.buildIndex).toHaveBeenCalledWith(chunks, {});

    const index = await buildIndexAsync([{ text: "alpha" }], { k1: 2, b: 0, yieldEveryDocs: 0 });
    expect(index.k1).toBe(2);
    expect(index.b).toBe(0);
    expect(index.chunkIds).toEqual(["chunk_1"]);
  });

  it("buildIndexAsync returns an empty-but-usable index for [] and respects maxTermLength", async () => {
    const { buildIndexAsync, search } = await loadBm25({ segmenter: "fake" });

    const empty = await buildIndexAsync([], { yieldEveryDocs: 1 });
    expect(empty.avgDocLen).toBe(0);
    expect(search(empty, "alpha", 8)).toEqual([]);

    const tooShort = await buildIndexAsync([{ chunkId: "c1", text: "alpha" }], { maxTermLength: 1 });
    expect(tooShort.df.size).toBe(0);
  });

  it("buildIndexAsync uses workerPool when available and supports abort", async () => {
    const { buildIndexAsync } = await loadBm25({ segmenter: "fake" });

    const workerPool = {
      buildIndex: vi.fn().mockResolvedValue({ ok: true }),
    };

    const chunks = [{ chunkId: "c1", text: "alpha" }];
    await expect(buildIndexAsync(chunks, { workerPool, k1: 1.5, b: 0.9, maxTokensPerDoc: 1 })).resolves.toEqual({ ok: true });
    expect(workerPool.buildIndex).toHaveBeenCalledWith(chunks, { k1: 1.5, b: 0.9 });

    const controller = new AbortController();
    controller.abort();
    await expect(buildIndexAsync(chunks, { signal: controller.signal, yieldEveryDocs: 1 })).rejects.toThrow(/aborted/i);
  });

  it("buildIndexAsync builds a usable index without workerPool (yield + token cap paths)", async () => {
    const { buildIndexAsync, search } = await loadBm25({ segmenter: "fake" });

    const index = await buildIndexAsync(
      [
        { chunkId: "c1", text: "alpha beta" },
        { chunkId: "c2", text: "alpha gamma delta" },
      ],
      { yieldEveryDocs: 1, maxTokensPerDoc: 1 }
    );

    expect(index.chunkIds).toEqual(["c1", "c2"]);
    expect(index.docLens).toEqual([1, 1]);

    const hits = search(index, "alpha", 10);
    expect(hits.map((h) => h.chunkId)).toEqual(["c1", "c2"]);
  });

  it("serializeIndex/deserializeIndex roundtrip keeps search behavior and skips junk snapshot entries", async () => {
    const { buildIndex, search, serializeIndex, deserializeIndex } = await loadBm25({ segmenter: "fake" });

    const index = buildIndex([
      { chunkId: "c1", text: "alpha beta" },
      { chunkId: "c2", text: "beta gamma" },
    ]);

    const snapshot = serializeIndex(index);
    expect(snapshot.schemaVersion).toBe("0.1");

    // Inject some garbage to ensure deserializer is resilient.
    snapshot.df.push(["", 10], ["ok", "2"], ["badOnlyOneItem"]);
    snapshot.postings.push(["", []], ["ok", [[0, 1], ["x", "y"], [1, 2]]], ["badOnlyOneItem"]);

    const restored = deserializeIndex(snapshot);
    const hits = search(restored, "alpha", 8);
    expect(hits.map((h) => h.chunkId)).toEqual(["c1"]);

    expect(() => serializeIndex(null)).toThrow(/index must be an object/i);
    expect(() => deserializeIndex(null)).toThrow(/snapshot must be an object/i);
  });

  it("deserializeIndex tolerates malformed postings entries (null terms, non-array lists, invalid pairs)", async () => {
    const { deserializeIndex, search } = await loadBm25({ segmenter: "fake" });

    const restored = deserializeIndex({
      schemaVersion: "0.1",
      chunkIds: ["c1", "c2"],
      docLens: [1, 1],
      // avgDocLen intentionally missing to exercise the computed fallback.
      df: [["alpha", 2]],
      postings: [
        [null, [[0, 1]]], // term => "" => dropped
        ["alpha", "not-an-array"], // list => []
        ["alpha", [[0, 1], ["bad"], 123, [1, 2]]], // invalid pairs filtered out
      ],
      k1: 0,
      b: 0,
    });

    expect(restored.postings.get("alpha")).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(search(restored, "alpha", 8).map((h) => h.chunkId)).toEqual(["c1", "c2"]);
  });

  async function loadBm25Internals(options = {}) {
    await loadBm25(options);

    const [{ readFile }, { fileURLToPath }] = await Promise.all([import("node:fs/promises"), import("node:url")]);
    const bm25Url = new URL("../../../js/agents/retrieval/bm25.js", import.meta.url);
    const bm25Path = fileURLToPath(bm25Url);
    const source = await readFile(bm25Url, "utf8");
    const importRe = /^import\s+\{\s*isPlainObject\s*\}\s+from\s+["'][^"']+value-utils\.js["'];/m;
    let prepared = source.replace(importRe, "const { isPlainObject } = __deps;");
    if (prepared === source) throw new Error("bm25 test hook could not rewrite imports");
    prepared = prepared.replace(/^export\s+/gm, "");

    const { isPlainObject } = await import("../../../js/agents/shared/utils/value-utils.js");
    const factory = new Function(
      "__deps",
      `${prepared}\nreturn { isCjkCodePoint, isAllCjkToken, pushCjkBigrams, getWordSegmenter, normalizeLimit, shouldDropSingleCharToken };` +
        `\n//# sourceURL=${bm25Path}`
    );
    return factory({ isPlainObject });
  }

  it("isCjkCodePoint covers extension ranges plus kana/hangul", async () => {
    const { isCjkCodePoint } = await loadBm25Internals();
    const samples = [
      0x20000, // Extension B
      0x2a700, // Extension C
      0x2b740, // Extension D
      0x2b820, // Extension E
      0x2ceb0, // Extension F
      0x30000, // Extension G
      0x3042, // Hiragana
      0x30a2, // Katakana
      0x31f0, // Katakana Phonetic Extensions
      0xac00, // Hangul Syllables
    ];

    for (const cp of samples) expect(isCjkCodePoint(cp)).toBe(true);
    expect(isCjkCodePoint(0x41)).toBe(false);
  });

  it("isAllCjkToken rejects empty/mixed/non-string tokens", async () => {
    const { isAllCjkToken } = await loadBm25Internals();

    expect(isAllCjkToken("")).toBe(false);
    expect(isAllCjkToken(null)).toBe(false);
    expect(isAllCjkToken(123)).toBe(false);
    expect(isAllCjkToken("\u4e00a")).toBe(false);
    expect(isAllCjkToken("\u4e00\u4e8c")).toBe(true);
  });

  it("pushCjkBigrams respects maxBigrams edge values", async () => {
    const { pushCjkBigrams } = await loadBm25Internals();

    const token = "\u4f60\u597d\u4e16\u754c";
    const chars = Array.from(token);
    const all = [chars[0] + chars[1], chars[1] + chars[2], chars[2] + chars[3]];
    const expectedEdge = [all[0], all[2]];

    const out1 = [];
    pushCjkBigrams(token, out1, { maxBigrams: 1 });
    expect(out1).toEqual(expectedEdge);

    const out2 = [];
    pushCjkBigrams(token, out2, { maxBigrams: Number.NaN });
    expect(out2).toEqual(all);

    const out3 = [];
    pushCjkBigrams(token, out3, { maxBigrams: -5 });
    expect(out3).toEqual(expectedEdge);
  });

  it("getWordSegmenter returns undefined when Intl.Segmenter throws", async () => {
    const { getWordSegmenter } = await loadBm25Internals();
    const Segmenter = vi.fn(function SegmenterCtor() {
      throw new Error("boom");
    });
    vi.stubGlobal("Intl", { Segmenter });

    expect(getWordSegmenter()).toBeUndefined();
    expect(getWordSegmenter()).toBeUndefined();
    expect(Segmenter).toHaveBeenCalledTimes(1);
  });

  it("normalizeLimit handles Infinity, negatives, and NaN", async () => {
    const { normalizeLimit } = await loadBm25Internals();

    expect(normalizeLimit(Infinity, 10)).toBe(Infinity);
    expect(normalizeLimit(-3, 10)).toBe(10);
    expect(normalizeLimit(Number.NaN, 10)).toBe(10);
  });

  it("shouldDropSingleCharToken keeps non-Latin single chars", async () => {
    const { shouldDropSingleCharToken } = await loadBm25Internals();

    expect(shouldDropSingleCharToken("7")).toBe(false);
    expect(shouldDropSingleCharToken("\u4e00")).toBe(false);
  });
});
