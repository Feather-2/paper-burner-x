import { describe, it, expect, vi, beforeEach } from "vitest";

const logger = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(() => logger),
}));

vi.mock("../../../../../../js/agents/shared/utils/value-utils.js", () => ({
  deepClone: vi.fn(),
}));

vi.mock("../../../../../../js/agents/plugins/compression/index.js", () => ({
  Watchdog: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/design-helpers.js", () => ({
  DESIGN_LOOP_DEFAULTS: { signatureLength: 8 },
  buildDesignWatchdogAdvice: vi.fn(),
  emitStage: vi.fn(),
  resolveWatchdogSettings: vi.fn(),
  summarizeRefineEventForWatchdog: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/internal/visual-handler.js", () => ({
  VisualHandler: vi.fn(),
}));

import {
  DeckOperations,
  installDeckOperations,
  initWatchdogManager,
} from "../../../../../../js/agents/stages/design/internal/deck-operations.js";
import { deepClone } from "../../../../../../js/agents/shared/utils/value-utils.js";
import { Watchdog } from "../../../../../../js/agents/plugins/compression/index.js";
import {
  buildDesignWatchdogAdvice,
  emitStage,
  resolveWatchdogSettings,
  summarizeRefineEventForWatchdog,
} from "../../../../../../js/agents/stages/design/design-helpers.js";
import { VisualHandler } from "../../../../../../js/agents/stages/design/internal/visual-handler.js";

const createVisualHandler = (overrides = {}) => ({
  initDesignSystem: vi.fn(),
  buildVisualSlots: vi.fn(),
  renderVisuals: vi.fn(),
  ...overrides,
});

const createWatchdog = (overrides = {}) => ({
  reset: vi.fn(),
  configure: vi.fn(),
  tick: vi.fn(),
  recordOutput: vi.fn(),
  checkHealth: vi.fn().mockReturnValue({ healthy: true }),
  resetOscillation: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();

  VisualHandler.mockImplementation(function () {
    return createVisualHandler();
  });
  deepClone.mockImplementation((value) => JSON.parse(JSON.stringify(value)));
  resolveWatchdogSettings.mockReturnValue({
    maxRecentOutputs: 5,
    similarityThreshold: 0.6,
    maxTimeMs: 10000,
    stuckThresholdMs: 5000,
    maxConsecutiveSimilar: 3,
  });
  buildDesignWatchdogAdvice.mockReturnValue("advice");
  summarizeRefineEventForWatchdog.mockReturnValue("summary");
  Watchdog.mockImplementation(function (config) {
    return { ...createWatchdog(), config };
  });
});

