import { normalizeVfsPath } from '../../vfs/path.js';

/**
 * @typedef {object} VfsAdapterOptions
 * @property {object} vfs - MemoryVfs instance
 */

/**
 * @param {number} mtimeMs
 * @returns {{ mode: number, atime: Date, ctime: Date, birthtime: Date, mtime: Date }}
 */
function extraStatFields(mtimeMs) {
  const d = new Date(mtimeMs);
  return { mode: 0o666, atime: d, ctime: d, birthtime: d, mtime: d };
}

/**
 * Recursively copy a directory from src to dest using the vfs.
 * @param {object} vfs
 * @param {string} src
 * @param {string} dest
 */
async function cpRecursive(vfs, src, dest) {
  const entries = await vfs.readdir(src, { withFileTypes: true });
  await vfs.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const srcChild = src ? `${src}/${entry.name}` : entry.name;
    const destChild = dest ? `${dest}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await cpRecursive(vfs, srcChild, destChild);
    } else {
      await vfs.copy(srcChild, destChild);
    }
  }
}

/**
 * Create an IFileSystem adapter that bridges to MemoryVfs.
 * @param {VfsAdapterOptions} options
 * @returns {object} IFileSystem-compatible object
 */
export function createVfsAdapter(options) {
  const { vfs } = options;

  return {
    async readFile(path, encoding) {
      const p = normalizeVfsPath(path);
      if (encoding === 'utf8' || encoding === 'utf-8') {
        return vfs.readText(p);
      }
      return vfs.readFile(p);
    },

    async writeFile(path, data) {
      const p = normalizeVfsPath(path);
      if (typeof data === 'string') {
        return vfs.writeText(p, data);
      }
      return vfs.writeFile(p, data);
    },

    async appendFile(path, data) {
      const p = normalizeVfsPath(path);
      return vfs.appendText(p, String(data ?? ''));
    },

    async stat(path) {
      const p = normalizeVfsPath(path);
      const s = await vfs.stat(p);
      return { ...s, ...extraStatFields(s.mtimeMs) };
    },

    async lstat(path) {
      const p = normalizeVfsPath(path);
      const s = await vfs.stat(p);
      return { ...s, ...extraStatFields(s.mtimeMs) };
    },

    async mkdir(path, opts) {
      const p = normalizeVfsPath(path);
      return vfs.mkdir(p, opts);
    },

    async readdir(path, opts) {
      const p = normalizeVfsPath(path);
      return vfs.readdir(p, opts);
    },

    async rm(path, opts) {
      const p = normalizeVfsPath(path);
      if (opts && opts.recursive) {
        return vfs.rmdir(p, { recursive: true });
      }
      return vfs.unlink(p);
    },

    async cp(src, dest, opts) {
      const s = normalizeVfsPath(src);
      const d = normalizeVfsPath(dest);
      if (opts && opts.recursive) {
        await cpRecursive(vfs, s, d);
        return true;
      }
      return vfs.copy(s, d);
    },

    async mv(src, dest) {
      const s = normalizeVfsPath(src);
      const d = normalizeVfsPath(dest);
      return vfs.move(s, d);
    },

    async chmod(_path, _mode) {
      // no-op: VFS does not support permissions
    },

    async symlink(target, path) {
      const p = normalizeVfsPath(path);
      return vfs.writeText(p, target);
    },

    async link(existing, newPath) {
      const e = normalizeVfsPath(existing);
      const n = normalizeVfsPath(newPath);
      return vfs.copy(e, n);
    },

    async readlink(path) {
      const p = normalizeVfsPath(path);
      return vfs.readText(p);
    },

    async realpath(path) {
      return normalizeVfsPath(path);
    },

    async utimes(_path, _atime, _mtime) {
      // no-op: VFS does not support explicit time updates
    },

    async getAllPaths(prefix) {
      return vfs.listFiles({ prefix: prefix || '', recursive: true });
    },
  };
}
