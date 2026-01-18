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
    expect(err.message).toContain("Backtrack to");
  });

  it("should be instanceof Error", () => {
    const err = new BacktrackError(DesignPhase.IDLE, "test", "test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BacktrackError);
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
    expect(designPhaseMachine.canTransition(DesignPhase.PLAN_CONFIRMING, DesignPhase.LAYOUT_DEVELOPING)).toBe(true);
  });

  it("should allow transition from LAYOUT_DEVELOPING to LAYOUT_CONFIRMING", () => {
    expect(designPhaseMachine.canTransition(DesignPhase.LAYOUT_DEVELOPING, DesignPhase.LAYOUT_CONFIRMING)).toBe(true);
  });

  it("should allow transition from LAYOUT_CONFIRMING to GENERATING", () => {
    expect(designPhaseMachine.canTransition(DesignPhase.LAYOUT_CONFIRMING, DesignPhase.GENERATING)).toBe(true);
  });

  it("should allow backtrack from LAYOUT_CONFIRMING to LAYOUT_DEVELOPING", () => {
    expect(designPhaseMachine.canTransition(DesignPhase.LAYOUT_CONFIRMING, DesignPhase.LAYOUT_DEVELOPING)).toBe(true);
  });
});

describe("Layout Generator", () => {
  describe("generateLayoutHtml", () => {
    it("should generate hero layout", () => {
      const intent = { slideIntentId: "s1", title: "Welcome", keyPoints: ["Subtitle here"] };
      const plan = { layoutHint: "hero" };
      const html = generateLayoutHtml(intent, plan);
      expect(html).toContain("layout-hero");
      expect(html).toContain("Welcome");
    });

    it("should generate two-column layout", () => {
      const intent = { slideIntentId: "s2", title: "Overview", keyPoints: ["Point 1", "Point 2"] };
      const plan = { layoutHint: "two-column", visualFocus: "right" };
      const html = generateLayoutHtml(intent, plan);
      expect(html).toContain("layout-two-column");
      expect(html).toContain("layout-split");
    });

    it("should generate timeline layout", () => {
      const intent = { slideIntentId: "s3", title: "History", keyPoints: ["2020", "2021", "2022"] };
      const plan = { layoutHint: "timeline" };
      const html = generateLayoutHtml(intent, plan);
      expect(html).toContain("layout-timeline");
      expect(html).toContain("layout-timeline-item");
    });

    it("should generate list layout", () => {
      const intent = { slideIntentId: "s4", title: "Features", keyPoints: ["Fast", "Secure"] };
      const plan = { layoutHint: "list" };
      const html = generateLayoutHtml(intent, plan);
      expect(html).toContain("layout-list");
      expect(html).toContain("layout-points");
    });

    it("should generate chart-focus layout", () => {
      const intent = { slideIntentId: "s5", title: "Data", keyPoints: ["Key insight"] };
      const plan = { layoutHint: "chart-focus" };
      const html = generateLayoutHtml(intent, plan);
      expect(html).toContain("layout-chart");
      expect(html).toContain("layout-placeholder-chart");
    });

    it("should generate image-focus layout", () => {
      const intent = { slideIntentId: "s6", title: "Photo", keyPoints: [] };
      const plan = { layoutHint: "image-focus" };
      const html = generateLayoutHtml(intent, plan);
      expect(html).toContain("layout-image");
      expect(html).toContain("layout-full");
    });

    it("should generate standard layout by default", () => {
      const intent = { slideIntentId: "s7", title: "Default", keyPoints: ["A", "B"] };
      const html = generateLayoutHtml(intent, {});
      expect(html).toContain("layout-standard");
    });

    it("should escape HTML in title", () => {
      const intent = { slideIntentId: "s8", title: "<script>alert(1)</script>", keyPoints: [] };
      const html = generateLayoutHtml(intent, {});
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("should handle null/undefined intent", () => {
      const html = generateLayoutHtml(null, {});
      expect(html).toContain("(未命名)");
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
      expect(results[0].layoutHtml).toContain("layout-hero");
      expect(results[1].slideIntentId).toBe("s2");
      expect(results[1].layoutHtml).toContain("layout-list");
    });

    it("should handle missing plans", () => {
      const intents = [{ slideIntentId: "s1", title: "Test", keyPoints: [] }];
      const results = generateLayoutBatch(intents, []);
      expect(results.length).toBe(1);
      expect(results[0].layoutHtml).toContain("layout-standard");
    });
  });
});
