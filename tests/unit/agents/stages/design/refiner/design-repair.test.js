import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    runReactRefinerMock: vi.fn(),
    createToolExecutorMock: vi.fn(),
    validateSlideMock: vi.fn(),
  };
});

vi.mock("../../../../../../js/agents/stages/design/refiner/react-refiner.js", () => ({
  runReactRefiner: mocks.runReactRefinerMock,
}));

vi.mock("../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js", () => ({
  createToolExecutor: mocks.createToolExecutorMock,
}));

vi.mock("../../../../../../js/agents/stages/design/refiner/qa-validator.js", () => ({
  validateSlide: mocks.validateSlideMock,
}));

import {
  buildRepairTask,
  REPAIR_CONFIG,
  runAutomatedRepair,
  repairSlides,
  integrateRepairIntoGeneration,
} from "../../../../../../js/agents/stages/design/refiner/design-repair.js";

const { runReactRefinerMock, createToolExecutorMock, validateSlideMock } = mocks;

const createTask = (overrides = {}) => ({
  slideHtml: "<section>base</section>",
  slideIntentId: "intent-1",
  issues: ["Missing title"],
  ...overrides,
});

beforeEach(() => {
  runReactRefinerMock.mockReset();
  createToolExecutorMock.mockReset();
  validateSlideMock.mockReset();
});

