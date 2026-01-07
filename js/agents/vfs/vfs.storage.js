import { normalizeVfsPath, dirnameVfsPath } from "./path.js";

import { isPlainObject } from "../shared/utils/value-utils.js";

/** @type {any} */
const NodeBuffer = /** @type {any} */ (globalThis).Buffer;

function makeDirent(name, kind) {
  return {
    name,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
  };
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

function bytesToBase64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : dataToBytes(bytes);

  // Node
  if (NodeBuffer && typeof NodeBuffer.from === "function") {
    return NodeBuffer.from(b).toString("base64");
  }

  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < b.length; i += chunkSize) {
      const sub = b.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...sub);
    }
    return btoa(binary);
  }

  throw new Error("StorageVfs: base64 encoding is unavailable");
}

function base64ToBytes(base64) {
  const s = typeof base64 === "string" ? base64 : "";
  if (!s) return new Uint8Array(0);

  // Node
  if (NodeBuffer && typeof NodeBuffer.from === "function") {
    return new Uint8Array(NodeBuffer.from(s, "base64"));
  }

  if (typeof atob === "function") {
    const cleaned = s.replace(/\s+/g, "");
    const bin = atob(cleaned);
    const out = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
    return out;
  }

  throw new Error("StorageVfs: base64 decoding is unavailable");
}

function ensureStorageAdapter(adapter) {
  const a = adapter && typeof adapter === "object" ? adapter : null;
  if (!a || typeof a.get !== "function" || typeof a.set !== "function" || typeof a.delete !== "function" || typeof a.keys !== "function") {
    throw new TypeError("StorageVfs: storageAdapter with get/set/delete/keys is required");
  }
  return a;
}

function joinPath(a, b) {
  if (!a) return b;
  if (!b) return a;
  return `${a}/${b}`;
}

