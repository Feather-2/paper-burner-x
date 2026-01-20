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

import {
  createEmptyDesignLoopState,
  installStateManager,
  resumeDesignAgentLoop,
} from "../../../../../../js/agents/stages/design/internal/state-manager.js";

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
    this.state = createEmptyDesignLoopState();
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

installStateManager(TestLoop);

const createLoop = (overrides = {}) => new TestLoop(overrides);

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
    this._statusHistory = [];
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
    run,
    hydrateFromNodeStates,
    getLastInstance: () => lastInstance,
  };
};

const createSnapshot = (nodeStates = {}, metadata = {}) => ({ nodeStates, metadata });

describe("createEmptyDesignLoopState", () => {
  it("returns the expected empty defaults", () => {
    const state = createEmptyDesignLoopState();

    expect(state).toEqual({
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
    });
  });

  it("returns independent instances for rapid consecutive calls", () => {
    const first = createEmptyDesignLoopState();
    const second = createEmptyDesignLoopState();
    const third = createEmptyDesignLoopState();

    first.slideIntents.push("first");
    first.constraints.maxSlides = 3;

    expect(second.slideIntents).toEqual([]);
    expect(third.slideIntents).toEqual([]);
    expect(second.constraints).toEqual({});
    expect(third.constraints).toEqual({});
    expect(first.slideIntents).not.toBe(second.slideIntents);
    expect(second.slideIntents).not.toBe(third.slideIntents);
  });

  it("supports concurrent calls without shared references", async () => {
    const [one, two] = await Promise.all([
      Promise.resolve().then(() => createEmptyDesignLoopState()),
      Promise.resolve().then(() => createEmptyDesignLoopState()),
    ]);

    one.userConfig.mode = "a";

    expect(one).not.toBe(two);
    expect(one.userConfig).not.toBe(two.userConfig);
    expect(two.userConfig).toEqual({});
  });
});

