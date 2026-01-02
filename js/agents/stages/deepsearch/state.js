import { isPlainObject, safeInt, safeNumber, toNonEmptyString, sanitizeForJson } from "../../shared/utils/value-utils.js";
import { EVENT_SCHEMA_VERSION, EventStatus, ensureTokenUsage, extractJsonCandidate, normalizeBudgetConfig, stripThinkingTags } from "./utils/state-utils.js";
import { normalizeTokenUsage } from "./model/usage.js";
import { CheckpointMode } from "./constants.js";
import { makeStageEmitter, generateNodeId, checkCancelled } from "./stage-utils.js";
import {
  transitionGap,
  computeRoundHitsByGapId,
  validateIteration,
  addTodo as addTodoLogic,
  setAwaitUserFeedback as setAwaitUserFeedbackLogic,
  setTaskImpossible as setTaskImpossibleLogic,
  addTimeline as addTimelineLogic,
  saveWriteSnapshot as saveWriteSnapshotLogic,
  reopenGaps as reopenGapsLogic,
  addNewGaps as addNewGapsLogic,
} from "./state-logic.js";

// Re-export stage utils for backward compatibility
export { makeStageEmitter, generateNodeId, checkCancelled };

// ─────────────────────────────────────────────────────────────────────────────
// Gap / Todo business rules (decoupled)
// ─────────────────────────────────────────────────────────────────────────────
export { transitionGap, computeRoundHitsByGapId, validateIteration };

// ─────────────────────────────────────────────────────────────────────────────
// PlanningTree (最小兼容实现)
// ─────────────────────────────────────────────────────────────────────────────
class PlanningTree {
  constructor(options = {}) {
    this.rootGoal = options.rootGoal || "";
    this.runId = options.runId || "";
    this.nodes = new Map();
  }
  expandFromGap() { }
  expandFromTodo() { }
  serialize() {
    return { rootGoal: this.rootGoal, runId: this.runId };
  }
  toJSON() {
    return this.serialize();
  }
  static fromJSON(json) {
    if (!json || typeof json !== "object") return new PlanningTree();
    return new PlanningTree({ rootGoal: json.rootGoal || "", runId: json.runId || "" });
  }
}

import {
  buildLiteSnapshot,
  buildMinimalSnapshot,
  CHECKPOINT_SCHEMA_VERSION,
  cloneValue,
  getCheckpointStrategyFromState,
  loadCheckpoint,
  normalizeCheckpointStrategy,
} from "./runtime/checkpoint.js";

export { EVENT_SCHEMA_VERSION, EventStatus, extractJsonCandidate, normalizeBudgetConfig, stripThinkingTags };
export { loadCheckpoint };

const STATE_SCHEMA_VERSION = "0.1";
const DEFAULT_MAX_ITERATIONS = 5;

function buildCheckpointReferences(checkpoints) {
  const rows = Array.isArray(checkpoints) ? checkpoints : [];
  return rows.map((checkpoint) => {
    const raw = checkpoint && typeof checkpoint === "object" ? checkpoint : {};
    const { schemaVersion, checkpointId, iteration, timestamp, strategy, metrics } = raw;
    return { schemaVersion, checkpointId, iteration, timestamp, strategy, metrics };
  });
}

import { Deque } from "../../shared/utils/deque.js";

