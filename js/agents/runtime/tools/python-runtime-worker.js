/**
 * Python Runtime Worker
 *
 * 运行在独立线程中的 Python 运行时。
 * 负责加载 Pyodide 和执行 Python 代码，避免阻塞主线程。
 *
 * Pyodide 版本: 0.26.4 (锁定)
 * 已加固：对 pyodide.mjs 做 SHA-256 完整性校验（SRI）
 */

import { createLogger } from "../../shared/utils/logger.js";
import { VfsProxyClient } from "../core/vfs-proxy-client.js";

const logger = createLogger("runtime/tools/python-runtime-worker");

// 版本锁定 - 更新时需同步修改 python-adapter.js 中的 indexUrl 默认值
const PYODIDE_VERSION = '0.26.4';
const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full`;
const PYODIDE_MJS_SRI_BY_VERSION = Object.freeze({
  "0.26.4": "sha256-fyTGZVp56s8AYdPU5qYNwLGTiBLRXFLX/4s32eBonlE=",
});
const PYODIDE_MJS_SRI = PYODIDE_MJS_SRI_BY_VERSION[PYODIDE_VERSION] || null;

let loadPyodide = null;
let pyodide = null;
/** @type {VfsProxyClient | null} */
let vfsProxy = null;
let vfsProxyMounted = false;
let vfsProxyMountError = null;

function isSharedArrayBuffer(value) {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

function ensureDir(FS, path) {
  try {
    FS.mkdir(path);
  } catch (err) {
    // EEXIST is fine.
  }
}

function ensureDirTree(FS, path) {
  try {
    FS.mkdirTree(path);
  } catch (err) {
    // Ignore.
  }
}

function ensureSymlink(FS, target, linkPath) {
  try {
    // Ensure parent exists.
    const parent = linkPath.split("/").slice(0, -1).join("/") || "/";
    ensureDirTree(FS, parent);
    FS.symlink(target, linkPath);
  } catch (err) {
    // EEXIST is fine (or link already present).
  }
}

function decodeBase64ToBytes(b64) {
  const s = typeof b64 === "string" ? b64.trim() : "";
  if (!s) return null;
  const NodeBuffer = /** @type {any} */ (globalThis).Buffer;
  if (NodeBuffer && typeof NodeBuffer.from === "function") return new Uint8Array(NodeBuffer.from(s, "base64"));
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return null;
}

async function verifySha256SRI(bytes, expectedIntegrity) {
  const expected = String(expectedIntegrity || "").trim().replace(/^sha256-/, "");
  if (!expected) return;

  const cryptoApi = globalThis?.crypto;
  const subtle = cryptoApi && cryptoApi.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new Error("Integrity check requires crypto.subtle.digest");
  }

  const expectedBytes = decodeBase64ToBytes(expected);
  if (!expectedBytes) throw new Error("Integrity check requires base64 decoder");

  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  if (digest.length !== expectedBytes.length) {
    throw new Error("Integrity check failed (digest length mismatch)");
  }
  for (let i = 0; i < digest.length; i++) {
    if (digest[i] !== expectedBytes[i]) {
      throw new Error("Integrity check failed (sha256 mismatch)");
    }
  }
}

async function importModuleWithIntegrity(url, expectedIntegrity) {
  if (typeof fetch !== "function") {
    throw new Error("Integrity check requires fetch()");
  }
  const resp = await fetch(url);
  if (!resp || !resp.ok) {
    throw new Error(`Failed to fetch module for integrity check: ${resp?.status || "unknown"}`);
  }
  const bytes = await resp.arrayBuffer();
  await verifySha256SRI(bytes, expectedIntegrity);

  const blob = new Blob([bytes], { type: "text/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await import(blobUrl);
  } finally {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Ignore.
    }
  }
}

async function ensurePyodideLoader() {
  if (loadPyodide) return;
  const url = `${PYODIDE_CDN_BASE}/pyodide.mjs`;
  const mod = PYODIDE_MJS_SRI ? await importModuleWithIntegrity(url, PYODIDE_MJS_SRI) : await import(url);
  loadPyodide = mod.loadPyodide;
}

async function initPyodide(indexUrl) {
  if (pyodide) return;
  await ensurePyodideLoader();
  pyodide = await loadPyodide({
    indexURL: indexUrl || PYODIDE_CDN_BASE,
    stdout: (text) => self.postMessage({ type: 'stdout', text }),
    stderr: (text) => self.postMessage({ type: 'stderr', text }),
  });
}

function getErrnoCodes(pyodideInstance) {
  const FS = pyodideInstance?.FS;
  return FS?.ERRNO_CODES || pyodideInstance?._module?.ERRNO_CODES || pyodideInstance?.ERRNO_CODES || {};
}

function makeErrnoError(pyodideInstance, code) {
  const FS = pyodideInstance?.FS;
  const ErrnoError = FS?.ErrnoError;
  const ERRNO_CODES = getErrnoCodes(pyodideInstance);
  const FALLBACK_ERRNO = {
    EPERM: 1,
    ENOENT: 2,
    EIO: 5,
    EBADF: 9,
    EACCES: 13,
    EEXIST: 17,
    ENOTDIR: 20,
    EISDIR: 21,
    EINVAL: 22,
    ENOSYS: 38,
    ENOTEMPTY: 39,
  };
  const errno =
    typeof ERRNO_CODES?.[code] === "number"
      ? ERRNO_CODES[code]
      : typeof code === "number"
        ? code
        : typeof code === "string" && typeof FALLBACK_ERRNO[code] === "number"
          ? FALLBACK_ERRNO[code]
          : 1;
  if (typeof ErrnoError === "function") return new ErrnoError(errno);
  const err = new Error(code);
  // @ts-ignore
  err.errno = errno;
  return err;
}

function isNotFoundError(err) {
  const code = String(err?.code || "");
  if (code === "ENOENT") return true;
  const msg = String(err?.message || err || "");
  return msg.includes("ENOENT") || msg.includes("NotFoundError");
}

function joinPath(base, name) {
  const b = String(base || "");
  const n = String(name || "");
  if (!b || b === "/") return `/${n}`.replace(/\/+$/, "");
  return b.endsWith("/") ? `${b}${n}` : `${b}/${n}`;
}

/**
 * Mount a proxy filesystem at /vfs that forwards sync operations to the main-thread VFS.
 *
 * For "transparent" paths, we also create symlinks:
 * - /mnt/workspace -> /vfs/mnt/workspace
 * - /output        -> /vfs/output
 * - /workspace     -> /vfs/workspace
 *
 * @param {object} options
 * @param {string} [options.mountPoint='/vfs']
 * @param {string[]} [options.aliases]
 */
function ensureVfsProxyMounted({ mountPoint = "/vfs", aliases = ["/mnt/workspace", "/output", "/workspace"] } = {}) {
  if (!pyodide || vfsProxyMounted || vfsProxyMountError) return;
  if (!vfsProxy) {
    vfsProxyMountError = new Error("VfsProxyClient not initialized");
    return;
  }
  if (!vfsProxy.supportsSync) {
    vfsProxyMountError = new Error("SharedArrayBuffer+Atomics.wait not available; cannot mount PROXYFS");
    logger.warn("[PythonWorker] VFS proxy sync unsupported; skipping mount");
    return;
  }

  const FS = pyodide.FS;

  const throwErr = (code) => {
    throw makeErrnoError(pyodide, code);
  };

  const toHostPath = (nodePath) => {
    const p = String(nodePath || "/");
    if (p === mountPoint) return "/";
    if (p.startsWith(`${mountPoint}/`)) {
      const out = p.slice(mountPoint.length);
      return out.startsWith("/") ? out : `/${out}`;
    }
    return p;
  };

  const modeDir = 0o040000 | 0o777;
  const modeFile = 0o100000 | 0o666;

  const PROXYFS = {
    mount: (mount) => {
      const node = PROXYFS.createNode(null, "/", modeDir, 0);
      return node;
    },

    createNode: (parent, name, mode, dev) => {
      if (!FS.isDir(mode) && !FS.isFile(mode)) {
        throwErr("EINVAL");
      }
      const node = FS.createNode(parent, name, mode, dev);
      node.node_ops = PROXYFS.node_ops;
      node.stream_ops = PROXYFS.stream_ops;
      // Simple cache for directory entries (best-effort).
      node.contents = FS.isDir(mode) ? {} : null;
      node.size = 0;
      node.timestamp = Date.now();
      return node;
    },

    node_ops: {
      getattr: (node) => {
        const hostPath = toHostPath(node.path);
        let st;
        try {
          st = vfsProxy.statSync(hostPath);
        } catch (err) {
          if (isNotFoundError(err)) throwErr("ENOENT");
          throwErr("EIO");
        }
        if (!st || st.exists === false) throwErr("ENOENT");

        const isDir = !!st.isDirectory;
        const isFile = !!st.isFile || !isDir;
        const mode = isDir ? modeDir : modeFile;
        node.mode = mode;
        node.size = typeof st.size === "number" ? st.size : 0;
        const ts = typeof st.mtimeMs === "number" ? st.mtimeMs : Date.now();
        node.timestamp = ts;

        const dt = new Date(ts);
        return {
          dev: 1,
          ino: node.id,
          mode: node.mode,
          nlink: isDir ? 2 : 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          size: node.size,
          atime: dt,
          mtime: dt,
          ctime: dt,
          blksize: 4096,
          blocks: Math.ceil((node.size || 0) / 4096),
        };
      },

      setattr: (node, attr) => {
        if (!attr || typeof attr !== "object") return;
        if (typeof attr.size === "number" && Number.isFinite(attr.size) && attr.size >= 0) {
          const hostPath = toHostPath(node.path);
          const newSize = Math.floor(attr.size);
          let cur = new Uint8Array(0);
          try {
            cur = vfsProxy.readFileSync(hostPath, { sizeHint: node.size || 0 });
          } catch (err) {
            if (!isNotFoundError(err)) throwErr("EIO");
          }
          const next = new Uint8Array(newSize);
          next.set(cur.subarray(0, Math.min(cur.length, next.length)));
          vfsProxy.writeFileSync(hostPath, next);
          node.size = next.length;
        }
      },

      lookup: (parent, name) => {
        if (name === ".") return parent;
        if (name === "..") return parent.parent || parent;

        const cached = parent?.contents && parent.contents[name];
        if (cached) return cached;

        const nodePath = joinPath(parent.path, name);
        const hostPath = toHostPath(nodePath);

        let st;
        try {
          st = vfsProxy.statSync(hostPath);
        } catch (err) {
          if (isNotFoundError(err)) throwErr("ENOENT");
          throwErr("EIO");
        }
        if (!st || st.exists === false) throwErr("ENOENT");

        const isDir = !!st.isDirectory;
        const mode = isDir ? modeDir : modeFile;
        const node = PROXYFS.createNode(parent, name, mode, 0);
        node.size = typeof st.size === "number" ? st.size : 0;
        node.timestamp = typeof st.mtimeMs === "number" ? st.mtimeMs : Date.now();
        if (parent?.contents) parent.contents[name] = node;
        return node;
      },

      readdir: (node) => {
        const hostPath = toHostPath(node.path);
        let listing;
        try {
          listing = vfsProxy.listSync(hostPath);
        } catch (err) {
          if (isNotFoundError(err)) throwErr("ENOENT");
          throwErr("EIO");
        }
        if (!listing || listing.exists === false) throwErr("ENOENT");

        const names = Array.isArray(listing.entries) ? listing.entries.map((e) => e?.name).filter(Boolean) : [];
        return [".", "..", ...names];
      },

      mknod: (parent, name, mode, dev) => {
        const nodePath = joinPath(parent.path, name);
        const hostPath = toHostPath(nodePath);

        if (FS.isDir(mode)) {
          vfsProxy.mkdirSync(hostPath, { recursive: true });
          const node = PROXYFS.createNode(parent, name, modeDir, dev);
          if (parent?.contents) parent.contents[name] = node;
          return node;
        }

        // Create empty file.
        vfsProxy.writeFileSync(hostPath, new Uint8Array(0));
        const node = PROXYFS.createNode(parent, name, modeFile, dev);
        if (parent?.contents) parent.contents[name] = node;
        return node;
      },

      mkdir: (parent, name, mode) => {
        const nodePath = joinPath(parent.path, name);
        const hostPath = toHostPath(nodePath);
        vfsProxy.mkdirSync(hostPath, { recursive: true });
        const node = PROXYFS.createNode(parent, name, modeDir, 0);
        if (parent?.contents) parent.contents[name] = node;
        return node;
      },

      unlink: (parent, name) => {
        const nodePath = joinPath(parent.path, name);
        const hostPath = toHostPath(nodePath);
        try {
          vfsProxy.deleteSync(hostPath, { recursive: false });
        } catch (err) {
          if (isNotFoundError(err)) throwErr("ENOENT");
          throwErr("EIO");
        }
        if (parent?.contents) delete parent.contents[name];
      },

      rmdir: (parent, name) => {
        const nodePath = joinPath(parent.path, name);
        const hostPath = toHostPath(nodePath);
        try {
          vfsProxy.deleteSync(hostPath, { recursive: false });
        } catch (err) {
          if (isNotFoundError(err)) throwErr("ENOENT");
          throwErr("EIO");
        }
        if (parent?.contents) delete parent.contents[name];
      },
    },

    stream_ops: {
      open: (stream) => stream,
      close: (stream) => stream,

      read: (stream, buffer, offset, length, position) => {
        const hostPath = toHostPath(stream.node.path);
        let bytes;
        try {
          bytes = vfsProxy.readFileSync(hostPath, { sizeHint: stream.node.size || 0 });
        } catch (err) {
          if (isNotFoundError(err)) throwErr("ENOENT");
          throwErr("EIO");
        }

        const pos = typeof position === "number" && Number.isFinite(position) ? position : stream.position || 0;
        const start = Math.max(0, pos | 0);
        const end = Math.min(bytes.length, start + (length | 0));
        const slice = bytes.subarray(start, end);
        buffer.set(slice, offset);
        return slice.length;
      },

      write: (stream, buffer, offset, length, position) => {
        const hostPath = toHostPath(stream.node.path);
        const chunk = buffer.subarray(offset, offset + length);
        const p = typeof position === "number" && Number.isFinite(position) ? position : stream.position || 0;
        const pos = Math.max(0, p | 0);

        let cur = new Uint8Array(0);
        try {
          cur = vfsProxy.readFileSync(hostPath, { sizeHint: stream.node.size || 0 });
        } catch (err) {
          if (!isNotFoundError(err)) throwErr("EIO");
        }

        const newSize = Math.max(cur.length, pos + chunk.length);
        const next = new Uint8Array(newSize);
        next.set(cur);
        next.set(chunk, pos);
        vfsProxy.writeFileSync(hostPath, next);
        stream.node.size = next.length;
        return chunk.length;
      },

      llseek: (stream, offset, whence) => {
        const SEEK_SET = 0;
        const SEEK_CUR = 1;
        const SEEK_END = 2;

        let position;
        if (whence === SEEK_SET) position = offset;
        else if (whence === SEEK_CUR) position = stream.position + offset;
        else if (whence === SEEK_END) position = (stream.node.size || 0) + offset;
        else throwErr("EINVAL");

        if (position < 0) throwErr("EINVAL");
        stream.position = position;
        return position;
      },
    },
  };

  try {
    ensureDir(FS, mountPoint);
    FS.mount(PROXYFS, {}, mountPoint);

    // Create transparent aliases (symlinks) into /vfs.
    for (const alias of Array.isArray(aliases) ? aliases : []) {
      const a = String(alias || "").trim();
      if (!a || a === mountPoint) continue;
      const target = `${mountPoint}${a.startsWith("/") ? a : `/${a}`}`;
      ensureSymlink(FS, target, a);
    }

    // Common parent dir for /mnt/workspace.
    ensureDirTree(FS, "/mnt");

    vfsProxyMounted = true;
    logger.debug("[PythonWorker] Mounted VFS proxy", { mountPoint, aliases });
  } catch (err) {
    vfsProxyMountError = err;
    logger.error("[PythonWorker] Failed to mount VFS proxy", { error: err?.message || String(err) });
  }
}

/**
 * 将内核 VFS 传输的数据同步到 Pyodide FS
 */
async function syncFilesToPyodide(files) {
  if (!files || !pyodide) return;
  for (const file of files) {
    const dir = file.path.substring(0, file.path.lastIndexOf('/'));
    if (dir) {
      pyodide.FS.mkdirTree(dir);
    }
    pyodide.FS.writeFile(file.path, file.content);
  }
}

/**
 * 收集 Pyodide FS 中的变更并传回主线程
 */
async function collectFilesFromPyodide(paths) {
  const files = [];
  if (!pyodide) return files;
  
  const walk = (path) => {
    const entries = pyodide.FS.readdir(path).filter(e => e !== '.' && e !== '..');
    for (const name of entries) {
      const fullPath = `${path}/${name}`;
      const stat = pyodide.FS.stat(fullPath);
      if (pyodide.FS.isDir(stat.mode)) {
        walk(fullPath);
      } else {
        files.push({
          path: fullPath,
          content: pyodide.FS.readFile(fullPath)
        });
      }
    }
  };

  for (const p of paths) {
    try {
      walk(p);
    } catch (e) {
      logger.warn(`[PythonWorker] Failed to walk path ${p}: ${e?.message || String(e)}`);
    }
  }
  return files;
}

function normalizeStringArray(value) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return arr.map((v) => String(v ?? "").trim()).filter(Boolean);
}

function normalizeWheelUrls(wheels) {
  const list = Array.isArray(wheels) ? wheels : [];
  const out = [];
  for (const w of list) {
    if (!w || typeof w !== "object") continue;
    if (w.cached && typeof w.localPath === "string" && w.localPath.trim()) {
      out.push(`emfs:${w.localPath.trim()}`);
      continue;
    }
    if (typeof w.url === "string" && w.url.trim()) {
      out.push(w.url.trim());
    }
  }
  return out;
}

async function preloadWithPlan(plan) {
  if (!pyodide) throw new Error("Pyodide not initialized");
  const builtin = normalizeStringArray(plan?.builtin);
  const micropipDeps = normalizeStringArray(plan?.micropip);
  const wheelUrls = normalizeWheelUrls(plan?.wheels);

  if (builtin.length) {
    await pyodide.loadPackage(builtin);
  }

  if (!micropipDeps.length && !wheelUrls.length) return;

  await pyodide.loadPackage("micropip");

  const depsProxy = pyodide.toPy(micropipDeps);
  const wheelsProxy = pyodide.toPy(wheelUrls);
  try {
    pyodide.globals.set("__pb_micropip_deps__", depsProxy);
    pyodide.globals.set("__pb_micropip_wheels__", wheelsProxy);

    await pyodide.runPythonAsync(`
