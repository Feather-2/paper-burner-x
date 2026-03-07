import { normalizeVfsPath } from "../../../vfs/path.js";

/** @typedef {Error & { code?: string, path?: string }} FsError */

/**
 * @param {unknown} err
 * @returns {FsError}
 */
function asFsError(err) {
  return /** @type {FsError} */ (
    err instanceof Error ? err : new Error(String(err ?? ""))
  );
}

/**
 * @param {string} message
 * @param {string} code
 * @param {string} [path]
 * @returns {FsError}
 */
function createFsError(message, code, path) {
  const e = /** @type {FsError} */ (new Error(message));
  e.code = code;
  if (path !== undefined) e.path = path;
  return e;
}

/**
 * @param {unknown} err
 * @param {string} path
 * @returns {FsError}
 */
function makeErrno(err, path) {
  const msg = asFsError(err).message || "";
  const e = createFsError(msg, "ERR_FS", path);
  if (msg.includes("ENOENT")) e.code = "ENOENT";
  else if (msg.includes("EISDIR")) e.code = "EISDIR";
  else if (msg.includes("ENOTDIR")) e.code = "ENOTDIR";
  else if (msg.includes("EEXIST")) e.code = "EEXIST";
  else if (msg.includes("ENOTEMPTY")) e.code = "ENOTEMPTY";
  else e.code = "ERR_FS";
  e.path = path;
  return e;
}

const SYNC_ERR_MSG =
  "Sync fs API requires a VFS with synchronous internals (MemoryVfs). " +
  "For IndexedDB/OPFS backends, use async APIs (readFile, writeFile, etc.) instead.";

/** Convert data to Uint8Array (mirrors MemoryVfs.dataToBytes). */
function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new TextEncoder().encode(String(data ?? ""));
}

/** Assert vfs has internal tree API for sync access. */
function requireSyncVfs(vfs) {
  if (typeof vfs._getNode !== "function") throw new Error(SYNC_ERR_MSG);
}

class Dirent {
  /**
   * @param {string} name
   * @param {boolean} isDir
   */
  constructor(name, isDir) {
    this.name = name;
    this._isDir = isDir;
  }
  isFile() {
    return !this._isDir;
  }
  isDirectory() {
    return this._isDir;
  }
  isSymbolicLink() {
    return false;
  }
}

class Stats {
  /**
   * @param {number} size
   * @param {number} mtimeMs
   * @param {boolean} isDir
   */
  constructor(size, mtimeMs, isDir) {
    this.size = size;
    this.mtimeMs = mtimeMs;
    this.atimeMs = mtimeMs;
    this.ctimeMs = mtimeMs;
    this.birthtimeMs = mtimeMs;
    this.mode = isDir ? 0o40755 : 0o100644;
    this._isDir = isDir;
  }
  isFile() {
    return !this._isDir;
  }
  isDirectory() {
    return this._isDir;
  }
  isSymbolicLink() {
    return false;
  }
}

const F_OK = 0;
const R_OK = 4;
const W_OK = 2;
const X_OK = 1;

/**
 * Create a Node.js fs-compatible shim backed by a VFS instance.
 * @param {object} vfs - MemoryVfs instance
 * @param {{ protectedPaths?: string[], onViolation?: (info: object) => void }} [options]
 * @returns {object} Node.js fs compatible API
 */
