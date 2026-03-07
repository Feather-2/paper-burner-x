import { RuntimeAdapter, RuntimeType } from './runtime-adapter.js';
import { createLogger } from "../../shared/index.js";
import { VfsProxyHost } from "./vfs-proxy-host.js";
import { VFS_REQUEST } from "./vfs-proxy-protocol.js";

/**
 * @typedef {import('./runtime-adapter.js').ExecutionContext} ExecutionContext
 * @typedef {import('./runtime-adapter.js').ExecutionResult} ExecutionResult
 *
 * @typedef {object} PythonRuntimeAdapterOptions
 * @property {string} [id]
 * @property {string} [indexUrl]
 * @property {string[]} [watchPaths]
 * @property {number} [requestTimeoutMs=60000]
 *
 * @typedef {object} VfsDirEntry
 * @property {string} name
 * @property {string} kind
 *
 * @typedef {object} VfsLike
 * @property {(path: string) => Promise<VfsDirEntry[]>} list
 * @property {(path: string) => Promise<any>} readFile
 * @property {(path: string, data: any) => Promise<any>} writeFile
 *
 * @typedef {{ path: string, content: any }} PreparedFile
 *
 * @typedef {{ path: string, kind: string, depth: number }} VfsCollectedEntry
 */

const logger = createLogger("runtime/core/python-adapter");

const DEFAULT_VFS_CONCURRENCY = 8;

export class PythonRuntimeAdapter extends RuntimeAdapter {
  /**
   * @param {PythonRuntimeAdapterOptions} [options]
   */
  constructor(options = {}) {
    super({ ...options, type: RuntimeType.PYTHON });
    /** @type {Worker | null} */
    this.worker = null;
    this.indexUrl = options.indexUrl || 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
    /** @type {Map<number, { resolve: (value: any) => void, reject: (err: any) => void, vfs: VfsLike | null }>} */
    this.pendingRequests = new Map();
    this._requestId = 0;
    this.watchPaths = options.watchPaths || ['/mnt/workspace'];
    this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
      ? Math.max(0, Number(options.requestTimeoutMs))
      : 60_000;
    /** @type {VfsProxyHost | null} */
    this.vfsProxyHost = null;
    /** @type {SharedArrayBuffer | null} */
    this.vfsProxySharedBuffer = null;
  }

  _ensureVfsProxySharedBuffer() {
    if (this.vfsProxySharedBuffer) return this.vfsProxySharedBuffer;
    try {
      if (typeof SharedArrayBuffer === "undefined") return null;
      // A reusable response buffer for sync VFS proxy. The worker can resize if needed.
      this.vfsProxySharedBuffer = new SharedArrayBuffer(16 + 4 * 1024 * 1024);
      return this.vfsProxySharedBuffer;
    } catch (err) {
      logger.warn("[PythonRuntime] SharedArrayBuffer unavailable; VFS proxy will fallback to snapshot mode", {
        error: err?.message || String(err),
      });
      this.vfsProxySharedBuffer = null;
      return null;
    }
  }

  _getVfsProxyAliases() {
    const aliases = new Set();
    for (const p of Array.isArray(this.watchPaths) ? this.watchPaths : []) {
      const s = String(p ?? "").trim();
      if (s) aliases.add(s);
    }
    // Common legacy path used by older code.
    aliases.add("/workspace");
    // Default output mount.
    aliases.add("/output");
    return Array.from(aliases);
  }

  /**
   * @returns {Promise<any>}
   */
  async initialize() {
    if (this.worker) return;

    // 创建专用 Worker（路径相对于 runtime/core/）
    const workerUrl = new URL('../tools/python-runtime-worker.js', import.meta.url);
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.vfsProxyHost = new VfsProxyHost(null, this.worker);

    this.worker.onerror = (event) => {
      const err = new Error(`Python worker error: ${event?.message || 'unknown'}`);
      for (const [, req] of this.pendingRequests) {
        req.reject(err);
      }
      this.pendingRequests.clear();
    };

    this.worker.onmessage = async (evt) => {
      const { type, id, data, error, text, files } = evt.data;

      // VFS proxy requests are handled by VfsProxyHost via addEventListener.
      if (type === VFS_REQUEST) return;

      if (type === 'stdout') logger.debug(`[Python Stdout] ${text}`);
      if (type === 'stderr') logger.error(`[Python Stderr] ${text}`);

      const request = this.pendingRequests.get(id);
      if (!request) return;

      if (type === 'result') {
        // 处理回传的文件变更
        if (files && request.vfs) {
          try {
            for (const file of files) {
              await request.vfs.writeFile(file.path, file.content);
            }
          } catch (writeErr) {
            logger.error("[PythonRuntime] Failed to write file back to VFS", {
              error: writeErr?.message || String(writeErr),
            });
            request.reject(writeErr);
            this.pendingRequests.delete(id);
            return;
          }
        }
        request.resolve(data);
        this.pendingRequests.delete(id);
      } else if (type === 'ready' || type === 'preloaded') {
        request.resolve(data);
        this.pendingRequests.delete(id);
      } else if (type === 'error') {
        request.reject(new Error(error));
        this.pendingRequests.delete(id);
      }
    };

    const sharedBuffer = this._ensureVfsProxySharedBuffer();
    return this._send("init", {
      indexUrl: this.indexUrl,
      vfsProxy: sharedBuffer
        ? { enabled: false, sharedBuffer, aliases: this._getVfsProxyAliases() }
        : { enabled: false },
    });
  }

