const isWorkerAvailable = typeof Worker !== "undefined";
const isBrowser = typeof window !== "undefined";
const isNode = typeof process !== "undefined" && Boolean(process.versions && process.versions.node);

function defaultPoolSize() {
  if (typeof navigator !== "undefined" && navigator && Number.isFinite(navigator.hardwareConcurrency)) return Math.max(1, navigator.hardwareConcurrency);
  return 4;
}

function toWorkerUrl(workerUrl) {
  if (workerUrl instanceof URL) return workerUrl;
  if (typeof workerUrl === "string" && workerUrl) return new URL(workerUrl, import.meta.url);
  return new URL("./deepsearch-worker.js", import.meta.url);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export class WorkerPool {
  constructor({ workerUrl = "./deepsearch-worker.js", size = defaultPoolSize() } = {}) {
    this.workerUrl = toWorkerUrl(workerUrl);
    this.size = Number.isFinite(size) ? Math.max(1, Math.floor(size)) : defaultPoolSize();

    this.workers = [];
    this.queue = [];
    this.taskId = 0;
    this._closed = false;

    for (let i = 0; i < this.size; i++) this.workers.push(this._createWorker());
  }

  _createWorker() {
    const workerUrl = this.workerUrl;
    const handleMessage = (worker, msg) => this._onWorkerMessage(worker, msg);
    const handleError = (worker, err) => this._onWorkerError(worker, err);

    let w;
    if (isBrowser && isWorkerAvailable) {
      w = new Worker(workerUrl, { type: "module" });
      w.addEventListener("message", (e) => handleMessage(w, e && e.data));
      w.addEventListener("error", (e) => handleError(w, e));
    } else if (isNode) {
      // Lazy import to avoid browser environments executing node:worker_threads.
      const workerThreads = import("node:worker_threads");
      w = {
        _node: true,
        _init: workerThreads.then((mod) => mod.Worker),
        _instance: null,
        pendingTasks: new Map(),
        _busy: false,
        async _ensure() {
          if (this._instance) return this._instance;
          const WorkerCtor = await this._init;
          this._instance = new WorkerCtor(workerUrl, { type: "module" });
          this._instance.on("message", (data) => handleMessage(this, data));
          this._instance.on("error", (err) => handleError(this, err));
          this._instance.on("exit", (code) => {
            if (code === 0) return;
            handleError(this, new Error(`Worker exited with code ${code}`));
          });
          return this._instance;
        },
        async postMessage(data) {
          const inst = await this._ensure();
          inst.postMessage(data);
        },
        async terminate() {
          if (!this._instance) return 0;
          return this._instance.terminate();
        },
      };
    } else {
      throw new Error("WorkerPool: no worker implementation available in this environment");
    }

    if (!w.pendingTasks) w.pendingTasks = new Map();
    if (w._busy === undefined) w._busy = false;
    return w;
  }

  _onWorkerMessage(worker, msg) {
    if (!msg || (msg.type !== "result" && msg.type !== "error")) return;
    const { taskId } = msg;
    const pending = worker.pendingTasks.get(taskId);
    if (!pending) return;

    worker.pendingTasks.delete(taskId);
    worker._busy = false;

    if (msg.type === "result") pending.resolve(msg.result);
    else pending.reject(new Error(msg.error || "Worker task failed"));

    this._drainQueue();
  }

  _onWorkerError(worker, err) {
    const error = err instanceof Error ? err : new Error(err && err.message ? err.message : String(err));
    for (const [taskId, pending] of worker.pendingTasks.entries()) {
      worker.pendingTasks.delete(taskId);
      pending.reject(error);
    }
    worker._busy = false;
    this._drainQueue();
  }

  _getAvailableWorker() {
    for (const w of this.workers) {
      if (!w._busy) return w;
    }
    return null;
  }

  _drainQueue() {
    if (this._closed) return;
    while (this.queue.length) {
      const worker = this._getAvailableWorker();
      if (!worker) return;
      const task = this.queue.shift();
      this._dispatch(worker, task);
    }
  }

  _dispatch(worker, task) {
    worker._busy = true;
    worker.pendingTasks.set(task.taskId, { resolve: task.resolve, reject: task.reject });
    const ret = worker.postMessage({ type: task.type, payload: task.payload, taskId: task.taskId });
    if (ret && typeof ret.then === "function") ret.catch((e) => this._onWorkerError(worker, e));
  }

  async exec(type, payload) {
    if (this._closed) throw new Error("WorkerPool is terminated");
    if (typeof type !== "string" || !type) throw new TypeError("WorkerPool.exec(type, payload): type must be a non-empty string");
    if (payload !== undefined && payload !== null && !isPlainObject(payload)) throw new TypeError("WorkerPool.exec(type, payload): payload must be an object");

    return new Promise((resolve, reject) => {
      const taskId = ++this.taskId;
      const worker = this._getAvailableWorker();
      const task = { type, payload: payload || {}, taskId, resolve, reject };
      if (worker) this._dispatch(worker, task);
      else this.queue.push(task);
    });
  }

  async buildIndex(chunks, options = {}) {
    return this.exec("buildBm25Index", { chunks, options });
  }

  async chunk(text, options = {}) {
    return this.exec("chunkText", { text, options });
  }

  async grep(chunks, pattern, options = {}) {
    return this.exec("grepSearch", { chunks, pattern, options });
  }

  async normalize(text) {
    return this.exec("normalize", { text });
  }

  async terminate() {
    this._closed = true;
    const errs = [];
    for (const w of this.workers) {
      for (const [taskId, pending] of w.pendingTasks.entries()) {
        w.pendingTasks.delete(taskId);
        pending.reject(new Error("WorkerPool terminated"));
      }
      try {
        await w.terminate();
      } catch (e) {
        errs.push(e);
      }
    }
    this.workers = [];
    this.queue = [];
    if (errs.length) throw errs[0];
  }
}
