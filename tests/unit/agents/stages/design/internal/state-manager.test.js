import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const archiveState = {
    restoreResult: null,
    saveResult: "checkpoint-id",
  };

  const Archive = vi.fn().mockImplementation(function Archive(adapter) {
    this.adapter = adapter;
    this.restore = vi.fn(async (id) => {
      if (typeof archiveState.restoreResult === "function") {
        return archiveState.restoreResult(id);
      }
      return archiveState.restoreResult;
    });
    this.save = vi.fn(async (runId, checkpoint) => {
      if (typeof archiveState.saveResult === "function") {
        return archiveState.saveResult(runId, checkpoint);
      }
      return archiveState.saveResult;
    });
  });

  const FallbackAdapter = vi.fn().mockImplementation(function FallbackAdapter(dbName, storeName) {
    this.dbName = dbName;
    this.storeName = storeName;
  });

  const MapAdapter = vi.fn().mockImplementation(function MapAdapter() {
    this.type = "map";
  });

  const CheckpointType = { PRE_ACTION: "pre_action" };

  const createCheckpoint = vi.fn((state, metadata) => ({
    state,
    metadata,
    type: metadata?.type ?? null,
  }));

  const deepClone = vi.fn((value) => {
    if (value === null || typeof value !== "object") return value;
    return JSON.parse(JSON.stringify(value));
  });

  const migrateCheckpoint = vi.fn((snapshot) => snapshot);

  return {
    archiveState,
    Archive,
    FallbackAdapter,
    MapAdapter,
    CheckpointType,
    createCheckpoint,
    deepClone,
    migrateCheckpoint,
  };
});

const runtimeMocks = vi.hoisted(() => {
  const AgentStatus = {
    IDLE: "idle",
    RUNNING: "running",
    COMPLETED: "completed",
    FAILED: "failed",
    PAUSED: "paused",
  };

  class StagePausedError extends Error {
    constructor(message, details) {
      super(message);
      this.name = "StagePausedError";
      this.details = details;
    }
  }

  const createLifecycleEmitter = vi.fn(() => ({
    phaseTransition: vi.fn(),
  }));

  return { AgentStatus, StagePausedError, createLifecycleEmitter };
});

const telemetryMocks = vi.hoisted(() => ({
  getRuntimeState: vi.fn(() => null),
}));

const statesMocks = vi.hoisted(() => ({
  DesignPhase: {
    IDLE: "idle",
    PREPARE: "prepare",
    GENERATE: "generate",
  },
  designPhaseMachine: {
    transition: vi.fn(() => true),
  },
}));

const helperMocks = vi.hoisted(() => {
  class BacktrackError extends Error {
    constructor(targetPhase, label, reason) {
      super(`Backtrack to ${label}`);
      this.name = "BacktrackError";
      this.targetPhase = targetPhase;
      this.label = label;
      this.reason = reason;
    }
  }

  return { BacktrackError };
});

const toolHandlerMocks = vi.hoisted(() => ({
  createResumeToolExecutor: vi.fn(() => ({ executor: "resume" })),
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  Archive: sharedMocks.Archive,
  FallbackAdapter: sharedMocks.FallbackAdapter,
  MapAdapter: sharedMocks.MapAdapter,
  CheckpointType: sharedMocks.CheckpointType,
  createCheckpoint: sharedMocks.createCheckpoint,
  deepClone: sharedMocks.deepClone,
  migrateCheckpoint: sharedMocks.migrateCheckpoint,
}));

vi.mock("../../../../../../js/agents/runtime/index.js", () => runtimeMocks);
vi.mock("../../../../../../js/agents/plugins/telemetry/index.js", () => telemetryMocks);
vi.mock("../../../../../../js/agents/stages/design/states.js", () => statesMocks);
vi.mock("../../../../../../js/agents/stages/design/design-helpers.js", () => helperMocks);
vi.mock("../../../../../../js/agents/stages/design/internal/tool-handler.js", () => toolHandlerMocks);

import * as stateManager from "../../../../../../js/agents/stages/design/internal/state-manager.js";

const expectedEmptyState = {
  contentPackage: null,
  slideIntents: [],
  designSystem: null,
  constraints: {},
  userConfig: {},
  plans: null,
  generated: [],
  slideHtmls: [],
  slidesMeta: [],
  imageSlots: [],
  visualSlots: [],
  deckHtmlDsl: "",
  pendingImages: [],
  brainstormResult: null,
};

const originalIndexedDB = globalThis.indexedDB;

beforeEach(() => {
  vi.clearAllMocks();
  sharedMocks.archiveState.restoreResult = null;
  sharedMocks.archiveState.saveResult = "checkpoint-id";
  telemetryMocks.getRuntimeState.mockReturnValue(null);
  statesMocks.designPhaseMachine.transition.mockReturnValue(true);
  globalThis.indexedDB = originalIndexedDB;
});

