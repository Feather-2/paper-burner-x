import { describe, it, expect, vi, beforeEach } from "vitest";

const makeLargeString = (size = 100000) => "x".repeat(size);
const makeDeepObject = (depth = 8) => {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  cursor.value = "leaf";
  return root;
};
const makeTraceContext = () => {
  const span = { setAttributes: vi.fn() };
  const traceContext = {
    span,
    withSpan: vi.fn(async (name, fn, options) => {
      traceContext.lastName = name;
      traceContext.lastOptions = options;
      return await fn(span);
    }),
    startSpan: vi.fn(),
    endSpan: vi.fn(),
  };
  return traceContext;
};

const runtimeMocks = vi.hoisted(() => {
  let stepSeq = 0;
  const lifecycleInstances = [];

  class StagePausedError extends Error {
    constructor(message = "Paused") {
      super(message);
      this.name = "StagePausedError";
    }
  }

  class BaseAgentLoop {
    constructor({ actor, stageName, eventBus } = {}) {
      this.options = { actor, stageName, eventBus };
      this.eventBus = eventBus || null;
      this.emit = null;
      this._statusHistory = ["seed"];
      this._activeStep = null;
      this._loopStatus = "idle";
      this._pauseRequested = false;
      this._pauseReason = null;
      this.statusController = {
        get _loopStatus() {
          return this._owner._loopStatus;
        },
        set _loopStatus(value) {
          this._owner._loopStatus = value;
        },
        get _statusHistory() {
          return this._owner._statusHistory;
        },
        set _statusHistory(value) {
          this._owner._statusHistory = value;
        },
        get _pauseRequested() {
          return this._owner._pauseRequested;
        },
        set _pauseRequested(value) {
          this._owner._pauseRequested = value;
        },
        get _pauseReason() {
          return this._owner._pauseReason;
        },
        set _pauseReason(value) {
          this._owner._pauseReason = value;
        },
        _shouldPauseFromError: (...args) => this._shouldPauseFromError(...args),
        _createPauseError: (...args) => this._createPauseError(...args),
        _owner: this,
      };
      this.phaseRunner = {
        _resolveDependency: (...args) => this._resolveDependency(...args),
        _transitionPhase: (...args) => this._transitionPhase(...args),
      };
      this.stepRunner = {
        _beginStep: (...args) => this._beginStep(...args),
        _endStep: (...args) => this._endStep(...args),
      };
    }
  }

  const executeSpy = vi.fn(async () => ({ ok: true }));
  BaseAgentLoop.prototype.execute = executeSpy;
  BaseAgentLoop.prototype._beginStep = vi.fn(function (meta = {}) {
    stepSeq += 1;
    const stepInfo = {
      stepId: `step-${stepSeq}`,
      name: meta?.name ?? null,
      runId: meta?.runId ?? null,
      iteration: meta?.iteration ?? null,
      meta: meta?.meta ?? null,
      startedAt: Date.now(),
    };
    const controller = typeof AbortController !== "undefined" ? new AbortController() : { signal: null, abort() {} };
    this._activeStep = { ...stepInfo, signal: controller.signal, controller };
    return stepInfo;
  });
  BaseAgentLoop.prototype._endStep = vi.fn(function (stepInfo, options = {}) {
    this._activeStep = null;
    return { stepInfo, options };
  });
  BaseAgentLoop.prototype._shouldPauseFromError = vi.fn(() => false);
  BaseAgentLoop.prototype._createPauseError = vi.fn(function ({ runId } = {}) {
    return new StagePausedError(`Paused: ${runId || "unknown"}`);
  });
  BaseAgentLoop.prototype._resolveDependency = vi.fn(async function (serviceId, context, fallback) {
    if (context && typeof context === "object" && serviceId in context && context[serviceId] !== undefined) {
      return context[serviceId];
    }

    const container = context?.container || this._container;
    if (container && typeof container.tryGet === "function") {
      const fromTryGet = await container.tryGet(serviceId);
      if (fromTryGet !== undefined) return fromTryGet;
    }
    if (container && typeof container.get === "function") {
      try {
        const fromGet = await container.get(serviceId);
        if (fromGet !== undefined) return fromGet;
      } catch {
        return fallback;
      }
    }
    return fallback;
  });

  const AgentStatus = {
    IDLE: "idle",
    RUNNING: "running",
    COMPLETED: "completed",
    FAILED: "failed",
    PAUSED: "paused",
  };

  const createLifecycleEmitter = vi.fn(() => {
    const instance = {
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn(),
      phaseTransition: vi.fn(),
    };
    lifecycleInstances.push(instance);
    return instance;
  });

  const getEmitFn = vi.fn((ctx) => (typeof ctx?.emit === "function" ? ctx.emit : null));

  return {
    BaseAgentLoop,
    StagePausedError,
    AgentStatus,
    createLifecycleEmitter,
    getEmitFn,
    lifecycleInstances,
    executeSpy,
    resetStepSeq: () => {
      stepSeq = 0;
    },
  };
});

