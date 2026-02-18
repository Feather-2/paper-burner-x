import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeepSearchState,
  EVENT_SCHEMA_VERSION,
  EventStatus,
  checkCancelled,
  computeRoundHitsByGapId,
  extractJsonCandidate,
  generateNodeId,
  loadCheckpoint,
  makeStageEmitter,
  normalizeBudgetConfig,
  stripThinkingTags,
  transitionGap,
  validateIteration,
} from "../../../../../js/agents/stages/deepsearch/state.js";
import { PlanningTree } from "../../../../../js/agents/stages/deepsearch/state/planning-tree.js";
import { Deque } from "../../../../../js/agents/shared/utils/deque.js";
import { DecisionOutcome, DecisionStage, GapStatus, TodoStatus } from "../../../../../js/agents/stages/deepsearch/states.js";
import { L0_REPLACE_TODOS, L0_SET_TASK_GOAL } from "../../../../../js/agents/plugins/memory/index.js";
import * as stateUtils from "../../../../../js/agents/stages/deepsearch/utils/state-utils.js";

const serializerMocks = vi.hoisted(() => ({
  toJSON: vi.fn(),
  fromSnapshot: vi.fn(),
}));

vi.mock("../../../../../js/agents/stages/deepsearch/state/serializer.js", () => ({
  toJSON: (...args) => serializerMocks.toJSON(...args),
  fromSnapshot: (...args) => serializerMocks.fromSnapshot(...args),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  serializerMocks.toJSON.mockImplementation(() => ({ mocked: true }));
  serializerMocks.fromSnapshot.mockImplementation((json) => json || {});
  vi.useRealTimers();
});

describe("DeepSearchState", () => {
  it("normalizes defaults and boundary inputs", () => {
    const ensureSpy = vi
      .spyOn(stateUtils, "ensureTokenUsage")
      .mockReturnValue({ input: 9, output: 8, total: 17, estimatedCostUSD: 1.23 });

    const state = new DeepSearchState({
      runId: " ",
      taskGoal: "",
      createdAt: "",
      schemaVersion: null,
      L0: null,
      L1: null,
      L2: {
        retrievedChunks: { nope: true },
        scratchpad: "bad",
        thoughtHistory: "bad",
        logs: "bad",
        tokenUsage: { input: 1 },
        awaitUserFeedback: "yes",
        taskImpossible: null,
        reason: 0,
      },
      todos: {},
      timeline: {},
      iteration: "-1",
      maxIterations: "0",
      checkpoints: {},
      writeBacktrackCount: -1,
      writeSnapshots: {},
      userConfig: { trajectory: { mode: "auto" } },
      trajectoryConfig: null,
    });

    expect(state.schemaVersion).toBe("0.1");
    expect(state.runId).toBe("run_unknown");
    expect(state.taskGoal).toBe("");
    expect(state.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(state.L0).toMatchObject({ sources: [], sourceIndex: null });
    expect(Array.isArray(state.L1.gaps)).toBe(true);
    expect(state.L2.retrievedChunks).toEqual([]);
    expect(state.L2.scratchpad).toEqual({});
    expect(state.L2.thoughtHistory).toEqual([]);
    expect(state.L2.logs).toEqual([]);
    expect(state.L2.tokenUsage).toEqual({ input: 9, output: 8, total: 17, estimatedCostUSD: 1.23 });
    expect(ensureSpy).toHaveBeenCalledWith({ input: 1 });
    expect(state.L2.awaitUserFeedback).toBe(false);
    expect(state.L2.taskImpossible).toBe(false);
    expect(state.L2.reason).toBe("0");

    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(5);
    expect(state.checkpoints).toEqual([]);
    expect(state.writeBacktrackCount).toBe(0);
    expect(state.writeSnapshots).toEqual([]);
    expect(state.todos).toEqual([]);

    expect(state.timeline).toBeInstanceOf(Deque);
    expect(state.timeline.size).toBe(0);

    expect(state.trajectoryConfig).toEqual({ mode: "auto" });
    expect(state.planningTree).toBeInstanceOf(PlanningTree);
  });

  it("accepts large numeric boundaries", () => {
    const state = new DeepSearchState({ iteration: 0, maxIterations: Number.MAX_SAFE_INTEGER });
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("keeps todos array reference stable on rapid updates", () => {
    const state = new DeepSearchState({ runId: "run_todos", taskGoal: "goal" });
    const ref = state.todos;

    [{ todoId: "t1" }, { todoId: "t2" }, { todoId: "t3" }].forEach((item) => {
      state.todos = [item];
    });

    expect(state.todos).toBe(ref);
    expect(state.todos.map((t) => t.todoId)).toEqual(["t3"]);
  });

  it("bindStateEngine seeds task goal and todos when engine is empty", () => {
    const seedTodos = [{ todoId: "t1", status: "open" }];
    const expectedTodos = seedTodos.map((todo) => ({ ...todo }));
    const engineState = { L0: { taskGoal: "", todos: [] } };
    const dispatchSync = vi.fn();
    const engine = {
      _getStateRef: () => engineState,
      dispatchSync,
      subscribe: vi.fn(),
    };

    const state = new DeepSearchState({ runId: "run_seed", taskGoal: "goal", todos: seedTodos });
    state.bindStateEngine(engine);

    expect(dispatchSync).toHaveBeenCalledWith({ type: L0_SET_TASK_GOAL, payload: { goal: "goal" } });
    const replaceCall = dispatchSync.mock.calls.find((call) => call[0].type === L0_REPLACE_TODOS);
    expect(replaceCall).toBeTruthy();
    expect(replaceCall[0].payload.todos).toEqual(expectedTodos);
    expect(replaceCall[0].payload.todos).not.toBe(seedTodos);
  });

  it("todos setter dispatches and falls back on engine errors", () => {
    const engineState = { L0: { taskGoal: "goal", todos: [{ todoId: "existing" }] } };
    const dispatchSync = vi.fn(() => {
      throw new Error("dispatch failed");
    });
    const engine = {
      _getStateRef: () => engineState,
      dispatchSync,
      subscribe: vi.fn(),
    };

    const state = new DeepSearchState({ runId: "run", taskGoal: "goal", stateEngine: engine });
    state.todos = [{ todoId: "next", status: "open" }];

    expect(dispatchSync).toHaveBeenCalled();
    expect(state.todos.map((t) => t.todoId)).toEqual(["next"]);
  });

  it("syncs L0 from state engine into memory store", () => {
    const memoryStore = { setTaskGoal: vi.fn(), replaceTodos: vi.fn(), L0: {} };
    const engineState = { L0: { taskGoal: "engine_goal", todos: [{ todoId: "t1" }] } };
    const engine = {
      _getStateRef: () => engineState,
      dispatchSync: vi.fn(),
      subscribe: vi.fn(),
    };

    const state = new DeepSearchState({ runId: "run", taskGoal: "local_goal", memoryStore });
    state.bindStateEngine(engine);

    expect(memoryStore.setTaskGoal).toHaveBeenCalledWith("engine_goal");
    expect(memoryStore.replaceTodos).toHaveBeenCalledWith([{ todoId: "t1" }]);
    expect(state.todos).toEqual([{ todoId: "t1" }]);
  });

  it("toJSON delegates to serializer", () => {
    const state = new DeepSearchState({ runId: "run_json", taskGoal: "goal" });
    serializerMocks.toJSON.mockReturnValue({ ok: true });

    const result = state.toJSON({ includeCheckpoints: false });

    expect(serializerMocks.toJSON).toHaveBeenCalledWith(state, { includeCheckpoints: false });
    expect(result).toEqual({ ok: true });
  });

  it("fromJSON validates input and hydrates planningTree", () => {
    serializerMocks.fromSnapshot.mockReturnValue({ runId: "run_json", taskGoal: "goal_json" });
    const treeSpy = vi.spyOn(PlanningTree, "fromJSON");

    expect(() => DeepSearchState.fromJSON(null)).toThrow(TypeError);
    expect(() => DeepSearchState.fromJSON([])).toThrow(TypeError);

    const state = DeepSearchState.fromJSON({ planningTree: { rootGoal: "root", runId: "run_json" } });

    expect(treeSpy).toHaveBeenCalled();
    expect(state).toBeInstanceOf(DeepSearchState);
    expect(state.planningTree).toBeInstanceOf(PlanningTree);
    expect(state.planningTree.rootGoal).toBe("root");
  });

  it("dispose unsubscribes and prevents access", async () => {
    const rawUnsub = vi.fn();
    const engine = {
      _getStateRef: () => ({ L0: {} }),
      dispatchSync: vi.fn(),
      subscribe: vi.fn(() => rawUnsub),
      dispose: vi.fn(),
    };
    const state = new DeepSearchState({ runId: "run", taskGoal: "goal" });
    state.bindStateEngine(engine);

    await state.dispose();

    expect(rawUnsub).toHaveBeenCalledTimes(1);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(() => state.taskGoal).toThrow(/disposed/);
    expect(() => state.toJSON()).toThrow(/disposed/);
  });
});

describe("makeStageEmitter", () => {
  it("returns null without an emit function", () => {
    expect(makeStageEmitter(null)).toBeNull();
    expect(makeStageEmitter({})).toBeNull();
  });

  it("emits schema-stamped events with throttling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    const emit = vi.fn();
    const stageApi = { eventBus: { emit } };
    const emitter = makeStageEmitter(stageApi, "actorA", () => ({ runId: "run1" }));

    emitter("event.one", { ok: true });
    emitter("event.one", { ok: false });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("event.one");
    expect(emit.mock.calls[0][1]).toMatchObject({
      schemaVersion: EVENT_SCHEMA_VERSION,
      name: "event.one",
      actor: "actorA",
      status: EventStatus.COMPLETED,
      runId: "run1",
      payload: { ok: true },
      ts: new Date("2024-01-01T00:00:00.000Z").toISOString(),
    });

    vi.advanceTimersByTime(150);
    emitter("event.one", { ok: false });

    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("supports throttle override for rapid calls", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    const emit = vi.fn();
    const stageApi = { emit };
    const emitter = makeStageEmitter(stageApi, "actorB");

    emitter("event.two", { step: 1 }, { throttle: false, status: EventStatus.STARTED });
    emitter("event.two", { step: 2 }, { throttle: false, status: EventStatus.PROGRESS });

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][1].status).toBe(EventStatus.PROGRESS);
  });
});

describe("generateNodeId", () => {
  it("includes key parts and increments within the same timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2100-01-01T00:00:00.000Z"));

    const id1 = generateNodeId("", "gap", { stage: "scan", iteration: 0, trajectoryId: "traj" });
    const id2 = generateNodeId("", "gap", { stage: "scan", iteration: 0, trajectoryId: "traj" });

    expect(id1.startsWith("run_gap_scan_i0_traj_")).toBe(true);
    expect(id1).not.toBe(id2);

    vi.setSystemTime(new Date("2100-01-01T00:00:01.000Z"));
    const id3 = generateNodeId("run", "gap");
    expect(id3.startsWith("run_gap_")).toBe(true);
  });
});

