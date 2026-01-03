import { isPlainObject, safeInt, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { ensureTokenUsage, EVENT_SCHEMA_VERSION, EventStatus, extractJsonCandidate, normalizeBudgetConfig, stripThinkingTags } from "./utils/state-utils.js";
import { Deque } from "../../shared/utils/deque.js";
import { makeStageEmitter, generateNodeId, checkCancelled } from "./stage-utils.js";
import { transitionGap, computeRoundHitsByGapId, validateIteration } from "./state-logic.js";
import { loadCheckpoint } from "./runtime/checkpoint.js";
import { PlanningTree } from "./state/planning-tree.js";
import { TaskState } from "./state/task-state.js";
import { IterationState } from "./state/iteration-state.js";
import { ReportState } from "./state/report-state.js";
import { fromSnapshot, toJSON as stateToJSON } from "./state/serializer.js";
import { memoryMethods } from "./state/memory-methods.js";
import { stateMethods } from "./state/state-methods.js";
import { checkpointMethods } from "./state/checkpoint-methods.js";
import { deserialize, serializationMethods } from "./state/serialization-methods.js";

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
  } = {}) {
    this.schemaVersion = toNonEmptyString(schemaVersion) || STATE_SCHEMA_VERSION;
    this.runId = toNonEmptyString(runId) || "run_unknown";
    this.createdAt = toNonEmptyString(createdAt) || new Date().toISOString();
    this.sharedContext = sharedContext || null;
    this.subAgentIndex = Number.isFinite(subAgentIndex) ? subAgentIndex : null;
    this._memoryStore = memoryStore || null;
    this._localTaskGoal = toNonEmptyString(taskGoal) || "";

    this.task = new TaskState(this);
    this.iterationState = new IterationState(this);
    this.reportState = new ReportState(this);

    this.userConfig = isPlainObject(userConfig) ? userConfig : {};
    this.trajectoryId = toNonEmptyString(trajectoryId);
    this.trajectoryConfig = isPlainObject(trajectoryConfig) ? trajectoryConfig : isPlainObject(this.userConfig?.trajectory) ? this.userConfig.trajectory : undefined;
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

    this.todos = Array.isArray(todos) ? todos : [];
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
