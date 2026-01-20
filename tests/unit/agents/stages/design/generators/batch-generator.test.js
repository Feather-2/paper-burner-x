import { describe, it, expect, vi, beforeEach } from "vitest";

const modulePath = "../../../../../../js/agents/stages/design/generators/batch-generator.js";

const modelMocks = vi.hoisted(() => ({
  getDesignModelCaller: vi.fn(),
  isNonRetryableError: vi.fn(),
}));
vi.mock("../../../../../../js/agents/stages/design/model.js", () => modelMocks);

const sharedMocks = vi.hoisted(() => ({
  createLogger: vi.fn(),
}));
vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return { ...actual, createLogger: sharedMocks.createLogger };
});

const constantsMocks = vi.hoisted(() => ({
  VisualDataStatus: { PENDING: "pending" },
}));
vi.mock("../../../../../../js/agents/stages/design/constants.js", () => constantsMocks);

const dslMocks = vi.hoisted(() => ({
  buildSlideHtml: vi.fn(),
}));
vi.mock("../../../../../../js/agents/stages/design/dsl/dsl-builder.js", () => dslMocks);

const layoutMocks = vi.hoisted(() => ({
  resolveLayoutType: vi.fn(),
}));
vi.mock("../../../../../../js/agents/stages/design/generators/layout-protocol.js", () => layoutMocks);

const promptMocks = vi.hoisted(() => ({
  loadPrompt: vi.fn(),
}));
vi.mock("../../../../../../js/agents/prompts/prompt-loader.js", () => promptMocks);

const safeEmitMocks = vi.hoisted(() => ({
  safeEmit: vi.fn(),
}));
vi.mock("../../../../../../js/agents/stages/design/shared/safe-emit.js", () => safeEmitMocks);

const runtimeMocks = vi.hoisted(() => ({
  ResourceGuard: vi.fn(),
}));
vi.mock("../../../../../../js/agents/runtime/index.js", () => runtimeMocks);

const fallbackHtml = '<section data-type="freeform"><div data-el="text">Fallback</div></section>';
const validSlideHtml = '<section data-type="freeform"><div data-el="text">OK</div></section>';

function makeSlideIntent(id, pageType = "overview") {
  return { slideIntentId: id, title: `Slide ${id}`, pageType, keyPoints: ["k1", "k2"] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();

  sharedMocks.createLogger.mockImplementation(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }));
  modelMocks.getDesignModelCaller.mockReturnValue(null);
  modelMocks.isNonRetryableError.mockReturnValue(false);
  dslMocks.buildSlideHtml.mockImplementation(() => fallbackHtml);
  layoutMocks.resolveLayoutType.mockImplementation((pageType) => `layout-${pageType || "default"}`);
  promptMocks.loadPrompt.mockResolvedValue("SYSTEM_PROMPT");
  safeEmitMocks.safeEmit.mockImplementation((emit, name, status, payload) => {
    if (typeof emit === "function") emit(name, { actor: "design", status, payload });
  });
  runtimeMocks.ResourceGuard.mockImplementation(function ResourceGuard(opts) {
    this.opts = opts;
    this.run = vi.fn((task) => Promise.resolve().then(task));
  });
});

