import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");

function makeSlideIntents() {
  return [
    { slideIntentId: "s_cover", pageType: "cover", title: "Demo Deck", objective: "Make a strong first impression." },
    { slideIntentId: "s_agenda", pageType: "agenda", title: "Agenda" }, // should be ignored
    { slideIntentId: "s_overview", pageType: "overview", title: "Overview", keyPoints: ["Context", "Goals"], claimIds: ["c1"] },
    { slideIntentId: "s_summary", pageType: "summary", title: "Summary", keyPoints: ["Takeaway 1", "Takeaway 2"] },
    { slideIntentId: "s_comp", pageType: "comparison", title: "Comparison", keyPoints: ["A vs B"] },
    { slideIntentId: "s_proc", pageType: "process", title: "Process", keyPoints: ["Ingest", "Plan", "Generate"] },
    { slideIntentId: "s_app", pageType: "appendix", title: "Appendix" }, // should be skipped
  ];
}

it("ImagePlanner: empty slideIntents returns []", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  expect(ImagePlanner.plan([], {}, {})).toEqual([]);
  expect(ImagePlanner.plan(null, {}, {})).toEqual([]);
});

it("ImagePlanner: pageType filtering + slot mapping (rich)", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");

  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 10 } });
  const slotIds = slots.map((s) => s.slotId);

  // Ignored/Skipped
  expect(slotIds.some((id) => id.includes("s1"))).toBe(false); // agenda
  expect(slots.some((s) => s.slideIntentId === "s_app")).toBe(false); // appendix

  // Included types
  expect(slots.some((s) => s.slideIntentId === "s_cover" && s.purpose === "hero" && s.priority === "critical" && s.aspectRatio === "16:9")).toBe(true);
  expect(slots.some((s) => s.slideIntentId === "s_overview" && s.purpose === "illustration" && s.priority === "important" && s.aspectRatio === "4:3")).toBe(true);
  expect(slots.some((s) => s.slideIntentId === "s_summary" && s.purpose === "illustration" && s.priority === "important" && s.aspectRatio === "4:3")).toBe(true);
  expect(slots.some((s) => s.slideIntentId === "s_comp" && s.purpose === "chart_fallback" && s.priority === "optional" && s.aspectRatio === "16:9")).toBe(true);
  expect(slots.some((s) => s.slideIntentId === "s_proc" && s.purpose === "chart_fallback" && s.priority === "optional" && s.aspectRatio === "16:9")).toBe(true);

  // claimIds should be preserved if present.
  const ov = slots.find((s) => s.slideIntentId === "s_overview");
  expect(ov.claimIds).toEqual(["c1"]);

  // Output order should be by slideIndex (stable downstream insertion).
  for (let i = 1; i < slots.length; i++) expect(slots[i - 1].slideIndex).toBeLessThan(slots[i].slideIndex);
});

it("ImagePlanner: imagePolicy=none returns []", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "none" });
  expect(slots).toEqual([]);
});

it("ImagePlanner: imagePolicy=minimal keeps only critical", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "minimal", imageBudget: { maxImages: 10, maxCostUSD: 10 } });
  expect(slots.length).toBe(1);
  expect(slots[0].priority).toBe("critical");
  expect(slots[0].purpose).toBe("hero");
});

it("ImagePlanner: imagePolicy=balanced keeps critical + important (no optional)", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "balanced", imageBudget: { maxImages: 10, maxCostUSD: 10 } });
  expect(slots.some((s) => s.priority === "critical")).toBe(true);
  expect(slots.some((s) => s.priority === "important")).toBe(true);
  expect(slots.some((s) => s.priority === "optional")).toBe(false);
});

it("ImagePlanner: maxImages caps output by priority order", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "rich", imageBudget: { maxImages: 2, maxCostUSD: 10 } });
  expect(slots.length).toBe(2);
  // cover must be present (critical comes first)
  expect(slots.some((s) => s.slideIntentId === "s_cover")).toBe(true);
  // The 2nd should come from important before optional.
  expect(slots.some((s) => s.priority === "important")).toBe(true);
});

it("ImagePlanner: budget trim removes optional then downgrades important style", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");

  const slideIntents = [
    { slideIntentId: "s_cover", pageType: "cover", title: "Cover" }, // critical, ~0.04
    { slideIntentId: "s_overview", pageType: "overview", title: "Overview" }, // important, ~0.04 (will downgrade to ~0.003)
    { slideIntentId: "s_comp", pageType: "comparison", title: "Comparison" }, // optional, ~0.003 (will be removed)
  ];

  const slots = ImagePlanner.plan(slideIntents, {}, { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 0.05 } });

  expect(slots.some((s) => s.priority === "critical" && s.style === "3d")).toBe(true);
  expect(slots.some((s) => s.priority === "important" && s.style === "flat")).toBe(true);
  expect(slots.some((s) => s.priority === "optional")).toBe(false);
});

it("ImagePlanner: critical always kept even if maxCostUSD is extremely low", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 0.0 } });
  expect(slots.length).toBe(1);
  expect(slots[0].priority).toBe("critical");
});

it("ImagePlanner: defaults work with missing constraints", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, undefined);
  // default policy is balanced -> critical + some important
  expect(slots.some((s) => s.priority === "critical")).toBe(true);
  expect(slots.some((s) => s.priority === "important")).toBe(true);
  expect(slots.some((s) => s.priority === "optional")).toBe(false);
});