import micropip
for spec in __pb_micropip_deps__:
    await micropip.install(spec)
for spec in __pb_micropip_wheels__:
    await micropip.install(spec)
`);
  } finally {
    try { pyodide.globals.delete("__pb_micropip_deps__"); } catch {}
    try { pyodide.globals.delete("__pb_micropip_wheels__"); } catch {}
    try { depsProxy.destroy?.(); } catch {}
    try { wheelsProxy.destroy?.(); } catch {}
  }
}

self.onmessage = async (evt) => {
  const { type, payload, id } = evt.data;

  try {
    if (type === 'init') {
      await initPyodide(payload.indexUrl);
      if (!vfsProxy) {
        // The proxy is inert until the main thread wires a VfsProxyHost.
        const sharedBuffer = isSharedArrayBuffer(payload?.vfsProxy?.sharedBuffer) ? payload.vfsProxy.sharedBuffer : null;
        vfsProxy = new VfsProxyClient({ target: self, sharedBuffer });
      }
      if (payload?.vfsProxy?.enabled) {
        ensureVfsProxyMounted({ aliases: payload?.vfsProxy?.aliases });
      }
      self.postMessage({ type: 'ready', id });
    } else if (type === 'preload') {
      await initPyodide(payload.indexUrl);

      // Preferred: structured plan (avoids executing arbitrary JS in the worker).
      if (payload.loadPlan) {
        await preloadWithPlan(payload.loadPlan);
      } else if (payload.loadScript) {
        if (payload.allowLegacyLoadScript !== true) {
          throw new Error("Legacy loadScript preload is disabled; use loadPlan or set allowLegacyLoadScript=true");
        }
        // Legacy: dependency load script (generated JS code).
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const loadFn = new AsyncFunction('pyodide', payload.loadScript);
        await loadFn(pyodide);
      }

      // 兼容旧接口: 直接传 dependencies 数组
      if (payload.dependencies && payload.dependencies.length > 0) {
        await pyodide.loadPackage(payload.dependencies);
      }

      self.postMessage({ type: 'preloaded', id });
    } else if (type === 'execute') {
      await initPyodide(payload.indexUrl);

      // Ensure proxy FS is mounted for this run (if enabled).
      if (payload?.vfsProxy?.enabled) {
        if (!vfsProxy) {
          const sharedBuffer = isSharedArrayBuffer(payload?.vfsProxy?.sharedBuffer) ? payload.vfsProxy.sharedBuffer : null;
          vfsProxy = new VfsProxyClient({ target: self, sharedBuffer });
        }
        ensureVfsProxyMounted({ aliases: payload?.vfsProxy?.aliases });
      }
      const useProxyVfs = payload?.vfsProxy?.enabled === true && vfsProxyMounted && !vfsProxyMountError;
      
      // 1. 同步输入文件
      if (payload.files && !useProxyVfs) {
        await syncFilesToPyodide(payload.files);
      }

      // 2. 注入状态
      if (payload.state) {
        pyodide.globals.set('__context_state__', pyodide.toPy(payload.state));
      }

      // 3. 处理 SharedArrayBuffer (如果存在)
      if (payload.sharedBuffers) {
        for (const [name, sab] of Object.entries(payload.sharedBuffers)) {
          const jsView = new Uint8Array(sab);
          pyodide.globals.set(name, pyodide.toPy(jsView));
        }
      }

      // 4. 执行
      const result = await pyodide.runPythonAsync(payload.code);
      
      // 5. 收集输出文件
      const outputFiles =
        payload.watchPaths && !useProxyVfs ? await collectFilesFromPyodide(payload.watchPaths) : [];
      
      // 6. 返回结果
      self.postMessage({ 
        type: 'result', 
        id, 
        data: result,
        files: outputFiles
      });
    }
  } catch (err) {
    self.postMessage({ 
      type: 'error', 
      id, 
      error: err.message 
    });
  }
};
