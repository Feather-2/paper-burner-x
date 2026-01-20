import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVisualHeuristics = vi.hoisted(() => ({
  ASPECT_RATIO_SQUARE_MIN: 0.9,
  ASPECT_RATIO_SQUARE_MAX: 1.1,
  COST_HD_IMAGE: 0.04,
  COST_STANDARD_IMAGE: 0.01,
  OPACITY_IMAGE: 0.95,
  OPACITY_SHAPE: 0.9,
  DEFAULT_MAX_IMAGES: 3,
  DEFAULT_MAX_COST_USD: 0.06,
  LARGE_IMAGE_AREA_THRESHOLD: 4000,
  MIN_READABLE_FONT_SIZE: 12,
}));

vi.mock("../../../../../../js/agents/stages/design/constants.js", () => ({
  VisualHeuristics: mockVisualHeuristics,
}));

import { ImagePlanner } from "../../../../../../js/agents/stages/design/image/image-planner.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ImagePlanner", () => {
  describe("plan", () => {
    it("returns [] for empty or invalid slideIntents", () => {
      expect(ImagePlanner.plan()).toEqual([]);
      expect(ImagePlanner.plan(undefined)).toEqual([]);
      expect(ImagePlanner.plan(null)).toEqual([]);
      expect(ImagePlanner.plan([])).toEqual([]);
      expect(ImagePlanner.plan({})).toEqual([]);
    });

    it("returns [] when imagePolicy is none", () => {
      const intents = [{ slideIntentId: "s0", pageType: "cover", title: "Cover" }];
      const slots = ImagePlanner.plan(intents, {}, { imagePolicy: "none" });
      expect(slots).toEqual([]);
    });

    it("defaults to balanced for invalid policy and uses default promptHint for blank content", () => {
      const intents = [
        { slideIntentId: "s0", pageType: "cover", title: "   ", objective: "", keyPoints: [] },
        { slideIntentId: "s1", pageType: "comparison", title: "Comparison" },
        { slideIntentId: "s2", pageType: "overview", title: "Overview" },
      ];
      const slots = ImagePlanner.plan(intents, {}, { imagePolicy: "   ", imageBudget: { maxImages: 10, maxCostUSD: 1 } });

      expect(slots.some((s) => s.priority === "optional")).toBe(false);
      const cover = slots.find((s) => s.slideIntentId === "s0");
      expect(cover.promptHint).toBe("A slide illustration that matches the slide content.");
    });

    it("uses slideIntentID fallback and normalizes claimIds and keyPoints", () => {
      const intents = [
        {
          slideIntentID: "legacy-1",
          pageType: "overview",
          title: "Title",
          objective: "Objective",
          keyPoints: ["P1", "P2", "P3"],
          claimIds: ["c1", "", 0],
        },
      ];
      const slots = ImagePlanner.plan(intents, {}, { imagePolicy: "rich", imageBudget: { maxImages: 5, maxCostUSD: 1 } });

      expect(slots[0].slideIntentId).toBe("legacy-1");
      expect(slots[0].claimIds).toEqual(["c1", "0"]);
      expect(slots[0].promptHint).toBe("Title — Objective — P1; P2");
    });

    it("respects maxImages=0 and accepts numeric strings for budgets", () => {
      const intents = [
        { slideIntentId: "s0", pageType: "cover", title: "Cover" },
        { slideIntentId: "s1", pageType: "overview", title: "Overview" },
        { slideIntentId: "s2", pageType: "comparison", title: "Comparison" },
      ];

      const none = ImagePlanner.plan(intents, {}, { imagePolicy: "rich", imageBudget: { maxImages: 0, maxCostUSD: 1 } });
      expect(none).toEqual([]);

      const slots = ImagePlanner.plan(intents, {}, { imagePolicy: "rich", imageBudget: { maxImages: "2", maxCostUSD: "1" } });
      expect(slots.length).toBe(2);
    });

    it("caps by priority order when maxImages is limited", () => {
      const intents = [
        { slideIntentId: "s0", pageType: "comparison", title: "Optional" },
        { slideIntentId: "s1", pageType: "cover", title: "Critical" },
      ];
      const slots = ImagePlanner.plan(intents, {}, { imagePolicy: "rich", imageBudget: { maxImages: 1, maxCostUSD: 1 } });

      expect(slots).toHaveLength(1);
      expect(slots[0].slideIntentId).toBe("s1");
    });

    it("trims optional slots and downgrades important style to fit budget", () => {
      const intents = [
        { slideIntentId: "s0", pageType: "cover", title: "Cover" },
        { slideIntentId: "s1", pageType: "overview", title: "Overview" },
        { slideIntentId: "s2", pageType: "comparison", title: "Comparison" },
      ];

      const slots = ImagePlanner.plan(intents, {}, { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 0.05 } });

      expect(slots.some((s) => s.priority === "optional")).toBe(false);
      const important = slots.find((s) => s.priority === "important");
      const critical = slots.find((s) => s.priority === "critical");
      expect(important.style).toBe("flat");
      expect(critical.style).toBe("3d");
    });

    it("keeps critical and the latest important when budget is tight", () => {
      const intents = [
        { slideIntentId: "s0", pageType: "cover", title: "Cover" },
        { slideIntentId: "s1", pageType: "overview", title: "Overview" },
        { slideIntentId: "s2", pageType: "summary", title: "Summary" },
      ];

      const slots = ImagePlanner.plan(intents, {}, { imagePolicy: "balanced", imageBudget: { maxImages: 10, maxCostUSD: 0.05 } });
      const ids = slots.map((s) => s.slideIntentId);

      expect(ids).toEqual(["s0", "s2"]);
      const important = slots.find((s) => s.slideIntentId === "s2");
      expect(important.style).toBe("flat");
    });

    it("falls back to default budget for negative values and respects MAX_SAFE_INTEGER", () => {
      const intents = Array.from({ length: 5 }, (_, i) => ({
        slideIntentId: `s${i}`,
        pageType: "comparison",
        title: `Comparison ${i}`,
      }));

      const fallback = ImagePlanner.plan(intents, {}, { imagePolicy: "rich", imageBudget: { maxImages: -1, maxCostUSD: -1 } });
      expect(fallback.length).toBe(mockVisualHeuristics.DEFAULT_MAX_IMAGES);

      const uncapped = ImagePlanner.plan(intents, {}, {
        imagePolicy: "rich",
        imageBudget: { maxImages: Number.MAX_SAFE_INTEGER, maxCostUSD: 1 },
      });
      expect(uncapped.length).toBe(intents.length);
    });

    it("handles large inputs, long strings, and deep nesting", () => {
      const longText = "x".repeat(10000);
      const deep = { a: { b: { c: { d: "deep" } } } };
      const intents = Array.from({ length: 1000 }, (_, i) => ({
        slideIntentId: `s${i}`,
        pageType: i % 2 === 0 ? "cover" : "overview",
        title: longText,
        objective: longText,
        keyPoints: [deep, longText, "extra"],
      }));

      const slots = ImagePlanner.plan(intents, {}, { imagePolicy: "rich", imageBudget: { maxImages: 5, maxCostUSD: 1 } });

      expect(slots.length).toBe(5);
      expect(slots[0].promptHint.startsWith(longText)).toBe(true);
    });

    it("supports concurrent plan calls with different constraints", async () => {
      const intents = [
        { slideIntentId: "s0", pageType: "cover", title: "Cover" },
        { slideIntentId: "s1", pageType: "overview", title: "Overview" },
        { slideIntentId: "s2", pageType: "comparison", title: "Comparison" },
      ];

      const [rich, minimal] = await Promise.all([
        Promise.resolve(ImagePlanner.plan(intents, {}, { imagePolicy: "rich", imageBudget: { maxImages: 5, maxCostUSD: 1 } })),
        Promise.resolve(ImagePlanner.plan(intents, {}, { imagePolicy: "minimal", imageBudget: { maxImages: 5, maxCostUSD: 1 } })),
      ]);

      expect(rich.length).toBeGreaterThan(minimal.length);
      expect(minimal.every((s) => s.priority === "critical")).toBe(true);
    });
  });

  describe("suggestElementPatch", () => {
    it("returns missing_element for empty or invalid inputs", () => {
      const expected = { patch: {}, meta: { reason: "missing_element" } };
      expect(ImagePlanner.suggestElementPatch()).toEqual(expected);
      expect(ImagePlanner.suggestElementPatch(undefined)).toEqual(expected);
      expect(ImagePlanner.suggestElementPatch(null)).toEqual(expected);
      expect(ImagePlanner.suggestElementPatch({})).toEqual(expected);
      expect(ImagePlanner.suggestElementPatch({ element: "nope" })).toEqual(expected);
    });

    it("suggests defaults for large square images", () => {
      const result = ImagePlanner.suggestElementPatch({ element: { type: "image", w: "100", h: 100 } });

      expect(result.meta.reason).toBe("heuristic_v1");
      expect(result.patch).toEqual({
        opacity: mockVisualHeuristics.OPACITY_IMAGE,
        blend: "normal",
        mask: "circle",
        effect: "shadow-sm",
      });
    });

    it("uses multiply blend and rounded mask for small non-square images", () => {
      const result = ImagePlanner.suggestElementPatch({ element: { type: "image", w: "50%", h: "25%" } });

      expect(result.patch.opacity).toBe(mockVisualHeuristics.OPACITY_IMAGE);
      expect(result.patch.blend).toBe("multiply");
      expect(result.patch.mask).toBe("rounded:12");
      expect(result.patch.effect).toBe("shadow-sm");
    });

    it("does not override explicit image properties", () => {
      const result = ImagePlanner.suggestElementPatch({
        element: {
          type: "image",
          w: 50,
          h: 50,
          opacity: 0.2,
          blend: "screen",
          mask: "rounded:8",
          effect: "shadow-lg",
        },
      });

      expect(result.patch).toEqual({});
    });

    it("ensures readable defaults for text elements", () => {
      const result = ImagePlanner.suggestElementPatch({ element: { type: "text", color: "   ", fontSize: "11" } });

      expect(result.patch.opacity).toBe(1);
      expect(result.patch.blend).toBe("normal");
      expect(result.patch.color).toBe("#0f172a");
      expect(result.patch.fontSize).toBe(14);
    });

    it("ignores non-positive and huge font sizes", () => {
      const negative = ImagePlanner.suggestElementPatch({ element: { type: "text", fontSize: -1 } });
      expect(negative.patch.fontSize).toBeUndefined();

      const huge = ImagePlanner.suggestElementPatch({
        element: { type: "text", font: Number.MAX_SAFE_INTEGER, color: "#fff", opacity: 0.5, blend: "multiply" },
      });
      expect(huge.patch.fontSize).toBeUndefined();
    });

    it("uses shape opacity defaults", () => {
      const result = ImagePlanner.suggestElementPatch({ element: { type: "shape" } });

      expect(result.patch.opacity).toBe(mockVisualHeuristics.OPACITY_SHAPE);
      expect(result.patch.blend).toBe("normal");
    });

    it("handles invalid dimensions and zero height gracefully", () => {
      const result = ImagePlanner.suggestElementPatch({ element: { type: "image", w: { a: 1 }, h: 0 } });

      expect(result.patch.opacity).toBe(mockVisualHeuristics.OPACITY_IMAGE);
      expect(result.patch.blend).toBe("multiply");
      expect(result.patch.mask).toBe("rounded:12");
      expect(result.patch.effect).toBe("shadow-sm");
    });

    it("supports rapid consecutive calls without shared state", () => {
      const element = { type: "image", w: 30, h: 30 };
      const patches = Array.from({ length: 5 }, () => ImagePlanner.suggestElementPatch({ element }).patch);

      patches.forEach((patch) => {
        expect(patch.opacity).toBe(mockVisualHeuristics.OPACITY_IMAGE);
        expect(patch.effect).toBe("shadow-sm");
      });
    });
  });
});
