import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (all external deps) ---

vi.mock("../../../../js/agents/shared/archive/archive.js", () => {
  class Archive {
    constructor(adapter) {
      this.adapter = adapter;
      this.save = vi.fn(async (_runId, checkpoint) => checkpoint?.metadata?.checkpointId || "cp_mock");
      this.restore = vi.fn(async (checkpointId) => ({ checkpointId }));
    }
  }
  class FallbackAdapter {
    constructor(dbName, storeName) {
      this.dbName = dbName;
      this.storeName = storeName;
    }
  }
  class MapAdapter {
    constructor() {
      this._map = new Map();
    }
  }
  return { Archive, FallbackAdapter, MapAdapter };
});

vi.mock("../../../../js/agents/shared/utils/value-utils.js", () => {
  return {
    deepClone: vi.fn((v) => JSON.parse(JSON.stringify(v))),
  };
});

vi.mock("../../../../js/agents/shared/archive/checkpoint-schema.js", () => {
  return {
    CheckpointType: { PRE_ACTION: "PRE_ACTION" },
    createCheckpoint: vi.fn((state, metadata) => ({ state, metadata: { ...metadata, checkpointId: "cp1" } })),
    migrateCheckpoint: vi.fn((snapshot) => snapshot),
  };
});

vi.mock("../../../../js/agents/shared/utils/logger.js", () => {
  return {
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

vi.mock("../../../../js/agents/stages/design/states.js", () => {
  const DesignPhase = {
    IDLE: "IDLE",
    OUTLINE_PARSING: "OUTLINE_PARSING",
    STYLE_EXTRACTING: "STYLE_EXTRACTING",
    STYLE_CONFIRMING: "STYLE_CONFIRMING",
    DECK_PLANNING: "DECK_PLANNING",
    LAYOUT_DEVELOPING: "LAYOUT_DEVELOPING",
    GENERATING: "GENERATING",
    REVIEWING: "REVIEWING",
    VISUAL_FILLING: "VISUAL_FILLING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    EDITING: "EDITING",
    FIXING: "FIXING",
    REPAIR: "REPAIR",
    GENERATING_PAUSED: "GENERATING_PAUSED",
    OUTLINE_CONFIRMING: "OUTLINE_CONFIRMING",
    PLAN_CONFIRMING: "PLAN_CONFIRMING",
    LAYOUT_ANALYZING: "LAYOUT_ANALYZING",
    LAYOUT_GENERATING: "LAYOUT_GENERATING",
    LAYOUT_CONFIRMING: "LAYOUT_CONFIRMING",
  };
  const designPhaseMachine = {
    transition: vi.fn((state, next) => {
      state.status = next;
      return true;
    }),
  };
  return { DesignPhase, designPhaseMachine };
});

vi.mock("../../../../js/agents/runtime/core/agent-status.js", () => {
  return {
    AgentStatus: {
      IDLE: "IDLE",
      RUNNING: "RUNNING",
      COMPLETED: "COMPLETED",
      FAILED: "FAILED",
      PAUSED: "PAUSED",
    },
  };
});

vi.mock("../../../../js/agents/runtime/core/agent-loop.js", () => {
  class BaseAgentLoop {
    constructor({ actor, stageName, eventBus } = {}) {
      this.actor = actor;
      this.stageName = stageName;
      this.eventBus = eventBus || null;
      this.emit = null;
      this._statusHistory = [];
      this._tools = Object.create(null);
      this._toolRegistry = { _tools: this._tools };
      this._activeStep = null;
      this._pauseRequested = false;
      this._pauseReason = null;
    }

    registerTools(tools) {
      Object.assign(this._tools, tools || {});
    }

    async execute(runContext, contentPackage, stageApi = {}) {
      return { ok: true, runContext, contentPackage, stageApi };
    }

    _beginStep(step, _context) {
      this._activeStep = step;
      return step;
    }

    _endStep(_stepInfo, _result) {
      this._activeStep = null;
    }

    applyUserInputsToConfig(cfg) {
      return cfg;
    }

    _shouldPauseFromError() {
      return false;
    }

    _createPauseError({ runId } = {}) {
      const err = new Error("paused");
      err.runId = runId;
      return err;
    }
  }

  return {
    BaseAgentLoop,
    checkCancelled: vi.fn(),
    getEmitFn: vi.fn((ctx) => (typeof ctx?.emit === "function" ? ctx.emit : null)),
    resolveToolExecutor: vi.fn((ctx) => (typeof ctx?.toolExecutor === "function" ? ctx.toolExecutor : null)),
  };
});

vi.mock("../../../../js/agents/runtime/core/stage-errors.js", () => {
  class MockStagePausedError extends Error {
    constructor(message, meta = {}) {
      super(message);
      this.name = "StagePausedError";
      this.checkpointId = meta.checkpointId ?? null;
      this.reason = meta.reason ?? null;
      this.timestamp = meta.timestamp ?? null;
      this.runId = meta.runId ?? null;
    }
  }
  return { StagePausedError: MockStagePausedError };
});

vi.mock("../../../../js/agents/runtime/core/lifecycle.js", () => {
  return {
    createLifecycleEmitter: vi.fn(() => ({
      started: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn(),
      phaseTransition: vi.fn(),
    })),
  };
});

vi.mock("../../../../js/agents/runtime/telemetry/loop-runtime-state.js", () => {
  return {
    getRuntimeState: vi.fn((signal) => signal?.__runtimeState || null),
  };
});

vi.mock("../../../../js/agents/stages/design/design-tools.js", () => {
  return {
    DESIGN_AGENT_TOOL_DEFINITIONS: Object.freeze([{ name: "parse_outline" }, { name: "extract_style" }]),
    createDesignToolHandlers: vi.fn(() => {
      return {
        parse_outline: vi.fn(async () => ({ ok: true })),
        extract_style: vi.fn(async () => ({ ok: true })),
        spawn_slide_agent: vi.fn(async () => ({ ok: true })),
        take_screenshot: vi.fn(async () => ({ ok: true })),
        fix_slide: vi.fn(async () => ({ ok: true })),
        fill_visual: vi.fn(async () => ({ ok: true })),
        chat_ask: vi.fn(async () => ({ ok: true })),
      };
    }),
  };
});

vi.mock("../../../../js/agents/stages/design/runtime/visual-handler.js", () => {
  class VisualHandler {
    constructor(opts = {}) {
      this.opts = opts;
      this.initDesignSystem = vi.fn(async () => ({ ok: true }));
      this.buildVisualSlots = vi.fn(() => []);
      this.renderVisuals = vi.fn(async () => ({ ok: true }));
    }
  }
  return { VisualHandler };
});

vi.mock("../../../../js/agents/stages/design/runtime/design-phases.js", () => {
  return {
    runPreparationPhase: vi.fn(async (_loop, { contentPackage }) => ({
      parsedContentPackage: { ...(contentPackage || {}), parsed: true },
      slideIntents: Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents : [{ slideIntentId: "s1" }],
      designSystem: { theme: "dark" },
      constraints: contentPackage?.constraints || {},
      userConfig: contentPackage?.userConfig || {},
    })),
    runPlanningPhase: vi.fn(async () => ({ plans: [{ slideIntentId: "s1", layoutHint: "hero" }] })),
    runLayoutPhase: vi.fn(async () => ({ layouts: [{ slideIntentId: "s1", layoutHtml: "<wireframe/>" }] })),
    runGeneratingPhase: vi.fn(async (_loop, args) => {
      // Exercise emitDeckUpdate branches: ignore invalid deck, emit once, dedupe second identical emit.
      args.emitDeckUpdate?.("not a deck", [], { source: "bad" });
      args.emitDeckUpdate?.("<section>deck</section>", [{ slideIntentId: "s1" }], { source: "gen" });
      args.emitDeckUpdate?.("<section>deck</section>", [{ slideIntentId: "s1" }], { source: "gen" });
      return {
        generated: [{ slideHtml: "<section>slide</section>", source: "mock" }],
        slideHtmls: ["<section>slide</section>"],
        slidesMeta: [{ slideIntentId: "s1", source: "gen" }],
        imageSlots: [{ slotId: "img1" }],
        baseDeckHtmlDsl: "<section>base</section>",
        pendingImages: [],
        brainstormResult: { ok: true },
        degradedCount: 0,
      };
    }),
    runBatchRepairPhase: vi.fn(async () => ({
      deckHtmlDsl: "<section>repaired</section>",
      slidesMeta: [{ slideIntentId: "s1", source: "repair" }],
    })),
    runVisualPhase: vi.fn(async () => ({
      deckHtmlDsl: "<section>visual</section>",
      slidesMeta: [{ slideIntentId: "s1", source: "visual" }],
      imageSlots: [{ slotId: "img1", status: "filled" }],
      pendingImages: [],
      visualReport: { ok: true },
      imageReport: { ok: true },
      refineResult: { ok: true },
    })),
    runReviewPhase: vi.fn(async () => ({ reviewResult: { ok: true } })),
  };
});

vi.mock("../../../../js/agents/stages/design/runtime/design-blackboard.js", () => {
  class DesignBlackboard {
    constructor(opts = {}) {
      this.opts = opts;
      this._versions = new Map();
      this._summaries = new Map();
      this._deck = null;
      this.saveVersion = vi.fn((label, snapshot) => {
        const v = { label, snapshot };
        this._versions.set(label, v);
        return v;
      });
      this.getVersion = vi.fn((label) => this._versions.get(label) || null);
      this.listVersions = vi.fn(() => [...this._versions.values()].map((v) => ({ label: v.label })));
      this.restoreVersion = vi.fn();
      this.setSummary = vi.fn((k, v) => this._summaries.set(k, v));
      this.logDecision = vi.fn();
      this.setDeck = vi.fn((deck) => {
        this._deck = deck;
      });
      this.logDecision = vi.fn();
    }
  }
  return { DesignBlackboard };
});

vi.mock("../../../../js/agents/runtime/compression/watchdog.js", () => {
  class Watchdog {
    constructor(_opts = {}) {
      this._opts = _opts;
      this.tick = vi.fn();
      this.reset = vi.fn();
      this.configure = vi.fn();
      this.recordOutput = vi.fn();
      this.resetOscillation = vi.fn();
      this.checkHealth = vi.fn(() => ({ healthy: true, issues: [], stats: {} }));
    }
  }
  return { Watchdog };
});

vi.mock("../../../../js/agents/stages/design/design-helpers.js", () => {
  class BacktrackError extends Error {
    constructor(targetPhase, label, reason) {
      super(`Backtrack to ${targetPhase}`);
      this.name = "BacktrackError";
      this.targetPhase = targetPhase;
      this.label = label;
      this.reason = reason;
    }
  }

  const loadDesignConcurrencyConfig = vi.fn(() => ({
    batchSize: 3,
    batchConcurrency: 2,
    imageConcurrency: 4,
  }));

  return {
    BacktrackError,
    DESIGN_LOOP_DEFAULTS: {
      batchSize: 5,
      batchConcurrency: 1,
      imageConcurrency: 1,
      maxIterations: 3,
      maxBacktrackAttempts: 1,
      signatureLength: 16,
    },
    resolveWatchdogSettings: vi.fn(() => ({
      maxRecentOutputs: 3,
      similarityThreshold: 0.9,
      maxTimeMs: 1000,
      stuckThresholdMs: 1000,
      maxConsecutiveSimilar: 2,
    })),
    safeJsonStringify: vi.fn((v) => JSON.stringify(v)),
    resolveStageTraceContext: vi.fn(() => {
      return {
        withSpan: vi.fn(async (_name, fn) => fn({ setAttributes: vi.fn() })),
        startSpan: vi.fn((_name, _opts) => ({ id: "span" })),
        endSpan: vi.fn(),
      };
    }),
    resolveErrorBoundary: vi.fn(() => {
      return {
        wrap: vi.fn(async (fn, opts) => {
          // Best-effort: exercise the closures created in run().
          if (typeof opts?.context?.shouldDegrade === "function") opts.context.shouldDegrade();
          if (typeof opts?.context?.fallbackFactory === "function") opts.context.fallbackFactory();
          return fn();
        }),
      };
    }),
    createTracedAiApiService: vi.fn((svc) => svc),
    createTracedModelRouter: vi.fn((router) => router),
    buildDesignWatchdogAdvice: vi.fn(() => "advice"),
    summarizeRefineEventForWatchdog: vi.fn(() => "refine_summary"),
    emitStage: vi.fn((emit, eventName, status, payload) => {
      if (typeof emit === "function") emit(eventName, { actor: "design", status, payload });
    }),
    loadDesignConcurrencyConfig,
  };
});

let AgentStatus;
let StagePausedError;
let DesignPhase;
let designPhaseMachine;
let DesignBlackboard;
let createCheckpoint;
let loadDesignConcurrencyConfig;
let BacktrackError;
let DESIGN_AGENT_TOOL_DEFINITIONS;
let DesignAgentLoop;
let resumeDesignAgentLoop;
let runPreparationPhase;
let runPlanningPhase;
let runLayoutPhase;
let runGeneratingPhase;
let runBatchRepairPhase;
let runVisualPhase;
let runReviewPhase;

describe("design/agent-loop (DesignAgentLoop)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    ({ AgentStatus } = await import("../../../../js/agents/runtime/core/agent-status.js"));
    ({ StagePausedError } = await import("../../../../js/agents/runtime/core/stage-errors.js"));
    ({ DesignPhase, designPhaseMachine } = await import("../../../../js/agents/stages/design/states.js"));
    ({ DesignBlackboard } = await import("../../../../js/agents/stages/design/runtime/design-blackboard.js"));
    ({ createCheckpoint } = await import("../../../../js/agents/shared/archive/checkpoint-schema.js"));
    ({ loadDesignConcurrencyConfig, BacktrackError } = await import("../../../../js/agents/stages/design/design-helpers.js"));
    ({ DESIGN_AGENT_TOOL_DEFINITIONS } = await import("../../../../js/agents/stages/design/design-tools.js"));
    ({ DesignAgentLoop, resumeDesignAgentLoop } = await import("../../../../js/agents/stages/design/agent-loop.js"));
    ({
      runPreparationPhase,
      runPlanningPhase,
      runLayoutPhase,
      runGeneratingPhase,
      runBatchRepairPhase,
      runVisualPhase,
      runReviewPhase,
    } = await import("../../../../js/agents/stages/design/runtime/design-phases.js"));
  });

  it("constructor applies concurrency config, registers tools, and exposes backward-compatible tool shortcuts", () => {
    loadDesignConcurrencyConfig.mockReturnValueOnce({ batchSize: 2, batchConcurrency: 7, imageConcurrency: 9 });

    const loop = new DesignAgentLoop({ tools: { extra: vi.fn() } });
    expect(loop.batchSize).toBe(2);
    expect(loop.batchConcurrency).toBe(7);
    expect(loop.imageConcurrency).toBe(9);
    expect(loop._tools.extra).toBeTypeOf("function");

    // Back-compat shortcuts used by older tests/integrations.
    expect(loop._toolParseOutline).toBe(loop._tools.parse_outline);
    expect(loop._toolExtractStyle).toBe(loop._tools.extract_style);
    expect(loop._toolSpawnSlideAgent).toBe(loop._tools.spawn_slide_agent);
    expect(loop.phase.status).toBe(DesignPhase.IDLE);
    expect(loop.loopStatus).toBe(AgentStatus.IDLE);
  });

  it("_resolveDependency prefers context, then container, then fallback", async () => {
    const container = { get: vi.fn(async (id) => ({ id })) };
    const loop = new DesignAgentLoop({ container });

    expect(await loop._resolveDependency("memoryStore", { memoryStore: 1 }, "fb")).toBe(1);
    expect(container.get).not.toHaveBeenCalled();

    expect(await loop._resolveDependency("stateEngine", {}, "fb")).toEqual({ id: "stateEngine" });
    expect(container.get).toHaveBeenCalledWith("stateEngine");

    container.get.mockRejectedValueOnce(new Error("nope"));
    expect(await loop._resolveDependency("eventBus", {}, "fb")).toBe("fb");
  });

  it("version management (save/get/list) works and saveVersion returns null without blackboard (edge)", () => {
    const loop = new DesignAgentLoop();
    loop._blackboard = null;
    expect(loop.saveVersion("v1")).toBe(null);

    loop._blackboard = new DesignBlackboard({ runId: "r1" });
    loop.state.deckHtmlDsl = "<section/>"; // stored via deepClone snapshot
    const v = loop.saveVersion("v1");
    expect(v.label).toBe("v1");
    expect(loop.getVersion("v1")).toBeTruthy();
    expect(loop.listVersions()).toEqual([{ label: "v1" }]);
  });

  it("backtrackTo restores state, emits event, and throws BacktrackError", () => {
    const loop = new DesignAgentLoop();
    loop._emit = vi.fn();
    loop._blackboard = new DesignBlackboard({ runId: "r1" });
    loop._blackboard.saveVersion("cp", { phase: DesignPhase.GENERATING, loopStatus: AgentStatus.RUNNING, state: { deckHtmlDsl: "X" } });

    expect(() => loop.backtrackTo("cp", "user")).toThrow(BacktrackError);
    expect(loop._isBacktracking).toBe(true);
    expect(loop.state.deckHtmlDsl).toBe("X");
    expect(loop._emit).toHaveBeenCalledWith(
      "design.backtrack",
      expect.objectContaining({ label: "cp", targetPhase: DesignPhase.GENERATING, reason: "user" })
    );
  });

  it("backtrackTo validates preconditions (edge cases)", () => {
    const loop = new DesignAgentLoop();
    loop._blackboard = null;
    expect(() => loop.backtrackTo("x")).toThrow("Cannot backtrack: no blackboard");

    loop._blackboard = new DesignBlackboard({ runId: "r1" });
    expect(() => loop.backtrackTo("missing")).toThrow('version "missing" not found');

    expect(() => loop.backtrackToLastCheckpoint()).toThrow("Cannot backtrack: no versions available");
  });

  it("serializeNodeStates produces a safe snapshot and hydrateFromNodeStates accepts legacy fields", () => {
    const loop = new DesignAgentLoop();
    loop.state = {
      contentPackage: { runId: "r1" },
      slideIntents: [{ slideIntentId: "s1" }],
      designSystem: { theme: "dark" },
      slideHtmls: ["<section/>"],
      deckHtmlDsl: "<section/>",
      imageSlots: [{ slotId: "img1" }],
      visualSlots: [],
    };

    const snap = loop.serializeNodeStates();
    expect(snap.deckHtmlDsl).toBe("<section/>");
    snap.deckHtmlDsl = "mutated";
    expect(loop.state.deckHtmlDsl).toBe("<section/>"); // deep clone

    loop.state = null;
    loop.hydrateFromNodeStates({ parsedContentPackage: { runId: "r2" }, slideIntents: [{ slideIntentId: "s2" }], deckHtmlDsl: "D" });
    expect(loop.state.contentPackage).toEqual({ runId: "r2" });
    expect(loop.state.slideIntents).toEqual([{ slideIntentId: "s2" }]);
    expect(loop.state.deckHtmlDsl).toBe("D");
  });

  it("_transitionPhase validates transitions and uses trace spans when available", () => {
    const loop = new DesignAgentLoop();
    loop._traceContext = {
      startSpan: vi.fn(() => ({ id: "span" })),
      endSpan: vi.fn(),
    };

    const lifecycle = { phaseTransition: vi.fn() };
    const emit = vi.fn();
    loop.phase = { status: DesignPhase.IDLE };

    const out = loop._transitionPhase(loop.phase, DesignPhase.GENERATING, { emit, runId: "r1", lifecycle });
    expect(out).toBe(DesignPhase.GENERATING);
    expect(designPhaseMachine.transition).toHaveBeenCalled();
    expect(lifecycle.phaseTransition).toHaveBeenCalledWith(DesignPhase.IDLE, DesignPhase.GENERATING, "r1", undefined);
    expect(loop._traceContext.startSpan).toHaveBeenCalled();

    designPhaseMachine.transition.mockReturnValueOnce(false);
    expect(() => loop._transitionPhase(loop.phase, DesignPhase.COMPLETED, { emit, runId: "r1", lifecycle })).toThrow(
      "DesignPhase transition rejected"
    );
  });

  it("_transitionTo enforces valid loop transitions and pauses when requested", async () => {
    const loop = new DesignAgentLoop({ archive: { save: vi.fn(async () => "cp_pause") } });
    loop.emit = vi.fn();

    // invalid: IDLE -> COMPLETED not allowed
    await expect(loop._transitionTo(AgentStatus.COMPLETED)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    // pause branch: IDLE -> RUNNING + pauseRequested
    loop._pauseRequested = true;
    loop._pauseReason = "user";
    await expect(loop._transitionTo(AgentStatus.RUNNING, { runId: "r1", stageApi: { signal: { __runtimeState: {} } } })).rejects.toBeInstanceOf(
      StagePausedError
    );
    expect(loop.loopStatus).toBe(AgentStatus.PAUSED);
    expect(loop.emit).toHaveBeenCalledWith(
      "design.agent.status.changed",
      expect.objectContaining({ payload: expect.objectContaining({ to: AgentStatus.PAUSED, pausedReason: "user" }) })
    );
  });

  it("_savePreActionCheckpoint merges nodeStates and calls archive.save", async () => {
    const archive = { save: vi.fn(async () => "cp_saved") };
    const loop = new DesignAgentLoop({ archive });
    loop.state.deckHtmlDsl = "D";

    const id = await loop._savePreActionCheckpoint({ runId: "r1", nodeStates: { extra: 1 } });
    expect(id).toBe("cp_saved");
    expect(createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ deckHtmlDsl: "D", extra: 1 }),
      expect.objectContaining({ type: "PRE_ACTION" })
    );
    expect(archive.save).toHaveBeenCalledWith("r1", expect.any(Object));
  });

  it("run() executes phases and completes (happy path)", async () => {
    const emitted = [];
    const eventBus = {
      emit: vi.fn((event, rec) => emitted.push({ event, rec })),
      on: vi.fn((event, handler) => {
        // capture handler so we can execute it and cover that code path
        if (event === "design.refine.step") {
          handler({ runId: "r1", payload: { stepIndex: 1 } });
        }
        return () => {};
      }),
      enableBackpressure: vi.fn(() => {
        throw new Error("ignore");
      }),
    };

    const loop = new DesignAgentLoop();
    const result = await loop.run({ runId: "r1", slideIntents: [{ slideIntentId: "s1" }] }, { eventBus, enableFinalReview: true });

    expect(result).toMatchObject({
      schemaVersion: expect.any(String),
      runId: "r1",
      deckHtmlDsl: "<section>visual</section>",
      slidesMeta: [{ slideIntentId: "s1", source: "visual" }],
      imageReport: { ok: true },
      visualReport: { ok: true },
      reviewReport: { ok: true },
    });

    expect(loop.loopStatus).toBe(AgentStatus.COMPLETED);
    expect(runPreparationPhase).toHaveBeenCalledTimes(1);
    expect(runPlanningPhase).toHaveBeenCalledTimes(1);
    expect(runLayoutPhase).toHaveBeenCalledTimes(1);
    expect(runGeneratingPhase).toHaveBeenCalledTimes(1);
    expect(runBatchRepairPhase).toHaveBeenCalledTimes(1);
    expect(runVisualPhase).toHaveBeenCalledTimes(1);
    expect(runReviewPhase).toHaveBeenCalledTimes(1);

    // Backpressure is best-effort; should have been attempted once.
    expect(eventBus.enableBackpressure).toHaveBeenCalledTimes(1);
    expect(emitted.some((e) => e.event === "design.deck.updated")).toBe(true);
  });

  it("run() retries when _runCore throws BacktrackError (backtrack loop)", async () => {
    const loop = new DesignAgentLoop();
    loop._emit = vi.fn();

    const spy = vi
      .spyOn(loop, "_runCore")
      .mockRejectedValueOnce(new BacktrackError(DesignPhase.GENERATING, "cp", "auto"))
      .mockResolvedValueOnce({ ok: true, deckHtmlDsl: "ok" });

    const out = await loop.run({ runId: "r2", slideIntents: [] }, { emit: loop._emit });
    expect(out).toEqual({ ok: true, deckHtmlDsl: "ok" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(loop._emit).toHaveBeenCalledWith(
      "design.backtrack.restart",
      expect.objectContaining({ attempt: 1, maxAttempts: 1, targetPhase: DesignPhase.GENERATING })
    );
  });

  it("resumeDesignAgentLoop restores checkpoint and injects a toolExecutor that can short-circuit cached tools", async () => {
    const stageApi = {
      archive: {
        restore: vi.fn(async () => ({
          nodeStates: {
            phase: DesignPhase.STYLE_CONFIRMING,
            loopStatus: AgentStatus.PAUSED,
            // resumeState generation is derived from these fields
            slideIntents: [{ slideIntentId: "s1" }],
            slideHtmls: ["<section>h</section>"],
            slidesMeta: [{ source: "resume" }],
            designSystem: { theme: "dark" },
            contentPackage: { runId: "r3" },
          },
          metadata: { runId: "r3" },
        })),
      },
      runContext: { runId: "r3" },
      toolExecutor: vi.fn(async (name) => ({ ok: true, name, via: "base" })),
    };

    const runSpy = vi.spyOn(DesignAgentLoop.prototype, "run").mockResolvedValue({ ok: "resumed" });
    const out = await resumeDesignAgentLoop("cp123", stageApi);
    expect(out).toEqual({ ok: "resumed" });
    expect(runSpy).toHaveBeenCalledTimes(1);

    const [, ctx] = runSpy.mock.calls[0];
    expect(ctx.resumed).toBe(true);
    expect(ctx.resumeState).toBeTruthy();

    const parseOutline = await ctx.toolExecutor("parse_outline", {});
    expect(parseOutline.slideIntents).toEqual([{ slideIntentId: "s1" }]);

    const extractStyle = await ctx.toolExecutor("extract_style", {});
    expect(extractStyle).toEqual({ designSystem: { theme: "dark" } });

    const spawned = await ctx.toolExecutor("spawn_slide_agent", {});
    // phase is STYLE_CONFIRMING => canUseGenerated=false => delegates to base executor
    expect(spawned).toEqual({ ok: true, name: "spawn_slide_agent", via: "base" });
  });

  it("resumeDesignAgentLoop validates snapshot and contentPackage presence (edge cases)", async () => {
    await expect(resumeDesignAgentLoop("missing", { archive: { restore: vi.fn(async () => ({})) } })).rejects.toThrow(
      "Checkpoint not found"
    );

    await expect(
      resumeDesignAgentLoop("cp", { archive: { restore: vi.fn(async () => ({ nodeStates: {} })) } })
    ).rejects.toThrow("Checkpoint missing contentPackage");
  });

  it("exposes tool definitions as a defensive copy", () => {
    const loop = new DesignAgentLoop();
    const defs = loop.getToolDefinitions();
    expect(defs).toEqual(DESIGN_AGENT_TOOL_DEFINITIONS);
    defs.push({ name: "mutate" });
    expect(loop.getToolDefinitions()).toEqual(DESIGN_AGENT_TOOL_DEFINITIONS);
  });

  it("resumeDesignAgentLoop toolExecutor falls back to _tools when no baseExecutor", async () => {
    const stageApi = {
      archive: {
        restore: vi.fn(async () => ({
          nodeStates: {
            phase: DesignPhase.GENERATING,
            loopStatus: AgentStatus.RUNNING,
            generated: [{ id: "g1" }],
            contentPackage: { runId: "r4" },
          },
          metadata: { runId: "r4" },
        })),
      },
      runContext: { runId: "r4" },
      // No toolExecutor provided - should fall back to _tools
    };

    const runSpy = vi.spyOn(DesignAgentLoop.prototype, "run").mockImplementation(async function (content, ctx) {
      // Access the toolExecutor and test it
      const result = await ctx.toolExecutor("unknown_tool", {});
      return { toolResult: result };
    });

    const out = await resumeDesignAgentLoop("cp456", stageApi);
    expect(out.toolResult).toEqual({ ok: false, error: "Unknown tool: unknown_tool" });
    runSpy.mockRestore();
  });

  it("resumeDesignAgentLoop toolExecutor uses _tools function when available", async () => {
    const customToolFn = vi.fn((params) => ({ custom: true, params }));

    const stageApi = {
      archive: {
        restore: vi.fn(async () => ({
          nodeStates: {
            phase: DesignPhase.GENERATING,
            loopStatus: AgentStatus.RUNNING,
            generated: [{ id: "g1" }],
            contentPackage: { runId: "r5" },
          },
          metadata: { runId: "r5" },
        })),
      },
      runContext: { runId: "r5" },
      tools: { my_custom_tool: customToolFn },
    };

    const runSpy = vi.spyOn(DesignAgentLoop.prototype, "run").mockImplementation(async function (content, ctx) {
      // Set _tools on the loop instance through the context
      this._tools = stageApi.tools;
      const result = await ctx.toolExecutor("my_custom_tool", { arg: 1 });
      return { toolResult: result };
    });

    const out = await resumeDesignAgentLoop("cp789", stageApi);
    expect(out.toolResult).toEqual({ custom: true, params: { arg: 1 } });
    runSpy.mockRestore();
  });

  it("resumeDesignAgentLoop uses spawn_slide_agent cached generated when canUseGenerated is true", async () => {
    const stageApi = {
      archive: {
        restore: vi.fn(async () => ({
          nodeStates: {
            phase: DesignPhase.VISUAL_FILLING, // Phase after GENERATING
            loopStatus: AgentStatus.RUNNING,
            generated: [{ slideId: "cached_1" }, { slideId: "cached_2" }],
            contentPackage: { runId: "r6" },
          },
          metadata: { runId: "r6" },
        })),
      },
      runContext: { runId: "r6" },
    };

    const runSpy = vi.spyOn(DesignAgentLoop.prototype, "run").mockImplementation(async function (content, ctx) {
      const result = await ctx.toolExecutor("spawn_slide_agent", {});
      return { toolResult: result };
    });

    const out = await resumeDesignAgentLoop("cp_visual", stageApi);
    expect(out.toolResult.generated).toEqual([{ slideId: "cached_1" }, { slideId: "cached_2" }]);
    runSpy.mockRestore();
  });

  it("resumeDesignAgentLoop handles statusHistory restoration", async () => {
    const stageApi = {
      archive: {
        restore: vi.fn(async () => ({
          nodeStates: {
            phase: DesignPhase.IDLE,
            loopStatus: AgentStatus.IDLE,
            statusHistory: [
              { status: AgentStatus.IDLE, timestamp: 1000 },
              { status: AgentStatus.RUNNING, timestamp: 2000 },
            ],
            contentPackage: { runId: "r7" },
          },
          metadata: { runId: "r7" },
        })),
      },
      runContext: { runId: "r7" },
    };

    let capturedLoop;
    const runSpy = vi.spyOn(DesignAgentLoop.prototype, "run").mockImplementation(async function () {
      capturedLoop = this;
      return { ok: true };
    });

    await resumeDesignAgentLoop("cp_history", stageApi);
    expect(capturedLoop._statusHistory).toHaveLength(2);
    expect(capturedLoop._statusHistory[0].status).toBe(AgentStatus.IDLE);
    runSpy.mockRestore();
  });

  it("resumeDesignAgentLoop creates MapAdapter when indexedDB is undefined", async () => {
    const originalIndexedDB = globalThis.indexedDB;
    delete globalThis.indexedDB;

    const mockArchive = {
      restore: vi.fn(async () => ({
        nodeStates: {
          phase: DesignPhase.IDLE,
          contentPackage: { runId: "r8" },
        },
      })),
    };

    const runSpy = vi.spyOn(DesignAgentLoop.prototype, "run").mockResolvedValue({ ok: true });

    await resumeDesignAgentLoop("cp_no_idb", { archive: mockArchive, runContext: { runId: "r8" } });
    expect(runSpy).toHaveBeenCalled();

    runSpy.mockRestore();
    globalThis.indexedDB = originalIndexedDB;
  });
});
