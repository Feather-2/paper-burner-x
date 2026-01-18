/**
 * Worker Factory - 跨平台 Worker 创建
 *
 * 自动选择 Web Worker (Browser) 或 Worker Threads (Node.js/Bun)
 */

import { isNodeLike } from "../../shared/platform.js";

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
 * 创建 Worker
 * @param {string|URL} scriptUrl - Worker 脚本路径
 * @param {object} options - Worker 选项
 * @returns {Promise<Worker>}
 */
export async function createWorker(scriptUrl, options = {}) {
  if (isNodeLike()) {
    const { Worker } = await import(/* @vite-ignore */ "node:worker_threads");
    return new Worker(scriptUrl, {
      ...options,
      // Node.js Worker Threads 特定选项
      workerData: options.workerData,
    });
  }

  // Browser Web Worker
  return new globalThis.Worker(scriptUrl, {
    type: options.type || "module",
    ...options,
  });
}

/**
 * 终止 Worker
 * @param {Worker} worker
 * @returns {Promise<void>}
 */
export async function terminateWorker(worker) {
  if (!worker) return;

  if (typeof worker.terminate === "function") {
    const result = worker.terminate();
    // Node.js Worker.terminate() 返回 Promise
    if (result?.then) await result;
  }
}

