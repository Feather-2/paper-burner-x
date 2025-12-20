const test = require("node:test");
const assert = require("node:assert/strict");

const baseDesignSystem = { designTokens: { colors: { primary: "#111111", text: "#000000", textMuted: "#666666" } } };

function makeImageGenerator() {
  return {
    async generate(slots) {
      return {
        filledSlots: slots.map((s) => ({
          ...s,
          candidates: [{ candidateId: `${s.slotId}_c1`, url: "data:image/png;base64,QUJD" }],
          selectedId: `${s.slotId}_c1`,
        })),
        report: { summary: { planned: slots.length, succeeded: slots.length } },
      };
    },
  };
}

function makeSvgGenerator(capture) {
  return {
    async generate(slots) {
      if (capture) capture.push(...slots.map((s) => s.slotId));
      return {
        results: slots.map((s) => ({ slotId: s.slotId, svgContent: `<svg id=\"${s.slotId}\"></svg>`, width: 100, height: 50 })),
        report: { planned: slots.length, completed: slots.length, llmGenerated: 0, fallback: 0, skipped: 0, errors: [] },
      };
    },
  };
}

test("VisualSubAgent: generates image/svg/asset and updates statuses", async () => {
  const { VisualSubAgent } = await import("../../../js/agents/stages/design/subagents/visual-agent.js");
  const { AssetRegistry } = await import("../../../js/agents/stages/design/subagents/asset-registry.js");
  const { VisualSlotStatus } = await import("../../../js/agents/stages/design/states.js");

  const registry = new AssetRegistry();
  registry.addAsset({ assetId: "asset_1", type: "image", source: "upload", data: "QUJD", mimeType: "image/png", width: 200, height: 100 });

  const agent = new VisualSubAgent({
    assetRegistry: registry,
    imageGenerator: makeImageGenerator(),
    svgGenerator: makeSvgGenerator(),
  });

  const visualSlots = [
    { slotId: "img_1", renderType: "ai-image", imageSpec: { prompt: "Hero image" }, slideIndex: 0 },
    { slotId: "svg_1", renderType: "svg", svgSpec: { description: "Diagram" }, slideIndex: 1 },
    { slotId: "asset_1", renderType: "asset", assetSpec: { assetId: "asset_1" }, slideIndex: 2 },
  ];

  const out = await agent.run(visualSlots, baseDesignSystem, { runId: "run_visual" });

  assert.equal(out.imageResults.filledSlots.length, 1);
  assert.equal(out.svgResults.results.length, 1);
  assert.equal(out.assetResults.length, 1);
  assert.ok(out.assetResults[0].assetUri.startsWith("data:image/png;base64,"));

  const statusById = new Map(out.slots.map((s) => [s.slotId, s.status]));
  assert.equal(statusById.get("img_1"), VisualSlotStatus.FILLED);
  assert.equal(statusById.get("svg_1"), VisualSlotStatus.FILLED);
  assert.equal(statusById.get("asset_1"), VisualSlotStatus.FILLED);
});

test("VisualSubAgent: falls back ai-image to svg and marks missing assets failed", async () => {
  const { VisualSubAgent } = await import("../../../js/agents/stages/design/subagents/visual-agent.js");
  const { AssetRegistry } = await import("../../../js/agents/stages/design/subagents/asset-registry.js");
  const { VisualSlotStatus } = await import("../../../js/agents/stages/design/states.js");

  const captured = [];
  const agent = new VisualSubAgent({
    assetRegistry: new AssetRegistry(),
    svgGenerator: makeSvgGenerator(captured),
  });

  const visualSlots = [
    { slotId: "img_fallback", renderType: "ai-image", type: "chart", promptHint: "Sales trend" },
    { slotId: "missing_asset", renderType: "asset", assetSpec: { assetId: "asset_missing" } },
  ];

  const out = await agent.run(visualSlots, baseDesignSystem, { runId: "run_visual_2" });

  assert.deepEqual(captured, ["img_fallback"]);

  const statusById = new Map(out.slots.map((s) => [s.slotId, s.status]));
  assert.equal(statusById.get("img_fallback"), VisualSlotStatus.FILLED);
  assert.equal(statusById.get("missing_asset"), VisualSlotStatus.FAILED);
});

