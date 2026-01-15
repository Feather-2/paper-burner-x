import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("agents/retrieval/mmr", () => {
  it("selects highest-score first, then diversifies by penalizing similarity (MMR)", async () => {
    const { mmrSelect } = await import("../../../js/agents/retrieval/mmr.js");

    const candidates = [
      { chunkId: "a", text: "alpha beta", score: 1.0 },
      { chunkId: "b", text: "alpha beta", score: 0.9 },
      { chunkId: "c", text: "gamma delta", score: 0.8 },
    ];

    const out = mmrSelect(candidates, { topK: 2, lambda: 0.5 });
    expect(out.map((r) => r.chunkId)).toEqual(["a", "c"]);
  });

  it("clamps lambda into [0, 1] (lambda > 1 becomes pure relevance ranking)", async () => {
    const { mmrSelect } = await import("../../../js/agents/retrieval/mmr.js");

    const candidates = [
      { chunkId: "a", text: "alpha beta", score: 1.0 },
      { chunkId: "b", text: "alpha beta", score: 0.9 },
      { chunkId: "c", text: "gamma delta", score: 0.8 },
    ];

    const out = mmrSelect(candidates, { topK: 3, lambda: 2 });
    expect(out.map((r) => r.chunkId)).toEqual(["a", "b", "c"]);
  });

  it("prefers seed items first and de-dupes by chunkId", async () => {
    const { mmrSelect } = await import("../../../js/agents/retrieval/mmr.js");

    const candidates = [
      { chunkId: "a", text: "alpha beta", score: 1.0 },
      { chunkId: "b", text: "alpha beta", score: 0.9 },
      { chunkId: "c", text: "gamma delta", score: 0.8 },
    ];

    const seed = [
      { chunkId: "c", text: "gamma delta", score: 0.8 },
      { chunkId: "c", text: "duplicate seed", score: 0.1 },
    ];

    const out = mmrSelect(candidates, { topK: 2, seed, lambda: 0.7 });
    expect(out.map((r) => r.chunkId)).toEqual(["c", "a"]);
  });

  it("uses Intl.Segmenter when available and ignores non-word-like segments", async () => {
    const segment = vi.fn((text) => {
      const parts = [];
      for (const w of String(text).split(/\s+/).filter(Boolean)) {
        parts.push({ segment: w, isWordLike: true });
        // Noise tokens should be skipped by tokenizeForSimilarity().
        parts.push({ segment: ".", isWordLike: false });
      }
      return parts;
    });
    // Vitest warns when using a bare vi.fn() as a constructor mock; use a real function implementation.
    const Segmenter = vi.fn(function SegmenterCtor() {
      return { segment };
    });
    vi.stubGlobal("Intl", { Segmenter });

    const { mmrSelect } = await import("../../../js/agents/retrieval/mmr.js");
    const out = mmrSelect(
      [
        { chunkId: "a", text: "Alpha Beta", score: 1.0 },
        { chunkId: "b", text: "alpha beta", score: 0.9 },
        { chunkId: "c", text: "Gamma Delta", score: 0.8 },
      ],
      { topK: 2, lambda: 0.5 }
    );

    expect(Segmenter).toHaveBeenCalledWith(undefined, { granularity: "word" });
    expect(segment).toHaveBeenCalled();
    // tokenizeForSimilarity lowercases the input before passing it to segment()
    expect(segment.mock.calls[0][0]).toBe("alpha beta");
    expect(out.map((r) => r.chunkId)).toEqual(["a", "c"]);
  });

  it("falls back to regex tokenization if Intl.Segmenter construction throws", async () => {
    const Segmenter = vi.fn(function SegmenterCtor() {
      throw new Error("boom");
    });
    vi.stubGlobal("Intl", { Segmenter });

    const { mmrSelect } = await import("../../../js/agents/retrieval/mmr.js");

    const out = mmrSelect(
      [
        { chunkId: "a", text: "alpha beta", score: 1.0 },
        { chunkId: "b", text: "alpha beta", score: 0.9 },
        { chunkId: "c", text: "gamma delta", score: 0.8 },
      ],
      { topK: 2, lambda: 0.5 }
    );

    expect(out.map((r) => r.chunkId)).toEqual(["a", "c"]);
  });

  it("handles topK <= 0, missing chunkIds, and duplicate candidates deterministically", async () => {
    const { mmrSelect } = await import("../../../js/agents/retrieval/mmr.js");

    expect(mmrSelect([{ chunkId: "a", text: "x", score: 1 }], { topK: 0 })).toEqual([]);

    // list.length <= 1 is a fast path that does not require chunkId.
    expect(mmrSelect([{ text: "x", score: 1 }], { topK: 1 })).toEqual([{ text: "x", score: 1 }]);

    // With multiple candidates, entries without a usable chunkId are skipped.
    expect(mmrSelect([{ text: "x", score: 1 }, { text: "y", score: 2 }], { topK: 2 })).toEqual([]);

    // Duplicate chunkId keeps the first occurrence.
    const out = mmrSelect(
      [
        { chunkId: "a", text: "alpha", score: 0 },
        { chunkId: "a", text: "alpha NEW", score: 100 },
        { chunkId: "b", text: "beta", score: 50 },
      ],
      { topK: 2, lambda: 1 }
    );
    expect(out.map((r) => r.chunkId)).toEqual(["b", "a"]);
  });

  it("uses regex tokenization when Intl.Segmenter is missing and respects maxTokens (min 10)", async () => {
    // Force the no-segmenter path in getMmrSegmenter().
    vi.stubGlobal("Intl", {});

    const { mmrSelect } = await import("../../../js/agents/retrieval/mmr.js");

    const longText = Array.from({ length: 30 }, (_, i) => `t${i + 1}`).join(" ");
    const out = mmrSelect(
      [
        { chunkId: "a", text: longText, score: 1.0 },
        { chunkId: "b", text: "t1 t2 t3 t4 t5 t6 t7 t8 t9 t10 t11", score: 0.9 },
        { chunkId: "c", text: "gamma delta", score: 0.8 },
      ],
      // maxTokens < 10 is clamped up to 10 in tokenizeForSimilarity()
      { topK: 2, lambda: 0.5, maxTokens: 3 }
    );

    expect(out.map((r) => r.chunkId)).toEqual(["a", "c"]);
  });

  it("can build a fallback word regex when Unicode property escapes are unavailable", async () => {
    // Trigger the mmrWordRegex() catch branch by making the feature-probe RegExp throw.
    const RealRegExp = globalThis.RegExp;
    function RegExpStub(pattern, flags) {
      if (pattern === "\\p{L}" && flags === "u") throw new Error("no unicode property escapes");
      // Support both RegExp(...) and new RegExp(...).
      return new RealRegExp(pattern, flags);
    }
    RegExpStub.prototype = RealRegExp.prototype;
    vi.stubGlobal("RegExp", RegExpStub);
    vi.stubGlobal("Intl", {}); // ensure we exercise the regex tokenization path

    const { mmrSelect } = await import("../../../js/agents/retrieval/mmr.js");

    const out = mmrSelect(
      [
        { chunkId: "a", text: "alpha beta", score: 1.0 },
        { chunkId: "b", text: "alpha beta", score: 0.9 },
        { chunkId: "c", text: "gamma delta", score: 0.8 },
      ],
      { topK: 2, lambda: 0.5 }
    );

    expect(out.map((r) => r.chunkId)).toEqual(["a", "c"]);
  });

  it("treats empty texts as having no tokens (similarity=0) and still selects by relevance", async () => {
    const { mmrSelect } = await import("../../../js/agents/retrieval/mmr.js");

    const out = mmrSelect(
      [
        { chunkId: "a", text: "", score: 1.0 },
        { chunkId: "b", text: "", score: 0.5 },
      ],
      { topK: 2, lambda: Number.NaN }
    );

    // NaN lambda clamps to 0 => diversify-only, but similarity remains 0 for empty texts.
    expect(out.map((r) => r.chunkId)).toEqual(["a", "b"]);
  });
});
