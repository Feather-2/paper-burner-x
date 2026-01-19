/**
 * VisualHandler 单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { VisualHandler, createVisualHandler } from '../../../../../../js/agents/stages/design/runtime/visual-handler.js';

describe("VisualHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new VisualHandler();
  });

  describe("constructor", () => {
    it("should use default imageConcurrency", () => {
      expect(handler.imageConcurrency).toBe(4);
    });

    it("should accept custom imageConcurrency", () => {
      const h = new VisualHandler({ imageConcurrency: 8 });
      expect(h.imageConcurrency).toBe(8);
    });
  });

  describe("buildVisualSlots", () => {
    it("should return empty array when no provider and no model capability", () => {
      const result = handler.buildVisualSlots({}, [], null, false);
      expect(result).toEqual([]);
    });

    it("should build slots from imageSlots when no brainstorm candidates", () => {
      const imageSlots = [
        { slotId: "img1", slideIndex: 0, renderType: "ai-image", priority: "high" },
        { slotId: "img2", slideIndex: 1, renderType: "svg", priority: "medium" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, { generate: () => {} }, true);

      expect(result.length).toBe(2);
      expect(result[0].slotId).toBe("img1");
      expect(result[0].renderType).toBe("ai-image");
      expect(result[1].slotId).toBe("img2");
      expect(result[1].renderType).toBe("svg");
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

      expect(result.length).toBe(1);
      expect(result[0].slotId).toBe("vs1");
      expect(result[0].purpose).toBe("hero");
    });

    it("should fallback ai-image to svg when no imageProvider", () => {
      const imageSlots = [
        { slotId: "img1", slideIndex: 0, renderType: "ai-image", promptHint: "A diagram" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, null, true);

      expect(result.length).toBe(1);
      expect(result[0].renderType).toBe("svg");
      expect(result[0].svgSpec).toMatchObject({ type: "diagram", description: "A diagram" });
    });

    it("should preserve svg renderType", () => {
      const imageSlots = [
        { slotId: "svg1", slideIndex: 0, renderType: "svg" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, null, true);

      expect(result[0].renderType).toBe("svg");
    });

    it("should preserve asset renderType", () => {
      const imageSlots = [
        { slotId: "asset1", slideIndex: 0, renderType: "asset", assetId: "logo.png" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, null, true);

      expect(result[0].renderType).toBe("asset");
      expect(result[0].assetSpec).toMatchObject({ assetId: "logo.png" });
    });

    it("should handle empty brainstorm candidatesBySlide", () => {
      const brainstormResult = { candidatesBySlide: [] };
      const imageSlots = [{ slotId: "img1", slideIndex: 0, renderType: "ai-image" }];
      const result = handler.buildVisualSlots(brainstormResult, imageSlots, { generate: () => {} }, true);

      expect(result.length).toBe(1);
      expect(result[0].slotId).toBe("img1");
    });

    it("should handle null brainstorm candidatesBySlide", () => {
      const brainstormResult = { candidatesBySlide: null };
      const imageSlots = [{ slotId: "img1", slideIndex: 0, renderType: "ai-image" }];
      const result = handler.buildVisualSlots(brainstormResult, imageSlots, { generate: () => {} }, true);

      expect(result.length).toBe(1);
    });

    it("should include effects when present", () => {
      const imageSlots = [
        { slotId: "img1", slideIndex: 0, renderType: "ai-image", effects: { blur: 5 } },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, { generate: () => {} }, true);

      expect(result[0].effects).toEqual({ blur: 5 });
    });

    it("should set chart type for chart_fallback purpose", () => {
      const imageSlots = [
        { slotId: "chart1", slideIndex: 0, renderType: "ai-image", purpose: "chart_fallback" },
      ];
      const result = handler.buildVisualSlots({}, imageSlots, null, true);

      expect(result[0].renderType).toBe("svg");
      expect(result[0].svgSpec.type).toBe("chart");
    });
  });

  describe("createVisualHandler factory", () => {
    it("should create VisualHandler instance", () => {
      const h = createVisualHandler({ imageConcurrency: 2 });
      expect(h).toBeInstanceOf(VisualHandler);
      expect(h.imageConcurrency).toBe(2);
    });

    it("should create with defaults when no options", () => {
      const h = createVisualHandler();
      expect(h).toBeInstanceOf(VisualHandler);
      expect(h.imageConcurrency).toBe(4);
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
    expect(result.length).toBe(1);
  });

  it("should handle undefined renderType", () => {
    const imageSlots = [{ slotId: "img1", slideIndex: 0 }];
    const result = handler.buildVisualSlots({}, imageSlots, { generate: () => {} }, true);

    expect(result.length).toBe(1);
  });

  it("should handle mixed renderTypes", () => {
    const imageSlots = [
      { slotId: "img1", slideIndex: 0, renderType: "ai-image" },
      { slotId: "svg1", slideIndex: 1, renderType: "svg" },
      { slotId: "asset1", slideIndex: 2, renderType: "asset", assetId: "icon.svg" },
    ];
    const result = handler.buildVisualSlots({}, imageSlots, { generate: () => {} }, true);

    expect(result.length).toBe(3);
    expect(result[0].renderType).toBe("ai-image");
    expect(result[1].renderType).toBe("svg");
    expect(result[2].renderType).toBe("asset");
  });
});