test("VisualSubAgent: reports generator errors and marks slots failed", async () => {
  const { VisualSubAgent } = await import("../../../js/agents/stages/design/subagents/visual-agent.js");
  const { VisualSlotStatus } = await import("../../../js/agents/stages/design/states.js");

  const agent = new VisualSubAgent({
    imageGenerator: {
      generate: async () => {
        throw new Error("image fail");
      },
    },
    svgGenerator: {
      generate: async () => {
        throw new Error("svg fail");
      },
    },
  });

  const visualSlots = [
    { slotId: "img_err", renderType: "ai-image", promptHint: "Oops" },
    { slotId: "svg_err", renderType: "svg", svgSpec: { description: "Oops" } },
  ];

  const out = await agent.run(visualSlots, baseDesignSystem, { runId: "run_errors" });

  assert.equal(out.report.errors.length, 2);
  assert.ok(out.report.errors.some((err) => err.type === "ai-image"));
  assert.ok(out.report.errors.some((err) => err.type === "svg"));

  const statusById = new Map(out.slots.map((s) => [s.slotId, s.status]));
  assert.equal(statusById.get("img_err"), VisualSlotStatus.FAILED);
  assert.equal(statusById.get("svg_err"), VisualSlotStatus.FAILED);
});

test("VisualSubAgent: resolves assets by registry when renderType is missing", async () => {
  const { VisualSubAgent } = await import("../../../js/agents/stages/design/subagents/visual-agent.js");
  const { AssetRegistry } = await import("../../../js/agents/stages/design/subagents/asset-registry.js");
  const { VisualSlotStatus } = await import("../../../js/agents/stages/design/states.js");

  const registry = new AssetRegistry();
  registry.addAsset({ assetId: "asset_x", source: "upload", data: "QUJD", mimeType: "image/png", width: 20, height: 10 });

  const agent = new VisualSubAgent({ assetRegistry: registry });
  const out = await agent.run([{ slotId: "slot_asset", assetId: "asset_x" }], baseDesignSystem, { runId: "run_asset" });

  assert.equal(out.assetResults.length, 1);
  assert.equal(out.assetResults[0].width, 20);
  assert.ok(out.assetResults[0].assetUri.startsWith("data:image/png;base64,"));
  assert.equal(out.slots[0].renderType, "asset");
  assert.equal(out.slots[0].status, VisualSlotStatus.FILLED);
});

test("VisualSubAgent: infers render types and aspect ratios", async () => {
  const { VisualSubAgent } = await import("../../../js/agents/stages/design/subagents/visual-agent.js");
  const { VisualSlotStatus } = await import("../../../js/agents/stages/design/states.js");

  const agent = new VisualSubAgent({
    imageGenerator: makeImageGenerator(),
    svgGenerator: makeSvgGenerator(),
  });

  const visualSlots = [
    { slotId: "hero_slot", renderType: "ai-image", position: { w: "80%", h: "50%" }, slideIndex: 0 },
    { slotId: "svg_slot", svgSpec: { description: "Diagram" }, slideIndex: 1 },
    { slotId: "chart_slot", visualType: "chart", slideIndex: 2 },
    { slotId: "default_slot", slideIndex: 3 },
  ];

  const out = await agent.run(visualSlots, baseDesignSystem, { runId: "run_infer" });

  const imageSlot = out.imageResults.filledSlots.find((s) => s.slotId === "hero_slot");
  assert.equal(imageSlot.aspectRatio, "16:9");

  const statusById = new Map(out.slots.map((s) => [s.slotId, s.status]));
  assert.equal(statusById.get("svg_slot"), VisualSlotStatus.FILLED);
  assert.equal(statusById.get("chart_slot"), VisualSlotStatus.FILLED);
  assert.equal(statusById.get("default_slot"), VisualSlotStatus.FILLED);
});
