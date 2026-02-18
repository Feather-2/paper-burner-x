/**
 * Worker Factory - 跨平台 Worker 创建
 *
 * 自动选择 Web Worker (Browser) 或 Worker Threads (Node.js/Bun)
 */

import { isNodeLike, makeSecureTimestampedId } from "../../shared/index.js";

function toNonEmptyString(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

/**
 * 检测 Worker 是否可用
 * @returns {boolean} 是否支持 Worker
 */
export function isWorkerSupported() {
  if (isNodeLike()) {
    // Node.js/Bun 总是支持 worker_threads
    return true;
  }
  return typeof Worker !== "undefined";
}

/**
 * @param {string|URL} scriptUrl
 * @param {object} options
 * @returns {string}
 */
function resolveWorkerId(scriptUrl, options = {}) {
  const explicitWorkerId = toNonEmptyString(options.workerId);
  if (explicitWorkerId) return explicitWorkerId;

  if (typeof options.workerIdFactory === "function") {
    try {
      const generated = toNonEmptyString(options.workerIdFactory({
        scriptUrl: String(scriptUrl),
        runId: options.runId,
      }));
      if (generated) return generated;
    } catch {
      // ignore and fallback to secure-id
    }
  }

  return makeSecureTimestampedId("worker", { allowInsecureFallback: true });
}

/**
 * 创建 Worker
 * @param {string|URL} scriptUrl - Worker 脚本路径
 * @param {object} options - Worker 选项
 * @param {object} [options.eventBus] - EventBus for lifecycle events
 * @param {string} [options.workerId] - Worker ID for correlation
 * @param {string} [options.runId] - Run ID for correlation
 * @returns {Promise<Worker>}
 */
export async function createWorker(scriptUrl, options = {}) {
  const workerId = resolveWorkerId(scriptUrl, options);
  const { eventBus, runId } = options;

  // P0: 发射 worker:lifecycle:creating 事件
  if (eventBus && typeof eventBus.emit === "function") {
    eventBus.emit("worker:lifecycle:creating", {
      workerId,
      scriptUrl: String(scriptUrl),
      runId,
      timestamp: Date.now(),
    });
  }

  try {
    let worker;
    if (isNodeLike()) {
      // @ts-ignore
      const { Worker } = await import(/* @vite-ignore */ "node:worker_threads");
      worker = new Worker(scriptUrl, {
        ...options,
        // Node.js Worker Threads 特定选项
        workerData: options.workerData,
      });
    } else {
      // Browser Web Worker
      worker = new globalThis.Worker(scriptUrl, {
        type: options.type || "module",
        ...options,
      });
    }

    // P0: 附加 workerId 到 worker 实例
    if (worker && typeof worker === "object") {
      Object.defineProperty(worker, "_workerId", {
        value: workerId,
        writable: false,
        enumerable: false,
        configurable: false,
      });
    }

    // P0: 发射 worker:lifecycle:created 事件
    if (eventBus && typeof eventBus.emit === "function") {
      eventBus.emit("worker:lifecycle:created", {
        workerId,
        scriptUrl: String(scriptUrl),
        runId,
        timestamp: Date.now(),
      });
    }

    return worker;
  } catch (err) {
    // P0: 发射 worker:lifecycle:error 事件
    if (eventBus && typeof eventBus.emit === "function") {
      eventBus.emit("worker:lifecycle:error", {
        workerId,
        scriptUrl: String(scriptUrl),
        runId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
    }
    throw err;
  }
}

/**
 * 终止 Worker
 * @param {Worker} worker
 * @param {object} [options]
 * @param {object} [options.eventBus] - EventBus for lifecycle events
 * @param {string} [options.runId] - Run ID for correlation
 * @returns {Promise<void>}
 */
export async function terminateWorker(worker, options = {}) {
  if (!worker) return;

  const workerId = worker._workerId || "unknown";
  const { eventBus, runId } = options;

  // P0: 发射 worker:lifecycle:terminating 事件
  if (eventBus && typeof eventBus.emit === "function") {
    eventBus.emit("worker:lifecycle:terminating", {
      workerId,
      runId,
      timestamp: Date.now(),
    });
  }

  try {
    if (typeof worker.terminate === "function") {
      // Node.js Worker.terminate() 返回 Promise；浏览器返回 void
      await worker.terminate();
    }

    // P0: 发射 worker:lifecycle:terminated 事件
    if (eventBus && typeof eventBus.emit === "function") {
      eventBus.emit("worker:lifecycle:terminated", {
        workerId,
        runId,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    // P0: 发射 worker:lifecycle:error 事件
    if (eventBus && typeof eventBus.emit === "function") {
      eventBus.emit("worker:lifecycle:error", {
        workerId,
        runId,
        error: err instanceof Error ? err.message : String(err),
        phase: "termination",
        timestamp: Date.now(),
      });
    }
    throw err;
  }
}
