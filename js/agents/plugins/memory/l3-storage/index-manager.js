import { BYTES_PER_CHAR, ENTRY_OVERHEAD_BYTES } from "./constants.js";
import { toNonEmptyString } from "./utils.js";

/** Current schema version for L3 index persistence. */
export const CURRENT_SCHEMA_VERSION = "0.2";

/**
 * Migration registry: maps `fromVersion` to `{ toVersion, migrate(raw) }`.
 * Each migration mutates `raw` in-place and returns it.
 * @type {Map<string, { toVersion: string, migrate: (raw: object) => object }>}
 */
const migrations = new Map([
  ["0.1", {
    toVersion: "0.2",
    migrate(raw) {
      // 0.1→0.2: add accessCount to timeline entries
      if (Array.isArray(raw.timeline)) {
        for (const entry of raw.timeline) {
          if (entry && typeof entry === "object" && typeof entry.accessCount !== "number") {
            entry.accessCount = 0;
          }
        }
      }
      raw.schemaVersion = "0.2";
      return raw;
    },
  }],
]);

/**
 * Run all applicable migrations from `raw.schemaVersion` up to `CURRENT_SCHEMA_VERSION`.
 * @param {object} raw - Persisted index data.
 * @returns {object} Migrated data (mutated in-place).
 */
export function migrateIndex(raw) {
  let version = typeof raw?.schemaVersion === "string" ? raw.schemaVersion : "0.1";
  let steps = 0;
  const MAX_STEPS = 20; // guard against infinite loops
  while (version !== CURRENT_SCHEMA_VERSION && steps < MAX_STEPS) {
    const migration = migrations.get(version);
    if (!migration) {
      console.warn(`[L3Storage] No migration from schema ${version} to ${CURRENT_SCHEMA_VERSION}`);
      break;
    }
    raw = migration.migrate(raw);
    version = migration.toVersion;
    steps++;
  }
  return raw;
}

/**
 * Create a new index state container.
 * @returns {{timeline: Array, keywords: Map<string, Set<string>>, stages: Map<string, string>, hashIndex: Map<string, string>}}
 *   New index state.
 */
export function createIndexState() {
  return {
    timeline: [],
    keywords: new Map(),
    stages: new Map(),
    hashIndex: new Map(),
  };
}

/**
 * Serialize index state for persistence.
 * @param {object} index - Current index state.
 * @param {Array<string>} checkpointIndex - Ordered checkpoint ids.
 * @param {string} runId - Run identifier to store in metadata.
 * @returns {object} Serializable index payload.
 */
export function serializeIndexState(index, checkpointIndex, runId) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    runId,
    updatedAt: Date.now(),
    timeline: Array.isArray(index.timeline) ? index.timeline : [],
    keywords: Array.from(index.keywords.entries()).map(([k, set]) => [k, Array.from(set || [])]),
    stages: Array.from(index.stages.entries()),
    hashIndex: Array.from(index.hashIndex.entries()),
    checkpointIndex: Array.isArray(checkpointIndex) ? checkpointIndex : [],
  };
}

/**
 * Restore index state from persisted data.
 * @param {object|null} raw - Parsed serialized index data.
 * @returns {{index: object, checkpointIndex: Array<string>}|null} Restored index state.
 */
