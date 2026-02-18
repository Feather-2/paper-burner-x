/**
 * VFS Snapshot — serialize / deserialize / diff a VFS tree.
 *
 * Browser-safe: no Node Buffer dependency.
 * @module core/sandbox/vfs-snapshot
 */

/** @typedef {object} VfsSnapshotEntry
 * @property {string} path
 * @property {'file'|'directory'} type
 * @property {string} [content] - base64 encoded for files
 */

/** @typedef {object} VfsSnapshot
 * @property {VfsSnapshotEntry[]} files
 */

/** @typedef {object} SnapshotDiff
 * @property {string[]} added
 * @property {string[]} modified
 * @property {string[]} deleted
 */

/**
 * @param {unknown} input
 * @param {string} label
 * @returns {VfsSnapshotEntry[]}
 */
function assertSnapshotEntries(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${label}: expected snapshot object`);
  }
  const files = /** @type {{ files?: unknown }} */ (input).files;
  if (!Array.isArray(files)) {
    throw new TypeError(`${label}.files: expected array`);
  }

  return files.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`${label}.files[${index}]: expected object`);
    }
    const e = /** @type {Record<string, unknown>} */ (entry);
    if (typeof e.path !== 'string' || e.path.trim().length === 0) {
      throw new TypeError(`${label}.files[${index}].path: expected non-empty string`);
    }
    if (e.type !== 'file' && e.type !== 'directory') {
      throw new TypeError(`${label}.files[${index}].type: expected "file" or "directory"`);
    }
    if (e.type === 'file' && e.content !== undefined && typeof e.content !== 'string') {
      throw new TypeError(`${label}.files[${index}].content: expected base64 string`);
    }
    return /** @type {VfsSnapshotEntry} */ (e);
  });
}

/**
 * Uint8Array to base64 (browser-safe).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function uint8ToBase64(bytes) {
  if (typeof Buffer === 'function') {
    return Buffer.from(bytes).toString('base64');
  }

  // Avoid O(n^2) string concatenation for large payloads.
  const chunkSize = 0x8000;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
}

/**
 * Base64 to Uint8Array (browser-safe).
 * @param {string} str
 * @returns {Uint8Array}
 */
export function base64ToUint8(str) {
  const binary = atob(str);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Recursively collect directory paths from a VFS.
 * @param {object} vfs
 * @param {string} dirPath - "" for root
 * @param {string[]} result
 */
async function collectDirs(vfs, dirPath, result) {
  const entries = await vfs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const childPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(childPath);
      await collectDirs(vfs, childPath, result);
    }
  }
}

/**
 * Serialize a VFS tree into a portable snapshot.
 * @param {object} vfs - any object implementing the VFS interface
 * @returns {Promise<VfsSnapshot>}
 */
export async function toSnapshot(vfs) {
  /** @type {VfsSnapshotEntry[]} */
  const entries = [];

  const dirs = [];
  await collectDirs(vfs, '', dirs);
  for (const d of dirs) entries.push({ path: d, type: 'directory' });

  const files = await vfs.listFiles();
  for (const f of files) {
    const bytes = await vfs.readFile(f);
    entries.push({ path: f, type: 'file', content: uint8ToBase64(bytes) });
  }
  return { files: entries };
}

/**
 * Restore a snapshot into a VFS instance.
 * @param {VfsSnapshot} snapshot
 * @param {object} [vfs] - target VFS; creates a new MemoryVfs when omitted
 * @returns {Promise<object>} the populated VFS
 */
export async function fromSnapshot(snapshot, vfs) {
  if (!vfs) {
    const { MemoryVfs } = await import('../../vfs/vfs.memory.js');
    vfs = new MemoryVfs();
  }

  const entries = assertSnapshotEntries(snapshot, 'snapshot');
  const sorted = [...entries].sort((a, b) => {
    const da = a.path.split('/').length;
    const db = b.path.split('/').length;
    if (da !== db) return da - db;
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return 0;
  });

  for (const entry of sorted) {
    if (entry.type === 'directory') {
      await vfs.mkdir(entry.path, { recursive: true });
    } else {
      await vfs.writeFile(entry.path, base64ToUint8(entry.content ?? ''));
    }
  }
  return vfs;
}

/**
 * Compare two snapshots and return the diff.
 * @param {VfsSnapshot} a
 * @param {VfsSnapshot} b
 * @returns {SnapshotDiff}
 */
export function diffSnapshots(a, b) {
  const entriesA = assertSnapshotEntries(a, 'snapshotA');
  const entriesB = assertSnapshotEntries(b, 'snapshotB');

  const filesA = new Map();
  for (const e of entriesA) filesA.set(e.path, { type: e.type, content: e.content ?? '' });
  const filesB = new Map();
  for (const e of entriesB) filesB.set(e.path, { type: e.type, content: e.content ?? '' });

  const added = [];
  const modified = [];
  const deleted = [];

  for (const [path, current] of filesB) {
    if (!filesA.has(path)) { added.push(path); continue; }
    const previous = filesA.get(path);
    if (!previous) continue;
    if (previous.type !== current.type) {
      modified.push(path);
      continue;
    }
    if (current.type === 'file' && previous.content !== current.content) {
      modified.push(path);
    }
  }
  for (const path of filesA.keys()) {
    if (!filesB.has(path)) deleted.push(path);
  }
  return { added, modified, deleted };
}
