import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const runReactRefinerMock = vi.fn();
  const createToolExecutorMock = vi.fn();
  const sanitizeHtmlFragmentMock = vi.fn();
  const loggerWarnMock = vi.fn();
  const loggerErrorMock = vi.fn();
  const createLoggerMock = vi.fn(() => ({ warn: loggerWarnMock, error: loggerErrorMock }));

  return {
    runReactRefinerMock,
    createToolExecutorMock,
    sanitizeHtmlFragmentMock,
    loggerWarnMock,
    loggerErrorMock,
    createLoggerMock,
  };
});

vi.mock("../../../../../../js/agents/stages/design/refiner/react-refiner.js", () => ({
  runReactRefiner: mocks.runReactRefinerMock,
}));

vi.mock("../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js", () => ({
  createToolExecutor: mocks.createToolExecutorMock,
  sanitizeHtmlFragment: mocks.sanitizeHtmlFragmentMock,
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  createLogger: mocks.createLoggerMock,
}));

import { runBatchRepair, runSingleSlideRepair } from "../../../../../../js/agents/stages/design/refiner/batch-repair-agent.js";

const {
  runReactRefinerMock,
  createToolExecutorMock,
  sanitizeHtmlFragmentMock,
  loggerWarnMock,
  loggerErrorMock,
  createLoggerMock,
} = mocks;

beforeEach(() => {
  runReactRefinerMock.mockReset();
  createToolExecutorMock.mockReset();
  sanitizeHtmlFragmentMock.mockReset();
  loggerWarnMock.mockClear();
  loggerErrorMock.mockClear();
  createLoggerMock.mockClear();
});

describe("runBatchRepair", () => {
  it("passes enriched context and options to runReactRefiner", async () => {
    const deckPackage = { id: "deck" };
    const runContext = { contentPackage: { slides: ["s1"] } };
    const stageApi = { emit: vi.fn() };
    const toolExecutor = vi.fn();

    createToolExecutorMock.mockReturnValue(toolExecutor);

    const expected = {
      finalDeck: { id: "final" },
      steps: [],
      qualityScore: 7,
      toolCalls: [],
      terminationReason: "done",
    };
    runReactRefinerMock.mockResolvedValue(expected);

    const params = {
      deckPackage,
      qaIssues: ["q1"],
      styleIssues: ["s1"],
      designSystem: { theme: "x" },
    };
    const context = {
      stageApi,
      runContext,
      aiApiService: { chat: vi.fn() },
      modelRouter: () => "m",
    };

    const result = await runBatchRepair(params, context);

    expect(result).toBe(expected);
    expect(createToolExecutorMock).toHaveBeenCalledWith({
      deckPackage,
      contentPackage: runContext.contentPackage,
      stageApi,
    });

    const [deckArg, contextArg, optionsArg] = runReactRefinerMock.mock.calls[0];
    expect(deckArg).toBe(deckPackage);
    expect(contextArg.initialIssues).toEqual({ qaIssues: ["q1"], styleIssues: ["s1"] });
    expect(contextArg.runContext).toBe(runContext);
    expect(contextArg.stageApi).toBe(stageApi);
    expect(optionsArg.mode).toBe("edit");
    expect(optionsArg.recommendedSteps).toBe(8);
    expect(optionsArg.hardLimit).toBe(20);
    expect(optionsArg.toolExecutor).toBe(toolExecutor);
    expect(optionsArg.systemPromptOverride).toContain("Design Orchestrator");

    const step = { stepId: 1 };
    optionsArg.onStep(step);
    expect(stageApi.emit).toHaveBeenCalledWith("design:batchRepair.step", {
      actor: "design",
      status: "progress",
      payload: step,
    });
  });

  it("defaults issues and contentPackage when missing", async () => {
    const deckPackage = { id: "deck" };
    createToolExecutorMock.mockReturnValue(vi.fn());
    runReactRefinerMock.mockResolvedValue({
      finalDeck: {},
      steps: [],
      qualityScore: 0,
      toolCalls: [],
      terminationReason: "done",
    });

    await runBatchRepair({ deckPackage }, { stageApi: { emit: vi.fn() } });

    const [, contextArg] = runReactRefinerMock.mock.calls[0];
    expect(contextArg.initialIssues).toEqual({ qaIssues: [], styleIssues: [] });
    expect(createToolExecutorMock).toHaveBeenCalledWith({
      deckPackage,
      contentPackage: {},
      stageApi: expect.any(Object),
    });
  });

  it("preserves null issues and tolerates missing stageApi", async () => {
    createToolExecutorMock.mockReturnValue(vi.fn());
    runReactRefinerMock.mockResolvedValue({
      finalDeck: {},
      steps: [],
      qualityScore: 0,
      toolCalls: [],
      terminationReason: "done",
    });

    await runBatchRepair({ deckPackage: {}, qaIssues: null, styleIssues: null }, {});

    const [, contextArg, optionsArg] = runReactRefinerMock.mock.calls[0];
    expect(contextArg.initialIssues).toEqual({ qaIssues: null, styleIssues: null });
    expect(() => optionsArg.onStep({})).not.toThrow();
  });

  it("propagates runReactRefiner errors", async () => {
    createToolExecutorMock.mockReturnValue(vi.fn());
    runReactRefinerMock.mockRejectedValue(new Error("boom"));

    await expect(runBatchRepair({ deckPackage: {} }, { stageApi: { emit: vi.fn() } })).rejects.toThrow("boom");
  });

  it("handles concurrent calls independently", async () => {
    const deckA = { id: "A" };
    const deckB = { id: "B" };

    createToolExecutorMock
      .mockReturnValueOnce(vi.fn())
      .mockReturnValueOnce(vi.fn());

    runReactRefinerMock
      .mockResolvedValueOnce({ finalDeck: { id: "A" }, steps: [], qualityScore: 5, toolCalls: [], terminationReason: "done" })
      .mockResolvedValueOnce({ finalDeck: { id: "B" }, steps: [], qualityScore: 6, toolCalls: [], terminationReason: "done" });

    const [r1, r2] = await Promise.all([
      runBatchRepair({ deckPackage: deckA }, { stageApi: { emit: vi.fn() } }),
      runBatchRepair({ deckPackage: deckB, qaIssues: ["x"] }, { stageApi: { emit: vi.fn() } }),
    ]);

    expect(r1.finalDeck.id).toBe("A");
    expect(r2.finalDeck.id).toBe("B");
    expect(runReactRefinerMock).toHaveBeenCalledTimes(2);
    expect(runReactRefinerMock.mock.calls[0][0]).toBe(deckA);
    expect(runReactRefinerMock.mock.calls[1][0]).toBe(deckB);
  });
});

