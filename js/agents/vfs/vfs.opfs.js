import { normalizeVfsPath, dirnameVfsPath, basenameVfsPath } from "./path.js";

/**
 * @typedef {object} VfsStat
 * @property {number} size
 * @property {number=} mtimeMs
 * @property {() => boolean} isFile
 * @property {() => boolean} isDirectory
 */

/**
 * @typedef {object} VfsDirent
 * @property {string} name
 * @property {() => boolean} isDirectory
 * @property {() => boolean} isFile
 */

/**
 * @typedef {object} ReaddirOptions
 * @property {boolean=} withFileTypes
 */

/**
 * @typedef {object} MkdirOptions
 * @property {boolean=} recursive
 */

/**
 * @typedef {object} RmdirOptions
 * @property {boolean=} recursive
 */

/**
 * @typedef {object} ListFilesOptions
 * @property {string=} prefix
 * @property {boolean=} recursive
 */

/**
 * @typedef {object} WalkFilesOptions
 * @property {string=} prefix
 * @property {boolean=} recursive
 */

/**
 * @param {unknown} entry
 * @returns {entry is VfsDirent}
 */
function isVfsDirent(entry) {
  if (!entry || typeof entry !== "object") return false;
  const candidate = /** @type {{ name?: unknown, isDirectory?: unknown, isFile?: unknown }} */ (entry);
  return (
    typeof candidate.name === "string" &&
    typeof candidate.isDirectory === "function" &&
    typeof candidate.isFile === "function"
  );
}

