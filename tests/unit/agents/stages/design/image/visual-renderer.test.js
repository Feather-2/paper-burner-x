import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedGenerators = vi.hoisted(() => {
  const imageInstances = [];
  class ImageGenerator {
    constructor(opts = {}) {
      this.opts = opts;
      this.generate = vi.fn(async () => ({ filledSlots: [], report: null }));
      imageInstances.push(this);
    }
  }

  const svgInstances = [];
  class SVGGenerator {
    constructor(opts = {}) {
      this.opts = opts;
      this.generate = vi.fn(async () => ({ results: [], report: null }));
      svgInstances.push(this);
    }
  }

  return { imageInstances, svgInstances, ImageGenerator, SVGGenerator };
});

const mockedAssetResolver = vi.hoisted(() => {
  const instances = [];
  class AssetResolver {
    constructor(assets) {
      this.assets = assets;
      this.resolve = vi.fn(() => []);
      instances.push(this);
    }
  }
  return { AssetResolver, instances };
});

const mockedConstants = vi.hoisted(() => ({
  RenderType: { AI_IMAGE: "ai-image", SVG: "svg", ASSET: "asset" },
  EventStatus: { STARTED: "started", COMPLETED: "completed", FAILED: "failed" },
  SlotPriority: { CRITICAL: "critical", IMPORTANT: "important", OPTIONAL: "optional" },
  SlotPurpose: { HERO: "hero", ICON: "icon", BACKGROUND: "background", CHART_FALLBACK: "chart_fallback", ILLUSTRATION: "illustration" },
  VisualHeuristics: { ASPECT_RATIO_16_9: 1.55, ASPECT_RATIO_4_3: 1.15 },
}));

const mockedRuntime = vi.hoisted(() => ({
  DesignEvents: {
    VISUAL_RENDER_STARTED: "design.visual.render.started",
    VISUAL_RENDER_COMPLETED: "design.visual.render.completed",
    VISUAL_RENDER_FAILED: "design.visual.render.failed",
  },
}));

const mockedShared = vi.hoisted(() => ({
  makeSecureTimestampedId: vi.fn(() => "run-mocked"),
}));

const mockedSafeEmit = vi.hoisted(() => ({
  safeEmit: vi.fn((emit, name, status, payload) => {
    if (typeof emit === "function") emit(name, { actor: "design", status, payload });
  }),
}));

vi.mock("../../../../../../js/agents/stages/design/generators/image-generator.js", () => ({
  ImageGenerator: mockedGenerators.ImageGenerator,
}));

vi.mock("../../../../../../js/agents/stages/design/generators/svg-generator.js", () => ({
  SVGGenerator: mockedGenerators.SVGGenerator,
}));

vi.mock("../../../../../../js/agents/stages/design/image/asset-resolver.js", () => ({
  AssetResolver: mockedAssetResolver.AssetResolver,
}));

vi.mock("../../../../../../js/agents/stages/design/constants.js", () => mockedConstants);

vi.mock("../../../../../../js/agents/runtime/index.js", () => mockedRuntime);

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return { ...actual, makeSecureTimestampedId: mockedShared.makeSecureTimestampedId };
});

vi.mock("../../../../../../js/agents/stages/design/shared/safe-emit.js", () => ({
  safeEmit: mockedSafeEmit.safeEmit,
}));

