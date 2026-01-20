import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    robustParseJson: vi.fn(),
    injectSystemHint: vi.fn(),
    extractJsonCandidate: vi.fn(),
  };
});

import {
  TOOL_REGISTRY,
  runReactRefiner,
  __test,
} from "../../../../../../js/agents/stages/design/refiner/react-refiner.js";
import {
  robustParseJson,
  injectSystemHint,
  extractJsonCandidate,
} from "../../../../../../js/agents/shared/index.js";

const makeDeck = (overrides = {}) => ({
  deckHtmlDsl: "<section></section>",
  slidesMeta: [],
  imageSlots: [],
  ...overrides,
});

const json = (value) => JSON.stringify(value);

const makeFinishStep = (overrides = {}) => ({
  thought: "done",
  finish: {
    qualityScore: 8,
    remainingIssues: 0,
    refinements: [],
    ...overrides,
  },
});

const makeActionStep = (tool = "editSlide", params = {}) => ({
  thought: "edit",
  action: { tool, params },
});

const makeAiService = (content) => ({
  chat: vi.fn().mockResolvedValue({ content }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(injectSystemHint).mockImplementation((messages) => messages);
  vi.mocked(extractJsonCandidate).mockImplementation((content) =>
    typeof content === "string" ? content : ""
  );
  vi.mocked(robustParseJson).mockImplementation((content) => JSON.parse(content));
});

describe("TOOL_REGISTRY", () => {
  it("exposes generation and edit tool lists", () => {
    expect(TOOL_REGISTRY.generation).toEqual([
      "getSlideContent",
      "getSlideContext",
      "screenshot",
      "screenshotAll",
      "editSlide",
      "editElement",
    ]);
    expect(TOOL_REGISTRY.edit).toEqual([
      "getSlideContent",
      "getSlideContext",
      "screenshot",
      "screenshotAll",
      "editSlide",
      "editElement",
      "addSlide",
      "deleteSlide",
      "reorderSlides",
      "diff",
      "revert",
      "saveCheckpoint",
    ]);
  });
});

describe("__test.getAvailableTools", () => {
  it("returns generation tools for non-edit inputs", () => {
    expect(__test.getAvailableTools()).toEqual(TOOL_REGISTRY.generation);
    expect(__test.getAvailableTools(null)).toEqual(TOOL_REGISTRY.generation);
    expect(__test.getAvailableTools(undefined)).toEqual(
      TOOL_REGISTRY.generation
    );
    expect(__test.getAvailableTools("")).toEqual(TOOL_REGISTRY.generation);
    expect(__test.getAvailableTools("   ")).toEqual(TOOL_REGISTRY.generation);
    expect(__test.getAvailableTools({})).toEqual(TOOL_REGISTRY.generation);
  });

  it("returns edit tools for edit inputs", () => {
    expect(__test.getAvailableTools("edit")).toEqual(TOOL_REGISTRY.edit);
    expect(__test.getAvailableTools(" EDIT ")).toEqual(TOOL_REGISTRY.edit);
  });
});

describe("__test.validateStepSchema", () => {
  it("rejects non-objects and missing action/finish", () => {
    expect(__test.validateStepSchema(null).valid).toBe(false);
    expect(__test.validateStepSchema(undefined).valid).toBe(false);
    expect(__test.validateStepSchema("").valid).toBe(false);
    expect(__test.validateStepSchema([]).valid).toBe(false);
    expect(__test.validateStepSchema({}).error).toMatch(
      /either 'action' or 'finish'/
    );
    expect(__test.validateStepSchema({ action: {}, finish: {} }).error).toMatch(
      /cannot have both/
    );
  });

  it("validates action schema boundaries", () => {
    expect(
      __test.validateStepSchema({
        thought: "t",
        action: { tool: "editSlide", params: {} },
      })
    ).toEqual({ valid: true });

    expect(
      __test.validateStepSchema({ action: { tool: "", params: {} } }).error
    ).toMatch(/must specify 'tool'/);
    expect(
      __test.validateStepSchema({ action: { tool: "   ", params: {} } }).error
    ).toMatch(/must specify 'tool'/);
    expect(
      __test.validateStepSchema({ action: { tool: "editSlide", params: null } })
        .error
    ).toMatch(/provide 'params' object/);
    expect(
      __test.validateStepSchema({ action: { tool: "editSlide", params: [] } })
        .error
    ).toMatch(/provide 'params' object/);
  });

  it("validates finish schema boundaries", () => {
    expect(
      __test.validateStepSchema({
        finish: { qualityScore: 1, remainingIssues: 0, refinements: [] },
      }).valid
    ).toBe(true);
    expect(
      __test.validateStepSchema({
        finish: {
          qualityScore: 10,
          remainingIssues: Number.MAX_SAFE_INTEGER,
          refinements: [],
        },
      }).valid
    ).toBe(true);

    expect(
      __test.validateStepSchema({
        finish: { qualityScore: 0, remainingIssues: 0, refinements: [] },
      }).error
    ).toMatch(/qualityScore must be 1-10/);
    expect(
      __test.validateStepSchema({
        finish: { qualityScore: 11, remainingIssues: 0, refinements: [] },
      }).error
    ).toMatch(/qualityScore must be 1-10/);
    expect(
      __test.validateStepSchema({
        finish: { qualityScore: -1, remainingIssues: 0, refinements: [] },
      }).error
    ).toMatch(/qualityScore must be 1-10/);
    expect(
      __test.validateStepSchema({
        finish: { qualityScore: 7, remainingIssues: -1, refinements: [] },
      }).error
    ).toMatch(/remainingIssues must be >= 0/);
    expect(
      __test.validateStepSchema({
        finish: { qualityScore: "7", remainingIssues: 0, refinements: [] },
      }).error
    ).toMatch(/qualityScore must be 1-10/);
    expect(
      __test.validateStepSchema({
        finish: { qualityScore: 7, remainingIssues: "1", refinements: [] },
      }).error
    ).toMatch(/remainingIssues must be >= 0/);
    expect(
      __test.validateStepSchema({
        finish: { qualityScore: 7, remainingIssues: 0, refinements: {} },
      }).error
    ).toMatch(/refinements array/);
  });
});

describe("__test.validateFinishConditions", () => {
  it("accepts numeric inputs including boundary values", () => {
    expect(
      __test.validateFinishConditions({ qualityScore: 0, remainingIssues: 0 })
        .accepted
    ).toBe(true);
    expect(
      __test.validateFinishConditions({
        qualityScore: -1,
        remainingIssues: -1,
      }).accepted
    ).toBe(true);
    expect(
      __test.validateFinishConditions({
        qualityScore: 9,
        remainingIssues: Number.MAX_SAFE_INTEGER,
      }).accepted
    ).toBe(true);
  });

  it("rejects invalid or missing inputs", () => {
    expect(
      __test.validateFinishConditions({ qualityScore: "1", remainingIssues: 0 })
        .accepted
    ).toBe(false);
    expect(
      __test.validateFinishConditions({ qualityScore: 1, remainingIssues: "0" })
        .accepted
    ).toBe(false);
    expect(
      __test.validateFinishConditions({ qualityScore: null, remainingIssues: 0 })
        .accepted
    ).toBe(false);
    expect(
      __test.validateFinishConditions({ qualityScore: 1, remainingIssues: null })
        .accepted
    ).toBe(false);
    expect(__test.validateFinishConditions({}).accepted).toBe(false);
  });
});

describe("runReactRefiner", () => {
  it("throws on invalid inputs", async () => {
    await expect(
      runReactRefiner(null, {}, { toolExecutor: vi.fn() })
    ).rejects.toThrow(TypeError);
    await expect(
      runReactRefiner(makeDeck(), null, { toolExecutor: vi.fn() })
    ).rejects.toThrow(TypeError);
    await expect(
      runReactRefiner(makeDeck(), {}, { toolExecutor: null })
    ).rejects.toThrow(TypeError);
  });

  it("throws when aiApiService.chat is missing", async () => {
    await expect(
      runReactRefiner(makeDeck(), { stageApi: {} }, { toolExecutor: vi.fn() })
    ).rejects.toThrow("runReactRefiner: stageApi.aiApiService.chat is required");
  });

  it("returns hard_limit without model calls when hardLimit is 0", async () => {
    const aiApiService = makeAiService(json(makeFinishStep()));
    const result = await runReactRefiner(
      makeDeck(),
      { stageApi: { aiApiService } },
      { toolExecutor: vi.fn(), hardLimit: 0 }
    );

    expect(aiApiService.chat).not.toHaveBeenCalled();
    expect(result.steps).toEqual([]);
    expect(result.terminationReason).toBe("hard_limit");
    expect(result.qualityScore).toBe(6);
  });

  it("throws on cancellation before any model call", async () => {
    const controller = new AbortController();
    controller.abort("stop");
    const aiApiService = makeAiService(json(makeFinishStep()));
    const checkCancelled = vi.fn();

    await expect(
      runReactRefiner(
        makeDeck(),
        {
          stageApi: { aiApiService, signal: controller.signal, checkCancelled },
        },
        { toolExecutor: vi.fn() }
      )
    ).rejects.toThrow("stop");

    expect(checkCancelled).toHaveBeenCalledTimes(1);
    expect(aiApiService.chat).not.toHaveBeenCalled();
  });

  it("retries once when JSON candidate is missing", async () => {
    const aiApiService = makeAiService("not-json");
    vi.mocked(extractJsonCandidate).mockReturnValue(null);
    const onStep = vi.fn();

    const result = await runReactRefiner(
      makeDeck(),
      { stageApi: { aiApiService } },
      { toolExecutor: vi.fn(), hardLimit: 1, onStep }
    );

    expect(aiApiService.chat).toHaveBeenCalledTimes(2);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].observation.error).toMatch(/No JSON candidate/);
    expect(result.terminationReason).toBe("hard_limit");
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it("records validation errors for invalid step schema", async () => {
    const aiApiService = makeAiService(json({}));

    const result = await runReactRefiner(
      makeDeck(),
      { stageApi: { aiApiService } },
      { toolExecutor: vi.fn(), hardLimit: 1 }
    );

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].observation.error).toMatch(/Validation failed/);
    expect(result.toolCalls).toHaveLength(0);
  });

  it("skips unavailable tools in generation mode", async () => {
    const aiApiService = makeAiService(json(makeActionStep("deleteSlide")));
    const toolExecutor = vi.fn();

    const result = await runReactRefiner(
      makeDeck(),
      { stageApi: { aiApiService } },
      { toolExecutor, hardLimit: 1, mode: "generation" }
    );

    expect(toolExecutor).not.toHaveBeenCalled();
    expect(result.steps[0].observation.error).toMatch(/not available/);
    expect(result.toolCalls).toHaveLength(0);
  });

  it("executes tools and updates deck when tool succeeds", async () => {
    const aiApiService = makeAiService(json(makeActionStep("editSlide", { id: 1 })));
    const updatedDeck = makeDeck({ deckHtmlDsl: "<section>updated</section>" });
    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: { deckPackage: updatedDeck },
    });

    const result = await runReactRefiner(
      makeDeck(),
      { stageApi: { aiApiService } },
      { toolExecutor, hardLimit: 1 }
    );

    expect(toolExecutor).toHaveBeenCalledWith("editSlide", { id: 1 });
    expect(result.finalDeck.deckHtmlDsl).toBe(updatedDeck.deckHtmlDsl);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].result.success).toBe(true);
  });

  it("captures tool executor errors without throwing", async () => {
    const aiApiService = makeAiService(json(makeActionStep("editSlide")));
    const toolExecutor = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await runReactRefiner(
      makeDeck(),
      { stageApi: { aiApiService } },
      { toolExecutor, hardLimit: 1 }
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].result.success).toBe(false);
    expect(result.toolCalls[0].result.error).toMatch(/boom/);
  });

  it("accepts finish, uses system hint, and handles large inputs", async () => {
    const longString = "x".repeat(100000);
    const deepConstraints = {
      level1: { level2: { level3: { level4: { level5: "value" } } } },
    };
    const deck = makeDeck({
      deckHtmlDsl: longString,
      designSystem: {
        theme: "large",
        designTokens: {
          colors: { background: { base: "#fff" } },
          typography: { fontFamily: "Serif", scale: { base: 1 } },
          constraints: deepConstraints,
        },
      },
    });
    const aiApiService = makeAiService(
      json(makeFinishStep({ qualityScore: 9, remainingIssues: 1 }))
    );
    const onStep = vi.fn();

    const result = await runReactRefiner(
      deck,
      { stageApi: { aiApiService, runtimeHints: { system: "hint" } } },
      { toolExecutor: vi.fn(), hardLimit: 3, onStep }
    );

    expect(result.terminationReason).toBe("quality_met");
    expect(result.qualityScore).toBe(9);
    expect(injectSystemHint).toHaveBeenCalled();
    expect(injectSystemHint.mock.calls[0][1]).toBe("hint");
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it("supports concurrent runs without shared state", async () => {
    const aiA = makeAiService(
      json(makeFinishStep({ qualityScore: 7, remainingIssues: 2 }))
    );
    const aiB = makeAiService(
      json(makeFinishStep({ qualityScore: 8, remainingIssues: 0 }))
    );

    const [resA, resB] = await Promise.all([
      runReactRefiner(
        makeDeck({ deckHtmlDsl: "<section>a</section>" }),
        { stageApi: { aiApiService: aiA } },
        { toolExecutor: vi.fn(), hardLimit: 2 }
      ),
      runReactRefiner(
        makeDeck({ deckHtmlDsl: "<section>b</section>" }),
        { stageApi: { aiApiService: aiB } },
        { toolExecutor: vi.fn(), hardLimit: 2 }
      ),
    ]);

    expect(resA.qualityScore).toBe(7);
    expect(resB.qualityScore).toBe(8);
    expect(aiA.chat).toHaveBeenCalledTimes(1);
    expect(aiB.chat).toHaveBeenCalledTimes(1);
  });

  it("supports rapid consecutive runs", async () => {
    const aiApiService = makeAiService(json(makeFinishStep()));
    const context = { stageApi: { aiApiService } };

    const res1 = await runReactRefiner(makeDeck(), context, {
      toolExecutor: vi.fn(),
      hardLimit: 2,
    });
    const res2 = await runReactRefiner(makeDeck(), context, {
      toolExecutor: vi.fn(),
      hardLimit: 2,
    });

    expect(aiApiService.chat).toHaveBeenCalledTimes(2);
    expect(res1.terminationReason).toBe("quality_met");
    expect(res2.terminationReason).toBe("quality_met");
  });
});