describe("checkCancelled", () => {
  it("invokes stageApi.checkCancelled and throws on abort", () => {
    const check = vi.fn();
    const stageApi = { checkCancelled: check, signal: { aborted: false } };
    checkCancelled(stageApi);
    expect(check).toHaveBeenCalledTimes(1);

    const aborted = { signal: { aborted: true, reason: "stopped" } };
    expect(() => checkCancelled(aborted)).toThrow("stopped");

    const abortedNoReason = { signal: { aborted: true, reason: new Error("nope") } };
    expect(() => checkCancelled(abortedNoReason)).toThrow("Run cancelled");
  });
});

describe("transitionGap", () => {
  it("updates status, timestamps, and emits transitions", () => {
    const gap = { gapId: "g1", status: GapStatus.OPEN };
    const emit = vi.fn();
    const changed = transitionGap(gap, GapStatus.FILLED, { ts: 123 }, emit);

    expect(changed).toBe(true);
    expect(gap.status).toBe(GapStatus.FILLED);
    expect(gap.updatedAt).toBe(123);
    expect(emit).toHaveBeenCalledWith("deepsearch.gap.transitioned", { gapId: "g1", from: GapStatus.OPEN, to: GapStatus.FILLED });
  });

  it("returns false when no transition is needed", () => {
    const gap = { gapId: "g2" };
    expect(transitionGap(null, GapStatus.OPEN)).toBe(false);
    expect(transitionGap(gap, GapStatus.OPEN)).toBe(false);
    expect(gap.status).toBeUndefined();
  });

  it("uses Date.now when no timestamp is provided", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    const gap = { gapId: "g3", status: GapStatus.OPEN };
    transitionGap(gap, GapStatus.BLOCKED);
    expect(gap.updatedAt).toBe(Date.now());
  });
});

