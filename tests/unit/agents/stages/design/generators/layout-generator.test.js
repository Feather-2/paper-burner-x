import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/stages/design/shared/design-utils.js", () => {
  return {
    escapeHtml: vi.fn((value) => `ESC(${String(value)})`),
  };
});

import { escapeHtml } from '../../../../../../js/agents/stages/design/shared/design-utils.js';
import { generateLayoutHtml, generateLayoutBatch } from '../../../../../../js/agents/stages/design/generators/layout-generator.js';

describe("design/generators/layout-generator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generateLayoutHtml supports hero layout with optional subtitle", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s1", title: "Intro", keyPoints: ["Sub"] },
      { layoutHint: "hero" }
    );
    expect(html).toContain("layout-hero");
    expect(html).toContain(`data-slide-id="ESC(s1)"`);
    expect(html).toContain("layout-title-large");
    expect(html).toContain("layout-subtitle");
    expect(html).toContain("ESC(Sub)");
    expect(escapeHtml).toHaveBeenCalled();
  });

  it("generateLayoutHtml supports two-column layout and respects visualFocus=right", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s2", title: "Two", keyPoints: ["a", "b"] },
      { layoutHint: "two-column", visualFocus: "right" }
    );
    expect(html).toContain("layout-two-column");
    // visualFocus=right => left placeholder, right points list
    expect(html).toContain('layout-left"><div class="layout-placeholder');
    expect(html).toContain('layout-right"><ul class="layout-points"');
    expect(html).toContain("ESC(a)");
    expect(html).toContain("ESC(b)");
  });

  it("generateLayoutHtml supports timeline layout and falls back to placeholder item when keyPoints empty (edge)", () => {
    const html = generateLayoutHtml({ slideIntentId: "s3", title: "Timeline", keyPoints: [] }, { layoutHint: "timeline" });
    expect(html).toContain("layout-timeline");
    expect(html).toContain("(时间线项)");
  });

  it("generateLayoutHtml supports list/dense-list layouts and uses placeholder point when empty", () => {
    const html = generateLayoutHtml({ slideIntentId: "s4", title: "List", keyPoints: [] }, { layoutHint: "dense-list" });
    expect(html).toContain("layout-list");
    expect(html).toContain("(要点)");
  });

  it("generateLayoutHtml supports chart-focus and image-focus layouts", () => {
    const chart = generateLayoutHtml({ slideIntentId: "s5", title: "Chart", keyPoints: ["caption"] }, { layoutHint: "chart-focus" });
    expect(chart).toContain("layout-chart");
    expect(chart).toContain("图表区域");
    expect(chart).toContain("ESC(caption)");

    const img = generateLayoutHtml({ slideIntentId: "s6", title: "Img", keyPoints: [] }, { layoutHint: "image-focus" });
    expect(img).toContain("layout-image");
    expect(img).toContain("全屏图片");
  });

  it("generateLayoutHtml default layout includes visual placeholder except for bullet/closing pageTypes", () => {
    const standard = generateLayoutHtml(
      { slideIntentId: "s7", title: "Std", keyPoints: ["x"], pageType: "content" },
      { layoutHint: "standard" }
    );
    expect(standard).toContain("layout-standard");
    expect(standard).toContain("layout-with-visual");
    expect(standard).toContain("layout-placeholder-visual");

    const bullet = generateLayoutHtml(
      { slideIntentId: "s8", title: "Bullets", keyPoints: ["x"], pageType: "bullet" },
      { layoutHint: "standard" }
    );
    expect(bullet).toContain("layout-standard");
    expect(bullet).not.toContain("layout-placeholder-visual");

    const closing = generateLayoutHtml(
      { slideIntentId: "s9", title: "Closing", keyPoints: ["x"], pageType: "closing" },
      { layoutHint: "standard" }
    );
    expect(closing).not.toContain("layout-placeholder-visual");
  });

  it("generateLayoutBatch maps plans by slideIntentId and falls back to empty plan", () => {
    const intents = [
      { slideIntentId: "a", title: "A", keyPoints: [] },
      { slideIntentId: "b", title: "B", keyPoints: [] },
    ];
    const plans = [{ slideIntentId: "b", layoutHint: "hero" }];
    const out = generateLayoutBatch(intents, plans);

    expect(out).toHaveLength(2);
    expect(out[0].slideIntentId).toBe("a");
    expect(out[0].layoutHtml).toContain("layout-standard"); // default plan => standard layout
    expect(out[1].layoutHtml).toContain("layout-hero");
  });
});

