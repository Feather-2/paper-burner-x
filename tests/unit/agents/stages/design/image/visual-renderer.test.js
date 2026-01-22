import { describe, it, expect, vi, beforeEach } from "vitest";

const generatorMocks = vi.hoisted(() => {
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

const assetResolverMocks = vi.hoisted(() => {
  const instances = [];
  class AssetResolver {
    constructor(assets) {
      this.assets = assets;
      this.resolve = vi.fn(() => []);
      instances.push(this);
    }
  }
  return { instances, AssetResolver };
});

const sharedMocks = vi.hoisted(() => ({
  makeSecureTimestampedId: vi.fn(() => "run-mocked"),
}));

vi.mock("../../../../../../js/agents/stages/design/generators/image-generator.js", () => ({
  ImageGenerator: generatorMocks.ImageGenerator,
}));

vi.mock("../../../../../../js/agents/stages/design/generators/svg-generator.js", () => ({
  SVGGenerator: generatorMocks.SVGGenerator,
}));

vi.mock("../../../../../../js/agents/stages/design/image/asset-resolver.js", () => ({
  AssetResolver: assetResolverMocks.AssetResolver,
}));

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return { ...actual, makeSecureTimestampedId: sharedMocks.makeSecureTimestampedId };
});

import {
  EventStatus,
  RenderType,
  SlotPriority,
  SlotPurpose,
} from "../../../../../../js/agents/stages/design/constants.js";
import { DesignEvents } from "../../../../../../js/agents/runtime/index.js";
import { VisualRenderer } from "../../../../../../js/agents/stages/design/image/visual-renderer.js";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();

  generatorMocks.imageInstances.length = 0;
  generatorMocks.svgInstances.length = 0;
  assetResolverMocks.instances.length = 0;

  sharedMocks.makeSecureTimestampedId.mockReset().mockReturnValue("run-mocked");
});