export function restoreIndexState(raw) {
  if (!raw || typeof raw !== "object") return null;

  // Schema migration: upgrade persisted data to current version
  if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    raw = migrateIndex(raw);
  }

  // Check data size (max 100MB)
  const serialized = JSON.stringify(raw);
  const sizeBytes = serialized.length * 2; // Approximate UTF-8 byte size
  const maxBytes = 100 * 1024 * 1024; // 100MB
  if (sizeBytes > maxBytes) {
    console.warn(`[L3Storage] Index data too large: ${sizeBytes} bytes (max ${maxBytes})`);
    return null;
  }

  const timeline = Array.isArray(raw.timeline) ? raw.timeline : [];
  const keywordEntries = Array.isArray(raw.keywords) ? raw.keywords : [];
  const stageEntries = Array.isArray(raw.stages) ? raw.stages : [];
  const hashIndexEntries = Array.isArray(raw.hashIndex) ? raw.hashIndex : [];
  const checkpointIndex = Array.isArray(raw.checkpointIndex)
    ? raw.checkpointIndex
    : Array.isArray(raw.checkpoints)
      ? raw.checkpoints
      : [];

  // Validate timeline entries
  for (const entry of timeline) {
    if (!entry || typeof entry !== "object") {
      console.warn("[L3Storage] Invalid timeline entry: not an object");
      return null;
    }
    if (!entry.id || typeof entry.id !== "string") {
      console.warn("[L3Storage] Invalid timeline entry: missing or invalid id");
      return null;
    }
    if (typeof entry.ts !== "number" || !Number.isFinite(entry.ts)) {
      console.warn("[L3Storage] Invalid timeline entry: missing or invalid ts");
      return null;
    }
  }

  const index = createIndexState();
  index.timeline = timeline;
  index.keywords = new Map(
    keywordEntries
      .filter((entry) => Array.isArray(entry) && typeof entry[0] === "string")
      .map(([k, ids]) => [k, new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [])])
  );
  index.stages = new Map(
    stageEntries.filter((entry) => Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string")
  );
  index.hashIndex = new Map(
    hashIndexEntries.filter((entry) => Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string")
  );

  return { index, checkpointIndex };
}

/**
 * Add snapshot metadata to the index.
 * @param {object} index - Index state to mutate.
 * @param {object} entry - Snapshot entry with id/keywords/stageKey/ts/summary/contentHash.
 * @returns {void}
 */
export function addSnapshotToIndex(index, entry) {
  const id = toNonEmptyString(entry?.id);
  if (!id) return;

  const keywords = Array.isArray(entry?.keywords) ? entry.keywords : [];
  const stageKey = toNonEmptyString(entry?.stageKey);
  const ts = typeof entry?.ts === "number" && Number.isFinite(entry.ts) ? entry.ts : Date.now();
  const summary = typeof entry?.summary === "string" ? entry.summary : undefined;
  const contentHash = toNonEmptyString(entry?.contentHash);

  for (const kw of keywords) {
    if (!index.keywords.has(kw)) index.keywords.set(kw, new Set());
    index.keywords.get(kw).add(id);
  }

  if (stageKey) index.stages.set(stageKey, id);
  index.timeline.push({ id, ts, accessedAt: ts, summary, stageKey: stageKey || undefined });
  if (contentHash) index.hashIndex.set(contentHash, id);
}

/**
 * Update access timestamp for a snapshot.
 * @param {object} index - Index state to mutate.
 * @param {string} snapshotId - Snapshot id to update.
 * @param {number} [accessedAt=Date.now()] - Access timestamp in ms.
 * @returns {object|null} Updated timeline entry, if found.
 */
export function updateSnapshotAccess(index, snapshotId, accessedAt = Date.now()) {
  const id = toNonEmptyString(snapshotId);
  if (!id) return null;
  const timeline = Array.isArray(index.timeline) ? index.timeline : [];
  const entry = timeline.find((e) => e?.id === id);
  if (entry) {
    entry.accessedAt = accessedAt;
    entry.accessCount = (typeof entry.accessCount === "number" ? entry.accessCount : 0) + 1;
  }
  return entry || null;
}

/**
 * Remove snapshot metadata from the index.
 * @param {object} index - Index state to mutate.
 * @param {string} snapshotId - Snapshot id to remove.
 * @returns {void}
 */
export function removeSnapshotFromIndex(index, snapshotId) {
  const id = toNonEmptyString(snapshotId);
  if (!id) return;

  index.timeline = Array.isArray(index.timeline) ? index.timeline.filter((e) => e?.id !== id) : [];

  for (const [, idSet] of index.keywords) {
    idSet.delete(id);
  }

  for (const [stage, snapId] of index.stages) {
    if (snapId === id) {
      index.stages.delete(stage);
    }
  }

  for (const [hash, snapId] of index.hashIndex) {
    if (snapId === id) {
      index.hashIndex.delete(hash);
    }
  }
}

/**
 * Mark a snapshot as superseded.
 * @param {object} index - Index state to mutate.
 * @param {string} snapshotId - Snapshot id to mark.
 * @param {string} correctionText - Superseding info or correction text.
 * @returns {{entry: object|null, wasSuperseded: boolean}} Result details.
 */
export function markSnapshotSupersededInIndex(index, snapshotId, correctionText) {
  const id = toNonEmptyString(snapshotId);
  if (!id) return { entry: null, wasSuperseded: false };

  const timeline = Array.isArray(index.timeline) ? index.timeline : [];
  const entry = timeline.find((e) => e?.id === id);
  if (!entry) return { entry: null, wasSuperseded: false };

  const wasSuperseded = entry.superseded === true;
  entry.superseded = true;
  entry.supersededBy = correctionText;
  return { entry, wasSuperseded };
}

/**
 * Mark multiple snapshots as superseded.
 * @param {object} index - Index state to mutate.
 * @param {Array<string>} ids - Snapshot ids to mark.
 * @param {string} correctionText - Superseding info or correction text.
 * @returns {{marked: number, touched: boolean, updatedIds: Array<string>}} Result details.
 */
export function markSnapshotsSupersededInIndex(index, ids, correctionText) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) return { marked: 0, touched: false, updatedIds: [] };

  const timeline = Array.isArray(index.timeline) ? index.timeline : [];
  let marked = 0;
  let touched = false;
  const updatedIds = [];

  for (const rawId of list) {
    const id = toNonEmptyString(rawId);
    if (!id) continue;
    const entry = timeline.find((e) => e?.id === id);
    if (!entry) continue;

    const wasSuperseded = entry.superseded === true;
    entry.superseded = true;
    entry.supersededBy = correctionText;
    if (!wasSuperseded) marked += 1;
    touched = true;
    updatedIds.push(id);
  }

  return { marked, touched, updatedIds };
}