const statesMocks = vi.hoisted(() => ({
  DesignPhase: {
    IDLE: "idle",
    OUTLINE_PARSING: "outline_parsing",
    DECK_PLANNING: "deck_planning",
    LAYOUT_DEVELOPING: "layout_developing",
    GENERATING: "generating",
    REVIEWING: "reviewing",
    COMPLETED: "completed",
  },
}));

const phasesMocks = vi.hoisted(() => ({
  runPreparationPhase: vi.fn(),
  runGeneratingPhase: vi.fn(),
  runBatchRepairPhase: vi.fn(),
  runVisualPhase: vi.fn(),
  runReviewPhase: vi.fn(),
  runPlanningPhase: vi.fn(),
  runLayoutPhase: vi.fn(),
}));

const blackboardMocks = vi.hoisted(() => {
  const instances = [];
  class DesignBlackboard {
    constructor(options = {}) {
      this.options = options;
      this.setDeck = vi.fn();
      this.setSummary = vi.fn();
      this.saveVersion = vi.fn();
      this.logDecision = vi.fn();
      instances.push(this);
    }
  }
  return { DesignBlackboard, instances };
});

const designHelpersMocks = vi.hoisted(() => {
  class MockBacktrackError extends Error {
    constructor(targetPhase, label, reason) {
      super(`Backtrack to ${targetPhase} (${label}): ${reason}`);
      this.name = "BacktrackError";
      this.targetPhase = targetPhase;
      this.label = label;
      this.reason = reason;
    }
  }

  const DESIGN_LOOP_DEFAULTS = {
    batchSize: 4,
    batchConcurrency: 2,
    imageConcurrency: 3,
    maxIterations: 9,
    maxBacktrackAttempts: 2,
  };

  const errorBoundary = {
    wrap: vi.fn(async (fn, options) => {
      errorBoundary.lastOptions = options;
      return await fn();
    }),
  };

  const resolveErrorBoundary = vi.fn(() => errorBoundary);
  const resolveStageTraceContext = vi.fn();
  const createTracedAiApiService = vi.fn((svc) => svc);
  const createTracedModelRouter = vi.fn((router) => router);
  const emitStage = vi.fn();
  const loadDesignConcurrencyConfig = vi.fn(() => null);

  return {
    BacktrackError: MockBacktrackError,
    DESIGN_LOOP_DEFAULTS,
    resolveErrorBoundary,
    resolveStageTraceContext,
    createTracedAiApiService,
    createTracedModelRouter,
    emitStage,
    loadDesignConcurrencyConfig,
    errorBoundary,
  };
});

const deckOpsMocks = vi.hoisted(() => {
  const instances = [];
  const deckUpdateEmitter = vi.fn();

  class DeckOperations {
    constructor(loop, options = {}) {
      this.loop = loop;
      this.options = options;
      instances.push(this);
    }
  }

  const createDeckUpdateEmitter = vi.fn(() => deckUpdateEmitter);
  const finalizeDeck = vi.fn();
  const initWatchdogManager = vi.fn(async () => ({
    watchdog: { tick: vi.fn() },
    watchdogSettings: {},
    handleWatchdogHealth: vi.fn(),
    offRefineWatchdog: vi.fn(),
  }));
  const installDeckOperations = vi.fn();

  return {
    DeckOperations,
    createDeckUpdateEmitter,
    finalizeDeck,
    initWatchdogManager,
    installDeckOperations,
    instances,
    deckUpdateEmitter,
  };
});

const stateManagerMocks = vi.hoisted(() => {
  const installed = { value: false };
  const transitionToSpy = vi.fn(async function (newStatus, metadata = {}) {
    this._loopStatus = newStatus;
    this._lastTransition = { newStatus, metadata };
    return newStatus;
  });
  const transitionPhaseSpy = vi.fn(function (state, next) {
    if (state && typeof state === "object") state.status = next;
    return next;
  });
  const installStateManager = vi.fn((ctor) => {
    installed.value = true;
    ctor.prototype._transitionTo = transitionToSpy;
    ctor.prototype._transitionPhase = transitionPhaseSpy;
  });
  const createEmptyDesignLoopState = vi.fn(() => ({
    contentPackage: null,
    slideIntents: [],
    designSystem: null,
    deckHtmlDsl: "",
    slidesMeta: [],
    slideHtmls: [],
    degradedCount: 0,
    finalImageSlots: [],
    imageReport: null,
    visualReport: null,
    pendingImages: [],
    refineResult: null,
    reviewResult: null,
    layoutData: null,
    plans: null,
  }));
  const resumeDesignAgentLoop = vi.fn();

  return {
    installed,
    transitionToSpy,
    transitionPhaseSpy,
    installStateManager,
    createEmptyDesignLoopState,
    resumeDesignAgentLoop,
  };
});

const toolHandlerMocks = vi.hoisted(() => ({
  initDesignTooling: vi.fn(),
  installToolHandler: vi.fn(),
}));

const designToolsMocks = vi.hoisted(() => ({
  DESIGN_AGENT_TOOL_DEFINITIONS: { alpha: true, beta: "tool" },
}));

