import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedDesignTokens = vi.hoisted(() => ({
  generateDesignTokens: vi.fn(),
}));

const mockedDesignSystem = vi.hoisted(() => ({
  generateDesignSystem: vi.fn(),
}));

const mockedImageGenerator = vi.hoisted(() => ({
  fillImagePlaceholders: vi.fn(),
}));

const mockedSvgGenerator = vi.hoisted(() => {
  const instances = [];

  class SVGGenerator {
    constructor() {
      this.kind = "svg-generator";
      instances.push(this);
    }
  }

  return {
    SVGGenerator,
    fillSvgPlaceholders: vi.fn(),
    instances,
  };
});

const mockedAssetResolver = vi.hoisted(() => ({
  fillAssetPlaceholders: vi.fn(),
}));

const mockedVisualAgent = vi.hoisted(() => {
  const instances = [];
  const runImpl = vi.fn();
  const transitionLogImpl = vi.fn();

  class VisualSubAgent {
    constructor(config) {
      this.config = config;
      this.run = vi.fn((...args) => runImpl(...args));
      this.getTransitionLog = vi.fn(() => transitionLogImpl());
      instances.push(this);
    }
  }

  return {
    VisualSubAgent,
    instances,
    runImpl,
    transitionLogImpl,
  };
});

const mockedShared = vi.hoisted(() => ({
  normalizeRenderType: vi.fn(),
}));

const mockedRuntime = vi.hoisted(() => ({
  checkCancelled: vi.fn(),
  getEmitFn: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/generators/design-tokens.js", () => ({
  generateDesignTokens: mockedDesignTokens.generateDesignTokens,
}));

vi.mock("../../../../../../js/agents/stages/design/generators/design-system-generator.js", () => ({
  generateDesignSystem: mockedDesignSystem.generateDesignSystem,
}));

vi.mock("../../../../../../js/agents/stages/design/generators/image-generator.js", () => ({
  fillImagePlaceholders: mockedImageGenerator.fillImagePlaceholders,
}));

vi.mock("../../../../../../js/agents/stages/design/generators/svg-generator.js", () => ({
  SVGGenerator: mockedSvgGenerator.SVGGenerator,
  fillSvgPlaceholders: mockedSvgGenerator.fillSvgPlaceholders,
}));

vi.mock("../../../../../../js/agents/stages/design/image/asset-resolver.js", () => ({
  fillAssetPlaceholders: mockedAssetResolver.fillAssetPlaceholders,
}));

vi.mock("../../../../../../js/agents/stages/design/subagents/visual-agent.js", () => ({
  VisualSubAgent: mockedVisualAgent.VisualSubAgent,
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  normalizeRenderType: mockedShared.normalizeRenderType,
}));

vi.mock("../../../../../../js/agents/runtime/index.js", () => ({
  checkCancelled: mockedRuntime.checkCancelled,
  getEmitFn: mockedRuntime.getEmitFn,
}));

import {
  VisualHandler,
  createVisualHandler,
} from "../../../../../../js/agents/stages/design/internal/visual-handler.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const makeContext = (overrides = {}) => ({
  aiApiService: "api",
  signal: { aborted: false },
  modelRouter: "router",
  ...overrides,
});

const makeRunContext = (overrides = {}) => ({
  runId: "run-1",
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mockedVisualAgent.instances.length = 0;
  mockedSvgGenerator.instances.length = 0;

  mockedDesignTokens.generateDesignTokens.mockReturnValue({
    designTokens: { fallback: true },
  });
  mockedDesignSystem.generateDesignSystem.mockResolvedValue({
    designTokens: { generated: true },
  });

  mockedImageGenerator.fillImagePlaceholders.mockImplementation((html, slots) => ({
    deckHtmlDsl: `${html}::images`,
    filledSlotIds: Array.isArray(slots) ? slots.map((slot) => slot.slotId) : [],
  }));
  mockedSvgGenerator.fillSvgPlaceholders.mockImplementation((html) => ({
    html: `${html}::svg`,
  }));
  mockedAssetResolver.fillAssetPlaceholders.mockImplementation((html) => ({
    html: `${html}::asset`,
  }));

  mockedShared.normalizeRenderType.mockImplementation((value) =>
    value == null || value === "" ? "ai-image" : value
  );

  mockedRuntime.getEmitFn.mockReturnValue(vi.fn());
  mockedRuntime.checkCancelled.mockImplementation(() => {});
  mockedVisualAgent.runImpl.mockReset();
  mockedVisualAgent.transitionLogImpl.mockReset();
});

