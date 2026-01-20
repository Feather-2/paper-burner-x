import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => {
  return {
    isPlainObject: vi.fn((v) => {
      if (v === null || typeof v !== "object") return false;
      if (Array.isArray(v)) return false;
      const proto = Object.getPrototypeOf(v);
      return proto === Object.prototype || proto === null;
    }),
    toNonEmptyString: vi.fn((v) => {
      if (v === undefined || v === null) return undefined;
      const s = String(v).trim();
      return s.length ? s : undefined;
    }),
  };
});

import { isPlainObject, toNonEmptyString } from "../../../../../js/agents/shared/utils/value-utils.js";
import { extractClaims } from "../../../../../js/agents/stages/textprep/claims.js";

function makeChunk({ text, charStart = 0, charEnd, lineStart, lineEnd, extra = {} }) {
  return {
    chunkId: extra.chunkId || "chunk",
    text,
    locator: {
      charStart,
      charEnd: charEnd ?? (typeof text === "string" ? text.length : 0),
      ...(lineStart !== undefined ? { lineStart } : {}),
      ...(lineEnd !== undefined ? { lineEnd } : {}),
    },
    ...extra,
  };
}

function makeSlide(pageType, id = "s1") {
  return { slideIntentId: id, pageType, title: pageType.toUpperCase() };
}

