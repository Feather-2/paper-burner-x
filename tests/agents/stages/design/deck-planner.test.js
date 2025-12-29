import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  DeckPlanner,
  planDeck,
  applyUserEdits,
  formatPlanForReview,
  formatPlanForDialog,
  parseSimpleFeedback,
} from "../../../../js/agents/stages/design/runtime/deck-planner.js";

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

    it("should provide formatForDialog method", () => {
      const planner = new DeckPlanner();
      const plans = planner.plan(sampleSlideIntents, {}).plans;
      const dialog = planner.formatForDialog(plans);
      assert.ok(dialog.text);
      assert.ok(Array.isArray(dialog.cards));
    });

    it("should provide parseSimpleFeedback method", () => {
      const planner = new DeckPlanner();
      const plans = planner.plan(sampleSlideIntents, {}).plans;
      const edits = planner.parseSimpleFeedback("第2页用时间线", plans);
      assert.ok(Array.isArray(edits));
    });
  });

  describe("visualIntent and sellingPoint", () => {
    it("should include visualIntent in plans", () => {
      const result = planDeck(sampleSlideIntents, {});
      assert.ok(result.plans[0].visualIntent);
      assert.ok(typeof result.plans[0].visualIntent === "string");
    });

    it("should include sellingPoint in plans", () => {
      const result = planDeck(sampleSlideIntents, {});
      assert.ok(result.plans[0].sellingPoint);
      assert.ok(typeof result.plans[0].sellingPoint === "string");
    });

    it("should apply visualIntent edits", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIntentId: "s1", visualIntent: "自定义视觉初衷" }];
      const updated = applyUserEdits(plans, edits);
      assert.strictEqual(updated[0].visualIntent, "自定义视觉初衷");
    });

    it("should apply sellingPoint edits", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIntentId: "s2", sellingPoint: "自定义卖点" }];
      const updated = applyUserEdits(plans, edits);
      assert.strictEqual(updated[1].sellingPoint, "自定义卖点");
    });
  });

  describe("formatPlanForDialog", () => {
    it("should return text and cards", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const dialog = formatPlanForDialog(plans);

      assert.ok(dialog.text.includes("预案"));
      assert.strictEqual(dialog.cards.length, 4);
    });

    it("should include editable fields in cards", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const dialog = formatPlanForDialog(plans);

      assert.ok(dialog.cards[0].editable.includes("layoutHint"));
      assert.ok(dialog.cards[0].editable.includes("visualIntent"));
      assert.ok(dialog.cards[0].editable.includes("sellingPoint"));
    });

    it("should include instructions", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const dialog = formatPlanForDialog(plans);

      assert.ok(Array.isArray(dialog.instructions));
      assert.ok(dialog.instructions.length > 0);
    });

    it("should handle empty plans", () => {
      const dialog = formatPlanForDialog([]);
      assert.ok(dialog.text.includes("暂无"));
      assert.strictEqual(dialog.cards.length, 0);
    });
  });

  describe("parseSimpleFeedback", () => {
    it("should parse slide number and layout keyword", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback("第2页用时间线展示", plans);

      assert.strictEqual(edits.length, 1);
      assert.strictEqual(edits[0].slideIndex, 1);
      assert.strictEqual(edits[0].layoutHint, "timeline");
    });

    it("should parse multiple edits", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback("第1页居中，第3页用对比", plans);

      assert.strictEqual(edits.length, 2);
      assert.strictEqual(edits[0].layoutHint, "hero");
      assert.strictEqual(edits[1].layoutHint, "two-column");
    });

    it("should handle invalid slide numbers", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback("第99页用时间线", plans);

      assert.strictEqual(edits.length, 0);
    });

    it("should handle empty feedback", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback("", plans);

      assert.strictEqual(edits.length, 0);
    });

    it("should handle null feedback", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback(null, plans);

      assert.strictEqual(edits.length, 0);
    });
  });
});
