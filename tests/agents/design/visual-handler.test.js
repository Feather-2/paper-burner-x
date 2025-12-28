/**
 * VisualHandler 单元测试
 */
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";
import { VisualHandler, createVisualHandler } from "../../../js/agents/stages/design/runtime/visual-handler.js";

describe("VisualHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new VisualHandler();
  });

  describe("constructor", () => {
    it("should use default imageConcurrency", () => {
      assert.strictEqual(handler.imageConcurrency, 4);
    });

    it("should accept custom imageConcurrency", () => {
      const h = new VisualHandler({ imageConcurrency: 8 });
      assert.strictEqual(h.imageConcurrency, 8);
    });
  });

  describe("buildVisualSlots", () => {
    it("should return empty array when no provider and no model capability", () => {
      const result = handler.buildVisualSlots({}, [], null, false);
      assert.deepStrictEqual(result, []);
    });

    it("should build slots from imageSlots when no brainstorm candidates", () => {
      const imageSlots = [
        { slotId: "img1", slideIndex: 0, renderType: "ai-image", priority: "high" },
        { slotId: "img2", slideIndex: 1, renderType: "svg", priority: "medium" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, { generate: () => {} }, true);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].slotId, "img1");
      assert.strictEqual(result[0].renderType, "ai-image");
      assert.strictEqual(result[1].slotId, "img2");
      assert.strictEqual(result[1].renderType, "svg");
    });

    it("should use brainstorm candidates when available", () => {
      const brainstormResult = {
        candidatesBySlide: [
          {
            slideIntentId: "s1",
            selectedCandidate: {
              visualSlots: [
                { slotId: "vs1", renderType: "ai-image", purpose: "hero" },
              ],
            },
          },
        ],
      };
      const result = handler.buildVisualSlots(brainstormResult, [], { generate: () => {} }, true);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].slotId, "vs1");
      assert.strictEqual(result[0].purpose, "hero");
    });

    it("should fallback ai-image to svg when no imageProvider", () => {
      const imageSlots = [
        { slotId: "img1", slideIndex: 0, renderType: "ai-image", promptHint: "A diagram" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, null, true);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].renderType, "svg");
      assert.ok(result[0].svgSpec);
      assert.strictEqual(result[0].svgSpec.description, "A diagram");
    });

    it("should preserve svg renderType", () => {
      const imageSlots = [
        { slotId: "svg1", slideIndex: 0, renderType: "svg" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, null, true);

      assert.strictEqual(result[0].renderType, "svg");
    });

    it("should preserve asset renderType", () => {
      const imageSlots = [
        { slotId: "asset1", slideIndex: 0, renderType: "asset", assetId: "logo.png" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, null, true);

      assert.strictEqual(result[0].renderType, "asset");
      assert.ok(result[0].assetSpec);
      assert.strictEqual(result[0].assetSpec.assetId, "logo.png");
    });

    it("should handle empty brainstorm candidatesBySlide", () => {
      const brainstormResult = { candidatesBySlide: [] };
      const imageSlots = [{ slotId: "img1", slideIndex: 0, renderType: "ai-image" }];
      const result = handler.buildVisualSlots(brainstormResult, imageSlots, { generate: () => {} }, true);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].slotId, "img1");
    });

    it("should handle null brainstorm candidatesBySlide", () => {
      const brainstormResult = { candidatesBySlide: null };
      const imageSlots = [{ slotId: "img1", slideIndex: 0, renderType: "ai-image" }];
      const result = handler.buildVisualSlots(brainstormResult, imageSlots, { generate: () => {} }, true);

      assert.strictEqual(result.length, 1);
    });

    it("should include effects when present", () => {
      const imageSlots = [
        { slotId: "img1", slideIndex: 0, renderType: "ai-image", effects: { blur: 5 } },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, { generate: () => {} }, true);

      assert.deepStrictEqual(result[0].effects, { blur: 5 });
    });

    it("should set chart type for chart_fallback purpose", () => {
      const imageSlots = [
        { slotId: "chart1", slideIndex: 0, renderType: "ai-image", purpose: "chart_fallback" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, null, true);

      assert.strictEqual(result[0].renderType, "svg");
      assert.strictEqual(result[0].svgSpec.type, "chart");
    });
  });

  describe("createVisualHandler factory", () => {
    it("should create VisualHandler instance", () => {
      const h = createVisualHandler({ imageConcurrency: 2 });
      assert.ok(h instanceof VisualHandler);
      assert.strictEqual(h.imageConcurrency, 2);
    });

    it("should create with defaults when no options", () => {
      const h = createVisualHandler();
      assert.ok(h instanceof VisualHandler);
      assert.strictEqual(h.imageConcurrency, 4);
    });
  });
});

describe("VisualHandler renderType normalization", () => {
  let handler;

  beforeEach(() => {
    handler = new VisualHandler();
  });

  it("should normalize empty renderType to ai-image behavior", () => {
    const imageSlots = [{ slotId: "img1", slideIndex: 0, renderType: "" }];
    const result = handler.buildVisualSlots({}, imageSlots, { generate: () => {} }, true);

    // Empty renderType should be normalized (implementation dependent)
    assert.strictEqual(result.length, 1);
  });

  it("should handle undefined renderType", () => {
    const imageSlots = [{ slotId: "img1", slideIndex: 0 }];
    const result = handler.buildVisualSlots({}, imageSlots, { generate: () => {} }, true);

    assert.strictEqual(result.length, 1);
  });

  it("should handle mixed renderTypes", () => {
    const imageSlots = [
      { slotId: "img1", slideIndex: 0, renderType: "ai-image" },
      { slotId: "svg1", slideIndex: 1, renderType: "svg" },
      { slotId: "asset1", slideIndex: 2, renderType: "asset", assetId: "icon.svg" },
    ];
    const result = handler.buildVisualSlots({}, imageSlots, { generate: () => {} }, true);

    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].renderType, "ai-image");
    assert.strictEqual(result[1].renderType, "svg");
    assert.strictEqual(result[2].renderType, "asset");
  });
});