/**
 * Count superseded snapshots.
 * @param {object} index - Index state to inspect.
 * @returns {number} Count of superseded snapshots.
 */
export function getSupersededSnapshotCount(index) {
  const timeline = Array.isArray(index.timeline) ? index.timeline : [];
  let count = 0;
  for (const entry of timeline) {
    if (entry && typeof entry === "object" && entry.superseded === true) {
      count += 1;
    }
  }
  return count;
}

/**
 * Estimate storage footprint for the index.
 * @param {object} index - Index state to inspect.
 * @param {object} [options] - Optional tuning values.
 * @param {number} [options.bytesPerChar] - Bytes per character multiplier.
 * @param {number} [options.entryOverheadBytes] - Base overhead per entry.
 * @returns {number} Estimated bytes.
 */
export function estimateStorageBytes(index, options = {}) {
  const bytesPerChar =
    typeof options.bytesPerChar === "number" && Number.isFinite(options.bytesPerChar) ? options.bytesPerChar : BYTES_PER_CHAR;
  const entryOverheadBytes =
    typeof options.entryOverheadBytes === "number" && Number.isFinite(options.entryOverheadBytes)
      ? options.entryOverheadBytes
      : ENTRY_OVERHEAD_BYTES;

  const timeline = Array.isArray(index.timeline) ? index.timeline : [];
  let bytes = 0;
  for (const entry of timeline) {
    const summaryLen = typeof entry?.summary === "string" ? entry.summary.length : 0;
    bytes += entryOverheadBytes + summaryLen * bytesPerChar;
  }
  return bytes;
}
