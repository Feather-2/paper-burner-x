import { normalizeVfsPath } from "./path.js";

import { isPlainObject } from "../shared/utils/value-utils.js";

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

function dataToBytes(data) {
  if (data === null || data === undefined) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (isPlainObject(data) || Array.isArray(data)) return new TextEncoder().encode(JSON.stringify(data));
  return new TextEncoder().encode(String(data));
}

function bytesToText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : dataToBytes(bytes);
  return new TextDecoder().decode(b);
}

function makeDirent(entry) {
  return {
    name: entry.name,
    isDirectory: () => entry.kind === "dir",
    isFile: () => entry.kind === "file",
  };
}

class DirNode {
  constructor() {
    this.kind = "dir";
    this.children = new Map(); // name -> DirNode|FileNode
    this.updatedAt = Date.now();
  }
}

class FileNode {
  constructor(bytes) {
    this.kind = "file";
    this.bytes = bytes instanceof Uint8Array ? bytes : dataToBytes(bytes);
    this.updatedAt = Date.now();
  }
}

function toSegments(path) {
  const p = typeof path === "string" ? path : "";
  if (!p) return [];
  return p.split("/").filter(Boolean);
}

/**
 * In-memory VFS implementation (browser-safe).
 *
 * @param {object} [options]
 * @returns {MemoryVfs}
 */
export class MemoryVfs {
  /**
   * @param {object} [options]
   */
  constructor(options) {
    void options;
    this._root = new DirNode();
  }

  _getDirNode(dirPath, { create = false } = {}) {
    const p = normalizeVfsPath(dirPath);
    const parts = toSegments(p);
    let node = this._root;
    for (const name of parts) {
      const next = node.children.get(name);
      if (!next) {
        if (!create) return null;
        const child = new DirNode();
        node.children.set(name, child);
        node.updatedAt = Date.now();
        node = child;
        continue;
      }
      if (next.kind !== "dir") {
        throw new Error(`ENOTDIR: ${p}`);
      }
      node = next;
    }
    return node;
  }

