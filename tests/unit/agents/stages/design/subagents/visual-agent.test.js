import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => {
  const imageGeneratorInstances = [];
  const svgGeneratorInstances = [];

  const ImageGenerator = vi.fn().mockImplementation(function (opts = {}) {
    this.opts = opts;
    this.generate = vi.fn().mockResolvedValue({ filledSlots: [], report: null });
    imageGeneratorInstances.push(this);
  });

  const SVGGenerator = vi.fn().mockImplementation(function (opts = {}) {
    this.opts = opts;
    this.generate = vi.fn().mockResolvedValue({ results: [], report: null });
    svgGeneratorInstances.push(this);
  });

  return {
    imageGeneratorInstances,
    svgGeneratorInstances,
    ImageGenerator,
    SVGGenerator,
    actualStates: null,
  };
});

vi.mock("../../../../../../js/agents/stages/design/generators/image-generator.js", () => ({
  ImageGenerator: mockState.ImageGenerator,
}));

vi.mock("../../../../../../js/agents/stages/design/generators/svg-generator.js", () => ({
  SVGGenerator: mockState.SVGGenerator,
}));

vi.mock("../../../../../../js/agents/stages/design/states.js", async (importOriginal) => {
  const actual = await importOriginal();
  mockState.actualStates = actual;
  return {
    ...actual,
    visualSlotMachine: {
      ...actual.visualSlotMachine,
      transition: vi.fn((state, next, meta) =>
        actual.visualSlotMachine.transition.call(actual.visualSlotMachine, state, next, meta)
      ),
    },
  };
});

vi.mock("../../../../../../js/agents/stages/design/constants.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };
});

vi.mock("../../../../../../js/agents/shared/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };
});

