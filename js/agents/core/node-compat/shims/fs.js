import { normalizeVfsPath } from '../../../vfs/path.js';

/**
 * @param {Error} err
 * @param {string} path
 * @returns {Error & { code: string, path: string }}
 */
function makeErrno(err, path) {
  const msg = err.message || '';
  const e = new Error(msg);
  if (msg.includes('ENOENT')) e.code = 'ENOENT';
  else if (msg.includes('EISDIR')) e.code = 'EISDIR';
  else if (msg.includes('ENOTDIR')) e.code = 'ENOTDIR';
  else if (msg.includes('EEXIST')) e.code = 'EEXIST';
  else if (msg.includes('ENOTEMPTY')) e.code = 'ENOTEMPTY';
  else e.code = 'ERR_FS';
  e.path = path;
  return e;
}

const SYNC_ERR_MSG = 'Sync fs API requires a VFS with synchronous internals (MemoryVfs). ' +
  'For IndexedDB/OPFS backends, use async APIs (readFile, writeFile, etc.) instead.';

/** Convert data to Uint8Array (mirrors MemoryVfs.dataToBytes). */
function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new TextEncoder().encode(String(data ?? ''));
}

/** Assert vfs has internal tree API for sync access. */
function requireSyncVfs(vfs) {
  if (typeof vfs._getNode !== 'function') throw new Error(SYNC_ERR_MSG);
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
  isFile() { return !this._isDir; }
  isDirectory() { return this._isDir; }
  isSymbolicLink() { return false; }
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
  isFile() { return !this._isDir; }
  isDirectory() { return this._isDir; }
  isSymbolicLink() { return false; }
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
  const _protectedPaths = (options.protectedPaths || []).map(p => normalizeVfsPath(p).toLowerCase());
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
      if (lc === pp || lc.startsWith(pp + '/')) return true;
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
        _onViolation({ type: 'fs:write', path: '/' + normalizedPath, op });
      }
      const e = new Error(`EPERM: operation not permitted, ${op} '/${normalizedPath}'`);
      e.code = 'EPERM';
      e.path = '/' + normalizedPath;
      throw e;
    }
  }

  // --- callback-style APIs ---

  function readFile(path, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const encoding = typeof options === 'string' ? options : options?.encoding;
    const p = normPath(path);
    (encoding ? vfs.readText(p) : vfs.readFile(p))
      .then(data => callback(null, data))
      .catch(err => callback(makeErrno(err, p)));
  }

  function writeFile(path, data, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const p = normPath(path);
    try { guardWrite(p, 'writeFile'); } catch (e) { return callback(e); }
    vfs.writeFile(p, data)
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, p)));
  }

  function appendFile(path, data, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const p = normPath(path);
    try { guardWrite(p, 'appendFile'); } catch (e) { return callback(e); }
    vfs.appendText(p, typeof data === 'string' ? data : new TextDecoder().decode(data))
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, p)));
  }

  function stat(path, callback) {
    const p = normPath(path);
    vfs.stat(p)
      .then(s => callback(null, new Stats(s.size ?? 0, s.mtimeMs ?? Date.now(), s.isDirectory())))
      .catch(err => callback(makeErrno(err, p)));
  }

  function lstat(path, callback) {
    stat(path, callback);
  }

  function mkdir(path, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const recursive = typeof options === 'object' ? !!options.recursive : false;
    const p = normPath(path);
    try { guardWrite(p, 'mkdir'); } catch (e) { return callback(e); }
    vfs.mkdir(p, { recursive })
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, p)));
  }

  function readdir(path, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const withFileTypes = typeof options === 'object' && !!options.withFileTypes;
    const p = normPath(path);
    vfs.readdir(p, { withFileTypes })
      .then(entries => {
        if (withFileTypes) {
          const dirents = entries.map(e => {
            if (typeof e === 'string') return new Dirent(e, false);
            return new Dirent(e.name, e.isDirectory());
          });
          callback(null, dirents);
        } else {
          callback(null, entries);
        }
      })
      .catch(err => callback(makeErrno(err, p)));
  }

  function unlink(path, callback) {
    const p = normPath(path);
    try { guardWrite(p, 'unlink'); } catch (e) { return callback(e); }
    vfs.unlink(p)
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, p)));
  }

  function rmdir(path, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const recursive = typeof options === 'object' ? !!options.recursive : false;
    const p = normPath(path);
    try { guardWrite(p, 'rmdir'); } catch (e) { return callback(e); }
    vfs.rmdir(p, { recursive })
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, p)));
  }

  function rename(oldPath, newPath, callback) {
    const op = normPath(oldPath);
    const np = normPath(newPath);
    try { guardWrite(op, 'rename'); guardWrite(np, 'rename'); } catch (e) { return callback(e); }
    vfs.move(op, np)
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, op)));
  }

  function copyFile(src, dest, callback) {
    const s = normPath(src);
    const d = normPath(dest);
    try { guardWrite(d, 'copyFile'); } catch (e) { return callback(e); }
    vfs.copy(s, d)
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, s)));
  }

  function access(path, modeOrCallback, callback) {
    if (typeof modeOrCallback === 'function') { callback = modeOrCallback; }
    const p = normPath(path);
    vfs.exists(p)
      .then(ok => {
        if (ok) callback(null);
        else {
          const e = new Error(`ENOENT: ${p}`);
          e.code = 'ENOENT';
          e.path = p;
          callback(e);
        }
      })
      .catch(err => callback(makeErrno(err, p)));
  }

  function realpath(path, callback) {
    try {
      const p = normPath(path);
      callback(null, '/' + p);
    } catch (err) {
      callback(makeErrno(err, String(path)));
    }
  }

  function existsSync(path) {
    try {
      const p = normPath(path);
      return !!vfs._getNode(p);
    } catch {
      return false;
    }
  }

  // --- sync APIs (direct tree access for MemoryVfs) ---

  function readFileSync(path, options) {
    requireSyncVfs(vfs);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    const p = normPath(path);
    const node = vfs._getNode(p);
    if (!node) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; e.path = p; throw e; }
    if (node.kind !== 'file') { const e = new Error(`EISDIR: ${p}`); e.code = 'EISDIR'; e.path = p; throw e; }
    const bytes = new Uint8Array(node.bytes);
    return encoding ? new TextDecoder().decode(bytes) : bytes;
  }

  function writeFileSync(path, data) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    guardWrite(p, 'writeFileSync');
    try {
      const info = vfs._getParentDirForPath(p, { create: true });
      if (!info?.parent) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; e.path = p; throw e; }
      const existing = info.parent.children.get(info.name);
      if (existing && existing.kind === 'dir') { const e = new Error(`EISDIR: ${p}`); e.code = 'EISDIR'; e.path = p; throw e; }
      info.parent.children.set(info.name, { kind: 'file', bytes: toBytes(data), updatedAt: Date.now() });
      info.parent.updatedAt = Date.now();
    } catch (err) {
      throw err.code ? err : makeErrno(err, p);
    }
  }

  function appendFileSync(path, data) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    guardWrite(p, 'appendFileSync');
    let before = new Uint8Array(0);
    try {
      const node = vfs._getNode(p);
      if (node && node.kind === 'file') before = node.bytes;
    } catch { /* ignore */ }
    const extra = toBytes(typeof data === 'string' ? data : new TextDecoder().decode(data));
    const merged = new Uint8Array(before.length + extra.length);
    merged.set(before, 0);
    merged.set(extra, before.length);
    writeFileSync(p, merged);
  }

  function mkdirSync(path, options) {
    requireSyncVfs(vfs);
    const recursive = typeof options === 'object' ? !!options.recursive : false;
    const p = normPath(path);
    guardWrite(p, 'mkdirSync');
    try {
      if (recursive) {
        vfs._getDirNode(p, { create: true });
        return;
      }

      const parts = p.split('/').filter(Boolean);
      if (parts.length === 0) {
        const e = new Error(`EEXIST: ${p}`);
        e.code = 'EEXIST';
        e.path = p;
        throw e;
      }

      const parentPath = parts.slice(0, -1).join('/');
      const name = parts[parts.length - 1];
      const parent = vfs._getDirNode(parentPath, { create: false });
      if (!parent) {
        const e = new Error(`ENOENT: ${p}`);
        e.code = 'ENOENT';
        e.path = p;
        throw e;
      }

      const existing = parent.children.get(name);
      if (existing) {
        const e = new Error(`EEXIST: ${p}`);
        e.code = 'EEXIST';
        e.path = p;
        throw e;
      }

      parent.children.set(name, { kind: 'dir', children: new Map(), updatedAt: Date.now() });
      parent.updatedAt = Date.now();
    } catch (err) {
      throw makeErrno(err, p);
    }
  }

  function readdirSync(path, options) {
    requireSyncVfs(vfs);
    const withFileTypes = typeof options === 'object' && !!options.withFileTypes;
    const p = normPath(path);
    const node = vfs._getNode(p);
    if (!node) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; e.path = p; throw e; }
    if (node.kind !== 'dir') { const e = new Error(`ENOTDIR: ${p}`); e.code = 'ENOTDIR'; e.path = p; throw e; }
    const entries = Array.from(node.children.entries())
      .map(([name, child]) => ({ name, isDir: child.kind === 'dir' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (withFileTypes) return entries.map(e => new Dirent(e.name, e.isDir));
    return entries.map(e => e.name);
  }

  function statSync(path) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    const node = vfs._getNode(p);
    if (!node) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; e.path = p; throw e; }
    const isDir = node.kind === 'dir';
    const size = isDir ? 0 : (node.bytes ? node.bytes.byteLength : 0);
    return new Stats(size, node.updatedAt ?? Date.now(), isDir);
  }

  function lstatSync(path) {
    return statSync(path);
  }

  function unlinkSync(path) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    guardWrite(p, 'unlinkSync');
    const parts = p.split('/').filter(Boolean);
    const parentPath = parts.slice(0, -1).join('/');
    const name = parts[parts.length - 1];
    const parent = vfs._getDirNode(parentPath, { create: false });
    if (!parent) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; e.path = p; throw e; }
    const node = parent.children.get(name);
    if (!node) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; e.path = p; throw e; }
    if (node.kind !== 'file') { const e = new Error(`EISDIR: ${p}`); e.code = 'EISDIR'; e.path = p; throw e; }
    parent.children.delete(name);
    parent.updatedAt = Date.now();
  }

  function rmdirSync(path, options) {
    requireSyncVfs(vfs);
    const recursive = typeof options === 'object' ? !!options.recursive : false;
    const p = normPath(path);
    guardWrite(p, 'rmdirSync');
    const parts = p.split('/').filter(Boolean);
    if (!parts.length) throw new Error('EPERM: cannot remove root');
    const parentPath = parts.slice(0, -1).join('/');
    const name = parts[parts.length - 1];
    const parent = vfs._getDirNode(parentPath, { create: false });
    if (!parent) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; e.path = p; throw e; }
    const node = parent.children.get(name);
    if (!node) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; e.path = p; throw e; }
    if (node.kind !== 'dir') { const e = new Error(`ENOTDIR: ${p}`); e.code = 'ENOTDIR'; e.path = p; throw e; }
    if (!recursive && node.children && node.children.size > 0) { const e = new Error(`ENOTEMPTY: ${p}`); e.code = 'ENOTEMPTY'; e.path = p; throw e; }
    parent.children.delete(name);
    parent.updatedAt = Date.now();
  }

  function renameSync(oldPath, newPath) {
    requireSyncVfs(vfs);
    const op = normPath(oldPath);
    const np = normPath(newPath);
    guardWrite(op, 'renameSync');
    guardWrite(np, 'renameSync');
    const oParts = op.split('/').filter(Boolean);
    const oParentPath = oParts.slice(0, -1).join('/');
    const oName = oParts[oParts.length - 1];
    const oParent = vfs._getDirNode(oParentPath, { create: false });
    if (!oParent) { const e = new Error(`ENOENT: ${op}`); e.code = 'ENOENT'; e.path = op; throw e; }
    const node = oParent.children.get(oName);
    if (!node) { const e = new Error(`ENOENT: ${op}`); e.code = 'ENOENT'; e.path = op; throw e; }
    const nParts = np.split('/').filter(Boolean);
    const nParentPath = nParts.slice(0, -1).join('/');
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
    guardWrite(d, 'copyFileSync');
    const bytes = readFileSync(src);
    writeFileSync(dest, new Uint8Array(bytes));
  }

  function accessSync(path) {
    requireSyncVfs(vfs);
    const p = normPath(path);
    const node = vfs._getNode(p);
    if (!node) {
      const e = new Error(`ENOENT: ${p}`);
      e.code = 'ENOENT';
      e.path = p;
      throw e;
    }
  }

  function realpathSync(path) {
    const p = normPath(path);
    return '/' + p;
  }

  function rmSync(path, options) {
    const recursive = typeof options === 'object' ? !!options.recursive : false;
    const force = typeof options === 'object' ? !!options.force : false;
    try {
      rmdirSync(path, { recursive });
    } catch (err) {
      if (force && err.code === 'ENOENT') return;
      throw err;
    }
  }

  // --- fd operations ---

  const _fdTable = new Map();
  let _fdCounter = 10;

  function openSync(path, flags) {
    const p = normPath(path);
    const fd = _fdCounter++;
    _fdTable.set(fd, { path: p, flags: flags || 'r', pos: 0 });
    return fd;
  }

  function closeSync(fd) {
    if (!_fdTable.has(fd)) throw new Error(`EBADF: bad file descriptor ${fd}`);
    _fdTable.delete(fd);
  }

  function readSync(fd, buffer, offset, length) {
    const entry = _fdTable.get(fd);
    if (!entry) throw new Error(`EBADF: bad file descriptor ${fd}`);
    const data = readFileSync(entry.path);
    const src = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const count = Math.min(length, src.length - entry.pos);
    if (count <= 0) return 0;
    buffer.set(src.subarray(entry.pos, entry.pos + count), offset);
    entry.pos += count;
    return count;
  }

  function writeSync(fd, buffer, offset, length) {
    const entry = _fdTable.get(fd);
    if (!entry) throw new Error(`EBADF: bad file descriptor ${fd}`);
    const chunk = typeof buffer === 'string'
      ? buffer
      : buffer.subarray(offset || 0, (offset || 0) + (length || buffer.length));
    writeFileSync(entry.path, chunk);
    return typeof chunk === 'string' ? chunk.length : chunk.byteLength;
  }

  // --- createReadStream / createWriteStream ---

  function createReadStream(path, options) {
    const p = normPath(path);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    const listeners = {};
    const stream = {
      on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return stream; },
      once(evt, fn) { stream.on(evt, fn); return stream; },
      emit(evt, ...args) { (listeners[evt] || []).forEach(fn => fn(...args)); },
      pipe(dest) {
        stream.on('data', chunk => { if (dest.write) dest.write(chunk); });
        stream.on('end', () => { if (dest.end) dest.end(); });
        return dest;
      },
      destroy() { stream.emit('close'); },
    };
    (encoding ? vfs.readText(p) : vfs.readFile(p))
      .then(data => { stream.emit('data', data); stream.emit('end'); stream.emit('close'); })
      .catch(err => stream.emit('error', makeErrno(err, p)));
    return stream;
  }

  function createWriteStream(path) {
    const p = normPath(path);
    const chunks = [];
    const listeners = {};
    const stream = {
      on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return stream; },
      once(evt, fn) { stream.on(evt, fn); return stream; },
      emit(evt, ...args) { (listeners[evt] || []).forEach(fn => fn(...args)); },
      write(chunk) { chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)); return true; },
      end(chunk) {
        if (chunk) stream.write(chunk);
        vfs.writeFile(p, chunks.join(''))
          .then(() => { stream.emit('finish'); stream.emit('close'); })
          .catch(err => stream.emit('error', makeErrno(err, p)));
      },
      destroy() { stream.emit('close'); },
    };
    return stream;
  }

  // --- watch ---

  function watch(path) {
    const listeners = {};
    return {
      on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return this; },
      once(evt, fn) { this.on(evt, fn); return this; },
      emit(evt, ...args) { (listeners[evt] || []).forEach(fn => fn(...args)); },
      close() { this.emit('close'); },
    };
  }

  // --- promises API ---

  const promises = {
    async readFile(path, options) {
      const encoding = typeof options === 'string' ? options : options?.encoding;
      const p = normPath(path);
      try {
        return encoding ? await vfs.readText(p) : await vfs.readFile(p);
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async writeFile(path, data) {
      const p = normPath(path);
      guardWrite(p, 'writeFile');
      try {
        await vfs.writeFile(p, data);
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async appendFile(path, data) {
      const p = normPath(path);
      guardWrite(p, 'appendFile');
      try {
        await vfs.appendText(p, typeof data === 'string' ? data : new TextDecoder().decode(data));
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
      const recursive = typeof options === 'object' ? !!options.recursive : false;
      const p = normPath(path);
      guardWrite(p, 'mkdir');
      try {
        await vfs.mkdir(p, { recursive });
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async readdir(path, options) {
      const withFileTypes = typeof options === 'object' && !!options.withFileTypes;
      const p = normPath(path);
      try {
        const entries = await vfs.readdir(p, { withFileTypes });
        if (withFileTypes) {
          return entries.map(e => {
            if (typeof e === 'string') return new Dirent(e, false);
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
      guardWrite(p, 'unlink');
      try {
        await vfs.unlink(p);
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async rmdir(path, options) {
      const recursive = typeof options === 'object' ? !!options.recursive : false;
      const p = normPath(path);
      guardWrite(p, 'rmdir');
      try {
        await vfs.rmdir(p, { recursive });
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async rename(oldPath, newPath) {
      const op = normPath(oldPath);
      const np = normPath(newPath);
      guardWrite(op, 'rename');
      guardWrite(np, 'rename');
      try {
        await vfs.move(op, np);
      } catch (err) {
        throw makeErrno(err, op);
      }
    },
    async copyFile(src, dest) {
      const s = normPath(src);
      const d = normPath(dest);
      guardWrite(d, 'copyFile');
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
        const e = new Error(`ENOENT: ${p}`);
        e.code = 'ENOENT';
        e.path = p;
        throw e;
      }
    },
    async realpath(path) {
      const p = normPath(path);
      return '/' + p;
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
