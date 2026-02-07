/**
 * VFS Scan Async - OPFS 扫描异步包装器
 *
 * 提供 Promise-based API，内部使用 Web Worker 执行扫描。
 * 浏览器环境自动使用 Worker，Node.js/不支持时回退到同步。
 */

let _scanWorker = null;
let _scanSeq = 0;
const _scanPending = new Map(); // id -> { resolve, reject, onProgress, files }
let _moduleWorkerSupportedScan = null;

function canUseScanWorker() {
  if (typeof Worker === "undefined" || typeof URL === "undefined") return false;
  if (typeof navigator === "undefined" || typeof navigator.storage?.getDirectory !== "function") return false;
  if (_moduleWorkerSupportedScan !== null) return _moduleWorkerSupportedScan;
  try {
    const blob = new Blob([""], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url, { type: "module" });
    w.terminate();
    URL.revokeObjectURL(url);
    _moduleWorkerSupportedScan = true;
  } catch {
    _moduleWorkerSupportedScan = false;
  }
  return _moduleWorkerSupportedScan;
}

function getScanWorker() {
  if (_scanWorker) return _scanWorker;
  if (!canUseScanWorker()) return null;

  try {
    const worker = new Worker(new URL("./vfs-scan.worker.js", import.meta.url), { type: "module" });

    worker.onmessage = (event) => {
      const msg = event?.data;
      if (!msg || typeof msg !== "object") return;

      const { type, id } = msg;
      const pending = _scanPending.get(id);
      if (!pending) return;

      switch (type) {
        case "progress":
          // 增量文件
          if (Array.isArray(msg.files)) {
            pending.files.push(...msg.files);
          }
          if (typeof pending.onProgress === "function") {
            try {
              pending.onProgress({
                files: msg.files,
                total: msg.total,
                done: false,
              });
            } catch {
              // ignore callback errors
            }
          }
          break;

        case "result":
          _scanPending.delete(id);
          // 合并所有文件（progress 中已累积的 + 最后一批）
          const allFiles = pending.files;
          if (Array.isArray(msg.files) && msg.files.length > 0) {
            // result 返回完整列表，不需要合并
          }
          pending.resolve(msg.files || allFiles);
          break;

        case "error":
          _scanPending.delete(id);
          pending.reject(new Error(msg.error || "scan worker error"));
          break;

        case "cancelled":
          _scanPending.delete(id);
          pending.reject(new Error("scan: aborted"));
          break;
      }
    };

    worker.onerror = (err) => {
      for (const pending of _scanPending.values()) {
        try {
          pending.reject(err instanceof Error ? err : new Error(String(err?.message || err)));
        } catch {
          // ignore
        }
      }
      _scanPending.clear();
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      _scanWorker = null;
    };

    _scanWorker = worker;
    return worker;
  } catch {
    return null;
  }
}

/**
 * 终止扫描 Worker
 */
export function terminateScanWorker() {
  if (_scanWorker) {
    try {
      _scanWorker.terminate();
    } catch {
      // ignore
    }
    _scanWorker = null;
  }
  // Reject all pending
  for (const pending of _scanPending.values()) {
    try {
      pending.reject(new Error("scan worker terminated"));
    } catch {
      // ignore
    }
  }
  _scanPending.clear();
}

/**
 * 检查扫描 Worker 是否可用
 */
export function isScanWorkerAvailable() {
  return canUseScanWorker();
}

/**
 * 异步扫描 OPFS 文件列表
 *
 * @param {Object} options
 * @param {string} [options.rootDirName] - OPFS 根目录名
 * @param {string} [options.prefix] - 扫描前缀路径
 * @param {boolean} [options.recursive=true] - 是否递归
 * @param {number} [options.maxFiles=0] - 最大文件数 (0=无限)
 * @param {AbortSignal} [options.signal] - 取消信号
 * @param {Function} [options.onProgress] - 进度回调
 * @param {boolean} [options.useWorker=true] - 是否使用 Worker
 * @param {Function} [options.fallbackListFiles] - Worker 不可用时的回退函数 (prefix, recursive) => Promise<string[]>
 * @returns {Promise<string[]>} 文件路径列表
 */
export async function scanOpfsAsync({
  rootDirName,
  prefix = "",
  recursive = true,
  maxFiles = 0,
  signal,
  onProgress,
  useWorker = true,
  fallbackListFiles,
} = {}) {
  if (signal?.aborted) {
    throw new Error("scan: aborted");
  }

  const worker = useWorker !== false ? getScanWorker() : null;

  if (!worker) {
    // 回退到同步扫描
    if (typeof fallbackListFiles === "function") {
      try {
        const files = await fallbackListFiles(prefix, recursive);
        if (signal?.aborted) throw new Error("scan: aborted");
        const result = maxFiles > 0 ? files.slice(0, maxFiles) : files;
        return Array.isArray(result) ? result : [];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("aborted")) throw err;
        // 回退失败，返回空数组而非抛错
        return [];
      }
    }
    // 无回退函数，返回空数组（静默降级）
    return [];
  }

  const id = `scan_${Date.now().toString(36)}_${++_scanSeq}`;

  return new Promise((resolve, reject) => {
    const pending = { resolve, reject, onProgress, files: [] };
    _scanPending.set(id, pending);

    // 设置取消处理
    const abort = () => {
      worker.postMessage({ type: "cancel", id });
    };

    if (signal) {
      if (signal.aborted) {
        _scanPending.delete(id);
        reject(new Error("scan: aborted"));
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }

    // 发送扫描请求
    worker.postMessage({
      type: "scan",
      id,
      rootDirName,
      prefix,
      recursive,
      maxFiles,
    });

    // 清理
    const cleanup = () => {
      if (signal) {
        signal.removeEventListener("abort", abort);
      }
    };

    // 包装 resolve/reject 以清理
    pending.resolve = (value) => {
      cleanup();
      resolve(value);
    };
    pending.reject = (err) => {
      cleanup();
      reject(err);
    };
  });
}

/**
 * 创建使用 Worker 的 listFiles 函数
 *
 * @param {string} rootDirName - OPFS 根目录名
 * @returns {Function} listFiles({prefix, recursive, signal, maxFiles}) => Promise<string[]>
 */
export function createWorkerListFiles(rootDirName) {
  /**
   * @param {{ prefix?: string, recursive?: boolean, signal?: AbortSignal, maxFiles?: number }} [options]
   * @returns {Promise<string[]>}
   */
  return async function listFiles({ prefix = "", recursive = true, signal, maxFiles = 0 } = {}) {
    return scanOpfsAsync({
      rootDirName,
      prefix,
      recursive,
      maxFiles,
      signal,
      useWorker: true,
    });
  };
}

export default {
  scanOpfsAsync,
  createWorkerListFiles,
  isScanWorkerAvailable,
  terminateScanWorker,
};
