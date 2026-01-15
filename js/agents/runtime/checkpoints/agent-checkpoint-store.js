import { StorageVfs } from "../../vfs/vfs.storage.js";
import { safeJsonParse } from "../../shared/utils/safe-json.js";
import { createLogger } from "../../shared/utils/logger.js";
import { isPlainObject, safeInt, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { makeSecureTimestampedId } from "../../shared/utils/secure-id.js";

const logger = createLogger("runtime/checkpoints/agent");

const CHECKPOINT_SCHEMA_VERSION = "0.1";
const CHECKPOINT_KIND = "agent_checkpoint";
const INDEX_KIND = "agent_checkpoint_index";
const INDEX_FILE = "index.json";

function safeSegment(value, fallback) {
  const raw = toNonEmptyString(value);
  if (!raw) return fallback;
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildCheckpointDir(runId) {
  const safeRunId = safeSegment(runId, "run");
  return `.agents/runs/${safeRunId}/checkpoints`;
}

function buildCheckpointPath(runId, checkpointId) {
  const safeId = safeSegment(checkpointId, "ckpt");
  return `${buildCheckpointDir(runId)}/${safeId}.json`;
}

function buildIndexPath(runId) {
  return `${buildCheckpointDir(runId)}/${INDEX_FILE}`;
}

function ensureVfs({ vfs, storageAdapter } = {}) {
  if (vfs && typeof vfs.writeFile === "function") return vfs;
  if (storageAdapter && typeof storageAdapter.get === "function") {
    try {
      return new StorageVfs(storageAdapter);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      logger.warn(`[checkpoint-store] Failed to build StorageVfs: ${msg}`);
    }
  }
  return null;
}

function makeCheckpointId() {
  try {
    return makeSecureTimestampedId("ckpt");
  } catch {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(16).slice(2, 10);
    return `ckpt_${ts}_${rand}`;
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: "json_stringify_failed", message: msg });
  }
}

function bytesToText(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : new Uint8Array(0);
  return new TextDecoder().decode(view);
}

async function readText(vfs, path) {
  if (typeof vfs.readText === "function") return await vfs.readText(path);
  if (typeof vfs.readFile === "function") {
    const data = await vfs.readFile(path);
    if (typeof data === "string") return data;
    return bytesToText(data);
  }
  throw new Error("CheckpointStore: vfs.readText/readFile not available");
}

async function writeText(vfs, path, text) {
  if (typeof vfs.writeText === "function") return await vfs.writeText(path, text);
  if (typeof vfs.writeFile === "function") return await vfs.writeFile(path, text);
  throw new Error("CheckpointStore: vfs.writeText/writeFile not available");
}

async function loadIndex(vfs, runId) {
  const path = buildIndexPath(runId);
  try {
    const raw = await readText(vfs, path);
    const parsed = safeJsonParse(raw, { maxChars: 2_000_000 });
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.checkpoints)) {
      return parsed.checkpoints;
    }
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    if (!msg.includes("ENOENT") && !msg.includes("NotFound")) {
      logger.warn(`[checkpoint-store] Failed to read index: ${msg}`);
    }
    return [];
  }
}

async function saveIndex(vfs, runId, checkpoints) {
  const payload = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    kind: INDEX_KIND,
    runId,
    updatedAt: new Date().toISOString(),
    checkpoints,
  };
  await writeText(vfs, buildIndexPath(runId), safeJsonStringify(payload));
}

function normalizeRestoreMode(mode, { checkpointId, step } = {}) {
  const normalized = toNonEmptyString(mode)?.toLowerCase();
  if (normalized === "last" || normalized === "latest") return "last";
  if (normalized === "checkpoint" || normalized === "id") return "checkpoint";
  if (normalized === "step") return "step";
  if (checkpointId) return "checkpoint";
  if (step !== undefined && step !== null) return "step";
  return normalized || "last";
}

