import { isPlainObject, safeInt, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { ensureTokenUsage, EVENT_SCHEMA_VERSION, EventStatus, extractJsonCandidate, normalizeBudgetConfig, stripThinkingTags } from "./utils/state-utils.js";
import { Deque } from "../../shared/utils/deque.js";
import { makeStageEmitter, generateNodeId, checkCancelled } from "./stage-utils.js";
import { transitionGap, computeRoundHitsByGapId, validateIteration } from "./state-logic.js";
import { cloneValue, loadCheckpoint } from "./runtime/checkpoint.js";
import { PlanningTree } from "./state/planning-tree.js";
import { TaskState } from "./state/task-state.js";
import { IterationState } from "./state/iteration-state.js";
import { ReportState } from "./state/report-state.js";
import { fromSnapshot, toJSON as stateToJSON } from "./state/serializer.js";
import { memoryMethods } from "./state/memory-methods.js";
import { stateMethods } from "./state/state-methods.js";
import { checkpointMethods } from "./state/checkpoint-methods.js";
import { deserialize, serializationMethods } from "./state/serialization-methods.js";
import { L0_REPLACE_TODOS } from "../../runtime/memory/action-types.js";

export { makeStageEmitter, generateNodeId, checkCancelled };
export { transitionGap, computeRoundHitsByGapId, validateIteration };
export { EVENT_SCHEMA_VERSION, EventStatus, extractJsonCandidate, normalizeBudgetConfig, stripThinkingTags };
export { loadCheckpoint };

const STATE_SCHEMA_VERSION = "0.1";
const DEFAULT_MAX_ITERATIONS = 5;

export class DeepSearchState {
  constructor({
    runId,
    taskGoal,
    userConfig,
    L0,
    L1,
    L2,
    todos,
    timeline,
    createdAt,
    schemaVersion,
    iteration,
    maxIterations,
    checkpoints,
    planningTree,
    trajectoryId,
    trajectoryConfig,
    writeBacktrackCount,
    writeSnapshots,
    sharedContext,
    subAgentIndex,
    memoryStore,
    stateEngine,
  } = {}) {
    this.schemaVersion = toNonEmptyString(schemaVersion) || STATE_SCHEMA_VERSION;
    this.runId = toNonEmptyString(runId) || "run_unknown";
    this.createdAt = toNonEmptyString(createdAt) || new Date().toISOString();
    this.sharedContext = sharedContext || null;
    this.subAgentIndex = Number.isFinite(subAgentIndex) ? subAgentIndex : null;
    this._memoryStore = memoryStore || null;
    this._stateEngine = stateEngine || null;
    this._stateEngineUnsubscribe = null;
    this._localTaskGoal = toNonEmptyString(taskGoal) || "";
    this._todos = Array.isArray(todos) ? todos : [];

    this.task = new TaskState(this);
    this.iterationState = new IterationState(this);
    this.reportState = new ReportState(this);

    this.userConfig = isPlainObject(userConfig) ? userConfig : {};
    this.trajectoryId = toNonEmptyString(trajectoryId);
    this.trajectoryConfig = isPlainObject(trajectoryConfig) ? trajectoryConfig : isPlainObject(this.userConfig?.trajectory) ? this.userConfig.trajectory : undefined;

    if (stateEngine) this.bindStateEngine(stateEngine);

    this.planningTree =
      planningTree instanceof PlanningTree
        ? planningTree
        : isPlainObject(planningTree)
          ? PlanningTree.fromJSON(planningTree)
          : new PlanningTree({ rootGoal: this.taskGoal, runId: this.runId });
    if (!this.planningTree) this.planningTree = new PlanningTree({ rootGoal: this.taskGoal || "", runId: this.runId });

    const it = safeInt(iteration);
    this.iteration = it !== null && it >= 0 ? it : 0;
    const maxIt = safeInt(maxIterations);
    this.maxIterations = maxIt !== null && maxIt >= 1 ? maxIt : DEFAULT_MAX_ITERATIONS;
    this.checkpoints = Array.isArray(checkpoints) ? checkpoints : [];

    this.L0 = isPlainObject(L0) ? L0 : { sources: [], sourceIndex: null };
    this.L1 = isPlainObject(L1)
      ? L1
      : {
        scanSummary: null,
        deepDivePlan: null,
        gaps: [],
        retrieved: [],
        claims: [],
        evidenceLedger: [],
        dataTables: [],
        slideIntents: [],
        outlineCandidates: [],
        report: null,
        conflicts: [],
        openQuestions: [],
        condensedMemory: null,
      };
    this.L2 = isPlainObject(L2)
      ? {
        ...L2,
        retrievedChunks: Array.isArray(L2?.retrievedChunks) ? L2.retrievedChunks : [],
        scratchpad: isPlainObject(L2?.scratchpad) ? L2.scratchpad : {},
        thoughtHistory: Array.isArray(L2?.thoughtHistory) ? L2.thoughtHistory : [],
        logs: Array.isArray(L2?.logs) ? L2.logs : [],
        tokenUsage: ensureTokenUsage(L2?.tokenUsage),
        awaitUserFeedback: typeof L2?.awaitUserFeedback === "boolean" ? L2.awaitUserFeedback : false,
        taskImpossible: typeof L2?.taskImpossible === "boolean" ? L2.taskImpossible : false,
        reason: toNonEmptyString(L2?.reason) || "",
      }
      : {
        retrievedChunks: [],
        scratchpad: {},
        thoughtHistory: [],
        logs: [],
        tokenUsage: { input: 0, output: 0, total: 0, estimatedCostUSD: 0 },
        awaitUserFeedback: false,
        taskImpossible: false,
        reason: "",
      };
    this.timeline = new Deque(Array.isArray(timeline) ? timeline : []);
    this.writeBacktrackCount = Math.max(0, safeInt(writeBacktrackCount) ?? 0);
    this.writeSnapshots = Array.isArray(writeSnapshots) ? writeSnapshots : [];
  }

  get taskGoal() {
    return this.task.taskGoal;
  }
  set taskGoal(value) {
    this.task.taskGoal = value;
  }

  get todos() {
    return this._todos;
  }
  set todos(value) {
    const next = Array.isArray(value) ? value : [];
    const target = Array.isArray(this._todos) ? this._todos : [];
    if (!Array.isArray(this._todos)) this._todos = target;

    if (next !== target) {
      target.length = 0;
      target.push(...next);
    }

    const engine = this._stateEngine;
    if (engine && typeof engine.dispatchSync === "function") {
      try {
        engine.dispatchSync({ type: L0_REPLACE_TODOS, payload: { todos: cloneValue(target) } });
        this._syncFromStateEngine();
      } catch {
        // fall back to local-only todos
      }
    }
  }

  bindStateEngine(stateEngine) {
    if (this._stateEngineUnsubscribe) {
      try {
        this._stateEngineUnsubscribe();
      } catch {
        // ignore
      }
      this._stateEngineUnsubscribe = null;
    }

    this._stateEngine = stateEngine || null;
    const engine = this._stateEngine;
    if (!engine) return;

    // Seed engine from current effective values (only when engine is empty).
    try {
      const snap = typeof engine._getStateRef === "function" ? engine._getStateRef() : engine.getState?.();
      const engineGoal = toNonEmptyString(snap?.L0?.taskGoal);
      if (!engineGoal) {
        const seedGoal = toNonEmptyString(this.taskGoal) || "";
        if (seedGoal) this.taskGoal = seedGoal;
      }

      const engineTodos = Array.isArray(snap?.L0?.todos) ? snap.L0.todos : [];
      const seedTodos = Array.isArray(this.todos) ? this.todos : [];
      if (engineTodos.length === 0 && seedTodos.length) {
        engine.dispatchSync({ type: L0_REPLACE_TODOS, payload: { todos: cloneValue(seedTodos) } });
      }
    } catch {
      // ignore seeding errors
    }

    this._syncFromStateEngine();

    if (typeof engine.subscribe === "function") {
      this._stateEngineUnsubscribe = engine.subscribe("L0", (_action, _prevL0, nextL0) => {
        this._syncFromStateEngine(nextL0);
      });
    }
  }

  _syncFromStateEngine(nextL0 = null) {
    const engine = this._stateEngine;
    if (!engine) return;

    const l0 = nextL0 || (() => {
      try {
        const snap = typeof engine._getStateRef === "function" ? engine._getStateRef() : engine.getState?.();
        return snap?.L0 || null;
      } catch {
        return null;
      }
    })();
    if (!l0) return;

    const goal = toNonEmptyString(l0.taskGoal) || "";
    if (goal) this._localTaskGoal = goal;

    const nextTodos = Array.isArray(l0.todos) ? l0.todos : [];
    const clonedTodos = cloneValue(nextTodos);
    const target = Array.isArray(this._todos) ? this._todos : [];
    if (!Array.isArray(this._todos)) this._todos = target;
    target.length = 0;
    target.push(...(Array.isArray(clonedTodos) ? clonedTodos : []));

    // Keep MemoryStore best-effort in sync when attached.
    const memoryStore = this._memoryStore;
    if (memoryStore) {
      try {
        if (typeof memoryStore.setTaskGoal === "function") memoryStore.setTaskGoal(goal);
        else if (memoryStore.L0 && typeof memoryStore.L0 === "object") memoryStore.L0.taskGoal = goal;
      } catch { /* intentional */ }

      try {
        if (typeof memoryStore.replaceTodos === "function") memoryStore.replaceTodos(cloneValue(target));
        else if (memoryStore?.L0 && typeof memoryStore.L0 === "object") memoryStore.L0.todos = target;
      } catch { /* intentional */ }
    }
  }
  get awaitUserFeedback() {
    return this.task.awaitUserFeedback;
  }
  set awaitUserFeedback(value) {
    this.task.awaitUserFeedback = value;
  }
  get taskImpossible() {
    return this.task.taskImpossible;
  }
  set taskImpossible(value) {
    this.task.taskImpossible = value;
  }

  get phase() {
    return this.iterationState.phase;
  }
  set phase(value) {
    this.iterationState.phase = value;
  }
  get gaps() {
    return this.iterationState.gaps;
  }
  set gaps(value) {
    this.iterationState.gaps = value;
  }
  get chunks() {
    return this.iterationState.chunks;
  }
  set chunks(value) {
    this.iterationState.chunks = value;
  }

  get report() {
    return this.reportState.report;
  }
  set report(value) {
    this.reportState.report = value;
  }
  get reportDraft() {
    return this.reportState.reportDraft;
  }
  set reportDraft(value) {
    this.reportState.reportDraft = value;
  }
  get outline() {
    return this.reportState.outline;
  }
  set outline(value) {
    this.reportState.outline = value;
  }

  toJSON({ includeCheckpoints = true } = {}) {
    return stateToJSON(this, { includeCheckpoints });
  }

  static fromJSON(json) {
    if (!isPlainObject(json)) throw new TypeError("DeepSearchState.fromJSON(json): json must be an object");
    const snapshot = fromSnapshot(json);
    const state = new DeepSearchState(snapshot);
    if (isPlainObject(json.planningTree)) state.planningTree = PlanningTree.fromJSON(json.planningTree);
    return state;
  }
}

Object.assign(DeepSearchState.prototype, memoryMethods, stateMethods, checkpointMethods, serializationMethods);
DeepSearchState.deserialize = deserialize;