vi.mock("../../../../../js/agents/runtime/index.js", () => runtimeMocks);
vi.mock("../../../../../js/agents/stages/design/states.js", () => ({
  DesignPhase: statesMocks.DesignPhase,
}));
vi.mock("../../../../../js/agents/stages/design/internal/phases/index.js", () => ({
  runPreparationPhase: phasesMocks.runPreparationPhase,
  runGeneratingPhase: phasesMocks.runGeneratingPhase,
  runBatchRepairPhase: phasesMocks.runBatchRepairPhase,
  runVisualPhase: phasesMocks.runVisualPhase,
  runReviewPhase: phasesMocks.runReviewPhase,
  runPlanningPhase: phasesMocks.runPlanningPhase,
  runLayoutPhase: phasesMocks.runLayoutPhase,
}));
vi.mock("../../../../../js/agents/stages/design/internal/design-blackboard.js", () => ({
  DesignBlackboard: blackboardMocks.DesignBlackboard,
}));
vi.mock("../../../../../js/agents/stages/design/design-helpers.js", () => designHelpersMocks);
vi.mock("../../../../../js/agents/stages/design/internal/deck-operations.js", () => ({
  DeckOperations: deckOpsMocks.DeckOperations,
  createDeckUpdateEmitter: deckOpsMocks.createDeckUpdateEmitter,
  finalizeDeck: deckOpsMocks.finalizeDeck,
  initWatchdogManager: deckOpsMocks.initWatchdogManager,
  installDeckOperations: deckOpsMocks.installDeckOperations,
}));
vi.mock("../../../../../js/agents/stages/design/internal/state-manager.js", () => ({
  createEmptyDesignLoopState: stateManagerMocks.createEmptyDesignLoopState,
  installStateManager: stateManagerMocks.installStateManager,
  resumeDesignAgentLoop: stateManagerMocks.resumeDesignAgentLoop,
}));
vi.mock("../../../../../js/agents/stages/design/internal/tool-handler.js", () => ({
  initDesignTooling: toolHandlerMocks.initDesignTooling,
  installToolHandler: toolHandlerMocks.installToolHandler,
}));
vi.mock("../../../../../js/agents/stages/design/design-tools.js", () => ({
  DESIGN_AGENT_TOOL_DEFINITIONS: designToolsMocks.DESIGN_AGENT_TOOL_DEFINITIONS,
}));

import {
  DesignAgentLoop,
  DESIGN_AGENT_TOOL_DEFINITIONS,
  BacktrackError,
} from "../../../../../js/agents/stages/design/agent-loop.js";

beforeEach(() => {
  vi.clearAllMocks();
  runtimeMocks.lifecycleInstances.length = 0;
  blackboardMocks.instances.length = 0;
  deckOpsMocks.instances.length = 0;
  runtimeMocks.resetStepSeq();

  designHelpersMocks.loadDesignConcurrencyConfig.mockReturnValue(null);
  designHelpersMocks.resolveStageTraceContext.mockImplementation(() => makeTraceContext());
  designHelpersMocks.createTracedAiApiService.mockImplementation((svc) => svc);
  designHelpersMocks.createTracedModelRouter.mockImplementation((router) => router);
  designHelpersMocks.resolveErrorBoundary.mockReturnValue(designHelpersMocks.errorBoundary);
  designHelpersMocks.errorBoundary.wrap.mockImplementation(async (fn, options) => {
    designHelpersMocks.errorBoundary.lastOptions = options;
    return await fn();
  });

  stateManagerMocks.createEmptyDesignLoopState.mockImplementation(() => ({
    contentPackage: null,
    slideIntents: [],
    designSystem: null,
    deckHtmlDsl: "",
    slidesMeta: [],
    slideHtmls: [],
    degradedCount: 0,
    finalImageSlots: [],
    imageReport: null,
    visualReport: null,
    pendingImages: [],
    refineResult: null,
    reviewResult: null,
    layoutData: null,
    plans: null,
  }));

  runtimeMocks.getEmitFn.mockImplementation((ctx) => (typeof ctx?.emit === "function" ? ctx.emit : null));

  phasesMocks.runPreparationPhase.mockResolvedValue();
  phasesMocks.runPlanningPhase.mockResolvedValue();
  phasesMocks.runLayoutPhase.mockResolvedValue();
  phasesMocks.runGeneratingPhase.mockResolvedValue();
  phasesMocks.runBatchRepairPhase.mockResolvedValue();
  phasesMocks.runVisualPhase.mockResolvedValue();
  phasesMocks.runReviewPhase.mockResolvedValue();
});

describe("DESIGN_AGENT_TOOL_DEFINITIONS", () => {
  it("re-exports tool definitions from design-tools", () => {
    expect(DESIGN_AGENT_TOOL_DEFINITIONS).toBe(designToolsMocks.DESIGN_AGENT_TOOL_DEFINITIONS);
  });
});

describe("BacktrackError", () => {
  it("exposes BacktrackError from design-helpers", () => {
    const err = new BacktrackError("generating", "checkpoint-1", "reason");

    expect(err).toBeInstanceOf(designHelpersMocks.BacktrackError);
    expect(err.targetPhase).toBe("generating");
    expect(err.label).toBe("checkpoint-1");
    expect(err.reason).toBe("reason");
  });
});