export function createFsShim(vfs, options = {}) {
  const _protectedPaths = (options.protectedPaths || []).map((p) =>
    normalizeVfsPath(p).toLowerCase(),
  );
  const _onViolation = options.onViolation || null;

  function normPath(p) {
    return normalizeVfsPath(p);
  }

  /**
   * Check if a normalized path is protected (read-only).
   * Uses case-insensitive comparison to prevent bypass on macOS/Windows.
   * @param {string} normalizedPath
   * @returns {boolean}
   */
  function isProtected(normalizedPath) {
    const lc = normalizedPath.toLowerCase();
    for (const pp of _protectedPaths) {
      if (lc === pp || lc.startsWith(pp + "/")) return true;
    }
    return false;
  }

  /**
   * Throw EPERM for write operations on protected paths.
   * @param {string} normalizedPath
   * @param {string} op
   */
  function guardWrite(normalizedPath, op) {
    if (isProtected(normalizedPath)) {
      if (_onViolation) {
        _onViolation({ type: "fs:write", path: "/" + normalizedPath, op });
      }
      const e = /** @type {FsError} */ (
        new Error(`EPERM: operation not permitted, ${op} '/${normalizedPath}'`)
      );
      e.code = "EPERM";
      e.path = "/" + normalizedPath;
      throw e;
    }
  }

  // --- callback-style APIs ---

  function readFile(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const encoding = typeof options === "string" ? options : options?.encoding;
    const p = normPath(path);
    (encoding ? vfs.readText(p) : vfs.readFile(p))
      .then((data) => callback(null, data))
      .catch((err) => callback(makeErrno(err, p)));
  }

  function writeFile(path, data, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const p = normPath(path);
    try {
      guardWrite(p, "writeFile");
    } catch (e) {
      return callback(e);
    }
    vfs
      .writeFile(p, data)
      .then(() => callback(null))
      .catch((err) => callback(makeErrno(err, p)));
  }

  function appendFile(path, data, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const p = normPath(path);
    try {
      guardWrite(p, "appendFile");
    } catch (e) {
      return callback(e);
    }
    vfs
      .appendText(
        p,
        typeof data === "string" ? data : new TextDecoder().decode(data),
      )
      .then(() => callback(null))
      .catch((err) => callback(makeErrno(err, p)));
  }

  function stat(path, callback) {
    const p = normPath(path);
    vfs
      .stat(p)
      .then((s) =>
        callback(
          null,
          new Stats(s.size ?? 0, s.mtimeMs ?? Date.now(), s.isDirectory()),
        ),
      )
      .catch((err) => callback(makeErrno(err, p)));
  }

  function lstat(path, callback) {
    stat(path, callback);
  }

  function mkdir(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const recursive = typeof options === "object" ? !!options.recursive : false;
    const p = normPath(path);
    try {
      guardWrite(p, "mkdir");
    } catch (e) {
      return callback(e);
    }
    vfs
      .mkdir(p, { recursive })
      .then(() => callback(null))
      .catch((err) => callback(makeErrno(err, p)));
  }

  function readdir(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const withFileTypes =
      typeof options === "object" && !!options.withFileTypes;
    const p = normPath(path);
    vfs
      .readdir(p, { withFileTypes })
      .then((entries) => {
        if (withFileTypes) {
          const dirents = entries.map((e) => {
            if (typeof e === "string") return new Dirent(e, false);
            return new Dirent(e.name, e.isDirectory());
          });
          callback(null, dirents);
        } else {
          callback(null, entries);
        }
      })
      .catch((err) => callback(makeErrno(err, p)));
  }

  function unlink(path, callback) {
    const p = normPath(path);
    try {
      guardWrite(p, "unlink");
    } catch (e) {
      return callback(e);
    }
    vfs
      .unlink(p)
      .then(() => callback(null))
      .catch((err) => callback(makeErrno(err, p)));
  }

  function rmdir(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const recursive = typeof options === "object" ? !!options.recursive : false;
    const p = normPath(path);
    try {
      guardWrite(p, "rmdir");
    } catch (e) {
      return callback(e);
    }
    vfs
      .rmdir(p, { recursive })
      .then(() => callback(null))
      .catch((err) => callback(makeErrno(err, p)));
  }

  function rename(oldPath, newPath, callback) {
    const op = normPath(oldPath);
    const np = normPath(newPath);
    try {
      guardWrite(op, "rename");
      guardWrite(np, "rename");
    } catch (e) {
      return callback(e);
    }
    vfs
      .move(op, np)
      .then(() => callback(null))
      .catch((err) => callback(makeErrno(err, op)));
  }

  function copyFile(src, dest, callback) {
    const s = normPath(src);
    const d = normPath(dest);
    try {
      guardWrite(d, "copyFile");
    } catch (e) {
      return callback(e);
    }
    vfs
      .copy(s, d)
      .then(() => callback(null))
      .catch((err) => callback(makeErrno(err, s)));
  }

  function access(path, modeOrCallback, callback) {
    if (typeof modeOrCallback === "function") {
      callback = modeOrCallback;
    }
    const p = normPath(path);
    vfs
      .exists(p)
      .then((ok) => {
        if (ok) callback(null);
        else {
          const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
          e.code = "ENOENT";
          e.path = p;
          callback(e);
        }
      })
      .catch((err) => callback(makeErrno(err, p)));
  }

  function realpath(path, callback) {
    const p = normPath(path);
    const done = (ok) => {
      if (!ok) {
        const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
        e.code = "ENOENT";
        e.path = p;
        callback(e);
        return;
      }
      callback(null, "/" + p);
    };

    try {
      if (typeof vfs.exists === "function") {
        Promise.resolve(vfs.exists(p))
          .then((exists) => done(Boolean(exists)))
          .catch((err) => callback(makeErrno(err, p)));
        return;
      }
      if (typeof vfs._getNode === "function") {
        done(Boolean(vfs._getNode(p)));
        return;
      }
      done(false);
    } catch (err) {
      callback(makeErrno(err, String(path)));
    }
  }

  function existsSync(path) {
    const p = normPath(path);
    if (typeof vfs.existsSync === "function") {
      return !!vfs.existsSync(p);
    }
    if (typeof vfs._getNode === "function") {
      try {
        return !!vfs._getNode(p);
      } catch {
        return false;
      }
    }
    if (typeof vfs.exists === "function") {
      const maybe = vfs.exists(p);
      if (typeof maybe === "boolean") return maybe;
      if (maybe && typeof maybe.then === "function") {
        const e = /** @type {FsError} */ (new Error(SYNC_ERR_MSG));
        e.code = "ERR_FS_SYNC_UNAVAILABLE";
        throw e;
      }
      return !!maybe;
    }
    return false;
  }

  // --- sync APIs (direct tree access for MemoryVfs) ---

  function readFileSync(path, options) {
    requireSyncVfs(vfs);
    const encoding = typeof options === "string" ? options : options?.encoding;
    const p = normPath(path);
    const node = vfs._getNode(p);
    if (!node) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
      e.code = "ENOENT";
      e.path = p;
      throw e;
    }
    if (node.kind !== "file") {
      const e = /** @type {FsError} */ (new Error(`EISDIR: ${p}`));
      e.code = "EISDIR";
      e.path = p;
      throw e;
    }
    const bytes = new Uint8Array(node.bytes);
    return encoding ? new TextDecoder().decode(bytes) : bytes;
  }

  function writeFileSync(path, data) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    guardWrite(p, "writeFileSync");
    try {
      const info = vfs._getParentDirForPath(p, { create: true });
      if (!info?.parent) {
        const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
        e.code = "ENOENT";
        e.path = p;
        throw e;
      }
      const existing = info.parent.children.get(info.name);
      if (existing && existing.kind === "dir") {
        const e = /** @type {FsError} */ (new Error(`EISDIR: ${p}`));
        e.code = "EISDIR";
        e.path = p;
        throw e;
      }
      info.parent.children.set(info.name, {
        kind: "file",
        bytes: toBytes(data),
        updatedAt: Date.now(),
      });
      info.parent.updatedAt = Date.now();
    } catch (err) {
      throw asFsError(err).code ? err : makeErrno(err, p);
    }
  }

  function appendFileSync(path, data) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    guardWrite(p, "appendFileSync");
    let before = new Uint8Array(0);
    try {
      const node = vfs._getNode(p);
      if (node && node.kind === "file") before = node.bytes;
    } catch {
      /* ignore */
    }
    const extra = toBytes(
      typeof data === "string" ? data : new TextDecoder().decode(data),
    );
    const merged = new Uint8Array(before.length + extra.length);
    merged.set(before, 0);
    merged.set(extra, before.length);
    writeFileSync(p, merged);
  }

  function mkdirSync(path, options) {
    requireSyncVfs(vfs);
    const recursive = typeof options === "object" ? !!options.recursive : false;
    const p = normPath(path);
    guardWrite(p, "mkdirSync");
    try {
      if (recursive) {
        vfs._getDirNode(p, { create: true });
        return;
      }

      const parts = p.split("/").filter(Boolean);
      if (parts.length === 0) {
        const e = /** @type {FsError} */ (new Error(`EEXIST: ${p}`));
        e.code = "EEXIST";
        e.path = p;
        throw e;
      }

      const parentPath = parts.slice(0, -1).join("/");
      const name = parts[parts.length - 1];
      const parent = vfs._getDirNode(parentPath, { create: false });
      if (!parent) {
        const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
        e.code = "ENOENT";
        e.path = p;
        throw e;
      }

      const existing = parent.children.get(name);
      if (existing) {
        const e = /** @type {FsError} */ (new Error(`EEXIST: ${p}`));
        e.code = "EEXIST";
        e.path = p;
        throw e;
      }

      parent.children.set(name, {
        kind: "dir",
        children: new Map(),
        updatedAt: Date.now(),
      });
      parent.updatedAt = Date.now();
    } catch (err) {
      throw makeErrno(err, p);
    }
  }

  function readdirSync(path, options) {
    requireSyncVfs(vfs);
    const withFileTypes =
      typeof options === "object" && !!options.withFileTypes;
    const p = normPath(path);
    const node = vfs._getNode(p);
    if (!node) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
      e.code = "ENOENT";
      e.path = p;
      throw e;
    }
    if (node.kind !== "dir") {
      const e = /** @type {FsError} */ (new Error(`ENOTDIR: ${p}`));
      e.code = "ENOTDIR";
      e.path = p;
      throw e;
    }
    const entries = Array.from(node.children.entries())
      .map(([name, child]) => ({ name, isDir: child.kind === "dir" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (withFileTypes) return entries.map((e) => new Dirent(e.name, e.isDir));
    return entries.map((e) => e.name);
  }

  function statSync(path) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    const node = vfs._getNode(p);
    if (!node) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
      e.code = "ENOENT";
      e.path = p;
      throw e;
    }
    const isDir = node.kind === "dir";
    const size = isDir ? 0 : node.bytes ? node.bytes.byteLength : 0;
    return new Stats(size, node.updatedAt ?? Date.now(), isDir);
  }

  function lstatSync(path) {
    return statSync(path);
  }

  function unlinkSync(path) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    guardWrite(p, "unlinkSync");
    const parts = p.split("/").filter(Boolean);
    const parentPath = parts.slice(0, -1).join("/");
    const name = parts[parts.length - 1];
    const parent = vfs._getDirNode(parentPath, { create: false });
    if (!parent) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
      e.code = "ENOENT";
      e.path = p;
      throw e;
    }
    const node = parent.children.get(name);
    if (!node) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
      e.code = "ENOENT";
      e.path = p;
      throw e;
    }
    if (node.kind === "dir") {
      const e = /** @type {FsError} */ (new Error(`EISDIR: ${p}`));
      e.code = "EISDIR";
      e.path = p;
      throw e;
    }
    parent.children.delete(name);
    parent.updatedAt = Date.now();
  }

  function rmdirSync(path, options) {
    requireSyncVfs(vfs);
    const recursive = typeof options === "object" ? !!options.recursive : false;
    const p = normPath(path);
    guardWrite(p, "rmdirSync");
    const parts = p.split("/").filter(Boolean);
    if (!parts.length) throw new Error("EPERM: cannot remove root");
    const parentPath = parts.slice(0, -1).join("/");
    const name = parts[parts.length - 1];
    const parent = vfs._getDirNode(parentPath, { create: false });
    if (!parent) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
      e.code = "ENOENT";
      e.path = p;
      throw e;
    }
    const node = parent.children.get(name);
    if (!node) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
      e.code = "ENOENT";
      e.path = p;
      throw e;
    }
    if (node.kind !== "dir") {
      const e = /** @type {FsError} */ (new Error(`ENOTDIR: ${p}`));
      e.code = "ENOTDIR";
      e.path = p;
      throw e;
    }
    if (!recursive && node.children && node.children.size > 0) {
      const e = /** @type {FsError} */ (new Error(`ENOTEMPTY: ${p}`));
      e.code = "ENOTEMPTY";
      e.path = p;
      throw e;
    }
    parent.children.delete(name);
    parent.updatedAt = Date.now();
  }

  function renameSync(oldPath, newPath) {
    requireSyncVfs(vfs);
    const op = normPath(oldPath);
    const np = normPath(newPath);
    guardWrite(op, "renameSync");
    guardWrite(np, "renameSync");
    const oParts = op.split("/").filter(Boolean);
    const oParentPath = oParts.slice(0, -1).join("/");
    const oName = oParts[oParts.length - 1];
    const oParent = vfs._getDirNode(oParentPath, { create: false });
    if (!oParent) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${op}`));
      e.code = "ENOENT";
      e.path = op;
      throw e;
    }
    const node = oParent.children.get(oName);
    if (!node) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${op}`));
      e.code = "ENOENT";
      e.path = op;
      throw e;
    }
    const nParts = np.split("/").filter(Boolean);
    const nParentPath = nParts.slice(0, -1).join("/");
    const nName = nParts[nParts.length - 1];
    const nParent = vfs._getDirNode(nParentPath, { create: true });
    nParent.children.set(nName, node);
    nParent.updatedAt = Date.now();
    oParent.children.delete(oName);
    oParent.updatedAt = Date.now();
  }

  function copyFileSync(src, dest) {
    requireSyncVfs(vfs);
    const d = normPath(dest);
    guardWrite(d, "copyFileSync");
    const bytes = readFileSync(src);
    writeFileSync(
      dest,
      bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes),
    );
  }

  function accessSync(path) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    const node = vfs._getNode(p);
    if (!node) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
      e.code = "ENOENT";
      e.path = p;
      throw e;
    }
  }

  function realpathSync(path) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    const node = vfs._getNode(p);
    if (!node) {
      const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
      e.code = "ENOENT";
      e.path = p;
      throw e;
    }
    return "/" + p;
  }

  function rmSync(path, options) {
    requireSyncVfs(vfs);
    const recursive = typeof options === "object" ? !!options.recursive : false;
    const force = typeof options === "object" ? !!options.force : false;
    const p = normPath(path);
    try {
      const node = vfs._getNode(p, { followSymlinks: false });
      if (!node) {
        if (force) return;
        const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
        e.code = "ENOENT";
        e.path = p;
        throw e;
      }
      if (node.kind === "dir") {
        rmdirSync(p, { recursive });
      } else {
        unlinkSync(p);
      }
    } catch (err) {
      if (force && asFsError(err).code === "ENOENT") return;
      throw err;
    }
  }

  // --- fd operations ---

  const _fdTable = new Map();
  let _fdCounter = 10;

  /**
   * @param {string | undefined} flags
   */
  function parseOpenFlags(flags) {
    const f = flags == null ? "r" : String(flags);
    switch (f) {
      case "r":
        return {
          flags: f,
          readable: true,
          writable: false,
          create: false,
          truncate: false,
          append: false,
        };
      case "r+":
        return {
          flags: f,
          readable: true,
          writable: true,
          create: false,
          truncate: false,
          append: false,
        };
      case "w":
        return {
          flags: f,
          readable: false,
          writable: true,
          create: true,
          truncate: true,
          append: false,
        };
      case "w+":
        return {
          flags: f,
          readable: true,
          writable: true,
          create: true,
          truncate: true,
          append: false,
        };
      case "a":
        return {
          flags: f,
          readable: false,
          writable: true,
          create: true,
          truncate: false,
          append: true,
        };
      case "a+":
        return {
          flags: f,
          readable: true,
          writable: true,
          create: true,
          truncate: false,
          append: true,
        };
      default: {
        const e = /** @type {FsError} */ (
          new Error(`EINVAL: unsupported open flag '${f}'`)
        );
        e.code = "EINVAL";
        throw e;
      }
    }
  }

  function openSync(path, flags) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    const spec = parseOpenFlags(flags);
    const existing = vfs._getNode(p);
    if (!existing) {
      if (!spec.create) {
        const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
        e.code = "ENOENT";
        e.path = p;
        throw e;
      }
      writeFileSync(p, new Uint8Array(0));
    } else if (existing.kind === "dir") {
      const e = /** @type {FsError} */ (new Error(`EISDIR: ${p}`));
      e.code = "EISDIR";
      e.path = p;
      throw e;
    } else if (spec.truncate) {
      writeFileSync(p, new Uint8Array(0));
    }

    const initialBytes = /** @type {Uint8Array|string} */ (readFileSync(p));
    const fd = _fdCounter++;
    _fdTable.set(fd, {
      path: p,
      flags: spec.flags,
      readable: spec.readable,
      writable: spec.writable,
      append: spec.append,
      pos: spec.append
        ? initialBytes instanceof Uint8Array
          ? initialBytes.byteLength
          : initialBytes.length
        : 0,
    });
    return fd;
  }

  function closeSync(fd) {
    if (!_fdTable.has(fd)) throw new Error(`EBADF: bad file descriptor ${fd}`);
    _fdTable.delete(fd);
  }

  function readSync(fd, buffer, offset, length, position) {
    const entry = _fdTable.get(fd);
    if (!entry) throw new Error(`EBADF: bad file descriptor ${fd}`);
    if (!entry.readable) {
      const e = /** @type {FsError} */ (
        new Error(`EBADF: fd ${fd} is not readable`)
      );
      e.code = "EBADF";
      throw e;
    }
    const data = readFileSync(entry.path);
    const src =
      data instanceof Uint8Array
        ? data
        : new TextEncoder().encode(String(data));
    const off = Number.isFinite(offset) ? Math.max(0, Number(offset)) : 0;
    const len = Number.isFinite(length)
      ? Math.max(0, Number(length))
      : Math.max(0, buffer.length - off);
    const explicitPos = Number.isFinite(position)
      ? Math.max(0, Number(position))
      : null;
    const readPos = explicitPos == null ? entry.pos : explicitPos;
    const count = Math.min(len, Math.max(0, src.length - readPos));
    if (count <= 0) return 0;
    buffer.set(src.subarray(readPos, readPos + count), off);
    if (explicitPos == null) entry.pos = readPos + count;
    return count;
  }

  function writeSync(fd, buffer, offset, length, position) {
    const entry = _fdTable.get(fd);
    if (!entry) throw new Error(`EBADF: bad file descriptor ${fd}`);
    if (!entry.writable) {
      const e = /** @type {FsError} */ (
        new Error(`EBADF: fd ${fd} is not writable`)
      );
      e.code = "EBADF";
      throw e;
    }

    const current = readFileSync(entry.path);
    const source = current instanceof Uint8Array ? current : toBytes(current);

    let chunk;
    let explicitPosition = null;

    if (typeof buffer === "string") {
      chunk = toBytes(buffer);
      if (offset === null || Number.isFinite(offset)) {
        explicitPosition = offset == null ? null : Number(offset);
      }
    } else {
      const view = buffer instanceof Uint8Array ? buffer : toBytes(buffer);
      const off = Number.isFinite(offset) ? Math.max(0, Number(offset)) : 0;
      const len = Number.isFinite(length)
        ? Math.max(0, Number(length))
        : Math.max(0, view.byteLength - off);
      chunk = view.subarray(off, off + len);
      if (position === null || Number.isFinite(position)) {
        explicitPosition = position == null ? null : Number(position);
      }
    }

    const writePos = entry.append
      ? source.byteLength
      : explicitPosition == null
        ? entry.pos
        : Math.max(0, explicitPosition);
    const endPos = writePos + chunk.byteLength;
    const out = new Uint8Array(Math.max(source.byteLength, endPos));
    out.set(source, 0);
    out.set(chunk, writePos);
    writeFileSync(entry.path, out);

    if (entry.append || explicitPosition == null) {
      entry.pos = endPos;
    }
    return chunk.byteLength;
  }

  // --- createReadStream / createWriteStream ---

  function createReadStream(path, options) {
    const p = normPath(path);
    const opts = typeof options === "object" && options !== null ? options : {};
    const encoding = typeof options === "string" ? options : opts.encoding;
    const highWaterMark =
      Number.isFinite(opts.highWaterMark) && opts.highWaterMark > 0
        ? Math.floor(opts.highWaterMark)
        : 64 * 1024;
    const start = Number.isFinite(opts.start)
      ? Math.max(0, Math.floor(opts.start))
      : 0;
    const end = Number.isFinite(opts.end)
      ? Math.max(start, Math.floor(opts.end))
      : null;

    const listeners = {};
    let destroyed = false;
    let paused = false;
    let started = false;

    function on(evt, fn, once = false) {
      (listeners[evt] = listeners[evt] || []).push({ fn, once });
      if (evt === "data" && !started) {
        started = true;
        queueMicrotask(pump);
      }
      return stream;
    }

    function emit(evt, ...args) {
      const current = listeners[evt] || [];
      const next = [];
      for (const item of current) {
        try {
          item.fn(...args);
        } catch {
          /* ignore listener errors */
        }
        if (!item.once) next.push(item);
      }
      listeners[evt] = next;
    }

    let bytes = null;
    let cursor = 0;

    const pump = async () => {
      if (destroyed) return;
      try {
        if (!bytes) {
          const raw = await vfs.readFile(p);
          const src = raw instanceof Uint8Array ? raw : toBytes(raw);
          const endExclusive =
            end == null ? src.byteLength : Math.min(src.byteLength, end + 1);
          bytes = src.subarray(start, endExclusive);
        }

        const pushNext = () => {
          if (destroyed) return;
          if (paused) {
            queueMicrotask(pushNext);
            return;
          }
          if (cursor >= bytes.byteLength) {
            emit("end");
            emit("close");
            return;
          }
          const chunk = bytes.subarray(
            cursor,
            Math.min(bytes.byteLength, cursor + highWaterMark),
          );
          cursor += chunk.byteLength;
          emit("data", encoding ? new TextDecoder().decode(chunk) : chunk);
          queueMicrotask(pushNext);
        };

        pushNext();
      } catch (err) {
        emit("error", makeErrno(err, p));
      }
    };

    const stream = {
      on(evt, fn) {
        return on(evt, fn, false);
      },
      once(evt, fn) {
        return on(evt, fn, true);
      },
      emit,
      pipe(dest) {
        stream.on("data", (chunk) => {
          if (dest.write) dest.write(chunk);
        });
        stream.on("end", () => {
          if (dest.end) dest.end();
        });
        return dest;
      },
      pause() {
        paused = true;
        return stream;
      },
      resume() {
        paused = false;
        if (!started) {
          started = true;
          queueMicrotask(pump);
        }
        return stream;
      },
      destroy(err) {
        if (destroyed) return stream;
        destroyed = true;
        if (err) emit("error", err);
        emit("close");
        return stream;
      },
    };

    if (!started) queueMicrotask(pump);
    return stream;
  }

  function createWriteStream(path) {
    const p = normPath(path);
    const chunks = [];
    const listeners = {};
    const stream = {
      on(evt, fn) {
        (listeners[evt] = listeners[evt] || []).push(fn);
        return stream;
      },
      once(evt, fn) {
        stream.on(evt, fn);
        return stream;
      },
      emit(evt, ...args) {
        (listeners[evt] || []).forEach((fn) => fn(...args));
      },
      write(chunk) {
        chunks.push(
          typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
        );
        return true;
      },
      end(chunk) {
        if (chunk) stream.write(chunk);
        vfs
          .writeFile(p, chunks.join(""))
          .then(() => {
            stream.emit("finish");
            stream.emit("close");
          })
          .catch((err) => stream.emit("error", makeErrno(err, p)));
      },
      destroy() {
        stream.emit("close");
      },
    };
    return stream;
  }

  // --- watch ---

  function watch(path, options, listener) {
    if (typeof options === "function") {
      listener = options;
      options = {};
    }

    const p = normPath(path);
    if (typeof vfs.watch !== "function") {
      const e = /** @type {FsError} */ (
        new Error(
          `ENOSYS: fs.watch is not supported by current VFS backend (${vfs?.constructor?.name || "unknown"})`,
        )
      );
      e.code = "ENOSYS";
      e.path = p;
      throw e;
    }

    const listeners = {};
    const watcher = {
      on(evt, fn) {
        (listeners[evt] = listeners[evt] || []).push(fn);
        return watcher;
      },
      once(evt, fn) {
        const wrap = (...args) => {
          watcher.off(evt, wrap);
          fn(...args);
        };
        return watcher.on(evt, wrap);
      },
      off(evt, fn) {
        const list = listeners[evt] || [];
        listeners[evt] = list.filter((item) => item !== fn);
        return watcher;
      },
      emit(evt, ...args) {
        (listeners[evt] || []).forEach((fn) => fn(...args));
      },
      close() {
        if (typeof unsubscribe === "function") unsubscribe();
        else if (unsubscribe && typeof unsubscribe.close === "function")
          unsubscribe.close();
        watcher.emit("close");
      },
    };

    if (typeof listener === "function") watcher.on("change", listener);
    const unsubscribe = vfs.watch(p, options || {}, (...args) =>
      watcher.emit("change", ...args),
    );
    return watcher;
  }

  // --- promises API ---

  const promises = {
    async readFile(path, options) {
      const encoding =
        typeof options === "string" ? options : options?.encoding;
      const p = normPath(path);
      try {
        return encoding ? await vfs.readText(p) : await vfs.readFile(p);
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async writeFile(path, data) {
      const p = normPath(path);
      guardWrite(p, "writeFile");
      try {
        await vfs.writeFile(p, data);
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async appendFile(path, data) {
      const p = normPath(path);
      guardWrite(p, "appendFile");
      try {
        await vfs.appendText(
          p,
          typeof data === "string" ? data : new TextDecoder().decode(data),
        );
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async stat(path) {
      const p = normPath(path);
      try {
        const s = await vfs.stat(p);
        return new Stats(s.size ?? 0, s.mtimeMs ?? Date.now(), s.isDirectory());
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async lstat(path) {
      return promises.stat(path);
    },
    async mkdir(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : false;
      const p = normPath(path);
      guardWrite(p, "mkdir");
      try {
        await vfs.mkdir(p, { recursive });
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async readdir(path, options) {
      const withFileTypes =
        typeof options === "object" && !!options.withFileTypes;
      const p = normPath(path);
      try {
        const entries = await vfs.readdir(p, { withFileTypes });
        if (withFileTypes) {
          return entries.map((e) => {
            if (typeof e === "string") return new Dirent(e, false);
            return new Dirent(e.name, e.isDirectory());
          });
        }
        return entries;
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async unlink(path) {
      const p = normPath(path);
      guardWrite(p, "unlink");
      try {
        await vfs.unlink(p);
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async rmdir(path, options) {
      const recursive =
        typeof options === "object" ? !!options.recursive : false;
      const p = normPath(path);
      guardWrite(p, "rmdir");
      try {
        await vfs.rmdir(p, { recursive });
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async rename(oldPath, newPath) {
      const op = normPath(oldPath);
      const np = normPath(newPath);
      guardWrite(op, "rename");
      guardWrite(np, "rename");
      try {
        await vfs.move(op, np);
      } catch (err) {
        throw makeErrno(err, op);
      }
    },
    async copyFile(src, dest) {
      const s = normPath(src);
      const d = normPath(dest);
      guardWrite(d, "copyFile");
      try {
        await vfs.copy(s, d);
      } catch (err) {
        throw makeErrno(err, s);
      }
    },
    async access(path) {
      const p = normPath(path);
      const ok = await vfs.exists(p);
      if (!ok) {
        const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
        e.code = "ENOENT";
        e.path = p;
        throw e;
      }
    },
    async realpath(path) {
      const p = normPath(path);
      const ok =
        typeof vfs.exists === "function"
          ? await vfs.exists(p)
          : typeof vfs._getNode === "function"
            ? !!vfs._getNode(p)
            : false;
      if (!ok) {
        const e = /** @type {FsError} */ (new Error(`ENOENT: ${p}`));
        e.code = "ENOENT";
        e.path = p;
        throw e;
      }
      return "/" + p;
    },
  };

  const constants = { F_OK, R_OK, W_OK, X_OK };

  return {
    readFile,
    writeFile,
    appendFile,
    stat,
    lstat,
    mkdir,
    readdir,
    unlink,
    rmdir,
    rename,
    copyFile,
    access,
    realpath,
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
    readdirSync,
    statSync,
    lstatSync,
    unlinkSync,
    rmdirSync,
    renameSync,
    copyFileSync,
    accessSync,
    realpathSync,
    appendFileSync,
    rmSync,
    openSync,
    closeSync,
    readSync,
    writeSync,
    createReadStream,
    createWriteStream,
    watch,
    promises,
    constants,
    Dirent,
    Stats,
  };
}
