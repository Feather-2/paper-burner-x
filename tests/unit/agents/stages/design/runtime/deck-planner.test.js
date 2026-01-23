import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/shared/index.js", () => {
  return {
    toNonEmptyString: vi.fn((v) => (typeof v === "string" && v.trim() ? v.trim() : "")),
  };
});

import { toNonEmptyString } from '../../../../../../js/agents/shared/index.js';
import {
  DeckPlanner,
  planDeck,
  applyUserEdits,
  formatPlanForReview,
  formatPlanForDialog,
  parseSimpleFeedback,
  parseFeedbackWithLLM,
} from '../../../../../../js/agents/stages/design/internal/deck-planner.js';

describe("design/runtime/deck-planner", () => {
  const sampleSlideIntents = [
    { slideIntentId: "s1", pageType: "cover", title: "Introduction", keyPoints: [] },
    { slideIntentId: "s2", pageType: "content", title: "Main Points", keyPoints: ["a", "b", "c"] },
    { slideIntentId: "s3", pageType: "bullet", title: "Details", keyPoints: ["1", "2", "3", "4", "5", "6"] },
    { slideIntentId: "s4", pageType: "closing", title: "Thank You", keyPoints: [] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("planDeck", () => {
    it("returns empty plans for empty input", () => {
      const out = planDeck([], { theme: "dark" });
      expect(out).toEqual({ plans: [], summary: "No slides to plan" });
    });

    it("plans all slides", () => {
      const result = planDeck(sampleSlideIntents, { theme: "dark" });
      expect(result.plans).toHaveLength(4);
      expect(result.summary).toContain("4 slides");
    });

    it("assigns correct page types", () => {
      const result = planDeck(sampleSlideIntents, {});
      expect(result.plans[0].pageType).toBe("cover");
      expect(result.plans[1].pageType).toBe("content");
      expect(result.plans[2].pageType).toBe("bullet");
      expect(result.plans[3].pageType).toBe("closing");
    });

    it("detects content density", () => {
      const result = planDeck(sampleSlideIntents, {});
      expect(result.plans[0].contentDensity).toBe("low");
      expect(result.plans[1].contentDensity).toBe("medium");
      expect(result.plans[2].contentDensity).toBe("high");
    });

    it("includes metadata", () => {
      const result = planDeck(sampleSlideIntents, { theme: "corporate" });
      expect(result.metadata.totalSlides).toBe(4);
      expect(result.metadata.theme).toBe("corporate");
      expect(Array.isArray(result.metadata.pageTypes)).toBe(true);
    });

    it("assigns defaults and adjusts first/last slide behavior + density heuristics", () => {
      const intents = [
        { slideIntentId: "s1", pageType: "content", title: "Intro", keyPoints: ["a"] },
        { slideIntentId: "s2", pageType: "bullet", title: "Many", keyPoints: ["1", "2", "3", "4", "5", "6"] },
        { slideIntentId: "s3", pageType: "content", title: "End", keyPoints: [] },
      ];

      const out = planDeck(intents, { theme: "corporate" });
      expect(out.plans).toHaveLength(3);
      expect(out.metadata.theme).toBe("corporate");
      expect(out.summary).toContain("3 slides planned");

      expect(out.plans[0].layoutHint).toBe("spacious");
      expect(out.plans[0].visualFocus).toBe("center");
      expect(out.plans[1].layoutHint).toBe("dense-list");
      expect(out.plans[1].contentDensity).toBe("high");
      expect(out.plans[2].keyMessage).toBe("cta");
      expect(out.plans[2].suggestedEmphasis).toBe("action");

      expect(out.plans[0].sellingPoint).toContain("Intro");
      expect(toNonEmptyString).toHaveBeenCalled();
    });
  });

  describe("applyUserEdits", () => {
    it("applies edits by slideIntentId", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIntentId: "s2", layoutHint: "custom-layout" }];

      const updated = applyUserEdits(plans, edits);
      expect(updated[1].layoutHint).toBe("custom-layout");
      expect(updated[1].userOverride).toBe(true);
    });

    it("applies edits by slideIndex", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIndex: 0, visualFocus: "right" }];

      const updated = applyUserEdits(plans, edits);
      expect(updated[0].visualFocus).toBe("right");
    });

    it("preserves unedited plans", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIntentId: "s1", layoutHint: "new" }];

      const updated = applyUserEdits(plans, edits);
      expect(updated[1].userOverride).toBeUndefined();
      expect(updated[2].userOverride).toBeUndefined();
    });

    it("handles null edits", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const updated = applyUserEdits(plans, null);
      expect(updated).toBe(plans);
    });
  });

  describe("formatPlanForReview", () => {
    it("formats plans as readable text", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const formatted = formatPlanForReview(plans);

      expect(formatted).toContain("=== Deck Plan ===");
      expect(formatted).toContain("cover");
      expect(formatted).toContain("Introduction");
    });

    it("handles empty plans", () => {
      const formatted = formatPlanForReview([]);
      expect(formatted).toContain("No plans");
    });
  });

  describe("formatPlanForDialog", () => {
    it("returns text and cards", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const dialog = formatPlanForDialog(plans);

      expect(dialog.text).toContain("预案");
      expect(dialog.cards).toHaveLength(4);
    });

    it("includes editable fields in cards", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const dialog = formatPlanForDialog(plans);

      expect(dialog.cards[0].editable).toContain("layoutHint");
      expect(dialog.cards[0].editable).toContain("visualIntent");
      expect(dialog.cards[0].editable).toContain("sellingPoint");
    });

    it("includes instructions", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const dialog = formatPlanForDialog(plans);

      expect(Array.isArray(dialog.instructions)).toBe(true);
      expect(dialog.instructions.length).toBeGreaterThan(0);
    });

    it("handles empty plans", () => {
      const dialog = formatPlanForDialog([]);
      expect(dialog.text).toContain("暂无");
      expect(dialog.cards).toHaveLength(0);
    });
  });

  describe("parseSimpleFeedback", () => {
    it("parses slide number and layout keyword", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback("第2页用时间线展示", plans);

      expect(edits).toHaveLength(1);
      expect(edits[0].slideIndex).toBe(1);
      expect(edits[0].layoutHint).toBe("timeline");
    });

    it("parses multiple edits", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback("第1页居中，第3页用对比", plans);

      expect(edits).toHaveLength(2);
      expect(edits[0].layoutHint).toBe("hero");
      expect(edits[1].layoutHint).toBe("two-column");
    });

    it("handles invalid slide numbers", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback("第99页用时间线", plans);

      expect(edits).toHaveLength(0);
    });

    it("handles empty feedback", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback("", plans);

      expect(edits).toHaveLength(0);
    });

    it("handles null feedback", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = parseSimpleFeedback(null, plans);

      expect(edits).toHaveLength(0);
    });

    it("extracts slideIndex + layoutHint and ignores invalid lines", () => {
      const plans = planDeck(
        [
          { slideIntentId: "s1", pageType: "content", title: "A", keyPoints: [] },
          { slideIntentId: "s2", pageType: "content", title: "B", keyPoints: [] },
        ],
        {}
      ).plans;

      const edits = parseSimpleFeedback("第2页用时间线；第99页用对比；这行无效", plans);
      expect(edits).toEqual([{ slideIndex: 1, layoutHint: "timeline" }]);
    });
  });

  describe("visualIntent and sellingPoint", () => {
    it("includes visualIntent in plans", () => {
      const result = planDeck(sampleSlideIntents, {});
      expect(result.plans[0].visualIntent).toBeDefined();
      expect(typeof result.plans[0].visualIntent).toBe("string");
    });

    it("includes sellingPoint in plans", () => {
      const result = planDeck(sampleSlideIntents, {});
      expect(result.plans[0].sellingPoint).toBeDefined();
      expect(typeof result.plans[0].sellingPoint).toBe("string");
    });

    it("applies visualIntent edits", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIntentId: "s1", visualIntent: "自定义视觉初衷" }];
      const updated = applyUserEdits(plans, edits);
      expect(updated[0].visualIntent).toBe("自定义视觉初衷");
    });

    it("applies sellingPoint edits", () => {
      const plans = planDeck(sampleSlideIntents, {}).plans;
      const edits = [{ slideIntentId: "s2", sellingPoint: "自定义卖点" }];
      const updated = applyUserEdits(plans, edits);
      expect(updated[1].sellingPoint).toBe("自定义卖点");
    });
  });

  describe("DeckPlanner class", () => {
    it("provides plan method", () => {
      const planner = new DeckPlanner();
      const result = planner.plan(sampleSlideIntents, {});
      expect(result.plans).toHaveLength(4);
    });

    it("provides applyEdits method", () => {
      const planner = new DeckPlanner();
      const plans = planner.plan(sampleSlideIntents, {}).plans;
      const updated = planner.applyEdits(plans, [{ slideIntentId: "s1", layoutHint: "test" }]);
      expect(updated[0].layoutHint).toBe("test");
    });

    it("provides format method", () => {
      const planner = new DeckPlanner();
      const plans = planner.plan(sampleSlideIntents, {}).plans;
      const formatted = planner.format(plans);
      expect(typeof formatted).toBe("string");
    });

    it("provides formatForDialog method", () => {
      const planner = new DeckPlanner();
      const plans = planner.plan(sampleSlideIntents, {}).plans;
      const dialog = planner.formatForDialog(plans);
      expect(dialog.text).toBeDefined();
      expect(Array.isArray(dialog.cards)).toBe(true);
    });

    it("provides parseSimpleFeedback method", () => {
      const planner = new DeckPlanner();
      const plans = planner.plan(sampleSlideIntents, {}).plans;
      const edits = planner.parseSimpleFeedback("第2页用时间线", plans);
      expect(Array.isArray(edits)).toBe(true);
    });

    it("uses llmCall when provided (parseFeedback) and delegates helpers", async () => {
      const llmCall = vi.fn(async () => "[]");
      const planner = new DeckPlanner({ llmCall });
      const plans = planner.plan([{ slideIntentId: "s1", pageType: "content", title: "A", keyPoints: [] }], {}).plans;

      expect(planner.format(plans)).toContain("=== Deck Plan ===");
      expect(planner.formatForDialog(plans).cards).toHaveLength(1);
      expect(planner.parseSimpleFeedback("第1页时间线", plans)).toEqual([{ slideIndex: 0, layoutHint: "timeline" }]);

      const edits = await planner.parseFeedback("anything", plans);
      expect(edits).toEqual([]);
      expect(llmCall).toHaveBeenCalledTimes(1);
    });
  });

  describe("parseFeedbackWithLLM", () => {
    it("parses JSON output and falls back to parseSimpleFeedback on errors", async () => {
      const plans = planDeck([{ slideIntentId: "s1", pageType: "content", title: "A", keyPoints: [] }], {}).plans;

      const llmCall = vi.fn(async () => '```json\n[{"slideIndex":0,"layoutHint":"hero"}]\n```');
      const parsed = await parseFeedbackWithLLM("第1页居中", plans, llmCall);
      expect(parsed).toEqual([{ slideIndex: 0, layoutHint: "hero" }]);

      const bad = await parseFeedbackWithLLM("第1页时间线", plans, vi.fn(async () => "not json"));
      expect(bad).toEqual([{ slideIndex: 0, layoutHint: "timeline" }]);

      const noCall = await parseFeedbackWithLLM("第1页时间线", plans, null);
      expect(noCall).toEqual([{ slideIndex: 0, layoutHint: "timeline" }]);
    });
  });
});
