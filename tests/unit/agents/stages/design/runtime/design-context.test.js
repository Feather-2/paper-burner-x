/**
 * DesignContext 单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { DesignContext, createDesignContext } from '../../../../../../js/agents/stages/design/runtime/design-context.js';

describe("DesignContext", () => {
  let ctx;

  beforeEach(() => {
    ctx = new DesignContext();
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      expect(ctx.slideIntents).toEqual([]);
      expect(ctx.designSystem).toBe(null);
      expect(ctx.imageSlots).toEqual([]);
      expect(ctx.deckHtmlDsl).toBe("");
      expect(ctx.slidesMeta).toEqual([]);
      expect(ctx.constraints).toEqual({});
      expect(ctx.userConfig).toEqual({});
    });

    it("should accept initial values", () => {
      const intents = [{ slideIntentId: "s1", title: "Intro" }];
      const system = { theme: "dark", designTokens: {} };
      const slots = [{ slotId: "img1" }];

      const ctx2 = new DesignContext({
        slideIntents: intents,
        designSystem: system,
        imageSlots: slots,
        deckHtmlDsl: "<section>Test</section>",
        constraints: { maxSlides: 10 },
        userConfig: { refine: { enabled: true } },
      });

      expect(ctx2.slideIntents).toEqual(intents);
      expect(ctx2.designSystem).toEqual(system);
      expect(ctx2.imageSlots).toEqual(slots);
      expect(ctx2.deckHtmlDsl).toBe("<section>Test</section>");
      expect(ctx2.constraints).toEqual({ maxSlides: 10 });
      expect(ctx2.userConfig).toEqual({ refine: { enabled: true } });
    });
  });

  describe("slideIntents", () => {
    it("should get and set slideIntents", () => {
      const intents = [{ slideIntentId: "s1" }, { slideIntentId: "s2" }];
      ctx.setSlideIntents(intents);
      expect(ctx.slideIntents).toEqual(intents);
      expect(ctx.slideCount).toBe(2);
    });

    it("should handle non-array input", () => {
      ctx.setSlideIntents("invalid");
      expect(ctx.slideIntents).toEqual([]);
      expect(ctx.slideCount).toBe(0);
    });

    it("should handle null input", () => {
      ctx.setSlideIntents(null);
      expect(ctx.slideIntents).toEqual([]);
    });
  });

  describe("designSystem", () => {
    it("should get and set designSystem", () => {
      const system = {
        theme: "corporate",
        designTokens: { colors: { primary: "#007bff" } },
      };
      ctx.setDesignSystem(system);
      expect(ctx.designSystem).toEqual(system);
      expect(ctx.designTokens).toEqual(system.designTokens);
      expect(ctx.theme).toBe("corporate");
    });

    it("should return null for missing designTokens", () => {
      ctx.setDesignSystem({ theme: "minimal" });
      expect(ctx.designTokens).toBe(null);
    });

    it("should handle null input", () => {
      ctx.setDesignSystem(null);
      expect(ctx.designSystem).toBe(null);
      expect(ctx.designTokens).toBe(null);
      expect(ctx.theme).toBe(null);
    });
  });

  describe("imageSlots", () => {
    it("should get and set imageSlots", () => {
      const slots = [
        { slotId: "img1", slideIndex: 0 },
        { slotId: "img2", slideIndex: 1 },
      ];
      ctx.setImageSlots(slots);
      expect(ctx.imageSlots).toEqual(slots);
    });

    it("should update individual slot", () => {
      ctx.setImageSlots([
        { slotId: "img1", status: "pending" },
        { slotId: "img2", status: "pending" },
      ]);
      ctx.updateImageSlot("img1", { status: "completed", url: "http://example.com/img.png" });

      expect(ctx.imageSlots[0].status).toBe("completed");
      expect(ctx.imageSlots[0].url).toBe("http://example.com/img.png");
      expect(ctx.imageSlots[1].status).toBe("pending");
    });

    it("should ignore update for non-existent slot", () => {
      ctx.setImageSlots([{ slotId: "img1", status: "pending" }]);
      ctx.updateImageSlot("nonexistent", { status: "completed" });
      expect(ctx.imageSlots.length).toBe(1);
      expect(ctx.imageSlots[0].status).toBe("pending");
    });

    it("should handle non-array input", () => {
      ctx.setImageSlots("invalid");
      expect(ctx.imageSlots).toEqual([]);
    });
  });

  describe("deckHtmlDsl", () => {
    it("should get and set deckHtmlDsl", () => {
      const html = "<section><h1>Title</h1></section>";
      ctx.setDeckHtmlDsl(html);
      expect(ctx.deckHtmlDsl).toBe(html);
    });

    it("should handle non-string input", () => {
      ctx.setDeckHtmlDsl(123);
      expect(ctx.deckHtmlDsl).toBe("");

      ctx.setDeckHtmlDsl(null);
      expect(ctx.deckHtmlDsl).toBe("");
    });
  });

  describe("slidesMeta", () => {
    it("should get and set slidesMeta", () => {
      const meta = [
        { slideNo: 1, title: "Intro" },
        { slideNo: 2, title: "Content" },
      ];
      ctx.setSlidesMeta(meta);
      expect(ctx.slidesMeta).toEqual(meta);
    });

    it("should handle non-array input", () => {
      ctx.setSlidesMeta("invalid");
      expect(ctx.slidesMeta).toEqual([]);
    });
  });

  describe("constraints and userConfig", () => {
    it("should get and set constraints", () => {
      ctx.setConstraints({ maxSlides: 20, imagePolicy: "balanced" });
      expect(ctx.constraints).toEqual({ maxSlides: 20, imagePolicy: "balanced" });
    });

    it("should get and set userConfig", () => {
      ctx.setUserConfig({ refine: { enabled: true, hardLimit: 10 } });
      expect(ctx.userConfig).toEqual({ refine: { enabled: true, hardLimit: 10 } });
    });

    it("should handle null input", () => {
      ctx.setConstraints(null);
      expect(ctx.constraints).toEqual({});

      ctx.setUserConfig(null);
      expect(ctx.userConfig).toEqual({});
    });
  });

  describe("snapshot", () => {
    it("should create snapshot with all state", () => {
      ctx.setSlideIntents([{ slideIntentId: "s1" }]);
      ctx.setDesignSystem({ theme: "dark" });
      ctx.setImageSlots([{ slotId: "img1" }]);
      ctx.setDeckHtmlDsl("<section>Test</section>");
      ctx.setSlidesMeta([{ slideNo: 1 }]);
      ctx.setConstraints({ maxSlides: 10 });
      ctx.setUserConfig({ refine: { enabled: true } });

      const snapshot = ctx.toSnapshot();

      expect(snapshot.slideIntents).toEqual([{ slideIntentId: "s1" }]);
      expect(snapshot.designSystem).toEqual({ theme: "dark" });
      expect(snapshot.imageSlots).toEqual([{ slotId: "img1" }]);
      expect(snapshot.deckHtmlDsl).toBe("<section>Test</section>");
      expect(snapshot.slidesMeta).toEqual([{ slideNo: 1 }]);
      expect(snapshot.constraints).toEqual({ maxSlides: 10 });
      expect(snapshot.userConfig).toEqual({ refine: { enabled: true } });
    });

    it("should restore from snapshot", () => {
      const snapshot = {
        runId: "run-123",
        slideIntents: [{ slideIntentId: "s1" }],
        designSystem: { theme: "corporate" },
        imageSlots: [{ slotId: "img1" }],
        deckHtmlDsl: "<section>Restored</section>",
        slidesMeta: [{ slideNo: 1 }],
        constraints: { maxSlides: 5 },
        userConfig: { refine: { enabled: false } },
      };

      const restored = DesignContext.fromSnapshot(snapshot);

      expect(restored.runId).toBe("run-123");
      expect(restored.slideIntents).toEqual(snapshot.slideIntents);
      expect(restored.designSystem).toEqual(snapshot.designSystem);
      expect(restored.imageSlots).toEqual(snapshot.imageSlots);
      expect(restored.deckHtmlDsl).toBe(snapshot.deckHtmlDsl);
      expect(restored.slidesMeta).toEqual(snapshot.slidesMeta);
      expect(restored.constraints).toEqual(snapshot.constraints);
      expect(restored.userConfig).toEqual(snapshot.userConfig);
    });

    it("should merge additional options when restoring", () => {
      const snapshot = { slideIntents: [{ slideIntentId: "s1" }] };
      const eventBus = { emit: () => {} };
      const restored = DesignContext.fromSnapshot(snapshot, { eventBus });

      expect(restored.slideIntents).toEqual([{ slideIntentId: "s1" }]);
      expect(restored.eventBus).toBe(eventBus);
    });
  });

  describe("createDesignContext factory", () => {
    it("should create DesignContext instance", () => {
      const ctx = createDesignContext({ slideIntents: [{ slideIntentId: "s1" }] });
      expect(ctx).toBeInstanceOf(DesignContext);
      expect(ctx.slideIntents).toEqual([{ slideIntentId: "s1" }]);
    });

    it("should create empty context with no options", () => {
      const ctx = createDesignContext();
      expect(ctx).toBeInstanceOf(DesignContext);
      expect(ctx.slideIntents).toEqual([]);
    });
  });
});
