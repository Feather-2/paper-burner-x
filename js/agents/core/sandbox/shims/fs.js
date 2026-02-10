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

const SYNC_ERR_MSG = 'Sync fs API not available in browser sandbox. Use fs.promises instead.';

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
 * @returns {object} Node.js fs compatible API
 */
export function createFsShim(vfs) {

  function normPath(p) {
    return normalizeVfsPath(p);
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
    vfs.writeFile(p, data)
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, p)));
  }

  function appendFile(path, data, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const p = normPath(path);
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
    vfs.unlink(p)
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, p)));
  }

  function rmdir(path, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const recursive = typeof options === 'object' ? !!options.recursive : false;
    const p = normPath(path);
    vfs.rmdir(p, { recursive })
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, p)));
  }

  function rename(oldPath, newPath, callback) {
    const op = normPath(oldPath);
    const np = normPath(newPath);
    vfs.move(op, np)
      .then(() => callback(null))
      .catch(err => callback(makeErrno(err, op)));
  }

  function copyFile(src, dest, callback) {
    const s = normPath(src);
    const d = normPath(dest);
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

  // --- sync stubs ---

  function readFileSync() { throw new Error(SYNC_ERR_MSG); }
  function writeFileSync() { throw new Error(SYNC_ERR_MSG); }
  function mkdirSync() { throw new Error(SYNC_ERR_MSG); }
  function readdirSync() { throw new Error(SYNC_ERR_MSG); }
  function statSync() { throw new Error(SYNC_ERR_MSG); }
  function lstatSync() { throw new Error(SYNC_ERR_MSG); }
  function unlinkSync() { throw new Error(SYNC_ERR_MSG); }
  function rmdirSync() { throw new Error(SYNC_ERR_MSG); }
  function renameSync() { throw new Error(SYNC_ERR_MSG); }
  function copyFileSync() { throw new Error(SYNC_ERR_MSG); }
  function accessSync() { throw new Error(SYNC_ERR_MSG); }
  function realpathSync() { throw new Error(SYNC_ERR_MSG); }
  function appendFileSync() { throw new Error(SYNC_ERR_MSG); }

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
      try {
        await vfs.writeFile(p, data);
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async appendFile(path, data) {
      const p = normPath(path);
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
      try {
        await vfs.unlink(p);
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async rmdir(path, options) {
      const recursive = typeof options === 'object' ? !!options.recursive : false;
      const p = normPath(path);
      try {
        await vfs.rmdir(p, { recursive });
      } catch (err) {
        throw makeErrno(err, p);
      }
    },
    async rename(oldPath, newPath) {
      const op = normPath(oldPath);
      const np = normPath(newPath);
      try {
        await vfs.move(op, np);
      } catch (err) {
        throw makeErrno(err, op);
      }
    },
    async copyFile(src, dest) {
      const s = normPath(src);
      const d = normPath(dest);
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
    promises,
    constants,
    Dirent,
    Stats,
  };
}
