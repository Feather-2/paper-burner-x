import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedShared = vi.hoisted(() => ({
  toNonEmptyString: vi.fn(),
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: mockedShared.toNonEmptyString,
}));

import {
  formatQuoteForCitation,
  extractEvidenceIdsFromMarkdownCitations,
  buildEvidenceIndex,
  formatRef,
  buildCitationsFromEvidenceIds,
} from "../../../../../../js/agents/stages/deepsearch/report/citations.js";

describe("agents/stages/deepsearch/report/citations.js", () => {
  beforeEach(() => {
    mockedShared.toNonEmptyString.mockReset();
    mockedShared.toNonEmptyString.mockImplementation((value) => {
      if (value === null || value === undefined) return undefined;
      const s = String(value).trim();
      return s.length ? s : undefined;
    });
  });

  describe("formatQuoteForCitation", () => {
    it("returns empty string for null/undefined/empty/whitespace/zero", () => {
      expect(formatQuoteForCitation(null)).toBe("");
      expect(formatQuoteForCitation(undefined)).toBe("");
      expect(formatQuoteForCitation("")).toBe("");
      expect(formatQuoteForCitation("   ")).toBe("");
      expect(formatQuoteForCitation(0)).toBe("");
    });

    it("normalizes whitespace and truncates at maxLen", () => {
      expect(formatQuoteForCitation("  hello \n world  ", { maxLen: 8 })).toBe("hello...");
      expect(formatQuoteForCitation("  foo \n bar   baz  ")).toBe("foo bar baz");
    });

    it("replaces table-looking content with placeholder", () => {
      expect(formatQuoteForCitation("|a|b|\n|c|d|")).toBe("[表格数据]");
      expect(formatQuoteForCitation("intro\n|x|y|\nmore")).toBe("[表格数据]");
    });

    it("uses default length when maxLen is not finite", () => {
      const longText = "a".repeat(210);
      const result = formatQuoteForCitation(longText, { maxLen: "10" });

      expect(result.length).toBe(200);
      expect(result.endsWith("...")).toBe(true);
    });

    it("handles long strings and concurrent calls consistently", async () => {
      const longText = "x".repeat(500);
      const expected = formatQuoteForCitation(longText);

      const results = await Promise.all(
        Array.from({ length: 8 }, () => Promise.resolve(formatQuoteForCitation(longText))),
      );

      for (const res of results) {
        expect(res).toBe(expected);
      }

      for (let i = 0; i < 5; i += 1) {
        expect(formatQuoteForCitation(`  run ${i}  `)).toBe(`run ${i}`);
      }
    });
  });

  describe("extractEvidenceIdsFromMarkdownCitations", () => {
    it("extracts unique evidence ids in order", () => {
      const md = "A {{cite:alpha}} B {{ cite: beta_1 }} C {{cite:alpha}}";
      const result = extractEvidenceIdsFromMarkdownCitations(md);

      expect(result).toEqual(["alpha", "beta_1"]);
    });

    it("returns empty array for non-string or empty inputs", () => {
      const inputs = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, {}, []];

      for (const input of inputs) {
        expect(extractEvidenceIdsFromMarkdownCitations(input)).toEqual([]);
      }
    });

    it("handles large markdown inputs with deduping", () => {
      const ids = Array.from({ length: 1000 }, (_, i) => `id${i % 10}`);
      const md = ids.map((id) => `{{cite:${id}}}`).join(" ");

      const result = extractEvidenceIdsFromMarkdownCitations(md);

      expect(result).toEqual(Array.from({ length: 10 }, (_, i) => `id${i}`));
    });

    it("supports concurrent and rapid consecutive calls without shared state", async () => {
      const md = "X {{cite:a}} Y {{cite:b}} Z {{cite:a}}";
      const expected = ["a", "b"];

      const results = await Promise.all(
        Array.from({ length: 6 }, () => Promise.resolve(extractEvidenceIdsFromMarkdownCitations(md))),
      );

      for (const res of results) {
        expect(res).toEqual(expected);
      }

      for (let i = 0; i < 4; i += 1) {
        expect(extractEvidenceIdsFromMarkdownCitations(md)).toEqual(expected);
      }
    });
  });

  describe("buildEvidenceIndex", () => {
    it("builds maps with deduping and trims ids", () => {
      const e1 = { evidenceId: " e1 ", quote: "q1" };
      const e1Dup = { evidenceId: "e1", quote: "q2" };
      const e2 = { evidenceId: "e2" };
      const eEmpty = { evidenceId: "   " };

      const s1 = { sourceId: " s1 ", title: "T1" };
      const s1Dup = { sourceId: "s1", title: "T2" };
      const s2 = { sourceId: "s2", uri: "http://example.com" };
      const sEmpty = { sourceId: "" };

      const { evidenceById, sourceById } = buildEvidenceIndex(
        [e1, e1Dup, e2, eEmpty],
        [s1, s1Dup, s2, sEmpty],
      );

      expect(evidenceById.size).toBe(2);
      expect(evidenceById.get("e1")).toBe(e1);
      expect(evidenceById.get("e2")).toBe(e2);

      expect(sourceById.size).toBe(2);
      expect(sourceById.get("s1")).toBe(s1);
      expect(sourceById.get("s2")).toBe(s2);
    });

    it("handles empty and non-array inputs safely", () => {
      const cases = [
        [null, undefined],
        [undefined, null],
        [[], []],
        [{}, {}],
        ["", ""],
      ];

      for (const [evidenceLedger, sources] of cases) {
        const { evidenceById, sourceById } = buildEvidenceIndex(evidenceLedger, sources);
        expect(evidenceById.size).toBe(0);
        expect(sourceById.size).toBe(0);
      }
    });

    it("accepts numeric ids including boundary values", () => {
      const eZero = { evidenceId: 0 };
      const eNegative = { evidenceId: -1 };
      const eMax = { evidenceId: Number.MAX_SAFE_INTEGER };
      const sZero = { sourceId: 0 };
      const sMax = { sourceId: Number.MAX_SAFE_INTEGER };

      const { evidenceById, sourceById } = buildEvidenceIndex(
        [eZero, eNegative, eMax],
        [sZero, sMax],
      );

      expect(evidenceById.has("0")).toBe(true);
      expect(evidenceById.has("-1")).toBe(true);
      expect(evidenceById.has(String(Number.MAX_SAFE_INTEGER))).toBe(true);
      expect(sourceById.has("0")).toBe(true);
      expect(sourceById.has(String(Number.MAX_SAFE_INTEGER))).toBe(true);
    });
  });

  describe("formatRef", () => {
    it("formats ranges and single-line refs", () => {
      expect(formatRef("s1", 1, 3)).toBe("[s1:L1-L3]");
      expect(formatRef("s1", 5, 5)).toBe("[s1:L5]");
      expect(formatRef("s1", 0, 0)).toBe("[s1:L0]");
    });

    it("handles missing sourceId and non-finite line numbers", () => {
      expect(formatRef("", 1, 2)).toBe("");
      expect(formatRef(null, 1, 2)).toBe("");
      expect(formatRef("s1", "7", 9)).toBe("[s1]");
    });

    it("supports negative and max-safe line numbers", () => {
      expect(formatRef("src", -1, 2)).toBe("[src:L-1-L2]");
      expect(formatRef("src", Number.MAX_SAFE_INTEGER, null)).toBe(`[src:L${Number.MAX_SAFE_INTEGER}]`);
    });
  });

  describe("buildCitationsFromEvidenceIds", () => {
    it("builds citations with metadata, refs, and deduping", () => {
      const evidenceLedger = [
        {
          evidenceId: "e1",
          sourceId: "s1",
          quote: "Quote 1",
          lineStart: 1,
          lineEnd: 2,
          locator: { page: 3, section: "A" },
        },
        {
          evidenceId: "e2",
          sourceId: "s2",
          lineStart: 5,
          lineEnd: 5,
          chunkId: "c2",
        },
      ];

      const sources = [
        { sourceId: "s1", title: "Source One", uri: "http://source.one" },
        { sourceId: "s2", title: "   ", uri: "http://source.two" },
      ];

      const citations = buildCitationsFromEvidenceIds(["e1", "e2", "missing", "e1"], evidenceLedger, sources);

      expect(citations).toHaveLength(2);
      expect(citations[0]).toMatchObject({
        citationId: 1,
        evidenceId: "e1",
        sourceId: "s1",
        sourceTitle: "Source One",
        sourceUri: "http://source.one",
        quote: "Quote 1",
        lineStart: 1,
        lineEnd: 2,
        ref: "[s1:L1-L2]",
      });
      expect(citations[0].locator).toEqual({ page: 3, section: "A" });

      expect(citations[1]).toMatchObject({
        citationId: 2,
        evidenceId: "e2",
        sourceId: "s2",
        sourceUri: "http://source.two",
        lineStart: 5,
        lineEnd: 5,
        chunkId: "c2",
        ref: "[s2:L5]",
      });
      expect(citations[1].sourceTitle).toBeUndefined();
    });

    it("handles empty inputs and missing evidence safely", () => {
      expect(buildCitationsFromEvidenceIds([], null, {})).toEqual([]);

      const citations = buildCitationsFromEvidenceIds([" ", "missing"], [], []);
      expect(citations).toEqual([]);
    });

    it("supports numeric ids, deep locator, and long quotes", () => {
      const deepLocator = { page: 1, section: "S", nested: { level: { deep: "x" } } };
      const longQuote = "q".repeat(300);

      const evidenceLedger = [
        {
          evidenceId: 0,
          sourceId: Number.MAX_SAFE_INTEGER,
          quote: longQuote,
          lineStart: 0,
          lineEnd: -1,
          locator: deepLocator,
        },
      ];
      const sources = [
        { sourceId: Number.MAX_SAFE_INTEGER, title: "Max Source" },
      ];

      const citations = buildCitationsFromEvidenceIds(["0"], evidenceLedger, sources);

      expect(citations).toHaveLength(1);
      expect(citations[0]).toMatchObject({
        citationId: 1,
        evidenceId: "0",
        sourceId: String(Number.MAX_SAFE_INTEGER),
        sourceTitle: "Max Source",
        quote: longQuote,
        lineStart: 0,
        lineEnd: -1,
        ref: `[${Number.MAX_SAFE_INTEGER}:L0-L-1]`,
      });
      expect(citations[0].locator).toBe(deepLocator);
    });

    it("returns independent results across concurrent and rapid calls", async () => {
      const evidenceLedger = [{ evidenceId: "e1", sourceId: "s1", lineStart: 1, lineEnd: 1 }];
      const sources = [{ sourceId: "s1", title: "T" }];

      const expected = buildCitationsFromEvidenceIds(["e1"], evidenceLedger, sources);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          Promise.resolve(buildCitationsFromEvidenceIds(["e1"], evidenceLedger, sources)),
        ),
      );

      for (const res of results) {
        expect(res).toEqual(expected);
        expect(res).not.toBe(expected);
      }

      const second = buildCitationsFromEvidenceIds(["e1"], evidenceLedger, sources);
      expect(second).toEqual(expected);
      expect(second).not.toBe(expected);
    });
  });
});
