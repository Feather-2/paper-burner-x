import { isPlainObject, safeInt, safeNumber, toNonEmptyString } from "../../../shared/utils/value-utils.js";
import { CheckpointMode } from "../constants.js";
import { ensureTokenUsage } from "../utils/state-utils.js";
import {
  buildLiteSnapshot,
  buildMinimalSnapshot,
  CHECKPOINT_SCHEMA_VERSION,
  cloneValue,
  getCheckpointStrategyFromState,
  loadCheckpoint,
  normalizeCheckpointStrategy,
} from "../runtime/checkpoint.js";
import { buildStateSnapshot } from "./serializer.js";
import { PlanningTree } from "./planning-tree.js";

const DEFAULT_MAX_ITERATIONS = 5;

export const checkpointMethods = {
  /**
   * @param {{ checkpointId?: string, timestamp?: string, metrics?: any, strategy?: any, record?: boolean }=} options
   * @returns {any}
   */
  saveCheckpoint({ checkpointId, timestamp, metrics, strategy, record = true } = {}) {
    const id = toNonEmptyString(checkpointId) || `cp_${this.checkpoints.length + 1}`;
    const ts = toNonEmptyString(timestamp) || new Date().toISOString();

    const checkpointStrategy = getCheckpointStrategyFromState(this, strategy);
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

    if (record !== false) {
      this.checkpoints.push(checkpoint);
      const max = Math.max(0, safeInt(this?.userConfig?.memory?.maxCheckpoints) ?? 30);
      while (this.checkpoints.length > max) this.checkpoints.shift();
    }
    return checkpoint;
  },

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
    const StateCtor = this.constructor;
    const checkpointStrategy = explicitStrategy
      ? normalizeCheckpointStrategy(explicitStrategy)
      : cp?.stateSnapshot instanceof StateCtor
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
    const snapshot = cp.stateSnapshot instanceof StateCtor ? cp.stateSnapshot : /** @type {any} */ (StateCtor).fromJSON(cp.stateSnapshot);
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
  },
};
