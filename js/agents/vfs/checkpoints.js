import { computeSha256 } from "../storage/artifact-manager.js";
import { normalizeVfsPath } from "./path.js";
import { createUnifiedDiff } from "./diff.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  if (typeof Buffer !== "undefined") {
    return Buffer.from(b).toString("base64");
  }

  // Browser
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) {
    binary += String.fromCharCode(...b.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const s = typeof base64 === "string" ? base64 : "";
  if (!s) return new Uint8Array(0);

  // Node
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(s, "base64"));
  }

  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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
  return true;
}

async function computeSha(bytesOrText) {
  try {
    return await computeSha256(bytesOrText);
  } catch {
    return undefined;
  }
}

export const VFS_CHECKPOINT_TYPE = "vfs_checkpoint.json";

/**
 * Record a file-write checkpoint (before/after fingerprints; optionally embeds before/after payloads).
 *
 * @param {object} options
 * @param {object} options.runStore RunStore-like (saveArtifact/listArtifacts/getArtifactById)
 * @param {string} options.runId
 * @param {string} options.path VFS path
 * @param {any} options.before File contents before write (string/bytes/object)
 * @param {any} options.after File contents after write (string/bytes/object)
 * @param {string} [options.op="write"]
 * @param {string} [options.encoding="utf8"]
 * @param {number} [options.maxEmbedBytes=200000]
 * @returns {Promise<{artifactId:string,checkpoint:object}>}
 */
export async function recordVfsCheckpoint({
  runStore,
  runId,
  path,
  before,
  after,
  op = "write",
  encoding = "utf8",
  maxEmbedBytes = 200000,
} = {}) {
  if (!runStore || typeof runStore.saveArtifact !== "function") {
    throw new Error("recordVfsCheckpoint: runStore with saveArtifact() is required");
  }
  if (!runId || typeof runId !== "string") throw new Error("recordVfsCheckpoint: runId must be a string");

  const normalizedPath = normalizeVfsPath(path);
  if (!normalizedPath) throw new Error("recordVfsCheckpoint: path must be a non-empty VFS path");

  const beforeBytes = dataToBytes(before);
  const afterBytes = dataToBytes(after);

  const beforeSha = await computeSha(beforeBytes);
  const afterSha = await computeSha(afterBytes);

  const beforeIsText = typeof before === "string" || guessIsUtf8Text(beforeBytes);
  const afterIsText = typeof after === "string" || guessIsUtf8Text(afterBytes);

  const beforeText = beforeIsText ? (typeof before === "string" ? before : new TextDecoder().decode(beforeBytes)) : null;
  const afterText = afterIsText ? (typeof after === "string" ? after : new TextDecoder().decode(afterBytes)) : null;

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
    try {
      const diff = createUnifiedDiff({ path: normalizedPath, beforeText, afterText, context: 3 });
      checkpoint.diff = {
        format: "unified",
        context: 3,
        bytes: encodeUtf8Bytes(diff.text),
        text: diff.text,
      };
    } catch {
      // ignore diff failures
    }
  }

  if (beforeBytes.byteLength <= maxEmbedBytes) {
    if (beforeText !== null) checkpoint.before.text = beforeText;
    else checkpoint.before.base64 = bytesToBase64(beforeBytes);
  } else {
    checkpoint.before.truncated = true;
  }

  if (afterBytes.byteLength <= maxEmbedBytes) {
    if (afterText !== null) checkpoint.after.text = afterText;
    else checkpoint.after.base64 = bytesToBase64(afterBytes);
  } else {
    checkpoint.after.truncated = true;
  }

  const artifactId = await runStore.saveArtifact(runId, VFS_CHECKPOINT_TYPE, checkpoint, {
    mime: "application/json",
    bytes: encodeUtf8Bytes(JSON.stringify(checkpoint)),
    ...(afterSha ? { sha256: afterSha } : {}),
  });

  return { artifactId, checkpoint };
}

export async function listVfsCheckpoints(runStore, runId) {
  if (!runStore || typeof runStore.listArtifacts !== "function") return [];
  const rows = await runStore.listArtifacts(runId);
  return (rows || [])
    .filter((r) => r && r.type === VFS_CHECKPOINT_TYPE)
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

export async function restoreVfsCheckpoint({ vfs, runStore, artifactId } = {}) {
  if (!vfs || typeof vfs.writeFile !== "function") {
    throw new Error("restoreVfsCheckpoint: vfs with writeFile() is required");
  }
  if (!runStore || typeof runStore.getArtifactById !== "function") {
    throw new Error("restoreVfsCheckpoint: runStore with getArtifactById() is required");
  }
  const id = typeof artifactId === "string" ? artifactId.trim() : "";
  if (!id) throw new Error("restoreVfsCheckpoint: artifactId must be a non-empty string");

  const checkpoint = await runStore.getArtifactById(id);
  const path = normalizeVfsPath(checkpoint?.path);
  if (!path) throw new Error("restoreVfsCheckpoint: checkpoint missing path");

  if (typeof checkpoint?.before?.text === "string") {
    await vfs.writeText(path, checkpoint.before.text);
    return { ok: true, path, encoding: checkpoint.encoding || "utf8" };
  }
  if (typeof checkpoint?.before?.base64 === "string" && checkpoint.before.base64) {
    const bytes = base64ToBytes(checkpoint.before.base64);
    await vfs.writeFile(path, bytes);
    return { ok: true, path, encoding: "binary" };
  }

  return { ok: false, path, error: "Checkpoint has no embedded before payload (truncated)." };
}

export default {
  VFS_CHECKPOINT_TYPE,
  recordVfsCheckpoint,
  listVfsCheckpoints,
  restoreVfsCheckpoint,
};
