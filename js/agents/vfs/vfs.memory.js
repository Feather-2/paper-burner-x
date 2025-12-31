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

function isChildOfDir(filePath, dirPath) {
  const prefix = dirPath ? `${dirPath}/` : "";
  return filePath.startsWith(prefix);
}

function dirEntriesFromPaths(paths, dirPath) {
  const prefix = dirPath ? `${dirPath}/` : "";
  const out = new Map(); // name -> kind
  for (const p of paths) {
    if (!p || !p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      out.set(rest, "file");
      continue;
    }
    out.set(rest.slice(0, slash), "dir");
  }
  return Array.from(out.entries()).map(([name, kind]) => ({ name, kind }));
}

function makeDirent(entry) {
  return {
    name: entry.name,
    isDirectory: () => entry.kind === "dir",
    isFile: () => entry.kind === "file",
  };
}

export class MemoryVfs {
  constructor() {
    this._files = new Map(); // path -> { bytes, updatedAt }
  }

  async readFile(path) {
    const p = normalizeVfsPath(path);
    const rec = this._files.get(p);
    if (!rec) throw new Error(`ENOENT: ${p}`);
    return new Uint8Array(rec.bytes);
  }

  async readText(path) {
    const bytes = await this.readFile(path);
    return bytesToText(bytes);
  }

  async writeFile(path, data) {
    const p = normalizeVfsPath(path);
    const bytes = dataToBytes(data);
    this._files.set(p, { bytes: new Uint8Array(bytes), updatedAt: Date.now() });
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
        isFile: () => false,
        isDirectory: () => true,
      };
    }
    const file = this._files.get(p);
    if (file) {
      return {
        size: file.bytes.byteLength,
        mtimeMs: file.updatedAt,
        isFile: () => true,
        isDirectory: () => false,
      };
    }

    // directory exists if any file is under it
    const prefix = `${p}/`;
    for (const k of this._files.keys()) {
      if (k.startsWith(prefix)) {
        return { size: 0, isFile: () => false, isDirectory: () => true };
      }
    }
    throw new Error(`ENOENT: ${p}`);
  }

  async readdir(path, options = {}) {
    const p = normalizeVfsPath(path);
    const withFileTypes = !!options.withFileTypes;
    const entries = dirEntriesFromPaths(Array.from(this._files.keys()), p);
    if (!withFileTypes) return entries.map((e) => e.name);
    return entries.map(makeDirent);
  }

  async listFiles({ prefix = "", recursive = true } = {}) {
    const pfx = normalizeVfsPath(prefix);
    const out = [];
    for (const p of this._files.keys()) {
      if (!isChildOfDir(p, pfx)) continue;
      const rest = pfx ? p.slice(pfx.length + 1) : p;
      if (!recursive && rest.includes("/")) continue;
      out.push(p);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }
}

export default MemoryVfs;