describe("buildRepairTask", () => {
  it("builds repair task from QA result", () => {
    const slideHtml = "<section>test</section>";
    const qaResult = {
      pass: false,
      score: 3,
      issues: ["Missing title", "Invalid structure"],
    };
    const slideIntent = {
      slideIntentId: "s1",
      pageType: "content",
      title: "Test Slide",
    };

    const task = buildRepairTask(slideHtml, qaResult, slideIntent, { slideIndex: 0 });

    expect(task.slideHtml).toBe(slideHtml);
    expect(task.slideIntentId).toBe("s1");
    expect(task.slideIndex).toBe(0);
    expect(task.pageType).toBe("content");
    expect(task.issues).toEqual(["Missing title", "Invalid structure"]);
    expect(task.qaScore).toBe(3);
    expect(task.qaPass).toBe(false);
  });

  it("maps object issues and deep nested data", () => {
    const deepIssue = {
      level1: {
        level2: {
          level3: {
            level4: {
              detail: "deep",
            },
          },
        },
      },
    };
    const qaResult = {
      pass: false,
      issues: [{ message: "Error 1" }, { description: "Error 2" }, deepIssue],
    };

    const task = buildRepairTask("<section/>", qaResult, {});

    expect(task.issues[0]).toBe("Error 1");
    expect(task.issues[1]).toBe("Error 2");
    expect(task.issues[2]).toBe(JSON.stringify(deepIssue));
  });

  it("handles nullish inputs and empty strings", () => {
    const task = buildRepairTask("", undefined, null, {});

    expect(task.slideHtml).toBe("");
    expect(task.issues).toEqual([]);
    expect(task.slideIntentId).toBe(undefined);
    expect(task.qaScore).toBe(undefined);
    expect(task.qaPass).toBe(undefined);
    expect(task.slideIndex).toBe(undefined);
  });

  it("supports boundary slideIndex values", () => {
    const negativeIndexTask = buildRepairTask(
      "<section/>",
      { pass: true, score: 0, issues: [] },
      { slideIntentId: "s1" },
      { slideIndex: -1 }
    );
    const maxIndexTask = buildRepairTask(
      "<section/>",
      { pass: false, score: 0, issues: [] },
      { slideIntentId: "s2" },
      { slideIndex: Number.MAX_SAFE_INTEGER }
    );

    expect(negativeIndexTask.slideIndex).toBe(-1);
    expect(negativeIndexTask.qaScore).toBe(0);
    expect(negativeIndexTask.issues).toEqual([]);
    expect(maxIndexTask.slideIndex).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("throws when issues is not an array", () => {
    expect(() =>
      buildRepairTask("<section/>", { pass: false, issues: {} }, { slideIntentId: "s1" })
    ).toThrow();
  });
});

describe("REPAIR_CONFIG", () => {
  it("has default values", () => {
    expect(REPAIR_CONFIG.maxRetries).toBe(3);
    expect(REPAIR_CONFIG.maxStepsPerRetry).toBe(5);
    expect(REPAIR_CONFIG.qualityThreshold).toBe(6);
  });
});

describe("runAutomatedRepair", () => {
  it("returns error when repairTask is undefined", async () => {
    const result = await runAutomatedRepair();

    expect(result).toEqual({
      success: false,
      error: "No slideHtml provided",
      slideHtml: null,
    });
  });

  it("returns error when slideHtml is empty", async () => {
    const result = await runAutomatedRepair({ slideHtml: "", issues: [] });

    expect(result).toEqual({
      success: false,
      error: "No slideHtml provided",
      slideHtml: null,
    });
  });

  it("returns cancelled when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const task = createTask();
    const result = await runAutomatedRepair(task, { signal: controller.signal });

    expect(result).toEqual({
      success: false,
      error: "Cancelled",
      slideHtml: task.slideHtml,
    });
    expect(runReactRefinerMock).not.toHaveBeenCalled();
  });

  it("runs refiner and returns success when quality meets threshold", async () => {
    const emit = vi.fn();
    const controller = new AbortController();
    const aiApiService = { chat: vi.fn() };
    const modelRouter = vi.fn();
    const toolExecutor = vi.fn();

    createToolExecutorMock.mockReturnValue(toolExecutor);
    runReactRefinerMock.mockResolvedValue({
      qualityScore: REPAIR_CONFIG.qualityThreshold,
      finalDeck: { deckHtmlDsl: "<section>repaired</section>" },
      steps: [{}, {}],
    });

    const task = createTask();
    const result = await runAutomatedRepair(task, {
      emit,
      signal: controller.signal,
      aiApiService,
      modelRouter,
    });

    expect(result).toEqual({
      success: true,
      slideHtml: "<section>repaired</section>",
      qualityScore: REPAIR_CONFIG.qualityThreshold,
      stepsUsed: 2,
      retries: 1,
    });

    expect(createToolExecutorMock).toHaveBeenCalledTimes(1);
    const toolContext = createToolExecutorMock.mock.calls[0][0];
    expect(toolContext.deckPackage.deckHtmlDsl).toBe(task.slideHtml);
    expect(toolContext.deckPackage.slidesMeta).toEqual([
      { slideNo: 1, slideIntentId: task.slideIntentId },
    ]);
    expect(toolContext.contentPackage.slideIntents[0].slideIntentId).toBe(task.slideIntentId);
    expect(toolContext.stageApi.signal).toBe(controller.signal);
    expect(toolContext.stageApi.emit).toBe(emit);

    const [deckArg, contextArg, optionsArg] = runReactRefinerMock.mock.calls[0];
    expect(deckArg.deckHtmlDsl).toBe(task.slideHtml);
    expect(contextArg.initialIssues).toEqual(task.issues);
    expect(contextArg.stageApi.signal).toBe(controller.signal);
    expect(contextArg.stageApi.emit).toBe(emit);
    expect(contextArg.stageApi.aiApiService).toBe(aiApiService);
    expect(contextArg.stageApi.modelRouter).toBe(modelRouter);
    expect(optionsArg.recommendedSteps).toBe(REPAIR_CONFIG.maxStepsPerRetry);
    expect(optionsArg.hardLimit).toBe(REPAIR_CONFIG.maxStepsPerRetry * 2);
    expect(optionsArg.toolExecutor).toBe(toolExecutor);
    expect(optionsArg.mode).toBe("generation");
  });

  it("uses provided toolExecutor and custom step limits", async () => {
    const toolExecutor = vi.fn();

    runReactRefinerMock.mockResolvedValue({
      qualityScore: 7,
      finalDeck: { deckHtmlDsl: "<section>ok</section>" },
      steps: [],
    });

    const result = await runAutomatedRepair(createTask(), {
      toolExecutor,
      maxStepsPerRetry: 4,
    });

    expect(result.success).toBe(true);
    expect(createToolExecutorMock).not.toHaveBeenCalled();

    const optionsArg = runReactRefinerMock.mock.calls[0][2];
    expect(optionsArg.toolExecutor).toBe(toolExecutor);
    expect(optionsArg.recommendedSteps).toBe(4);
    expect(optionsArg.hardLimit).toBe(8);
  });

  it("retries and returns last error when quality stays below threshold", async () => {
    runReactRefinerMock
      .mockResolvedValueOnce({
        qualityScore: 3,
        finalDeck: { deckHtmlDsl: "<section>v1</section>" },
        steps: [],
      })
      .mockResolvedValueOnce({
        qualityScore: 5,
        finalDeck: { deckHtmlDsl: "<section>v2</section>" },
        steps: ["step"],
      });

    const result = await runAutomatedRepair(createTask(), {
      maxRetries: 2,
      maxStepsPerRetry: 1,
    });

    expect(result.success).toBe(false);
    expect(result.slideHtml).toBe("<section>v2</section>");
    expect(result.error).toBe("Quality score 5 below threshold 6");
    expect(result.retries).toBe(2);
    expect(runReactRefinerMock).toHaveBeenCalledTimes(2);
  });

  it("emits error events when refiner throws", async () => {
    const emit = vi.fn();
    runReactRefinerMock.mockRejectedValue(new Error("Boom"));

    const result = await runAutomatedRepair(createTask(), {
      emit,
      maxRetries: 1,
    });

    expect(emit).toHaveBeenCalledWith("design:repair.error", {
      actor: "design",
      status: "error",
      payload: { retry: 0, error: "Boom" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Boom");
    expect(result.retries).toBe(1);
  });

  it("returns max retries exceeded when maxRetries is zero", async () => {
    const result = await runAutomatedRepair(createTask(), { maxRetries: 0 });

    expect(result).toEqual({
      success: false,
      error: "Max retries exceeded",
      slideHtml: "<section>base</section>",
      retries: 0,
    });
    expect(runReactRefinerMock).not.toHaveBeenCalled();
  });

  it("accepts string numeric limits", async () => {
    const toolExecutor = vi.fn();
    createToolExecutorMock.mockReturnValue(toolExecutor);
    runReactRefinerMock.mockResolvedValue({
      qualityScore: 6,
      finalDeck: { deckHtmlDsl: "<section>ok</section>" },
      steps: [],
    });

    const result = await runAutomatedRepair(createTask(), {
      maxRetries: "1",
      maxStepsPerRetry: "2",
    });

    expect(result.success).toBe(true);
    expect(runReactRefinerMock).toHaveBeenCalledTimes(1);

    const optionsArg = runReactRefinerMock.mock.calls[0][2];
    expect(optionsArg.recommendedSteps).toBe("2");
    expect(optionsArg.hardLimit).toBe(4);
  });

  it("handles concurrent calls with large and whitespace html", async () => {
    const toolExecutor = vi.fn();
    createToolExecutorMock.mockReturnValue(toolExecutor);
    runReactRefinerMock.mockImplementation(async (deckPackage) => {
      return {
        qualityScore: 7,
        finalDeck: { deckHtmlDsl: `${deckPackage.deckHtmlDsl}-ok` },
        steps: [],
      };
    });

    const largeHtml = "a".repeat(200000);
    const whitespaceHtml = "   ";

    const [largeResult, whitespaceResult] = await Promise.all([
      runAutomatedRepair({ slideHtml: largeHtml, issues: [] }),
      runAutomatedRepair({ slideHtml: whitespaceHtml, issues: [] }),
    ]);

    expect(largeResult.slideHtml).toBe(`${largeHtml}-ok`);
    expect(whitespaceResult.slideHtml).toBe(`${whitespaceHtml}-ok`);
    expect(runReactRefinerMock).toHaveBeenCalledTimes(2);
  });

  it("handles rapid sequential calls independently", async () => {
    const toolExecutor = vi.fn();
    createToolExecutorMock.mockReturnValue(toolExecutor);
    runReactRefinerMock.mockImplementation(async (deckPackage) => ({
      qualityScore: 6,
      finalDeck: { deckHtmlDsl: `${deckPackage.deckHtmlDsl}-ok` },
      steps: [],
    }));

    const first = await runAutomatedRepair({ slideHtml: "<a/>", issues: [] });
    const second = await runAutomatedRepair({ slideHtml: "<b/>", issues: [] });

    expect(first.slideHtml).toBe("<a/>-ok");
    expect(second.slideHtml).toBe("<b/>-ok");
    expect(runReactRefinerMock).toHaveBeenCalledTimes(2);
  });
});

describe("repairSlides", () => {
  it("repairs slides and emits progress", async () => {
    const emit = vi.fn();
    createToolExecutorMock.mockReturnValue(vi.fn());
    runReactRefinerMock.mockImplementation(async (deckPackage) => {
      const intentId = deckPackage.slidesMeta[0].slideIntentId;
      if (intentId === "s1") {
        return {
          qualityScore: 6,
          finalDeck: { deckHtmlDsl: "<section>fixed-a</section>" },
          steps: ["step"],
        };
      }
      return {
        qualityScore: 4,
        finalDeck: { deckHtmlDsl: "<section>fixed-b</section>" },
        steps: [],
      };
    });

    const failedSlides = [
      {
        slideIndex: 0,
        slideHtml: "<section>a</section>",
        qaResult: { pass: false, score: 2, issues: ["i1"] },
        slideIntent: { slideIntentId: "s1" },
      },
      {
        slideIndex: 1,
        slideHtml: "<section>b</section>",
        qaResult: { pass: false, score: 1, issues: ["i2"] },
        slideIntent: { slideIntentId: "s2" },
      },
    ];

    const result = await repairSlides(failedSlides, { emit, maxRetries: 1 });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      slideIndex: 0,
      slideIntentId: "s1",
      success: true,
      slideHtml: "<section>fixed-a</section>",
    });
    expect(result.results[1]).toMatchObject({
      slideIndex: 1,
      slideIntentId: "s2",
      success: false,
      slideHtml: "<section>fixed-b</section>",
    });
    expect(result.summary).toEqual({ total: 2, success: 1, failed: 1 });

    expect(emit).toHaveBeenNthCalledWith(1, "design:repair.progress", {
      actor: "design",
      status: "progress",
      payload: { completed: 1, total: 2, success: true },
    });
    expect(emit).toHaveBeenNthCalledWith(2, "design:repair.progress", {
      actor: "design",
      status: "progress",
      payload: { completed: 2, total: 2, success: false },
    });
  });

  it("stops when signal is aborted between slides", async () => {
    const controller = new AbortController();
    createToolExecutorMock.mockReturnValue(vi.fn());
    runReactRefinerMock.mockImplementation(async () => {
      controller.abort();
      return {
        qualityScore: 6,
        finalDeck: { deckHtmlDsl: "<section>fixed</section>" },
        steps: [],
      };
    });

    const failedSlides = [
      {
        slideIndex: 0,
        slideHtml: "<section>a</section>",
        qaResult: { pass: false, score: 2, issues: ["i1"] },
        slideIntent: { slideIntentId: "s1" },
      },
      {
        slideIndex: 1,
        slideHtml: "<section>b</section>",
        qaResult: { pass: false, score: 1, issues: ["i2"] },
        slideIntent: { slideIntentId: "s2" },
      },
    ];

    const result = await repairSlides(failedSlides, {
      signal: controller.signal,
      maxRetries: 1,
    });

    expect(result.results).toHaveLength(1);
    expect(result.summary).toEqual({ total: 2, success: 1, failed: 1 });
    expect(runReactRefinerMock).toHaveBeenCalledTimes(1);
  });

  it("handles empty failedSlides", async () => {
    const result = await repairSlides([], {});

    expect(result).toEqual({
      results: [],
      summary: { total: 0, success: 0, failed: 0 },
    });
    expect(runReactRefinerMock).not.toHaveBeenCalled();
  });
});

describe("integrateRepairIntoGeneration", () => {
  it("returns original data when no slides fail QA", async () => {
    validateSlideMock.mockReturnValue({ pass: true });

    const slideHtmls = ["<section>a</section>", "<section>b</section>"];
    const slidesMeta = [{ id: 1 }, { id: 2 }];
    const slideIntents = [{ slideIntentId: "s1" }, { slideIntentId: "s2" }];

    const result = await integrateRepairIntoGeneration(
      slideHtmls,
      slidesMeta,
      slideIntents,
      {}
    );

    expect(result.slideHtmls).toBe(slideHtmls);
    expect(result.slidesMeta).toBe(slidesMeta);
    expect(result.repaired).toBe(0);
    expect(result.repairSummary).toBe(undefined);
    expect(runReactRefinerMock).not.toHaveBeenCalled();
  });

  it("repairs failed slides and updates metadata", async () => {
    validateSlideMock.mockImplementation((html) => {
      if (html === "bad") {
        return { pass: false, score: 2, issues: ["Missing title"] };
      }
      return { pass: true, score: 9, issues: [] };
    });

    createToolExecutorMock.mockReturnValue(vi.fn());
    runReactRefinerMock.mockResolvedValue({
      qualityScore: 6,
      finalDeck: { deckHtmlDsl: "fixed" },
      steps: ["step"],
    });

    const slideHtmls = ["bad", "good"];
    const slidesMeta = [{ id: 1 }, { id: 2 }];
    const slideIntents = [{ slideIntentId: "s1" }, { slideIntentId: "s2" }];

    const result = await integrateRepairIntoGeneration(
      slideHtmls,
      slidesMeta,
      slideIntents,
      { maxRetries: 1 }
    );

    expect(result.slideHtmls[0]).toBe("fixed");
    expect(result.slideHtmls[1]).toBe("good");
    expect(result.slidesMeta[0]).toEqual({ id: 1, repaired: true, source: "repair" });
    expect(result.slidesMeta[1]).toEqual({ id: 2 });
    expect(result.repaired).toBe(1);
    expect(result.repairSummary).toEqual({ total: 1, success: 1, failed: 0 });
  });
});
