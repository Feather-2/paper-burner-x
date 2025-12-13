import { PlanningTree } from "./planning-tree.js";

const STATE_SCHEMA_VERSION = "0.1";
const DEFAULT_MAX_ITERATIONS = 5;

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function deepCloneJsonSafe(v) {
  return JSON.parse(JSON.stringify(v));
}

export function extractJsonCandidate(text) {
  const s = String(text || "").trim();
  if (!s) return null;

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return s.slice(firstBrace, lastBrace + 1);

  const firstBracket = s.indexOf("[");
  const lastBracket = s.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) return s.slice(firstBracket, lastBracket + 1);

  return s;
}

export function makeStageEmitter(stageApi, actor = "deepsearch") {
  const emitFn = stageApi?.emit || stageApi?.eventBus?.emit;
  if (typeof emitFn !== "function") return null;
  return (name, payload, { status = "completed" } = {}) => emitFn.call(stageApi?.eventBus || null, name, { actor, status, payload });
}

export function checkCancelled(stageApi) {
  if (typeof stageApi?.checkCancelled === "function") stageApi.checkCancelled();
  if (stageApi?.signal?.aborted) {
    const reason = stageApi.signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
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
  } = {}) {
    this.schemaVersion = toNonEmptyString(schemaVersion) || STATE_SCHEMA_VERSION;
    this.runId = toNonEmptyString(runId) || "run_unknown";
    this.createdAt = toNonEmptyString(createdAt) || new Date().toISOString();

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
          conflicts: [],
          openQuestions: [],
          condensedMemory: null,
        };

    this.L2 = isPlainObject(L2)
      ? L2
      : {
          retrievedChunks: [],
          scratchpad: {},
          logs: [],
        };

    this.todos = Array.isArray(todos) ? todos : [];
    this.timeline = Array.isArray(timeline) ? timeline : [];
  }

  addTodo({ todoId, text, status = "open", relatedGapId } = {}) {
    const id = toNonEmptyString(todoId) || `todo_${this.todos.length + 1}`;
    const t = toNonEmptyString(text) || "";
    const st = toNonEmptyString(status) || "open";
    const row = { todoId: id, text: t, status: st, ...(toNonEmptyString(relatedGapId) ? { relatedGapId: String(relatedGapId) } : {}) };
    this.todos.push(row);
    return row;
  }

  addTimeline({ name, status = "info", payload } = {}) {
    const n = toNonEmptyString(name) || "deepsearch.event";
    const st = toNonEmptyString(status) || "info";
    const row = { ts: new Date().toISOString(), name: n, status: st, ...(payload !== undefined ? { payload } : {}) };
    this.timeline.push(row);
    return row;
  }

  saveCheckpoint({ checkpointId, timestamp, metrics } = {}) {
    const id = toNonEmptyString(checkpointId) || `cp_${this.checkpoints.length + 1}`;
    const ts = toNonEmptyString(timestamp) || new Date().toISOString();

    const snapshotObj = this.toJSON({ includeCheckpoints: false });
    const snapshot = DeepSearchState.fromJSON(deepCloneJsonSafe(snapshotObj));

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
      checkpointId: String(id),
      iteration: this.iteration,
      timestamp: String(ts),
      stateSnapshot: snapshot,
      metrics: {
        gapCount: safeInt(m.gapCount) ?? openGapCount,
        claimCount: safeInt(m.claimCount) ?? claims.length,
        evidenceCount: safeInt(m.evidenceCount) ?? evidenceLedger.length,
        retrievedCount: safeInt(m.retrievedCount) ?? retrievedChunks.length,
      },
    };

    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  restoreCheckpoint(checkpointId) {
    const id = toNonEmptyString(checkpointId);
    if (!id) throw new TypeError("DeepSearchState.restoreCheckpoint(checkpointId): checkpointId is required");

    const cp = this.checkpoints.find((c) => toNonEmptyString(c?.checkpointId) === id);
    if (!cp) throw new Error(`Checkpoint not found: ${String(id)}`);

    const snapshot = cp.stateSnapshot instanceof DeepSearchState ? cp.stateSnapshot : DeepSearchState.fromJSON(cp.stateSnapshot);
    const preservedCheckpoints = this.checkpoints;

    const restored = snapshot.toJSON({ includeCheckpoints: false });
    this.schemaVersion = restored.schemaVersion;
    this.runId = restored.runId;
    this.createdAt = restored.createdAt;
    this.taskGoal = restored.taskGoal;
    this.userConfig = restored.userConfig;
    this.iteration = safeInt(restored.iteration) ?? 0;
    this.maxIterations = safeInt(restored.maxIterations) ?? DEFAULT_MAX_ITERATIONS;
    this.L0 = restored.L0;
    this.L1 = restored.L1;
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

    this.addTimeline({ name: "deepsearch.checkpoint.restored", status: "info", payload: { checkpointId: id, iteration: this.iteration } });
    return cp;
  }

  toJSON({ includeCheckpoints = true } = {}) {
    return {
      schemaVersion: this.schemaVersion,
      runId: this.runId,
      createdAt: this.createdAt,
      taskGoal: this.taskGoal,
      userConfig: this.userConfig,
      planningTree: this.planningTree?.serialize ? this.planningTree.serialize() : null,
      ...(toNonEmptyString(this.trajectoryId) ? { trajectoryId: this.trajectoryId } : {}),
      ...(isPlainObject(this.trajectoryConfig) ? { trajectoryConfig: this.trajectoryConfig } : {}),
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      ...(includeCheckpoints ? { checkpoints: this.checkpoints } : {}),
      L0: this.L0,
      L1: this.L1,
      L2: this.L2,
      todos: this.todos,
      timeline: this.timeline,
    };
  }

  serialize({ pretty = false } = {}) {
    return JSON.stringify(this.toJSON(), null, pretty ? 2 : 0);
  }

  clone({ includeCheckpoints = true } = {}) {
    const snapshotObj = this.toJSON({ includeCheckpoints });
    return DeepSearchState.fromJSON(deepCloneJsonSafe(snapshotObj));
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
