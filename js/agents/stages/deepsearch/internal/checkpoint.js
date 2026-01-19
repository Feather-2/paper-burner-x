import { isPlainObject, toNonEmptyString } from "../../../shared/index.js";
import { createCheckpoint, CheckpointType as ArchiveCheckpointType } from "../../../shared/index.js";
import { createLogger } from "../../../shared/index.js";
import { CheckpointMode } from "../constants.js";
import { ensureTokenUsage } from "../utils/state-utils.js";
import { migratGapToTodo } from "../utils/todo-utils.js";

const logger = createLogger("stages/deepsearch/internal/checkpoint");

export const CHECKPOINT_SCHEMA_VERSION = "1.0";

const DEFAULT_CHECKPOINT_STRATEGY = () => CheckpointMode.LITE;

/**
 * Normalize a checkpoint strategy value to a valid CheckpointMode.
 * @param {string|null|undefined} v - Raw strategy value to normalize
 * @returns {string} Normalized CheckpointMode (LITE, MINIMAL, or FULL)
 */
export function normalizeCheckpointStrategy(v) {
  const raw = toNonEmptyString(v);
  const s = raw ? raw.toLowerCase() : "";
  if (s === CheckpointMode.FULL) return CheckpointMode.FULL;
  if (s === CheckpointMode.MINIMAL) return CheckpointMode.MINIMAL;
  return CheckpointMode.LITE;
}

/**
 * Derive the checkpoint strategy from state or an override value.
 * @param {object|null|undefined} state - DeepSearch state containing userConfig
 * @param {string=} override - Optional override value (takes precedence over state)
 * @returns {string} Resolved CheckpointMode
 */
export function getCheckpointStrategyFromState(state, override) {
  const direct = override !== undefined ? override : state?.userConfig?.checkpointStrategy;
  return normalizeCheckpointStrategy(direct || DEFAULT_CHECKPOINT_STRATEGY());
}

function cloneValueFallback(v, seen) {
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v)) return "[Circular]";
  seen.add(v);

  if (Array.isArray(v)) return v.map((item) => cloneValueFallback(item, seen));
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof RegExp) return new RegExp(v);
  if (v instanceof Map) {
    const out = new Map();
    for (const [k, val] of v.entries()) out.set(cloneValueFallback(k, seen), cloneValueFallback(val, seen));
    return out;
  }
  if (v instanceof Set) {
    const out = new Set();
    for (const item of v.values()) out.add(cloneValueFallback(item, seen));
    return out;
  }

  const cloned = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    cloned[k] = cloneValueFallback(val, seen);
  }
  return cloned;
}

function hasCycle(root) {
  if (root === null || typeof root !== "object") return false;

  const visited = new WeakSet();
  const inPath = new WeakSet();
  const stack = [];

  const getIterator = (v) => {
    if (Array.isArray(v)) return v.values();
    if (v instanceof Map) {
      const entries = v.entries();
      let pending = null;
      return {
        next() {
          if (pending) {
            const value = pending[1];
            pending = null;
            return { value, done: false };
          }
          const step = entries.next();
          if (step.done) return { value: undefined, done: true };
          pending = step.value;
          return { value: pending[0], done: false };
        },
        [Symbol.iterator]() {
          return this;
        },
      };
    }
    if (v instanceof Set) return v.values();
    return Object.values(v)[Symbol.iterator]();
  };

  const push = (v) => {
    if (v === null || typeof v !== "object") return false;
    if (inPath.has(v)) return true;
    if (visited.has(v)) return false;

    visited.add(v);
    inPath.add(v);
    stack.push({ node: v, iterator: getIterator(v) });
    return false;
  };

  if (push(root)) return true;

  while (stack.length) {
    const frame = stack[stack.length - 1];
    const step = frame.iterator.next();
    if (step.done) {
      inPath.delete(frame.node);
      stack.pop();
      continue;
    }

    if (push(step.value)) return true;
  }

  return false;
}

/**
 * Deep clone a value safely, handling cycles and non-cloneable objects.
 * @param {*} v - Value to clone
 * @param {WeakSet=} seen - Internal tracker for circular reference detection
 * @returns {*} Cloned value
 */
