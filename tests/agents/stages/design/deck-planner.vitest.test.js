import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/utils/value-utils.js", () => {
  return {
    toNonEmptyString: vi.fn((v) => (typeof v === "string" && v.trim() ? v.trim() : "")),
  };
});

import { toNonEmptyString } from "../../../../js/agents/shared/utils/value-utils.js";
import {
  DeckPlanner,
  planDeck,
  applyUserEdits,
  formatPlanForReview,
  formatPlanForDialog,
  parseSimpleFeedback,
  parseFeedbackWithLLM,
} from "../../../../js/agents/stages/design/runtime/deck-planner.js";

describe("design/runtime/deck-planner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("planDeck returns empty plans for empty input (edge)", () => {
    const out = planDeck([], { theme: "dark" });
    expect(out).toEqual({ plans: [], summary: "No slides to plan" });
  });

  it("planDeck assigns defaults and adjusts first/last slide behavior + density heuristics", () => {
    const intents = [
      { slideIntentId: "s1", pageType: "content", title: "Intro", keyPoints: ["a"] }, // first but not cover => hero/center
      { slideIntentId: "s2", pageType: "bullet", title: "Many", keyPoints: ["1", "2", "3", "4", "5", "6"] }, // dense-list
      { slideIntentId: "s3", pageType: "content", title: "End", keyPoints: [] }, // last but not closing => keyMessage cta
    ];

    const out = planDeck(intents, { theme: "corporate" });
    expect(out.plans).toHaveLength(3);
    expect(out.metadata.theme).toBe("corporate");
    expect(out.summary).toContain("3 slides planned");

    // First-slide emphasis (center) is applied, but the "content amount" heuristic
    // can override the layout hint to "spacious" for <=2 keyPoints.
    expect(out.plans[0].layoutHint).toBe("spacious");
    expect(out.plans[0].visualFocus).toBe("center");

    expect(out.plans[1].layoutHint).toBe("dense-list");
    expect(out.plans[1].contentDensity).toBe("high");

    expect(out.plans[2].keyMessage).toBe("cta");
    expect(out.plans[2].suggestedEmphasis).toBe("action");

    // title should be incorporated into sellingPoint with truncation.
    expect(out.plans[0].sellingPoint).toContain("Intro");
    expect(toNonEmptyString).toHaveBeenCalled();
  });

  it("applyUserEdits applies edits by slideIntentId and slideIndex, preserving untouched plans", () => {
    const plans = planDeck([{ slideIntentId: "s1", pageType: "content", title: "T", keyPoints: [] }], {}).plans;

    const updatedById = applyUserEdits(plans, [{ slideIntentId: "s1", layoutHint: "waterfall" }]);
    expect(updatedById[0].layoutHint).toBe("waterfall");
    expect(updatedById[0].userOverride).toBe(true);

    const updatedByIndex = applyUserEdits(plans, [{ slideIndex: 0, visualFocus: "right" }]);
    expect(updatedByIndex[0].visualFocus).toBe("right");

    const unchanged = applyUserEdits(plans, null);
    expect(unchanged).toBe(plans);
  });

  it("formatPlanForReview returns readable table and handles empty input", () => {
    expect(formatPlanForReview([])).toBe("No plans to review.");

    const plans = planDeck(
      [
        { slideIntentId: "s1", pageType: "cover", title: "Intro", keyPoints: [] },
        { slideIntentId: "s2", pageType: "content", title: "Main", keyPoints: ["a", "b", "c"] },
      ],
      {}
    ).plans;
    const text = formatPlanForReview(plans);
    expect(text).toContain("=== Deck Plan ===");
    expect(text).toContain("[cover");
    expect(text).toContain("Intro");
    expect(text).toContain("Layout");
  });

  it("formatPlanForDialog returns cards + instructional text and handles empty input", () => {
    expect(formatPlanForDialog([])).toEqual({ text: "暂无规划内容。", cards: [] });

    const plans = planDeck([{ slideIntentId: "s1", pageType: "cover", title: "Intro", keyPoints: [] }], {}).plans;
    const dialog = formatPlanForDialog(plans);
    expect(dialog.cards).toHaveLength(1);
    expect(dialog.cards[0].editable).toEqual(["layoutHint", "visualIntent", "sellingPoint"]);
    expect(dialog.text).toContain("请告诉我您想修改哪些内容");
    expect(dialog.instructions).toBeTruthy();
  });

  it("parseSimpleFeedback extracts slideIndex + layoutHint from Chinese keywords and ignores invalid lines", () => {
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

  it("parseFeedbackWithLLM parses JSON output and falls back to parseSimpleFeedback on errors", async () => {
    const plans = planDeck([{ slideIntentId: "s1", pageType: "content", title: "A", keyPoints: [] }], {}).plans;

    const llmCall = vi.fn(async () => "```json\n[{\"slideIndex\":0,\"layoutHint\":\"hero\"}]\n```");
    const parsed = await parseFeedbackWithLLM("第1页居中", plans, llmCall);
    expect(parsed).toEqual([{ slideIndex: 0, layoutHint: "hero" }]);

    const bad = await parseFeedbackWithLLM("第1页时间线", plans, vi.fn(async () => "not json"));
    expect(bad).toEqual([{ slideIndex: 0, layoutHint: "timeline" }]);

    const noCall = await parseFeedbackWithLLM("第1页时间线", plans, null);
    expect(noCall).toEqual([{ slideIndex: 0, layoutHint: "timeline" }]);
  });

  it("DeckPlanner uses llmCall when provided (parseFeedback) and delegates helpers", async () => {
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
