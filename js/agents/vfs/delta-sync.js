/**
 * VFS Delta Sync - 增量文件同步
 *
 * 特性：
 * - 基于 hash 的变更检测
 * - 增量传输（只传输变更部分）
 * - 冲突检测和解决策略
 * - 断点续传支持
 */

import { createLogger } from "../shared/index.js";

const logger = createLogger("vfs/delta-sync");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB for delta chunks

// ─────────────────────────────────────────────────────────────────────────────
// Hash Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute simple hash for content
 * @param {ArrayBuffer|Uint8Array|string} data
 * @returns {Promise<string>}
 */
export async function computeHash(data) {
  let bytes;
  if (typeof data === "string") {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    throw new TypeError("computeHash: data must be string, ArrayBuffer, or Uint8Array");
  }

  try {
    const hashBuffer = await crypto.subtle.digest("SHA-256", /** @type {any} */ (bytes));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Fallback: simple FNV-1a hash
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
}

/**
 * Compute rolling hash for chunk boundary detection
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} windowSize
 * @returns {number}
 */
function rollingHash(bytes, start, windowSize) {
  let hash = 0;
  const end = Math.min(start + windowSize, bytes.length);
  for (let i = start; i < end; i++) {
    hash = ((hash << 5) - hash + bytes[i]) | 0;
  }
  return hash >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// File Manifest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} FileEntry
 * @property {string} path
 * @property {string} hash
 * @property {number} size
 * @property {number} mtime
 * @property {string[]} [chunkHashes] - For large files
 */

/**
 * @typedef {Object} SyncManifest
 * @property {string} id
 * @property {number} ts
 * @property {Map<string, FileEntry>} files
 */

/**
 * Build manifest from file list
 * @param {Array<{ path: string, content: ArrayBuffer|Uint8Array|string, mtime?: number }>} files
 * @returns {Promise<SyncManifest>}
 */
export async function buildManifest(files) {
  const manifest = {
    id: `manifest_${Date.now().toString(36)}`,
    ts: Date.now(),
    files: new Map(),
  };

  for (const file of files) {
    const hash = await computeHash(file.content);
    const size =
      typeof file.content === "string"
        ? new TextEncoder().encode(file.content).length
        : file.content.byteLength;

    manifest.files.set(file.path, {
      path: file.path,
      hash,
      size,
      mtime: file.mtime ?? Date.now(),
    });
  }

  return manifest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delta Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} DeltaEntry
 * @property {string} path
 * @property {'add'|'modify'|'delete'} type
 * @property {string} [hash]
 * @property {number} [size]
 */

/**
 * Compute delta between two manifests
 * @param {SyncManifest} base
 * @param {SyncManifest} target
 * @returns {DeltaEntry[]}
 */
export function computeDelta(base, target) {
  /** @type {DeltaEntry[]} */
  const delta = [];

  // Find added and modified files
  for (const [path, targetEntry] of target.files) {
    const baseEntry = base.files.get(path);

    if (!baseEntry) {
      delta.push({ path, type: "add", hash: targetEntry.hash, size: targetEntry.size });
    } else if (baseEntry.hash !== targetEntry.hash) {
      delta.push({ path, type: "modify", hash: targetEntry.hash, size: targetEntry.size });
    }
  }

  // Find deleted files
  for (const [path] of base.files) {
    if (!target.files.has(path)) {
      delta.push({ path, type: "delete" });
    }
  }

  return delta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conflict Resolution
// ─────────────────────────────────────────────────────────────────────────────

export const ConflictStrategy = {
  LOCAL_WINS: "local_wins",
  REMOTE_WINS: "remote_wins",
  NEWER_WINS: "newer_wins",
  MANUAL: "manual",
};

/**
 * @typedef {Object} Conflict
 * @property {string} path
 * @property {DeltaEntry} local
 * @property {DeltaEntry} remote
 * @property {string} [resolution]
 */

/**
 * Detect conflicts between local and remote changes
 * @param {DeltaEntry[]} localDelta
 * @param {DeltaEntry[]} remoteDelta
 * @returns {Conflict[]}
 */
export function detectConflicts(localDelta, remoteDelta) {
  /** @type {Conflict[]} */
  const conflicts = [];
  const localMap = new Map(localDelta.map((d) => [d.path, d]));
  const remoteMap = new Map(remoteDelta.map((d) => [d.path, d]));

  for (const [path, local] of localMap) {
    const remote = remoteMap.get(path);
    if (!remote) continue;

    // Both modified same file
    if (
      (local.type === "modify" || local.type === "add") &&
      (remote.type === "modify" || remote.type === "add")
    ) {
      if (local.hash !== remote.hash) {
        conflicts.push({ path, local, remote });
      }
    }

    // One deleted, other modified
    if (
      (local.type === "delete" && remote.type !== "delete") ||
      (remote.type === "delete" && local.type !== "delete")
    ) {
      conflicts.push({ path, local, remote });
    }
  }

  return conflicts;
}

/**
 * Resolve conflicts using strategy
 * @param {Conflict[]} conflicts
 * @param {string} strategy
 * @param {SyncManifest} localManifest
 * @param {SyncManifest} remoteManifest
 * @returns {Conflict[]}
 */
export function resolveConflicts(conflicts, strategy, localManifest, remoteManifest) {
  return conflicts.map((conflict) => {
    let resolution;

    switch (strategy) {
      case ConflictStrategy.LOCAL_WINS:
        resolution = "local";
        break;

      case ConflictStrategy.REMOTE_WINS:
        resolution = "remote";
        break;

      case ConflictStrategy.NEWER_WINS: {
        const localEntry = localManifest.files.get(conflict.path);
        const remoteEntry = remoteManifest.files.get(conflict.path);
        const localTime = localEntry?.mtime ?? 0;
        const remoteTime = remoteEntry?.mtime ?? 0;
        resolution = localTime >= remoteTime ? "local" : "remote";
        break;
      }

      default:
        resolution = "manual";
    }

    return { ...conflict, resolution };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DeltaSyncSession
// ─────────────────────────────────────────────────────────────────────────────

export class DeltaSyncSession {
  /**
   * @param {object} options
   * @param {string} [options.conflictStrategy='newer_wins']
   * @param {function} [options.onProgress]
   * @param {function} [options.onConflict]
   */
  constructor({
    conflictStrategy = ConflictStrategy.NEWER_WINS,
    onProgress,
    onConflict,
  } = {}) {
    this._conflictStrategy = conflictStrategy;
    this._onProgress = typeof onProgress === "function" ? onProgress : null;
    this._onConflict = typeof onConflict === "function" ? onConflict : null;

    this._localManifest = null;
    this._remoteManifest = null;
    this._baseManifest = null;
  }

  /**
   * Set local manifest
   * @param {SyncManifest} manifest
   */
  setLocalManifest(manifest) {
    this._localManifest = manifest;
  }

  /**
   * Set remote manifest
   * @param {SyncManifest} manifest
   */
  setRemoteManifest(manifest) {
    this._remoteManifest = manifest;
  }

  /**
   * Set base (common ancestor) manifest
   * @param {SyncManifest} manifest
   */
  setBaseManifest(manifest) {
    this._baseManifest = manifest;
  }

  /**
   * Compute sync plan
   * @returns {{ toUpload: DeltaEntry[], toDownload: DeltaEntry[], conflicts: Conflict[] }}
   */
  computeSyncPlan() {
    if (!this._localManifest || !this._remoteManifest) {
      throw new Error("Both local and remote manifests required");
    }

    const base = this._baseManifest || { files: new Map(), id: "empty", ts: 0 };

    // Compute changes from base
    const localDelta = computeDelta(base, this._localManifest);
    const remoteDelta = computeDelta(base, this._remoteManifest);

    // Detect conflicts
    let conflicts = detectConflicts(localDelta, remoteDelta);

    // Resolve conflicts
    if (conflicts.length > 0) {
      if (this._onConflict) {
        conflicts = this._onConflict(conflicts);
      } else {
        conflicts = resolveConflicts(
          conflicts,
          this._conflictStrategy,
          this._localManifest,
          this._remoteManifest
        );
      }
    }

    // Build upload/download lists
    const conflictPaths = new Set(conflicts.map((c) => c.path));
    const toUpload = [];
    const toDownload = [];

    // Local changes not in conflict -> upload
    for (const entry of localDelta) {
      if (!conflictPaths.has(entry.path)) {
        toUpload.push(entry);
      }
    }

    // Remote changes not in conflict -> download
    for (const entry of remoteDelta) {
      if (!conflictPaths.has(entry.path)) {
        toDownload.push(entry);
      }
    }

    // Handle resolved conflicts
    for (const conflict of conflicts) {
      if (conflict.resolution === "local") {
        toUpload.push(conflict.local);
      } else if (conflict.resolution === "remote") {
        toDownload.push(conflict.remote);
      }
    }

    logger.info("Sync plan computed", {
      toUpload: toUpload.length,
      toDownload: toDownload.length,
      conflicts: conflicts.filter((c) => c.resolution === "manual").length,
    });

    return { toUpload, toDownload, conflicts };
  }

  /**
   * Report progress
   * @param {string} phase
   * @param {number} current
   * @param {number} total
   */
  _reportProgress(phase, current, total) {
    if (this._onProgress) {
      this._onProgress({ phase, current, total, percent: total > 0 ? (current / total) * 100 : 0 });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default DeltaSyncSession;
