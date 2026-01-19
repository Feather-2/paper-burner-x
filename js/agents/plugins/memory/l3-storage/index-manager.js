import { BYTES_PER_CHAR, ENTRY_OVERHEAD_BYTES } from "./constants.js";
import { toNonEmptyString } from "./utils.js";

export function createIndexState() {
  return {
    timeline: [],
    keywords: new Map(),
    stages: new Map(),
    hashIndex: new Map(),
  };
}

export function serializeIndexState(index, checkpointIndex, runId) {
  return {
    schemaVersion: "0.1",
    runId,
    updatedAt: Date.now(),
    timeline: Array.isArray(index.timeline) ? index.timeline : [],
    keywords: Array.from(index.keywords.entries()).map(([k, set]) => [k, Array.from(set || [])]),
    stages: Array.from(index.stages.entries()),
    hashIndex: Array.from(index.hashIndex.entries()),
    checkpointIndex: Array.isArray(checkpointIndex) ? checkpointIndex : [],
  };
}

export function restoreIndexState(raw) {
  if (!raw || typeof raw !== "object") return null;

  const timeline = Array.isArray(raw.timeline) ? raw.timeline : [];
  const keywordEntries = Array.isArray(raw.keywords) ? raw.keywords : [];
  const stageEntries = Array.isArray(raw.stages) ? raw.stages : [];
  const hashIndexEntries = Array.isArray(raw.hashIndex) ? raw.hashIndex : [];
  const checkpointIndex = Array.isArray(raw.checkpointIndex)
    ? raw.checkpointIndex
    : Array.isArray(raw.checkpoints)
      ? raw.checkpoints
      : [];

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

export function updateSnapshotAccess(index, snapshotId, accessedAt = Date.now()) {
  const id = toNonEmptyString(snapshotId);
  if (!id) return null;
  const timeline = Array.isArray(index.timeline) ? index.timeline : [];
  const entry = timeline.find((e) => e?.id === id);
  if (entry) entry.accessedAt = accessedAt;
  return entry || null;
}

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
