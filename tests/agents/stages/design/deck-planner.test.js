import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { DeckPlanner, planDeck, applyUserEdits, formatPlanForReview } from "../../../../js/agents/stages/design/runtime/deck-planner.js";

describe("DeckPlanner", () => {
  const sampleSlideIntents = [
    { slideIntentId: "s1", pageType: "cover", title: "Introduction", keyPoints: [] },
    { slideIntentId: "s2", pageType: "content", title: "Main Points", keyPoints: ["a", "b", "c"] },
    { slideIntentId: "s3", pageType: "bullet", title: "Details", keyPoints: ["1", "2", "3", "4", "5", "6"] },
    { slideIntentId: "s4", pageType: "closing", title: "Thank You", keyPoints: [] },
  ];

  describe("planDeck", () => {
    it("should plan all slides", () => {
      const result = planDeck(sampleSlideIntents, { theme: "dark" });
      assert.strictEqual(result.plans.length, 4);
      assert.ok(result.summary.includes("4 slides"));
    });

    it("should assign correct page types", () => {
      const result = planDeck(sampleSlideIntents, {});
      assert.strictEqual(result.plans[0].pageType, "cover");
      assert.strictEqual(result.plans[1].pageType, "content");
      assert.strictEqual(result.plans[2].pageType, "bullet");
      assert.strictEqual(result.plans[3].pageType, "closing");
    });

    it("should detect content density", () => {
      const result = planDeck(sampleSlideIntents, {});
      assert.strictEqual(result.plans[0].contentDensity, "low");
      assert.strictEqual(result.plans[1].contentDensity, "medium");
      assert.strictEqual(result.plans[2].contentDensity, "high");
    });

    it("should handle empty input", () => {
      const result = planDeck([], {});
      assert.strictEqual(result.plans.length, 0);
      assert.ok(result.summary.includes("No slides"));
    });

    it("should include metadata", () => {
      const result = planDeck(sampleSlideIntents, { theme: "corporate" });
      assert.strictEqual(result.metadata.totalSlides, 4);
      assert.strictEqual(result.metadata.theme, "corporate");
      assert.ok(Array.isArray(result.metadata.pageTypes));
    });
  });

  describe("applyUserEdits", () => {
    it("should apply edits by slideIntentId", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIntentId: "s2", layoutHint: "custom-layout" }];

      const updated = applyUserEdits(plans, edits);
      assert.strictEqual(updated[1].layoutHint, "custom-layout");
      assert.strictEqual(updated[1].userOverride, true);
    });

    it("should apply edits by slideIndex", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIndex: 0, visualFocus: "right" }];

      const updated = applyUserEdits(plans, edits);
      assert.strictEqual(updated[0].visualFocus, "right");
    });

    it("should preserve unedited plans", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIntentId: "s1", layoutHint: "new" }];

      const updated = applyUserEdits(plans, edits);
      assert.strictEqual(updated[1].userOverride, undefined);
      assert.strictEqual(updated[2].userOverride, undefined);
    });

    it("should handle null edits", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const updated = applyUserEdits(plans, null);
      assert.deepStrictEqual(updated, plans);
    });
  });

  describe("formatPlanForReview", () => {
    it("should format plans as readable text", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const formatted = formatPlanForReview(plans);

      assert.ok(formatted.includes("=== Deck Plan ==="));
      assert.ok(formatted.includes("cover"));
      assert.ok(formatted.includes("Introduction"));
    });

    it("should handle empty plans", () => {
      const formatted = formatPlanForReview([]);
      assert.ok(formatted.includes("No plans"));
    });
  });

  describe("DeckPlanner class", () => {
    it("should provide plan method", () => {
      const planner = new DeckPlanner();
      const result = planner.plan(sampleSlideIntents, {});
      assert.strictEqual(result.plans.length, 4);
    });

    it("should provide applyEdits method", () => {
      const planner = new DeckPlanner();
      const plans = planner.plan(sampleSlideIntents, {}).plans;
      const updated = planner.applyEdits(plans, [{ slideIntentId: "s1", layoutHint: "test" }]);
      assert.strictEqual(updated[0].layoutHint, "test");
    });

    it("should provide format method", () => {
      const planner = new DeckPlanner();
      const plans = planner.plan(sampleSlideIntents, {}).plans;
      const formatted = planner.format(plans);
      assert.ok(typeof formatted === "string");
    });
  });
});
