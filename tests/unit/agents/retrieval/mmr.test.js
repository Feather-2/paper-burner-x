import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock(
  "virtual:intl-segmenter",
  () => ({
    createSegmenter: (segmentImpl) =>
      function SegmenterCtor() {
        return { segment: segmentImpl };
      },
  }),
  { virtual: true }
);

const modulePath = "../../../../js/agents/retrieval/mmr.js";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("mmrSelect", () => {
  it("handles empty inputs and topK boundaries", async () => {
    const { mmrSelect } = await import(modulePath);

    expect(mmrSelect(null)).toEqual([]);
    expect(mmrSelect(undefined)).toEqual([]);
    expect(mmrSelect([], { topK: 3 })).toEqual([]);
    expect(mmrSelect({}, { topK: 3 })).toEqual([]);

    const single = [{ text: "x", score: 1 }];
    expect(mmrSelect(single, { topK: 1 })).toEqual(single);

    const candidates = [
      { chunkId: "a", text: "alpha", score: 1 },
      { chunkId: "b", text: "beta", score: 0.5 },
    ];

    expect(mmrSelect(candidates, { topK: 0 })).toEqual([]);
    expect(mmrSelect(candidates, { topK: -1 })).toEqual([]);

    const stringTopK = mmrSelect(candidates, { topK: "2" });
    expect(stringTopK.length).toBe(2);

    const maxTopK = mmrSelect(candidates, { topK: Number.MAX_SAFE_INTEGER });
    expect(maxTopK.length).toBe(2);
  });

  it("selects highest score first then diversifies by similarity", async () => {
    const { mmrSelect } = await import(modulePath);

    const candidates = [
      { chunkId: "a", text: "alpha beta", score: 1.0 },
      { chunkId: "b", text: "alpha beta", score: 0.9 },
      { chunkId: "c", text: "gamma delta", score: 0.8 },
    ];

    const out = mmrSelect(candidates, { topK: 2, lambda: 0.5 });
    expect(out.map((row) => row.chunkId)).toEqual(["a", "c"]);
  });

  it("clamps lambda and accepts numeric strings", async () => {
    const { mmrSelect } = await import(modulePath);

    const candidates = [
      { chunkId: "a", text: "alpha beta", score: 1.0 },
      { chunkId: "b", text: "alpha beta", score: 0.9 },
      { chunkId: "c", text: "gamma delta", score: 0.8 },
    ];

    const relOnly = mmrSelect(candidates, { topK: 3, lambda: 2 });
    expect(relOnly.map((row) => row.chunkId)).toEqual(["a", "b", "c"]);

    const diversifyOnly = mmrSelect(candidates, { topK: 2, lambda: -1 });
    expect(diversifyOnly.map((row) => row.chunkId)).toEqual(["a", "c"]);

    const stringLambda = mmrSelect(candidates, { topK: 2, lambda: "0.5" });
    expect(stringLambda.map((row) => row.chunkId)).toEqual(["a", "c"]);
  });

  it("prioritizes seed entries, de-dupes by chunkId, and ignores invalid seed values", async () => {
    const { mmrSelect } = await import(modulePath);

    const candidates = [
      { chunkId: "a", text: "alpha beta", score: 1.0 },
      { chunkId: "b", text: "gamma delta", score: 0.9 },
      { chunkId: "c", text: "epsilon zeta", score: 0.8 },
    ];

    const seed = [
      null,
      { chunkId: "", text: "bad seed", score: 100 },
      { chunkId: "b", text: "gamma delta", score: 0.9 },
      { chunkId: "b", text: "duplicate seed", score: 0.1 },
      { chunkId: "s1", text: "seed only", score: 0 },
    ];

    const out = mmrSelect(candidates, { topK: 2, seed, lambda: 0.7 });
    expect(out.map((row) => row.chunkId)).toEqual(["b", "s1"]);

    const seedNotArray = mmrSelect(candidates, { topK: 1, seed: "nope", lambda: 1 });
    expect(seedNotArray.map((row) => row.chunkId)).toEqual(["a"]);
  });

  it("uses Intl.Segmenter from a mocked dependency and caches it across rapid calls", async () => {
    const { createSegmenter } = await import("virtual:intl-segmenter");
    const segment = vi.fn((text) => {
      const parts = [];
      for (const word of String(text).split(/\s+/).filter(Boolean)) {
        parts.push({ segment: word, isWordLike: true });
        parts.push({ segment: ".", isWordLike: false });
        parts.push({ segment: word, isWordLike: true });
        parts.push({ isWordLike: true });
      }
      return parts;
    });
    const Segmenter = vi.fn(createSegmenter(segment));
    vi.stubGlobal("Intl", { Segmenter });

    const { mmrSelect } = await import(modulePath);

    const candidates = [
      { chunkId: "a", text: "Alpha Beta", score: 1.0 },
      { chunkId: "b", text: "alpha beta", score: 0.9 },
      { chunkId: "c", text: "Gamma Delta", score: 0.8 },
    ];

    const first = mmrSelect(candidates, { topK: 2, lambda: 0.5, maxTokens: 10 });
    const second = mmrSelect(candidates, { topK: 2, lambda: 0.5, maxTokens: 10 });

    expect(Segmenter).toHaveBeenCalledWith(undefined, { granularity: "word" });
    expect(Segmenter).toHaveBeenCalledTimes(1);
    expect(segment).toHaveBeenCalled();
    expect(segment.mock.calls[0][0]).toBe("alpha beta");
    expect(first.map((row) => row.chunkId)).toEqual(["a", "c"]);
    expect(second.map((row) => row.chunkId)).toEqual(["a", "c"]);
  });

  it("falls back to regex tokenization when Intl.Segmenter is missing", async () => {
    vi.stubGlobal("Intl", {});

    const { mmrSelect } = await import(modulePath);

    const candidates = [
      { chunkId: "a", text: "alpha beta", score: 1.0 },
      { chunkId: "b", text: "!!!", score: 0.9 },
      { chunkId: "c", text: "   ", score: 0.8 },
      { chunkId: "d", text: "", score: 0.7 },
      { chunkId: "e", text: "alpha beta", score: 0.6 },
    ];

    const out = mmrSelect(candidates, { topK: 2, lambda: 0 });
    expect(out.map((row) => row.chunkId)).toEqual(["a", "b"]);
  });

  it("falls back to regex tokenization when Intl.Segmenter construction throws", async () => {
    const Segmenter = vi.fn(function SegmenterCtor() {
      throw new Error("boom");
    });
    vi.stubGlobal("Intl", { Segmenter });

    const { mmrSelect } = await import(modulePath);

    const candidates = [
      { chunkId: "a", text: "alpha beta", score: 1.0 },
      { chunkId: "b", text: "alpha beta", score: 0.9 },
      { chunkId: "c", text: "gamma delta", score: 0.8 },
    ];

    const out = mmrSelect(candidates, { topK: 2, lambda: 0.5 });
    expect(out.map((row) => row.chunkId)).toEqual(["a", "c"]);
  });

  it("uses a fallback regex when Unicode property escapes are unsupported", async () => {
    const RealRegExp = globalThis.RegExp;
    function RegExpStub(pattern, flags) {
      if (pattern === "\\p{L}" && flags === "u") {
        throw new Error("no unicode property escapes");
      }
      return new RealRegExp(pattern, flags);
    }
    RegExpStub.prototype = RealRegExp.prototype;
    vi.stubGlobal("RegExp", RegExpStub);
    vi.stubGlobal("Intl", {});

    const { mmrSelect } = await import(modulePath);

    const candidates = [
      { chunkId: "a", text: "alpha beta", score: 1.0 },
      { chunkId: "b", text: "alpha beta", score: 0.9 },
      { chunkId: "c", text: "gamma delta", score: 0.8 },
    ];

    const out = mmrSelect(candidates, { topK: 2, lambda: 0.5 });
    expect(out.map((row) => row.chunkId)).toEqual(["a", "c"]);
  });

  it("handles simultaneous calls without shared state", async () => {
    vi.stubGlobal("Intl", {});

    const { mmrSelect } = await import(modulePath);

    const listA = [
      { chunkId: "a1", text: "alpha beta", score: 1.0 },
      { chunkId: "a2", text: "gamma delta", score: 0.5 },
    ];
    const listB = [
      { chunkId: "b1", text: "delta epsilon", score: 0.9 },
      { chunkId: "b2", text: "delta epsilon", score: 0.1 },
    ];

    const [outA, outB] = await Promise.all([
      Promise.resolve().then(() => mmrSelect(listA, { topK: 2, lambda: 1 })),
      Promise.resolve().then(() => mmrSelect(listB, { topK: 1, lambda: 0 })),
    ]);

    expect(outA.map((row) => row.chunkId)).toEqual(["a1", "a2"]);
    expect(outB.map((row) => row.chunkId)).toEqual(["b1"]);
  });

  it("handles large inputs and deeply nested values without throwing", async () => {
    vi.stubGlobal("Intl", {});

    const { mmrSelect } = await import(modulePath);

    const hugeText = Array.from({ length: 5000 }, (_, i) => `token${i}`).join(" ");
    const longToken = "a".repeat(10000);
    const deepNested = { level1: { level2: { level3: { level4: { value: "x" } } } } };

    const candidates = [
      { chunkId: "a", text: hugeText, score: 1.0 },
      { chunkId: "b", text: longToken, score: 0.9 },
      { chunkId: "c", text: deepNested, score: 0.8 },
      { chunkId: "d", text: "token1 token2", score: 0.7 },
    ];

    const out = mmrSelect(candidates, {
      topK: 2,
      lambda: 0.5,
      maxTokens: 3,
      seed: [[[{ chunkId: "seed", text: "seed text", score: 0 }]]],
    });

    expect(out.map((row) => row.chunkId)).toEqual(["a", "b"]);
  });
});
