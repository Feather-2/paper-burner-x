import { isPlainObject, toNonEmptyString, sanitizeForJson } from "../../../shared/utils/value-utils.js";
import { Deque } from "../../../shared/utils/deque.js";
import { cloneValue } from "../runtime/checkpoint.js";

export function buildCheckpointReferences(checkpoints) {
  const rows = Array.isArray(checkpoints) ? checkpoints : [];
  return rows.map((checkpoint) => {
    const raw = checkpoint && typeof checkpoint === "object" ? checkpoint : {};
    const { schemaVersion, checkpointId, iteration, timestamp, strategy, metrics } = raw;
    return { schemaVersion, checkpointId, iteration, timestamp, strategy, metrics };
  });
}

export function buildStateSnapshot(state, { includeCheckpoints = true, includeCheckpointSnapshots = true } = {}) {
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

export function toJSON(state, { includeCheckpoints = true } = {}) {
  return sanitizeForJson(buildStateSnapshot(state, { includeCheckpoints, includeCheckpointSnapshots: false }));
}

export function toSnapshot(state, { includeCheckpoints = true } = {}) {
  return cloneValue(buildStateSnapshot(state, { includeCheckpoints, includeCheckpointSnapshots: true }));
}

export function fromSnapshot(json) {
  if (!isPlainObject(json)) throw new TypeError("fromSnapshot(json): json must be an object");
  return json;
}