describe("generateSingleSlide", () => {
  it("returns llm result with sanitized html and truncated content", async () => {
    const { generateSingleSlide } = await import(modulePath);
    const longText = "A".repeat(900);
    let promptText = "";

    const modelCaller = vi.fn(async (messages) => {
      promptText = messages?.[1]?.content || "";
      return {
        content: JSON.stringify([
          {
            slideIntentId: "s1",
            slideHtml: '<section data-type="freeform"><div data-el="text" onclick="alert(1)">Hello</div><script>alert(1)</script></section>',
          },
        ]),
      };
    });

    const result = await generateSingleSlide(
      { slideIntentId: "s1", title: "Intro", pageType: "cover", content: longText },
      { designTokens: { colors: { primary: "#0ea5e9" } } },
      "   ",
      { modelCaller }
    );

    expect(result.source).toBe("llm");
    expect(result.slideHtml).toContain('data-layout="layout-cover"');
    expect(result.slideHtml).not.toContain("<script");
    expect(result.slideHtml).not.toContain("onclick=");
    expect(promptText).toContain("content truncated");
    expect(promptText).not.toContain("DSL rules:");
    expect(promptMocks.loadPrompt).toHaveBeenCalledTimes(1);
  });

  it("applies visual slot hints and inserts missing placeholders", async () => {
    const { generateSingleSlide } = await import(modulePath);
    const modelCaller = vi.fn(async () => ({
      content: JSON.stringify([
        {
          slideIntentId: "s2",
          slideHtml:
            '<section data-type="freeform"><div data-el="image-placeholder" data-slot-id="slot1"></div><div data-el="text">Body</div></section>',
        },
      ]),
    }));

    const slotHintsBySlotId = new Map([
      [
        "slot1",
        {
          renderType: "photo",
          position: { x: 10, y: 20, w: 30, h: 40 },
          effects: { blur: { amount: 5 } },
        },
      ],
      ["slot2", { renderType: "icon" }],
    ]);

    const imageSlotsForSlide = [
      { slotId: "slot1", slideIndex: 0, aspectRatio: "16:9" },
      { slotId: "slot2", slideIndex: 0, aspectRatio: "1:1" },
    ];

    const result = await generateSingleSlide(
      { slideIntentId: "s2", title: "Slots", pageType: "overview" },
      {},
      "",
      { modelCaller, imageSlotsForSlide, slotHintsBySlotId }
    );

    expect(result.slideHtml).toContain('data-render-type="photo"');
    expect(result.slideHtml).toContain('data-x="10"');
    expect(result.slideHtml).toContain('data-y="20"');
    expect(result.slideHtml).toContain('data-w="30"');
    expect(result.slideHtml).toContain('data-h="40"');
    expect(result.slideHtml).toContain("data-effects=");
    expect(result.slideHtml).toContain("blur");
    expect(result.slideHtml).toContain('data-slot-id="slot2"');
    expect(result.slideHtml).toContain('data-status="pending"');
    expect(result.slideHtml).toContain('data-aspect-ratio="1:1"');
  });

  it("retries on invalid JSON then falls back with large content package", async () => {
    const { generateSingleSlide } = await import(modulePath);
    const modelCaller = vi.fn(async () => ({ content: "not-json" }));
    const contentPackage = { summary: "X".repeat(10000) };

    const result = await generateSingleSlide(
      { slideIntentId: "s3", title: "Bad JSON", pageType: "overview", content: "" },
      {},
      "",
      { modelCaller, contentPackage, slideNo: "2" }
    );

    expect(modelCaller).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("fallback");
    expect(dslMocks.buildSlideHtml).toHaveBeenCalledTimes(1);
    const buildArgs = dslMocks.buildSlideHtml.mock.calls[0];
    expect(buildArgs[2]).toBe(contentPackage);
    expect(buildArgs[3]?.slideNo).toBe(1);
    const retrying = safeEmitMocks.safeEmit.mock.calls.some((call) => call[1] === "design:slide.retrying");
    expect(retrying).toBe(true);
  });

  it("skips retry on non-retryable errors and preserves boundary slide numbers", async () => {
    const { generateSingleSlide } = await import(modulePath);
    const modelCaller = vi.fn(async () => {
      throw new Error("config error");
    });
    modelMocks.isNonRetryableError.mockReturnValue(true);

    const result = await generateSingleSlide(
      {},
      {},
      "",
      { modelCaller, slideNo: -1, slideIndex: Number.MAX_SAFE_INTEGER }
    );

    expect(modelCaller).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("fallback");
    expect(result.slideIntentId).toBe("");
    const buildArgs = dslMocks.buildSlideHtml.mock.calls[0];
    expect(buildArgs[3]?.slideNo).toBe(-1);
    const failedCall = safeEmitMocks.safeEmit.mock.calls.find((call) => call[1] === "design:slide.failed");
    expect(failedCall?.[3]?.slideIndex).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("throws when signal is aborted", async () => {
    const { generateSingleSlide } = await import(modulePath);
    const controller = new AbortController();
    controller.abort("Stop");

    await expect(
      generateSingleSlide({ slideIntentId: "s4" }, {}, "", { signal: controller.signal })
    ).rejects.toThrow("Stop");
  });

  it("shares system prompt load across concurrent calls", async () => {
    const { generateSingleSlide } = await import(modulePath);

    let resolvePrompt;
    const promptPromise = new Promise((resolve) => {
      resolvePrompt = resolve;
    });
    promptMocks.loadPrompt.mockReturnValueOnce(promptPromise);

    const modelCaller = vi.fn(async () => ({
      content: JSON.stringify([
        { slideIntentId: "s1", slideHtml: validSlideHtml },
      ]),
    }));

    const p1 = generateSingleSlide(makeSlideIntent("s1"), {}, "", { modelCaller });
    const p2 = generateSingleSlide(makeSlideIntent("s2"), {}, "", { modelCaller });

    await Promise.resolve();
    resolvePrompt("SYSTEM_PROMPT");
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(promptMocks.loadPrompt).toHaveBeenCalledTimes(1);
    expect(modelCaller).toHaveBeenCalledTimes(2);
    expect(r1.source).toBe("llm");
    expect(r2.source).toBe("llm");
  });
});

describe("generateBatch", () => {
  it("processes batches with style lock and uses ResourceGuard for later batches", async () => {
    const { generateBatch } = await import(modulePath);
    const slideIntents = [
      makeSlideIntent("s1", "cover"),
      makeSlideIntent("s2", "overview"),
      makeSlideIntent("s3", "overview"),
      makeSlideIntent("s4", "overview"),
      makeSlideIntent("s5", "closing"),
    ];
    const modelCaller = vi.fn(async () => ({
      content: JSON.stringify([{ slideIntentId: "any", slideHtml: validSlideHtml }]),
    }));

    const results = await generateBatch(slideIntents, { summary: "big" }, { theme: "light" }, {
      modelCaller,
      batchSize: "2",
      batchConcurrency: "1",
    });

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.source === "llm")).toBe(true);
    expect(promptMocks.loadPrompt).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.ResourceGuard).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.ResourceGuard.mock.calls[0][0]?.maxConcurrent).toBe(1);
    const guardInstance = runtimeMocks.ResourceGuard.mock.instances[0];
    expect(guardInstance.run).toHaveBeenCalledTimes(2);
    const styleLockCall = safeEmitMocks.safeEmit.mock.calls.find((call) => call[1] === "design:styleLock.established");
    expect(styleLockCall?.[3]?.exampleCount).toBeGreaterThan(0);
  });

  it("clamps batchSize and batchConcurrency for boundary values", async () => {
    const { generateBatch } = await import(modulePath);
    const slideIntents = [makeSlideIntent("s1"), makeSlideIntent("s2")];
    const modelCaller = vi.fn(async () => ({
      content: JSON.stringify([{ slideIntentId: "any", slideHtml: validSlideHtml }]),
    }));

    const results = await generateBatch(slideIntents, {}, { theme: "light" }, {
      modelCaller,
      batchSize: -1,
      batchConcurrency: 0,
      imageSlots: {},
    });

    expect(results).toHaveLength(2);
    expect(runtimeMocks.ResourceGuard).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.ResourceGuard.mock.calls[0][0]?.maxConcurrent).toBe(2);
    const guardInstance = runtimeMocks.ResourceGuard.mock.instances[0];
    expect(guardInstance.run).toHaveBeenCalledTimes(1);
  });

  it("returns empty array for null or non-array inputs", async () => {
    const { generateBatch } = await import(modulePath);

    await expect(generateBatch(null, {}, { designSystem: {} })).resolves.toEqual([]);
    await expect(generateBatch([], {}, { designSystem: {} })).resolves.toEqual([]);
    await expect(generateBatch({}, {}, { designSystem: {} })).resolves.toEqual([]);
  });

  it("supports designSystem in options and caches prompt across rapid calls", async () => {
    const { generateBatch } = await import(modulePath);
    const slideIntents = [makeSlideIntent("s1", "overview")];
    const modelCaller = vi.fn(async () => ({
      content: JSON.stringify([{ slideIntentId: "any", slideHtml: validSlideHtml }]),
    }));
    const options = {
      designSystem: { theme: "light" },
      modelCaller,
      batchSize: 1,
    };

    const res1 = await generateBatch(slideIntents, {}, options);
    const res2 = await generateBatch(slideIntents, {}, options);

    expect(res1[0].source).toBe("llm");
    expect(res2[0].source).toBe("llm");
    expect(promptMocks.loadPrompt).toHaveBeenCalledTimes(1);
  });

  it("throws when signal is aborted", async () => {
    const { generateBatch } = await import(modulePath);
    const controller = new AbortController();
    controller.abort("Stop");

    await expect(
      generateBatch([makeSlideIntent("s1")], {}, { designSystem: {}, signal: controller.signal })
    ).rejects.toThrow("Stop");
  });
});