describe("DeckOperations", () => {
  it("constructs VisualHandler and forwards initDesignSystem with empty/nullable inputs", () => {
    const loop = {};
    const deckOps = new DeckOperations(loop, { imageConcurrency: 2 });
    const visualInstance = VisualHandler.mock.results[0].value;

    visualInstance.initDesignSystem.mockReturnValue("ok");
    const result = deckOps.initDesignSystem({}, null, undefined, "");

    expect(VisualHandler).toHaveBeenCalledWith({ imageConcurrency: 2 });
    expect(visualInstance.initDesignSystem).toHaveBeenCalledWith({}, null, undefined, "");
    expect(result).toBe("ok");
  });

  it("buildVisualSlots forwards defaults with type boundaries and whitespace provider", () => {
    const deckOps = new DeckOperations({});
    const visualInstance = VisualHandler.mock.results[0].value;

    visualInstance.buildVisualSlots.mockReturnValue("slots");
    const result = deckOps.buildVisualSlots([], { not: "array" }, "   ");

    expect(visualInstance.buildVisualSlots).toHaveBeenCalledWith([], { not: "array" }, "   ", true);
    expect(result).toBe("slots");
  });

  it("renderVisuals deep clones array payloads and forwards long strings", async () => {
    const loop = { state: {} };
    const deckOps = new DeckOperations(loop);
    const visualInstance = VisualHandler.mock.results[0].value;

    const longHtml = "x".repeat(25000);
    const deepSlots = [
      { id: 1, nested: { levels: [{ value: longHtml, meta: { size: 0 } }] } },
    ];

    visualInstance.renderVisuals.mockResolvedValue("rendered");

    const result = await deckOps.renderVisuals(
      deepSlots,
      { content: longHtml },
      { theme: "classic" },
      [longHtml],
      { contextId: 0 },
      { runId: 0 },
      { constraints: {} },
      [],
      ["slot-1"]
    );

    expect(deepClone).toHaveBeenCalledWith(deepSlots);
    expect(loop.state.visualSlots).toEqual(deepClone.mock.results[0].value);
    expect(loop.state.visualSlots).not.toBe(deepSlots);
    expect(visualInstance.renderVisuals).toHaveBeenCalledWith(
      deepSlots,
      { content: longHtml },
      { theme: "classic" },
      [longHtml],
      { contextId: 0 },
      { runId: 0 },
      { constraints: {} },
      [],
      ["slot-1"]
    );
    expect(result).toBe("rendered");
  });

  it("renderVisuals handles non-array visualSlots and non-object state", async () => {
    const loop = { state: {} };
    const deckOps = new DeckOperations(loop);
    const visualInstance = VisualHandler.mock.results[0].value;

    visualInstance.renderVisuals.mockResolvedValue("ok");
    await deckOps.renderVisuals({ foo: "bar" }, null, null, [], null, null, null, null, null);
    expect(loop.state.visualSlots).toEqual([]);

    const loopNoState = { state: "invalid" };
    VisualHandler.mockImplementationOnce(function () {
      return createVisualHandler({ renderVisuals: vi.fn().mockResolvedValue("ok") });
    });
    const deckOpsNoState = new DeckOperations(loopNoState);
    await deckOpsNoState.renderVisuals([], {}, {}, [], {}, {}, {}, {}, {});
    expect(loopNoState.state).toBe("invalid");
  });

  it("renderVisuals propagates VisualHandler errors", async () => {
    const loop = { state: {} };
    const error = new Error("render failed");
    VisualHandler.mockImplementationOnce(function () {
      return createVisualHandler({ renderVisuals: vi.fn().mockRejectedValue(error) });
    });
    const deckOps = new DeckOperations(loop);

    await expect(
      deckOps.renderVisuals([], {}, {}, [], {}, {}, {}, {}, {})
    ).rejects.toThrow("render failed");
  });

  it("supports rapid consecutive renderVisuals calls", async () => {
    const loop = { state: {} };
    const deckOps = new DeckOperations(loop);
    const visualInstance = VisualHandler.mock.results[0].value;

    visualInstance.renderVisuals.mockResolvedValue("ok");
    const first = deckOps.renderVisuals([{ id: "a" }], {}, {}, [], {}, {}, {}, {}, {});
    const second = deckOps.renderVisuals([{ id: "b" }], {}, {}, [], {}, {}, {}, {}, {});

    await Promise.all([first, second]);

    expect(deepClone).toHaveBeenCalledTimes(2);
    expect(visualInstance.renderVisuals).toHaveBeenCalledTimes(2);
    expect(loop.state.visualSlots).toEqual(deepClone.mock.results[1].value);
  });
});

describe("installDeckOperations", () => {
  it("installs forwarding methods on the prototype", () => {
    class DeckHost {
      constructor(deckOps) {
        this._deckOps = deckOps;
      }
    }

    installDeckOperations(DeckHost);

    const deckOps = {
      initDesignSystem: vi.fn().mockReturnValue("system"),
      buildVisualSlots: vi.fn().mockReturnValue("slots"),
      renderVisuals: vi.fn().mockReturnValue("rendered"),
    };
    const host = new DeckHost(deckOps);

    const initResult = host._initDesignSystem({}, null, undefined, " ");
    const buildResult = host._buildVisualSlots([], { not: "array" }, "", undefined);
    const renderResult = host._renderVisuals([], {}, {}, [], {}, {}, {}, {}, {});

    expect(initResult).toBe("system");
    expect(deckOps.initDesignSystem).toHaveBeenCalledWith({}, null, undefined, " ");
    expect(buildResult).toBe("slots");
    expect(deckOps.buildVisualSlots).toHaveBeenCalledWith([], { not: "array" }, "", true);
    expect(renderResult).toBe("rendered");
    expect(deckOps.renderVisuals).toHaveBeenCalledWith([], {}, {}, [], {}, {}, {}, {}, {});
  });

  it("bubbles up errors from delegated methods", () => {
    class DeckHost {
      constructor(deckOps) {
        this._deckOps = deckOps;
      }
    }

    installDeckOperations(DeckHost);

    const deckOps = {
      initDesignSystem: vi.fn(),
      buildVisualSlots: vi.fn(() => {
        throw new Error("boom");
      }),
      renderVisuals: vi.fn(),
    };
    const host = new DeckHost(deckOps);

    expect(() => host._buildVisualSlots([], {}, "provider", false)).toThrow("boom");
  });
});