function pathStartsWith(path, prefix) {
  if (!prefix) return true;
  if (path === prefix) return true;
  return path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

export class StorageVfs {
  constructor(storageAdapter, { keyPrefix = "pb_vfs:" } = {}) {
    this._store = ensureStorageAdapter(storageAdapter);
    // Public handle for integrations (e.g., checkpoint persistence fallback).
    this.storageAdapter = this._store;
    const p = typeof keyPrefix === "string" && keyPrefix ? keyPrefix : "pb_vfs:";
    this._filePrefix = `${p}file:`;
    this._dirPrefix = `${p}dir:`;
  }

  _fileKey(path) {
    return `${this._filePrefix}${path}`;
  }

  _dirKey(path) {
    return `${this._dirPrefix}${path}`;
  }

  async _getFileRecord(path) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    const rec = await this._store.get(this._fileKey(p));
    return rec && typeof rec === "object" ? rec : null;
  }

  async _getDirRecord(path) {
    const p = normalizeVfsPath(path);
    if (!p) return { kind: "dir", mtimeMs: Date.now() };
    const rec = await this._store.get(this._dirKey(p));
    return rec && typeof rec === "object" ? rec : null;
  }

  async _ensureDir(path) {
    const p = normalizeVfsPath(path);
    if (!p) return true;

    const parts = p.split("/").filter(Boolean);
    let cur = "";
    for (const seg of parts) {
      cur = joinPath(cur, seg);
      const key = this._dirKey(cur);
      const exists = await this._store.has?.(key);
      if (exists) continue;
      await this._store.set(key, { kind: "dir", path: cur, mtimeMs: Date.now() });
    }
    return true;
  }

  async readFile(path) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    const rec = await this._getFileRecord(p);
    if (!rec) throw new Error(`ENOENT: ${p}`);
    if (rec.kind && rec.kind !== "file") throw new Error(`EISDIR: ${p}`);

    if (rec.encoding === "utf8") {
      return new TextEncoder().encode(String(rec.data || ""));
    }
    if (rec.encoding === "base64") {
      return base64ToBytes(String(rec.data || ""));
    }
    // Fallback: best-effort decode
    return base64ToBytes(String(rec.data || ""));
  }

  async readText(path) {
    const bytes = await this.readFile(path);
    return bytesToText(bytes);
  }

  async writeFile(path, data) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    await this._ensureDir(dirnameVfsPath(p));

    const bytes =
      typeof Blob !== "undefined" && data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : dataToBytes(data);
    const key = this._fileKey(p);
    await this._store.set(key, {
      kind: "file",
      path: p,
      encoding: "base64",
      data: bytesToBase64(bytes),
      size: bytes.byteLength,
      mtimeMs: Date.now(),
    });
    return true;
  }

  async writeText(path, text) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    await this._ensureDir(dirnameVfsPath(p));

    const content = typeof text === "string" ? text : String(text ?? "");
    const bytes = new TextEncoder().encode(content);
    await this._store.set(this._fileKey(p), {
      kind: "file",
      path: p,
      encoding: "utf8",
      data: content,
      size: bytes.byteLength,
      mtimeMs: Date.now(),
    });
    return true;
  }

  async mkdir(path, { recursive = true } = {}) {
    const p = normalizeVfsPath(path);
    if (!p) return true;
    const wantRecursive = recursive !== false;

    if (!wantRecursive) {
      const parent = dirnameVfsPath(p);
      if (parent) {
        const parentRec = await this._getDirRecord(parent);
        if (!parentRec) throw new Error(`ENOENT: ${p}`);
      }
    }

    await this._ensureDir(p);
    return true;
  }

  async rmdir(path, { recursive = false } = {}) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EPERM: cannot remove root");

    const entries = await this.readdir(p, { withFileTypes: true });
    if (!recursive && entries.length) throw new Error(`ENOTEMPTY: ${p}`);

    const allKeys = await this._store.keys();
    const filePrefix = this._filePrefix;
    const dirPrefix = this._dirPrefix;
    for (const key of allKeys) {
      const k = String(key || "");
      if (!k) continue;
      if (k.startsWith(filePrefix)) {
        const fp = k.slice(filePrefix.length);
        if (pathStartsWith(fp, p)) await this._store.delete(k);
        continue;
      }
      if (k.startsWith(dirPrefix)) {
        const dp = k.slice(dirPrefix.length);
        if (dp === p || pathStartsWith(dp, p)) await this._store.delete(k);
      }
    }
    return true;
  }

  async unlink(path) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    const deleted = await this._store.delete(this._fileKey(p));
    if (!deleted) throw new Error(`ENOENT: ${p}`);
    return true;
  }

  async stat(path) {
    const p = normalizeVfsPath(path);
    if (!p) {
      return { size: 0, mtimeMs: Date.now(), isFile: () => false, isDirectory: () => true };
    }

    const file = await this._getFileRecord(p);
    if (file) {
      const size = typeof file.size === "number" && Number.isFinite(file.size) ? file.size : 0;
      const mtimeMs = typeof file.mtimeMs === "number" && Number.isFinite(file.mtimeMs) ? file.mtimeMs : undefined;
      return { size, ...(mtimeMs ? { mtimeMs } : {}), isFile: () => true, isDirectory: () => false };
    }

    const dir = await this._getDirRecord(p);
    if (dir) {
      const mtimeMs = typeof dir.mtimeMs === "number" && Number.isFinite(dir.mtimeMs) ? dir.mtimeMs : undefined;
      return { size: 0, ...(mtimeMs ? { mtimeMs } : {}), isFile: () => false, isDirectory: () => true };
    }

    // Best-effort: infer directory existence from children.
    const keys = await this._store.keys();
    for (const key of keys) {
      const k = String(key || "");
      if (!k) continue;
      if (!k.startsWith(this._filePrefix) && !k.startsWith(this._dirPrefix)) continue;
      const contentPath = k.startsWith(this._filePrefix) ? k.slice(this._filePrefix.length) : k.slice(this._dirPrefix.length);
      if (pathStartsWith(contentPath, p)) {
        return { size: 0, mtimeMs: Date.now(), isFile: () => false, isDirectory: () => true };
      }
    }

    throw new Error(`ENOENT: ${p}`);
  }

  async exists(path) {
    const p = normalizeVfsPath(path);
    if (!p) return true;
    try {
      await this.stat(p);
      return true;
    } catch {
      return false;
    }
  }

  async readdir(path, options = {}) {
    const p = normalizeVfsPath(path);
    const withFileTypes = !!options.withFileTypes;
    const base = p ? `${p}/` : "";

    // Ensure directory exists.
    if (p) {
      const dir = await this._getDirRecord(p);
      if (!dir) {
        // Might still exist implicitly if it has children; validate via stat().
        await this.stat(p);
      }
    }

    const allKeys = await this._store.keys();
    const entries = new Map(); // name -> "file"|"directory"

    for (const key of allKeys) {
      const k = String(key || "");
      if (!k) continue;

      if (k.startsWith(this._filePrefix)) {
        const fp = k.slice(this._filePrefix.length);
        if (!fp || !fp.startsWith(base)) continue;
        const rest = fp.slice(base.length);
        if (!rest) continue;
        const [name, ...tail] = rest.split("/");
        if (!name) continue;
        entries.set(name, tail.length ? "directory" : "file");
        continue;
      }

      if (k.startsWith(this._dirPrefix)) {
        const dp = k.slice(this._dirPrefix.length);
        if (!dp || !dp.startsWith(base)) continue;
        const rest = dp.slice(base.length);
        if (!rest) continue;
        const [name] = rest.split("/");
        if (!name) continue;
        if (!entries.has(name)) entries.set(name, "directory");
      }
    }

    const out = Array.from(entries.entries())
      .map(([name, kind]) => (withFileTypes ? makeDirent(name, kind) : name))
      .sort((a, b) => {
        const an = typeof a === "string" ? a : a.name;
        const bn = typeof b === "string" ? b : b.name;
        return an.localeCompare(bn);
      });

    return out;
  }

  async copy(src, dest) {
    const s = normalizeVfsPath(src);
    const d = normalizeVfsPath(dest);
    if (!s) throw new Error("EISDIR: /");
    if (!d) throw new Error("EISDIR: /");
    const bytes = await this.readFile(s);
    await this.writeFile(d, bytes);
    return true;
  }

  async move(src, dest) {
    await this.copy(src, dest);
    await this.unlink(src);
    return true;
  }

  async listFiles({ prefix = "", recursive = true } = {}) {
    const base = normalizeVfsPath(prefix);

    try {
      const st = await this.stat(base);
      if (st?.isFile?.()) return [base];
    } catch {
      // treat as directory
    }

    const basePrefix = base ? `${base}/` : "";
    const keys = await this._store.keys();
    const out = [];
    for (const key of keys) {
      const k = String(key || "");
      if (!k.startsWith(this._filePrefix)) continue;
      const fp = k.slice(this._filePrefix.length);
      if (!fp.startsWith(basePrefix)) continue;
      const rest = fp.slice(basePrefix.length);
      if (!rest) continue;
      if (!recursive && rest.includes("/")) continue;
      out.push(fp);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }

  async *walkFiles({ prefix = "", recursive = true } = {}) {
    const files = await this.listFiles({ prefix, recursive });
    for (const f of files) yield f;
  }

  async rename(src, dest) {
    const s = normalizeVfsPath(src);
    const d = normalizeVfsPath(dest);
    if (!s) throw new Error("EISDIR: /");
    if (!d) throw new Error("EISDIR: /");

    const rec = await this._getFileRecord(s);
    if (!rec) throw new Error(`ENOENT: ${s}`);

    await this._ensureDir(dirnameVfsPath(d));
    await this._store.set(this._fileKey(d), { ...rec, path: d });
    await this._store.delete(this._fileKey(s));
    return true;
  }

  async rm(path, options = {}) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EPERM: cannot remove root");

    const recursive = options?.recursive === true;
    try {
      const st = await this.stat(p);
      if (st?.isDirectory?.()) return this.rmdir(p, { recursive });
      return this.unlink(p);
    } catch (err) {
      throw err;
    }
  }
}

export default StorageVfs;