class TestLoop {
  constructor(overrides = {}) {
    this.state = stateManager.createEmptyDesignLoopState();
    this.phase = { status: statesMocks.DesignPhase.IDLE };
    this._loopStatus = runtimeMocks.AgentStatus.IDLE;
    this._statusHistory = [];
    this._blackboard = {
      saveVersion: vi.fn(),
      getVersion: vi.fn(),
      listVersions: vi.fn(),
      restoreVersion: vi.fn(),
    };
    this.archive = null;
    this.eventBus = { emit: vi.fn() };
    this.emit = null;
    this._emit = null;
    this._pauseRequested = false;
    this._pauseReason = null;
    this._traceContext = null;
    this._lifecycle = null;
    Object.assign(this, overrides);
  }
}

stateManager.installStateManager(TestLoop);

const createLoop = (overrides = {}) => new TestLoop(overrides);
const createSnapshot = (nodeStates = {}, metadata = {}) => ({ nodeStates, metadata });

const createResumeCtor = (options = {}) => {
  let lastInstance = null;
  const run = vi.fn(async () => options.runResult ?? "run-result");
  const hydrateFromNodeStates = vi.fn(function hydrateFromNodeStates(nodeStates) {
    const source = nodeStates && typeof nodeStates === "object" ? nodeStates : {};
    this.state = this.state && typeof this.state === "object" ? this.state : {};
    if (source.contentPackage && typeof source.contentPackage === "object") {
      this.state.contentPackage = source.contentPackage;
    }
    if (Array.isArray(source.slideIntents)) {
      this.state.slideIntents = source.slideIntents;
    }
    if (source.designSystem && typeof source.designSystem === "object") {
      this.state.designSystem = source.designSystem;
    }
    if (Array.isArray(source.slideHtmls)) {
      this.state.slideHtmls = source.slideHtmls;
    }
    if (typeof source.deckHtmlDsl === "string") {
      this.state.deckHtmlDsl = source.deckHtmlDsl;
    }
    if (Array.isArray(source.imageSlots)) {
      this.state.imageSlots = source.imageSlots;
    }
    if (Array.isArray(source.visualSlots)) {
      this.state.visualSlots = source.visualSlots;
    }
  });

  function DesignAgentLoopCtor(opts = {}) {
    lastInstance = this;
    this.options = opts;
    this._statusHistory = ["seed"];
    this._loopStatus = "unset";
    this.phase = { status: "unset" };
    this._pauseRequested = true;
    this._pauseReason = "pending";
    this.state = options.initialState ? sharedMocks.deepClone(options.initialState) : {};
    this.run = run;
    this.hydrateFromNodeStates = hydrateFromNodeStates;
  }

  return {
    DesignAgentLoopCtor,
    getLastInstance: () => lastInstance,
    hydrateFromNodeStates,
    run,
  };
};

describe("createEmptyDesignLoopState", () => {
  it("should_return_expected_defaults_when_called", () => {
    expect(stateManager.createEmptyDesignLoopState()).toEqual(expectedEmptyState);
  });

  it("should_return_unique_array_references_when_called_twice", () => {
    const first = stateManager.createEmptyDesignLoopState();
    const second = stateManager.createEmptyDesignLoopState();

    expect(first.slideIntents).not.toBe(second.slideIntents);
  });

  it("should_return_unique_object_references_when_called_twice", () => {
    const first = stateManager.createEmptyDesignLoopState();
    const second = stateManager.createEmptyDesignLoopState();

    expect(first.constraints).not.toBe(second.constraints);
  });

  it("should_support_concurrent_calls_without_shared_references", async () => {
    const [one, two] = await Promise.all([
      Promise.resolve().then(() => stateManager.createEmptyDesignLoopState()),
      Promise.resolve().then(() => stateManager.createEmptyDesignLoopState()),
    ]);

    expect(one.userConfig).not.toBe(two.userConfig);
  });
});

