import { computeSha256 } from "../storage/artifact-manager.js";
import { normalizeVfsPath } from "./path.js";
import { createUnifiedDiffAsync } from "./diff.js";
import { makeSecureTimestampedId } from "../shared/index.js";

import { isPlainObject } from "../shared/index.js";

const LOCAL_ARTIFACT_PREFIX = "pb_vfs_artifact|";

/** @type {any} */
const NodeBuffer = /** @type {any} */ (globalThis).Buffer;

/**
 * @typedef {object} StorageAdapterLike
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string, value: any) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 * @property {() => Promise<Iterable<string> | string[]>} keys
 */

/**
 * @typedef {object} RunStoreLike
 * @property {(runId: string, type: string, data: any, options?: any) => Promise<string>} saveArtifact
 * @property {(artifactId: string) => Promise<any>} getArtifactById
 * @property {(runId: string) => Promise<any[]>} listArtifacts
 * @property {(runId: string, options?: any) => Promise<any[]>} listArtifactSummaries
 */

/**
 * @typedef {object} VfsPayloadRef
 * @property {string} artifactId
 * @property {string} type
 * @property {"utf8"|"binary"} encoding
 * @property {number} bytes
 * @property {string=} sha256
 */

/**
 * @typedef {object} VfsCheckpointSide
 * @property {number} bytes
 * @property {string=} sha256
 * @property {string|null} preview
 * @property {string=} text
 * @property {string=} base64
 * @property {boolean=} truncated
 * @property {VfsPayloadRef=} payload
 */

/**
 * @typedef {object} VfsCheckpointDiff
 * @property {"unified"} format
 * @property {number} context
 * @property {number} bytes
 * @property {string} text
 */

/**
 * @typedef {object} VfsCheckpoint
 * @property {string} schemaVersion
 * @property {"vfs_checkpoint"} kind
 * @property {string} op
 * @property {string} ts
 * @property {string} path
 * @property {string} encoding
 * @property {VfsCheckpointSide} before
 * @property {VfsCheckpointSide} after
 * @property {VfsCheckpointDiff=} diff
 * @property {Promise<VfsCheckpointDiff|null>=} diffPromise
 */

/**
 * @typedef {object} RecordVfsCheckpointOptions
 * @property {RunStoreLike=} runStore
 * @property {StorageAdapterLike=} storageAdapter
 * @property {string=} runId
 * @property {string=} path
 * @property {any=} before
 * @property {any=} after
 * @property {string=} op
 * @property {string=} encoding
 * @property {number=} maxEmbedBytes
 * @property {string=} beforeSha256
 * @property {string=} afterSha256
 * @property {boolean=} skipDiff
 * @property {boolean=} deferDiff
 */

/**
 * @param {unknown} runStore
 * @returns {runStore is RunStoreLike}
 */
function isRunStoreLike(runStore) {
  const store = /** @type {any} */ (runStore);
  return store && typeof store.saveArtifact === "function" && typeof store.getArtifactById === "function";
}

/**
 * @param {unknown} storageAdapter
 * @returns {storageAdapter is StorageAdapterLike}
 */
function isStorageAdapterLike(storageAdapter) {
  const s = storageAdapter && typeof storageAdapter === "object" ? storageAdapter : null;
  const adapter = /** @type {any} */ (s);
  if (!s) return false;
  if (typeof adapter.get !== "function" || typeof adapter.set !== "function") return false;
  if (typeof adapter.delete !== "function" || typeof adapter.keys !== "function") return false;
  return true;
}

function makeLocalArtifactId(prefix = "artifact") {
  try {
    return makeSecureTimestampedId(prefix);
  } catch {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(16).slice(2, 10);
    return `${prefix}_${ts}_${rand}`;
  }
}

function makeLocalArtifactKey(runId, type, id) {
  const rid = typeof runId === "string" ? runId.trim() : "";
  const t = typeof type === "string" ? type.trim() : "";
  const aid = typeof id === "string" ? id.trim() : "";
  if (!rid || !t || !aid) throw new Error("makeLocalArtifactKey: runId/type/id are required");
  return `${LOCAL_ARTIFACT_PREFIX}${t}|${rid}|${aid}`;
}

function localTypePrefix(runId, type) {
  const rid = typeof runId === "string" ? runId.trim() : "";
  const t = typeof type === "string" ? type.trim() : "";
  if (!rid || !t) return null;
  return `${LOCAL_ARTIFACT_PREFIX}${t}|${rid}|`;
}