describe("computeRoundHitsByGapId", () => {
  it("builds a map of hit counts and handles null", () => {
    const map = computeRoundHitsByGapId([
      { gapId: "g1", hitCount: 2 },
      { gapId: "g2" },
      { gapId: "" },
    ]);

    expect(map.get("g1")).toBe(2);
    expect(map.get("g2")).toBe(0);
    expect(map.has("")).toBe(false);
    expect(computeRoundHitsByGapId(null).size).toBe(0);
  });
});

describe("validateIteration", () => {
  it("fills gaps when evidence meets threshold and records decisions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-02T00:00:00.000Z"));

    const gap = { gapId: "g1", status: GapStatus.BLOCKED, missCount: 1 };
    const emit = vi.fn();
    const updateTodo = vi.fn((todoId, updates) => ({ todoId, status: updates.status }));
    const planningTree = {
      getNodesForGap: vi.fn(() => [{ nodeId: "n1" }]),
      recordDecision: vi.fn(),
      updateStatus: vi.fn(),
    };
    const addTimeline = vi.fn();

    const state = {
      runId: "run1",
      iteration: 0,
      L1: { gaps: [gap], evidenceLedger: [{ gapIds: ["g1"] }, { gapIds: ["g1"] }] },
      L2: { retrievedChunks: [] },
      todos: [{ todoId: "t1", relatedGapId: "g1", status: TodoStatus.OPEN }],
      updateTodo,
      planningTree,
      addTimeline,
    };

    const result = validateIteration(state, { emit });

    expect(result).toEqual({ filledCount: 1, blockedCount: 0, openCount: 0, stillOpenCount: 0 });
    expect(gap.status).toBe(GapStatus.FILLED);
    expect(gap.updatedAt).toBe(new Date("2024-02-02T00:00:00.000Z").toISOString());
    expect(updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.COMPLETED }, null);
    expect(planningTree.updateStatus).toHaveBeenCalledWith("n1", "completed");
    expect(planningTree.recordDecision).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        stage: DecisionStage.GAPS,
        outcome: DecisionOutcome.SUCCESS,
        action: expect.stringContaining("transition to filled"),
      }),
    );
    expect(addTimeline).toHaveBeenCalledWith(expect.objectContaining({ name: "deepsearch.validate", status: "completed" }));

    const eventNames = emit.mock.calls.map((call) => call[0]);
    expect(eventNames).toContain("deepsearch.gap.transitioned");
    expect(eventNames).toContain("deepsearch.todo.status.changed");
  });

  it("blocks gaps after misses and updates todos/planning tree", () => {
    const gap = { gapId: "g2", status: GapStatus.OPEN, missCount: 1, blockedReason: "no_hits" };
    const updateTodo = vi.fn((todoId, updates) => ({ todoId, status: updates.status }));
    const planningTree = {
      getNodesForGap: vi.fn(() => [{ nodeId: "n2" }]),
      updateStatus: vi.fn(),
    };

    const state = {
      runId: "run2",
      iteration: "1",
      L1: { gaps: [gap], evidenceLedger: [] },
      L2: { retrievedChunks: [] },
      todos: [{ todoId: "t2", relatedGapId: "g2", status: TodoStatus.OPEN }],
      updateTodo,
      planningTree,
      addTimeline: vi.fn(),
    };

    const result = validateIteration(state, {
      roundHits: { g2: 0 },
      qualityHitsByGapId: { g2: 0 },
      blockAfterMisses: "2",
    });

    expect(result.blockedCount).toBe(1);
    expect(gap.status).toBe(GapStatus.BLOCKED);
    expect(gap.missCount).toBe(2);
    expect(updateTodo).toHaveBeenCalledWith("t2", { status: TodoStatus.CANCELLED }, null);
    expect(planningTree.updateStatus).toHaveBeenCalledWith("n2", "blocked");
  });

  it("keeps gaps open when quality hits arrive", () => {
    const gap = { gapId: "g3", status: GapStatus.OPEN, missCount: 5 };
    const state = {
      runId: "run3",
      iteration: 2,
      L1: { gaps: [gap], evidenceLedger: [] },
      L2: { retrievedChunks: [] },
      todos: [],
      addTimeline: vi.fn(),
    };

    const result = validateIteration(state, { qualityHitsByGapId: new Map([["g3", 1]]) });

    expect(result.stillOpenCount).toBe(1);
    expect(gap.status).toBe(GapStatus.OPEN);
    expect(gap.missCount).toBe(0);
  });

  it("handles empty state and invalid options", () => {
    const result = validateIteration(null, "bad");
    expect(result).toEqual({ filledCount: 0, blockedCount: 0, openCount: 0, stillOpenCount: 0 });
  });
});

