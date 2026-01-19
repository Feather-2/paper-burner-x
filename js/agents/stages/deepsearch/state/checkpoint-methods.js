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
} from "../internal/checkpoint.js";
import { buildStateSnapshot } from "./serializer.js";
import { PlanningTree } from "./planning-tree.js";

const DEFAULT_MAX_ITERATIONS = 5;

/**
 * Determine checkpoint strategy from checkpoint data.
 * @param {object} cp - Checkpoint object.
 * @param {Function} StateCtor - State constructor.
 * @returns {string} Resolved checkpoint strategy.
 */
function resolveCheckpointStrategy(cp, StateCtor) {
  const explicitStrategy = toNonEmptyString(cp?.strategy);
  if (explicitStrategy) return normalizeCheckpointStrategy(explicitStrategy);

  if (cp?.stateSnapshot instanceof StateCtor) return CheckpointMode.FULL;

  const snapshotStrategy = toNonEmptyString(cp?.stateSnapshot?.snapshotStrategy);
  if (snapshotStrategy === CheckpointMode.MINIMAL) return CheckpointMode.MINIMAL;
  if (snapshotStrategy === CheckpointMode.LITE) return CheckpointMode.LITE;

  const hasLiteMarkers =
    isPlainObject(cp?.stateSnapshot?.L2) &&
    Array.isArray(cp.stateSnapshot.L2.retrievedChunkIds) &&
    !Array.isArray(cp.stateSnapshot.L2.retrievedChunks);
  return hasLiteMarkers ? CheckpointMode.LITE : CheckpointMode.FULL;
}

/**
 * Apply LITE checkpoint fixup to L2 state.
 * @param {object} target - Target state object.
 * @param {object} restored - Restored snapshot data.
 */
function applyLiteFixup(target, restored) {
  const restoredIds = Array.isArray(restored?.L2?.retrievedChunkIds)
    ? restored.L2.retrievedChunkIds.map(String).filter(Boolean)
    : [];
  const tokenUsage = ensureTokenUsage(restored?.L2?.tokenUsage);
  target.L2 = {
    ...target.L2,
    retrievedChunkIds: restoredIds,
    tokenUsage,
    retrievedChunks: [],
    scratchpad: {},
    logs: [],
    incomplete: true,
    restoredFromLiteCheckpoint: true,
  };
}

/**
 * Apply MINIMAL checkpoint fixup to L2 state.
 * @param {object} target - Target state object.
 * @param {object} restored - Restored snapshot data.
 * @param {object|undefined} preservedL2 - Preserved L2 before restore.
 */
function applyMinimalFixup(target, restored, preservedL2) {
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
  target.L2 = {
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

/**
 * @typedef {object} CheckpointMetrics
 * @property {number=} gapCount - Number of open gaps.
 * @property {number=} claimCount - Number of claims.
 * @property {number=} evidenceCount - Number of evidence items.
 * @property {number=} retrievedCount - Number of retrieved chunks.
 */

/**
 * @typedef {'FULL'|'MINIMAL'|'LITE'} CheckpointStrategy
 */

/**
 * @typedef {object} SaveCheckpointOptions
 * @property {string=} checkpointId - Custom checkpoint identifier.
 * @property {string=} timestamp - Custom ISO timestamp.
 * @property {CheckpointMetrics=} metrics - Metrics to record with checkpoint.
 * @property {CheckpointStrategy=} strategy - Snapshot strategy (FULL/MINIMAL/LITE).
 * @property {boolean=} record - Whether to record checkpoint in history (default: true).
 */

export const checkpointMethods = {
  /**
   * Save a checkpoint of the current state.
   *
   * @param {SaveCheckpointOptions=} options - Checkpoint options.
   * @returns {object} The created checkpoint object.
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

  /**
   * Restore state from a previously saved checkpoint.
   *
   * @param {string} checkpointId - Checkpoint identifier to restore.
   * @returns {object} The restored checkpoint object.
   * @throws {TypeError} If checkpointId is empty.
   * @throws {Error} If checkpoint not found or invalid.
   */
  restoreCheckpoint(checkpointId) {
    const id = toNonEmptyString(checkpointId);
    if (!id) throw new TypeError("DeepSearchState.restoreCheckpoint(checkpointId): checkpointId is required");

    const cp = this._loadCheckpointById(id);
    const StateCtor = this.constructor;
    const checkpointStrategy = resolveCheckpointStrategy(cp, StateCtor);

    const preservedL2 = this.L2;
    const preserveCore = checkpointStrategy === CheckpointMode.LITE || checkpointStrategy === CheckpointMode.MINIMAL;
    const restored = this._restoreCore(cp, StateCtor, checkpointStrategy, preserveCore);

    if (checkpointStrategy === CheckpointMode.LITE) {
      applyLiteFixup(this, restored);
    } else if (checkpointStrategy === CheckpointMode.MINIMAL) {
      applyMinimalFixup(this, restored, preservedL2);
    }

    this.addTimeline({ name: "deepsearch:checkpointRestored", status: "info", payload: { checkpointId: id, iteration: this.iteration } });
    return cp;
  },

  /**
   * Load and validate checkpoint by ID.
   * @private
   * @param {string} id - Checkpoint identifier.
   * @returns {object} Loaded checkpoint.
   */
  _loadCheckpointById(id) {
    const idx = this.checkpoints.findIndex((c) => toNonEmptyString(c?.checkpointId) === id);
    const existing = idx >= 0 ? this.checkpoints[idx] : null;
    const cp = existing ? loadCheckpoint(existing) : null;
    if (existing && cp !== existing) this.checkpoints[idx] = cp;
    if (!cp) throw new Error(`Checkpoint not found: ${String(id)}`);
    if (!("stateSnapshot" in cp)) throw new Error(`Invalid checkpoint: missing stateSnapshot (${String(id)})`);
    return cp;
  },

  /**
   * Restore core state properties from checkpoint snapshot.
   * @private
   * @param {object} cp - Checkpoint object.
   * @param {Function} StateCtor - State constructor.
   * @param {string} checkpointStrategy - Resolved strategy.
   * @param {boolean} preserveCore - Whether to preserve L0/L1.
   * @returns {object} Restored snapshot data.
   */
  _restoreCore(cp, StateCtor, checkpointStrategy, preserveCore) {
    const preservedL0 = this.L0;
    const preservedL1 = this.L1;
    const preservedCheckpoints = this.checkpoints;
    const snapshot = cp.stateSnapshot instanceof StateCtor
      ? cp.stateSnapshot
      : /** @type {any} */ (StateCtor).fromJSON(cp.stateSnapshot);

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

    return restored;
  },
};
