/**
 * DesignContext 单元测试
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { DesignContext, createDesignContext } from "../../../js/agents/stages/design/runtime/design-context.js";

describe("DesignContext", () => {
  let ctx;

  beforeEach(() => {
    ctx = new DesignContext();
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      assert.deepStrictEqual(ctx.slideIntents, []);
      assert.strictEqual(ctx.designSystem, null);
      assert.deepStrictEqual(ctx.imageSlots, []);
      assert.strictEqual(ctx.deckHtmlDsl, "");
      assert.deepStrictEqual(ctx.slidesMeta, []);
      assert.deepStrictEqual(ctx.constraints, {});
      assert.deepStrictEqual(ctx.userConfig, {});
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

      assert.deepStrictEqual(ctx2.slideIntents, intents);
      assert.deepStrictEqual(ctx2.designSystem, system);
      assert.deepStrictEqual(ctx2.imageSlots, slots);
      assert.strictEqual(ctx2.deckHtmlDsl, "<section>Test</section>");
      assert.deepStrictEqual(ctx2.constraints, { maxSlides: 10 });
      assert.deepStrictEqual(ctx2.userConfig, { refine: { enabled: true } });
    });
  });

  describe("slideIntents", () => {
    it("should get and set slideIntents", () => {
      const intents = [{ slideIntentId: "s1" }, { slideIntentId: "s2" }];
      ctx.setSlideIntents(intents);
      assert.deepStrictEqual(ctx.slideIntents, intents);
      assert.strictEqual(ctx.slideCount, 2);
    });

    it("should handle non-array input", () => {
      ctx.setSlideIntents("invalid");
      assert.deepStrictEqual(ctx.slideIntents, []);
      assert.strictEqual(ctx.slideCount, 0);
    });

    it("should handle null input", () => {
      ctx.setSlideIntents(null);
      assert.deepStrictEqual(ctx.slideIntents, []);
    });
  });

  describe("designSystem", () => {
    it("should get and set designSystem", () => {
      const system = {
        theme: "corporate",
        designTokens: { colors: { primary: "#007bff" } },
      };
      ctx.setDesignSystem(system);
      assert.deepStrictEqual(ctx.designSystem, system);
      assert.deepStrictEqual(ctx.designTokens, system.designTokens);
      assert.strictEqual(ctx.theme, "corporate");
    });

    it("should return null for missing designTokens", () => {
      ctx.setDesignSystem({ theme: "minimal" });
      assert.strictEqual(ctx.designTokens, null);
    });

    it("should handle null input", () => {
      ctx.setDesignSystem(null);
      assert.strictEqual(ctx.designSystem, null);
      assert.strictEqual(ctx.designTokens, null);
      assert.strictEqual(ctx.theme, null);
    });
  });

  describe("imageSlots", () => {
    it("should get and set imageSlots", () => {
      const slots = [
        { slotId: "img1", slideIndex: 0 },
        { slotId: "img2", slideIndex: 1 },
      ];
      ctx.setImageSlots(slots);
      assert.deepStrictEqual(ctx.imageSlots, slots);
    });

    it("should update individual slot", () => {
      ctx.setImageSlots([
        { slotId: "img1", status: "pending" },
        { slotId: "img2", status: "pending" },
      ]);
      ctx.updateImageSlot("img1", { status: "completed", url: "http://example.com/img.png" });

      assert.strictEqual(ctx.imageSlots[0].status, "completed");
      assert.strictEqual(ctx.imageSlots[0].url, "http://example.com/img.png");
      assert.strictEqual(ctx.imageSlots[1].status, "pending");
    });

    it("should ignore update for non-existent slot", () => {
      ctx.setImageSlots([{ slotId: "img1", status: "pending" }]);
      ctx.updateImageSlot("nonexistent", { status: "completed" });
      assert.strictEqual(ctx.imageSlots.length, 1);
      assert.strictEqual(ctx.imageSlots[0].status, "pending");
    });

    it("should handle non-array input", () => {
      ctx.setImageSlots("invalid");
      assert.deepStrictEqual(ctx.imageSlots, []);
    });
  });

  describe("deckHtmlDsl", () => {
    it("should get and set deckHtmlDsl", () => {
      const html = "<section><h1>Title</h1></section>";
      ctx.setDeckHtmlDsl(html);
      assert.strictEqual(ctx.deckHtmlDsl, html);
    });

    it("should handle non-string input", () => {
      ctx.setDeckHtmlDsl(123);
      assert.strictEqual(ctx.deckHtmlDsl, "");

      ctx.setDeckHtmlDsl(null);
      assert.strictEqual(ctx.deckHtmlDsl, "");
    });
  });

  describe("slidesMeta", () => {
    it("should get and set slidesMeta", () => {
      const meta = [
        { slideNo: 1, title: "Intro" },
        { slideNo: 2, title: "Content" },
      ];
      ctx.setSlidesMeta(meta);
      assert.deepStrictEqual(ctx.slidesMeta, meta);
    });

    it("should handle non-array input", () => {
      ctx.setSlidesMeta("invalid");
      assert.deepStrictEqual(ctx.slidesMeta, []);
    });
  });

  describe("constraints and userConfig", () => {
    it("should get and set constraints", () => {
      ctx.setConstraints({ maxSlides: 20, imagePolicy: "balanced" });
      assert.deepStrictEqual(ctx.constraints, { maxSlides: 20, imagePolicy: "balanced" });
    });

    it("should get and set userConfig", () => {
      ctx.setUserConfig({ refine: { enabled: true, hardLimit: 10 } });
      assert.deepStrictEqual(ctx.userConfig, { refine: { enabled: true, hardLimit: 10 } });
    });

    it("should handle null input", () => {
      ctx.setConstraints(null);
      assert.deepStrictEqual(ctx.constraints, {});

      ctx.setUserConfig(null);
      assert.deepStrictEqual(ctx.userConfig, {});
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

      assert.deepStrictEqual(snapshot.slideIntents, [{ slideIntentId: "s1" }]);
      assert.deepStrictEqual(snapshot.designSystem, { theme: "dark" });
      assert.deepStrictEqual(snapshot.imageSlots, [{ slotId: "img1" }]);
      assert.strictEqual(snapshot.deckHtmlDsl, "<section>Test</section>");
      assert.deepStrictEqual(snapshot.slidesMeta, [{ slideNo: 1 }]);
      assert.deepStrictEqual(snapshot.constraints, { maxSlides: 10 });
      assert.deepStrictEqual(snapshot.userConfig, { refine: { enabled: true } });
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

      assert.strictEqual(restored.runId, "run-123");
      assert.deepStrictEqual(restored.slideIntents, snapshot.slideIntents);
      assert.deepStrictEqual(restored.designSystem, snapshot.designSystem);
      assert.deepStrictEqual(restored.imageSlots, snapshot.imageSlots);
      assert.strictEqual(restored.deckHtmlDsl, snapshot.deckHtmlDsl);
      assert.deepStrictEqual(restored.slidesMeta, snapshot.slidesMeta);
      assert.deepStrictEqual(restored.constraints, snapshot.constraints);
      assert.deepStrictEqual(restored.userConfig, snapshot.userConfig);
    });

    it("should merge additional options when restoring", () => {
      const snapshot = { slideIntents: [{ slideIntentId: "s1" }] };
      const eventBus = { emit: () => {} };
      const restored = DesignContext.fromSnapshot(snapshot, { eventBus });

      assert.deepStrictEqual(restored.slideIntents, [{ slideIntentId: "s1" }]);
      assert.strictEqual(restored.eventBus, eventBus);
    });
  });

  describe("createDesignContext factory", () => {
    it("should create DesignContext instance", () => {
      const ctx = createDesignContext({ slideIntents: [{ slideIntentId: "s1" }] });
      assert.ok(ctx instanceof DesignContext);
      assert.deepStrictEqual(ctx.slideIntents, [{ slideIntentId: "s1" }]);
    });

    it("should create empty context with no options", () => {
      const ctx = createDesignContext();
      assert.ok(ctx instanceof DesignContext);
      assert.deepStrictEqual(ctx.slideIntents, []);
    });
  });
});