describe("EVENT_SCHEMA_VERSION", () => {
  it("exposes the event schema version", () => {
    expect(EVENT_SCHEMA_VERSION).toBe("deepsearch.event.v1");
  });
});

describe("EventStatus", () => {
  it("exposes frozen status values", () => {
    expect(EventStatus).toMatchObject({
      STARTED: "started",
      PROGRESS: "progress",
      COMPLETED: "completed",
      FAILED: "failed",
      WARNING: "warning",
      INFO: "info",
    });
    expect(Object.isFrozen(EventStatus)).toBe(true);
  });
});

describe("extractJsonCandidate", () => {
  it("extracts JSON from noisy text with thinking tags", () => {
    const text = "<think>noise</think>```json\n{\"a\":1}\n```";
    expect(extractJsonCandidate(text)).toBe("{\"a\":1}");
  });

  it("respects prefer array when both array and object exist", () => {
    const text = "obj:{\"a\":1} arr:[1,2]";
    expect(extractJsonCandidate(text, { prefer: "array" })).toBe("[1,2]");
  });

  it("handles empty and large inputs", () => {
    expect(extractJsonCandidate("")).toBeNull();

    const longText = `${"x".repeat(10000)}{\"ok\":true}`;
    expect(extractJsonCandidate(longText)).toBe("{\"ok\":true}");
  });

  it("returns the trimmed string when no JSON is found", () => {
    expect(extractJsonCandidate(" not json ")).toBe("not json");
  });
});