async function loadVisualRenderer() {
  return await import("../../../../../../js/agents/stages/design/image/visual-renderer.js");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("VisualRenderer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockedGenerators.imageInstances.length = 0;
    mockedGenerators.svgInstances.length = 0;
    mockedAssetResolver.instances.length = 0;
    mockedShared.makeSecureTimestampedId.mockReset().mockReturnValue("run-mocked");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses provided generator and resolver instances in constructor", async () => {
    const { VisualRenderer } = await loadVisualRenderer();

    const imageGenerator = { generate: vi.fn() };
    const svgGenerator = { generate: vi.fn() };
    const assetResolver = { resolve: vi.fn() };

    const renderer = new VisualRenderer({
      imageGenerator,
      svgGenerator,
      assetResolver,
      imageProvider: { id: "provider-1" },
      assets: [{ assetId: "asset-1" }],
    });

    expect(renderer.imageGenerator).toBe(imageGenerator);
    expect(renderer.svgGenerator).toBe(svgGenerator);
    expect(renderer.assetResolver).toBe(assetResolver);
    expect(mockedGenerators.imageInstances).toHaveLength(0);
    expect(mockedAssetResolver.instances).toHaveLength(0);
  });

  it("constructs ImageGenerator and AssetResolver when only provider/assets are given", async () => {
    const { VisualRenderer } = await loadVisualRenderer();

    const imageProvider = { id: "provider-2" };
    const assets = [{ assetId: "asset-2" }];

    const renderer = new VisualRenderer({ imageProvider, assets });

    expect(mockedGenerators.imageInstances).toHaveLength(1);
    expect(mockedGenerators.imageInstances[0].opts).toEqual({ imageProvider });
    expect(renderer.imageGenerator).toBe(mockedGenerators.imageInstances[0]);

    expect(mockedAssetResolver.instances).toHaveLength(1);
    expect(mockedAssetResolver.instances[0].assets).toBe(assets);
    expect(renderer.assetResolver).toBe(mockedAssetResolver.instances[0]);
    expect(renderer.svgGenerator).toBe(null);
  });

  it("renders mixed slot types, merges filled slots, and emits events", async () => {
    const { VisualRenderer } = await loadVisualRenderer();

    const imageGenerator = {
      generate: vi.fn(async () => ({
        filledSlots: [{ slotId: "hero-slot", filled: true }],
        report: { summary: "ok" },
      })),
    };
    const svgGenerator = {
      generate: vi.fn(async () => ({ results: [{ slotId: "icon-slot", svg: "<svg/>" }], report: { ok: true } })),
    };
    const assetResolver = {
      resolve: vi.fn(() => [{ slotId: "asset-slot", assetUri: "asset://1", width: 100, height: 200 }]),
    };

    const renderer = new VisualRenderer({ imageGenerator, svgGenerator, assetResolver });

    const longText = "x".repeat(12000);
    const bigData = "b".repeat(200000);
    const deepEffects = { fade: true, nested: { layer: { depth: 1 } } };

    const visualSlots = [
      {
        slotId: "hero-slot",
        renderType: "image",
        position: { w: "90%", h: "50%" },
        imageSpec: { prompt: "Hero prompt", style: "photo" },
        priority: "CRITICAL",
        slideIndex: 1,
        slideIntentId: "",
        claimIds: [1, "c2", "", null],
        effects: deepEffects,
      },
      {
        slotId: "bg-slot",
        renderType: "ai-image",
        description: longText,
        priority: "unknown",
        position: { w: "80%", h: "90%" },
        slideIndex: "2",
        style: " ",
      },
      { slotId: "icon-slot", renderType: "svg", svgSpec: { description: "icon" } },
      { slotId: "asset-slot", renderType: "asset", assetSpec: { assetId: "asset-1" }, data: bigData },
    ];

    const contentPackage = { runId: "pkg-run", constraints: { imageBudget: { maxImages: 9 } } };
    const designSystem = { theme: "test" };
    const emit = vi.fn();

    const result = await renderer.render(visualSlots, contentPackage, designSystem, {
      emit,
      runId: "run-override",
      policy: "strict",
      budget: { maxImages: 2 },
      concurrency: "3",
      imageProvider: { id: "provider-3" },
    });

    expect(imageGenerator.generate).toHaveBeenCalledTimes(1);
    const [imageSlots, cpArg, dsArg, imageOpts] = imageGenerator.generate.mock.calls[0];
    expect(cpArg).toBe(contentPackage);
    expect(dsArg).toBe(designSystem);
    expect(imageOpts.runId).toBe("run-override");
    expect(imageOpts.policy).toBe("strict");
    expect(imageOpts.budget).toEqual({ maxImages: 2 });
    expect(imageOpts.concurrency).toBe(3);
    expect(imageOpts.imageProvider).toEqual({ id: "provider-3" });
    expect(imageSlots).toHaveLength(2);

    const heroSlot = imageSlots.find((slot) => slot.slotId === "hero-slot");
    const bgSlot = imageSlots.find((slot) => slot.slotId === "bg-slot");

    expect(heroSlot).toMatchObject({
      slotId: "hero-slot",
      slideIndex: 1,
      slideIntentId: "s1",
      purpose: mockedConstants.SlotPurpose.HERO,
      promptHint: "Hero prompt",
      style: "photo",
      priority: mockedConstants.SlotPriority.CRITICAL,
      aspectRatio: "16:9",
      renderType: mockedConstants.RenderType.AI_IMAGE,
    });
    expect(heroSlot.claimIds).toEqual(["1", "c2", "null"]);
    expect(heroSlot.effects).toEqual(deepEffects);
    expect(heroSlot.effects).not.toBe(deepEffects);

    expect(bgSlot).toMatchObject({
      slotId: "bg-slot",
      slideIndex: 0,
      slideIntentId: "s0",
      purpose: mockedConstants.SlotPurpose.BACKGROUND,
      promptHint: longText,
      style: "illustration",
      priority: mockedConstants.SlotPriority.IMPORTANT,
      aspectRatio: "3:4",
      renderType: mockedConstants.RenderType.AI_IMAGE,
    });
    expect(bgSlot.claimIds).toBeUndefined();

    expect(svgGenerator.generate).toHaveBeenCalledTimes(1);
    const [svgSlots, svgDesignSystem, svgOpts] = svgGenerator.generate.mock.calls[0];
    expect(svgSlots).toHaveLength(1);
    expect(svgSlots[0].slotId).toBe("icon-slot");
    expect(svgDesignSystem).toBe(designSystem);
    expect(svgOpts.concurrency).toBe("3");

    expect(assetResolver.resolve).toHaveBeenCalledTimes(1);
    const assetSlots = assetResolver.resolve.mock.calls[0][0];
    expect(assetSlots).toHaveLength(1);
    expect(assetSlots[0].slotId).toBe("asset-slot");
    expect(assetSlots[0].data.length).toBe(bigData.length);

    const startedCall = mockedSafeEmit.safeEmit.mock.calls.find(
      (call) => call[1] === mockedRuntime.DesignEvents.VISUAL_RENDER_STARTED
    );
    const completedCall = mockedSafeEmit.safeEmit.mock.calls.find(
      (call) => call[1] === mockedRuntime.DesignEvents.VISUAL_RENDER_COMPLETED
    );
    expect(startedCall?.[0]).toBe(emit);
    expect(startedCall?.[2]).toBe(mockedConstants.EventStatus.STARTED);
    expect(startedCall?.[3]).toMatchObject({ runId: "run-override" });
    expect(completedCall?.[2]).toBe(mockedConstants.EventStatus.COMPLETED);
    expect(completedCall?.[3]).toMatchObject({ runId: "run-override" });

    expect(result.report.runId).toBe("run-override");
    expect(result.report.completed["ai-image"]).toBe(1);
    expect(result.report.completed.svg).toBe(1);
    expect(result.report.completed.asset).toBe(1);
    expect(result.report.imageReport).toEqual({ summary: "ok" });
    expect(result.report.svgReport).toEqual({ ok: true });
    expect(result.report.durationMs).toBeGreaterThanOrEqual(0);

    expect(result.mergedSlots).toHaveLength(visualSlots.length);
    expect(result.mergedSlots[0]).toBe(result.imageResults.filledSlots[0]);
    expect(result.mergedSlots[1]).toBe(visualSlots[1]);
  });

  it("tolerates empty values and type mismatches", async () => {
    const { VisualRenderer } = await loadVisualRenderer();

    const imageGenerator = { generate: vi.fn(async () => ({ filledSlots: [], report: null })) };
    const svgGenerator = { generate: vi.fn(async () => ({ results: [], report: null })) };
    const assetResolver = { resolve: vi.fn(() => []) };
    const renderer = new VisualRenderer({ imageGenerator, svgGenerator, assetResolver });

    mockedShared.makeSecureTimestampedId.mockReturnValue("run-empty");

    const visualSlots = [null, undefined, "", [], {}, { slotId: "   ", renderType: "unknown" }];
    const result = await renderer.render(visualSlots, null, null, { runId: "   ", assets: {} });

    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(svgGenerator.generate).not.toHaveBeenCalled();
    expect(assetResolver.resolve).not.toHaveBeenCalled();
    expect(result.report.runId).toBe("run-empty");
    expect(result.report.completed["ai-image"]).toBe(0);
    expect(result.report.completed.svg).toBe(0);
    expect(result.report.completed.asset).toBe(0);
    expect(result.mergedSlots).toHaveLength(visualSlots.length);

    const result2 = await renderer.render({ not: "array" }, {}, {}, {});
    expect(result2.report.planned.total).toBe(0);
  });

  it("records generator errors and emits failed event", async () => {
    const { VisualRenderer } = await loadVisualRenderer();

    const imageGenerator = { generate: vi.fn(async () => Promise.reject(new Error("boom"))) };
    const renderer = new VisualRenderer({ imageGenerator });

    const emit = vi.fn();
    const result = await renderer.render([{ slotId: "s1", renderType: "ai-image" }], {}, {}, { runId: "run-err", emit });

    expect(result.imageResults.filledSlots).toEqual([]);
    expect(result.report.errors).toHaveLength(1);
    expect(result.report.errors[0]).toMatchObject({ renderer: "ai-image" });
    expect(result.report.errors[0].error).toContain("Error: boom");

    const failedCall = mockedSafeEmit.safeEmit.mock.calls.find(
      (call) => call[1] === mockedRuntime.DesignEvents.VISUAL_RENDER_FAILED
    );
    expect(failedCall?.[0]).toBe(emit);
    expect(failedCall?.[2]).toBe(mockedConstants.EventStatus.FAILED);
    expect(failedCall?.[3]).toMatchObject({ runId: "run-err" });
  });

  it("aborts and records timeout when image generation exceeds timeout", async () => {
    const { VisualRenderer } = await loadVisualRenderer();

    vi.useFakeTimers();

    const imageGenerator = { generate: vi.fn(() => new Promise(() => {})) };
    const renderer = new VisualRenderer({ imageGenerator });

    const renderPromise = renderer.render([{ slotId: "s1", renderType: "ai-image" }], {}, {}, { runId: "run-timeout", imageTimeoutMs: 50 });

    await vi.advanceTimersByTimeAsync(60);
    const result = await renderPromise;

    const optionsArg = imageGenerator.generate.mock.calls[0][3];
    expect(optionsArg.timeoutMs).toBe(50);
    expect(optionsArg.signal).toBeDefined();
    expect(optionsArg.signal.aborted).toBe(true);

    expect(result.report.errors).toHaveLength(1);
    expect(result.report.errors[0].renderer).toBe("ai-image");
    expect(result.report.errors[0].error).toContain("Timed out after 50ms");

    const failedCall = mockedSafeEmit.safeEmit.mock.calls.find(
      (call) => call[1] === mockedRuntime.DesignEvents.VISUAL_RENDER_FAILED
    );
    expect(failedCall).toBeTruthy();
  });

  it("supports concurrent renders without cross-talk", async () => {
    const { VisualRenderer } = await loadVisualRenderer();

    const first = deferred();
    const second = deferred();
    const imageGenerator = {
      generate: vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise),
    };
    const renderer = new VisualRenderer({ imageGenerator });

    const callA = renderer.render([{ slotId: "slot-a", renderType: "ai-image" }], {}, {}, { runId: "run-a" });
    const callB = renderer.render([{ slotId: "slot-b", renderType: "ai-image" }], {}, {}, { runId: "run-b" });

    second.resolve({ filledSlots: [{ slotId: "slot-b", filled: true }], report: null });
    first.resolve({ filledSlots: [{ slotId: "slot-a", filled: true }], report: null });

    const [resultA, resultB] = await Promise.all([callA, callB]);

    expect(resultA.report.runId).toBe("run-a");
    expect(resultB.report.runId).toBe("run-b");
    expect(resultA.mergedSlots[0].slotId).toBe("slot-a");
    expect(resultB.mergedSlots[0].slotId).toBe("slot-b");
    expect(imageGenerator.generate).toHaveBeenCalledTimes(2);

    const completedRunIds = mockedSafeEmit.safeEmit.mock.calls
      .filter((call) => call[1] === mockedRuntime.DesignEvents.VISUAL_RENDER_COMPLETED)
      .map((call) => call[3]?.runId)
      .sort();
    expect(completedRunIds).toEqual(["run-a", "run-b"]);
  });

  it("normalizes concurrency bounds and ignores invalid timeout values", async () => {
    const { VisualRenderer } = await loadVisualRenderer();

    const imageGenerator = { generate: vi.fn(async () => ({ filledSlots: [], report: null })) };
    const renderer = new VisualRenderer({ imageGenerator });
    const slot = { slotId: "slot-1", renderType: "ai-image" };

    await renderer.render([slot], {}, {}, { concurrency: 0, runId: "r0" });
    await renderer.render([slot], {}, {}, { concurrency: -1, runId: "r1" });
    await renderer.render([slot], {}, {}, { concurrency: Number.MAX_SAFE_INTEGER, runId: "r2" });
    await renderer.render([slot], {}, {}, { concurrency: "5", runId: "r3", imageTimeoutMs: 0, timeoutMs: -1 });

    const calls = imageGenerator.generate.mock.calls;
    expect(calls[0][3].concurrency).toBe(1);
    expect(calls[1][3].concurrency).toBe(1);
    expect(calls[2][3].concurrency).toBe(Number.MAX_SAFE_INTEGER);
    expect(calls[3][3].concurrency).toBe(5);
    expect(calls[3][3].timeoutMs).toBeUndefined();
  });
});
