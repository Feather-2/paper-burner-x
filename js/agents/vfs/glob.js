import { isNodeLike } from "../shared/platform.js";
import { normalizeVfsPath } from "./path.js";
import { isScanWorkerAvailable, scanOpfsAsync } from "./vfs-scan-async.js";

function escapeRegExp(s) {
  return s.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function canUseWorker() {
  return !isNodeLike() && typeof Worker !== "undefined" && typeof URL !== "undefined";
}

function normalizePattern(pattern) {
  return String(pattern ?? "").replaceAll("\\", "/").trim();
}

function firstGlobWildcardIndex(pattern) {
  const p = normalizePattern(pattern);
  let idx = -1;
  for (const ch of ["*", "?", "{", "["]) {
    const i = p.indexOf(ch);
    if (i < 0) continue;
    if (idx < 0 || i < idx) idx = i;
  }
  return idx;
}

function staticDirPrefixFromPattern(pattern) {
  const p = normalizePattern(pattern);
  const firstWildcard = firstGlobWildcardIndex(p);
  const head = firstWildcard >= 0 ? p.slice(0, firstWildcard) : p;
  const slash = head.lastIndexOf("/");
  const dir = slash >= 0 ? head.slice(0, slash) : "";
  return normalizeVfsPath(dir);
}

function expandOneBrace(pattern) {
  const start = pattern.indexOf("{");
  if (start < 0) return [pattern];
  const end = pattern.indexOf("}", start + 1);
  if (end < 0) return [pattern];
  const inner = pattern.slice(start + 1, end);
  const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [pattern];

  const head = pattern.slice(0, start);
  const tail = pattern.slice(end + 1);
  const out = [];
  for (const p of parts) out.push(`${head}${p}${tail}`);
  return out;
}

export function expandBraces(pattern) {
  const p = normalizePattern(pattern);
  let acc = [p];
  // Expand repeatedly to support multiple brace groups.
  for (let i = 0; i < 8; i++) {
    let changed = false;
    const next = [];
    for (const item of acc) {
      const expanded = expandOneBrace(item);
      if (expanded.length !== 1 || expanded[0] !== item) changed = true;
      next.push(...expanded);
    }
    acc = next;
    if (!changed) break;
  }
  // De-dup
  return Array.from(new Set(acc));
}

export function globToRegExp(globPattern) {
  const pattern = normalizePattern(globPattern);
  let re = "";

  // We implement a minimal glob dialect:
  // - ** matches any characters (including '/')
  // - * matches any characters except '/'
  // - ? matches one character except '/'
  // - {a,b} expansion is handled separately
  // - other regex characters are escaped
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === "*" && next === "*") {
      const after = pattern[i + 2];
      if (after === "/") {
        // Treat "**/" as "any directories, including none".
        re += "(?:.*\\/)?";
        i += 2; // consume "**/"
      } else {
        re += ".*";
        i++;
      }
      continue;
    }
    if (ch === "*") {
      re += "[^/]*";
      continue;
    }
    if (ch === "?") {
      re += "[^/]";
      continue;
    }
    re += escapeRegExp(ch);
  }
  return new RegExp(`^${re}$`);
}

export function matchGlob(globPattern, path) {
  const p = normalizeVfsPath(path);
  for (const expanded of expandBraces(globPattern)) {
    const re = globToRegExp(expanded);
    if (re.test(p)) return true;
  }
  return false;
}

function compileGlobRegexes(globPattern) {
  const out = [];
  for (const expanded of expandBraces(globPattern)) {
    out.push(globToRegExp(expanded));
  }
  return out;
}

let _globWorker = null;
let _globWorkerSeq = 0;
const _globPending = new Map(); // id -> {resolve,reject}

function getGlobWorker() {
  if (_globWorker) return _globWorker;
  if (!canUseWorker()) return null;

  try {
    const worker = new Worker(new URL("./glob.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const msg = event?.data;
      const id = msg?.id;
      const pending = _globPending.get(id);
      if (!pending) return;
      _globPending.delete(id);
      if (msg?.ok) pending.resolve(Array.isArray(msg.matches) ? msg.matches : []);
      else pending.reject(new Error(msg?.error || "glob worker error"));
    };
    worker.onerror = (err) => {
      for (const pending of _globPending.values()) {
        try {
          pending.reject(err instanceof Error ? err : new Error(String(err?.message || err)));
        } catch {
          // ignore
        }
      }
      _globPending.clear();
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      _globWorker = null;
    };
    _globWorker = worker;
    return worker;
  } catch {
    return null;
  }
}

function delayToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeAbortError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (msg.includes("aborted")) return new Error("glob: aborted");
  return err instanceof Error ? err : new Error(msg || "glob error");
}

/**
 * Create a simple glob function compatible with CodeSearch tools.
 *
 * @param {object} vfs VFS-like object with listFiles({prefix,recursive})
 * @param {object} [options]
 * @param {number} [options.maxScanFiles=20000]
 * @param {boolean} [options.useWorker=true] Use WebWorker to filter matches when available (browser-only).
 * @param {number} [options.workerThresholdFiles=4000] Minimum candidate file count to offload to worker.
 * @param {number} [options.yieldEvery=0] Yield to event loop every N scanned files (helps UI responsiveness).
 * @param {boolean} [options.useScanWorker=true] Use WebWorker for OPFS directory scanning (browser-only).
 * @param {string} [options.opfsRootDirName] OPFS root directory name (required for scan worker).
 */