describe("normalizeBudgetConfig", () => {
  it("returns defaults for invalid inputs", () => {
    const cfg = normalizeBudgetConfig([]);
    expect(cfg.maxTokens).toBe(50000);
    expect(cfg.maxCostUSD).toBe(0.5);
    expect(cfg.warnAt).toBe(0.8);
    expect(cfg.action).toBe("warn");
  });

  it("normalizes values, clamps ranges, and filters dangerous keys", () => {
    const prices = Object.create(null);
    prices["gpt-4o"] = { input: -1, output: 0.2 };
    prices["custom-model"] = { inputUsdPer1K: 0.1, outputUSDPer1K: 0.2 };
    prices["__proto__"] = { input: 1 };

    const cfg = normalizeBudgetConfig({
      maxTokens: "1000",
      maxCostUSD: "2.5",
      warnAt: 1.5,
      action: "stop",
      prices,
    });

    expect(cfg.maxTokens).toBe(1000);
    expect(cfg.maxCostUSD).toBe(2.5);
    expect(cfg.warnAt).toBe(1);
    expect(cfg.action).toBe("stop");
    expect(cfg.prices["gpt-4o"].input).toBe(0);
    expect(cfg.prices["gpt-4o"].output).toBe(0.2);
    expect(cfg.prices["custom-model"]).toMatchObject({ input: 0.1, output: 0.2 });
    expect(Object.prototype.hasOwnProperty.call(cfg.prices, "__proto__")).toBe(false);
  });

  it("accepts MAX_SAFE_INTEGER for limits", () => {
    const cfg = normalizeBudgetConfig({ maxTokens: Number.MAX_SAFE_INTEGER });
    expect(cfg.maxTokens).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("stripThinkingTags", () => {
  it("removes thinking blocks and trims", () => {
    expect(stripThinkingTags("<think>secret</think> answer ")).toBe("answer");
    expect(stripThinkingTags("prefix <Think>hidden</Think> suffix")).toBe("prefix  suffix");
  });

  it("handles long strings", () => {
    const text = `<think>${"x".repeat(8000)}</think>OK`;
    expect(stripThinkingTags(text)).toBe("OK");
  });
});

describe("loadCheckpoint", () => {
  it("throws on invalid input", () => {
    expect(() => loadCheckpoint(null)).toThrow(TypeError);
  });

  it("normalizes L2 flags and preserves deep structures", () => {
    const checkpoint = {
      schemaVersion: "1.0",
      stateSnapshot: {
        L2: {
          awaitUserFeedback: "yes",
          taskImpossible: null,
          reason: 0,
          deep: { level1: { level2: { level3: "x" } } },
        },
        todos: [{ todoId: "t1" }],
        L1: { gaps: [] },
      },
    };

    const result = loadCheckpoint(checkpoint);

    expect(result.schemaVersion).toBe("1.0");
    expect(result.stateSnapshot.L2.awaitUserFeedback).toBe(false);
    expect(result.stateSnapshot.L2.taskImpossible).toBe(false);
    expect(result.stateSnapshot.L2.reason).toBe("0");
    expect(result.stateSnapshot.L2.deep.level1.level2.level3).toBe("x");
    expect(result.stateSnapshot.todos).toEqual([{ todoId: "t1" }]);
  });

  it("migrates legacy checkpoints and fills empty todos", () => {
    const checkpoint = {
      stateSnapshot: {
        L2: {},
        L1: { gaps: [] },
      },
    };

    const result = loadCheckpoint(checkpoint);

    expect(result.schemaVersion).toBe("1.0");
    expect(result.stateSnapshot.todos).toEqual([]);
    expect(result.stateSnapshot.L2.awaitUserFeedback).toBe(false);
    expect(result.stateSnapshot.L2.taskImpossible).toBe(false);
    expect(result.stateSnapshot.L2.reason).toBe("");
  });
});
