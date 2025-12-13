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

test("ImagePlanner: empty slideIntents returns []", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  assert.deepEqual(ImagePlanner.plan([], {}, {}), []);
  assert.deepEqual(ImagePlanner.plan(null, {}, {}), []);
});

test("ImagePlanner: pageType filtering + slot mapping (rich)", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");

  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 10 } });
  const slotIds = slots.map((s) => s.slotId);

  // Ignored/Skipped
  assert.ok(!slotIds.some((id) => id.includes("s1"))); // agenda
  assert.ok(!slots.some((s) => s.slideIntentId === "s_app")); // appendix

  // Included types
  assert.ok(slots.some((s) => s.slideIntentId === "s_cover" && s.purpose === "hero" && s.priority === "critical" && s.aspectRatio === "16:9"));
  assert.ok(slots.some((s) => s.slideIntentId === "s_overview" && s.purpose === "illustration" && s.priority === "important" && s.aspectRatio === "4:3"));
  assert.ok(slots.some((s) => s.slideIntentId === "s_summary" && s.purpose === "illustration" && s.priority === "important" && s.aspectRatio === "4:3"));
  assert.ok(slots.some((s) => s.slideIntentId === "s_comp" && s.purpose === "chart_fallback" && s.priority === "optional" && s.aspectRatio === "16:9"));
  assert.ok(slots.some((s) => s.slideIntentId === "s_proc" && s.purpose === "chart_fallback" && s.priority === "optional" && s.aspectRatio === "16:9"));

  // claimIds should be preserved if present.
  const ov = slots.find((s) => s.slideIntentId === "s_overview");
  assert.deepEqual(ov.claimIds, ["c1"]);

  // Output order should be by slideIndex (stable downstream insertion).
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i - 1].slideIndex < slots[i].slideIndex);
});

test("ImagePlanner: imagePolicy=none returns []", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "none" });
  assert.deepEqual(slots, []);
});

test("ImagePlanner: imagePolicy=minimal keeps only critical", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "minimal", imageBudget: { maxImages: 10, maxCostUSD: 10 } });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].priority, "critical");
  assert.equal(slots[0].purpose, "hero");
});

test("ImagePlanner: imagePolicy=balanced keeps critical + important (no optional)", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "balanced", imageBudget: { maxImages: 10, maxCostUSD: 10 } });
  assert.ok(slots.some((s) => s.priority === "critical"));
  assert.ok(slots.some((s) => s.priority === "important"));
  assert.ok(!slots.some((s) => s.priority === "optional"));
});

test("ImagePlanner: maxImages caps output by priority order", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "rich", imageBudget: { maxImages: 2, maxCostUSD: 10 } });
  assert.equal(slots.length, 2);
  // cover must be present (critical comes first)
  assert.ok(slots.some((s) => s.slideIntentId === "s_cover"));
  // The 2nd should come from important before optional.
  assert.ok(slots.some((s) => s.priority === "important"));
});

test("ImagePlanner: budget trim removes optional then downgrades important style", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");

  const slideIntents = [
    { slideIntentId: "s_cover", pageType: "cover", title: "Cover" }, // critical, ~0.04
    { slideIntentId: "s_overview", pageType: "overview", title: "Overview" }, // important, ~0.04 (will downgrade to ~0.003)
    { slideIntentId: "s_comp", pageType: "comparison", title: "Comparison" }, // optional, ~0.003 (will be removed)
  ];

  const slots = ImagePlanner.plan(slideIntents, {}, { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 0.05 } });

  assert.ok(slots.some((s) => s.priority === "critical" && s.style === "3d"));
  assert.ok(slots.some((s) => s.priority === "important" && s.style === "flat"));
  assert.ok(!slots.some((s) => s.priority === "optional"));
});

test("ImagePlanner: critical always kept even if maxCostUSD is extremely low", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 0.0 } });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].priority, "critical");
});

test("ImagePlanner: defaults work with missing constraints", async () => {
  const { ImagePlanner } = await import("../../js/agents/stages/design/image-planner.js");
  const slots = ImagePlanner.plan(makeSlideIntents(), {}, undefined);
  // default policy is balanced -> critical + some important
  assert.ok(slots.some((s) => s.priority === "critical"));
  assert.ok(slots.some((s) => s.priority === "important"));
  assert.ok(!slots.some((s) => s.priority === "optional"));
});

