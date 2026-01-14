/**
 * Worker Pool - 动态 Worker 池管理
 *
 * 特性：
 * - 按需创建 Worker，空闲自动回收
 * - 最大并发限制
 * - 健康检查和自动重启
 * - 任务队列和优先级调度
 */

import { WorkerRpcClient } from "./worker-rpc.js";
import { createWorker as createDefaultWorker } from "./worker-factory.js";
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/core/worker-pool");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_WORKERS = 4;
const DEFAULT_IDLE_TIMEOUT_MS = 30000; // 30s
const DEFAULT_TASK_TIMEOUT_MS = 60000; // 60s

// ─────────────────────────────────────────────────────────────────────────────
// Task Priority
// ─────────────────────────────────────────────────────────────────────────────

export const TaskPriority = {
  HIGH: 0,
  NORMAL: 1,
  LOW: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// WorkerPool
// ─────────────────────────────────────────────────────────────────────────────

export class WorkerPool {
  /**
   * @param {object} [options]
   * @param {string|URL} [options.scriptUrl] - Worker script path (used with WorkerFactory default)
   * @param {object} [options.workerOptions] - Worker options (used with WorkerFactory default)
   * @param {function} [options.createWorker] - Factory function to create Worker (overrides WorkerFactory default)
   * @param {number} [options.maxWorkers=4]
   * @param {number} [options.idleTimeoutMs=30000]
   * @param {number} [options.taskTimeoutMs=60000]
   */
  constructor({
    scriptUrl,
    workerOptions = {},
    createWorker,
    maxWorkers = DEFAULT_MAX_WORKERS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
  } = {}) {
    if (typeof createWorker !== "function" && !scriptUrl) {
      throw new Error("WorkerPool requires createWorker function or scriptUrl");
    }

    const workerFactory = typeof createWorker === "function" ? createWorker : () => createDefaultWorker(scriptUrl, workerOptions);

    this._createWorker = workerFactory;
    this._maxWorkers = maxWorkers;
    this._idleTimeoutMs = idleTimeoutMs;
    this._taskTimeoutMs = taskTimeoutMs;

    /** @type {Map<number, { client: WorkerRpcClient, busy: boolean, lastUsed: number, taskCount: number }>} */
    this._workers = new Map();
    this._nextWorkerId = 0;

    /** @type {Array<{ method: string, params: any, priority: number, resolve: Function, reject: Function, signal?: AbortSignal, timeoutMs?: number, abortListener?: any }>} */
    this._taskQueue = [];

    this._idleCheckTimer = null;
    this._closed = false;
  }

  /**
   * Get pool stats
   */
  get stats() {
    let busy = 0;
    let idle = 0;
    for (const w of this._workers.values()) {
      if (w.busy) busy++;
      else idle++;
    }
    return {
      total: this._workers.size,
      busy,
      idle,
      queued: this._taskQueue.length,
      maxWorkers: this._maxWorkers,
    };
  }

  /**
   * Execute task on pool
   * @param {string} method
   * @param {any} params
   * @param {object} [options]
   * @param {number} [options.priority=TaskPriority.NORMAL]
   * @param {AbortSignal} [options.signal]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<any>}
   */
  exec(method, params, options = {}) {
    if (this._closed) {
      return Promise.reject(new Error("WorkerPool is closed"));
    }

    const { priority = TaskPriority.NORMAL, signal, timeoutMs } = options;

    if (signal?.aborted) {
      return Promise.reject(new Error("Aborted"));
    }

    return new Promise((resolve, reject) => {
      const task = { method, params, priority, resolve, reject, signal, timeoutMs, abortListener: null };

      // Insert by priority (lower = higher priority)
      let inserted = false;
      for (let i = 0; i < this._taskQueue.length; i++) {
        if (this._taskQueue[i].priority > priority) {
          this._taskQueue.splice(i, 0, task);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        this._taskQueue.push(task);
      }

      // Handle abort
      if (signal) {
        const onAbort = () => {
          const idx = this._taskQueue.indexOf(task);
          if (idx >= 0) {
            this._taskQueue.splice(idx, 1);
            reject(new Error("Aborted"));
          }
        };
        task.abortListener = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this._processQueue();
    });
  }

  /**
   * Process task queue
   * @private
   */
  _processQueue() {
    if (this._closed || this._taskQueue.length === 0) return;

    // Find idle worker
    let idleWorker = null;
    let idleWorkerId = null;
    for (const [id, w] of this._workers) {
      if (!w.busy) {
        idleWorker = w;
        idleWorkerId = id;
        break;
      }
    }

    // Create new worker if possible
    if (!idleWorker && this._workers.size < this._maxWorkers) {
      const id = this._nextWorkerId++;
      const client = new WorkerRpcClient({
        createWorker: this._createWorker,
        timeoutMs: this._taskTimeoutMs,
      });
      const workerInfo = { client, busy: false, lastUsed: Date.now(), taskCount: 0 };
      this._workers.set(id, workerInfo);
      idleWorker = workerInfo;
      idleWorkerId = id;
      logger.info("Worker created", { workerId: id, total: this._workers.size });
    }

    if (!idleWorker) {
      // All workers busy, task stays in queue
      return;
    }

    // Take next task
    const task = this._taskQueue.shift();
    if (!task) return;

    // Detach queue-level abort listener now that the task is being executed (WorkerRpcClient handles abort).
    if (task.signal && task.abortListener && typeof task.signal.removeEventListener === "function") {
      try {
        task.signal.removeEventListener("abort", task.abortListener);
      } catch {
        // ignore
      }
      task.abortListener = null;
    }

    // Skip if already aborted
    if (task.signal?.aborted) {
      task.reject(new Error("Aborted"));
      this._processQueue();
      return;
    }

    // Execute
    idleWorker.busy = true;
    idleWorker.taskCount++;

    const timeoutMs = task.timeoutMs ?? this._taskTimeoutMs;

    idleWorker.client
      .call(task.method, task.params, { timeoutMs, signal: task.signal })
      .then((result) => {
        task.resolve(result);
      })
      .catch((err) => {
        task.reject(err);
      })
      .finally(() => {
        idleWorker.busy = false;
        idleWorker.lastUsed = Date.now();
        this._processQueue();
        this._scheduleIdleCheck();
      });

    // Process more if possible
    this._processQueue();
  }

  /**
   * Schedule idle worker cleanup
   * @private
   */
  _scheduleIdleCheck() {
    if (this._idleCheckTimer || this._closed) return;

    this._idleCheckTimer = setTimeout(() => {
      this._idleCheckTimer = null;
      this._cleanupIdleWorkers();
    }, this._idleTimeoutMs);
  }

  /**
   * Cleanup idle workers
   * @private
   */
  _cleanupIdleWorkers() {
    if (this._closed) return;

    const now = Date.now();
    const toRemove = [];

    for (const [id, w] of this._workers) {
      if (!w.busy && now - w.lastUsed > this._idleTimeoutMs) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      const w = this._workers.get(id);
      if (w) {
        w.client.terminate("idle timeout");
        this._workers.delete(id);
        logger.info("Worker removed (idle)", { workerId: id, total: this._workers.size });
      }
    }

    // Schedule next check if there are still workers
    if (this._workers.size > 0) {
      this._scheduleIdleCheck();
    }
  }

  /**
   * Warm up pool with workers
   * @param {number} [count=1]
   */
  warmup(count = 1) {
    const toCreate = Math.min(count, this._maxWorkers - this._workers.size);
    for (let i = 0; i < toCreate; i++) {
      const id = this._nextWorkerId++;
      const client = new WorkerRpcClient({
        createWorker: this._createWorker,
        timeoutMs: this._taskTimeoutMs,
      });
      this._workers.set(id, { client, busy: false, lastUsed: Date.now(), taskCount: 0 });
    }
    logger.info("Pool warmed up", { created: toCreate, total: this._workers.size });
  }

  /**
   * Close all workers
   */
  close() {
    if (this._closed) return;
    this._closed = true;

    if (this._idleCheckTimer) {
      clearTimeout(this._idleCheckTimer);
      this._idleCheckTimer = null;
    }

    // Reject pending tasks
    for (const task of this._taskQueue) {
      if (task.signal && task.abortListener && typeof task.signal.removeEventListener === "function") {
        try {
          task.signal.removeEventListener("abort", task.abortListener);
        } catch {
          // ignore
        }
      }
      task.reject(new Error("WorkerPool closed"));
    }
    this._taskQueue.length = 0;

    // Terminate all workers
    for (const [id, w] of this._workers) {
      w.client.terminate("pool closed");
    }
    this._workers.clear();

    logger.info("Pool closed");
  }
}

export default WorkerPool;
