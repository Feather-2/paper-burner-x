import { describe, it } from "node:test";
import assert from "node:assert";
import {
  runAutoReview,
  buildReviewContext,
  REVIEW_CONFIG,
  IssueType,
  IssueSeverity,
  AutoReviewer,
  createAutoReviewer,
} from "../../../../js/agents/stages/design/reviewer/auto-reviewer.js";

describe("AutoReviewer", () => {
  const sampleDeckHtmlDsl = `
<section data-layout="title">
  <h1 style="color: #333333; font-family: Arial;">Title</h1>
</section>

<section data-layout="content">
  <p style="color: #333333; font-family: Arial;">Content</p>
</section>
  `.trim();

  const sampleDesignSystem = {
    theme: "modern",
    designTokens: {
      colors: { primary: "#333333" },
      fontFamily: "Arial",
    },
  };

  describe("buildReviewContext", () => {
    it("should build context from deck package", () => {
      const context = buildReviewContext({ deckHtmlDsl: sampleDeckHtmlDsl }, sampleDesignSystem);
      assert.strictEqual(context.slideCount, 2);
      assert.ok(Array.isArray(context.allDsl));
    });

    it("should handle empty deck", () => {
      const context = buildReviewContext({ deckHtmlDsl: "" }, {});
      assert.strictEqual(context.slideCount, 0);
    });
  });

  describe("runAutoReview", () => {
    it("should return review result", async () => {
      const result = await runAutoReview({ deckHtmlDsl: sampleDeckHtmlDsl }, sampleDesignSystem);
      assert.strictEqual(result.success, true);
      assert.ok(Array.isArray(result.issues));
      assert.ok(typeof result.score === "number");
    });

    it("should return pass status", async () => {
      const result = await runAutoReview({ deckHtmlDsl: sampleDeckHtmlDsl }, sampleDesignSystem);
      assert.ok(typeof result.pass === "boolean");
    });

    it("should return summary", async () => {
      const result = await runAutoReview({ deckHtmlDsl: sampleDeckHtmlDsl }, sampleDesignSystem);
      assert.ok(result.summary);
      assert.ok(result.summary.status);
    });

    it("should handle empty deck", async () => {
      const result = await runAutoReview({ deckHtmlDsl: "" }, {});
      assert.strictEqual(result.success, false);
    });
  });

  describe("REVIEW_CONFIG", () => {
    it("should have default values", () => {
      assert.ok(REVIEW_CONFIG.maxColorVariants > 0);
      assert.ok(REVIEW_CONFIG.maxFontVariants > 0);
      assert.ok(REVIEW_CONFIG.minConsistencyScore >= 0);
    });
  });

  describe("IssueType", () => {
    it("should have issue types", () => {
      assert.ok(IssueType.COLOR_INCONSISTENCY);
      assert.ok(IssueType.FONT_INCONSISTENCY);
    });
  });

  describe("IssueSeverity", () => {
    it("should have severity levels", () => {
      assert.ok(IssueSeverity.ERROR);
      assert.ok(IssueSeverity.WARNING);
      assert.ok(IssueSeverity.INFO);
    });
  });

  describe("AutoReviewer class", () => {
    it("should create instance", () => {
      const reviewer = createAutoReviewer();
      assert.ok(reviewer instanceof AutoReviewer);
    });

    it("should review deck", async () => {
      const reviewer = createAutoReviewer();
      const result = await reviewer.review({ deckHtmlDsl: sampleDeckHtmlDsl }, sampleDesignSystem);
      assert.strictEqual(result.success, true);
    });

    it("should get config", () => {
      const reviewer = createAutoReviewer();
      const config = reviewer.getConfig();
      assert.ok(config.maxColorVariants);
    });
  });
});