export function createVfsGlobFn(vfs, { maxScanFiles = 20000, useWorker = true, workerThresholdFiles = 4000, yieldEvery = 0, useScanWorker = true, opfsRootDirName } = {}) {
  if (!vfs) return null;
  const hasList = typeof vfs.listFiles === "function";
  const hasWalk = typeof vfs.walkFiles === "function";
  if (!hasList && !hasWalk) return null;

  // 检测是否可以使用扫描 Worker
  const canUseScanWorker = useScanWorker !== false && opfsRootDirName && isScanWorkerAvailable();

  /**
   * @typedef {object} GlobCallOptions
   * @property {string=} pattern
   * @property {string=} path
   * @property {AbortSignal=} signal
   * @property {number=} yieldEvery
   * @property {boolean=} useScanWorker
   */

  /**
   * @param {GlobCallOptions} [options]
   * @returns {Promise<string[]>}
   */
  return async function globFn({ pattern, path, signal, yieldEvery: callYieldEvery, useScanWorker: callUseScanWorker } = {}) {
    const base = normalizeVfsPath(path || "");
    const maxScan = Math.max(0, Math.floor(maxScanFiles));
    const relDir = staticDirPrefixFromPattern(pattern);
    const scanPrefix = base ? (relDir ? `${base}/${relDir}` : base) : relDir;
    const yieldN =
      typeof callYieldEvery === "number" && Number.isFinite(callYieldEvery) && callYieldEvery > 0
        ? Math.floor(callYieldEvery)
        : typeof yieldEvery === "number" && Number.isFinite(yieldEvery) && yieldEvery > 0
          ? Math.floor(yieldEvery)
          : 0;

    // 是否使用扫描 Worker（可被调用时覆盖）
    const shouldUseScanWorker = callUseScanWorker !== false && canUseScanWorker;

    if (signal?.aborted) throw new Error("glob: aborted");

    const candidates = [];
    let scanned = 0;
    let usedScanWorker = false;

    // 构造回退函数（使用 vfs.listFiles）
    const fallbackListFiles = hasList
      ? async (pfx, rec) => vfs.listFiles({ prefix: pfx, recursive: rec })
      : null;

    try {
      // 优先使用 OPFS 扫描 Worker（完全离开主线程）
      if (shouldUseScanWorker) {
        try {
          const workerFiles = await scanOpfsAsync({
            rootDirName: opfsRootDirName,
            prefix: scanPrefix,
            recursive: true,
            maxFiles: maxScan,
            signal,
            fallbackListFiles,
          });
          if (workerFiles.length > 0 || !hasList) {
            candidates.push(...workerFiles);
            usedScanWorker = true;
          }
        } catch (err) {
          // Worker 失败，回退到主线程扫描
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("aborted")) throw err;
          // 静默回退，不中断流程
        }
      }

      // 回退到主线程扫描（walkFiles 或 listFiles）
      if (!usedScanWorker) {
        if (hasWalk) {
          const walker = vfs.walkFiles({
            prefix: scanPrefix,
            recursive: true,
            ...(signal ? { signal } : {}),
          });

          for await (const file of walker) {
            if (signal?.aborted) throw new Error("glob: aborted");
            scanned += 1;
            if (maxScan && scanned > maxScan) break;
            candidates.push(file);
            if (yieldN && scanned % yieldN === 0) await delayToEventLoop();
          }
        } else {
          const files = await vfs.listFiles({ prefix: scanPrefix || base, recursive: true });
          if (signal?.aborted) throw new Error("glob: aborted");
          candidates.push(...(maxScan ? files.slice(0, maxScan) : files));
        }
      }

      const threshold =
        typeof workerThresholdFiles === "number" && Number.isFinite(workerThresholdFiles) && workerThresholdFiles > 0
          ? Math.floor(workerThresholdFiles)
          : 0;
      const worker = useWorker !== false ? getGlobWorker() : null;
      if (worker && candidates.length >= threshold) {
        const id = `glob_${Date.now().toString(36)}_${++_globWorkerSeq}`;
        const promise = new Promise((resolve, reject) => {
          _globPending.set(id, { resolve, reject });
        });

        const abort = () => {
          const pending = _globPending.get(id);
          if (!pending) return;
          _globPending.delete(id);
          pending.reject(new Error("glob: aborted"));
        };

        if (signal) signal.addEventListener?.("abort", abort, { once: true });
        try {
          worker.postMessage({ id, pattern, base, files: candidates });
          return await promise;
        } finally {
          if (signal) signal.removeEventListener?.("abort", abort);
        }
      }

      const regexes = compileGlobRegexes(pattern);
      const out = [];
      for (const file of candidates) {
        if (signal?.aborted) throw new Error("glob: aborted");
        const rel = base ? (file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file) : file;
        if (!rel) continue;
        if (regexes.some((re) => re.test(rel))) out.push(file);
      }
      return out;
    } catch (err) {
      throw normalizeAbortError(err);
    }
  };
}

export default {
  expandBraces,
  globToRegExp,
  matchGlob,
  createVfsGlobFn,
};