function buildStateSnapshot(state, { includeCheckpoints = true, includeCheckpointSnapshots = true } = {}) {
  // 浅拷贝基础字段，并在序列化时按需处理复杂对象
  return {
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    createdAt: state.createdAt,
    taskGoal: state.taskGoal,
    userConfig: state.userConfig,
    planningTree: state.planningTree?.serialize ? state.planningTree.serialize() : null,
    ...(toNonEmptyString(state.trajectoryId) ? { trajectoryId: state.trajectoryId } : {}),
    ...(isPlainObject(state.trajectoryConfig) ? { trajectoryConfig: state.trajectoryConfig } : {}),
    iteration: state.iteration,
    maxIterations: state.maxIterations,
    ...(includeCheckpoints
      ? { checkpoints: includeCheckpointSnapshots ? state.checkpoints : buildCheckpointReferences(state.checkpoints) }
      : {}),
    writeBacktrackCount: state.writeBacktrackCount,
    writeSnapshots: state.writeSnapshots,
    L0: state.L0,
    L1: state.L1,
    L2: state.L2,
    todos: state.todos,
    timeline: state.timeline instanceof Deque ? state.timeline.toArray() : state.timeline,
  };
}

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
    memoryStore,  // Memory 2.0: 可选的 MemoryStore 引用
  } = {}) {
    this.schemaVersion = toNonEmptyString(schemaVersion) || STATE_SCHEMA_VERSION;
    this.runId = toNonEmptyString(runId) || "run_unknown";
    this.createdAt = toNonEmptyString(createdAt) || new Date().toISOString();
    this.sharedContext = sharedContext || null;
    this.subAgentIndex = Number.isFinite(subAgentIndex) ? subAgentIndex : null;
    this._memoryStore = memoryStore || null;  // Memory 2.0: 代理层

    this.taskGoal = toNonEmptyString(taskGoal) || "";
    this.userConfig = isPlainObject(userConfig) ? userConfig : {};
    this.trajectoryId = toNonEmptyString(trajectoryId);
    this.trajectoryConfig = isPlainObject(trajectoryConfig) ? trajectoryConfig : isPlainObject(this.userConfig?.trajectory) ? this.userConfig.trajectory : undefined;
    this.planningTree =
      planningTree instanceof PlanningTree
        ? planningTree
        : isPlainObject(planningTree)
          ? PlanningTree.fromJSON(planningTree)
          : new PlanningTree({ rootGoal: this.taskGoal, runId: this.runId });
    if (!this.planningTree) {
      this.planningTree = new PlanningTree({ rootGoal: this.taskGoal || "", runId: this.runId });
    }

    const it = safeInt(iteration);
    this.iteration = it !== null && it >= 0 ? it : 0;
    const maxIt = safeInt(maxIterations);
    this.maxIterations = maxIt !== null && maxIt >= 1 ? maxIt : DEFAULT_MAX_ITERATIONS;
    this.checkpoints = Array.isArray(checkpoints) ? checkpoints : [];

    this.L0 = isPlainObject(L0)
      ? L0
      : {
        sources: [],
        sourceIndex: null,
      };

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

    this.todos = Array.isArray(todos) ? todos : [];
    this.timeline = new Deque(Array.isArray(timeline) ? timeline : []);

    const wbc = safeInt(writeBacktrackCount);
    this.writeBacktrackCount = wbc !== null && wbc >= 0 ? wbc : 0;
    this.writeSnapshots = Array.isArray(writeSnapshots) ? writeSnapshots : [];
  }

  _syncToShared(type, id, summary) {
    // Memory 2.0: 优先使用 MemoryStore 的 syncDiscovery
    if (this._memoryStore?.syncDiscovery) {
      this._memoryStore.syncDiscovery(id, {
        type,
        ...summary,
        by: this.subAgentIndex,
      });
    }
    // 保持 SharedContext 兼容
    if (!this.sharedContext || typeof this.sharedContext.upsertSignal !== "function") return;
    this.sharedContext.upsertSignal({
      type,
      id,
      ...summary,
      by: this.subAgentIndex,
      ts: Date.now(),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory 2.0: Scratchpad 代理
  // ─────────────────────────────────────────────────────────────────────────────

  getScratchpad(key) {
    // 优先从 MemoryStore 读取
    if (this._memoryStore?.getScratchpad) {
      return this._memoryStore.getScratchpad(key);
    }
    // 回退到本地 L2
    if (key === undefined) return { ...this.L2.scratchpad };
    return this.L2.scratchpad?.[key];
  }

  setScratchpad(key, value) {
    // 同步到 MemoryStore
    if (this._memoryStore?.setScratchpad) {
      this._memoryStore.setScratchpad(key, value);
    }
    // 保持本地副本
    if (!isPlainObject(this.L2)) this.L2 = { scratchpad: {} };
    if (!isPlainObject(this.L2.scratchpad)) this.L2.scratchpad = {};
    if (isPlainObject(key) && value === undefined) {
      Object.assign(this.L2.scratchpad, key);
    } else {
      this.L2.scratchpad[key] = value;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory 2.0: MemoryStore 绑定
  // ─────────────────────────────────────────────────────────────────────────────

  bindMemoryStore(memoryStore) {
    this._memoryStore = memoryStore || null;
    if (!memoryStore) return;

    // Sync key fields so MemoryStore can act as the runtime SSOT where possible.
    try {
      if (typeof memoryStore.setTaskGoal === "function") {
        memoryStore.setTaskGoal(this.taskGoal || "");
      } else if (memoryStore.L0 && typeof memoryStore.L0 === "object") {
        memoryStore.L0.taskGoal = this.taskGoal || "";
      }
    } catch {
      // ignore taskGoal sync failures
    }

    // Share Todos through a dynamic accessor so we don't keep a stale reference
    // when MemoryStore restores/replaces L0.todos (SSOT consistency).
    const stateTodos = Array.isArray(this.todos) ? this.todos : [];
    const memTodos = Array.isArray(memoryStore?.L0?.todos) ? memoryStore.L0.todos : null;

    const normalizeTodoInPlace = (todo) => {
      if (!todo || typeof todo !== "object") return;
      if (todo.todoId && !todo.id) todo.id = todo.todoId;
      if (todo.id && !todo.todoId) todo.todoId = todo.id;
      if (todo.text && !todo.content) todo.content = todo.text;
      if (todo.content && !todo.text) todo.text = todo.content;
    };

    let canonicalTodos = stateTodos;
    if (canonicalTodos.length === 0 && memTodos && memTodos.length) canonicalTodos = memTodos;

    if (memoryStore?.L0 && typeof memoryStore.L0 === "object") {
      if (!Array.isArray(memoryStore.L0.todos) || memoryStore.L0.todos !== canonicalTodos) {
        memoryStore.L0.todos = canonicalTodos;
      }
    }

    const localTodos = canonicalTodos;
    try {
      Object.defineProperty(this, "todos", {
        configurable: true,
        enumerable: true,
        get: () => (Array.isArray(this._memoryStore?.L0?.todos) ? this._memoryStore.L0.todos : localTodos),
        set: (value) => {
          const next = Array.isArray(value) ? value : [];
          if (this._memoryStore?.L0 && typeof this._memoryStore.L0 === "object") {
            this._memoryStore.L0.todos = next;
          }
          if (localTodos !== next) {
            localTodos.length = 0;
            localTodos.push(...next);
          }
        },
      });
    } catch {
      // Fallback: keep a direct reference (best-effort).
      this.todos = Array.isArray(memoryStore?.L0?.todos) ? memoryStore.L0.todos : canonicalTodos;
    }

    for (const todo of Array.isArray(this.todos) ? this.todos : []) normalizeTodoInPlace(todo);

    // Sync current state flags/scratchpad to MemoryStore.
    if (this.L2?.awaitUserFeedback) memoryStore.awaitUserFeedback = true;
    if (this.L2?.taskImpossible) memoryStore.taskImpossible = true;
    if (isPlainObject(this.L2?.scratchpad) && typeof memoryStore.setScratchpad === "function") {
      memoryStore.setScratchpad(this.L2.scratchpad);
    }
  }

  addTokenUsage(usage) {
    const delta = normalizeTokenUsage(usage);
    if (!delta) return this?.L2?.tokenUsage || { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };
    const estimatedCostUSDDeltaRaw = safeNumber(usage?.estimatedCostUSD ?? usage?.costUSD);
    const estimatedCostUSDDelta = estimatedCostUSDDeltaRaw !== null ? Math.max(0, estimatedCostUSDDeltaRaw) : null;

    if (!isPlainObject(this.L2)) this.L2 = {};
    if (typeof this.L2.awaitUserFeedback !== "boolean") this.L2.awaitUserFeedback = false;
    if (typeof this.L2.taskImpossible !== "boolean") this.L2.taskImpossible = false;
    if (!toNonEmptyString(this.L2.reason)) this.L2.reason = "";
    if (!isPlainObject(this.L2.tokenUsage)) this.L2.tokenUsage = { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };

    const cur = this.L2.tokenUsage;
    const curInput = safeInt(cur.input) ?? 0;
    const curOutput = safeInt(cur.output) ?? 0;
    const curTotal = safeInt(cur.total) ?? 0;
    const curCost = safeNumber(cur.estimatedCostUSD) ?? 0;

    cur.input = curInput + delta.input;
    cur.output = curOutput + delta.output;
    cur.total = curTotal + delta.total;
    cur.estimatedCostUSD = estimatedCostUSDDelta !== null ? curCost + estimatedCostUSDDelta : curCost;
    return cur;
  }

  getBudgetConfig() {
    return normalizeBudgetConfig(this?.userConfig?.budget);
  }

  addTodo(params = {}) {
    return addTodoLogic(this, params);
  }

  setAwaitUserFeedback(value, reason) {
    return setAwaitUserFeedbackLogic(this, value, reason);
  }

  setTaskImpossible(reason) {
    return setTaskImpossibleLogic(this, reason);
  }

  addTimeline({ name, status = "info", payload } = {}) {
    return addTimelineLogic(this, { name, status, payload });
  }

  saveWriteSnapshot({ timestamp } = {}) {
    return saveWriteSnapshotLogic(this, { timestamp });
  }

  reopenGaps(gapIds, { reason, timestamp } = {}, emit = null) {
    return reopenGapsLogic(this, gapIds, { reason, timestamp }, emit);
  }

  addNewGaps(newGaps, { timestamp } = {}, emit = null) {
    return addNewGapsLogic(this, newGaps, { timestamp }, emit);
  }

  saveCheckpoint({ checkpointId, timestamp, metrics, strategy } = {}) {
    const id = toNonEmptyString(checkpointId) || `cp_${this.checkpoints.length + 1}`;
    const ts = toNonEmptyString(timestamp) || new Date().toISOString();

    const checkpointStrategy = getCheckpointStrategyFromState(this, strategy);
    // 优化：移除冗余的 fromJSON 包装。cloneValue 已足够创建独立副本。
    const snapshot =
      checkpointStrategy === CheckpointMode.FULL
        ? cloneValue(buildStateSnapshot(this, { includeCheckpoints: false }))
        : checkpointStrategy === CheckpointMode.MINIMAL
          ? buildMinimalSnapshot(this)
          : buildLiteSnapshot(this);

    const gaps = Array.isArray(this?.L1?.gaps) ? this.L1.gaps : [];
    const openGapCount = gaps.filter((g) => (g?.status ? String(g.status) : "open") === "open").length;
    const claims = Array.isArray(this?.L1?.claims) ? this.L1.claims : [];
    const evidenceLedger = Array.isArray(this?.L1?.evidenceLedger) ? this.L1.evidenceLedger : [];
    const retrievedChunks = Array.isArray(this?.L2?.retrievedChunks) ? this.L2.retrievedChunks : [];

    const m = isPlainObject(metrics)
      ? metrics
      : {
        gapCount: openGapCount,
        claimCount: claims.length,
        evidenceCount: evidenceLedger.length,
        retrievedCount: retrievedChunks.length,
      };

    const checkpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      checkpointId: String(id),
      iteration: this.iteration,
      timestamp: String(ts),
      strategy: checkpointStrategy,
      stateSnapshot: snapshot,
      metrics: {
        gapCount: safeInt(m.gapCount) ?? openGapCount,
        claimCount: safeInt(m.claimCount) ?? claims.length,
        evidenceCount: safeInt(m.evidenceCount) ?? evidenceLedger.length,
        retrievedCount: safeInt(m.retrievedCount) ?? retrievedChunks.length,
      },
    };

    this.checkpoints.push(checkpoint);

    const max = Math.max(0, safeInt(this?.userConfig?.memory?.maxCheckpoints) ?? 30);
    while (this.checkpoints.length > max) this.checkpoints.shift();
    return checkpoint;
  }

  restoreCheckpoint(checkpointId) {
    const id = toNonEmptyString(checkpointId);
    if (!id) throw new TypeError("DeepSearchState.restoreCheckpoint(checkpointId): checkpointId is required");

    const idx = this.checkpoints.findIndex((c) => toNonEmptyString(c?.checkpointId) === id);
    const existing = idx >= 0 ? this.checkpoints[idx] : null;
    const cp = existing ? loadCheckpoint(existing) : null;
    if (existing && cp !== existing) this.checkpoints[idx] = cp;
    if (!cp) throw new Error(`Checkpoint not found: ${String(id)}`);
    if (!("stateSnapshot" in cp)) throw new Error(`Invalid checkpoint: missing stateSnapshot (${String(id)})`);

    const explicitStrategy = toNonEmptyString(cp?.strategy);
    const snapshotStrategy = toNonEmptyString(cp?.stateSnapshot?.snapshotStrategy);
    const checkpointStrategy = explicitStrategy
      ? normalizeCheckpointStrategy(explicitStrategy)
      : cp?.stateSnapshot instanceof DeepSearchState
        ? CheckpointMode.FULL
        : snapshotStrategy === CheckpointMode.MINIMAL
          ? CheckpointMode.MINIMAL
          : snapshotStrategy === CheckpointMode.LITE
            ? CheckpointMode.LITE
            : isPlainObject(cp?.stateSnapshot?.L2) && Array.isArray(cp.stateSnapshot.L2.retrievedChunkIds) && !Array.isArray(cp.stateSnapshot.L2.retrievedChunks)
              ? CheckpointMode.LITE
              : CheckpointMode.FULL;
    const preservedL0 = this.L0;
    const preservedL1 = this.L1;
    const preservedL2 = this.L2;
    const snapshot = cp.stateSnapshot instanceof DeepSearchState ? cp.stateSnapshot : DeepSearchState.fromJSON(cp.stateSnapshot);
    const preservedCheckpoints = this.checkpoints;

    const restored =
      checkpointStrategy === CheckpointMode.FULL && typeof snapshot?.toSnapshot === "function"
        ? snapshot.toSnapshot({ includeCheckpoints: false })
        : snapshot.toJSON({ includeCheckpoints: false });
    this.schemaVersion = restored.schemaVersion;
    this.runId = restored.runId;
    this.createdAt = restored.createdAt;
    this.taskGoal = restored.taskGoal;
    this.userConfig = restored.userConfig;
    this.iteration = safeInt(restored.iteration) ?? 0;
    this.maxIterations = safeInt(restored.maxIterations) ?? DEFAULT_MAX_ITERATIONS;
    const preserveCore = checkpointStrategy === CheckpointMode.LITE || checkpointStrategy === CheckpointMode.MINIMAL;
    this.L0 = preserveCore ? preservedL0 : restored.L0;
    this.L1 = preserveCore ? preservedL1 : restored.L1;
    this.L2 = restored.L2;
    this.planningTree =
      restored.planningTree instanceof PlanningTree
        ? restored.planningTree
        : isPlainObject(restored.planningTree)
          ? PlanningTree.fromJSON(restored.planningTree)
          : new PlanningTree({ rootGoal: this.taskGoal, runId: this.runId });
    this.todos = restored.todos;
    this.timeline = restored.timeline;
    this.checkpoints = preservedCheckpoints;

    if (checkpointStrategy === CheckpointMode.LITE) {
      const restoredIds = Array.isArray(restored?.L2?.retrievedChunkIds) ? restored.L2.retrievedChunkIds.map(String).filter(Boolean) : [];
      const tokenUsage = ensureTokenUsage(restored?.L2?.tokenUsage);
      this.L2 = {
        ...this.L2,
        retrievedChunkIds: restoredIds,
        tokenUsage,
        retrievedChunks: [],
        scratchpad: {},
        logs: [],
        incomplete: true,
        restoredFromLiteCheckpoint: true,
      };
    }
    if (checkpointStrategy === CheckpointMode.MINIMAL) {
      const tokenUsage = ensureTokenUsage(restored?.L2?.tokenUsage);
      const awaitUserFeedback =
        typeof restored?.L2?.awaitUserFeedback === "boolean"
          ? restored.L2.awaitUserFeedback
          : typeof preservedL2?.awaitUserFeedback === "boolean"
            ? preservedL2.awaitUserFeedback
            : false;
      const taskImpossible =
        typeof restored?.L2?.taskImpossible === "boolean"
          ? restored.L2.taskImpossible
          : typeof preservedL2?.taskImpossible === "boolean"
            ? preservedL2.taskImpossible
            : false;
      const reason = toNonEmptyString(restored?.L2?.reason) || toNonEmptyString(preservedL2?.reason) || "";
      this.L2 = {
        ...preservedL2,
        retrievedChunkIds: [],
        retrievedChunks: [],
        scratchpad: {},
        logs: [],
        tokenUsage,
        awaitUserFeedback,
        taskImpossible,
        reason,
        incomplete: true,
        restoredFromMinimalCheckpoint: true,
      };
    }

    this.addTimeline({ name: "deepsearch.checkpoint.restored", status: "info", payload: { checkpointId: id, iteration: this.iteration } });
    return cp;
  }

  toJSON({ includeCheckpoints = true } = {}) {
    return sanitizeForJson(buildStateSnapshot(this, { includeCheckpoints, includeCheckpointSnapshots: false }));
  }

  toSnapshot({ includeCheckpoints = true } = {}) {
    return cloneValue(buildStateSnapshot(this, { includeCheckpoints, includeCheckpointSnapshots: true }));
  }

  serialize({ pretty = false } = {}) {
    return JSON.stringify(this.toJSON(), null, pretty ? 2 : 0);
  }

  clone({ includeCheckpoints = true } = {}) {
    const snapshotObj = this.toSnapshot({ includeCheckpoints });
    return DeepSearchState.fromJSON(snapshotObj);
  }

  static fromJSON(json) {
    if (!isPlainObject(json)) throw new TypeError("DeepSearchState.fromJSON(json): json must be an object");
    const state = new DeepSearchState(json);
    if (isPlainObject(json.planningTree)) state.planningTree = PlanningTree.fromJSON(json.planningTree);
    return state;
  }

  static deserialize(text) {
    const parsed = JSON.parse(String(text || ""));
    return DeepSearchState.fromJSON(parsed);
  }
}
