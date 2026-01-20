import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("virtual:banana-image-generator", () => ({
  createMockImageGenerator: () => ({
    generate: vi.fn(),
  }),
}), { virtual: true });

import { createMockImageGenerator } from "virtual:banana-image-generator";
import {
  BANANA_CONFIG,
  buildImagePrompt,
  runBananaGenerate,
  regenerate,
  BananaGenerator,
  createBananaGenerator,
} from "../../../../../../js/agents/stages/design/banana/banana-generator.js";

const makeSlideIntent = (overrides = {}) => ({
  slideIntentId: "s1",
  title: "Quarterly Results",
  pageType: "cover",
  visualFocus: "hero illustration",
  keyMessage: "Growth accelerates",
  layoutHint: "two-column",
  bullets: ["Point A", "Point B", "Point C", "Point D", "Point E", "Point F"],
  ...overrides,
});

const makeDesignSystem = (overrides = {}) => ({
  theme: "modern",
  colorScheme: "ocean",
  fontFamily: "Fira Sans",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("BANANA_CONFIG", () => {
  it("exposes default values", () => {
    expect(BANANA_CONFIG.defaultModel).toBe("banana-pro");
    expect(BANANA_CONFIG.defaultWidth).toBe(1920);
    expect(BANANA_CONFIG.defaultHeight).toBe(1080);
    expect(BANANA_CONFIG.maxConcurrency).toBe(4);
    expect(BANANA_CONFIG.retryCount).toBe(2);
  });
});

describe("buildImagePrompt", () => {
  it("builds prompt with all fields and trims bullets", () => {
    const slideIntent = makeSlideIntent();
    const designSystem = makeDesignSystem();
    const prompt = buildImagePrompt(slideIntent, designSystem, { additionalPrompt: "Use minimal icons." });

    const expected = [
      `Slide title: "${slideIntent.title}"`,
      `Page type: ${slideIntent.pageType}`,
      `Visual focus: ${slideIntent.visualFocus}`,
      `Key message: ${slideIntent.keyMessage}`,
      `Layout: ${slideIntent.layoutHint}`,
      `Content points: ${slideIntent.bullets.slice(0, 5).join(", ")}`,
      `Style: theme: ${designSystem.theme}, colors: ${designSystem.colorScheme}, font: ${designSystem.fontFamily}`,
      "Use minimal icons.",
    ].join("\n");

    expect(prompt).toBe(expected);
  });

  it("returns empty string for empty values", () => {
    const prompt = buildImagePrompt(
      {
        title: "",
        pageType: "",
        visualFocus: "",
        keyMessage: "",
        layoutHint: "",
        bullets: [],
      },
      {},
      { additionalPrompt: "" },
    );

    expect(prompt).toBe("");
  });

  it("includes whitespace values and ignores non-array bullets", () => {
    const prompt = buildImagePrompt(
      {
        title: "   ",
        pageType: 0,
        keyMessage: "Key",
        bullets: { a: 1 },
      },
      null,
      { additionalPrompt: "  " },
    );

    expect(prompt).toBe(`Slide title: "   "\nKey message: Key\n  `);
  });

  it("throws when slideIntent is null or undefined", () => {
    expect(() => buildImagePrompt(null, {})).toThrow();
    expect(() => buildImagePrompt(undefined, {})).toThrow();
  });

  it("handles very long strings", () => {
    const longTitle = "A".repeat(10000);
    const longPrompt = "B".repeat(5000);
    const prompt = buildImagePrompt({ title: longTitle }, {}, { additionalPrompt: longPrompt });

    expect(prompt.includes(longTitle)).toBe(true);
    expect(prompt.includes(longPrompt)).toBe(true);
    expect(prompt.length).toBeGreaterThan(14000);
  });
});

describe("runBananaGenerate", () => {
  it("rejects non-array slideIntents (null, undefined, object)", async () => {
    const invalidInputs = [null, undefined, {}, "bad"];

    for (const input of invalidInputs) {
      const result = await runBananaGenerate(input, {}, {});
      expect(result).toEqual({ success: false, error: "slideIntents must be an array" });
    }
  });

  it("rejects slideIntents entries that are not objects", async () => {
    const imageGenerator = createMockImageGenerator();
    const result = await runBananaGenerate([null], {}, { imageGenerator });

    expect(result).toEqual({ success: false, error: "slideIntents[0] must be an object" });
  });

  it("rejects designSystem with invalid type", async () => {
    const imageGenerator = createMockImageGenerator();
    const result = await runBananaGenerate([], "not-object", { imageGenerator });

    expect(result).toEqual({ success: false, error: "designSystem must be an object or null" });
  });

  it("rejects missing imageGenerator", async () => {
    const result = await runBananaGenerate([], {}, {});

    expect(result).toEqual({ success: false, error: "imageGenerator is required" });
  });

  it("returns empty results and emits completion for empty input", async () => {
    const imageGenerator = createMockImageGenerator();
    const events = [];
    const emit = (name, payload) => events.push({ name, payload });

    const result = await runBananaGenerate([], {}, { imageGenerator, emit });

    expect(result.success).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.summary).toEqual({ total: 0, success: 0, failed: 0 });
    expect(imageGenerator.generate).not.toHaveBeenCalled();

    const completed = events.find((event) => event.name === "banana:completed");
    expect(completed?.payload?.payload).toEqual({ total: 0, success: 0, failed: 0 });
  });

  it("generates images with url/base64 and respects boundary values", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate
      .mockResolvedValueOnce({ url: "http://img/1" })
      .mockResolvedValueOnce({ base64: "base64-data" });

    const slideIntents = [
      makeSlideIntent({ slideIntentId: "s1" }),
      makeSlideIntent({
        slideIntentId: "s2",
        title: "Second",
        bullets: ["One", "Two", "Three", "Four", "Five", "Six"],
      }),
    ];

    const result = await runBananaGenerate(slideIntents, makeDesignSystem(), {
      imageGenerator,
      width: 0,
      height: -1,
      model: "custom-model",
      additionalPrompt: "Use minimal icons.",
    });

    expect(imageGenerator.generate).toHaveBeenCalledTimes(2);

    const firstCall = imageGenerator.generate.mock.calls[0][0];
    expect(firstCall.width).toBe(0);
    expect(firstCall.height).toBe(-1);
    expect(firstCall.model).toBe("custom-model");
    expect(firstCall.prompt).toContain("Use minimal icons.");
    expect(firstCall.prompt).toContain("Content points: Point A, Point B, Point C, Point D, Point E");

    expect(result.success).toBe(true);
    expect(result.results[0]).toMatchObject({
      slideIndex: 0,
      slideIntentId: "s1",
      success: true,
      image: "http://img/1",
    });
    expect(result.results[1]).toMatchObject({
      slideIndex: 1,
      slideIntentId: "s2",
      success: true,
      image: "base64-data",
    });
    expect(result.summary).toEqual({ total: 2, success: 2, failed: 0 });
  });

  it("marks failure when no image is returned", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockResolvedValueOnce({ url: "" });

    const result = await runBananaGenerate([makeSlideIntent()], {}, { imageGenerator });

    expect(result.success).toBe(false);
    expect(result.results[0]).toMatchObject({
      success: false,
      error: "No image returned",
    });
  });

  it("marks failure when generator throws", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockRejectedValueOnce(new Error("boom"));

    const result = await runBananaGenerate([makeSlideIntent()], {}, { imageGenerator });

    expect(result.success).toBe(false);
    expect(result.results[0]).toMatchObject({
      success: false,
      error: "Image generation failed",
    });
  });

  it("cancels all slides when aborted before start", async () => {
    const imageGenerator = createMockImageGenerator();
    const controller = new AbortController();
    controller.abort();

    const slideIntents = [makeSlideIntent(), makeSlideIntent({ slideIntentId: "s2" })];
    const result = await runBananaGenerate(slideIntents, {}, {
      imageGenerator,
      signal: controller.signal,
    });

    expect(imageGenerator.generate).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ success: false, error: "Cancelled" });
    expect(result.results[1]).toMatchObject({ success: false, error: "Cancelled" });
  });

  it("marks in-flight slide failed and remaining slides cancelled when aborted", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockImplementation(() => new Promise(() => {}));

    const controller = new AbortController();
    const slideIntents = [makeSlideIntent(), makeSlideIntent({ slideIntentId: "s2" })];
    const promise = runBananaGenerate(slideIntents, {}, { imageGenerator, signal: controller.signal });

    await Promise.resolve();
    controller.abort();

    const result = await promise;

    expect(imageGenerator.generate).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({ success: false, error: "Image generation failed" });
    expect(result.results[1]).toMatchObject({ success: false, error: "Cancelled" });
  });

  it("times out when generation exceeds default timeout", async () => {
    vi.useFakeTimers();

    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockImplementation(() => new Promise(() => {}));

    const promise = runBananaGenerate([makeSlideIntent()], {}, { imageGenerator });

    await vi.advanceTimersByTimeAsync(60000);
    const result = await promise;

    expect(result.results[0]).toMatchObject({
      success: false,
      error: "Image generation failed",
    });
  });

  it("handles concurrent calls without cross-talk", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockImplementation(async ({ prompt }) => ({ url: `img:${prompt}` }));

    const [resultA, resultB] = await Promise.all([
      runBananaGenerate([makeSlideIntent({ title: "Alpha" })], {}, { imageGenerator }),
      runBananaGenerate([
        makeSlideIntent({ title: "Beta", slideIntentId: "b1" }),
        makeSlideIntent({ title: "Gamma", slideIntentId: "b2" }),
      ], {}, { imageGenerator }),
    ]);

    expect(resultA.results[0].image).toContain("Slide title: \"Alpha\"");
    expect(resultB.results[0].image).toContain("Slide title: \"Beta\"");
    expect(resultB.results[1].image).toContain("Slide title: \"Gamma\"");
    expect(imageGenerator.generate).toHaveBeenCalledTimes(3);
  });

  it("handles rapid sequential calls with shared generator", async () => {
    const imageGenerator = createMockImageGenerator();
    let counter = 0;
    imageGenerator.generate.mockImplementation(async () => ({ url: `img-${++counter}` }));

    const first = await runBananaGenerate([makeSlideIntent()], {}, { imageGenerator });
    const second = await runBananaGenerate([makeSlideIntent({ slideIntentId: "s2" })], {}, { imageGenerator });

    expect(first.results[0].image).toBe("img-1");
    expect(second.results[0].image).toBe("img-2");
  });

  it("passes string width/height through to image generator", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockResolvedValue({ url: "img" });

    await runBananaGenerate([makeSlideIntent()], {}, {
      imageGenerator,
      width: "1024",
      height: "768",
    });

    const call = imageGenerator.generate.mock.calls[0][0];
    expect(call.width).toBe("1024");
    expect(call.height).toBe("768");
  });

  it("accepts deep nested intents and large base64 results", async () => {
    const imageGenerator = createMockImageGenerator();
    const largeBase64 = "Z".repeat(50000);
    imageGenerator.generate.mockResolvedValue({ base64: largeBase64 });

    const deepIntent = makeSlideIntent({
      slideIntentId: "deep",
      title: "Deep",
      meta: { level1: { level2: { level3: { value: "x" } } } },
    });

    const result = await runBananaGenerate([deepIntent], {}, { imageGenerator });

    expect(result.results[0].image).toBe(largeBase64);
    expect(result.results[0].prompt).toContain("Slide title: \"Deep\"");
  });
});