describe("runSingleSlideRepair", () => {
  it.each([
    {
      name: "null issues",
      params: { slideIndex: 0, currentHtml: "<section>keep</section>", issues: null, designSystem: {} },
      context: { aiApiService: { chat: vi.fn() } },
    },
    {
      name: "undefined issues",
      params: { slideIndex: 0, currentHtml: "<section>keep</section>", issues: undefined, designSystem: {} },
      context: { aiApiService: { chat: vi.fn() } },
    },
    {
      name: "empty array",
      params: { slideIndex: 0, currentHtml: "", issues: [], designSystem: {} },
      context: { aiApiService: { chat: vi.fn() } },
      expected: "",
    },
    {
      name: "empty string",
      params: { slideIndex: 0, currentHtml: "<section>keep</section>", issues: "", designSystem: {} },
      context: { aiApiService: { chat: vi.fn() } },
    },
    {
      name: "empty object",
      params: { slideIndex: 0, currentHtml: "<section>keep</section>", issues: {}, designSystem: {} },
      context: { aiApiService: { chat: vi.fn() } },
    },
    {
      name: "missing aiApiService",
      params: { slideIndex: 0, currentHtml: "   ", issues: ["x"], designSystem: {} },
      context: { aiApiService: null },
      expected: "   ",
    },
  ])("returns currentHtml when $name", async ({ params, context, expected }) => {
    const result = await runSingleSlideRepair(params, context);

    expect(result).toBe(expected ?? params.currentHtml);

    if (context.aiApiService?.chat) {
      expect(context.aiApiService.chat).not.toHaveBeenCalled();
    }
  });

  it("calls aiApiService.chat with prompts and modelRouter", async () => {
    const aiApiService = {
      chat: vi.fn().mockResolvedValue({ text: "<section data-el=\"t1\">OK</section>" }),
    };
    const modelRouter = vi.fn(() => "fixer-model");

    sanitizeHtmlFragmentMock.mockResolvedValue("  <section data-el=\"t1\">OK</section>  ");

    const params = {
      slideIndex: 0,
      currentHtml: "<section>Old</section>",
      issues: [{ issue: "overflow" }],
      designSystem: { colors: ["#000"] },
    };

    const result = await runSingleSlideRepair(params, { aiApiService, modelRouter, signal: "sig" });

    expect(modelRouter).toHaveBeenCalledWith("fixer");
    expect(aiApiService.chat).toHaveBeenCalledTimes(1);

    const call = aiApiService.chat.mock.calls[0][0];
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[1].content).toContain("Current HTML");
    expect(call.messages[1].content).toContain("Issues to fix");
    expect(call.messages[1].content).toContain("Design System");
    expect(call.model).toBe("fixer-model");
    expect(call.signal).toBe("sig");

    expect(sanitizeHtmlFragmentMock).toHaveBeenCalledTimes(1);
    expect(result).toBe("<section data-el=\"t1\">OK</section>");
  });

  it("strips fences and inline scripts/handlers before sanitization", async () => {
    const dirty = "```html\n<section><img src=\"x\" onerror=\"alert(1)\" onclick=alert(2)><script>alert(3)</script></section>\n```";
    const aiApiService = { chat: vi.fn().mockResolvedValue({ content: dirty }) };

    let capturedInput = "";
    sanitizeHtmlFragmentMock.mockImplementation(async (input) => {
      capturedInput = input;
      return input;
    });

    const result = await runSingleSlideRepair(
      { slideIndex: "0", currentHtml: "<section>Old</section>", issues: [{ issue: "x" }], designSystem: {} },
      { aiApiService, modelRouter: "not-a-fn" }
    );

    expect(capturedInput).toContain("<section>");
    expect(capturedInput).not.toMatch(/<script\b/i);
    expect(capturedInput).not.toMatch(/\sonerror=/i);
    expect(capturedInput).not.toMatch(/\sonclick=/i);
    expect(result).not.toMatch(/```/);
    expect(result).not.toMatch(/<script\b/i);
    expect(aiApiService.chat.mock.calls[0][0].model).toBeUndefined();
  });

  it("returns currentHtml when response lacks section block", async () => {
    const aiApiService = { chat: vi.fn().mockResolvedValue({ content: "no section here" }) };

    const currentHtml = "<section>Keep</section>";
    const result = await runSingleSlideRepair(
      { slideIndex: 1, currentHtml, issues: ["x"], designSystem: {} },
      { aiApiService }
    );

    expect(result).toBe(currentHtml);
    expect(sanitizeHtmlFragmentMock).not.toHaveBeenCalled();
  });

  it("logs warn when sanitizeHtmlFragment fails and returns cleaned html", async () => {
    const aiApiService = {
      chat: vi.fn().mockResolvedValue({ content: "<section><img onerror=\"x\"><script>bad</script></section>" }),
    };

    sanitizeHtmlFragmentMock.mockRejectedValue(new Error("sanitize fail"));

    const result = await runSingleSlideRepair(
      { slideIndex: 2, currentHtml: "<section>Orig</section>", issues: ["x"], designSystem: {} },
      { aiApiService }
    );

    expect(loggerWarnMock).toHaveBeenCalled();
    expect(result).toContain("<section>");
    expect(result).not.toMatch(/<script\b/i);
    expect(result).not.toMatch(/\sonerror=/i);
  });

  it("logs error when aiApiService.chat throws", async () => {
    const aiApiService = { chat: vi.fn().mockRejectedValue(new Error("boom")) };

    const currentHtml = "<section>Orig</section>";
    const result = await runSingleSlideRepair(
      { slideIndex: 3, currentHtml, issues: ["x"], designSystem: {} },
      { aiApiService }
    );

    expect(result).toBe(currentHtml);
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it("handles concurrent calls with shared aiApiService", async () => {
    const aiApiService = {
      chat: vi.fn()
        .mockResolvedValueOnce({ content: "<section>One</section>" })
        .mockResolvedValueOnce({ content: "<section>Two</section>" }),
    };

    sanitizeHtmlFragmentMock.mockImplementation(async (input) => input);

    const [r1, r2] = await Promise.all([
      runSingleSlideRepair({ slideIndex: 0, currentHtml: "<section>A</section>", issues: ["a"], designSystem: {} }, { aiApiService }),
      runSingleSlideRepair({ slideIndex: 1, currentHtml: "<section>B</section>", issues: ["b"], designSystem: {} }, { aiApiService }),
    ]);

    expect(r1).toContain("One");
    expect(r2).toContain("Two");
    expect(aiApiService.chat).toHaveBeenCalledTimes(2);
  });

  it("handles rapid sequential calls with boundary slideIndex values and long input", async () => {
    const longText = "A".repeat(20000);
    const longHtml = `<section>${longText}</section>`;
    const deepIssues = [{ id: 1, nested: { a: { b: { c: [1, { d: "x" }] } } } }];

    const aiApiService = { chat: vi.fn().mockResolvedValue({ content: "<section>OK</section>" }) };
    sanitizeHtmlFragmentMock.mockImplementation(async (input) => input);

    const indices = [0, -1, Number.MAX_SAFE_INTEGER, "0"];
    for (const index of indices) {
      const result = await runSingleSlideRepair(
        { slideIndex: index, currentHtml: longHtml, issues: deepIssues, designSystem: { font: "X" } },
        { aiApiService }
      );
      expect(result).toBe("<section>OK</section>");
    }

    expect(aiApiService.chat).toHaveBeenCalledTimes(indices.length);
  });
});