describe("extractClaims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPlainObject.mockImplementation((v) => {
      if (v === null || typeof v !== "object") return false;
      if (Array.isArray(v)) return false;
      const proto = Object.getPrototypeOf(v);
      return proto === Object.prototype || proto === null;
    });
    toNonEmptyString.mockImplementation((v) => {
      if (v === undefined || v === null) return undefined;
      const s = String(v).trim();
      return s.length ? s : undefined;
    });
  });

  it("throws on invalid chunks and slideIntents types (null/undefined/object)", () => {
    const badChunks = [null, undefined, {}, "nope"];
    for (const value of badChunks) {
      expect(() => extractClaims(value, [], {})).toThrow(TypeError);
      expect(() => extractClaims(value, [], {})).toThrow("chunks must be an array");
    }

    const badSlides = [null, {}, "nope"];
    for (const value of badSlides) {
      expect(() => extractClaims([], value, {})).toThrow(TypeError);
      expect(() => extractClaims([], value, {})).toThrow("slideIntents must be an array");
    }
  });

  it("rejects non-plain options and accepts empty objects", () => {
    expect(() => extractClaims([], [], null)).toThrow(TypeError);
    expect(isPlainObject).toHaveBeenCalledWith(null);

    const out = extractClaims([], [], {});
    expect(out).toEqual({ claims: [], evidenceLedger: [] });
  });

  it("builds claims and evidence from sourceTextNormalized (normal path)", () => {
    const chunk1Text = "  Alpha   Beta   Gamma. Delta and epsilon.";
    const chunk2Text = "Second chunk has evidence. And more.";
    const sourceTextNormalized = `${chunk1Text}\n${chunk2Text}`;
    const chunk2Start = chunk1Text.length + 1;

    const chunks = [
      makeChunk({ text: chunk1Text, charStart: 0, charEnd: chunk1Text.length, lineStart: 1, lineEnd: 1, extra: { chunkId: "c1" } }),
      makeChunk({ text: chunk2Text, charStart: chunk2Start, charEnd: chunk2Start + chunk2Text.length, extra: { chunkId: "c2" } }),
    ];
    const slideIntents = [makeSlide("content", "s1"), makeSlide("cover", "s2")];

    const { claims, evidenceLedger } = extractClaims(chunks, slideIntents, {
      sourceId: "  Source-1 ",
      sourceTextNormalized,
    });

    expect(toNonEmptyString).toHaveBeenCalledWith("  Source-1 ");
    expect(claims).toHaveLength(2);
    expect(evidenceLedger).toHaveLength(2);

    expect(evidenceLedger[0].sourceId).toBe("Source-1");
    expect(evidenceLedger[0].quote).toBe(chunk1Text.slice(2));
    expect(evidenceLedger[0].locator).toMatchObject({ charStart: 2, charEnd: chunk1Text.length, lineStart: 1, lineEnd: 1 });
    expect(claims[0]).toMatchObject({ claimId: "c1", evidenceIds: ["e1"], importance: "core" });
    expect(claims[0].text).toBe("Alpha Beta Gamma. Delta and epsilon.");

    expect(evidenceLedger[1].quote).toBe(chunk2Text);
    expect(evidenceLedger[1].locator.charStart).toBe(chunk2Start);
    expect(evidenceLedger[1].locator.lineStart).toBeUndefined();
    expect(claims[1]).toMatchObject({ claimId: "c2", evidenceIds: ["e2"], importance: "support" });
  });

  it("respects maxClaims (flooring) and skips invalid chunks", () => {
    const validText = "Valid chunk text that has enough length for a span.";
    const sourceTextNormalized = validText;
    const chunks = [
      { chunkId: "bad1", text: 123, locator: { charStart: 0, charEnd: 10 } },
      { chunkId: "bad2", text: "   ", locator: { charStart: 0, charEnd: 3 } },
      makeChunk({ text: validText, charStart: 0, charEnd: validText.length, extra: { chunkId: "good1" } }),
      makeChunk({ text: "Second valid text", charStart: 0, charEnd: 18, extra: { chunkId: "good2" } }),
    ];

    const { claims, evidenceLedger } = extractClaims(chunks, [makeSlide("content")], {
      sourceTextNormalized,
      maxClaims: 1.9,
    });

    expect(claims).toHaveLength(1);
    expect(evidenceLedger).toHaveLength(1);
    expect(claims[0].claimId).toBe("c1");
    expect(evidenceLedger[0].quote).toBe(validText);
  });

  it("falls back to sourceTextNormalized when no valid chunks (empty array + whitespace sourceId)", () => {
    const sourceTextNormalized = "   Fallback text for claim.  ";
    const { claims, evidenceLedger } = extractClaims([], [], {
      sourceTextNormalized,
      sourceId: "   ",
    });

    expect(claims).toHaveLength(1);
    expect(evidenceLedger).toHaveLength(1);
    expect(evidenceLedger[0].sourceId).toBe("user_text");
    expect(evidenceLedger[0].quote).toBe(sourceTextNormalized.slice(0, 200));
    expect(claims[0]).toMatchObject({ claimId: "c1", evidenceIds: ["e1"], importance: "core" });
    expect(claims[0].text).toBe("Fallback text for claim.");
  });

  it("returns empty arrays when no claims and sourceTextNormalized is empty string", () => {
    const { claims, evidenceLedger } = extractClaims([], [], { sourceTextNormalized: "" });
    expect(claims).toEqual([]);
    expect(evidenceLedger).toEqual([]);
  });

  it("uses chunk text when sourceTextNormalized is empty and enforces maxQuoteLen", () => {
    const chunkText = "     012345678901234567890123456789";
    const chunks = [makeChunk({ text: chunkText, charStart: 0, charEnd: chunkText.length, extra: { chunkId: "c1" } })];

    const { claims, evidenceLedger } = extractClaims(chunks, [makeSlide("content")], {
      sourceTextNormalized: "",
      maxQuoteLen: 12,
    });

    expect(claims).toHaveLength(1);
    expect(evidenceLedger).toHaveLength(1);
    expect(evidenceLedger[0].quote).toBe(chunkText.slice(5, 17));
    expect(evidenceLedger[0].quote.length).toBe(12);
  });

  it("throws when locator bounds exceed sourceTextNormalized length", () => {
    const chunkText = "Valid chunk text.";
    const chunks = [makeChunk({ text: chunkText, charStart: 0, charEnd: chunkText.length })];
    expect(() =>
      extractClaims(chunks, [makeSlide("content")], {
        sourceTextNormalized: "short",
      })
    ).toThrow("out of bounds");
  });

  it("handles boundary values for maxClaims (0, -1, MAX_SAFE_INTEGER, string)", () => {
    const chunk1Text = "First chunk text.";
    const chunk2Text = "Second chunk text.";
    const sourceTextNormalized = `${chunk1Text}\n${chunk2Text}`;
    const chunk2Start = chunk1Text.length + 1;
    const chunks = [
      makeChunk({ text: chunk1Text, charStart: 0, charEnd: chunk1Text.length }),
      makeChunk({ text: chunk2Text, charStart: chunk2Start, charEnd: chunk2Start + chunk2Text.length }),
    ];
    const slideIntents = [makeSlide("cover")];

    const cases = [
      { maxClaims: 0, expected: 1 },
      { maxClaims: -1, expected: 1 },
      { maxClaims: "3", expected: 1 },
      { maxClaims: Number.MAX_SAFE_INTEGER, expected: 2 },
    ];

    for (const { maxClaims, expected } of cases) {
      const { claims } = extractClaims(chunks, slideIntents, { sourceTextNormalized, maxClaims });
      expect(claims).toHaveLength(expected);
    }
  });

  it("supports concurrent and rapid consecutive calls without shared state", async () => {
    const textA = "First concurrent text.";
    const textB = "Second concurrent text.";
    const chunksA = [makeChunk({ text: textA, charStart: 0, charEnd: textA.length })];
    const chunksB = [makeChunk({ text: textB, charStart: 0, charEnd: textB.length })];
    const slides = [makeSlide("content")];

    const [resultA, resultB] = await Promise.all([
      Promise.resolve(extractClaims(chunksA, slides, { sourceTextNormalized: textA, sourceId: "A" })),
      Promise.resolve(extractClaims(chunksB, slides, { sourceTextNormalized: textB, sourceId: "B" })),
    ]);

    expect(resultA.claims[0].text).toBe("First concurrent text.");
    expect(resultB.claims[0].text).toBe("Second concurrent text.");
    expect(resultA.evidenceLedger[0].sourceId).toBe("A");
    expect(resultB.evidenceLedger[0].sourceId).toBe("B");

    const rapid = Array.from({ length: 5 }, () =>
      extractClaims(chunksA, slides, { sourceTextNormalized: textA, sourceId: "Fast" })
    );
    for (const result of rapid) {
      expect(result.claims[0].claimId).toBe("c1");
      expect(result.evidenceLedger[0].evidenceId).toBe("e1");
    }
  });

  it("handles large inputs, long strings, and deep nesting", () => {
    const longBody = "A".repeat(50000);
    const chunkText = `     ${longBody} END.`;
    const sourceTextNormalized = chunkText;
    const chunks = [
      makeChunk({
        text: chunkText,
        charStart: 0,
        charEnd: chunkText.length,
        extra: { meta: { a: { b: { c: { d: { e: "deep" } } } } } },
      }),
    ];

    const { claims, evidenceLedger } = extractClaims(chunks, [makeSlide("content")], {
      sourceTextNormalized,
      maxQuoteLen: 120,
    });

    expect(claims).toHaveLength(1);
    expect(evidenceLedger).toHaveLength(1);
    expect(evidenceLedger[0].quote.length).toBe(120);
    expect(claims[0].text.length).toBe(120);
  });
});
