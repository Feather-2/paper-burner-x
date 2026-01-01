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

  async rmdir(path, { recursive = false } = {}) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EPERM: cannot remove root");
    const parent = await getDirHandle(this._root, dirnameVfsPath(p), { create: false });
    await parent.removeEntry(basenameVfsPath(p), { recursive: !!recursive });
    return true;
  }

  async unlink(path) {
    const p = normalizeVfsPath(path);
    if (!p) throw new Error("EISDIR: /");
    const parent = await getDirHandle(this._root, dirnameVfsPath(p), { create: false });
    await parent.removeEntry(basenameVfsPath(p));
    return true;
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

  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async copy(src, dest) {
    const bytes = await this.readFile(src);
    await this.writeFile(dest, bytes);
    return true;
  }

  async move(src, dest) {
    await this.copy(src, dest);
    await this.unlink(src);
    return true;
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
}

export function supportsOpfs() {
  return isOpfsAvailable();
}

export default OpfsVfs;