import { VisualSubAgent } from "../../../../../../js/agents/stages/design/subagents/visual-agent.js";
import { VisualSlotStatus, visualSlotMachine } from "../../../../../../js/agents/stages/design/states.js";
import { VisualType } from "../../../../../../js/agents/stages/design/constants.js";

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("VisualSubAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.imageGeneratorInstances.length = 0;
    mockState.svgGeneratorInstances.length = 0;
  });

  it("constructs with imageProvider and dependencies", () => {
    const assetRegistry = { getAsset: vi.fn() };
    const svgGenerator = { generate: vi.fn() };
    const imageProvider = { id: "provider-1" };

    const agent = new VisualSubAgent({ assetRegistry, svgGenerator, imageProvider });

    expect(mockState.ImageGenerator).toHaveBeenCalledTimes(1);
    expect(mockState.ImageGenerator).toHaveBeenCalledWith({ imageProvider });
    expect(agent.assetRegistry).toBe(assetRegistry);
    expect(agent.svgGenerator).toBe(svgGenerator);
    expect(agent.imageGenerator).toBe(mockState.imageGeneratorInstances[0]);
    expect(agent.getTransitionLog()).toEqual([]);
  });

  it("tracks transitions and clears log", () => {
    const agent = new VisualSubAgent();
    const slot = { slotId: "slot-1" };

    const ok = agent._transitionSlot(slot, VisualSlotStatus.QUEUED, { slotId: "slot-1" });

    expect(ok).toBe(true);
    expect(slot.status).toBe(VisualSlotStatus.QUEUED);
    const log = agent.getTransitionLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      slotId: "slot-1",
      from: VisualSlotStatus.PENDING,
      to: VisualSlotStatus.QUEUED,
    });
    log.push({ slotId: "other" });
    expect(agent.getTransitionLog()).toHaveLength(1);

    agent.clearTransitionLog();
    expect(agent.getTransitionLog()).toEqual([]);
  });

  it("does not log failed transitions", () => {
    const agent = new VisualSubAgent();
    const slot = { slotId: "slot-2", status: VisualSlotStatus.PENDING };

    visualSlotMachine.transition.mockImplementationOnce(() => false);

    const ok = agent._transitionSlot(slot, VisualSlotStatus.FILLED, { slotId: "slot-2" });

    expect(ok).toBe(false);
    expect(agent.getTransitionLog()).toHaveLength(0);
    expect(slot.status).toBe(VisualSlotStatus.PENDING);
  });

  it("runs mixed slots and produces expected outputs", async () => {
    const imageGenerator = { generate: vi.fn() };
    const svgGenerator = { generate: vi.fn() };
    const asset = {
      uri: "https://example.com/asset.png",
      width: "640",
      height: 480,
      metadata: { width: -1, height: 0, deep: { nested: { value: true } } },
    };
    const assetRegistry = { getAsset: vi.fn((id) => (id === "asset1" ? asset : null)) };

    const agent = new VisualSubAgent({ assetRegistry, imageGenerator, svgGenerator });

    const longPrompt = "p".repeat(5000);
    const effects = { glow: true, nested: { level: 2 } };
    const visualSlots = [
      {
        slotId: "hero-cover",
        renderType: "image",
        imageSpec: { prompt: longPrompt, style: "photo" },
        position: { w: "80%", h: "50%" },
        slideIndex: 0,
        claimIds: [1, "", null, "claim"],
        effects,
      },
      {
        slotId: "icon-slot",
        visualType: VisualType.ICON,
        promptHint: "icon prompt",
        position: { w: "50%", h: "50%" },
        slideIndex: Number.MAX_SAFE_INTEGER,
        slideIntentId: "   ",
      },
      {
        slotId: "chart-1",
        type: VisualType.CHART,
        description: "Quarterly results",
        position: { w: "40%", h: "40%" },
      },
      {
        slotId: "asset-1",
        renderType: "asset",
        assetSpec: { assetId: "asset1" },
      },
    ];

    imageGenerator.generate.mockResolvedValue({
      filledSlots: [{ slotId: "hero-cover" }],
      report: { ok: true },
    });
    svgGenerator.generate.mockResolvedValue({
      results: [{ slotId: "chart-1", svgContent: "<svg/>" }],
      report: { ok: true },
    });

    const designSystem = { theme: "bold" };
    const contentPackage = { runId: "run-1" };

    const result = await agent.run(visualSlots, designSystem, contentPackage, { imageConcurrency: 1 });

    expect(imageGenerator.generate).toHaveBeenCalledTimes(1);
    const [imageSlots, imageContent, imageDesign, imageOpts] = imageGenerator.generate.mock.calls[0];
    expect(imageSlots).toHaveLength(2);
    const heroSlot = imageSlots.find((slot) => slot.slotId === "hero-cover");
    const iconSlot = imageSlots.find((slot) => slot.slotId === "icon-slot");

    expect(imageContent).toBe(contentPackage);
    expect(imageDesign).toBe(designSystem);
    expect(imageOpts.concurrency).toBe(1);
    expect(heroSlot).toMatchObject({
      slotId: "hero-cover",
      purpose: "hero",
      promptHint: longPrompt,
      style: "photo",
      aspectRatio: "16:9",
      slideIndex: 0,
      slideIntentId: "s0",
      renderType: "ai-image",
    });
    expect(heroSlot.claimIds).toEqual(["1", "null", "claim"]);
    expect(heroSlot.effects).toEqual(effects);
    expect(heroSlot.effects).not.toBe(effects);

    expect(iconSlot).toMatchObject({
      slotId: "icon-slot",
      purpose: "icon",
      promptHint: "icon prompt",
      style: "illustration",
      aspectRatio: "1:1",
      slideIndex: Number.MAX_SAFE_INTEGER,
      slideIntentId: `s${Number.MAX_SAFE_INTEGER}`,
      renderType: "ai-image",
    });

    expect(svgGenerator.generate).toHaveBeenCalledTimes(1);
    const [svgSlots, svgDesign] = svgGenerator.generate.mock.calls[0];
    expect(svgDesign).toBe(designSystem);
    expect(svgSlots).toHaveLength(1);
    expect(svgSlots[0].svgSpec).toMatchObject({
      type: VisualType.CHART,
      description: "Quarterly results",
    });

    expect(result.assetResults).toHaveLength(1);
    expect(result.assetResults[0]).toMatchObject({
      slotId: "asset-1",
      assetId: "asset1",
      assetUri: "https://example.com/asset.png",
      width: 640,
      height: 480,
    });

    const statusById = new Map(result.slots.map((slot) => [slot.slotId, slot.status]));
    expect(statusById.get("hero-cover")).toBe(VisualSlotStatus.FILLED);
    expect(statusById.get("icon-slot")).toBe(VisualSlotStatus.FAILED);
    expect(statusById.get("chart-1")).toBe(VisualSlotStatus.FILLED);
    expect(statusById.get("asset-1")).toBe(VisualSlotStatus.FILLED);

    expect(result.report.planned).toEqual({ total: 4, "ai-image": 2, svg: 1, asset: 1 });
    expect(result.report.completed).toEqual({ "ai-image": 1, svg: 1, asset: 1 });
    expect(result.report.errors).toEqual([]);
  });

  it("falls back to svg when image generation is unavailable", async () => {
    const svgGenerator = { generate: vi.fn().mockResolvedValue({ results: [{ slotId: "photo-1", svgContent: "<svg/>" }], report: null }) };
    const agent = new VisualSubAgent({ svgGenerator });

    const visualSlots = [
      { slotId: "photo-1", visualType: VisualType.PHOTO, description: "Photo fallback" },
    ];

    const result = await agent.run(visualSlots, {}, {});

    expect(svgGenerator.generate).toHaveBeenCalledTimes(1);
    const [svgSlots] = svgGenerator.generate.mock.calls[0];
    expect(svgSlots).toHaveLength(1);
    expect(svgSlots[0].renderType).toBe("svg");
    expect(svgSlots[0].svgSpec).toMatchObject({
      type: VisualType.PHOTO,
      description: "Photo fallback",
    });
    expect(result.report.planned).toEqual({ total: 1, "ai-image": 0, svg: 1, asset: 0 });
    expect(result.slots[0].status).toBe(VisualSlotStatus.FILLED);
  });

  it("records errors when generators reject and marks slots failed", async () => {
    const imageGenerator = { generate: vi.fn().mockRejectedValue(new Error("image boom")) };
    const svgGenerator = { generate: vi.fn().mockRejectedValue("svg boom") };
    const agent = new VisualSubAgent({ imageGenerator, svgGenerator });

    const visualSlots = [
      { slotId: "img-1", renderType: "ai-image", slideIndex: 1 },
      { slotId: "svg-1", renderType: "svg", svgSpec: { type: "chart", description: "test" } },
    ];

    const result = await agent.run(visualSlots, {}, {}, { imageConcurrency: "2" });

    expect(imageGenerator.generate).toHaveBeenCalledTimes(1);
    expect(svgGenerator.generate).toHaveBeenCalledTimes(1);
    const [, , , imageOpts] = imageGenerator.generate.mock.calls[0];
    expect(imageOpts.concurrency).toBe("2");
    const errorTypes = result.report.errors.map((err) => err.type).sort();
    expect(errorTypes).toEqual(["ai-image", "svg"]);
    expect(result.report.errors.find((err) => err.type === "ai-image").message).toContain("image boom");
    expect(result.report.errors.find((err) => err.type === "svg").message).toContain("svg boom");
    const statusById = new Map(result.slots.map((slot) => [slot.slotId, slot.status]));
    expect(statusById.get("img-1")).toBe(VisualSlotStatus.FAILED);
    expect(statusById.get("svg-1")).toBe(VisualSlotStatus.FAILED);
  });

  it("times out image generation with budget timeout", async () => {
    vi.useFakeTimers();
    try {
      const imageGenerator = { generate: vi.fn(() => new Promise(() => {})) };
      const agent = new VisualSubAgent({ imageGenerator });

      const runPromise = agent.run([{ slotId: "slow-1" }], {}, {}, { budget: { timeoutMs: 5 }, imageConcurrency: 0 });

      await vi.advanceTimersByTimeAsync(5);
      const result = await runPromise;

      expect(imageGenerator.generate).toHaveBeenCalledTimes(1);
      expect(result.report.errors).toHaveLength(1);
      expect(result.report.errors[0].type).toBe("ai-image");
      expect(result.report.errors[0].message).toContain("Timed out after 5ms");
      expect(result.report.errors[0].backgroundMayContinue).toBe(true);
      expect(Array.isArray(result.report.timeoutTelemetry)).toBe(true);
      expect(result.report.timeoutTelemetry.some((item) => item.kind === "ai-image" && item.event === "timeout")).toBe(true);
      expect(result.slots[0].status).toBe(VisualSlotStatus.FAILED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles asset data URIs, missing assets, and whitespace slot ids", async () => {
    const bigData = "a".repeat(10000);
    const deepNested = { level1: { level2: { level3: { value: true } } } };
    const assetRegistry = {
      getAsset: vi.fn((id) => {
        if (id === "ok") {
          return {
            data: bigData,
            mimeType: "image/jpeg",
            width: 0,
            height: -1,
            metadata: { width: "1024", height: "768", deep: deepNested },
          };
        }
        return null;
      }),
    };
    const agent = new VisualSubAgent({ assetRegistry });

    const visualSlots = [
      { slotId: "asset-ok", renderType: "asset", assetSpec: { assetId: "ok" } },
      { slotId: "asset-missing", renderType: "asset", assetSpec: { assetId: "missing" } },
      { slotId: "   ", renderType: "asset", assetSpec: { assetId: "ok" } },
    ];

    const result = await agent.run(visualSlots, {}, {});

    expect(result.assetResults).toHaveLength(1);
    expect(result.assetResults[0].assetUri).toBe(`data:image/jpeg;base64,${bigData}`);
    expect(result.assetResults[0].width).toBeNull();
    expect(result.assetResults[0].height).toBeNull();
    const statusById = new Map(result.slots.map((slot) => [slot.slotId, slot.status]));
    expect(statusById.get("asset-ok")).toBe(VisualSlotStatus.FILLED);
    expect(statusById.get("asset-missing")).toBe(VisualSlotStatus.FAILED);
    expect(statusById.get("   ")).toBe(VisualSlotStatus.FAILED);
    expect(result.report.errors).toEqual([
      { type: "asset", message: "Missing asset: missing", slotId: "asset-missing" },
    ]);
  });

  it("handles empty or invalid slot inputs without generator calls", async () => {
    const imageGenerator = { generate: vi.fn() };
    const svgGenerator = { generate: vi.fn() };
    const agent = new VisualSubAgent({ imageGenerator, svgGenerator });

    const resultNull = await agent.run(null, {}, {});
    const resultUndefined = await agent.run(undefined, {}, {});
    const resultObject = await agent.run({ slotId: "bad" }, {}, {});
    const resultEmpty = await agent.run([], {}, {});

    for (const result of [resultNull, resultUndefined, resultObject, resultEmpty]) {
      expect(result.report.planned.total).toBe(0);
      expect(result.report.completed["ai-image"]).toBe(0);
      expect(result.report.completed.svg).toBe(0);
      expect(result.report.completed.asset).toBe(0);
    }

    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(svgGenerator.generate).not.toHaveBeenCalled();
  });

  it("supports concurrent runs", async () => {
    const imageGenerator = { generate: vi.fn() };
    const agent = new VisualSubAgent({ imageGenerator });

    const first = createDeferred();
    const second = createDeferred();
    imageGenerator.generate.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const runA = agent.run([{ slotId: "a1" }], {}, {});
    const runB = agent.run([{ slotId: "b1" }], {}, {});

    second.resolve({ filledSlots: [{ slotId: "b1" }], report: null });
    first.resolve({ filledSlots: [{ slotId: "a1" }], report: null });

    const [resultA, resultB] = await Promise.all([runA, runB]);

    const statusA = new Map(resultA.slots.map((slot) => [slot.slotId, slot.status]));
    const statusB = new Map(resultB.slots.map((slot) => [slot.slotId, slot.status]));
    expect(statusA.get("a1")).toBe(VisualSlotStatus.FILLED);
    expect(statusB.get("b1")).toBe(VisualSlotStatus.FILLED);
  });

  it("supports rapid consecutive runs", async () => {
    const imageGenerator = { generate: vi.fn() };
    imageGenerator.generate
      .mockResolvedValueOnce({ filledSlots: [{ slotId: "seq-1" }], report: null })
      .mockResolvedValueOnce({ filledSlots: [{ slotId: "seq-2" }], report: null });

    const agent = new VisualSubAgent({ imageGenerator });

    const result1 = await agent.run([{ slotId: "seq-1", slideIndex: -1 }], {}, {});
    const result2 = await agent.run([{ slotId: "seq-2", slideIndex: 1 }], {}, {});

    const firstCallSlots = imageGenerator.generate.mock.calls[0][0];
    expect(firstCallSlots[0].slideIntentId).toBe("s-1");
    expect(result1.slots[0].status).toBe(VisualSlotStatus.FILLED);
    expect(result2.slots[0].status).toBe(VisualSlotStatus.FILLED);
  });
});