describe("DesignAgentLoop", () => {
  it("delegates execute to BaseAgentLoop", async () => {
    const loop = new DesignAgentLoop();
    const runContext = { runId: "run-1" };
    const contentPackage = { slideIntents: [] };
    const stageApi = { user: "demo" };

    runtimeMocks.executeSpy.mockResolvedValueOnce({ ok: true });

    const result = await loop.execute(runContext, contentPackage, stageApi);

    expect(result).toEqual({ ok: true });
    expect(runtimeMocks.executeSpy).toHaveBeenCalledWith(runContext, contentPackage, stageApi);
  });

  describe("constructor", () => {
    it("initializes defaults and dependencies", () => {
      designHelpersMocks.loadDesignConcurrencyConfig.mockReturnValue({
        batchSize: 6,
        batchConcurrency: 3,
        imageConcurrency: 5,
      });

      const tools = { alpha: true };
      const memoryStore = { id: "memory" };
      const stateEngine = { id: "state" };
      const eventBus = { emit: vi.fn() };
      const container = { get: vi.fn() };

      const loop = new DesignAgentLoop({
        batchSize: "2",
        archive: "archive",
        eventBus,
        tools,
        memoryStore,
        stateEngine,
        container,
      });

      expect(loop.options).toEqual({ actor: "design", stageName: "design", eventBus });
      expect(loop.batchSize).toBe(2);
      expect(loop.batchConcurrency).toBe(3);
      expect(loop.imageConcurrency).toBe(5);
      expect(deckOpsMocks.instances[0].options).toEqual({ imageConcurrency: 5 });
      expect(toolHandlerMocks.initDesignTooling).toHaveBeenCalledWith(loop, tools);
      expect(loop.phase).toEqual({ status: statesMocks.DesignPhase.IDLE });
      expect(loop.getStatus()).toBe(runtimeMocks.AgentStatus.IDLE);
      expect(loop._maxIterations).toBe(designHelpersMocks.DESIGN_LOOP_DEFAULTS.maxIterations);
      expect(loop._blackboard).toBe(blackboardMocks.instances[0]);
      expect(blackboardMocks.instances[0].options).toEqual({ memoryStore, stateEngine });
      expect(loop._container).toBe(container);
      expect(loop._emit).toBe(null);
      expect(loop._resumeState).toBe(null);
      expect(stateManagerMocks.createEmptyDesignLoopState).toHaveBeenCalledTimes(1);
      expect(loop.state).toBe(stateManagerMocks.createEmptyDesignLoopState.mock.results[0].value);
      expect(loop._statusHistory.length).toBe(0);
    });

    it.each([
      { input: undefined, expected: 5 },
      { input: null, expected: 5 },
      { input: "", expected: 5 },
      { input: "   ", expected: 5 },
      { input: 0, expected: 5 },
      { input: -1, expected: 1 },
      { input: "3", expected: 3 },
      { input: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER },
      { input: { length: 1 }, expected: 5 },
    ])("normalizes batchSize from %p", ({ input, expected }) => {
      designHelpersMocks.loadDesignConcurrencyConfig.mockReturnValue({ batchSize: 5 });

      const loop = new DesignAgentLoop({ batchSize: input });

      expect(loop.batchSize).toBe(expected);
    });
  });

  describe("accessors", () => {
    it("returns the blackboard and falls back to defaults when state is missing", () => {
      const loop = new DesignAgentLoop();

      expect(loop.blackboard).toBe(blackboardMocks.instances[0]);

      loop.phase = null;
      loop._loopStatus = null;

      expect(loop.getPhase()).toBe(statesMocks.DesignPhase.IDLE);
      expect(loop.getStatus()).toBe(runtimeMocks.AgentStatus.IDLE);
    });
  });

  describe("_resolveDependency", () => {
    it("prefers context-provided services", async () => {
      const loop = new DesignAgentLoop({ container: { get: vi.fn() } });
      const context = { memoryStore: "context-store" };

      const result = await loop.phaseRunner._resolveDependency("memoryStore", context, "fallback");

      expect(result).toBe("context-store");
      expect(loop._container.get).not.toHaveBeenCalled();
    });

    it("uses container when context is missing", async () => {
      const container = { get: vi.fn().mockResolvedValue("container-store") };
      const loop = new DesignAgentLoop({ container });

      const result = await loop.phaseRunner._resolveDependency("memoryStore", {}, "fallback");

      expect(result).toBe("container-store");
      expect(container.get).toHaveBeenCalledWith("memoryStore");
    });

    it("falls back when container fails or is missing", async () => {
      const container = { get: vi.fn().mockRejectedValue(new Error("missing")) };
      const loop = new DesignAgentLoop({ container });

      const result = await loop.phaseRunner._resolveDependency("memoryStore", null, "fallback");

      expect(result).toBe("fallback");
      expect(container.get).toHaveBeenCalledWith("memoryStore");
    });
  });

  describe("run", () => {
    it("wraps execution with tracing and error boundary", async () => {
      const traceContext = makeTraceContext();
      designHelpersMocks.resolveStageTraceContext.mockReturnValue(traceContext);
      const tracedAi = { traced: "ai" };
      const tracedRouter = { traced: "router" };
      designHelpersMocks.createTracedAiApiService.mockReturnValue(tracedAi);
      designHelpersMocks.createTracedModelRouter.mockReturnValue(tracedRouter);

      const loop = new DesignAgentLoop();
      loop.state.designSystem = { theme: "ocean" };
      loop.state.deckHtmlDsl = 123;
      loop.state.slidesMeta = "bad";
      const prevTrace = { id: "prev" };
      loop._traceContext = prevTrace;

      const runCoreSpy = vi.spyOn(loop, "_runCore").mockResolvedValue({ ok: true });
      const contentPackage = {
        runId: "run-1",
        constraints: { layout: "wide" },
        userConfig: { errorBoundary: { degrade: false } },
        slideIntents: ["a", "b"],
      };
      const stageApi = {
        aiApiService: { id: "ai" },
        modelRouter: { id: "router" },
        errorBoundaryConfig: { degrade: true },
      };

      const result = await loop.run(contentPackage, stageApi);

      expect(result).toEqual({ ok: true });
      expect(designHelpersMocks.resolveStageTraceContext).toHaveBeenCalledWith(stageApi);
      expect(designHelpersMocks.createTracedAiApiService).toHaveBeenCalledWith(stageApi.aiApiService, traceContext);
      expect(designHelpersMocks.createTracedModelRouter).toHaveBeenCalledWith(stageApi.modelRouter, traceContext);
      expect(runCoreSpy).toHaveBeenCalledWith(
        contentPackage,
        expect.objectContaining({ traceContext, aiApiService: tracedAi, modelRouter: tracedRouter })
      );
      expect(designHelpersMocks.errorBoundary.wrap).toHaveBeenCalledTimes(1);
      const { context } = designHelpersMocks.errorBoundary.lastOptions || {};
      expect(context.stage).toBe("design");
      expect(context.runId).toBe("run-1");
      expect(context.shouldDegrade()).toBe(true);
      expect(context.fallbackFactory()).toEqual({
        schemaVersion: "0.1",
        runId: "run-1",
        designSystem: { theme: "ocean" },
        deckHtmlDsl: "",
        slidesMeta: [],
      });
      expect(traceContext.withSpan).toHaveBeenCalledWith(
        "design.run",
        expect.any(Function),
        expect.objectContaining({ attributes: { stage: "design", runId: "run-1" } })
      );
      expect(traceContext.span.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", slideCount: 2, batchSize: loop.batchSize })
      );
      expect(loop._traceContext).toBe(prevTrace);
    });

    it.each([
      {
        label: "stageApi errorBoundaryDegrade",
        contentPackage: { runId: "run-degrade-a" },
        stageApi: { errorBoundaryDegrade: true },
      },
      {
        label: "stageApi degradeOnError",
        contentPackage: { runId: "run-degrade-b" },
        stageApi: { degradeOnError: true },
      },
      {
        label: "runContext userConfig",
        contentPackage: { runId: "run-degrade-c" },
        stageApi: { runContext: { runId: "run-degrade-c", userConfig: { errorBoundary: { degrade: true } } } },
      },
      {
        label: "contentPackage userConfig",
        contentPackage: { runId: "run-degrade-d", userConfig: { errorBoundary: { degrade: true } } },
        stageApi: {},
      },
    ])("computes shouldDegrade from $label", async ({ contentPackage, stageApi }) => {
      const traceContext = makeTraceContext();
      designHelpersMocks.resolveStageTraceContext.mockReturnValue(traceContext);

      const loop = new DesignAgentLoop();
      vi.spyOn(loop, "_runCore").mockResolvedValue("ok");

      await expect(loop.run(contentPackage, stageApi)).resolves.toBe("ok");

      const { context } = designHelpersMocks.errorBoundary.lastOptions || {};
      expect(context.shouldDegrade()).toBe(true);
    });

    it("retries on BacktrackError and emits restart events", async () => {
      const traceContext = makeTraceContext();
      designHelpersMocks.resolveStageTraceContext.mockReturnValue(traceContext);

      const loop = new DesignAgentLoop();
      loop._emit = vi.fn();

      const backtrack = new BacktrackError("generating", "checkpoint-1", "reason");
      const runCoreSpy = vi
        .spyOn(loop, "_runCore")
        .mockRejectedValueOnce(backtrack)
        .mockResolvedValueOnce({ ok: true });

      const result = await loop.run({ runId: "run-2" }, {});

      expect(result).toEqual({ ok: true });
      expect(runCoreSpy).toHaveBeenCalledTimes(2);
      expect(loop._emit).toHaveBeenCalledWith(
        "design.backtrack.restart",
        expect.objectContaining({
          attempt: 1,
          maxAttempts: designHelpersMocks.DESIGN_LOOP_DEFAULTS.maxBacktrackAttempts,
          targetPhase: "generating",
          reason: "reason",
        })
      );
    });

    it("propagates errors and restores trace context", async () => {
      const traceContext = makeTraceContext();
      designHelpersMocks.resolveStageTraceContext.mockReturnValue(traceContext);

      const loop = new DesignAgentLoop();
      const prevTrace = { id: "prev" };
      loop._traceContext = prevTrace;

      vi.spyOn(loop, "_runCore").mockRejectedValueOnce(new Error("boom"));

      await expect(loop.run({ runId: "run-3" }, {})).rejects.toThrow("boom");
      expect(loop._traceContext).toBe(prevTrace);
    });

    it("treats object-as-array slideIntents as empty for tracing", async () => {
      const traceContext = makeTraceContext();
      designHelpersMocks.resolveStageTraceContext.mockReturnValue(traceContext);

      const loop = new DesignAgentLoop();
      vi.spyOn(loop, "_runCore").mockResolvedValue("ok");

      const contentPackage = { runId: "run-4", slideIntents: { 0: "slide", length: 1 } };

      await loop.run(contentPackage, {});

      expect(traceContext.span.setAttributes).toHaveBeenCalledWith(expect.objectContaining({ slideCount: 0 }));
    });

    it.each([
      { label: "null inputs", contentPackage: null, context: null },
      { label: "undefined and empty string", contentPackage: undefined, context: "" },
      { label: "empty array and empty object", contentPackage: [], context: {} },
      { label: "zero and negative runIds", contentPackage: { runId: 0 }, context: { runContext: { runId: -1 } } },
      {
        label: "max safe and whitespace runId",
        contentPackage: { runId: Number.MAX_SAFE_INTEGER },
        context: { runContext: { runId: " " } },
      },
    ])("accepts boundary inputs: $label", async ({ contentPackage, context }) => {
      const traceContext = makeTraceContext();
      designHelpersMocks.resolveStageTraceContext.mockReturnValue(traceContext);

      const loop = new DesignAgentLoop();
      const runCoreSpy = vi.spyOn(loop, "_runCore").mockResolvedValue("ok");

      await expect(loop.run(contentPackage, context)).resolves.toBe("ok");
      const expectedPackage = contentPackage === undefined ? null : contentPackage;
      expect(runCoreSpy).toHaveBeenCalledWith(expectedPackage, expect.objectContaining({ traceContext }));
    });

    it("handles large payloads and deep nesting", async () => {
      const traceContext = makeTraceContext();
      designHelpersMocks.resolveStageTraceContext.mockReturnValue(traceContext);

      const loop = new DesignAgentLoop();
      const runCoreSpy = vi.spyOn(loop, "_runCore").mockResolvedValue({ ok: true });

      const longString = makeLargeString(120000);
      const deepObject = makeDeepObject(12);
      const contentPackage = {
        runId: "run-large",
        file: { name: "huge.bin", size: Number.MAX_SAFE_INTEGER, content: longString },
        constraints: { deep: deepObject },
        userConfig: { note: longString },
        slideIntents: [],
      };
      const context = { userConfig: deepObject };

      await expect(loop.run(contentPackage, context)).resolves.toEqual({ ok: true });
      expect(runCoreSpy).toHaveBeenCalledWith(contentPackage, expect.any(Object));
    });

    it("supports concurrent runs on separate instances", async () => {
      designHelpersMocks.resolveStageTraceContext.mockImplementation(() => makeTraceContext());

      const loopA = new DesignAgentLoop();
      const loopB = new DesignAgentLoop();

      vi.spyOn(loopA, "_runCore").mockResolvedValue({ runId: "a" });
      vi.spyOn(loopB, "_runCore").mockResolvedValue({ runId: "b" });

      const [a, b] = await Promise.all([
        loopA.run({ runId: "a" }, {}),
        loopB.run({ runId: "b" }, {}),
      ]);

      expect(a).toEqual({ runId: "a" });
      expect(b).toEqual({ runId: "b" });
    });

    it("handles rapid successive runs on the same instance", async () => {
      designHelpersMocks.resolveStageTraceContext.mockImplementation(() => makeTraceContext());

      const loop = new DesignAgentLoop();
      vi.spyOn(loop, "_runCore").mockImplementation(async (contentPackage) => contentPackage.runId);

      const results = [];
      for (const runId of ["r1", "r2", "r3"]) {
        results.push(await loop.run({ runId }, {}));
      }

      expect(results).toEqual(["r1", "r2", "r3"]);
    });
  });

  describe("_runCore", () => {
    it("runs phases and returns deck output", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), enableBackpressure: vi.fn(), _backpressure: { enabled: false } };
      const context = { runContext: { runId: "run-1" }, eventBus, enableFinalReview: true };

      phasesMocks.runGeneratingPhase.mockImplementation(async (target, { startExecution, finishExecution }) => {
        const { loopIteration, stepInfo } = await startExecution("generate");
        target.state.designSystem = { theme: "ocean" };
        target.state.deckHtmlDsl = "<section>deck</section>";
        target.state.slidesMeta = [{ id: "s1" }];
        target.state.slideHtmls = ["<section/>"];
        target.state.degradedCount = 2;
        target.state.finalImageSlots = ["slot-1"];
        target.state.imageReport = { ok: true };
        target.state.visualReport = { ok: true };
        target.state.pendingImages = ["img-1"];
        target.state.refineResult = { status: "ok" };
        target.state.reviewResult = { status: "ok" };
        await finishExecution("generate", loopIteration, stepInfo);
      });

      const result = await loop._runCore({ slideIntents: ["a"] }, context);

      expect(result).toEqual({
        schemaVersion: "0.1",
        runId: "run-1",
        designSystem: { theme: "ocean" },
        deckHtmlDsl: "<section>deck</section>",
        slidesMeta: [{ id: "s1" }],
        editHints: { degradedCount: 2 },
        imageSlots: ["slot-1"],
        imageReport: { ok: true },
        visualReport: { ok: true },
        pendingImages: ["img-1"],
        refineReport: { status: "ok" },
        reviewReport: { status: "ok" },
      });
      expect(phasesMocks.runPreparationPhase).toHaveBeenCalledTimes(1);
      expect(phasesMocks.runPlanningPhase).toHaveBeenCalledTimes(1);
      expect(phasesMocks.runLayoutPhase).toHaveBeenCalledTimes(1);
      expect(phasesMocks.runGeneratingPhase).toHaveBeenCalledTimes(1);
      expect(phasesMocks.runBatchRepairPhase).toHaveBeenCalledTimes(1);
      expect(phasesMocks.runVisualPhase).toHaveBeenCalledTimes(1);
      expect(phasesMocks.runReviewPhase).toHaveBeenCalledTimes(1);

      expect(stateManagerMocks.transitionToSpy).toHaveBeenCalledWith(runtimeMocks.AgentStatus.RUNNING, expect.any(Object));
      expect(stateManagerMocks.transitionToSpy).toHaveBeenCalledWith(runtimeMocks.AgentStatus.COMPLETED, expect.any(Object));
      expect(stateManagerMocks.transitionPhaseSpy).toHaveBeenCalledWith(
        loop.phase,
        statesMocks.DesignPhase.GENERATING,
        expect.any(Object)
      );
      expect(stateManagerMocks.transitionPhaseSpy).toHaveBeenCalledWith(
        loop.phase,
        statesMocks.DesignPhase.REVIEWING,
        expect.any(Object)
      );
      expect(stateManagerMocks.transitionPhaseSpy).toHaveBeenCalledWith(
        loop.phase,
        statesMocks.DesignPhase.COMPLETED,
        expect.any(Object)
      );

      expect(deckOpsMocks.finalizeDeck).toHaveBeenCalledWith(loop);
      expect(runtimeMocks.lifecycleInstances[0].started).toHaveBeenCalledWith("run-1", expect.any(Object));
      expect(runtimeMocks.lifecycleInstances[0].completed).toHaveBeenCalledWith("run-1", { slides: 1, degradedCount: 2 });
      expect(deckOpsMocks.createDeckUpdateEmitter).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", loop }));
      expect(phasesMocks.runVisualPhase).toHaveBeenCalledWith(
        loop,
        expect.objectContaining({ emitDeckUpdate: deckOpsMocks.deckUpdateEmitter })
      );
      expect(eventBus.enableBackpressure).toHaveBeenCalled();
    });

    it("reinitializes blackboard and dependencies when starting fresh", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), _backpressure: { enabled: true } };
      const memoryStore = { id: "memory-store" };
      const stateEngine = { id: "state-engine" };
      const contentPackage = { runId: "run-reset", slideIntents: [] };

      phasesMocks.runGeneratingPhase.mockImplementation(async (target) => {
        target.state.slideHtmls = ["slide"];
      });

      await loop._runCore(contentPackage, {
        runContext: { runId: "run-reset" },
        eventBus,
        memoryStore,
        stateEngine,
      });

      expect(blackboardMocks.instances.length).toBe(2);
      expect(blackboardMocks.instances[1].options).toEqual({
        runId: "run-reset",
        memoryStore,
        stateEngine,
      });
      expect(loop._memoryStore).toBe(memoryStore);
      expect(loop._stateEngine).toBe(stateEngine);
      expect(loop.state.contentPackage).toBe(contentPackage);
    });

    it("skips blackboard reset when resuming", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), _backpressure: { enabled: true } };
      const existingBlackboard = loop.blackboard;
      const existingContentPackage = { runId: "run-old" };
      loop.state.contentPackage = existingContentPackage;

      phasesMocks.runGeneratingPhase.mockImplementation(async (target) => {
        target.state.slideHtmls = ["slide"];
      });

      await loop._runCore({ runId: "run-new", slideIntents: [] }, { runContext: { runId: "run-new" }, eventBus, resumed: true });

      expect(blackboardMocks.instances.length).toBe(1);
      expect(loop.blackboard).toBe(existingBlackboard);
      expect(loop.state.contentPackage).toBe(existingContentPackage);
    });

    it("skips planning, layout, and review when disabled", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), _backpressure: { enabled: true } };
      const context = {
        runContext: { runId: "run-skip" },
        eventBus,
        enablePlanning: false,
        enableLayout: false,
        skipReview: true,
        enableFinalReview: true,
      };

      phasesMocks.runGeneratingPhase.mockImplementation(async (target) => {
        target.state.slideHtmls = ["slide"];
      });

      const result = await loop._runCore({ slideIntents: [] }, context);

      expect(phasesMocks.runPlanningPhase).not.toHaveBeenCalled();
      expect(phasesMocks.runLayoutPhase).not.toHaveBeenCalled();
      expect(phasesMocks.runReviewPhase).not.toHaveBeenCalled();
      expect(result.runId).toBe("run-skip");
    });

    it("respects backpressure disable flag", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), enableBackpressure: vi.fn(), _backpressure: { enabled: false } };
      const context = { runContext: { runId: "run-bp" }, eventBus, eventBusBackpressure: false };

      phasesMocks.runGeneratingPhase.mockImplementation(async (target) => {
        target.state.slideHtmls = ["slide"];
      });

      await loop._runCore({ slideIntents: [] }, context);

      expect(eventBus.enableBackpressure).not.toHaveBeenCalled();
    });

    it("applies backpressure configuration overrides", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), enableBackpressure: vi.fn(), _backpressure: { enabled: false } };
      const context = {
        runContext: { runId: "run-bp-override" },
        eventBus,
        eventBusBackpressure: { maxQueueSize: 50 },
      };

      phasesMocks.runGeneratingPhase.mockImplementation(async (target) => {
        target.state.slideHtmls = ["slide"];
      });

      await loop._runCore({ slideIntents: [] }, context);

      expect(eventBus.enableBackpressure).toHaveBeenCalledWith(
        expect.objectContaining({ maxQueueSize: 50, coalescePattern: expect.any(RegExp) })
      );
    });

    it("throws pause error when _shouldPauseFromError returns true", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), _backpressure: { enabled: true } };
      const pauseError = new runtimeMocks.StagePausedError("paused");
      loop._shouldPauseFromError = vi.fn(() => true);
      loop._createPauseError = vi.fn(() => pauseError);

      phasesMocks.runGeneratingPhase.mockImplementation(async (target, { startExecution }) => {
        await startExecution("generate");
        throw new Error("boom");
      });

      await expect(loop._runCore({ slideIntents: [] }, { runContext: { runId: "run-pause" }, eventBus }))
        .rejects.toBe(pauseError);

      expect(loop._createPauseError).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-pause" }));
      expect(stateManagerMocks.transitionToSpy).toHaveBeenCalledWith(runtimeMocks.AgentStatus.RUNNING, expect.any(Object));
      expect(stateManagerMocks.transitionToSpy.mock.calls.some(([status]) => status === runtimeMocks.AgentStatus.FAILED)).toBe(false);
      expect(runtimeMocks.lifecycleInstances[0].failed).not.toHaveBeenCalled();
      expect(runtimeMocks.BaseAgentLoop.prototype._endStep).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ status: "paused" })
      );
    });

    it("rethrows StagePausedError without failing the loop", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), _backpressure: { enabled: true } };
      const paused = new runtimeMocks.StagePausedError("paused");

      phasesMocks.runGeneratingPhase.mockRejectedValue(paused);

      await expect(loop._runCore({ slideIntents: [] }, { runContext: { runId: "run-pause-2" }, eventBus }))
        .rejects.toBe(paused);

      expect(stateManagerMocks.transitionToSpy.mock.calls.some(([status]) => status === runtimeMocks.AgentStatus.FAILED)).toBe(false);
      expect(runtimeMocks.lifecycleInstances[0].failed).not.toHaveBeenCalled();
    });

    it("transitions to failed on unexpected errors", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), _backpressure: { enabled: true } };
      const boom = new Error("boom");

      phasesMocks.runGeneratingPhase.mockRejectedValue(boom);

      await expect(loop._runCore({ slideIntents: [] }, { runContext: { runId: "run-fail" }, eventBus }))
        .rejects.toThrow("boom");

      expect(stateManagerMocks.transitionToSpy).toHaveBeenCalledWith(
        runtimeMocks.AgentStatus.FAILED,
        expect.objectContaining({ error: "boom" })
      );
      expect(runtimeMocks.lifecycleInstances[0].failed).toHaveBeenCalledWith("run-fail", boom);
    });

    it("rethrows BacktrackError without marking failure", async () => {
      const loop = new DesignAgentLoop();
      const eventBus = { emit: vi.fn(), _backpressure: { enabled: true } };
      const backtrack = new BacktrackError("generating", "checkpoint-2", "reason");

      phasesMocks.runGeneratingPhase.mockRejectedValue(backtrack);

      await expect(loop._runCore({ slideIntents: [] }, { runContext: { runId: "run-bt" }, eventBus }))
        .rejects.toBe(backtrack);

      expect(stateManagerMocks.transitionToSpy.mock.calls.some(([status]) => status === runtimeMocks.AgentStatus.FAILED)).toBe(false);
      expect(runtimeMocks.lifecycleInstances[0].failed).not.toHaveBeenCalled();
    });
  });
});