  _getNode(path) {
    const p = normalizeVfsPath(path);
    if (!p) return this._root;
    const parts = toSegments(p);
    let node = this._root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const next = node.children.get(name);
      if (!next) return null;
      if (i === parts.length - 1) return next;
      if (next.kind !== "dir") throw new Error(`ENOTDIR: ${p}`);
      node = next;
    }
    return node;
  }

  _getParentDirForPath(path, { create = false } = {}) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    const parts = toSegments(p);
    const parentParts = parts.slice(0, -1);
    const parentPath = parentParts.join("/");
    const parent = this._getDirNode(parentPath, { create });
    return { parent, name: parts[parts.length - 1], parentPath, fullPath: p };
  }

  /**
   * @param {string} path
   * @returns {Promise<Uint8Array>}
   */
  async readFile(path) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    const node = this._getNode(p);
    if (!node) throw new Error(`ENOENT: ${p}`);
    if (node.kind !== "file") throw new Error(`EISDIR: ${p}`);
    return new Uint8Array(node.bytes);
  }

  /**
   * @param {string} path
   * @returns {Promise<string>}
   */
  async readText(path) {
    const bytes = await this.readFile(path);
    return bytesToText(bytes);
  }

  /**
   * @param {string} path
   * @param {unknown} data
   * @returns {Promise<boolean>}
   */
  async writeFile(path, data) {
    const { parent, name, fullPath } = this._getParentDirForPath(path, { create: true });
    if (!parent) throw new Error(`ENOENT: ${fullPath}`);
    const existing = parent.children.get(name);
    if (existing && existing.kind === "dir") throw new Error(`EISDIR: ${fullPath}`);
    parent.children.set(name, new FileNode(data));
    parent.updatedAt = Date.now();
    return true;
  }

  /**
   * @param {string} path
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async writeText(path, text) {
    return this.writeFile(path, text);
  }

  /**
   * @param {string} path
   * @returns {Promise<VfsStat>}
   */
  async stat(path) {
    const p = normalizeVfsPath(path);
    if (!p) {
      return {
        size: 0,
        mtimeMs: this._root.updatedAt,
        isFile: () => false,
        isDirectory: () => true,
      };
    }
    const node = this._getNode(p);
    if (!node) throw new Error(`ENOENT: ${p}`);
    if (node.kind === "file") {
      return {
        size: node.bytes.byteLength,
        mtimeMs: node.updatedAt,
        isFile: () => true,
        isDirectory: () => false,
      };
    }

    return { size: 0, mtimeMs: node.updatedAt, isFile: () => false, isDirectory: () => true };
  }

  /**
   * @param {string} path
   * @param {ReaddirOptions} [options]
   * @returns {Promise<string[] | VfsDirent[]>}
   */
  async readdir(path, options = {}) {
    const p = normalizeVfsPath(path);
    const withFileTypes = !!options.withFileTypes;
    const node = this._getNode(p);
    if (!node) throw new Error(`ENOENT: ${p}`);
    if (node.kind !== "dir") throw new Error(`ENOTDIR: ${p}`);

    const entries = Array.from(node.children.entries())
      .map(([name, child]) => ({ name, kind: child.kind === "dir" ? "dir" : "file" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!withFileTypes) return entries.map((e) => e.name);
    return entries.map(makeDirent);
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
      .filter((e) => e && typeof e === "object" && typeof e.name === "string")
      .map((e) => ({ name: e.name, kind: e.isDirectory?.() ? "dir" : "file" }));
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
    const existing = this._getNode(p);
    if (existing) {
      if (!wantRecursive) throw new Error(`EEXIST: ${p}`);
      if (existing.kind !== "dir") throw new Error(`EEXIST: ${p}`);
      return true;
    }
    const parts = toSegments(p);

    let node = this._root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const next = node.children.get(name);
      if (next) {
        if (next.kind !== "dir") throw new Error(`EEXIST: ${p}`);
        node = next;
        continue;
      }

      if (!wantRecursive && i !== parts.length - 1) {
        throw new Error(`ENOENT: ${p}`);
      }

      const child = new DirNode();
      node.children.set(name, child);
      node.updatedAt = Date.now();
      node = child;
    }

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

    const parts = toSegments(p);
    const parentPath = parts.slice(0, -1).join("/");
    const name = parts[parts.length - 1];
    const parent = this._getDirNode(parentPath, { create: false });
    if (!parent) throw new Error(`ENOENT: ${p}`);
    const node = parent.children.get(name);
    if (!node) throw new Error(`ENOENT: ${p}`);
    if (node.kind !== "dir") throw new Error(`ENOTDIR: ${p}`);

    if (!recursive && node.children.size > 0) throw new Error(`ENOTEMPTY: ${p}`);

    parent.children.delete(name);
    parent.updatedAt = Date.now();
    return true;
  }

  /**
   * @param {string} path
   * @returns {Promise<boolean>}
   */
  async unlink(path) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");

    const parts = toSegments(p);
    const parentPath = parts.slice(0, -1).join("/");
    const name = parts[parts.length - 1];
    const parent = this._getDirNode(parentPath, { create: false });
    if (!parent) throw new Error(`ENOENT: ${p}`);
    const node = parent.children.get(name);
    if (!node) throw new Error(`ENOENT: ${p}`);
    if (node.kind !== "file") throw new Error(`EISDIR: ${p}`);

    parent.children.delete(name);
    parent.updatedAt = Date.now();
    return true;
  }

  /**
   * @param {ListFilesOptions} [options]
   * @returns {Promise<string[]>}
   */
  async listFiles({ prefix = "", recursive = true } = {}) {
    const pfx = normalizeVfsPath(prefix);
    const node = this._getNode(pfx);
    if (!node) return [];

    if (node.kind === "file") return [pfx];

    const out = [];
    const walk = (dirNode, basePath) => {
      for (const [name, child] of dirNode.children.entries()) {
        const nextPath = basePath ? `${basePath}/${name}` : name;
        if (child.kind === "dir") {
          if (recursive) walk(child, nextPath);
          continue;
        }
        out.push(nextPath);
      }
    };

    walk(node, pfx);
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }

  /**
   * @param {WalkFilesOptions} [options]
   * @returns {AsyncGenerator<string, void, void>}
   */
  async *walkFiles({ prefix = "", recursive = true } = {}) {
    const pfx = normalizeVfsPath(prefix);
    const node = this._getNode(pfx);
    if (!node) return;

    if (node.kind === "file") {
      yield pfx;
      return;
    }

    const walk = async function* (dirNode, basePath) {
      const entries = Array.from(dirNode.children.entries()).sort(([a], [b]) => a.localeCompare(b));
      for (const [name, child] of entries) {
        const nextPath = basePath ? `${basePath}/${name}` : name;
        if (child.kind === "dir") {
          if (recursive) yield* walk(child, nextPath);
          continue;
        }
        yield nextPath;
      }
    };

    yield* walk(node, pfx);
  }

  /**
   * @param {string} path
   * @returns {Promise<boolean>}
   */
  async exists(path) {
    const p = normalizeVfsPath(path);
    if (!p) return true;
    try {
      return !!this._getNode(p);
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
    if (!s) throw new Error("EISDIR: /");
    if (!d) throw new Error("EISDIR: /");
    const bytes = await this.readFile(s);
    await this.writeFile(d, bytes);
    return true;
  }

  /**
   * @param {string} src
   * @param {string} dest
   * @returns {Promise<boolean>}
   */
  async move(src, dest) {
    const s = normalizeVfsPath(src);
    const d = normalizeVfsPath(dest);
    if (!s) throw new Error("EISDIR: /");
    if (!d) throw new Error("EISDIR: /");

    const srcInfo = this._getParentDirForPath(s, { create: false });
    if (!srcInfo?.parent) throw new Error(`ENOENT: ${s}`);
    const node = srcInfo.parent.children.get(srcInfo.name);
    if (!node) throw new Error(`ENOENT: ${s}`);

    const dstInfo = this._getParentDirForPath(d, { create: true });
    if (!dstInfo?.parent) throw new Error(`ENOENT: ${d}`);

    const existing = dstInfo.parent.children.get(dstInfo.name);
    if (existing && existing.kind === "dir" && node.kind === "file") throw new Error(`EISDIR: ${d}`);

    dstInfo.parent.children.set(dstInfo.name, node);
    dstInfo.parent.updatedAt = Date.now();

    srcInfo.parent.children.delete(srcInfo.name);
    srcInfo.parent.updatedAt = Date.now();
    return true;
  }

  /**
   * @param {string} path
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async appendText(path, text) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    let before = "";
    try {
      const node = this._getNode(p);
      if (node && node.kind === "dir") throw new Error(`EISDIR: ${p}`);
      before = node ? await this.readText(p) : "";
    } catch (err) {
      const msg = String(err?.message || err);
      if (!msg.includes("ENOENT")) throw err;
      before = "";
    }
    await this.writeText(p, before + String(text ?? ""));
    return true;
  }
}

export default MemoryVfs;