describe("regenerate", () => {
  it("rejects missing imageGenerator", async () => {
    const result = await regenerate({ slideIndex: 0 }, {});

    expect(result).toEqual({ success: false, error: "imageGenerator is required" });
  });

  it("builds prompt from slideIntent and appends command and bbox", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockResolvedValue({ url: "img" });

    const request = {
      slideIndex: 3,
      slideIntent: makeSlideIntent({ title: "Regenerate Me" }),
      designSystem: makeDesignSystem(),
      command: "Fix alignment",
      bbox: { x: 0, y: -1, w: Number.MAX_SAFE_INTEGER, h: 2 },
    };

    const result = await regenerate(request, { imageGenerator });

    const call = imageGenerator.generate.mock.calls[0][0];
    expect(call.prompt).toContain('Slide title: "Regenerate Me"');
    expect(call.prompt).toContain("Modification request: Fix alignment");
    expect(call.prompt).toContain(`Reference area: x=0, y=-1, w=${Number.MAX_SAFE_INTEGER}, h=2`);
    expect(call.width).toBe(BANANA_CONFIG.defaultWidth);
    expect(call.height).toBe(BANANA_CONFIG.defaultHeight);
    expect(call.model).toBe(BANANA_CONFIG.defaultModel);

    expect(result).toMatchObject({
      success: true,
      slideIndex: 3,
      image: "img",
    });
  });

  it("uses originalPrompt when slideIntent is absent and keeps whitespace command", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockResolvedValue({ base64: "img" });

    const result = await regenerate({
      slideIndex: 1,
      originalPrompt: "Base prompt",
      command: "  ",
    }, { imageGenerator });

    const prompt = imageGenerator.generate.mock.calls[0][0].prompt;
    expect(prompt).toContain("Base prompt");
    expect(prompt).toContain("Modification request:   ");
    expect(prompt.includes("Slide title:")).toBe(false);

    expect(result).toMatchObject({
      success: true,
      slideIndex: 1,
      image: "img",
    });
  });

  it("returns error when no image is returned", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockResolvedValue({});

    const result = await regenerate({ slideIndex: 2, originalPrompt: "Prompt" }, { imageGenerator });

    expect(result).toMatchObject({
      success: false,
      slideIndex: 2,
      error: "No image returned",
    });
  });

  it("returns error when generator throws", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockRejectedValue(new Error("fail"));

    const result = await regenerate({ slideIndex: 2, originalPrompt: "Prompt" }, { imageGenerator });

    expect(result).toMatchObject({
      success: false,
      slideIndex: 2,
      error: "Image generation failed",
    });
  });

  it("passes through width/height/model overrides and large slideIndex", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockResolvedValue({ url: "img" });

    const result = await regenerate({
      slideIndex: Number.MAX_SAFE_INTEGER,
      originalPrompt: "Prompt",
    }, {
      imageGenerator,
      width: "800",
      height: "600",
      model: "model-x",
    });

    const call = imageGenerator.generate.mock.calls[0][0];
    expect(call.width).toBe("800");
    expect(call.height).toBe("600");
    expect(call.model).toBe("model-x");

    expect(result.slideIndex).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("BananaGenerator", () => {
  it("generates using the configured imageGenerator", async () => {
    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockResolvedValue({ url: "img" });

    const generator = new BananaGenerator({ imageGenerator });
    const result = await generator.generate([makeSlideIntent()], {});

    expect(imageGenerator.generate).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("allows setting imageGenerator after construction", async () => {
    const generator = new BananaGenerator();
    const missingResult = await generator.regenerate({ slideIndex: 0, originalPrompt: "Prompt" });
    expect(missingResult.success).toBe(false);

    const imageGenerator = createMockImageGenerator();
    imageGenerator.generate.mockResolvedValue({ url: "img" });
    generator.setImageGenerator(imageGenerator);

    const result = await generator.regenerate({ slideIndex: 0, originalPrompt: "Prompt" });
    expect(result.success).toBe(true);
  });

  it("returns a copy of config and preserves defaults", () => {
    const generator = new BananaGenerator({ config: { defaultModel: "custom" } });
    const config = generator.getConfig();

    expect(config.defaultModel).toBe("custom");
    expect(config.defaultWidth).toBe(BANANA_CONFIG.defaultWidth);

    config.defaultModel = "mutated";
    expect(generator.getConfig().defaultModel).toBe("custom");
  });
});

describe("createBananaGenerator", () => {
  it("creates a BananaGenerator instance with provided options", () => {
    const imageGenerator = createMockImageGenerator();
    const generator = createBananaGenerator({ imageGenerator, config: { defaultModel: "custom" } });

    expect(generator).toBeInstanceOf(BananaGenerator);
    expect(generator.getConfig().defaultModel).toBe("custom");
  });
});
