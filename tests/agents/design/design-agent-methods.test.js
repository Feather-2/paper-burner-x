const test = require("node:test");
const assert = require("node:assert/strict");

test("DesignStage._buildVisualSlots: maps slots correctly with imageProvider", async () => {
  const { DesignStage } = await import("../../../js/agents/stages/design/design-agent.js");

  const stage = new DesignStage();
  const brainstormResult = {
    candidatesBySlide: [
      {
        slideIntentId: "s1",
        selectedCandidate: {
          visualSlots: [
            { slotId: "img_1", renderType: "ai-image", imageSpec: { prompt: "Test" } },
            { slotId: "svg_1", renderType: "svg", svgSpec: { description: "Chart" } },
          ],
        },
      },
    ],
  };
  const imageSlots = [];

  // With imageProvider
  const slotsWithProvider = stage._buildVisualSlots(brainstormResult, imageSlots, { generate: () => {} });
  assert.equal(slotsWithProvider.length, 2);
  assert.equal(slotsWithProvider[0].renderType, "ai-image");
  assert.equal(slotsWithProvider[1].renderType, "svg");
});

test("DesignStage._buildVisualSlots: fallback ai-image to svg without imageProvider", async () => {
  const { DesignStage } = await import("../../../js/agents/stages/design/design-agent.js");

  const stage = new DesignStage();
  const brainstormResult = {
    candidatesBySlide: [
      {
        slideIntentId: "s1",
        selectedCandidate: {
          visualSlots: [{ slotId: "img_1", renderType: "ai-image", imageSpec: { prompt: "Test" } }],
        },
      },
    ],
  };

  // Without imageProvider - should fallback to svg
  const slots = stage._buildVisualSlots(brainstormResult, [], null);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].renderType, "svg");
  assert.ok(slots[0].svgSpec);
});

