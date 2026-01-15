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
    expect(() => search(index, 123)).toThrow(/query must be a string/i);
    expect(() => search(index, "alpha", 8, null)).toThrow(/options must be an object/i);
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
});
