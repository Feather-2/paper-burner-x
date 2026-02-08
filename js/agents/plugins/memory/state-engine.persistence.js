import { sync as syncClock, currentSeq } from "../../core/lamport-clock.js";

/** Get current seq from engine's clockService or global fallback */
function _currentSeq(engine) {
  const cs = engine?._clockService;
  return cs && typeof cs.currentSeq === "function" ? cs.currentSeq() : currentSeq();
}
/** Sync clock via engine's clockService or global fallback */
function _syncClock(engine, seq) {
  const cs = engine?._clockService;
  if (cs && typeof cs.sync === "function") cs.sync(seq);
  else syncClock(seq);
}
import { cloneJson, buildStatePatch } from "./state-diff.js";
import { L3_ADD_CHECKPOINT } from "./action-types.js";
import { generateId } from "./state-engine.utils.js";

/**
 * Create a snapshot of current state
 * @param {object} state
 * @returns {object}
 */
export function createSnapshot(state) {
  return {
    state: cloneJson(state),
    clock: _currentSeq(null),
    ts: Date.now(),
  };
}

/**
 * Restore state from snapshot
 * @param {object} engine
 * @param {object} snapshot
 * @returns {boolean}
 */
export function restoreSnapshot(engine, snapshot) {
  if (!snapshot?.state) return false;

  engine._state = cloneJson(snapshot.state);
  if (typeof snapshot.clock === "number") {
    engine._actorId = engine._state.runId;
    _syncClock(engine, snapshot.clock);
  }
  return true;
}

/**
 * Save differential checkpoint
 * @param {object} engine
 * @param {object} [options]
 * @param {number} [options.fullSnapshotEvery=10] - Force full snapshot every N checkpoints
 * @returns {object} Checkpoint metadata
 */
export function saveCheckpoint(engine, options = {}) {
  const { fullSnapshotEvery = 10 } = options;
  const checkpointId = generateId("cp");
  const ts = Date.now();
  const clock = _currentSeq(engine);

  // Find most recent checkpoint as base
  const checkpointList = engine._state.L3?.checkpoints || [];
  const lastCp = checkpointList[checkpointList.length - 1];
  const checkpointCount = checkpointList.length;

  // Determine encoding
  const shouldFull = !lastCp || checkpointCount % fullSnapshotEvery === 0;

  let checkpoint;
  if (shouldFull) {
    checkpoint = {
      checkpointId,
      ts,
      clock,
      encoding: "full",
      data: cloneJson(engine._state),
    };
  } else {
    // Differential: store patch from last full/diff checkpoint
    const baseState = engine._checkpoints.get(lastCp.checkpointId)?.data;
    if (!baseState) {
      // Fallback to full if base not found
      checkpoint = {
        checkpointId,
        ts,
        clock,
        encoding: "full",
        data: cloneJson(engine._state),
      };
    } else {
      const patch = buildStatePatch(baseState, engine._state);
      checkpoint = {
        checkpointId,
        ts,
        clock,
        encoding: "diff",
        baseId: lastCp.checkpointId,
        patch,
      };
    }
  }

  // Store in memory for future diffs
  engine._checkpoints.set(checkpointId, {
    ...checkpoint,
    data: cloneJson(engine._state),
  });

  // Add to L3.checkpoints
  engine.dispatchSync({
    type: L3_ADD_CHECKPOINT,
    payload: { checkpoint: { checkpointId, ts, clock, encoding: checkpoint.encoding, baseId: checkpoint.baseId } },
  });

  return checkpoint;
}

/**
 * Restore from checkpoint by ID
 * @param {object} engine
 * @param {string} checkpointId
 * @returns {boolean} Success
 */
export function restoreCheckpoint(engine, checkpointId) {
  const cp = engine._checkpoints.get(checkpointId);
  if (!cp?.data) return false;

  // Preserve checkpoint log
  const checkpoints = engine._state.L3?.checkpoints || [];

  // Restore state
  engine._state = {
    ...cloneJson(cp.data),
    L3: {
      ...cloneJson(cp.data.L3 || {}),
      checkpoints, // Keep checkpoint log
    },
  };

  if (typeof cp.clock === "number") {
    engine._actorId = engine._state.runId;
    _syncClock(engine, cp.clock);
  }

  return true;
}