describe("installStateManager", () => {
  it.each([
    "saveVersion",
    "getVersion",
    "listVersions",
    "backtrackTo",
    "backtrackToLastCheckpoint",
    "serializeNodeStates",
    "hydrateFromNodeStates",
    "_transitionPhase",
    "_transitionTo",
    "_emitAgentStatusChanged",
    "_savePreActionCheckpoint",
  ])("should_install_%s_when_called", (methodName) => {
    class LocalLoop {
      constructor() {
        this.state = stateManager.createEmptyDesignLoopState();
        this.phase = { status: statesMocks.DesignPhase.IDLE };
        this._loopStatus = runtimeMocks.AgentStatus.IDLE;
        this._statusHistory = [];
      }
    }

    stateManager.installStateManager(LocalLoop);
    const loop = new LocalLoop();

    expect(typeof loop[methodName]).toBe("function");
  });

  it("should_expose_loopStatus_getter_when_installed", () => {
    class LocalLoop {
      constructor() {
        this._loopStatus = runtimeMocks.AgentStatus.IDLE;
        this._statusHistory = [];
      }
    }

    stateManager.installStateManager(LocalLoop);
    const loop = new LocalLoop();

    expect(loop.loopStatus).toBe(runtimeMocks.AgentStatus.IDLE);
  });

  it("should_return_copied_statusHistory_when_accessed", () => {
    const loop = createLoop();
    loop._statusHistory.push({ from: "idle", to: "running", timestamp: 1 });

    expect(loop.statusHistory).not.toBe(loop._statusHistory);
  });

  it("should_return_statusHistory_values_when_accessed", () => {
    const loop = createLoop();
    loop._statusHistory.push({ from: "idle", to: "running", timestamp: 1 });

    expect(loop.statusHistory).toEqual([{ from: "idle", to: "running", timestamp: 1 }]);
  });

  it("should_return_null_when_saveVersion_called_without_blackboard", () => {
    const loop = createLoop({ _blackboard: null });

    expect(loop.saveVersion("missing")).toBeNull();
  });

  it("should_pass_snapshot_to_blackboard_when_saveVersion_called", () => {
    const loop = createLoop();
    loop.phase.status = statesMocks.DesignPhase.PREPARE;
    loop._loopStatus = runtimeMocks.AgentStatus.RUNNING;
    loop.state = { contentPackage: { id: "pkg" }, slideIntents: ["s1"] };

    loop.saveVersion("v1");

    expect(loop._blackboard.saveVersion).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({
        phase: statesMocks.DesignPhase.PREPARE,
        loopStatus: runtimeMocks.AgentStatus.RUNNING,
        timestamp: expect.any(Number),
      })
    );
  });

  it("should_deep_clone_state_into_snapshot_when_saveVersion_called", () => {
    const loop = createLoop();
    loop.state = { contentPackage: { id: "pkg" } };

    loop.saveVersion("v1");

    expect(loop._blackboard.saveVersion.mock.calls[0][1].state).not.toBe(loop.state);
  });

  it("should_return_null_when_getVersion_called_without_blackboard", () => {
    const loop = createLoop({ _blackboard: null });

    expect(loop.getVersion("missing")).toBeNull();
  });

  it("should_return_empty_array_when_listVersions_called_without_blackboard", () => {
    const loop = createLoop({ _blackboard: null });

    expect(loop.listVersions()).toEqual([]);
  });

  it("should_return_blackboard_version_when_getVersion_called", () => {
    const loop = createLoop();
    loop._blackboard.getVersion.mockReturnValue({ label: "v1" });

    expect(loop.getVersion("v1")).toEqual({ label: "v1" });
  });

  it("should_return_blackboard_versions_when_listVersions_called", () => {
    const loop = createLoop();
    loop._blackboard.listVersions.mockReturnValue([{ label: "v1" }]);

    expect(loop.listVersions()).toEqual([{ label: "v1" }]);
  });

  it("should_return_safe_defaults_when_serializeNodeStates_called_with_null_state", () => {
    const loop = createLoop({ state: null });

    expect(loop.serializeNodeStates()).toEqual({
      contentPackage: null,
      slideIntents: [],
      designSystem: null,
      slideHtmls: [],
      deckHtmlDsl: "",
      imageSlots: [],
      visualSlots: [],
    });
  });

  it("should_normalize_invalid_types_when_serializeNodeStates_called", () => {
    const loop = createLoop({
      state: {
        contentPackage: 0,
        slideIntents: "0",
        designSystem: {},
        slideHtmls: [0, -1, Number.MAX_SAFE_INTEGER],
        deckHtmlDsl: "   ",
        imageSlots: [],
        visualSlots: { invalid: true },
      },
    });

    expect(loop.serializeNodeStates()).toEqual({
      contentPackage: 0,
      slideIntents: [],
      designSystem: {},
      slideHtmls: [0, -1, Number.MAX_SAFE_INTEGER],
      deckHtmlDsl: "   ",
      imageSlots: [],
      visualSlots: [],
    });
  });

  it("should_deep_clone_nested_objects_when_serializeNodeStates_called", () => {
    const deepPackage = { level1: { level2: { level3: { value: "deep" } } } };
    const loop = createLoop({
      state: {
        contentPackage: deepPackage,
        slideIntents: [],
        designSystem: null,
        slideHtmls: [],
        deckHtmlDsl: "",
        imageSlots: [],
        visualSlots: [],
      },
    });

    const serialized = loop.serializeNodeStates();
    deepPackage.level1.level2.level3.value = "mutated";

    expect(serialized.contentPackage.level1.level2.level3.value).toBe("deep");
  });

  it("should_initialize_state_when_hydrateFromNodeStates_called_with_undefined", () => {
    const loop = createLoop({ state: null });

    loop.hydrateFromNodeStates(undefined);

    expect(loop.state).toEqual(expectedEmptyState);
  });

  it("should_ignore_invalid_types_when_hydrateFromNodeStates_called", () => {
    const loop = createLoop();

    loop.hydrateFromNodeStates({
      contentPackage: null,
      slideIntents: {},
      designSystem: "bad",
      slideHtmls: "bad",
      deckHtmlDsl: 0,
      imageSlots: {},
      visualSlots: null,
    });

    expect(loop.state).toMatchObject({
      contentPackage: null,
      slideIntents: [],
      designSystem: null,
      slideHtmls: [],
      deckHtmlDsl: "",
      imageSlots: [],
      visualSlots: [],
    });
  });

  it("should_use_parsedContentPackage_when_hydrateFromNodeStates_called", () => {
    const loop = createLoop({ state: null });
    const parsed = { nested: { value: "deep" } };

    loop.hydrateFromNodeStates({ parsedContentPackage: parsed });

    expect(loop.state.contentPackage).toEqual(parsed);
  });

  it("should_deep_clone_parsedContentPackage_when_hydrateFromNodeStates_called", () => {
    const loop = createLoop({ state: null });
    const parsed = { nested: { value: "deep" } };

    loop.hydrateFromNodeStates({ parsedContentPackage: parsed });
    parsed.nested.value = "mutated";

    expect(loop.state.contentPackage.nested.value).toBe("deep");
  });

  it("should_throw_when_backtrackTo_called_without_blackboard", () => {
    const loop = createLoop({ _blackboard: null });

    expect(() => loop.backtrackTo("v1")).toThrow("Cannot backtrack: no blackboard");
  });

  it("should_throw_when_backtrackTo_called_with_missing_version", () => {
    const loop = createLoop();
    loop._blackboard.getVersion.mockReturnValue(null);

    expect(() => loop.backtrackTo("v1")).toThrow('Cannot backtrack: version "v1" not found');
  });

  const runBacktrack = (snapshot) => {
    const loop = createLoop();
    loop._blackboard.getVersion.mockReturnValue({ snapshot });
    loop._emit = vi.fn();
    try {
      loop.backtrackTo("v2", "manual");
      return { loop, error: null };
    } catch (error) {
      return { loop, error };
    }
  };

  it("should_throw_BacktrackError_when_backtrackTo_restores_version", () => {
    const { error } = runBacktrack({
      phase: statesMocks.DesignPhase.PREPARE,
      loopStatus: runtimeMocks.AgentStatus.PAUSED,
      state: { contentPackage: { id: "pkg" } },
    });

    expect(error).toBeInstanceOf(helperMocks.BacktrackError);
  });

  it("should_default_targetPhase_to_IDLE_when_backtrack_snapshot_has_no_phase", () => {
    const { error } = runBacktrack({
      loopStatus: runtimeMocks.AgentStatus.PAUSED,
      state: { contentPackage: { id: "pkg" } },
    });

    expect(error.targetPhase).toBe(statesMocks.DesignPhase.IDLE);
  });

  it("should_update_loop_phase_when_backtrackTo_restores_snapshot_phase", () => {
    const { loop } = runBacktrack({
      phase: statesMocks.DesignPhase.PREPARE,
      loopStatus: runtimeMocks.AgentStatus.PAUSED,
      state: { contentPackage: { id: "pkg" } },
    });

    expect(loop.phase.status).toBe(statesMocks.DesignPhase.PREPARE);
  });

  it("should_update_loopStatus_when_backtrackTo_restores_snapshot_loopStatus", () => {
    const { loop } = runBacktrack({
      phase: statesMocks.DesignPhase.PREPARE,
      loopStatus: runtimeMocks.AgentStatus.PAUSED,
      state: { contentPackage: { id: "pkg" } },
    });

    expect(loop._loopStatus).toBe(runtimeMocks.AgentStatus.PAUSED);
  });

  it("should_restore_state_when_backtrackTo_restores_snapshot_state", () => {
    const snapshotState = { contentPackage: { id: "pkg" } };
    const { loop } = runBacktrack({
      phase: statesMocks.DesignPhase.PREPARE,
      loopStatus: runtimeMocks.AgentStatus.PAUSED,
      state: snapshotState,
    });

    expect(loop.state).toEqual(snapshotState);
  });

  it("should_call_blackboard_restoreVersion_when_backtrackTo_called", () => {
    const { loop } = runBacktrack({
      phase: statesMocks.DesignPhase.PREPARE,
      loopStatus: runtimeMocks.AgentStatus.PAUSED,
      state: { contentPackage: { id: "pkg" } },
    });

    expect(loop._blackboard.restoreVersion).toHaveBeenCalledWith("v2");
  });

  it("should_emit_backtrack_event_when_backtrackTo_called", () => {
    const { loop } = runBacktrack({
      phase: statesMocks.DesignPhase.PREPARE,
      loopStatus: runtimeMocks.AgentStatus.PAUSED,
      state: { contentPackage: { id: "pkg" } },
    });

    expect(loop._emit).toHaveBeenCalledWith(
      "design.backtrack",
      expect.objectContaining({
        label: "v2",
        targetPhase: statesMocks.DesignPhase.PREPARE,
        reason: "manual",
        timestamp: expect.any(Number),
      })
    );
  });

  it("should_set_isBacktracking_flag_when_backtrackTo_called", () => {
    const { loop } = runBacktrack({
      phase: statesMocks.DesignPhase.PREPARE,
      loopStatus: runtimeMocks.AgentStatus.PAUSED,
      state: { contentPackage: { id: "pkg" } },
    });

    expect(loop._isBacktracking).toBe(true);
  });

  it("should_throw_when_backtrackToLastCheckpoint_called_with_no_versions", () => {
    const loop = createLoop();
    loop._blackboard.listVersions.mockReturnValue([]);

    expect(() => loop.backtrackToLastCheckpoint()).toThrow("Cannot backtrack: no versions available");
  });

  it("should_use_latest_version_label_when_backtrackToLastCheckpoint_called", () => {
    const loop = createLoop();
    loop._blackboard.listVersions.mockReturnValue([{ label: "v1" }, { label: "v2" }]);
    loop.backtrackTo = vi.fn();

    loop.backtrackToLastCheckpoint("auto");

    expect(loop.backtrackTo).toHaveBeenCalledWith("v2", "auto");
  });

  it("should_return_null_when_savePreActionCheckpoint_called_without_archive", async () => {
    const loop = createLoop({ archive: null });

    expect(await loop._savePreActionCheckpoint({ runId: "run-1" })).toBeNull();
  });

  it("should_default_runId_to_unknown_when_savePreActionCheckpoint_called_without_runId", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({ archive });

    await loop._savePreActionCheckpoint({});

    expect(archive.save).toHaveBeenCalledWith("unknown", expect.any(Object));
  });

  it("should_merge_nodeStates_over_serialized_state_when_savePreActionCheckpoint_called", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({ archive });
    loop.state.deckHtmlDsl = "state-dsl";

    await loop._savePreActionCheckpoint({
      runId: "run-1",
      nodeStates: { deckHtmlDsl: "node-dsl" },
    });

    expect(archive.save.mock.calls[0][1].state.deckHtmlDsl).toBe("node-dsl");
  });

  it("should_tag_checkpoint_as_PRE_ACTION_when_savePreActionCheckpoint_called", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({ archive });

    await loop._savePreActionCheckpoint({ runId: "run-1" });

    expect(archive.save.mock.calls[0][1].metadata.type).toBe(sharedMocks.CheckpointType.PRE_ACTION);
  });

  it("should_copy_statusHistory_entries_when_savePreActionCheckpoint_called", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({ archive });
    loop._statusHistory = [{ from: "idle", to: "running", timestamp: 1 }];

    await loop._savePreActionCheckpoint({ runId: "run-1" });

    expect(archive.save.mock.calls[0][1].state.statusHistory).toEqual([{ from: "idle", to: "running", timestamp: 1 }]);
  });

  it("should_throw_when_transitionPhase_rejected_by_machine", () => {
    const loop = createLoop();
    statesMocks.designPhaseMachine.transition.mockReturnValue(false);

    expect(() => loop._transitionPhase(loop.phase, statesMocks.DesignPhase.PREPARE)).toThrow(
      "DesignPhase transition rejected"
    );
  });

  it("should_return_next_when_transitionPhase_succeeds", () => {
    const loop = createLoop();

    expect(loop._transitionPhase(loop.phase, statesMocks.DesignPhase.PREPARE)).toBe(statesMocks.DesignPhase.PREPARE);
  });

  it("should_call_custom_lifecycle_when_transitionPhase_called_with_lifecycle", () => {
    const loop = createLoop();
    const lifecycle = { phaseTransition: vi.fn() };

    loop._transitionPhase(loop.phase, statesMocks.DesignPhase.PREPARE, {
      runId: "run-1",
      payload: { ok: true },
      lifecycle,
    });

    expect(lifecycle.phaseTransition).toHaveBeenCalledWith(
      statesMocks.DesignPhase.IDLE,
      statesMocks.DesignPhase.PREPARE,
      "run-1",
      { ok: true }
    );
  });

  it("should_create_lifecycle_emitter_when_transitionPhase_called_without_lifecycle", () => {
    const loop = createLoop();
    const emit = vi.fn();

    loop._transitionPhase(loop.phase, statesMocks.DesignPhase.PREPARE, { runId: "run-1", emit });

    expect(runtimeMocks.createLifecycleEmitter).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "design",
        emit,
        eventBus: loop.eventBus,
      })
    );
  });

  it("should_use_trace_span_when_transitionPhase_has_traceContext", () => {
    const loop = createLoop();
    const lifecycle = { phaseTransition: vi.fn() };
    const span = {};
    loop._traceContext = { startSpan: vi.fn(() => span), endSpan: vi.fn() };

    loop._transitionPhase(loop.phase, statesMocks.DesignPhase.PREPARE, { runId: "run-1", lifecycle });

    expect(loop._traceContext.startSpan).toHaveBeenCalledWith(
      "design.phase.transition",
      expect.objectContaining({
        attributes: expect.objectContaining({
          from: statesMocks.DesignPhase.IDLE,
          to: statesMocks.DesignPhase.PREPARE,
          runId: "run-1",
        }),
      })
    );
  });

  it("should_end_trace_span_when_transitionPhase_lifecycle_throws", () => {
    const loop = createLoop();
    const span = {};
    loop._traceContext = { startSpan: vi.fn(() => span), endSpan: vi.fn() };
    const lifecycle = {
      phaseTransition: vi.fn(() => {
        throw new Error("boom");
      }),
    };

    try {
      loop._transitionPhase(loop.phase, statesMocks.DesignPhase.PREPARE, { runId: "run-1", lifecycle });
    } catch {
      // expected
    }

    expect(loop._traceContext.endSpan).toHaveBeenCalledWith(span);
  });

  it("should_emit_status_change_event_when_emitAgentStatusChanged_called", () => {
    const loop = createLoop();

    loop._emitAgentStatusChanged({ from: "idle", to: "running" });

    expect(loop.eventBus.emit).toHaveBeenCalledWith(
      "design.agent.status.changed",
      expect.objectContaining({
        actor: "design",
        status: "info",
        payload: { from: "idle", to: "running" },
      })
    );
  });

  it("should_prefer_loop_emit_when_emitAgentStatusChanged_called", () => {
    const loop = createLoop();
    loop.emit = vi.fn();

    loop._emitAgentStatusChanged({ from: "idle", to: "running" });

    expect(loop.emit).toHaveBeenCalledWith(
      "design.agent.status.changed",
      expect.objectContaining({ payload: { from: "idle", to: "running" } })
    );
  });

  it("should_noop_when_emit_is_truthy_non_function", () => {
    const loop = createLoop();
    loop.emit = "invalid";

    loop._emitAgentStatusChanged({ from: "idle", to: "running" });

    expect(loop.eventBus.emit).toHaveBeenCalledTimes(0);
  });

  it("should_return_null_when_transitionTo_called_with_same_status", async () => {
    const loop = createLoop({ _loopStatus: runtimeMocks.AgentStatus.RUNNING });

    expect(await loop._transitionTo(runtimeMocks.AgentStatus.RUNNING)).toBeNull();
  });

  it("should_reject_with_code_when_transitionTo_called_with_invalid_transition", async () => {
    const loop = createLoop({ _loopStatus: runtimeMocks.AgentStatus.IDLE });

    await expect(loop._transitionTo(runtimeMocks.AgentStatus.PAUSED)).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("should_return_checkpointId_when_transitionTo_saves_pre_action_checkpoint", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({ _loopStatus: runtimeMocks.AgentStatus.IDLE, archive, _pauseRequested: false });

    expect(await loop._transitionTo(runtimeMocks.AgentStatus.RUNNING, { runId: "run-1" })).toBe("checkpoint-xyz");
  });

  it("should_store_checkpointId_on_runtimeState_when_transitionTo_saves_checkpoint", async () => {
    const runtimeState = { status: "running", lastCheckpointId: null };
    telemetryMocks.getRuntimeState.mockReturnValue(runtimeState);
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({ _loopStatus: runtimeMocks.AgentStatus.IDLE, archive, _pauseRequested: false });

    await loop._transitionTo(runtimeMocks.AgentStatus.RUNNING, { runId: "run-1", stageApi: { signal: {} } });

    expect(runtimeState.lastCheckpointId).toBe("checkpoint-xyz");
  });

  it("should_throw_StagePausedError_when_transitionTo_pauses_run", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({
      _loopStatus: runtimeMocks.AgentStatus.IDLE,
      archive,
      _pauseRequested: true,
      _pauseReason: "user",
    });

    const promise = loop._transitionTo(runtimeMocks.AgentStatus.RUNNING, { runId: "run-1" });

    await expect(promise).rejects.toBeInstanceOf(runtimeMocks.StagePausedError);
  });

  it("should_set_loopStatus_to_PAUSED_when_transitionTo_pauses_run", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({
      _loopStatus: runtimeMocks.AgentStatus.IDLE,
      archive,
      _pauseRequested: true,
      _pauseReason: "user",
    });

    try {
      await loop._transitionTo(runtimeMocks.AgentStatus.RUNNING, { runId: "run-1" });
    } catch {
      // expected
    }

    expect(loop._loopStatus).toBe(runtimeMocks.AgentStatus.PAUSED);
  });

  it("should_include_checkpointId_in_pause_error_details_when_transitionTo_pauses_run", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({
      _loopStatus: runtimeMocks.AgentStatus.IDLE,
      archive,
      _pauseRequested: true,
      _pauseReason: "user",
    });

    await expect(loop._transitionTo(runtimeMocks.AgentStatus.RUNNING, { runId: "run-1" })).rejects.toMatchObject({
      details: { checkpointId: "checkpoint-xyz" },
    });
  });

  it("should_include_pausedReason_in_statusHistory_when_transitionTo_pauses_run", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({
      _loopStatus: runtimeMocks.AgentStatus.IDLE,
      archive,
      _pauseRequested: true,
      _pauseReason: "user",
    });

    try {
      await loop._transitionTo(runtimeMocks.AgentStatus.RUNNING, { runId: "run-1" });
    } catch {
      // expected
    }

    expect(loop._statusHistory.at(-1).pausedReason).toBe("user");
  });

  it("should_use_metadata_checkpointId_when_transitionTo_pauses_without_archive", async () => {
    const loop = createLoop({
      _loopStatus: runtimeMocks.AgentStatus.IDLE,
      archive: null,
      _pauseRequested: true,
      _pauseReason: "user",
    });

    await expect(
      loop._transitionTo(runtimeMocks.AgentStatus.RUNNING, { runId: "run-1", checkpointId: "from-meta" })
    ).rejects.toMatchObject({
      details: { checkpointId: "from-meta" },
    });
  });

  it("should_use_runtime_pausedReason_when_runtime_state_requests_pause", async () => {
    const runtimeState = { status: "paused", pausedReason: "runtime", lastCheckpointId: "from-runtime" };
    telemetryMocks.getRuntimeState.mockReturnValue(runtimeState);
    const loop = createLoop({
      _loopStatus: runtimeMocks.AgentStatus.IDLE,
      archive: null,
      _pauseRequested: false,
      _pauseReason: null,
    });

    try {
      await loop._transitionTo(runtimeMocks.AgentStatus.RUNNING, { runId: "run-1", stageApi: { signal: {} } });
    } catch {
      // expected
    }

    expect(loop._statusHistory.at(-1).pausedReason).toBe("runtime");
  });
});

