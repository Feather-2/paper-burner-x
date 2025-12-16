import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { createWriterToolExecutor } from "../../../js/agents/stages/deepsearch/react-writer.js";

describe("ReAct Writer Tool Executor", () => {
  let executor;
  const mockGaps = [
    { gapId: "g1", question: "What is the main hypothesis?", type: "core", status: "open", priority: "high" },
    { gapId: "g2", question: "What evidence supports it?", type: "support", status: "filled", priority: "medium" },
  ];
  const mockClaims = [
    { claimId: "c1", text: "The study found significant correlation", importance: "core", gapIds: ["g1"], evidenceIds: ["e1", "e2"] },
    { claimId: "c2", text: "Secondary evidence shows trend", importance: "support", gapIds: ["g2"], evidenceIds: ["e3"] },
  ];
  const mockEvidence = [
    { evidenceId: "e1", sourceId: "s1", quote: "Correlation coefficient r=0.85 (p<0.001)", locator: { charStart: 100, charEnd: 150 }, gapIds: ["g1"] },
    { evidenceId: "e2", sourceId: "s1", quote: "Sample size n=500", locator: { charStart: 200, charEnd: 220 }, gapIds: ["g1"] },
    { evidenceId: "e3", sourceId: "s2", quote: "Trend observed over 5 years", locator: { charStart: 50, charEnd: 80 }, gapIds: ["g2"] },
  ];
  const mockSources = [
    { sourceId: "s1", title: "Research Paper A", uri: "file://paper_a.pdf", sourceTextNormalized: "Introduction. ".repeat(20) + "Correlation coefficient r=0.85 (p<0.001). " + "More text. ".repeat(10) + "Sample size n=500. Conclusion." },
    { sourceId: "s2", title: "Research Paper B", uri: "file://paper_b.pdf", sourceTextNormalized: "Abstract. ".repeat(5) + "Trend observed over 5 years. Analysis." },
  ];

  beforeEach(() => {
    executor = createWriterToolExecutor({
      state: {},
      claims: mockClaims,
      evidenceLedger: mockEvidence,
      sources: mockSources,
      gaps: mockGaps,
    });
  });

  describe("getGaps", () => {
    it("should return all gaps with claim counts", async () => {
      const result = await executor.execute("getGaps", {});
      assert.strictEqual(result.totalGaps, 2);
      assert.strictEqual(result.gaps.length, 2);
      assert.strictEqual(result.gaps[0].gapId, "g1");
      assert.strictEqual(result.gaps[0].claimCount, 1);
    });
  });

  describe("getGapDetail", () => {
    it("should return gap with related claims", async () => {
      const result = await executor.execute("getGapDetail", { gapId: "g1" });
      assert.strictEqual(result.gapId, "g1");
      assert.strictEqual(result.question, "What is the main hypothesis?");
      assert.strictEqual(result.claims.length, 1);
      assert.strictEqual(result.claims[0].claimId, "c1");
    });

    it("should return error for missing gapId", async () => {
      const result = await executor.execute("getGapDetail", {});
      assert.ok(result.error);
    });

    it("should return error for unknown gap", async () => {
      const result = await executor.execute("getGapDetail", { gapId: "unknown" });
      assert.ok(result.error);
    });
  });

  describe("getClaimsForGap", () => {
    it("should return claims with evidence previews", async () => {
      const result = await executor.execute("getClaimsForGap", { gapId: "g1" });
      assert.strictEqual(result.gapId, "g1");
      assert.strictEqual(result.claims.length, 1);
      assert.strictEqual(result.claims[0].evidencePreviews.length, 2);
    });
  });

  describe("getEvidence", () => {
    it("should return full evidence details", async () => {
      const result = await executor.execute("getEvidence", { evidenceId: "e1" });
      assert.strictEqual(result.evidenceId, "e1");
      assert.strictEqual(result.sourceTitle, "Research Paper A");
      assert.ok(result.quote.includes("r=0.85"));
    });

    it("should return error for unknown evidence", async () => {
      const result = await executor.execute("getEvidence", { evidenceId: "unknown" });
      assert.ok(result.error);
    });
  });

  describe("getSourceChunk", () => {
    it("should return text chunk from source", async () => {
      const result = await executor.execute("getSourceChunk", { sourceId: "s1", start: 0, end: 100 });
      assert.strictEqual(result.sourceId, "s1");
      assert.ok(result.text);
      assert.strictEqual(result.charStart, 0);
      assert.strictEqual(result.charEnd, 100);
    });

    it("should clamp out-of-bounds ranges", async () => {
      const result = await executor.execute("getSourceChunk", { sourceId: "s1", start: -10, end: 50 });
      assert.strictEqual(result.charStart, 0);
    });

    it("should use default end if not specified", async () => {
      const result = await executor.execute("getSourceChunk", { sourceId: "s1", start: 0 });
      assert.ok(result.charEnd > 0);
      assert.ok(result.text.length > 0);
    });
  });

  describe("searchEvidence", () => {
    it("should return matching evidence", async () => {
      const result = await executor.execute("searchEvidence", { query: "correlation" });
      assert.ok(result.results.length > 0);
      assert.strictEqual(result.results[0].evidenceId, "e1");
    });

    it("should return error for empty query", async () => {
      const result = await executor.execute("searchEvidence", { query: "" });
      assert.ok(result.error);
    });
  });

  describe("writeSection", () => {
    it("should write a section and track it", async () => {
      const result = await executor.execute("writeSection", {
        gapId: "g1",
        title: "Main Findings",
        markdown: "The study demonstrates **significant correlation** {{cite:e1}}.",
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.gapId, "g1");
      assert.ok(result.wordCount > 0);

      const finalResult = executor.getResult();
      assert.strictEqual(finalResult.sections.length, 1);
    });

    it("should allow section without gapId", async () => {
      const result = await executor.execute("writeSection", {
        markdown: "Introduction paragraph.",
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.gapId, null);
    });

    it("should return error if markdown is empty", async () => {
      const result = await executor.execute("writeSection", { gapId: "g1", markdown: "" });
      assert.ok(result.error);
    });
  });

  describe("finishReport", () => {
    it("should finalize report and calculate total words", async () => {
      await executor.execute("writeSection", { markdown: "First section content here." });
      await executor.execute("writeSection", { markdown: "Second section with more content." });

      const result = await executor.execute("finishReport", {
        title: "Research Report",
        summary: "This report summarizes key findings.",
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.title, "Research Report");
      assert.strictEqual(result.sectionsCount, 2);
      assert.ok(result.totalWords > 0);

      const finalResult = executor.getResult();
      assert.strictEqual(finalResult.finished, true);
      assert.strictEqual(finalResult.title, "Research Report");
    });
  });

  describe("unknown tool", () => {
    it("should return error for unknown tool", async () => {
      const result = await executor.execute("unknownTool", {});
      assert.ok(result.error);
      assert.ok(result.error.includes("Unknown tool"));
    });
  });
});
