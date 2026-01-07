import { isPlainObject, toNonEmptyString, sanitizeForJson } from "../../../shared/utils/value-utils.js";
import { Deque } from "../../../shared/utils/deque.js";
import { cloneValue } from "../runtime/checkpoint.js";

/**
 * @typedef {object} CheckpointLike
 * @property {string=} schemaVersion
 * @property {string=} checkpointId
 * @property {number=} iteration
 * @property {string=} timestamp
 * @property {any=} strategy
 * @property {any=} metrics
 * @property {any=} stateSnapshot
 */

/**
 * @typedef {object} CheckpointReference
 * @property {string=} schemaVersion
 * @property {string=} checkpointId
 * @property {number=} iteration
 * @property {string=} timestamp
 * @property {any=} strategy
 * @property {any=} metrics
 */

/**
 * @typedef {object} PlanningTreeLike
 * @property {() => any} [serialize]
 */

/**
 * @typedef {object} DeepSearchStateLike
 * @property {string} schemaVersion
 * @property {string} runId
 * @property {string} createdAt
 * @property {string} taskGoal
 * @property {any} userConfig
 * @property {PlanningTreeLike|null|undefined} planningTree
 * @property {string=} trajectoryId
 * @property {any=} trajectoryConfig
 * @property {number} iteration
 * @property {number} maxIterations
 * @property {CheckpointLike[]|any} checkpoints
 * @property {number} writeBacktrackCount
 * @property {any[]} writeSnapshots
 * @property {any} L0
 * @property {any} L1
 * @property {any} L2
 * @property {any[]} todos
 * @property {Deque|any} timeline
 */

/**
 * Build compact checkpoint reference objects (no embedded snapshot payloads).
 *
 * @param {CheckpointLike[]|null|undefined} checkpoints
 * @returns {CheckpointReference[]}
 */
export function buildCheckpointReferences(checkpoints) {
  const rows = Array.isArray(checkpoints) ? checkpoints : [];
  return rows.map((checkpoint) => {
    const raw = checkpoint && typeof checkpoint === "object" ? checkpoint : {};
    const { schemaVersion, checkpointId, iteration, timestamp, strategy, metrics } = raw;
    return { schemaVersion, checkpointId, iteration, timestamp, strategy, metrics };
  });
}

/**
 * Build a state snapshot suitable for persistence, with optional checkpoint inclusion.
 *
 * @param {Record<string, any>} state
 * @param {{ includeCheckpoints?: boolean, includeCheckpointSnapshots?: boolean }=} options
 * @returns {Record<string, any>}
 */
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

/**
 * Build a JSON-safe snapshot object (e.g. removes unserializable values).
 *
 * @param {Record<string, any>} state
 * @param {{ includeCheckpoints?: boolean }=} options
 * @returns {Record<string, any>}
 */
export function toJSON(state, { includeCheckpoints = true } = {}) {
  return sanitizeForJson(buildStateSnapshot(state, { includeCheckpoints, includeCheckpointSnapshots: false }));
}

/**
 * Build a clone-safe snapshot object (includes checkpoint snapshots by default).
 *
 * @param {Record<string, any>} state
 * @param {{ includeCheckpoints?: boolean }=} options
 * @returns {Record<string, any>}
 */
export function toSnapshot(state, { includeCheckpoints = true } = {}) {
  return cloneValue(buildStateSnapshot(state, { includeCheckpoints, includeCheckpointSnapshots: true }));
}

/**
 * Validate (lightly) that a loaded snapshot is an object.
 *
 * @param {any} json
 * @returns {Record<string, any>}
 */
export function fromSnapshot(json) {
  if (!isPlainObject(json)) throw new TypeError("fromSnapshot(json): json must be an object");
  return json;
}
