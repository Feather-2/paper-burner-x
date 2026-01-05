import { RuntimeAdapter, RuntimeType } from './runtime-adapter.js';
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/core/python-adapter");

export class PythonRuntimeAdapter extends RuntimeAdapter {
  constructor(options = {}) {
    super({ ...options, type: RuntimeType.PYTHON });
    this.worker = null;
    this.indexUrl = options.indexUrl || 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
    this.pendingRequests = new Map();
    this._requestId = 0;
    this.watchPaths = options.watchPaths || ['/mnt/workspace'];
  }

  async initialize() {
    if (this.worker) return;

    // 创建专用 Worker（路径相对于 runtime/core/）
    const workerUrl = new URL('../tools/python-runtime-worker.js', import.meta.url);
    this.worker = new Worker(workerUrl, { type: 'module' });

    this.worker.onmessage = async (evt) => {
      const { type, id, data, error, text, files } = evt.data;

      if (type === 'stdout') console.log(`[Python Stdout] ${text}`);
      if (type === 'stderr') logger.error(`[Python Stderr] ${text}`);

      const request = this.pendingRequests.get(id);
      if (!request) return;

      if (type === 'result') {
        // 处理回传的文件变更
        if (files && request.vfs) {
          for (const file of files) {
            await request.vfs.writeFile(file.path, file.content);
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

    return this._send('init', { indexUrl: this.indexUrl });
  }

  _send(type, payload, vfs = null) {
    const id = ++this._requestId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, vfs });
      this.worker.postMessage({ type, payload, id });
    });
  }

  async preload(dependencies) {
    await this.initialize();
    if (dependencies && dependencies.length > 0) {
      console.log(`[PythonRuntime] Loading packages in worker: ${dependencies.join(', ')}`);
      await this._send('preload', { dependencies, indexUrl: this.indexUrl });
    }
  }

  async preloadPlan(loadPlan) {
    await this.initialize();
    const hasWork =
      (Array.isArray(loadPlan?.builtin) && loadPlan.builtin.length > 0) ||
      (Array.isArray(loadPlan?.micropip) && loadPlan.micropip.length > 0) ||
      (Array.isArray(loadPlan?.wheels) && loadPlan.wheels.length > 0);
    if (!hasWork) return;
    await this._send("preload", { loadPlan, indexUrl: this.indexUrl });
  }

  /**
   * 收集需要发送到 Worker 的文件
   */
  async _prepareFiles(vfs, paths) {
    const files = [];
    for (const p of paths) {
      try {
        const entries = await vfs.list(p);
        for (const entry of entries) {
          if (entry.kind === 'file') {
            const content = await vfs.readFile(`${p}/${entry.name}`);
            files.push({
              path: `${p}/${entry.name}`,
              content
            });
          }
          // 简化处理：目前只做一级目录
        }
      } catch (e) {
        // 忽略不存在的目录
      }
    }
    return files;
  }

  async execute(code, context) {
    await this.initialize();
    const startTime = Date.now();

    try {
      // 1. 准备输入文件 (VFS -> Worker)
      let files = [];
      if (context.vfs) {
        files = await this._prepareFiles(context.vfs, ['/workspace']);
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

      // 3. 发送执行请求
      const result = await this._send('execute', { 
        code, 
        state: context.state,
        files,
        sharedBuffers,
        watchPaths: this.watchPaths,
        indexUrl: this.indexUrl
      }, context.vfs);

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

  async terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}