  /**
   * @param {string} type
   * @param {any} payload
   * @param {VfsLike | null | undefined} [vfs]
   * @returns {Promise<any>}
   */
  _send(type, payload, vfs = null) {
    return this._sendWithOptions(type, payload, vfs, {});
  }

  /**
   * @param {string} type
   * @param {any} payload
   * @param {VfsLike | null | undefined} [vfs]
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
   * @returns {Promise<any>}
   */
  _sendWithOptions(type, payload, vfs = null, options = {}) {
    if (!this.worker) throw new Error('Python worker not initialized');
    const id = ++this._requestId;
    const timeoutMs = Number.isFinite(options?.timeoutMs)
      ? Math.max(0, Number(options.timeoutMs))
      : this.requestTimeoutMs;
    const signal = options?.signal;

    if (signal?.aborted) {
      const reason = typeof signal.reason === "string" ? signal.reason : "Python worker request aborted";
      const err = new Error(reason);
      err.name = "AbortError";
      return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const clearAbort = () => {
        if (!signal) return;
        try {
          signal.removeEventListener("abort", onAbort);
        } catch {
          // ignore
        }
      };
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearAbort();
        resolve(value);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearAbort();
        reject(error);
      };
      const onAbort = () => {
        this.pendingRequests.delete(id);
        const reason = typeof signal?.reason === "string" ? signal.reason : `Python worker request aborted (id=${id}, type=${type})`;
        const err = new Error(reason);
        err.name = "AbortError";
        finishReject(err);
      };

      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pendingRequests.delete(id);
            finishReject(new Error(`Python worker request timeout after ${timeoutMs}ms (id=${id}, type=${type})`));
          }, timeoutMs)
        : null;

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.pendingRequests.set(id, {
        resolve: (v) => { finishResolve(v); },
        reject: (e) => { finishReject(e); },
        vfs,
      });
      try {
        this.worker.postMessage({ type, payload, id });
      } catch (err) {
        this.pendingRequests.delete(id);
        finishReject(err);
      }
    });
  }

  /**
   * @param {string[] | null | undefined} dependencies
   * @returns {Promise<void>}
   */
  async preload(dependencies) {
    await this.initialize();
    if (dependencies && dependencies.length > 0) {
      logger.debug(`[PythonRuntime] Loading packages in worker: ${dependencies.join(', ')}`);
      await this._sendWithOptions('preload', { dependencies, indexUrl: this.indexUrl });
    }
  }

  /**
   * @param {any} loadPlan
   * @returns {Promise<void>}
   */
  async preloadPlan(loadPlan) {
    await this.initialize();
    const hasWork =
      (Array.isArray(loadPlan?.builtin) && loadPlan.builtin.length > 0) ||
      (Array.isArray(loadPlan?.micropip) && loadPlan.micropip.length > 0) ||
      (Array.isArray(loadPlan?.wheels) && loadPlan.wheels.length > 0);
    if (!hasWork) return;
    await this._sendWithOptions("preload", { loadPlan, indexUrl: this.indexUrl });
  }

  /**
   * 收集需要发送到 Worker 的文件
   * @param {VfsLike} vfs
   * @param {string[]} paths
   * @returns {Promise<PreparedFile[]>}
   */
  async _prepareFiles(vfs, paths) {
    const concurrency = DEFAULT_VFS_CONCURRENCY;

    /**
     * @param {any} err
     * @returns {string}
     */
    const formatError = (err) => err?.message || String(err || "");

    /**
     * @param {any} err
     * @returns {boolean}
     */
    const isNotFoundError = (err) => {
      const msg = formatError(err);
      return err?.code === "ENOENT" || msg.includes("ENOENT") || msg.includes("NotFoundError");
    };

    /**
     * @param {string} base
     * @param {string} name
     * @returns {string}
     */
    const joinPath = (base, name) => {
      const b = String(base ?? "");
      const n = String(name ?? "");
      if (!b) return n;
      if (b === "/") return `/${n}`;
      return b.endsWith("/") ? `${b}${n}` : `${b}/${n}`;
    };

    /**
     * @param {any} kind
     * @returns {boolean}
     */
    const isDirectoryKind = (kind) => kind === "dir" || kind === "directory";

    /**
     * 批量并发执行任务（控制并发数）
     * @template T, U
     * @param {T[]} tasks
     * @param {(task: T) => Promise<U>} fn
     * @returns {Promise<U[]>}
     */
    const runBatch = async (tasks, fn) => {
      const results = [];
      const limit = Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : DEFAULT_VFS_CONCURRENCY;
      for (let i = 0; i < tasks.length; i += limit) {
        const batch = tasks.slice(i, i + limit);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
      }
      return results;
    };

    /**
     * 递归收集所有文件和目录（不读取文件内容）
     * @param {string} rootPath
     * @returns {Promise<VfsCollectedEntry[]>}
     */
    const collectEntries = async (rootPath) => {
      /** @type {VfsCollectedEntry[]} */
      const entries = [];
      /** @type {Array<{ path: string, depth: number }>} */
      const stack = [{ path: rootPath, depth: 0 }];

      while (stack.length > 0) {
        const { path: currentPath, depth } = stack.pop();
        let items;
        try {
          items = await vfs.list(currentPath);
        } catch (err) {
          const msg = formatError(err);
          if (isNotFoundError(err)) {
            logger.debug("[PythonRuntime] VFS path missing, skipping", { path: currentPath, error: msg });
          } else {
            logger.warn("[PythonRuntime] Failed to list VFS path", { path: currentPath, error: msg });
          }
          continue;
        }

        for (const entry of items) {
          const entryPath = joinPath(currentPath, entry.name);
          entries.push({ path: entryPath, kind: entry.kind, depth });
          if (isDirectoryKind(entry.kind)) {
            stack.push({ path: entryPath, depth: depth + 1 });
          }
        }
      }

      // 按深度排序，确保结果稳定（父目录优先）
      entries.sort((a, b) => a.depth - b.depth);
      return entries;
    };

    /** @type {PreparedFile[]} */
    const files = [];
    const roots = Array.isArray(paths) ? paths : [];
    logger.debug("[PythonRuntime] Preparing VFS snapshot for worker", { roots: roots.length, concurrency });

    for (const rootPath of roots) {
      const entries = await collectEntries(rootPath);
      const fileEntries = entries.filter((e) => e.kind === "file");

      const prepared = await runBatch(fileEntries, async (entry) => {
        try {
          const content = await vfs.readFile(entry.path);
          return { path: entry.path, content };
        } catch (err) {
          const msg = formatError(err);
          if (isNotFoundError(err)) {
            logger.debug("[PythonRuntime] VFS file missing, skipping", { path: entry.path, error: msg });
          } else {
            logger.warn("[PythonRuntime] Failed to read VFS file", { path: entry.path, error: msg });
          }
          return null;
        }
      });

      for (const f of prepared) {
        if (f) files.push(f);
      }
    }

    logger.debug("[PythonRuntime] Prepared VFS snapshot", { files: files.length });
    return files;
  }

  /**
   * @param {string} code
   * @param {ExecutionContext} context
   * @returns {Promise<ExecutionResult>}
   */
  async execute(code, context) {
    await this.initialize();
    const startTime = Date.now();

    try {
      const sharedBuffer = this._ensureVfsProxySharedBuffer();
      const canUseVfsProxy = !!context.vfs && !!sharedBuffer && !!this.vfsProxyHost;

      // 1. 准备输入文件 (VFS -> Worker) - legacy snapshot fallback
      let files = [];
      if (context.vfs && !canUseVfsProxy) {
        files = await this._prepareFiles(context.vfs, ["/workspace"]);
      }

      // 2. 识别 SharedArrayBuffer
      const sharedBuffers = {};
      if (context.state) {
        for (const [key, value] of Object.entries(context.state)) {
          if (value instanceof SharedArrayBuffer) {
            sharedBuffers[key] = value;
          }
        }
      }

      if (canUseVfsProxy) {
        this.vfsProxyHost.setVfs(context.vfs);
      }

      // 3. 发送执行请求
      const result = await this._sendWithOptions('execute', {
        code, 
        state: context.state,
        files,
        sharedBuffers,
        watchPaths: this.watchPaths,
        vfsProxy: canUseVfsProxy
          ? { enabled: true, sharedBuffer, aliases: this._getVfsProxyAliases() }
          : { enabled: false },
        indexUrl: this.indexUrl
      }, context.vfs, {
        timeoutMs: /** @type {ExecutionContext & { timeoutMs?: number, timeout?: number }} */ (context).timeoutMs
          ?? /** @type {ExecutionContext & { timeoutMs?: number, timeout?: number }} */ (context).timeout,
        signal: context?.signal,
      });

      return {
        success: true,
        data: result,
        metrics: { duration: Date.now() - startTime }
      };

    } catch (err) {
      return {
        success: false,
        error: err.message,
        metrics: { duration: Date.now() - startTime }
      };
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async terminate() {
    const pendingEntries = Array.from(this.pendingRequests.entries());
    this.pendingRequests.clear();
    for (const [id, req] of pendingEntries) {
      try {
        req.reject(new Error(`Python runtime terminated (pending request ${id})`));
      } catch {
        // ignore
      }
    }

    if (this.vfsProxyHost) {
      this.vfsProxyHost.dispose();
      this.vfsProxyHost = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