function isOpfsAvailable() {
  return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

function makeDirent(name, kind) {
  return {
    name,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
  };
}

async function getDirHandle(root, dirPath, { create = false } = {}) {
  const p = normalizeVfsPath(dirPath);
  let handle = root;
  if (!p) return handle;
  for (const segment of p.split("/")) {
    if (segment === "..") {
      throw new Error("Invalid path segment '..'");
    }
    handle = await handle.getDirectoryHandle(segment, { create });
  }
  return handle;
}

async function ensureParentDir(root, filePath) {
  const parent = dirnameVfsPath(filePath);
  return getDirHandle(root, parent, { create: true });
}

async function getFileHandle(root, filePath, { create = false } = {}) {
  const p = normalizeVfsPath(filePath);
  const parent = await getDirHandle(root, dirnameVfsPath(p), { create });
  return parent.getFileHandle(basenameVfsPath(p), { create });
}

function dataToWritableChunk(data) {
  if (data === null || data === undefined) return new Uint8Array(0);
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return String(data);
}

/** @type {Map<string, Promise<any>>} */
const _fallbackLocks = new Map();

/**
 * @template T
 * @param {string[]} lockPaths
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
async function withOpfsPathLocks(lockPaths, task) {
  const paths = Array.from(
    new Set(
      (Array.isArray(lockPaths) ? lockPaths : [])
        .map((p) => normalizeVfsPath(p))
        .filter((p) => !!p)
    )
  ).sort((a, b) => a.localeCompare(b));

  if (!paths.length) return task();

  // Use Web Locks API when available
  if (typeof navigator !== "undefined" && typeof navigator?.locks?.request === "function") {
    const run = async (index) => {
      if (index >= paths.length) return task();
      return navigator.locks.request(paths[index], { mode: "exclusive" }, async () => run(index + 1));
    };
    return run(0);
  }

  // Fallback: promise-chain mutex (single-tab concurrency control)
  const acquire = (index) => {
    if (index >= paths.length) return task();
    const key = paths[index];
    const prev = _fallbackLocks.get(key) || Promise.resolve();
    let resolve;
    const next = new Promise((r) => { resolve = r; });
    _fallbackLocks.set(key, next);
    return prev.then(() => acquire(index + 1)).finally(resolve);
  };
  return acquire(0);
}

/**
 * @param {FileSystemDirectoryHandle} root
 * @param {string} filePath
 * @param {unknown} data
 * @param {{ append?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
async function writeOpfsFile(root, filePath, data, { append = false } = {}) {
  await ensureParentDir(root, filePath);
  const handle = await getFileHandle(root, filePath, { create: true });
  const writable = append ? await handle.createWritable({ keepExistingData: true }) : await handle.createWritable();
  try {
    if (append) {
      const file = await handle.getFile();
      await writable.seek(file.size);
    }
    await writable.write(dataToWritableChunk(data));
  } finally {
    await writable.close();
  }
  return true;
}

/**
 * OPFS-backed VFS implementation (browser-only).
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {OpfsVfs}
 */
export class OpfsVfs {
  /**
   * @param {FileSystemDirectoryHandle} rootHandle
   */
  constructor(rootHandle) {
    this._root = rootHandle;
  }

  /**
   * @param {{ rootDirName?: string }} [options]
   * @returns {Promise<OpfsVfs>}
   */
  static async create({ rootDirName = "paper-burner-workspace" } = {}) {
    if (!isOpfsAvailable()) throw new Error("OPFS not available");
    const root = await navigator.storage.getDirectory();
    const base = rootDirName ? await root.getDirectoryHandle(String(rootDirName), { create: true }) : root;
    return new OpfsVfs(base);
  }

  /**
   * @param {string} path
   * @returns {Promise<Uint8Array>}
   */
  async readFile(path) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    try {
      const handle = await getFileHandle(this._root, p, { create: false });
      const file = await handle.getFile();
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf);
    } catch (err) {
      if (err?.name === "NotFoundError") throw new Error(`ENOENT: ${p}`);
      if (err?.name === "TypeMismatchError") throw new Error(`EISDIR: ${p}`);
      throw err;
    }
  }

  /**
   * @param {string} path
   * @returns {Promise<string>}
   */
  async readText(path) {
    const bytes = await this.readFile(path);
    return new TextDecoder().decode(bytes);
  }

  /**
   * @param {string} path
   * @param {unknown} data
   * @returns {Promise<boolean>}
   */
  async writeFile(path, data) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    return withOpfsPathLocks([p], async () => {
      try {
        return await writeOpfsFile(this._root, p, data);
      } catch (err) {
        if (err?.name === "TypeMismatchError") throw new Error(`EISDIR: ${p}`);
        throw err;
      }
    });
  }

  /**
   * @param {string} path
   * @param {unknown} data
   * @returns {Promise<boolean>}
   */
  async appendFile(path, data) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    return withOpfsPathLocks([p], async () => {
      try {
        return await writeOpfsFile(this._root, p, data, { append: true });
      } catch (err) {
        if (err?.name === "TypeMismatchError") throw new Error(`EISDIR: ${p}`);
        throw err;
      }
    });
  }

  /**
   * @param {string} path
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async writeText(path, text) {
    return this.writeFile(path, typeof text === "string" ? text : String(text ?? ""));
  }

  /**
   * @param {string} path
   * @param {MkdirOptions} [options]
   * @returns {Promise<boolean>}
   */
  async mkdir(path, { recursive = true } = {}) {
    const p = normalizeVfsPath(path);
    if (!p) return true;
    const wantRecursive = recursive !== false;
    if (wantRecursive) {
      await getDirHandle(this._root, p, { create: true });
      return true;
    }
    const parent = await getDirHandle(this._root, dirnameVfsPath(p), { create: false });
    await parent.getDirectoryHandle(basenameVfsPath(p), { create: true });
    return true;
  }

  /**
   * @param {string} path
   * @param {RmdirOptions} [options]
   * @returns {Promise<boolean>}
   */
  async rmdir(path, { recursive = false } = {}) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EPERM: cannot remove root");
    try {
      const parent = await getDirHandle(this._root, dirnameVfsPath(p), { create: false });
      await parent.removeEntry(basenameVfsPath(p), { recursive: !!recursive });
    } catch (err) {
      if (err?.name === "NotFoundError") throw new Error(`ENOENT: ${p}`);
      throw err;
    }
    return true;
  }

  /**
   * @param {string} path
   * @returns {Promise<boolean>}
   */
  async unlink(path) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    try {
      const parent = await getDirHandle(this._root, dirnameVfsPath(p), { create: false });
      await parent.removeEntry(basenameVfsPath(p));
    } catch (err) {
      if (err?.name === "NotFoundError") throw new Error(`ENOENT: ${p}`);
      throw err;
    }
    return true;
  }

  /**
   * @param {string} path
   * @returns {Promise<VfsStat>}
   */
  async stat(path) {
    const p = normalizeVfsPath(path);
    if (!p) {
      return { size: 0, isFile: () => false, isDirectory: () => true };
    }
    try {
      const handle = await getFileHandle(this._root, p, { create: false });
      const file = await handle.getFile();
      return {
        size: file.size,
        mtimeMs: typeof file.lastModified === "number" ? file.lastModified : undefined,
        isFile: () => true,
        isDirectory: () => false,
      };
    } catch (err) {
      if (err?.name !== "NotFoundError" && err?.name !== "TypeMismatchError") throw err;
      try {
        const dir = await getDirHandle(this._root, p, { create: false });
        if (dir) return { size: 0, isFile: () => false, isDirectory: () => true };
      } catch (dirErr) {
        if (dirErr?.name !== "NotFoundError") throw dirErr;
      }
      throw new Error(`ENOENT: ${p}`);
    }
  }

  /**
   * @param {string} path
   * @param {ReaddirOptions} [options]
   * @returns {Promise<string[] | VfsDirent[]>}
   */
  async readdir(path, options = {}) {
    const p = normalizeVfsPath(path);
    const withFileTypes = !!options.withFileTypes;
    let dir;
    try {
      dir = await getDirHandle(this._root, p, { create: false });
    } catch (err) {
      if (err?.name === "NotFoundError") throw new Error(`ENOENT: ${p}`);
      if (err?.name === "TypeMismatchError") throw new Error(`ENOTDIR: ${p}`);
      throw err;
    }

    const entries = [];
    for await (const [name, handle] of dir.entries()) {
      const kind = handle.kind === "directory" ? "directory" : "file";
      entries.push(withFileTypes ? makeDirent(name, kind) : name);
    }
    entries.sort((a, b) => {
      const an = typeof a === "string" ? a : a.name;
      const bn = typeof b === "string" ? b : b.name;
      return an.localeCompare(bn);
    });
    return entries;
  }

  /**
   * Legacy compatibility helper used by some runtimes.
   * @param {string} path
   * @returns {Promise<Array<{ name: string, kind: "file" | "dir" }>>}
   */
  async list(path) {
    const dirents = await this.readdir(path, { withFileTypes: true });
    if (!Array.isArray(dirents)) return [];
    return dirents
      .filter(isVfsDirent)
      .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? "dir" : "file" }));
  }

  /**
   * @param {string} path
   * @returns {Promise<boolean>}
   */
  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} src
   * @param {string} dest
   * @returns {Promise<boolean>}
   */
  async copy(src, dest) {
    const s = normalizeVfsPath(src);
    const d = normalizeVfsPath(dest);
    return withOpfsPathLocks([s, d], async () => {
      const bytes = await this.readFile(s);
      if (bytes == null) throw new Error(`ENOENT: ${s}`);
      await this.writeFile(d, bytes);
      return true;
    });
  }

  /**
   * @param {string} src
   * @param {string} dest
   * @returns {Promise<boolean>}
   */
  async move(src, dest) {
    const s = normalizeVfsPath(src);
    const d = normalizeVfsPath(dest);
    return withOpfsPathLocks([s, d], async () => {
      const bytes = await this.readFile(s);
      if (bytes == null) throw new Error(`ENOENT: ${s}`);
      await this.writeFile(d, bytes);
      await this.unlink(s);
      return true;
    });
  }

  /**
   * @param {string} src
   * @param {string} dest
   * @returns {Promise<boolean>}
   */
  async rename(src, dest) {
    const s = normalizeVfsPath(src);
    const d = normalizeVfsPath(dest);
    if (!s) throw new Error("EISDIR: /");
    if (!d) throw new Error("EISDIR: /");
    return withOpfsPathLocks([s, d], async () => {
      if (s === d) {
        await this.stat(s);
        return true;
      }
      const bytes = await this.readFile(s);
      try {
        await writeOpfsFile(this._root, d, bytes);
      } catch (err) {
        if (err?.name === "TypeMismatchError") throw new Error(`EISDIR: ${d}`);
        throw err;
      }
      try {
        const sourceParent = await getDirHandle(this._root, dirnameVfsPath(s), { create: false });
        await sourceParent.removeEntry(basenameVfsPath(s));
      } catch (err) {
        if (err?.name === "NotFoundError") throw new Error(`ENOENT: ${s}`);
        throw err;
      }
      return true;
    });
  }

  /**
   * @param {string} path
   * @param {RmdirOptions} [options]
   * @returns {Promise<boolean>}
   */
  async remove(path, { recursive = false } = {}) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EPERM: cannot remove root");
    return withOpfsPathLocks([p], async () => {
      const st = await this.stat(p);
      if (st?.isDirectory?.()) return this.rmdir(p, { recursive });
      return this.unlink(p);
    });
  }

  /**
   * @param {string} path
   * @param {RmdirOptions} [options]
   * @returns {Promise<boolean>}
   */
  async rm(path, options = {}) {
    return this.remove(path, options);
  }

  /**
   * @param {ListFilesOptions} [options]
   * @returns {Promise<string[]>}
   */
  async listFiles({ prefix = "", recursive = true } = {}) {
    const base = normalizeVfsPath(prefix);
    const startDir = await getDirHandle(this._root, base, { create: false });
    const out = [];

    const walk = async (dirHandle, dirPath) => {
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === "directory") {
          if (recursive) {
            const nextPath = dirPath ? `${dirPath}/${name}` : name;
            await walk(handle, nextPath);
          }
          continue;
        }
        out.push(dirPath ? `${dirPath}/${name}` : name);
      }
    };

    await walk(startDir, base);
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }

  /**
   * @param {WalkFilesOptions} [options]
   * @returns {AsyncGenerator<string, void, void>}
   */
  async *walkFiles({ prefix = "", recursive = true } = {}) {
    const base = normalizeVfsPath(prefix);

    try {
      const st = await this.stat(base);
      if (st?.isFile?.()) {
        yield base;
        return;
      }
    } catch {
      return;
    }

    const startDir = await getDirHandle(this._root, base, { create: false });

    const walk = async function* (dirHandle, dirPath) {
      const entries = [];
      for await (const [name, handle] of dirHandle.entries()) {
        entries.push([name, handle]);
      }
      entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

      for (const [name, handle] of entries) {
        if (handle.kind === "directory") {
          if (recursive) {
            const nextPath = dirPath ? `${dirPath}/${name}` : name;
            yield* walk(handle, nextPath);
          }
          continue;
        }
        yield dirPath ? `${dirPath}/${name}` : name;
      }
    };

    yield* walk(startDir, base);
  }

  /** @param {string} _target  @param {string} _linkPath */
  async symlink(_target, _linkPath) {
    throw new Error("symlink() not supported by OpfsVfs backend");
  }

  /** @param {string} _linkPath */
  async readlink(_linkPath) {
    throw new Error("readlink() not supported by OpfsVfs backend");
  }

  /** @param {string} path */
  async lstat(path) {
    return this.stat(path);
  }
}

/**
 * @param {unknown} [unused]
 * @returns {boolean}
 */
export function supportsOpfs(unused) {
  void unused;
  return isOpfsAvailable();
}

export default OpfsVfs;
