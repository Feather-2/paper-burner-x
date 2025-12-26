export const CHECKPOINT_SCHEMA_VERSION = "1.0";

export const CheckpointType = Object.freeze({
  PRE_ACTION: "pre-action",
  PAUSE: "pause",
  COMPRESS: "compress",
  ARCHIVE: "archive",
});

/**
 * Normalize checkpoint format.
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
 */
export function validateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") return false;
  if (!checkpoint.schemaVersion) return false;
  if (!checkpoint.nodeStates) return false;
  return true;
}

/**
 * Migrate legacy checkpoint format.
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
