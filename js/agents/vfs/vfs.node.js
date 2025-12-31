import { normalizeVfsPath } from "./path.js";

function isNodeLike() {
  return typeof process !== "undefined" && !!process.versions?.node;
}

function joinFsPath(rootPath, vfsPath) {
  const root = String(rootPath || ".").replaceAll("\\", "/").replace(/\/+$/, "");
  const rel = normalizeVfsPath(vfsPath);
  return rel ? `${root}/${rel}` : root;
}

export class NodeFsVfs {
  constructor({ rootPath = "." } = {}) {
    if (!isNodeLike()) throw new Error("NodeFsVfs is only available in Node.js");
    this._rootPath = rootPath;
  }

  async _fs() {
    return await import("node:fs/promises");
  }

  async readFile(path) {
    const fs = await this._fs();
    const buf = await fs.readFile(joinFsPath(this._rootPath, path));
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }

  async readText(path) {
    const fs = await this._fs();
    return await fs.readFile(joinFsPath(this._rootPath, path), "utf8");
  }

  async writeFile(path, data) {
    const fs = await this._fs();
    const p = joinFsPath(this._rootPath, path);
    const dir = p.split("/").slice(0, -1).join("/") || ".";
    await fs.mkdir(dir, { recursive: true });
    if (typeof data === "string") {
      await fs.writeFile(p, data, "utf8");
      return true;
    }
    if (data instanceof ArrayBuffer) {
      await fs.writeFile(p, Buffer.from(data));
      return true;
    }
    if (ArrayBuffer.isView(data)) {
      await fs.writeFile(p, Buffer.from(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
      return true;
    }
    await fs.writeFile(p, String(data ?? ""), "utf8");
    return true;
  }

  async writeText(path, text) {
    return this.writeFile(path, typeof text === "string" ? text : String(text ?? ""));
  }

  async stat(path) {
    const fs = await this._fs();
    const s = await fs.stat(joinFsPath(this._rootPath, path));
    return {
      size: s.size,
      mtimeMs: s.mtimeMs,
      isFile: () => s.isFile(),
      isDirectory: () => s.isDirectory(),
    };
  }

  async readdir(path, options = {}) {
    const fs = await this._fs();
    const entries = await fs.readdir(joinFsPath(this._rootPath, path), { withFileTypes: !!options.withFileTypes });
    return entries;
  }

  async listFiles({ prefix = "", recursive = true } = {}) {
    const root = joinFsPath(this._rootPath, prefix);
    const fs = await this._fs();

    const out = [];
    const walk = async (dir, relDir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const relPath = relDir ? `${relDir}/${e.name}` : e.name;
        const abs = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (recursive) await walk(abs, relPath);
        } else {
          out.push(relPath);
        }
      }
    };

    await walk(root, normalizeVfsPath(prefix));
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }
}

export default NodeFsVfs;