describe("initWatchdogManager", () => {
  it("prefers runContext userConfig and creates a watchdog when missing", async () => {
    const settings = {
      maxRecentOutputs: 0,
      similarityThreshold: 0,
      maxTimeMs: 1,
      stuckThresholdMs: 2,
      maxConsecutiveSimilar: 3,
    };
    resolveWatchdogSettings.mockReturnValue(settings);

    const offFn = vi.fn();
    const eventBus = { on: vi.fn(() => offFn) };
    const loop = {
      phaseRunner: { _resolveDependency: vi.fn().mockResolvedValue(null) },
      eventBus,
      _blackboard: { logDecision: vi.fn() },
    };
    const runContext = {
      userConfig: { source: "run", nested: { depth: { value: "y".repeat(2048) } } },
    };

    const result = await initWatchdogManager({
      loop,
      context: { userConfig: { source: "context" } },
      runContext,
      contentPackage: { userConfig: { source: "content" } },
      runId: 0,
      emit: vi.fn(),
      eventBus,
    });

    expect(resolveWatchdogSettings).toHaveBeenCalledWith(runContext.userConfig);
    expect(Watchdog).toHaveBeenCalledWith({
      eventBus: loop.eventBus,
      maxRecentOutputs: settings.maxRecentOutputs,
      oscillationThreshold: settings.similarityThreshold,
    });
    expect(loop._watchdog).toBe(result.watchdog);
    expect(loop.phaseRunner._resolveDependency).toHaveBeenCalledWith("watchdog", { userConfig: { source: "context" } }, null);
    expect(eventBus.on).toHaveBeenCalledWith("design:refine:step", expect.any(Function));
    expect(result.offRefineWatchdog).toBe(offFn);
  });

  it("reuses existing watchdog and throttles repeated health interventions", async () => {
    const settings = {
      maxRecentOutputs: 4,
      similarityThreshold: 0.9,
      maxTimeMs: 10,
      stuckThresholdMs: 20,
      maxConsecutiveSimilar: 2,
    };
    resolveWatchdogSettings.mockReturnValue(settings);

    const existingWatchdog = createWatchdog();
    const loop = {
      phaseRunner: { _resolveDependency: vi.fn().mockResolvedValue(existingWatchdog) },
      eventBus: {},
      phase: { status: "phase-1" },
      _blackboard: { logDecision: vi.fn() },
    };
    const emit = vi.fn();

    const { handleWatchdogHealth } = await initWatchdogManager({
      loop,
      context: {},
      runContext: {},
      contentPackage: {},
      runId: -1,
      emit,
      eventBus: null,
    });

    expect(existingWatchdog.reset).toHaveBeenCalled();
    expect(existingWatchdog.configure).toHaveBeenCalledWith({
      maxRecentOutputs: settings.maxRecentOutputs,
      oscillationThreshold: settings.similarityThreshold,
    });
    expect(Watchdog).not.toHaveBeenCalled();

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(2000).mockReturnValueOnce(2200);

    const health = { healthy: false, issues: ["oscillation"], stats: { count: 1 } };
    handleWatchdogHealth(health, { source: "manual" });
    handleWatchdogHealth(health, { source: "manual" });

    expect(buildDesignWatchdogAdvice).toHaveBeenCalledWith(["oscillation"]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(emitStage).toHaveBeenCalledWith(
      emit,
      "design.watchdog.intervention",
      "warn",
      expect.objectContaining({ runId: -1, source: "manual", issues: ["oscillation"] })
    );
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith(
      "watchdog_intervention",
      "advice",
      expect.objectContaining({ runId: -1, source: "manual" })
    );
    expect(existingWatchdog.resetOscillation).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it("tracks refine steps and ignores mismatched runId or empty summaries", async () => {
    const settings = {
      maxRecentOutputs: 2,
      similarityThreshold: 0.8,
      maxTimeMs: 1500,
      stuckThresholdMs: 200,
      maxConsecutiveSimilar: 1,
    };
    resolveWatchdogSettings.mockReturnValue(settings);

    const watchdog = createWatchdog({
      checkHealth: vi.fn().mockReturnValue({ healthy: false, issues: ["stuck"], stats: {} }),
    });
    const eventBus = { on: vi.fn() };
    const loop = {
      phaseRunner: { _resolveDependency: vi.fn().mockResolvedValue(watchdog) },
      eventBus,
      phase: { status: "visual" },
      _blackboard: { logDecision: vi.fn() },
    };
    let handler;
    eventBus.on.mockImplementation((_event, cb) => {
      handler = cb;
      return "off";
    });
    const emit = vi.fn();
    const runId = Number.MAX_SAFE_INTEGER;

    await initWatchdogManager({
      loop,
      context: {},
      runContext: {},
      contentPackage: {},
      runId,
      emit,
      eventBus,
    });

    handler({ runId: String(runId), payload: { stepIndex: -1 } });
    expect(summarizeRefineEventForWatchdog).not.toHaveBeenCalled();
    expect(watchdog.tick).not.toHaveBeenCalled();

    summarizeRefineEventForWatchdog.mockReturnValueOnce(null);
    handler({ runId, payload: { stepIndex: -1 } });
    expect(summarizeRefineEventForWatchdog).toHaveBeenCalledTimes(1);
    expect(watchdog.tick).not.toHaveBeenCalled();

    summarizeRefineEventForWatchdog.mockReturnValueOnce("summary");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5000);
    handler({ runId, payload: { stepIndex: -1 } });

    expect(watchdog.tick).toHaveBeenCalledTimes(1);
    expect(watchdog.recordOutput).toHaveBeenCalledWith("summary");
    expect(watchdog.checkHealth).toHaveBeenCalledWith({
      maxIterations: 200,
      maxTimeMs: settings.maxTimeMs,
      stuckThresholdMs: settings.stuckThresholdMs,
      oscillationConsecutiveThreshold: settings.maxConsecutiveSimilar,
    });
    expect(emitStage).toHaveBeenCalledWith(
      emit,
      "design.watchdog.intervention",
      "warn",
      expect.objectContaining({ runId, source: "refine_step", refineStep: -1, phase: "visual" })
    );
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith(
      "watchdog_intervention",
      "advice",
      expect.objectContaining({ runId, source: "refine_step" })
    );

    nowSpy.mockRestore();
  });

  it("returns null offRefineWatchdog when eventBus lacks a listener", async () => {
    const loop = {
      phaseRunner: { _resolveDependency: vi.fn().mockResolvedValue(null) },
      eventBus: {},
    };

    const result = await initWatchdogManager({
      loop,
      context: {},
      runContext: {},
      contentPackage: {},
      runId: 1,
      emit: vi.fn(),
      eventBus: {},
    });

    expect(result.offRefineWatchdog).toBeNull();
  });

  it("propagates dependency resolution errors", async () => {
    const loop = {
      phaseRunner: { _resolveDependency: vi.fn().mockRejectedValue(new Error("dependency failed")) },
      eventBus: {},
    };

    await expect(
      initWatchdogManager({
        loop,
        context: {},
        runContext: {},
        contentPackage: {},
        runId: 1,
        emit: vi.fn(),
        eventBus: null,
      })
    ).rejects.toThrow("dependency failed");
  });
});