export function cloneValue(v, seen = new WeakSet()) {
  if (v === null || typeof v !== "object") return v;
  if (typeof structuredClone === "function") {
    try {
      if (!hasCycle(v)) return structuredClone(v);
    } catch (err) {
      logger.debug("structuredClone failed, falling back to manual clone", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return cloneValueFallback(v, seen);
}

export function buildLiteSnapshot(state) {
  const retrievedChunks = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  const retrievedChunkIds = retrievedChunks.map((r) => toNonEmptyString(r?.chunkId)).filter(Boolean);

  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const hasSourceIndex = Boolean(state?.L0?.sourceIndex);

  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];

  const awaitUserFeedback = typeof state?.L2?.awaitUserFeedback === "boolean" ? state.L2.awaitUserFeedback : false;
  const taskImpossible = typeof state?.L2?.taskImpossible === "boolean" ? state.L2.taskImpossible : false;
  const reason = toNonEmptyString(state?.L2?.reason) || "";

  return {
    snapshotStrategy: CheckpointMode.LITE,
    schemaVersion: state.schemaVersion,
    checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
    runId: state.runId,
    createdAt: state.createdAt,
    taskGoal: state.taskGoal,
    userConfig: cloneValue(state.userConfig),
    planningTree: state.planningTree?.serialize ? state.planningTree.serialize() : null,
    ...(toNonEmptyString(state.trajectoryId) ? { trajectoryId: state.trajectoryId } : {}),
    ...(isPlainObject(state.trajectoryConfig) ? { trajectoryConfig: cloneValue(state.trajectoryConfig) } : {}),
    iteration: state.iteration,
    maxIterations: state.maxIterations,
    writeBacktrackCount: state.writeBacktrackCount,
    writeSnapshots: cloneValue(state.writeSnapshots),
    L0: {
      sourcesRef: "state.L0.sources",
      sourceIndexRef: "state.L0.sourceIndex",
      sourcesCount: sources.length,
      hasSourceIndex,
    },
    L1Summary: {
      gapCount: gaps.length,
      claimCount: claims.length,
      gapIds: gaps.map((g) => toNonEmptyString(g?.gapId)).filter(Boolean),
    },
    L2: {
      retrievedChunkIds,
      tokenUsage: cloneValue(ensureTokenUsage(state?.L2?.tokenUsage)),
      incomplete: true,
      awaitUserFeedback,
      taskImpossible,
      reason,
    },
    todos: cloneValue(state.todos),
    timeline: cloneValue(state.timeline),
  };
}

export function buildMinimalSnapshot(state) {
  const lite = buildLiteSnapshot(state);
  const tokenUsage = ensureTokenUsage(state?.L2?.tokenUsage);
  const awaitUserFeedback = typeof state?.L2?.awaitUserFeedback === "boolean" ? state.L2.awaitUserFeedback : false;
  const taskImpossible = typeof state?.L2?.taskImpossible === "boolean" ? state.L2.taskImpossible : false;
  const reason = toNonEmptyString(state?.L2?.reason) || "";
  return {
    ...lite,
    snapshotStrategy: CheckpointMode.MINIMAL,
    L2: {
      tokenUsage: cloneValue(tokenUsage),
      incomplete: true,
      awaitUserFeedback,
      taskImpossible,
      reason,
    },
  };
}

// Migration registry for checkpoint objects (not DeepSearchState snapshots).
// Keys are the *source* checkpoint schemaVersion, and each migrator returns a checkpoint object compatible with the current schema.
const CHECKPOINT_MIGRATIONS = Object.freeze({
  // Legacy checkpoints had no schemaVersion; treat them as "0.0" and simply stamp the current version.
  "0.0": (checkpoint) => ({ ...checkpoint, schemaVersion: CHECKPOINT_SCHEMA_VERSION }),
});

function ensureCheckpointTodos(snapshot) {
  if (!snapshot) return snapshot;
  const existing = Array.isArray(snapshot.todos) ? snapshot.todos : null;
  if (existing && existing.length) return snapshot;

  const gaps = Array.isArray(snapshot?.L1?.gaps) ? snapshot.L1.gaps : [];
  if (!gaps.length) {
    snapshot.todos = existing || [];
    return snapshot;
  }

  const todos = [];
  for (const gap of gaps) {
    const migrated = migratGapToTodo(gap);
    if (migrated) todos.push(migrated);
  }
  snapshot.todos = todos;
  return snapshot;
}

function ensureCheckpointL2Flags(snapshot) {
  if (!snapshot) return snapshot;
  const rawL2 = isPlainObject(snapshot?.L2) ? snapshot.L2 : {};
  const awaitUserFeedback = typeof rawL2.awaitUserFeedback === "boolean" ? rawL2.awaitUserFeedback : false;
  const taskImpossible = typeof rawL2.taskImpossible === "boolean" ? rawL2.taskImpossible : false;
  const reason = toNonEmptyString(rawL2.reason) || "";
  snapshot.L2 = { ...rawL2, awaitUserFeedback, taskImpossible, reason };
  return snapshot;
}

export function loadCheckpoint(checkpoint) {
  if (!isPlainObject(checkpoint)) throw new TypeError("loadCheckpoint(checkpoint): checkpoint must be an object");

  const version = toNonEmptyString(checkpoint?.schemaVersion) || "0.0";
  if (version === CHECKPOINT_SCHEMA_VERSION) {
    if (checkpoint?.stateSnapshot && typeof checkpoint.stateSnapshot === "object") {
      ensureCheckpointTodos(checkpoint.stateSnapshot);
      ensureCheckpointL2Flags(checkpoint.stateSnapshot);
    }
    return checkpoint;
  }

  const snapshotDescriptor = Object.getOwnPropertyDescriptor(checkpoint, "stateSnapshot");

  const migrate = CHECKPOINT_MIGRATIONS[version];
  if (typeof migrate === "function") {
    const migrated = migrate(checkpoint);
    if (!isPlainObject(migrated)) throw new TypeError(`Checkpoint migration ${version} -> ${CHECKPOINT_SCHEMA_VERSION} must return an object`);

    migrated.schemaVersion = CHECKPOINT_SCHEMA_VERSION;
    if (migrated?.stateSnapshot && typeof migrated.stateSnapshot === "object") {
      ensureCheckpointTodos(migrated.stateSnapshot);
      ensureCheckpointL2Flags(migrated.stateSnapshot);
    }
    if (snapshotDescriptor && !Object.getOwnPropertyDescriptor(migrated, "stateSnapshot")) {
      try {
        Object.defineProperty(migrated, "stateSnapshot", snapshotDescriptor);
      } catch {
        // ignore descriptor copy failures
      }
    }
    return migrated;
  }

  logger.warn(`Unknown checkpoint schema version: ${version} (expected ${CHECKPOINT_SCHEMA_VERSION}); attempting to load anyway`);
  return checkpoint;
}

export class CheckpointManager {
  /**
   * @param {{ archive?: any, emit?: ((eventName:string, payload:any)=>void)|null, logger?: any }=} options
   */
  constructor({ archive, emit, logger } = {}) {
    this.archive = archive || null;
    this._emit = typeof emit === "function" ? emit : null;
    this._logger = logger || console;
  }

  /**
   * @param {any} state
   * @param {{ iteration?: number, metadata?: any }=} options
   * @returns {Promise<string|null>}
   */
  async save(state, { iteration, metadata } = {}) {
    const meta = isPlainObject(metadata) ? metadata : {};
    const runId = toNonEmptyString(state?.runId) || toNonEmptyString(meta.runId) || "run_unknown";

    if (!this.archive || typeof this.archive.save !== "function") {
      this._logger?.warn?.("[deepsearch] CheckpointManager.save skipped: no archive available");
      return null;
    }

    const nodeStates =
      state && typeof state.toJSON === "function" ? state.toJSON({ includeCheckpoints: false }) : isPlainObject(state) ? state : {};

    const checkpoint = createCheckpoint(nodeStates, {
      type: meta.type || ArchiveCheckpointType.ARCHIVE,
      runId,
      iteration: Number.isFinite(iteration) ? iteration : state?.iteration,
      ...meta,
    });

    const checkpointId = await this.archive.save(runId, checkpoint);

    if (state && typeof state.saveCheckpoint === "function") {
      try {
        state.saveCheckpoint({
          checkpointId,
          timestamp: checkpoint.timestamp,
          ...(meta.metrics ? { metrics: meta.metrics } : {}),
          ...(meta.strategy ? { strategy: meta.strategy } : {}),
        });
      } catch (err) {
        this._logger?.warn?.("[deepsearch] Failed to record checkpoint in state:", err);
      }
    }

    this._emit?.("deepsearch.checkpoint.saved", {
      runId,
      checkpointId,
      iteration: Number.isFinite(iteration) ? iteration : state?.iteration,
    });

    return checkpointId;
  }
}

export default CheckpointManager;
