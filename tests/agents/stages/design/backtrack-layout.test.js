import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { BacktrackError } from "../../../../js/agents/stages/design/agent-loop.js";
import { DesignPhase, designPhaseMachine } from "../../../../js/agents/stages/design/states.js";
import { generateLayoutHtml, generateLayoutBatch } from "../../../../js/agents/stages/design/generators/layout-generator.js";

describe("BacktrackError", () => {
  it("should create error with correct properties", () => {
    const err = new BacktrackError(DesignPhase.OUTLINE_PARSING, "outline", "user_requested");
    expect(err.name).toBe("BacktrackError");
    expect(err.targetPhase).toBe(DesignPhase.OUTLINE_PARSING);
    expect(err.label).toBe("outline");
    expect(err.reason).toBe("user_requested");
    expect(err.message.includes("Backtrack to")).toBeTruthy();
  });

  it("should be instanceof Error", () => {
    const err = new BacktrackError(DesignPhase.IDLE, "test", "test");
    expect(err instanceof Error).toBeTruthy();
    expect(err instanceof BacktrackError).toBeTruthy();
  });
});

describe("Layout Phase States", () => {
  it("should have LAYOUT_DEVELOPING state", () => {
    expect(DesignPhase.LAYOUT_DEVELOPING).toBe("layout_developing");
  });

  it("should have LAYOUT_CONFIRMING state", () => {
    expect(DesignPhase.LAYOUT_CONFIRMING).toBe("layout_confirming");
  });

  it("should allow transition from PLAN_CONFIRMING to LAYOUT_DEVELOPING", () => {
    expect(designPhaseMachine.canTransition(DesignPhase.PLAN_CONFIRMING, DesignPhase.LAYOUT_DEVELOPING)).toBeTruthy();
  });

  it("should allow transition from LAYOUT_DEVELOPING to LAYOUT_CONFIRMING", () => {
    expect(designPhaseMachine.canTransition(DesignPhase.LAYOUT_DEVELOPING, DesignPhase.LAYOUT_CONFIRMING)).toBeTruthy();
  });

  it("should allow transition from LAYOUT_CONFIRMING to GENERATING", () => {
    expect(designPhaseMachine.canTransition(DesignPhase.LAYOUT_CONFIRMING, DesignPhase.GENERATING)).toBeTruthy();
  });

  it("should allow backtrack from LAYOUT_CONFIRMING to LAYOUT_DEVELOPING", () => {
    expect(designPhaseMachine.canTransition(DesignPhase.LAYOUT_CONFIRMING, DesignPhase.LAYOUT_DEVELOPING)).toBeTruthy();
  });
});

describe("Layout Generator", () => {
  describe("generateLayoutHtml", () => {
    it("should generate hero layout", () => {
      const intent = { slideIntentId: "s1", title: "Welcome", keyPoints: ["Subtitle here"] };
      const plan = { layoutHint: "hero" };
      const html = generateLayoutHtml(intent, plan);
      expect(html.includes("layout-hero")).toBeTruthy();
      expect(html.includes("Welcome")).toBeTruthy();
    });

    it("should generate two-column layout", () => {
      const intent = { slideIntentId: "s2", title: "Overview", keyPoints: ["Point 1", "Point 2"] };
      const plan = { layoutHint: "two-column", visualFocus: "right" };
      const html = generateLayoutHtml(intent, plan);
      expect(html.includes("layout-two-column")).toBeTruthy();
      expect(html.includes("layout-split")).toBeTruthy();
    });

    it("should generate timeline layout", () => {
      const intent = { slideIntentId: "s3", title: "History", keyPoints: ["2020", "2021", "2022"] };
      const plan = { layoutHint: "timeline" };
      const html = generateLayoutHtml(intent, plan);
      expect(html.includes("layout-timeline")).toBeTruthy();
      expect(html.includes("layout-timeline-item")).toBeTruthy();
    });

    it("should generate list layout", () => {
      const intent = { slideIntentId: "s4", title: "Features", keyPoints: ["Fast", "Secure"] };
      const plan = { layoutHint: "list" };
      const html = generateLayoutHtml(intent, plan);
      expect(html.includes("layout-list")).toBeTruthy();
      expect(html.includes("layout-points")).toBeTruthy();
    });

    it("should generate chart-focus layout", () => {
      const intent = { slideIntentId: "s5", title: "Data", keyPoints: ["Key insight"] };
      const plan = { layoutHint: "chart-focus" };
      const html = generateLayoutHtml(intent, plan);
      expect(html.includes("layout-chart")).toBeTruthy();
      expect(html.includes("layout-placeholder-chart")).toBeTruthy();
    });

    it("should generate image-focus layout", () => {
      const intent = { slideIntentId: "s6", title: "Photo", keyPoints: [] };
      const plan = { layoutHint: "image-focus" };
      const html = generateLayoutHtml(intent, plan);
      expect(html.includes("layout-image")).toBeTruthy();
      expect(html.includes("layout-full")).toBeTruthy();
    });

    it("should generate standard layout by default", () => {
      const intent = { slideIntentId: "s7", title: "Default", keyPoints: ["A", "B"] };
      const html = generateLayoutHtml(intent, {});
      expect(html.includes("layout-standard")).toBeTruthy();
    });

    it("should escape HTML in title", () => {
      const intent = { slideIntentId: "s8", title: "<script>alert(1)</script>", keyPoints: [] };
      const html = generateLayoutHtml(intent, {});
      expect(!html.includes("<script>")).toBeTruthy();
      expect(html.includes("&lt;script&gt;")).toBeTruthy();
    });

    it("should handle null/undefined intent", () => {
      const html = generateLayoutHtml(null, {});
      expect(html.includes("(未命名)")).toBeTruthy();
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
      expect(results.length).toBe(2);
      expect(results[0].slideIntentId).toBe("s1");
      expect(results[0].layoutHtml.includes("layout-hero")).toBeTruthy();
      expect(results[1].slideIntentId).toBe("s2");
      expect(results[1].layoutHtml.includes("layout-list")).toBeTruthy();
    });

    it("should handle missing plans", () => {
      const intents = [{ slideIntentId: "s1", title: "Test", keyPoints: [] }];
      const results = generateLayoutBatch(intents, []);
      expect(results.length).toBe(1);
      expect(results[0].layoutHtml.includes("layout-standard")).toBeTruthy();
    });
  });
});