describe("resumeDesignAgentLoop", () => {
  it("should_throw_when_DesignAgentLoopCtor_missing", async () => {
    await expect(stateManager.resumeDesignAgentLoop("checkpoint")).rejects.toThrow("missing DesignAgentLoopCtor");
  });

  it.each([null, undefined, "", " ", 0, -1, Number.MAX_SAFE_INTEGER, "0"])(
    "should_throw_when_checkpoint_not_found_for_checkpointId_%s",
    async (checkpointId) => {
      const { DesignAgentLoopCtor } = createResumeCtor();
      sharedMocks.archiveState.restoreResult = null;

      await expect(stateManager.resumeDesignAgentLoop(checkpointId, {}, { DesignAgentLoopCtor })).rejects.toThrow(
        "Checkpoint not found"
      );
    }
  );

  it("should_call_stageApi_archive_restore_when_stageApi_archive_provided", async () => {
    const { DesignAgentLoopCtor } = createResumeCtor();
    const archive = { restore: vi.fn(async () => createSnapshot({ contentPackage: { id: "pkg" } })) };

    await stateManager.resumeDesignAgentLoop("checkpoint", { archive }, { DesignAgentLoopCtor });

    expect(archive.restore).toHaveBeenCalledWith("checkpoint");
  });

  it("should_not_construct_Archive_when_stageApi_archive_provided", async () => {
    const { DesignAgentLoopCtor } = createResumeCtor();
    const archive = { restore: vi.fn(async () => createSnapshot({ contentPackage: { id: "pkg" } })) };

    await stateManager.resumeDesignAgentLoop("checkpoint", { archive }, { DesignAgentLoopCtor });

    expect(sharedMocks.Archive).not.toHaveBeenCalled();
  });

  it("should_call_migrateCheckpoint_when_restoring_checkpoint", async () => {
    const { DesignAgentLoopCtor } = createResumeCtor();
    const snapshot = createSnapshot({ contentPackage: { id: "pkg" } });
    sharedMocks.archiveState.restoreResult = snapshot;

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(sharedMocks.migrateCheckpoint).toHaveBeenCalledWith(snapshot);
  });

  it("should_create_MapAdapter_when_indexedDB_unavailable", async () => {
    globalThis.indexedDB = undefined;
    const { DesignAgentLoopCtor } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(sharedMocks.MapAdapter).toHaveBeenCalledTimes(1);
  });

  it("should_pass_MapAdapter_to_Archive_when_indexedDB_unavailable", async () => {
    globalThis.indexedDB = undefined;
    const { DesignAgentLoopCtor } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(sharedMocks.Archive.mock.calls[0][0]).toMatchObject({ type: "map" });
  });

  it("should_create_FallbackAdapter_when_indexedDB_available", async () => {
    globalThis.indexedDB = {};
    const { DesignAgentLoopCtor } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(sharedMocks.FallbackAdapter).toHaveBeenCalledWith("PPTArchiveDB", "checkpoints");
  });

  it("should_set_loopStatus_to_IDLE_when_resuming", async () => {
    const { DesignAgentLoopCtor, getLastInstance } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(getLastInstance()._loopStatus).toBe(runtimeMocks.AgentStatus.IDLE);
  });

  it("should_reset_pause_flags_when_resuming", async () => {
    const { DesignAgentLoopCtor, getLastInstance } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(getLastInstance()._pauseRequested).toBe(false);
  });

  it("should_restore_statusHistory_when_checkpoint_contains_statusHistory", async () => {
    const { DesignAgentLoopCtor, getLastInstance } = createResumeCtor();
    const statusHistory = [{ from: "idle", to: "running", timestamp: 1 }];
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" }, statusHistory });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(getLastInstance()._statusHistory).toEqual(statusHistory);
  });

  it("should_set_resumeState_phase_when_checkpoint_contains_phase", async () => {
    const { DesignAgentLoopCtor, getLastInstance } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({
      phase: statesMocks.DesignPhase.GENERATE,
      contentPackage: { id: "pkg" },
    });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(getLastInstance()._resumeState.phase).toBe(statesMocks.DesignPhase.GENERATE);
  });

  it("should_create_resume_tool_executor_when_resuming", async () => {
    const { DesignAgentLoopCtor } = createResumeCtor();
    const contentPackage = { id: "pkg" };
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(toolHandlerMocks.createResumeToolExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ stageApi: {}, contentPackage })
    );
  });

  it("should_pass_toolExecutor_to_run_options_when_resuming", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(run.mock.calls[0][1].toolExecutor).toEqual({ executor: "resume" });
  });

  it("should_use_fallback_contentPackage_from_stageApi_input_when_missing_from_checkpoint", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();
    const fallback = { runId: "fallback" };
    sharedMocks.archiveState.restoreResult = createSnapshot({
      phase: statesMocks.DesignPhase.IDLE,
      loopStatus: runtimeMocks.AgentStatus.IDLE,
    });

    await stateManager.resumeDesignAgentLoop("checkpoint", { input: fallback }, { DesignAgentLoopCtor });

    expect(run.mock.calls[0][0]).toEqual(fallback);
  });

  it("should_deep_clone_fallback_contentPackage_into_state_when_missing", async () => {
    const { DesignAgentLoopCtor, getLastInstance } = createResumeCtor();
    const fallback = { runId: "fallback", nested: { value: "deep" } };
    sharedMocks.archiveState.restoreResult = createSnapshot({
      phase: statesMocks.DesignPhase.IDLE,
      loopStatus: runtimeMocks.AgentStatus.IDLE,
    });

    await stateManager.resumeDesignAgentLoop("checkpoint", { contentPackage: fallback }, { DesignAgentLoopCtor });

    expect(getLastInstance().state.contentPackage).not.toBe(fallback);
  });

  it("should_throw_when_contentPackage_missing_from_checkpoint_and_stageApi", async () => {
    const { DesignAgentLoopCtor } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({
      phase: statesMocks.DesignPhase.IDLE,
      loopStatus: runtimeMocks.AgentStatus.IDLE,
    });

    await expect(stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor })).rejects.toThrow(
      "Checkpoint missing contentPackage"
    );
  });

  it("should_use_stageApi_runContext_runId_when_provided", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { runId: "content" } });

    await stateManager.resumeDesignAgentLoop(
      "checkpoint",
      { runContext: { runId: "stage-run", constraints: {} } },
      { DesignAgentLoopCtor }
    );

    expect(run.mock.calls[0][1].runContext.runId).toBe("stage-run");
  });

  it("should_use_nodeStates_runId_when_stageApi_runContext_missing", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" }, runId: "node-run" });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(run.mock.calls[0][1].runContext.runId).toBe("node-run");
  });

  it("should_use_snapshot_metadata_runId_when_nodeStates_runId_missing", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } }, { runId: "meta-run" });

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(run.mock.calls[0][1].runContext.runId).toBe("meta-run");
  });

  it("should_default_runId_to_run_unknown_when_all_sources_missing", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } }, {});

    await stateManager.resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(run.mock.calls[0][1].runContext.runId).toBe("run_unknown");
  });

  it("should_use_stageApi_runContext_constraints_when_provided", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({
      contentPackage: { runId: "content", constraints: { maxSlides: 1 } },
    });

    await stateManager.resumeDesignAgentLoop(
      "checkpoint",
      { runContext: { runId: "stage-run", constraints: { maxSlides: 5 } } },
      { DesignAgentLoopCtor }
    );

    expect(run.mock.calls[0][1].runContext.constraints).toEqual({ maxSlides: 5 });
  });

  it("should_fallback_to_contentPackage_constraints_when_stage_constraints_missing", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({
      contentPackage: { runId: "content", constraints: { maxSlides: 9 } },
    });

    await stateManager.resumeDesignAgentLoop("checkpoint", { runContext: { runId: "stage-run" } }, { DesignAgentLoopCtor });

    expect(run.mock.calls[0][1].runContext.constraints).toEqual({ maxSlides: 9 });
  });

  it("should_support_concurrent_resume_calls", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = (checkpointId) =>
      createSnapshot({
        contentPackage: { runId: String(checkpointId), constraints: {}, meta: { id: checkpointId } },
      });

    await Promise.all([
      stateManager.resumeDesignAgentLoop("first", {}, { DesignAgentLoopCtor }),
      stateManager.resumeDesignAgentLoop("second", {}, { DesignAgentLoopCtor }),
    ]);

    expect(run).toHaveBeenCalledTimes(2);
  });
});