function normalizeIndexEntry(entry) {
  const e = entry && typeof entry === "object" ? entry : {};
  const checkpointId = toNonEmptyString(e.checkpointId);
  if (!checkpointId) return null;
  return {
    checkpointId,
    ts: toNonEmptyString(e.ts) || new Date().toISOString(),
    step: safeInt(e.step),
    iteration: safeInt(e.iteration),
    metadata: isPlainObject(e.metadata) ? e.metadata : undefined,
  };
}

export class AgentCheckpointStore {
  constructor({ vfs, storageAdapter, runId, logger: customLogger } = {}) {
    this._logger = customLogger || logger;
    this._vfs = ensureVfs({ vfs, storageAdapter });
    this._runId = toNonEmptyString(runId) || null;
  }

  get runId() {
    return this._runId;
  }

  set runId(value) {
    this._runId = toNonEmptyString(value) || null;
  }

  _requireVfs() {
    const vfs = this._vfs;
    if (!vfs) throw new Error("AgentCheckpointStore requires vfs or storageAdapter");
    return vfs;
  }

  async listCheckpoints({ runId } = {}) {
    const id = toNonEmptyString(runId) || this._runId;
    if (!id) return [];
    const vfs = this._requireVfs();
    const index = await loadIndex(vfs, id);
    return index.map(normalizeIndexEntry).filter(Boolean);
  }

  async saveCheckpoint({
    runId,
    messages,
    toolCalls,
    results,
    metadata,
    step,
    iteration,
  } = {}) {
    const id = toNonEmptyString(runId) || this._runId;
    if (!id) throw new Error("AgentCheckpointStore.saveCheckpoint: runId is required");
    const vfs = this._requireVfs();

    const checkpointId = makeCheckpointId();
    const ts = new Date().toISOString();
    const stepValue = safeInt(step) ?? safeInt(iteration) ?? null;
    const iterationValue = safeInt(iteration);

    const checkpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      kind: CHECKPOINT_KIND,
      checkpointId,
      runId: id,
      ts,
      step: stepValue,
      ...(iterationValue !== null ? { iteration: iterationValue } : {}),
      messages: Array.isArray(messages) ? messages : [],
      toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
      results: Array.isArray(results) ? results : [],
      metadata: isPlainObject(metadata) ? metadata : {},
    };

    await writeText(vfs, buildCheckpointPath(id, checkpointId), safeJsonStringify(checkpoint));

    const index = await loadIndex(vfs, id);
    const entry = normalizeIndexEntry({
      checkpointId,
      ts,
      step: stepValue ?? undefined,
      iteration: iterationValue ?? undefined,
      metadata: checkpoint.metadata,
    });
    if (entry) index.push(entry);
    await saveIndex(vfs, id, index);

    return { checkpointId, checkpoint };
  }

  async loadCheckpoint({ runId, checkpointId, step, mode } = {}) {
    const id = toNonEmptyString(runId) || this._runId;
    if (!id) return null;
    const vfs = this._requireVfs();

    const resolved = await this._resolveCheckpointId({
      runId: id,
      checkpointId,
      step,
      mode,
    });
    if (!resolved) return null;

    try {
      const raw = await readText(vfs, buildCheckpointPath(id, resolved));
      return safeJsonParse(raw, { maxChars: 5_000_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      this._logger?.warn?.(`[checkpoint-store] Failed to read checkpoint ${resolved}: ${msg}`);
      return null;
    }
  }

  async _resolveCheckpointId({ runId, checkpointId, step, mode } = {}) {
    const id = toNonEmptyString(runId) || this._runId;
    if (!id) return null;
    if (checkpointId) return toNonEmptyString(checkpointId) || null;

    const index = await this.listCheckpoints({ runId: id });
    if (index.length === 0) return null;

    const resolvedMode = normalizeRestoreMode(mode, { checkpointId, step });

    if (resolvedMode === "step") {
      const targetStep = safeInt(step);
      if (targetStep === null) return null;
      const match = index.find((entry) => safeInt(entry.step) === targetStep || safeInt(entry.iteration) === targetStep);
      return match?.checkpointId || null;
    }

    if (resolvedMode === "checkpoint") return toNonEmptyString(checkpointId) || null;

    return index[index.length - 1]?.checkpointId || null;
  }
}

export default AgentCheckpointStore;