describe("VisualHandler", () => {
  it("constructor defaults imageConcurrency and keeps boundary values", () => {
    expect(new VisualHandler().imageConcurrency).toBe(4);
    expect(new VisualHandler({ imageConcurrency: 2 }).imageConcurrency).toBe(2);
    expect(new VisualHandler({ imageConcurrency: 0 }).imageConcurrency).toBe(4);
    expect(new VisualHandler({ imageConcurrency: -1 }).imageConcurrency).toBe(-1);
  });

  describe("initDesignSystem", () => {
    it("uses generator output with prioritized palette and runContext router", async () => {
      const handler = new VisualHandler();
      const contentPackage = {
        summary: "summary",
        constraints: { tone: "calm", extractedPalette: ["#111"] },
      };
      const constraints = { tone: "bold", extractedPalette: ["#222"] };
      const context = makeContext({ modelRouter: undefined, runContext: { modelRouter: "router-ctx" } });

      const result = await handler.initDesignSystem(contentPackage, context, constraints, {
        mode: "user",
      });

      expect(mockedDesignSystem.generateDesignSystem).toHaveBeenCalledTimes(1);
      const [input, options] = mockedDesignSystem.generateDesignSystem.mock.calls[0];
      expect(input).toEqual({
        contentSummary: "summary",
        tone: "bold",
        extractedPalette: ["#111"],
        userPreferences: { mode: "user" },
      });
      expect(options).toEqual({
        modelRouter: "router-ctx",
        aiApiService: "api",
        signal: context.signal,
        constraints,
      });
      expect(result).toEqual({ designTokens: { generated: true } });
      expect(mockedDesignTokens.generateDesignTokens).not.toHaveBeenCalled();
    });

    it("falls back to tokens when generator throws", async () => {
      mockedDesignSystem.generateDesignSystem.mockRejectedValueOnce(new Error("boom"));
      const handler = new VisualHandler();
      const constraints = { tone: "x" };
      const context = makeContext({ modelRouter: "router-x", signal: "sig" });

      const result = await handler.initDesignSystem({ summary: "" }, context, constraints, null);

      expect(mockedRuntime.checkCancelled).toHaveBeenCalledWith("sig");
      expect(mockedDesignTokens.generateDesignTokens).toHaveBeenCalledWith(constraints);
      expect(result).toEqual({ designTokens: { fallback: true } });
    });

    it("falls back when designTokens missing", async () => {
      mockedDesignSystem.generateDesignSystem.mockResolvedValueOnce({ other: true });
      const handler = new VisualHandler();
      const constraints = {};
      const result = await handler.initDesignSystem({ summary: "x" }, makeContext(), constraints, "");

      expect(mockedDesignTokens.generateDesignTokens).toHaveBeenCalledWith(constraints);
      expect(result).toEqual({ designTokens: { fallback: true } });
    });

    it("handles null content and numeric tone boundary", async () => {
      const handler = new VisualHandler();
      const constraints = { tone: Number.MAX_SAFE_INTEGER };
      const context = makeContext({ modelRouter: null, aiApiService: null, signal: null });

      await handler.initDesignSystem(null, context, constraints, "");

      const [input, options] = mockedDesignSystem.generateDesignSystem.mock.calls[0];
      expect(input.contentSummary).toBe("");
      expect(input.tone).toBe(String(Number.MAX_SAFE_INTEGER));
      expect(input.userPreferences).toBe("");
      expect(options.modelRouter).toBe(null);
    });
  });

  describe("buildVisualSlots", () => {
    it("returns empty array when no provider and no model capability", () => {
      const handler = new VisualHandler();
      const result = handler.buildVisualSlots(null, null, null, false);
      expect(result).toEqual([]);
    });

    it("maps selected slots and falls back to svg for ai-image", () => {
      mockedShared.normalizeRenderType.mockImplementation((value) => value);
      const handler = new VisualHandler();
      const brainstormResult = {
        candidatesBySlide: [
          {
            selectedCandidate: {
              visualSlots: [
                {
                  slotId: "s1",
                  renderType: "ai-image",
                  purpose: "chart_fallback",
                  imageSpec: { prompt: "chart prompt" },
                },
                {
                  slotId: "s2",
                  renderType: "ai-image",
                  promptHint: "hint prompt",
                },
                {
                  slotId: "s3",
                  renderType: "asset",
                  purpose: "logo",
                },
              ],
            },
          },
        ],
      };

      const result = handler.buildVisualSlots(brainstormResult, [], null, true);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        slotId: "s1",
        renderType: "svg",
        svgSpec: { type: "chart", description: "chart prompt" },
      });
      expect(result[1]).toMatchObject({
        slotId: "s2",
        renderType: "svg",
        svgSpec: { type: "diagram", description: "hint prompt" },
      });
      expect(result[2]).toMatchObject({
        slotId: "s3",
        renderType: "asset",
      });
    });

    it("maps imageSlots when no selected candidates and provider is whitespace", () => {
      mockedShared.normalizeRenderType.mockImplementation((value) => value);
      const handler = new VisualHandler();
      const imageSlots = [
        {
          slotId: "a",
          slideIntentId: "intent-1",
          slideIndex: 0,
          renderType: "asset",
          priority: 0,
          aspectRatio: "16:9",
          purpose: "logo",
          promptHint: "logo prompt",
          style: "flat",
          effects: { blur: 0 },
          assetId: "asset-1",
        },
      ];

      const result = handler.buildVisualSlots({}, imageSlots, "   ", false);

      expect(result).toEqual([
        {
          slotId: "a",
          slideIntentId: "intent-1",
          slideIndex: 0,
          renderType: "asset",
          priority: 0,
          aspectRatio: "16:9",
          purpose: "logo",
          imageSpec: { prompt: "logo prompt", style: "flat" },
          effects: { blur: 0 },
          assetSpec: { assetId: "asset-1" },
        },
      ]);
    });

    it("throws when imageSlots is not an array", () => {
      const handler = new VisualHandler();
      expect(() =>
        handler.buildVisualSlots({ candidatesBySlide: [] }, { not: "array" }, "provider", true)
      ).toThrow();
    });
  });

  describe("renderVisuals", () => {
    it("returns defaults when no slots are provided", async () => {
      const handler = new VisualHandler();
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);

      const slideHtmls = ["", "slide"];
      const imageSlots = [];
      const aiImageSlotIds = ["slot-1"];

      const result = await handler.renderVisuals(
        [],
        {},
        {},
        slideHtmls,
        makeContext(),
        makeRunContext(),
        {},
        imageSlots,
        aiImageSlotIds
      );

      expect(result).toEqual({
        visualReport: null,
        imageReport: null,
        finalImageSlots: imageSlots,
        deckHtmlDsl: slideHtmls.join("\n\n"),
        pendingImages: aiImageSlotIds,
      });
      expect(result.pendingImages).not.toBe(aiImageSlotIds);
      expect(mockedVisualAgent.instances).toHaveLength(0);
      expect(emit).not.toHaveBeenCalled();
    });

    it("fills image/svg/asset placeholders and emits reports", async () => {
      mockedShared.normalizeRenderType.mockImplementation((value) => value);
      const handler = new VisualHandler({ imageConcurrency: 2 });
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);

      const longHtml = "H".repeat(50000);
      const slideHtmls = [longHtml, "Slide B"];
      const deepSlot = {
        slotId: "img-1",
        renderType: "ai-image",
        slideIndex: 0,
        nested: { deep: { levels: [{ value: "x" }] } },
      };
      const visualSlotsForRender = [
        deepSlot,
        { slotId: "svg-1", renderType: "svg", slideIndex: "1", promptHint: "diagram" },
        { slotId: "asset-1", renderType: "asset", slideIndex: Number.MAX_SAFE_INTEGER },
      ];
      const imageSlots = [
        { slotId: "img-1", original: true },
        { slotId: "img-2", original: true },
      ];
      const aiImageSlotIds = ["img-1", "img-2"];

      const runResult = {
        report: {
          errors: [{ renderer: "svg", error: "warn" }],
          hasFatalError: false,
          svgReport: { ok: true },
        },
        imageResults: {
          filledSlots: [{ slotId: "img-1", url: "img-url" }],
          report: { kind: "image-report" },
        },
        svgResults: [{ slotId: "svg-1", svg: "<svg />" }],
        assetResults: [{ slotId: "asset-1", url: "asset-url" }],
      };

      mockedVisualAgent.runImpl.mockResolvedValueOnce(runResult);
      mockedVisualAgent.transitionLogImpl.mockReturnValueOnce(["log-1"]);

      const context = makeContext({
        assets: [{ id: "asset-1", url: "asset-url" }],
        modelRouter: "router-x",
      });
      const runContext = makeRunContext({ runId: "run-2" });
      const constraints = { imagePolicy: "balanced", imageBudget: { max: 2 } };

      const result = await handler.renderVisuals(
        visualSlotsForRender,
        { assets: [{ id: "asset-1", url: "asset-url" }] },
        { theme: "t" },
        slideHtmls,
        context,
        runContext,
        constraints,
        imageSlots,
        aiImageSlotIds
      );

      const baseDeck = slideHtmls.join("\n\n");
      expect(mockedImageGenerator.fillImagePlaceholders).toHaveBeenCalledWith(
        baseDeck,
        runResult.imageResults.filledSlots
      );
      expect(mockedSvgGenerator.fillSvgPlaceholders).toHaveBeenCalledWith(
        `${baseDeck}::images`,
        runResult.svgResults
      );
      expect(mockedAssetResolver.fillAssetPlaceholders).toHaveBeenCalledWith(
        `${baseDeck}::images::svg`,
        runResult.assetResults
      );

      expect(result.deckHtmlDsl).toBe(`${baseDeck}::images::svg::asset`);
      expect(result.pendingImages).toEqual(["img-2"]);
      expect(result.finalImageSlots[0]).toEqual(runResult.imageResults.filledSlots[0]);
      expect(result.finalImageSlots[1]).toEqual(imageSlots[1]);
      expect(result.imageReport).toEqual(runResult.imageResults.report);
      expect(result.visualReport.errors).toEqual(runResult.report.errors);
      expect(handler.lastTransitionLog).toEqual(["log-1"]);

      const subAgent = mockedVisualAgent.instances[0];
      expect(subAgent.config.assetRegistry.getAsset("asset-1")).toEqual(context.assets[0]);
      expect(mockedSvgGenerator.instances).toHaveLength(1);
      expect(subAgent.config.svgGenerator).toBe(mockedSvgGenerator.instances[0]);

      const runArgs = mockedVisualAgent.runImpl.mock.calls[0];
      const options = runArgs[3];
      expect(options.slideHtmlBySlotId.get("img-1")).toBe(longHtml);
      expect(options.slideHtmlBySlotId.has("svg-1")).toBe(false);
      expect(options.slideHtmlBySlotId.has("asset-1")).toBe(false);
      expect(runArgs[0][0].nested).toEqual(deepSlot.nested);

      expect(emit).toHaveBeenCalledWith(
        "design.visual.render.started",
        expect.objectContaining({
          actor: "design",
          status: "started",
          payload: expect.objectContaining({
            runId: "run-2",
            planned: { total: 3, "ai-image": 1, svg: 1, asset: 1 },
          }),
        })
      );
      expect(emit).toHaveBeenCalledWith(
        "design.visual.errors",
        expect.objectContaining({
          actor: "design",
          status: "warn",
          payload: expect.objectContaining({ hasFatalError: false }),
        })
      );
      expect(emit).toHaveBeenCalledWith(
        "design.visual.render.completed",
        expect.objectContaining({
          actor: "design",
          status: "completed",
          payload: expect.objectContaining({ pendingImages: ["img-2"] }),
        })
      );
    });

    it("builds failure reports when sub-agent throws", async () => {
      mockedShared.normalizeRenderType.mockImplementation((value) => value);
      mockedVisualAgent.runImpl.mockRejectedValueOnce(new Error("boom"));
      const handler = new VisualHandler();
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);

      const visualSlotsForRender = [
        { slotId: "v1", renderType: "svg", slideIndex: 0 },
        { slotId: "v2", renderType: "asset", slideIndex: -1 },
      ];
      const imageSlots = [{ slotId: "img1" }, { slotId: "img2" }];
      const aiImageSlotIds = ["img1"];
      const slideHtmls = ["slide-1"];
      const constraints = { imagePolicy: "", imageBudget: null };

      const result = await handler.renderVisuals(
        visualSlotsForRender,
        {},
        {},
        slideHtmls,
        makeContext({ signal: "sig" }),
        makeRunContext({ runId: "run-err" }),
        constraints,
        imageSlots,
        aiImageSlotIds
      );

      expect(mockedRuntime.checkCancelled).toHaveBeenCalledWith("sig");
      expect(result.imageReport.error).toBe("boom");
      expect(result.imageReport.summary.failed).toBe(imageSlots.length);
      expect(result.imageReport.policy).toBe("balanced");
      expect(result.visualReport.hasFatalError).toBe(true);
      expect(result.visualReport.planned).toEqual({
        total: 2,
        "ai-image": 0,
        svg: 1,
        asset: 1,
      });
      expect(result.pendingImages).toEqual(aiImageSlotIds);
      expect(result.deckHtmlDsl).toBe(slideHtmls.join("\n\n"));
      expect(mockedImageGenerator.fillImagePlaceholders).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        "design.visual.errors",
        expect.objectContaining({
          actor: "design",
          status: "warn",
          payload: expect.objectContaining({ hasFatalError: true }),
        })
      );
      expect(emit).toHaveBeenCalledWith(
        "design.visual.render.failed",
        expect.objectContaining({
          actor: "design",
          status: "failed",
          payload: expect.objectContaining({ error: "boom" }),
        })
      );
    });

    it("supports concurrent renderVisuals calls", async () => {
      mockedShared.normalizeRenderType.mockImplementation((value) => value);
      const handler = new VisualHandler();
      const emit = vi.fn();
      mockedRuntime.getEmitFn.mockReturnValue(emit);

      const d1 = deferred();
      const d2 = deferred();

      const res1 = {
        report: { errors: [] },
        imageResults: {
          filledSlots: [{ slotId: "a", url: "a" }],
          report: { id: "r1" },
        },
      };
      const res2 = {
        report: { errors: [] },
        imageResults: {
          filledSlots: [],
          report: { id: "r2" },
        },
      };

      mockedVisualAgent.runImpl.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise);

      const p1 = handler.renderVisuals(
        [{ slotId: "a", renderType: "ai-image", slideIndex: 0 }],
        {},
        {},
        ["slide-a"],
        makeContext(),
        makeRunContext({ runId: "run-a" }),
        {},
        [{ slotId: "a" }],
        ["a"]
      );
      const p2 = handler.renderVisuals(
        [{ slotId: "b", renderType: "ai-image", slideIndex: 0 }],
        {},
        {},
        ["slide-b"],
        makeContext(),
        makeRunContext({ runId: "run-b" }),
        {},
        [{ slotId: "b" }],
        ["b"]
      );

      d2.resolve(res2);
      d1.resolve(res1);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockedVisualAgent.instances).toHaveLength(2);
      expect(mockedRuntime.getEmitFn).toHaveBeenCalledTimes(2);
      expect(r1.pendingImages).toEqual([]);
      expect(r2.pendingImages).toEqual(["b"]);
      expect(r1.imageReport).toEqual(res1.imageResults.report);
      expect(r2.imageReport).toEqual(res2.imageResults.report);
      expect(r1.finalImageSlots[0]).toEqual(res1.imageResults.filledSlots[0]);
      expect(r2.finalImageSlots[0]).toEqual({ slotId: "b" });
    });
  });
});

describe("createVisualHandler", () => {
  it("creates a VisualHandler with options", () => {
    const handler = createVisualHandler({ imageConcurrency: 7 });
    expect(handler).toBeInstanceOf(VisualHandler);
    expect(handler.imageConcurrency).toBe(7);
  });
});