function deferred() {
  /** @type {(v: any) => void} */
  let resolve;
  /** @type {(e: any) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("VisualRenderer", () => {
  it("constructor uses provided generator/resolver instances and does not instantiate defaults", () => {
    const imageGenerator = { generate: vi.fn() };
    const svgGenerator = { generate: vi.fn() };
    const assetResolver = { resolve: vi.fn() };

    const renderer = new VisualRenderer({
      imageGenerator,
      svgGenerator,
      assetResolver,
      imageProvider: { id: "provider-ignored" },
      assets: [{ assetId: "asset-ignored" }],
    });

    expect(renderer.imageGenerator).toBe(imageGenerator);
    expect(renderer.svgGenerator).toBe(svgGenerator);
    expect(renderer.assetResolver).toBe(assetResolver);

    expect(generatorMocks.imageInstances).toHaveLength(0);
    expect(assetResolverMocks.instances).toHaveLength(0);
  });

  it("constructor constructs ImageGenerator and AssetResolver from provider/assets when instances are not provided", () => {
    const imageProvider = { id: "provider-1" };
    const assets = [{ assetId: "asset-1" }];

    const renderer = new VisualRenderer({ imageProvider, assets });

    expect(generatorMocks.imageInstances).toHaveLength(1);
    expect(generatorMocks.imageInstances[0].opts).toEqual({ imageProvider });
    expect(renderer.imageGenerator).toBe(generatorMocks.imageInstances[0]);

    expect(assetResolverMocks.instances).toHaveLength(1);
    expect(assetResolverMocks.instances[0].assets).toBe(assets);
    expect(renderer.assetResolver).toBe(assetResolverMocks.instances[0]);

    expect(renderer.svgGenerator).toBe(null);
  });

  it("constructor throws on invalid options (non-object)", () => {
    expect(() => new VisualRenderer(null)).toThrow();
  });

  it("render() handles mixed slot types, emits started/completed, and merges filled image slots", async () => {
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockImplementationOnce(() => 1_000)
      .mockImplementationOnce(() => 1_500)
      .mockImplementation(() => 1_500);

    const imageGenerator = {
      generate: vi.fn(async () => ({
        filledSlots: [{ slotId: "hero-slot", filled: true }],
        report: { summary: "ok" },
      })),
    };
    const svgGenerator = {
      generate: vi.fn(async () => ({
        results: [{ slotId: "icon-slot", svg: "<svg/>" }],
        report: { ok: true },
      })),
    };
    const assetResolver = {
      resolve: vi.fn(async () => [{ slotId: "asset-slot", assetUri: "asset://1", width: 100, height: 200 }]),
    };

    const renderer = new VisualRenderer({ imageGenerator, svgGenerator, assetResolver });

    const longText = "x".repeat(20_000);
    const bigData = "b".repeat(200_000);
    const deepEffects = { fade: true, nested: { layer: { depth: 1 } } };

    /** @type {any[]} */
    const visualSlots = [
      {
        slotId: "hero-slot",
        renderType: "image",
        position: { w: "90%", h: "50%" },
        imageSpec: { prompt: "Hero prompt", style: "photo" },
        priority: "CRITICAL",
        slideIndex: 1,
        slideIntentId: "   ",
        claimIds: [1, "c2", "", null, 0],
        effects: deepEffects,
      },
      {
        slotId: "square-slot",
        renderType: "AI_IMAGE",
        position: { w: "100%", h: "100%" },
        promptHint: "Square prompt",
        priority: SlotPriority.OPTIONAL,
        slideIndex: Number.MAX_SAFE_INTEGER,
        style: "illustration",
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
      { slotId: "icon-slot", renderType: "SVG", svgSpec: { description: "icon" } },
      { slotId: "asset-slot", renderType: "asset", assetSpec: { assetId: "asset-1" }, data: bigData },
    ];

    const contentPackage = {
      runId: "pkg-run",
      constraints: { imageBudget: { maxImages: 9 }, imagePolicy: "policy-from-package" },
      assets: [{ assetId: "a-from-package" }],
    };
    const designSystem = { theme: "test" };
    const emit = vi.fn();

    const result = await renderer.render(visualSlots, contentPackage, designSystem, {
      emit,
      runId: "run-override",
      policy: "policy-override",
      budget: { maxImages: 2 },
      concurrency: "3",
      imageProvider: { id: "provider-2" },
    });

    expect(imageGenerator.generate).toHaveBeenCalledTimes(1);
    const [imageSlots, cpArg, dsArg, imageOpts] = imageGenerator.generate.mock.calls[0];
    expect(cpArg).toBe(contentPackage);
    expect(dsArg).toBe(designSystem);
    expect(imageOpts).toMatchObject({
      emit,
      runId: "run-override",
      policy: "policy-override",
      budget: { maxImages: 2 },
      concurrency: 3,
      imageProvider: { id: "provider-2" },
    });

    expect(imageSlots).toHaveLength(3);
    const heroSlot = imageSlots.find((slot) => slot.slotId === "hero-slot");
    const squareSlot = imageSlots.find((slot) => slot.slotId === "square-slot");
    const bgSlot = imageSlots.find((slot) => slot.slotId === "bg-slot");

    expect(heroSlot).toMatchObject({
      slotId: "hero-slot",
      slideIndex: 1,
      slideIntentId: "s1",
      purpose: SlotPurpose.HERO,
      promptHint: "Hero prompt",
      style: "photo",
      priority: SlotPriority.CRITICAL,
      aspectRatio: "16:9",
      renderType: RenderType.AI_IMAGE,
    });
    expect(heroSlot.claimIds).toEqual(["1", "c2", "null", "0"]);
    expect(heroSlot.effects).toEqual(deepEffects);
    expect(heroSlot.effects).not.toBe(deepEffects);

    expect(squareSlot).toMatchObject({
      slotId: "square-slot",
      slideIndex: Number.MAX_SAFE_INTEGER,
      slideIntentId: `s${Number.MAX_SAFE_INTEGER}`,
      purpose: SlotPurpose.ILLUSTRATION,
      promptHint: "Square prompt",
      style: "illustration",
      priority: SlotPriority.OPTIONAL,
      aspectRatio: "1:1",
      renderType: RenderType.AI_IMAGE,
    });

    expect(bgSlot).toMatchObject({
      slotId: "bg-slot",
      slideIndex: 0,
      slideIntentId: "s0",
      purpose: SlotPurpose.BACKGROUND,
      promptHint: longText,
      style: "illustration",
      priority: SlotPriority.IMPORTANT,
      aspectRatio: "3:4",
      renderType: RenderType.AI_IMAGE,
    });

    expect(svgGenerator.generate).toHaveBeenCalledTimes(1);
    const [svgSlots, svgDesignSystem, svgOpts] = svgGenerator.generate.mock.calls[0];
    expect(svgSlots).toHaveLength(1);
    expect(svgSlots[0]).toMatchObject({ slotId: "icon-slot", renderType: RenderType.SVG });
    expect(svgDesignSystem).toBe(designSystem);
    expect(svgOpts).toMatchObject({ emit, concurrency: "3" });

    expect(assetResolver.resolve).toHaveBeenCalledTimes(1);
    const assetSlots = assetResolver.resolve.mock.calls[0][0];
    expect(assetSlots).toHaveLength(1);
    expect(assetSlots[0]).toMatchObject({ slotId: "asset-slot", renderType: RenderType.ASSET });
    expect(assetSlots[0].data.length).toBe(bigData.length);

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0]).toBe(DesignEvents.VISUAL_RENDER_STARTED);
    expect(emit.mock.calls[0][1]).toMatchObject({
      actor: "design",
      status: EventStatus.STARTED,
      payload: { runId: "run-override" },
    });
    expect(emit.mock.calls[1][0]).toBe(DesignEvents.VISUAL_RENDER_COMPLETED);
    expect(emit.mock.calls[1][1]).toMatchObject({
      actor: "design",
      status: EventStatus.COMPLETED,
      payload: { runId: "run-override" },
    });

    expect(result.report).toMatchObject({
      schemaVersion: "0.1",
      runId: "run-override",
      planned: { total: 5, "ai-image": 3, svg: 1, asset: 1 },
      completed: { "ai-image": 1, svg: 1, asset: 1 },
      durationMs: 500,
      errors: [],
      imageReport: { summary: "ok" },
      svgReport: { ok: true },
    });

    expect(result.mergedSlots).toHaveLength(visualSlots.length);
    expect(result.mergedSlots[0]).toBe(result.imageResults.filledSlots[0]);
    expect(result.mergedSlots[1]).toBe(visualSlots[1]);
    expect(result.mergedSlots[2]).toBe(visualSlots[2]);

    nowSpy.mockRestore();
  });

  it("render() tolerates empty values and type mismatches (null/undefined/empty/whitespace/object-as-array)", async () => {
    const imageGenerator = { generate: vi.fn(async () => ({ filledSlots: [], report: null })) };
    const svgGenerator = { generate: vi.fn(async () => ({ results: [], report: null })) };
    const assetResolver = { resolve: vi.fn(() => []) };

    const renderer = new VisualRenderer({ imageGenerator, svgGenerator, assetResolver });

    sharedMocks.makeSecureTimestampedId.mockReturnValue("run-empty");

    const visualSlots = [null, undefined, "", [], {}, { slotId: "   ", renderType: "unknown" }];
    const result = await renderer.render(visualSlots, null, null, { runId: "   ", assets: {} });

    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(svgGenerator.generate).not.toHaveBeenCalled();
    expect(assetResolver.resolve).not.toHaveBeenCalled();

    expect(result.report.runId).toBe("run-empty");
    expect(result.report.planned.total).toBe(3);
    expect(result.report.planned["ai-image"]).toBe(3);
    expect(result.report.completed["ai-image"]).toBe(0);
    expect(result.report.completed.svg).toBe(0);
    expect(result.report.completed.asset).toBe(0);
    expect(result.mergedSlots).toHaveLength(visualSlots.length);

    const result2 = await renderer.render({ not: "array" }, {}, {}, {});
    expect(result2.report.planned.total).toBe(0);
    expect(result2.mergedSlots).toEqual([]);
  });

  it("render() chooses AssetResolver from options.assets or contentPackage.assets when instance is missing", async () => {
    const renderer = new VisualRenderer({ imageGenerator: null, svgGenerator: null, assetResolver: null });
    const assetSlot = { slotId: "slot-asset", renderType: "asset", assetSpec: { assetId: "a1" } };

    const res1 = await renderer.render([assetSlot], { assets: [{ assetId: "a1" }] }, {}, {});
    expect(assetResolverMocks.instances).toHaveLength(1);
    expect(assetResolverMocks.instances[0].assets).toEqual([{ assetId: "a1" }]);
    expect(res1.assetResults).toEqual([]);

    const res2 = await renderer.render([assetSlot], { assets: [{ assetId: "a-from-package" }] }, {}, { assets: [{ assetId: "a-from-options" }] });
    expect(assetResolverMocks.instances).toHaveLength(2);
    expect(assetResolverMocks.instances[1].assets).toEqual([{ assetId: "a-from-options" }]);
    expect(res2.assetResults).toEqual([]);
  });

  it("render() records errors when individual renderers fail and still returns fallback results", async () => {
    const imageGenerator = { generate: vi.fn(async () => ({ filledSlots: [], report: { ok: true } })) };
    const svgGenerator = { generate: vi.fn(async () => Promise.reject(new Error("svg boom"))) };
    const assetResolver = { resolve: vi.fn(async () => Promise.reject(new Error("asset boom"))) };

    const renderer = new VisualRenderer({ imageGenerator, svgGenerator, assetResolver });
    const emit = vi.fn();

    const result = await renderer.render(
      [
        { slotId: "s1", renderType: "ai-image" },
        { slotId: "s2", renderType: "svg" },
        { slotId: "s3", renderType: "asset" },
      ],
      {},
      {},
      { runId: "run-err", emit }
    );

    expect(result.imageResults).toMatchObject({ filledSlots: [], report: { ok: true } });
    expect(result.svgResults).toEqual([]);
    expect(result.assetResults).toEqual([]);

    expect(result.report.errors).toHaveLength(2);
    expect(result.report.errors.map((e) => e.renderer).sort()).toEqual(["asset", "svg"]);
    expect(result.report.errors.find((e) => e.renderer === "svg")?.error).toContain("Error: svg boom");
    expect(result.report.errors.find((e) => e.renderer === "asset")?.error).toContain("Error: asset boom");

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0]).toBe(DesignEvents.VISUAL_RENDER_STARTED);
    expect(emit.mock.calls[1][0]).toBe(DesignEvents.VISUAL_RENDER_FAILED);
    expect(emit.mock.calls[1][1]).toMatchObject({ status: EventStatus.FAILED, payload: { runId: "run-err" } });
  });

  it("render() times out image generation, aborts controller, and emits failed", async () => {
    vi.useFakeTimers();
    try {
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
      expect(result.report.errors[0]).toMatchObject({ renderer: "ai-image" });
      expect(result.report.errors[0].error).toContain("Timed out after 50ms");
    } finally {
      vi.useRealTimers();
    }
  });

  it("render() links external abort signal to image abort controller", async () => {
    const controller = new AbortController();

    const imageGenerator = {
      generate: vi.fn((_, __, ___, opts) => {
        return new Promise((resolve, reject) => {
          const signal = opts?.signal;
          if (!signal) return resolve({ filledSlots: [], report: null });
          if (signal.aborted) return reject(new Error("aborted"));
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }),
    };

    const renderer = new VisualRenderer({ imageGenerator });

    const renderPromise = renderer.render([{ slotId: "s1", renderType: "ai-image" }], {}, {}, { runId: "run-abort", signal: controller.signal });

    const signalPassedToGenerator = imageGenerator.generate.mock.calls[0][3].signal;
    expect(signalPassedToGenerator).toBeDefined();
    expect(signalPassedToGenerator).not.toBe(controller.signal);
    expect(signalPassedToGenerator.aborted).toBe(false);

    controller.abort();

    const result = await renderPromise;
    expect(signalPassedToGenerator.aborted).toBe(true);
    expect(result.report.errors).toHaveLength(1);
    expect(result.report.errors[0]).toMatchObject({ renderer: "ai-image" });
  });

  it("render() supports concurrent renders without cross-talk", async () => {
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
  });

  it("render() normalizes concurrency and timeout boundaries (0, -1, MAX_SAFE_INTEGER, invalid types)", async () => {
    const imageGenerator = { generate: vi.fn(async () => ({ filledSlots: [], report: null })) };
    const renderer = new VisualRenderer({ imageGenerator });
    const slot = { slotId: "slot-1", renderType: "ai-image" };

    await renderer.render([slot], {}, {}, { concurrency: 0, runId: "r0" });
    await renderer.render([slot], {}, {}, { concurrency: -1, runId: "r1" });
    await renderer.render([slot], {}, {}, { concurrency: Number.MAX_SAFE_INTEGER, runId: "r2" });
    await renderer.render([slot], {}, {}, { concurrency: "5", runId: "r3", imageTimeoutMs: 0, timeoutMs: -1 });
    await renderer.render([slot], {}, {}, { concurrency: { not: "a number" }, runId: "r4", imageTimeoutMs: " ", timeoutMs: "not-a-number" });

    const calls = imageGenerator.generate.mock.calls;
    expect(calls[0][3].concurrency).toBe(1);
    expect(calls[1][3].concurrency).toBe(1);
    expect(calls[2][3].concurrency).toBe(Number.MAX_SAFE_INTEGER);
    expect(calls[3][3].concurrency).toBe(5);
    expect(calls[3][3].timeoutMs).toBeUndefined();
    expect(calls[4][3].concurrency).toBe(2);
    expect(calls[4][3].timeoutMs).toBeUndefined();
  });

  it("render() supports rapid consecutive calls with distinct runId resolution", async () => {
    sharedMocks.makeSecureTimestampedId.mockReturnValue("run-generated");

    const imageGenerator = { generate: vi.fn(async () => ({ filledSlots: [], report: null })) };
    const renderer = new VisualRenderer({ imageGenerator });

    const r1 = await renderer.render([{ slotId: "s1", renderType: "ai-image" }], { runId: "pkg-1" }, {}, { runId: "opt-1" });
    const r2 = await renderer.render([{ slotId: "s2", renderType: "ai-image" }], { runId: "pkg-2" }, {}, { runId: "   " });
    const r3 = await renderer.render([{ slotId: "s3", renderType: "ai-image" }], {}, {}, {});

    expect(r1.report.runId).toBe("opt-1");
    expect(r2.report.runId).toBe("pkg-2");
    expect(r3.report.runId).toBe("run-generated");
    expect(imageGenerator.generate).toHaveBeenCalledTimes(3);
  });
});