describe("installStateManager", () => {
  it("installs methods and accessors", () => {
    const loop = createLoop();

    const methods = [
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
    ];

    methods.forEach((name) => {
      expect(typeof loop[name]).toBe("function");
    });

    loop._statusHistory.push({ from: "idle", to: "running" });

    expect(loop.loopStatus).toBe(runtimeMocks.AgentStatus.IDLE);
    expect(loop.statusHistory).toEqual([{ from: "idle", to: "running" }]);
    expect(loop.statusHistory).not.toBe(loop._statusHistory);
  });

  it("saveVersion returns null without a blackboard", () => {
    const loop = createLoop({ _blackboard: null });

    expect(loop.saveVersion("missing")).toBeNull();
  });

  it("saveVersion clones state and returns the saved version", () => {
    const loop = createLoop();
    loop.phase.status = statesMocks.DesignPhase.PREPARE;
    loop._loopStatus = runtimeMocks.AgentStatus.RUNNING;
    loop.state = { contentPackage: { id: "pkg" }, slideIntents: ["s1"] };
    loop._blackboard.saveVersion.mockReturnValue({ label: "v1" });

    const result = loop.saveVersion("v1");
    const [label, snapshot] = loop._blackboard.saveVersion.mock.calls[0];

    expect(result).toEqual({ label: "v1" });
    expect(label).toBe("v1");
    expect(snapshot).toMatchObject({
      phase: statesMocks.DesignPhase.PREPARE,
      loopStatus: runtimeMocks.AgentStatus.RUNNING,
      timestamp: expect.any(Number),
    });
    expect(snapshot.state).toEqual(loop.state);
    expect(snapshot.state).not.toBe(loop.state);
  });

  it("getVersion and listVersions return defaults without a blackboard", () => {
    const loop = createLoop({ _blackboard: null });

    expect(loop.getVersion("missing")).toBeNull();
    expect(loop.listVersions()).toEqual([]);
  });

  it("serializeNodeStates returns safe defaults for nullish state", () => {
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

  it("serializeNodeStates normalizes invalid types and preserves boundary values", () => {
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

  it("serializeNodeStates deep clones nested structures", () => {
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

  it("hydrateFromNodeStates initializes missing state for empty inputs", () => {
    const loop = createLoop({ state: null });

    loop.hydrateFromNodeStates(undefined);

    expect(loop.state).toEqual(createEmptyDesignLoopState());
  });

  it("hydrateFromNodeStates ignores invalid types and empty values", () => {
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

    expect(loop.state.contentPackage).toBeNull();
    expect(loop.state.slideIntents).toEqual([]);
    expect(loop.state.designSystem).toBeNull();
    expect(loop.state.slideHtmls).toEqual([]);
    expect(loop.state.deckHtmlDsl).toBe("");
    expect(loop.state.imageSlots).toEqual([]);
    expect(loop.state.visualSlots).toEqual([]);
  });

  it("hydrateFromNodeStates uses parsedContentPackage and clones deep data", () => {
    const deepPackage = { nested: { level1: { level2: { value: "deep" } } } };
    const intents = [{ id: "s1" }];
    const htmls = ["<section></section>"];
    const longDsl = "a".repeat(200000);

    const loop = createLoop({ state: null });

    loop.hydrateFromNodeStates({
      parsedContentPackage: deepPackage,
      slideIntents: intents,
      designSystem: { theme: "light" },
      slideHtmls: htmls,
      deckHtmlDsl: longDsl,
      imageSlots: [],
      visualSlots: [],
    });

    deepPackage.nested.level1.level2.value = "changed";
    intents[0].id = "mutated";

    expect(loop.state.contentPackage).toEqual({ nested: { level1: { level2: { value: "deep" } } } });
    expect(loop.state.contentPackage).not.toBe(deepPackage);
    expect(loop.state.slideIntents).toEqual([{ id: "s1" }]);
    expect(loop.state.slideIntents).not.toBe(intents);
    expect(loop.state.deckHtmlDsl).toBe(longDsl);
  });

  it("backtrackTo throws when blackboard is missing", () => {
    const loop = createLoop({ _blackboard: null });

    expect(() => loop.backtrackTo("v1")).toThrow("no blackboard");
  });

  it("backtrackTo throws when version is not found", () => {
    const loop = createLoop();
    loop._blackboard.getVersion.mockReturnValue(null);

    expect(() => loop.backtrackTo("v1")).toThrow('version "v1" not found');
  });

  it("backtrackTo restores snapshot and throws BacktrackError", () => {
    const loop = createLoop();
    const snapshotState = { contentPackage: { id: "pkg" } };

    loop._blackboard.getVersion.mockReturnValue({
      snapshot: {
        phase: statesMocks.DesignPhase.PREPARE,
        loopStatus: runtimeMocks.AgentStatus.PAUSED,
        state: snapshotState,
      },
    });
    loop._emit = vi.fn();

    let thrown;
    try {
      loop.backtrackTo("v2", "manual");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(helperMocks.BacktrackError);
    expect(thrown.targetPhase).toBe(statesMocks.DesignPhase.PREPARE);
    expect(thrown.label).toBe("v2");
    expect(thrown.reason).toBe("manual");
    expect(loop.phase.status).toBe(statesMocks.DesignPhase.PREPARE);
    expect(loop._loopStatus).toBe(runtimeMocks.AgentStatus.PAUSED);
    expect(loop.state).toEqual(snapshotState);
    expect(loop.state).not.toBe(snapshotState);
    expect(loop._blackboard.restoreVersion).toHaveBeenCalledWith("v2");
    expect(loop._emit).toHaveBeenCalledWith(
      "design.backtrack",
      expect.objectContaining({
        label: "v2",
        targetPhase: statesMocks.DesignPhase.PREPARE,
        reason: "manual",
        timestamp: expect.any(Number),
      })
    );
    expect(loop._isBacktracking).toBe(true);
  });

  it("backtrackToLastCheckpoint throws when no versions exist", () => {
    const loop = createLoop();
    loop._blackboard.listVersions.mockReturnValue([]);

    expect(() => loop.backtrackToLastCheckpoint()).toThrow("no versions available");
  });

  it("backtrackToLastCheckpoint uses the latest version label", () => {
    const loop = createLoop();
    loop._blackboard.listVersions.mockReturnValue([{ label: "v1" }, { label: "v2" }]);
    loop.backtrackTo = vi.fn();

    loop.backtrackToLastCheckpoint("auto");

    expect(loop.backtrackTo).toHaveBeenCalledWith("v2", "auto");
  });

  it("_savePreActionCheckpoint merges node states and saves checkpoint", async () => {
    const archive = { save: vi.fn(async () => "checkpoint-xyz") };
    const loop = createLoop({ archive });
    loop.state = {
      contentPackage: { id: "pkg" },
      slideIntents: [{ id: "s1" }],
      designSystem: { theme: "light" },
      slideHtmls: ["<section></section>"],
      deckHtmlDsl: "state-dsl",
      imageSlots: [],
      visualSlots: [],
    };
    loop.phase.status = statesMocks.DesignPhase.GENERATE;
    loop._loopStatus = runtimeMocks.AgentStatus.RUNNING;
    loop._statusHistory = [{ from: "idle", to: "running", timestamp: 1 }];

    const result = await loop._savePreActionCheckpoint({
      runId: "run-1",
      nodeStates: { deckHtmlDsl: "node-dsl" },
      extra: "meta",
    });

    expect(result).toBe("checkpoint-xyz");
    expect(sharedMocks.createCheckpoint).toHaveBeenCalledTimes(1);

    const [checkpointState, checkpointMeta] = sharedMocks.createCheckpoint.mock.calls[0];

    expect(checkpointState).toMatchObject({
      phase: statesMocks.DesignPhase.GENERATE,
      loopStatus: runtimeMocks.AgentStatus.RUNNING,
      deckHtmlDsl: "node-dsl",
    });
    expect(checkpointState.statusHistory).toEqual([{ from: "idle", to: "running", timestamp: 1 }]);
    expect(checkpointState.statusHistory).not.toBe(loop._statusHistory);

    expect(checkpointMeta).toMatchObject({
      runId: "run-1",
      extra: "meta",
      type: sharedMocks.CheckpointType.PRE_ACTION,
    });
    expect(archive.save).toHaveBeenCalledWith("run-1", expect.any(Object));
  });
});

describe("resumeDesignAgentLoop", () => {
  it("throws when DesignAgentLoopCtor is missing", async () => {
    await expect(resumeDesignAgentLoop("checkpoint")).rejects.toThrow("missing DesignAgentLoopCtor");
  });

  it("rejects missing checkpoints for boundary checkpoint ids", async () => {
    const { DesignAgentLoopCtor } = createResumeCtor();
    const boundaryIds = [null, undefined, "", " ", 0, -1, Number.MAX_SAFE_INTEGER, "0"];

    for (const checkpointId of boundaryIds) {
      sharedMocks.archiveState.restoreResult = null;
      await expect(resumeDesignAgentLoop(checkpointId, {}, { DesignAgentLoopCtor })).rejects.toThrow("Checkpoint not found");
    }
  });

  it("uses stageApi.archive and skips Archive construction", async () => {
    const { DesignAgentLoopCtor } = createResumeCtor();
    const snapshot = createSnapshot({ contentPackage: { id: "pkg" } });
    const archive = { restore: vi.fn(async () => snapshot) };

    await resumeDesignAgentLoop("checkpoint", { archive }, { DesignAgentLoopCtor });

    expect(archive.restore).toHaveBeenCalledWith("checkpoint");
    expect(sharedMocks.Archive).not.toHaveBeenCalled();
    expect(sharedMocks.migrateCheckpoint).toHaveBeenCalledWith(snapshot);
  });

  it("creates an Archive with MapAdapter when indexedDB is unavailable", async () => {
    globalThis.indexedDB = undefined;
    const { DesignAgentLoopCtor } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } });

    await resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(sharedMocks.MapAdapter).toHaveBeenCalledTimes(1);
    expect(sharedMocks.FallbackAdapter).not.toHaveBeenCalled();
    expect(sharedMocks.Archive).toHaveBeenCalledTimes(1);
    expect(sharedMocks.Archive.mock.calls[0][0]).toMatchObject({ type: "map" });
  });

  it("creates an Archive with FallbackAdapter when indexedDB is available", async () => {
    globalThis.indexedDB = {};
    const { DesignAgentLoopCtor } = createResumeCtor();
    sharedMocks.archiveState.restoreResult = createSnapshot({ contentPackage: { id: "pkg" } });

    await resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor });

    expect(sharedMocks.FallbackAdapter).toHaveBeenCalledWith("PPTArchiveDB", "checkpoints");
    expect(sharedMocks.Archive).toHaveBeenCalledTimes(1);
  });

  it("hydrates resume state and forwards run context", async () => {
    const { DesignAgentLoopCtor, run, getLastInstance } = createResumeCtor();
    const longDsl = "b".repeat(200000);
    const contentPackage = {
      runId: "run-from-content",
      constraints: { maxSlides: 9 },
      deep: { level1: { level2: { value: "deep" } } },
    };

    sharedMocks.archiveState.restoreResult = createSnapshot(
      {
        phase: statesMocks.DesignPhase.GENERATE,
        loopStatus: runtimeMocks.AgentStatus.PAUSED,
        contentPackage,
        slideIntents: [{ id: "s1" }],
        designSystem: { theme: "light" },
        generated: ["gen"],
        slideHtmls: ["<section></section>"],
        deckHtmlDsl: longDsl,
        slidesMeta: [{ index: 0 }],
        imageSlots: [],
        visualSlots: [],
        imageReport: { ok: true },
        visualReport: { ok: true },
        pendingImages: [],
        refineReport: { ok: true },
        constraints: { maxSlides: 3 },
        userConfig: { locale: "en" },
        runId: "run-from-node",
      },
      { runId: "run-from-meta" }
    );

    const stageApi = {
      runContext: { runId: "run-from-stage", constraints: { maxSlides: 5 } },
    };

    await resumeDesignAgentLoop("checkpoint", stageApi, { DesignAgentLoopCtor });

    const loop = getLastInstance();
    expect(loop._loopStatus).toBe(runtimeMocks.AgentStatus.IDLE);
    expect(loop.phase).toEqual({ status: statesMocks.DesignPhase.IDLE });
    expect(loop._resumeState).toMatchObject({
      loopStatus: runtimeMocks.AgentStatus.PAUSED,
      phase: statesMocks.DesignPhase.GENERATE,
      deckHtmlDsl: longDsl,
      constraints: { maxSlides: 3 },
      userConfig: { locale: "en" },
    });

    expect(toolHandlerMocks.createResumeToolExecutor).toHaveBeenCalledWith({
      agentLoop: loop,
      stageApi,
      resumeState: loop._resumeState,
      contentPackage,
    });

    expect(run).toHaveBeenCalledWith(contentPackage, expect.objectContaining({
      resumed: true,
      resumeState: loop._resumeState,
      runContext: { runId: "run-from-stage", constraints: { maxSlides: 5 } },
    }));
  });

  it("uses fallback contentPackage and deep clones into state", async () => {
    const { DesignAgentLoopCtor, getLastInstance } = createResumeCtor();
    const fallbackPackage = { runId: "fallback", nested: { value: "deep" } };

    sharedMocks.archiveState.restoreResult = createSnapshot({
      phase: statesMocks.DesignPhase.IDLE,
      loopStatus: runtimeMocks.AgentStatus.IDLE,
      slideIntents: [],
    });

    await resumeDesignAgentLoop("checkpoint", { contentPackage: fallbackPackage }, { DesignAgentLoopCtor });

    const loop = getLastInstance();
    expect(loop.state.contentPackage).toEqual(fallbackPackage);
    expect(loop.state.contentPackage).not.toBe(fallbackPackage);
    expect(sharedMocks.deepClone).toHaveBeenCalledWith(fallbackPackage);
  });

  it("throws when contentPackage is missing from checkpoint and stageApi", async () => {
    const { DesignAgentLoopCtor } = createResumeCtor();

    sharedMocks.archiveState.restoreResult = createSnapshot({
      phase: statesMocks.DesignPhase.IDLE,
      loopStatus: runtimeMocks.AgentStatus.IDLE,
    });

    await expect(resumeDesignAgentLoop("checkpoint", {}, { DesignAgentLoopCtor })).rejects.toThrow(
      "Checkpoint missing contentPackage"
    );
  });

  it("supports concurrent resume calls", async () => {
    const { DesignAgentLoopCtor, run } = createResumeCtor();

    sharedMocks.archiveState.restoreResult = (checkpointId) =>
      createSnapshot({
        contentPackage: { runId: String(checkpointId), constraints: {}, meta: { id: checkpointId } },
      });

    await Promise.all([
      resumeDesignAgentLoop("first", {}, { DesignAgentLoopCtor }),
      resumeDesignAgentLoop("second", {}, { DesignAgentLoopCtor }),
    ]);

    const runIds = run.mock.calls.map((call) => call[0].runId);

    expect(runIds).toContain("first");
    expect(runIds).toContain("second");
    expect(run).toHaveBeenCalledTimes(2);
  });
});