function parseLocalArtifactKey(key) {
  const k = typeof key === "string" ? key : "";
  if (!k.startsWith(LOCAL_ARTIFACT_PREFIX)) return null;
  const rest = k.slice(LOCAL_ARTIFACT_PREFIX.length);
  const [type, runId, id] = rest.split("|");
  if (!type || !runId || !id) return null;
  return { type, runId, id, artifactId: k };
}
function encodeUtf8Bytes(text) {
  if (typeof text !== "string") return 0;
  try {
    return new TextEncoder().encode(text).byteLength;
  } catch {
    return text.length;
  }
}

function toPreview(text, limit = 240) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 240;
  if (!max || s.length <= max) return s;
  return s.slice(0, max) + "\n...(truncated)";
}

function bytesToBase64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
  if (!b) return "";

  // Node
  if (NodeBuffer && typeof NodeBuffer.from === "function") {
    return NodeBuffer.from(b).toString("base64");
  }

  // Browser: prefer native base64 helpers.
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < b.length; i += chunkSize) {
      const sub = b.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...sub);
    }
    return btoa(binary);
  }

  return "";
}

function base64ToBytes(base64) {
  const s = typeof base64 === "string" ? base64 : "";
  if (!s) return new Uint8Array(0);

  // Node
  if (NodeBuffer && typeof NodeBuffer.from === "function") {
    return new Uint8Array(NodeBuffer.from(s, "base64"));
  }

  if (typeof atob === "function") {
    const cleaned = s.replace(/\s+/g, "");
    const bin = atob(cleaned);
    const out = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
    return out;
  }

  return new Uint8Array(0);
}

function dataToBytes(data) {
  if (data === null || data === undefined) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (isPlainObject(data) || Array.isArray(data)) return new TextEncoder().encode(JSON.stringify(data));
  return new TextEncoder().encode(String(data));
}

function guessIsUtf8Text(bytes, { maxCheck = 4096 } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : dataToBytes(bytes);
  const limit = Math.min(b.length, Math.max(0, Math.floor(maxCheck)));
  for (let i = 0; i < limit; i++) {
    const c = b[i];
    if (c === 0) return false;
  }
  if (limit === 0) return true;
  try {
    const dec = new TextDecoder("utf-8", { fatal: true });
    dec.decode(b.subarray(0, limit));
    return true;
  } catch {
    return false;
  }
}

async function computeSha(bytesOrText) {
  try {
    return await computeSha256(bytesOrText);
  } catch {
    return undefined;
  }
}

export const VFS_CHECKPOINT_TYPE = "vfs_checkpoint.json";
export const VFS_PAYLOAD_TYPE = "vfs_payload.bin";

/**
 * Record a file-write checkpoint (before/after fingerprints; optionally embeds before/after payloads).
 *
 * @param {RecordVfsCheckpointOptions} [options]
 * @returns {Promise<{artifactId:string, checkpoint: VfsCheckpoint}>}
 */
