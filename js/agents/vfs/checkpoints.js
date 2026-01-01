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

  // Browser: encode directly to base64 (avoid building huge binary strings).
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const parts = [];
  const chunkBytes = 3 * 16384; // divisible by 3 -> stable padding handling
  for (let offset = 0; offset < b.length; offset += chunkBytes) {
    const end = Math.min(b.length, offset + chunkBytes);
    let out = "";
    for (let i = offset; i < end; i += 3) {
      const b0 = b[i];
      const b1 = i + 1 < end ? b[i + 1] : 0;
      const b2 = i + 2 < end ? b[i + 2] : 0;

      const n = (b0 << 16) | (b1 << 8) | b2;
      out += alphabet[(n >>> 18) & 63];
      out += alphabet[(n >>> 12) & 63];
      out += i + 1 < end ? alphabet[(n >>> 6) & 63] : "=";
      out += i + 2 < end ? alphabet[n & 63] : "=";
    }
    parts.push(out);
  }
  return parts.join("");
}

function base64ToBytes(base64) {
  const s = typeof base64 === "string" ? base64 : "";
  if (!s) return new Uint8Array(0);

  // Node
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(s, "base64"));
  }

  const cleaned = s.replace(/\s+/g, "");
  const arrays = [];
  let total = 0;
  const chunkChars = 4 * 16384; // multiple of 4 for base64
  for (let i = 0; i < cleaned.length; i += chunkChars) {
    const chunk = cleaned.slice(i, i + chunkChars);
    const bin = atob(chunk);
    const buf = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) buf[j] = bin.charCodeAt(j);
    arrays.push(buf);
    total += buf.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const buf of arrays) {
    out.set(buf, offset);
    offset += buf.length;
  }
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
export const VFS_PAYLOAD_TYPE = "vfs_payload.bin";

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
    // Store large payloads out-of-band so restores remain possible.
    const payloadId = await runStore.saveArtifact(runId, VFS_PAYLOAD_TYPE, beforeText !== null ? beforeText : beforeBytes, {
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
    const payloadId = await runStore.saveArtifact(runId, VFS_PAYLOAD_TYPE, afterText !== null ? afterText : afterBytes, {
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

  const artifactId = await runStore.saveArtifact(runId, VFS_CHECKPOINT_TYPE, checkpoint, {
    mime: "application/json",
    bytes: encodeUtf8Bytes(JSON.stringify(checkpoint)),
    ...(afterSha ? { sha256: afterSha } : {}),
  });

  return { artifactId, checkpoint };
}

export async function listVfsCheckpoints(runStore, runId) {
  if (!runStore || typeof runStore.listArtifacts !== "function") return [];
  try {
    if (typeof runStore.listArtifactSummaries === "function") {
      const rows = await runStore.listArtifactSummaries(runId, { type: VFS_CHECKPOINT_TYPE });
      return (rows || []).sort((a, b) => (a.seq || 0) - (b.seq || 0));
    }
  } catch {
    // fall back
  }
  const rows = await runStore.listArtifacts(runId);
  return (rows || []).filter((r) => r && r.type === VFS_CHECKPOINT_TYPE).sort((a, b) => (a.seq || 0) - (b.seq || 0));
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
      const raw = await runStore.getArtifactById(payloadId);
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

      const bytes = await payloadToBytes(raw);
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
