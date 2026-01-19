/**
 * Worker RPC - 统一 Worker 通信层
 *
 * 提供类型安全的 RPC 调用，支持：
 * - 超时控制
 * - AbortSignal 取消
 * - Transferables 零拷贝
 * - 崩溃自动重建
 */

import { createLogger } from "../../shared/index.js";
import { validateRpcResponse } from "../../shared/index.js";

const logger = createLogger("runtime/core/worker-rpc");

// ─────────────────────────────────────────────────────────────────────────────
// ID Generator
// ─────────────────────────────────────────────────────────────────────────────

let _idCounter = 0;

function generateId() {
  return `rpc_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Utilities
// ─────────────────────────────────────────────────────────────────────────────

function createAbortError(message = "Aborted") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function createTimeoutError(ms) {
  const err = new Error(`RPC timeout after ${ms}ms`);
  err.name = "TimeoutError";
  return err;
}

function normalizeRemoteError(raw) {
  if (!raw) return new Error("Unknown error");
  if (typeof raw === "string") return new Error(raw);
  if (typeof raw === "object") {
    /** @type {Error & { code?: string }} */
    const err = new Error(raw.message || String(raw));
    if (raw.name) err.name = raw.name;
    if (raw.code) err.code = raw.code;
    if (raw.stack) err.stack = raw.stack;
    return err;
  }
  return new Error(String(raw));
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkerRpcClient
// ─────────────────────────────────────────────────────────────────────────────

export class WorkerRpcClient {
  /**
   * @param {object} options
   * @param {Worker} [options.worker] - Worker instance
   * @param {function} [options.createWorker] - Factory function to create worker (can return Worker or Promise<Worker>)
   * @param {number} [options.timeoutMs=30000]
   */
  constructor({ worker, createWorker, timeoutMs = 30000 } = {}) {
    this._workerInstance = worker || null;
    this._createWorker = typeof createWorker === "function" ? createWorker : null;
    this._workerPromise = null;
    this._timeoutMs = timeoutMs;
    this._pending = new Map(); // id → { resolve, reject, timer }
    this._disposed = false;
    this._boundOnMessage = this._onMessage.bind(this);
    this._boundOnError = this._onError.bind(this);
    this._boundOnExit = this._onExit.bind(this);

    if (this._workerInstance) {
      this._attachListeners(this._workerInstance);
    }
  }

  /**
   * Get current worker (public accessor for tests)
   */
  get worker() {
    return this._workerInstance;
  }

  /**
   * Get or create worker
   * @returns {Promise<Worker>}
   */
  async _getWorker() {
    if (this._workerInstance) return this._workerInstance;

    if (!this._createWorker) {
      throw new Error("No worker available");
    }

    if (this._workerPromise) return this._workerPromise;

    this._workerPromise = Promise.resolve()
      .then(() => this._createWorker())
      .then((worker) => {
        if (!worker) {
          throw new Error("createWorker returned no worker");
        }

        // If disposed while creating, try to cleanup and fail the request.
        if (this._disposed) {
          try {
            if (typeof worker.terminate === "function") worker.terminate();
          } catch {
            // ignore
          }
          throw new Error("WorkerRpcClient is disposed");
        }

        this._workerInstance = worker;
        this._attachListeners(worker);
        return worker;
      })
      .finally(() => {
        this._workerPromise = null;
      });

    return this._workerPromise;
  }

  /**
   * Attach message/error listeners
   * @param {Worker} worker
   */
  _attachListeners(worker) {
    // Prefer addEventListener if available
    if (typeof worker.addEventListener === "function") {
      worker.addEventListener("message", this._boundOnMessage);
      worker.addEventListener("error", this._boundOnError);
      if (typeof worker.addEventListener === "function") {
        worker.addEventListener("exit", this._boundOnExit);
      }
      return;
    }

    // Node.js Worker Threads (EventEmitter)
    if (typeof worker.on === "function") {
      worker.on("message", this._boundOnMessage);
      worker.on("error", this._boundOnError);
      if (typeof worker.on === "function") {
        worker.on("exit", this._boundOnExit);
      }
      return;
    } else {
      // Fallback to onmessage/onerror
      worker.onmessage = this._boundOnMessage;
      worker.onerror = this._boundOnError;
    }
  }

  /**
   * Detach listeners from worker
   * @param {Worker} worker
   */
  _detachListeners(worker) {
    if (!worker) return;
    if (typeof worker.removeEventListener === "function") {
      worker.removeEventListener("message", this._boundOnMessage);
      worker.removeEventListener("error", this._boundOnError);
      try {
        worker.removeEventListener("exit", this._boundOnExit);
      } catch {
        // ignore
      }
      return;
    }

    if (typeof worker.off === "function") {
      worker.off("message", this._boundOnMessage);
      worker.off("error", this._boundOnError);
      try {
        worker.off("exit", this._boundOnExit);
      } catch {
        // ignore
      }
      return;
    }

    if (typeof worker.removeListener === "function") {
      worker.removeListener("message", this._boundOnMessage);
      worker.removeListener("error", this._boundOnError);
      try {
        worker.removeListener("exit", this._boundOnExit);
      } catch {
        // ignore
      }
      return;
    } else {
      if (worker.onmessage === this._boundOnMessage) worker.onmessage = null;
      if (worker.onerror === this._boundOnError) worker.onerror = null;
    }
  }

  /**
   * Handle incoming messages
   * @param {MessageEvent} event
   */
  _onMessage(event) {
    const data = event?.data ?? event;
    if (!data || data.type !== "rpc:response") return;

    const pending = this._pending.get(data.id);
    if (!pending) return;

    this._pending.delete(data.id);
    clearTimeout(pending.timer);

    // Validate response structure
    const validated = validateRpcResponse(data);
    if (!validated.ok) {
      logger.warn("Invalid RPC response", { error: validated.error, id: data.id });
      pending.reject(new Error(validated.error));
      return;
    }

    if (data.ok) {
      pending.resolve(data.result);
    } else {
      pending.reject(normalizeRemoteError(data.error));
    }
  }

  /**
   * Handle worker errors
   * @param {ErrorEvent|Error} event
   */
  _onError(event) {
    const message = event?.message || String(event);
    logger.error("Worker error", { message });

    // Clear worker reference for recreation
    this._detachListeners(this._workerInstance);
    this._workerInstance = null;

    // Reject all pending calls
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this._pending.clear();
  }

  /**
   * Handle worker exit (Node.js Worker Threads)
   * @param {number} code
   */
  _onExit(code) {
    const message = code === 0 ? "Worker exited" : `Worker exited with code ${code}`;
    logger.error("Worker exit", { code, message });

    // Clear worker reference for recreation
    this._detachListeners(this._workerInstance);
    this._workerInstance = null;

    // Reject all pending calls
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this._pending.clear();
  }

  /**
   * Send cancel message to worker
   * @param {string} id
   * @param {string} reason
   */
  _sendCancel(id, reason) {
    if (!this._workerInstance) return;
    try {
      this._workerInstance.postMessage({
        type: "rpc:cancel",
        id,
        reason,
      });
    } catch {
      // Ignore send errors
    }
  }

  /**
   * Make RPC call
   * @param {string} method
   * @param {any} params
   * @param {object} [options]
   * @param {number} [options.timeoutMs]
   * @param {AbortSignal} [options.signal]
   * @param {Transferable[]} [options.transferables]
   * @returns {Promise<any>}
   */
  call(method, params, options = {}) {
    if (this._disposed) {
      return Promise.reject(new Error("WorkerRpcClient is disposed"));
    }

    const { timeoutMs = this._timeoutMs, signal, transferables } = options;

    // Validate method
    if (!method) {
      return Promise.reject(new Error("method is required"));
    }

    // Check abort before getting worker
    if (signal?.aborted) {
      const reason = signal.reason || "aborted";
      return Promise.reject(createAbortError(typeof reason === "string" ? reason : "aborted"));
    }

    // Check worker availability synchronously
    if (!this._workerInstance && !this._createWorker) {
      throw new Error("No worker available");
    }

    return new Promise((resolve, reject) => {
      const id = generateId();

      const request = {
        type: "rpc:request",
        id,
        method,
        params,
      };

      // Cleanup function
      const cleanup = () => {
        this._pending.delete(id);
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      };

      // Setup timeout
      const timer = setTimeout(() => {
        cleanup();
        this._sendCancel(id, "timeout");
        reject(createTimeoutError(timeoutMs));
      }, timeoutMs);

      // Setup abort listener
      const onAbort = () => {
        cleanup();
        const reason = signal.reason || "aborted";
        this._sendCancel(id, "aborted");
        reject(createAbortError(typeof reason === "string" ? reason : "aborted"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      // Store pending
      this._pending.set(id, {
        resolve: (result) => {
          cleanup();
          resolve(result);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        timer,
      });

      // Fast path: if we already have a worker instance, send synchronously.
      // This keeps call() "fire-and-forget" scheduling deterministic for tests
      // and avoids races with dispose() clearing pending calls.
      if (this._workerInstance) {
        // Request already timed out / aborted
        if (!this._pending.has(id)) return;

        // Double-check abort before sending
        if (signal?.aborted) {
          onAbort();
          return;
        }

        try {
          if (transferables?.length) {
            this._workerInstance.postMessage(request, transferables);
          } else {
            this._workerInstance.postMessage(request);
          }
        } catch (err) {
          cleanup();
          reject(err);
        }
        return;
      }

      // Ensure worker and send request (supports async createWorker)
      Promise.resolve()
        .then(() => this._getWorker())
        .then((worker) => {
          // Request already timed out / aborted
          if (!this._pending.has(id)) return;

          // Double-check abort after async worker creation
          if (signal?.aborted) {
            onAbort();
            return;
          }

          try {
            if (transferables?.length) {
              worker.postMessage(request, transferables);
            } else {
              worker.postMessage(request);
            }
          } catch (err) {
            cleanup();
            reject(err);
          }
        })
        .catch((err) => {
          if (!this._pending.has(id)) return;
          cleanup();
          reject(err);
        });
    });
  }

  /**
   * Dispose client and underlying worker
   * - Rejects and clears all pending calls
   * - Detaches listeners
   * - Terminates worker if supported
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    const disposeError = new Error("WorkerRpcClient is disposed");

    // Reject all pending calls (also removes AbortSignal listeners via cleanup)
    for (const pending of Array.from(this._pending.values())) {
      try {
        pending.reject(disposeError);
      } catch {
        // ignore
      }
    }
    this._pending.clear();

    const worker = this._workerInstance;
    if (worker) {
      this._detachListeners(worker);
      if (typeof worker.terminate === "function") {
        try {
          worker.terminate();
        } catch {
          // ignore terminate errors
        }
      }
      this._workerInstance = null;
    }
  }

  /**
   * Terminate worker
   * @param {string} [reason] - Reason for termination
   */
  terminate(reason) {
    const errorMessage = reason || "Worker terminated";

    if (this._workerInstance) {
      this._detachListeners(this._workerInstance);
      if (typeof this._workerInstance.terminate === "function") {
        this._workerInstance.terminate();
      }
      this._workerInstance = null;
    }

    // Reject all pending
    for (const [id, pending] of this._pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(errorMessage));
    }
    this._pending.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Side Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create RPC handler for worker side
 * @param {Object<string, function>} methods - Method implementations
 * @returns {function} Message handler
 */
export function createRpcHandler(methods) {
  const inFlight = new Map(); // id -> AbortController

  return async function handleMessage(event) {
    const data = event.data;
    if (!data) return;

    if (data.type === "rpc:cancel") {
      const id = typeof data.id === "string" ? data.id : "";
      if (!id) return;

      const controller = inFlight.get(id);
      if (!controller) return;

      try {
        controller.abort(data.reason || "cancelled");
      } catch {
        controller.abort();
      } finally {
        inFlight.delete(id);
      }
      return;
    }

    if (data.type !== "rpc:request") return;

    const id = typeof data.id === "string" ? data.id : "";
    const method = typeof data.method === "string" ? data.method : "";
    const params = data.params;
    if (!id || !method) return;

    const controller = new AbortController();
    inFlight.set(id, controller);

    try {
      const fn = methods[method];
      if (typeof fn !== "function") {
        throw new Error(`Unknown method: ${method}`);
      }

      const result = await fn(params, { signal: controller.signal, id, method });
      if (controller.signal.aborted) return;

      self.postMessage({
        type: "rpc:response",
        id,
        ok: true,
        result,
      });
    } catch (err) {
      if (controller.signal.aborted) return;

      self.postMessage({
        type: "rpc:response",
        id,
        ok: false,
        error: err?.message || String(err),
      });
    } finally {
      inFlight.delete(id);
    }
  };
}

export default WorkerRpcClient;