export async function recordVfsCheckpoint({
  runStore,
  storageAdapter,
  runId,
  path,
  before,
  after,
  op = "write",
  encoding = "utf8",
  maxEmbedBytes = 200000,
  beforeSha256,
  afterSha256,
  skipDiff = false,
  deferDiff = false,
} = {}) {
  const store = isRunStoreLike(runStore) ? runStore : null;
  const adapter = store ? null : isStorageAdapterLike(storageAdapter) ? storageAdapter : null;
  if (!store && !adapter) throw new Error("recordVfsCheckpoint: runStore or storageAdapter is required");
  if (!runId || typeof runId !== "string") throw new Error("recordVfsCheckpoint: runId must be a string");

  const normalizedPath = normalizeVfsPath(path);
  if (!normalizedPath) throw new Error("recordVfsCheckpoint: path must be a non-empty VFS path");

  const beforeBytes = dataToBytes(before);
  const afterBytes = dataToBytes(after);

  // 使用预计算的哈希或按需计算
  const beforeSha = typeof beforeSha256 === "string" && beforeSha256 ? beforeSha256 : await computeSha(beforeBytes);
  const afterSha = typeof afterSha256 === "string" && afterSha256 ? afterSha256 : await computeSha(afterBytes);

  // 快速路径：内容相同时跳过 diff
  const contentUnchanged = beforeSha && afterSha && beforeSha === afterSha;

  const beforeIsText = typeof before === "string" || guessIsUtf8Text(beforeBytes);
  const afterIsText = typeof after === "string" || guessIsUtf8Text(afterBytes);

  const beforeText = beforeIsText ? (typeof before === "string" ? before : new TextDecoder().decode(beforeBytes)) : null;
  const afterText = afterIsText ? (typeof after === "string" ? after : new TextDecoder().decode(afterBytes)) : null;

  /** @type {VfsCheckpoint} */
  const checkpoint = {
    schemaVersion: "0.1",
    kind: "vfs_checkpoint",
    op: String(op || "write"),
    ts: new Date().toISOString(),
    path: normalizedPath,
    encoding: String(encoding || "utf8"),
    before: {
      bytes: beforeBytes.byteLength,
      ...(beforeSha ? { sha256: beforeSha } : {}),
      ...(beforeText ? { preview: toPreview(beforeText) } : { preview: null }),
    },
    after: {
      bytes: afterBytes.byteLength,
      ...(afterSha ? { sha256: afterSha } : {}),
      ...(afterText ? { preview: toPreview(afterText) } : { preview: null }),
    },
  };

  if (beforeText !== null && afterText !== null && beforeBytes.byteLength + afterBytes.byteLength <= maxEmbedBytes) {
    // 跳过 diff 的情况：显式指定、内容相同、或延迟计算
    const shouldSkipDiff = skipDiff || contentUnchanged;

    if (!shouldSkipDiff) {
      /** @returns {Promise<VfsCheckpointDiff|null>} */
      const computeDiff = async () => {
        try {
          const diff = await createUnifiedDiffAsync(
            { path: normalizedPath, beforeText, afterText, context: 3 },
            { useWorker: true, workerThresholdChars: 80_000 }
          );
          return /** @type {VfsCheckpointDiff} */ ({
            format: "unified",
            context: 3,
            bytes: encodeUtf8Bytes(diff.text),
            text: diff.text,
          });
        } catch {
          return null;
        }
      };

      if (deferDiff) {
        // 延迟 diff：返回 Promise，调用者可选择等待
        checkpoint.diffPromise = computeDiff();
      } else {
        const diff = await computeDiff();
        if (diff) checkpoint.diff = diff;
      }
    }
  }

  const saveArtifact = async (type, data, options = {}) => {
    if (store) {
      return await store.saveArtifact(runId, type, data, options);
    }
    const id = makeLocalArtifactId(type === VFS_CHECKPOINT_TYPE ? "vfs_ckpt" : "vfs_payload");
    const key = makeLocalArtifactKey(runId, type, id);
    await adapter.set(key, data);
    return key;
  };

  if (beforeBytes.byteLength <= maxEmbedBytes) {
    if (beforeText !== null) checkpoint.before.text = beforeText;
    else checkpoint.before.base64 = bytesToBase64(beforeBytes);
  } else {
    // Store large payloads out-of-band so restores remain possible.
    const payloadData = beforeText !== null ? beforeText : store ? beforeBytes : bytesToBase64(beforeBytes);
    const payloadId = await saveArtifact(VFS_PAYLOAD_TYPE, payloadData, {
      mime: beforeText !== null ? "text/plain;charset=utf-8" : "application/octet-stream",
      bytes: beforeBytes.byteLength,
      ...(beforeSha ? { sha256: beforeSha } : {}),
    });
    checkpoint.before.truncated = true;
    checkpoint.before.payload = {
      artifactId: payloadId,
      type: VFS_PAYLOAD_TYPE,
      encoding: beforeText !== null ? "utf8" : "binary",
      bytes: beforeBytes.byteLength,
      ...(beforeSha ? { sha256: beforeSha } : {}),
    };
  }

  if (afterBytes.byteLength <= maxEmbedBytes) {
    if (afterText !== null) checkpoint.after.text = afterText;
    else checkpoint.after.base64 = bytesToBase64(afterBytes);
  } else {
    const payloadData = afterText !== null ? afterText : store ? afterBytes : bytesToBase64(afterBytes);
    const payloadId = await saveArtifact(VFS_PAYLOAD_TYPE, payloadData, {
      mime: afterText !== null ? "text/plain;charset=utf-8" : "application/octet-stream",
      bytes: afterBytes.byteLength,
      ...(afterSha ? { sha256: afterSha } : {}),
    });
    checkpoint.after.truncated = true;
    checkpoint.after.payload = {
      artifactId: payloadId,
      type: VFS_PAYLOAD_TYPE,
      encoding: afterText !== null ? "utf8" : "binary",
      bytes: afterBytes.byteLength,
      ...(afterSha ? { sha256: afterSha } : {}),
    };
  }

  const artifactId = await saveArtifact(VFS_CHECKPOINT_TYPE, checkpoint, {
    mime: "application/json",
    bytes: encodeUtf8Bytes(JSON.stringify(checkpoint)),
    ...(afterSha ? { sha256: afterSha } : {}),
  });

  return { artifactId, checkpoint };
}

/**
 * @param {RunStoreLike|unknown} runStore
 * @param {string} runId
 * @param {StorageAdapterLike|unknown} storageAdapter
 * @returns {Promise<any[]>}
 */
