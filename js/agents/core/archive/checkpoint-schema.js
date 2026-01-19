/**
 * @typedef {Record<string, any>} AnyRecord
 *
 * @typedef {"pre-action" | "pause" | "compress" | "archive"} CheckpointTypeValue
 *
 * @typedef {AnyRecord & { type?: CheckpointTypeValue, runId?: string, iteration?: number }} CheckpointMetadata
 *
 * @typedef {AnyRecord} NodeStates
 *
 * @typedef {object} Checkpoint
 * @property {string} schemaVersion
 * @property {NodeStates} nodeStates
 * @property {number} timestamp
 * @property {CheckpointMetadata} metadata
 */

/** @type {string} */
export const CHECKPOINT_SCHEMA_VERSION = "1.0";

/** @type {Readonly<{ PRE_ACTION: CheckpointTypeValue, PAUSE: CheckpointTypeValue, COMPRESS: CheckpointTypeValue, ARCHIVE: CheckpointTypeValue }>} */
export const CheckpointType = Object.freeze({
  PRE_ACTION: "pre-action",
  PAUSE: "pause",
  COMPRESS: "compress",
  ARCHIVE: "archive",
});

/**
 * Normalize checkpoint format.
 * @param {NodeStates} nodeStates
 * @param {CheckpointMetadata} [metadata]
 * @returns {Checkpoint}
 */
export function createCheckpoint(nodeStates, metadata = {}) {
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    nodeStates,
    timestamp: Date.now(),
    metadata: {
      type: metadata.type || CheckpointType.PRE_ACTION,
      runId: metadata.runId,
      iteration: metadata.iteration,
      ...metadata,
    },
  };
}

/**
 * Validate checkpoint format.
 * @param {unknown} checkpoint
 * @returns {boolean}
 */
export function validateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") return false;
  const cp = /** @type {any} */ (checkpoint);
  if (!cp.schemaVersion) return false;
  if (!cp.nodeStates) return false;
  return true;
}

/**
 * Migrate legacy checkpoint format.
 * @param {any} checkpoint
 * @returns {Checkpoint | null}
 */
export function migrateCheckpoint(checkpoint) {
  if (!checkpoint) return null;

  // Already in new format.
  if (checkpoint.schemaVersion) return checkpoint;

  // Migrate legacy format.
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    nodeStates: checkpoint.nodeStates || checkpoint,
    timestamp: checkpoint.timestamp || Date.now(),
    metadata: checkpoint.metadata || { type: CheckpointType.ARCHIVE },
  };
}
