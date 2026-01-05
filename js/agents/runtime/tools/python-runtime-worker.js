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

function decodeBase64ToBytes(b64) {
  const s = typeof b64 === "string" ? b64.trim() : "";
  if (!s) return null;
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
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
      self.postMessage({ type: 'ready', id });
    } else if (type === 'preload') {
      await initPyodide(payload.indexUrl);

      // Preferred: structured plan (avoids executing arbitrary JS in the worker).
      if (payload.loadPlan) {
        await preloadWithPlan(payload.loadPlan);
      } else if (payload.loadScript) {
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
      
      // 1. 同步输入文件
      if (payload.files) {
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
      const outputFiles = payload.watchPaths ? await collectFilesFromPyodide(payload.watchPaths) : [];
      
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