export async function listVfsCheckpoints(runStore, runId, storageAdapter) {
  const store = isRunStoreLike(runStore) ? runStore : null;
  const adapter = !store && isStorageAdapterLike(storageAdapter) ? storageAdapter : null;
  if (!store && !adapter) return [];

  if (store) {
    try {
      if (typeof store.listArtifactSummaries === "function") {
        const rows = await store.listArtifactSummaries(runId, { type: VFS_CHECKPOINT_TYPE });
        return (rows || []).sort((a, b) => (a.seq || 0) - (b.seq || 0));
      }
    } catch {
      // fall back
    }
    const rows = await store.listArtifacts(runId);
    return (rows || []).filter((r) => r && r.type === VFS_CHECKPOINT_TYPE).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }

  const prefix = localTypePrefix(runId, VFS_CHECKPOINT_TYPE);
  if (!prefix) return [];
  const keys = await adapter.keys();
  const out = [];
  for (const key of keys) {
    const k = String(key || "");
    if (!k.startsWith(prefix)) continue;
    const parsed = parseLocalArtifactKey(k);
    if (!parsed) continue;
    out.push({ artifactId: k, type: parsed.type, runId: parsed.runId, id: parsed.id });
  }
  return out;
}

/**
 * @param {{ vfs?: any, runStore?: RunStoreLike, storageAdapter?: StorageAdapterLike, artifactId?: string }} [options]
 * @returns {Promise<{ ok: boolean, path: string, encoding?: string, payloadArtifactId?: string, error?: string }>}
 */
export async function restoreVfsCheckpoint({ vfs, runStore, storageAdapter, artifactId } = {}) {
  if (!vfs || typeof vfs.writeFile !== "function") {
    throw new Error("restoreVfsCheckpoint: vfs with writeFile() is required");
  }
  const store = isRunStoreLike(runStore) ? runStore : null;
  const adapter = isStorageAdapterLike(storageAdapter) ? storageAdapter : null;
  if (!store && !adapter) throw new Error("restoreVfsCheckpoint: runStore or storageAdapter is required");
  const id = typeof artifactId === "string" ? artifactId.trim() : "";
  if (!id) throw new Error("restoreVfsCheckpoint: artifactId must be a non-empty string");

  const loadById = async (artifactIdToLoad) => {
    if (store) {
      try {
        return await store.getArtifactById(artifactIdToLoad);
      } catch {
        // fall through to adapter below
      }
    }
    if (adapter) {
      return await adapter.get(artifactIdToLoad);
    }
    return undefined;
  };

  const checkpoint = await loadById(id);
  const path = normalizeVfsPath(checkpoint?.path);
  if (!path) throw new Error("restoreVfsCheckpoint: checkpoint missing path");

  const payloadToBytes = async (value) => {
    if (value === null || value === undefined) return new Uint8Array(0);
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof Blob !== "undefined" && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    if (typeof value === "string") return new TextEncoder().encode(value);
    return new TextEncoder().encode(String(value));
  };

  if (typeof checkpoint?.before?.text === "string") {
    await vfs.writeText(path, checkpoint.before.text);
    return { ok: true, path, encoding: checkpoint.encoding || "utf8" };
  }
  if (typeof checkpoint?.before?.base64 === "string" && checkpoint.before.base64) {
    const bytes = base64ToBytes(checkpoint.before.base64);
    await vfs.writeFile(path, bytes);
    return { ok: true, path, encoding: "binary" };
  }

  const payloadId = typeof checkpoint?.before?.payload?.artifactId === "string" ? checkpoint.before.payload.artifactId.trim() : "";
  if (payloadId) {
    try {
      const raw = await loadById(payloadId);
      const enc = typeof checkpoint?.before?.payload?.encoding === "string" ? checkpoint.before.payload.encoding : "";

      if (enc === "utf8") {
        if (typeof raw === "string") {
          await vfs.writeText(path, raw);
        } else {
          const bytes = await payloadToBytes(raw);
          await vfs.writeText(path, new TextDecoder().decode(bytes));
        }
        return { ok: true, path, encoding: "utf8", payloadArtifactId: payloadId };
      }

      const bytes =
        typeof raw === "string" && raw && enc !== "utf8"
          ? base64ToBytes(raw)
          : await payloadToBytes(raw);
      await vfs.writeFile(path, bytes);
      return { ok: true, path, encoding: "binary", payloadArtifactId: payloadId };
    } catch (err) {
      return { ok: false, path, error: `Failed to restore payload ${payloadId}: ${err?.message || err}` };
    }
  }

  return { ok: false, path, error: "Checkpoint has no embedded before payload (truncated and no payload reference)." };
}

export default {
  VFS_CHECKPOINT_TYPE,
  VFS_PAYLOAD_TYPE,
  recordVfsCheckpoint,
  listVfsCheckpoints,
  restoreVfsCheckpoint,
};
