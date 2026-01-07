import { normalizeVfsPath } from "./path.js";

/** @type {any} */
const nodeProcess = /** @type {any} */ (globalThis).process;

/** @type {any} */
const NodeBuffer = /** @type {any} */ (globalThis).Buffer;

function isNodeLike() {
  return !!nodeProcess && typeof nodeProcess === "object" && !!nodeProcess.versions?.node;
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
    return await import(/* @vite-ignore */ /** @type {string} */ ("node:fs/promises"));
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
      await fs.writeFile(p, NodeBuffer.from(data));
      return true;
    }
    if (ArrayBuffer.isView(data)) {
      await fs.writeFile(p, NodeBuffer.from(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
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

  /**
   * @param {{ prefix?: string, recursive?: boolean, signal?: AbortSignal }} [options]
   * @returns {AsyncGenerator<string, void, void>}
   */
  async *walkFiles({ prefix = "", recursive = true, signal } = {}) {
    const fs = await this._fs();
    const baseRel = normalizeVfsPath(prefix);
    const rootAbs = joinFsPath(this._rootPath, baseRel);

    const walk = async function* (dir, relDir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (signal?.aborted) throw new Error("walkFiles: aborted");
        if (e.name.startsWith(".")) continue;
        const relPath = relDir ? `${relDir}/${e.name}` : e.name;
        const abs = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (recursive) yield* walk(abs, relPath);
        } else {
          yield relPath;
        }
      }
    };

    try {
      const st = await fs.stat(rootAbs);
      if (st.isFile()) {
        yield baseRel;
        return;
      }
    } catch {
      return;
    }

    yield* walk(rootAbs, baseRel);
  }

  async exists(path) {
    const fs = await this._fs();
    try {
      await fs.access(joinFsPath(this._rootPath, path));
      return true;
    } catch {
      return false;
    }
  }

  async copy(src, dest) {
    const fs = await this._fs();
    const s = joinFsPath(this._rootPath, src);
    const d = joinFsPath(this._rootPath, dest);
    const dir = d.split("/").slice(0, -1).join("/") || ".";
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(s, d);
    return true;
  }

  async move(src, dest) {
    const fs = await this._fs();
    const s = joinFsPath(this._rootPath, src);
    const d = joinFsPath(this._rootPath, dest);
    const dir = d.split("/").slice(0, -1).join("/") || ".";
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.rename(s, d);
      return true;
    } catch (err) {
      const code = String(err?.code || "");
      if (code !== "EXDEV") throw err;
      await fs.copyFile(s, d);
      await fs.unlink(s);
      return true;
    }
  }

  async appendText(path, text) {
    const fs = await this._fs();
    const p = joinFsPath(this._rootPath, path);
    const dir = p.split("/").slice(0, -1).join("/") || ".";
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(p, typeof text === "string" ? text : String(text ?? ""), "utf8");
    return true;
  }
}

export default NodeFsVfs;
