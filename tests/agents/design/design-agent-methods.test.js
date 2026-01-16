import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("DesignStage._buildVisualSlots: maps slots correctly with imageProvider", async () => {
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
  expect(slotsWithProvider.length).toBe(2);
  expect(slotsWithProvider[0].renderType).toBe("ai-image");
  expect(slotsWithProvider[1].renderType).toBe("svg");
});

it("DesignStage._buildVisualSlots: fallback ai-image to svg without imageProvider", async () => {
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
  expect(slots.length).toBe(1);
  expect(slots[0].renderType).toBe("svg");
  expect(slots[0].svgSpec).toBeTruthy();
});

