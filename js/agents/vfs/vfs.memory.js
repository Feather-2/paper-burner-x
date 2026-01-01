import { normalizeVfsPath } from "./path.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

export class MemoryVfs {
  constructor() {
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

  async readFile(path) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    const node = this._getNode(p);
    if (!node) throw new Error(`ENOENT: ${p}`);
    if (node.kind !== "file") throw new Error(`EISDIR: ${p}`);
    return new Uint8Array(node.bytes);
  }

  async readText(path) {
    const bytes = await this.readFile(path);
    return bytesToText(bytes);
  }

  async writeFile(path, data) {
    const { parent, name, fullPath } = this._getParentDirForPath(path, { create: true });
    if (!parent) throw new Error(`ENOENT: ${fullPath}`);
    const existing = parent.children.get(name);
    if (existing && existing.kind === "dir") throw new Error(`EISDIR: ${fullPath}`);
    parent.children.set(name, new FileNode(data));
    parent.updatedAt = Date.now();
    return true;
  }

  async writeText(path, text) {
    return this.writeFile(path, text);
  }

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

  async mkdir(path, { recursive = true } = {}) {
    const p = normalizeVfsPath(path);
    if (!p) return true;

    const wantRecursive = recursive !== false;
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
}

export default MemoryVfs;
