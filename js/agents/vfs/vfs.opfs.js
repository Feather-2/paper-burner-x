import { normalizeVfsPath, dirnameVfsPath, basenameVfsPath } from "./path.js";

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

export class OpfsVfs {
  constructor(rootHandle) {
    this._root = rootHandle;
  }

  static async create({ rootDirName = "paper-burner-workspace" } = {}) {
    if (!isOpfsAvailable()) throw new Error("OPFS not available");
    const root = await navigator.storage.getDirectory();
    const base = rootDirName ? await root.getDirectoryHandle(String(rootDirName), { create: true }) : root;
    return new OpfsVfs(base);
  }

  async readFile(path) {
    const handle = await getFileHandle(this._root, path, { create: false });
    const file = await handle.getFile();
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  }

  async readText(path) {
    const bytes = await this.readFile(path);
    return new TextDecoder().decode(bytes);
  }

  async writeFile(path, data) {
    const p = normalizeVfsPath(path);
    await ensureParentDir(this._root, p);
    const handle = await getFileHandle(this._root, p, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(dataToWritableChunk(data));
    } finally {
      await writable.close();
    }
    return true;
  }

  async writeText(path, text) {
    return this.writeFile(path, typeof text === "string" ? text : String(text ?? ""));
  }

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
    } catch {
      // maybe directory
      const dir = await getDirHandle(this._root, p, { create: false });
      if (dir) return { size: 0, isFile: () => false, isDirectory: () => true };
      throw new Error(`ENOENT: ${p}`);
    }
  }

  async readdir(path, options = {}) {
    const p = normalizeVfsPath(path);
    const withFileTypes = !!options.withFileTypes;
    const dir = await getDirHandle(this._root, p, { create: false });

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
}

export function supportsOpfs() {
  return isOpfsAvailable();
}

export default OpfsVfs;

