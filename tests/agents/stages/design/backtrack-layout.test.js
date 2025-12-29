import { describe, it } from "node:test";
import assert from "node:assert";
import { BacktrackError } from "../../../../js/agents/stages/design/agent-loop.js";
import { DesignPhase, designPhaseMachine } from "../../../../js/agents/stages/design/states.js";
import { generateLayoutHtml, generateLayoutBatch } from "../../../../js/agents/stages/design/generators/layout-generator.js";

describe("BacktrackError", () => {
  it("should create error with correct properties", () => {
    const err = new BacktrackError(DesignPhase.OUTLINE_PARSING, "outline", "user_requested");
    assert.strictEqual(err.name, "BacktrackError");
    assert.strictEqual(err.targetPhase, DesignPhase.OUTLINE_PARSING);
    assert.strictEqual(err.label, "outline");
    assert.strictEqual(err.reason, "user_requested");
    assert.ok(err.message.includes("Backtrack to"));
  });

  it("should be instanceof Error", () => {
    const err = new BacktrackError(DesignPhase.IDLE, "test", "test");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof BacktrackError);
  });
});

describe("Layout Phase States", () => {
  it("should have LAYOUT_DEVELOPING state", () => {
    assert.strictEqual(DesignPhase.LAYOUT_DEVELOPING, "layout_developing");
  });

  it("should have LAYOUT_CONFIRMING state", () => {
    assert.strictEqual(DesignPhase.LAYOUT_CONFIRMING, "layout_confirming");
  });

  it("should allow transition from PLAN_CONFIRMING to LAYOUT_DEVELOPING", () => {
    assert.ok(designPhaseMachine.canTransition(DesignPhase.PLAN_CONFIRMING, DesignPhase.LAYOUT_DEVELOPING));
  });

  it("should allow transition from LAYOUT_DEVELOPING to LAYOUT_CONFIRMING", () => {
    assert.ok(designPhaseMachine.canTransition(DesignPhase.LAYOUT_DEVELOPING, DesignPhase.LAYOUT_CONFIRMING));
  });

  it("should allow transition from LAYOUT_CONFIRMING to GENERATING", () => {
    assert.ok(designPhaseMachine.canTransition(DesignPhase.LAYOUT_CONFIRMING, DesignPhase.GENERATING));
  });

  it("should allow backtrack from LAYOUT_CONFIRMING to LAYOUT_DEVELOPING", () => {
    assert.ok(designPhaseMachine.canTransition(DesignPhase.LAYOUT_CONFIRMING, DesignPhase.LAYOUT_DEVELOPING));
  });
});

describe("Layout Generator", () => {
  describe("generateLayoutHtml", () => {
    it("should generate hero layout", () => {
      const intent = { slideIntentId: "s1", title: "Welcome", keyPoints: ["Subtitle here"] };
      const plan = { layoutHint: "hero" };
      const html = generateLayoutHtml(intent, plan);
      assert.ok(html.includes("layout-hero"));
      assert.ok(html.includes("Welcome"));
    });

    it("should generate two-column layout", () => {
      const intent = { slideIntentId: "s2", title: "Overview", keyPoints: ["Point 1", "Point 2"] };
      const plan = { layoutHint: "two-column", visualFocus: "right" };
      const html = generateLayoutHtml(intent, plan);
      assert.ok(html.includes("layout-two-column"));
      assert.ok(html.includes("layout-split"));
    });

    it("should generate timeline layout", () => {
      const intent = { slideIntentId: "s3", title: "History", keyPoints: ["2020", "2021", "2022"] };
      const plan = { layoutHint: "timeline" };
      const html = generateLayoutHtml(intent, plan);
      assert.ok(html.includes("layout-timeline"));
      assert.ok(html.includes("layout-timeline-item"));
    });

    it("should generate list layout", () => {
      const intent = { slideIntentId: "s4", title: "Features", keyPoints: ["Fast", "Secure"] };
      const plan = { layoutHint: "list" };
      const html = generateLayoutHtml(intent, plan);
      assert.ok(html.includes("layout-list"));
      assert.ok(html.includes("layout-points"));
    });

    it("should generate chart-focus layout", () => {
      const intent = { slideIntentId: "s5", title: "Data", keyPoints: ["Key insight"] };
      const plan = { layoutHint: "chart-focus" };
      const html = generateLayoutHtml(intent, plan);
      assert.ok(html.includes("layout-chart"));
      assert.ok(html.includes("layout-placeholder-chart"));
    });

    it("should generate image-focus layout", () => {
      const intent = { slideIntentId: "s6", title: "Photo", keyPoints: [] };
      const plan = { layoutHint: "image-focus" };
      const html = generateLayoutHtml(intent, plan);
      assert.ok(html.includes("layout-image"));
      assert.ok(html.includes("layout-full"));
    });

    it("should generate standard layout by default", () => {
      const intent = { slideIntentId: "s7", title: "Default", keyPoints: ["A", "B"] };
      const html = generateLayoutHtml(intent, {});
      assert.ok(html.includes("layout-standard"));
    });

    it("should escape HTML in title", () => {
      const intent = { slideIntentId: "s8", title: "<script>alert(1)</script>", keyPoints: [] };
      const html = generateLayoutHtml(intent, {});
      assert.ok(!html.includes("<script>"));
      assert.ok(html.includes("&lt;script&gt;"));
    });

    it("should handle null/undefined intent", () => {
      const html = generateLayoutHtml(null, {});
      assert.ok(html.includes("(未命名)"));
    });
  });

  describe("generateLayoutBatch", () => {
    it("should generate layouts for multiple intents", () => {
      const intents = [
        { slideIntentId: "s1", title: "Slide 1", keyPoints: [] },
        { slideIntentId: "s2", title: "Slide 2", keyPoints: [] },
      ];
      const plans = [
        { slideIntentId: "s1", layoutHint: "hero" },
        { slideIntentId: "s2", layoutHint: "list" },
      ];
      const results = generateLayoutBatch(intents, plans);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].slideIntentId, "s1");
      assert.ok(results[0].layoutHtml.includes("layout-hero"));
      assert.strictEqual(results[1].slideIntentId, "s2");
      assert.ok(results[1].layoutHtml.includes("layout-list"));
    });

    it("should handle missing plans", () => {
      const intents = [{ slideIntentId: "s1", title: "Test", keyPoints: [] }];
      const results = generateLayoutBatch(intents, []);
      assert.strictEqual(results.length, 1);
      assert.ok(results[0].layoutHtml.includes("layout-standard"));
    });
  });
});
