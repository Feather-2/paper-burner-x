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

function isAbortSignalLike(signal) {
  return !!signal && typeof signal === "object" && typeof signal.aborted === "boolean" && typeof signal.addEventListener === "function";
}

/**
 * @param {unknown} timeoutMs
 * @param {number} fallback
 * @returns {number}
 */
function normalizeTimeoutMs(timeoutMs, fallback) {
  const parsed = Number(timeoutMs);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized <= 0) return fallback;
  return normalized;
}

function normalizeRemoteError(raw) {
  if (!raw) return new Error("Unknown error");
  if (typeof raw === "string") return new Error(raw);
  if (typeof raw === "object") {
    /** @type {Error & { code?: string; status?: number; retryable?: boolean; category?: string; context?: Record<string, any> }} */
    const err = new Error(raw.message || String(raw));
    if (raw.name) err.name = raw.name;
    if (raw.code) err.code = raw.code;
    if (raw.stack) err.stack = raw.stack;
    // P0: 保留错误分类与可重试性字段
    if (typeof raw.status === "number") err.status = raw.status;
    if (typeof raw.retryable === "boolean") err.retryable = raw.retryable;
    if (typeof raw.category === "string") err.category = raw.category;
    if (raw.context && typeof raw.context === "object") err.context = raw.context;
    return err;
  }
  return new Error(String(raw));
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkerRpcClient
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal "Worker-like" interface that works for both:
 * - Web Workers (`addEventListener`, `removeEventListener`)
 * - Node.js `worker_threads` (`on`, `off`, `removeListener`)
 *
 * @typedef {object} WorkerRpcWorker
 * @property {(message: any, transferList?: Transferable[]) => void} postMessage
 * @property {(() => unknown) | undefined} [terminate]
 * @property {(type: string, listener: (ev: any) => void, options?: any) => void} [addEventListener]
 * @property {(type: string, listener: (ev: any) => void, options?: any) => void} [removeEventListener]
 * @property {(event: string, listener: (...args: any[]) => void) => void} [on]
 * @property {(event: string, listener: (...args: any[]) => void) => void} [off]
 * @property {(event: string, listener: (...args: any[]) => void) => void} [removeListener]
 * @property {((ev: any) => void) | null | undefined} [onmessage]
 * @property {((ev: any) => void) | null | undefined} [onerror]
 * @property {string} [_workerId]
 */

export class WorkerRpcClient {
  /** @type {WorkerRpcWorker | null} */
  _workerInstance;
  /** @type {(() => WorkerRpcWorker | Promise<WorkerRpcWorker>) | null} */
  _createWorker;
  /** @type {Promise<WorkerRpcWorker> | null} */
  _workerPromise;
  /** @type {number} */
  _timeoutMs;
  /** @type {Map<string, { resolve: (v: any) => void, reject: (e: any) => void, timer: any }>} */
  _pending;
  /** @type {boolean} */
  _disposed;
  /** @type {(event: any) => void} */
  _boundOnMessage;
  /** @type {(event: any) => void} */
  _boundOnError;
  /** @type {(code: any) => void} */
  _boundOnExit;

  /**
   * @param {object} options
   * @param {WorkerRpcWorker} [options.worker] - Worker instance
   * @param {(() => WorkerRpcWorker | Promise<WorkerRpcWorker>)} [options.createWorker] - Factory function to create worker (can return Worker or Promise<WorkerRpcWorker>)
   * @param {number} [options.timeoutMs=30000]
   * @param {object} [options.eventBus] - EventBus for RPC error events
   */
  constructor({ worker, createWorker, timeoutMs = 30000, eventBus } = {}) {
    this._workerInstance = worker || null;
    this._createWorker = typeof createWorker === "function" ? createWorker : null;
    this._workerPromise = null;
    this._timeoutMs = normalizeTimeoutMs(timeoutMs, 30_000);
    this._eventBus = eventBus || null;
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
   * @returns {Promise<WorkerRpcWorker>}
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
   * @param {WorkerRpcWorker} worker
   */
  _attachListeners(worker) {
    // Prefer addEventListener if available
    if (typeof worker.addEventListener === "function") {
      worker.addEventListener("message", this._boundOnMessage);
      worker.addEventListener("error", this._boundOnError);
      worker.addEventListener("exit", this._boundOnExit);
      return;
    }

    // Node.js Worker Threads (EventEmitter)
    if (typeof worker.on === "function") {
      worker.on("message", this._boundOnMessage);
      worker.on("error", this._boundOnError);
      worker.on("exit", this._boundOnExit);
      return;
    } else {
      // Fallback to onmessage/onerror
      worker.onmessage = this._boundOnMessage;
      worker.onerror = this._boundOnError;
    }
  }

  /**
   * Detach listeners from worker
   * @param {WorkerRpcWorker} worker
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

    // Validate response structure (best-effort; ignore invalid frames)
    let validated;
    try {
      validated = validateRpcResponse(data);
    } catch (err) {
      logger.warn("Invalid RPC response", { error: String(err), id: data.id });
      return;
    }

    if (validated?.ok === false) {
      const error = typeof validated.error === "string" ? validated.error : "Invalid RPC response";
      logger.warn("Invalid RPC response", { error, id: data.id });
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

    // P1: Emit worker:rpc:error event
    const workerId = this._workerInstance?._workerId || "unknown";
    if (this._eventBus && typeof this._eventBus.emit === "function") {
      try {
        this._eventBus.emit("worker:rpc:error", {
          workerId,
          error: message,
          pendingCount: this._pending.size,
          timestamp: Date.now(),
        });
      } catch {
        // ignore
      }
    }

    // Clear worker reference for recreation
    const worker = this._workerInstance;
    this._detachListeners(worker);
    if (this._workerInstance === worker) {
      this._workerInstance = null;
    }

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
    const worker = this._workerInstance;
    this._detachListeners(worker);
    if (this._workerInstance === worker) {
      this._workerInstance = null;
    }

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
   * @param {object} [options.eventBus] - EventBus for task events
   * @param {string} [options.runId] - Run ID for correlation
   * @param {string} [options.stage] - Stage name for correlation
   * @returns {Promise<any>}
   */
  call(method, params, options = {}) {
    if (this._disposed) {
      return Promise.reject(new Error("WorkerRpcClient is disposed"));
    }

    const normalizedTimeoutMs = normalizeTimeoutMs(options.timeoutMs, this._timeoutMs);
    const { signal, transferables, eventBus, runId, stage } = options;
    const abortSignal = isAbortSignalLike(signal) ? signal : null;

    // Validate method
    if (!method) {
      return Promise.reject(new Error("method is required"));
    }

    // Check abort before getting worker
    if (abortSignal?.aborted) {
      const reason = abortSignal.reason || "aborted";
      return Promise.reject(createAbortError(typeof reason === "string" ? reason : "aborted"));
    }

    // Check worker availability synchronously
    if (!this._workerInstance && !this._createWorker) {
      throw new Error("No worker available");
    }

    return new Promise((resolve, reject) => {
      const id = generateId();
      const workerId = this._workerInstance?._workerId || "unknown";
      const taskStartTime = Date.now();
      let abortListenerAttached = false;

      // P0: 发射 worker:task:start 事件
      if (eventBus && typeof eventBus.emit === "function") {
        eventBus.emit("worker:task:start", {
          workerId,
          workerTaskId: id,
          method,
          runId,
          stage,
          timestamp: taskStartTime,
        });
      }

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
        if (!abortListenerAttached || !abortSignal || typeof abortSignal.removeEventListener !== "function") return;
        abortListenerAttached = false;
        try {
          abortSignal.removeEventListener("abort", onAbort);
        } catch {
          // ignore cleanup errors
        }
      };

      // Setup timeout
      const timer = setTimeout(() => {
        cleanup();
        this._sendCancel(id, "timeout");
        const error = createTimeoutError(normalizedTimeoutMs);
        // P0: 发射 worker:task:error 事件
        if (eventBus && typeof eventBus.emit === "function") {
          eventBus.emit("worker:task:error", {
            workerId,
            workerTaskId: id,
            method,
            runId,
            stage,
            error: error.message,
            reason: "timeout",
            durationMs: Date.now() - taskStartTime,
            timestamp: Date.now(),
          });
        }
        reject(error);
      }, normalizedTimeoutMs);

      // Setup abort listener
      const onAbort = () => {
        cleanup();
        const reason = abortSignal?.reason || "aborted";
        this._sendCancel(id, "aborted");
        const error = createAbortError(typeof reason === "string" ? reason : "aborted");
        // P0: 发射 worker:task:error 事件
        if (eventBus && typeof eventBus.emit === "function") {
          eventBus.emit("worker:task:error", {
            workerId,
            workerTaskId: id,
            method,
            runId,
            stage,
            error: error.message,
            reason: "aborted",
            durationMs: Date.now() - taskStartTime,
            timestamp: Date.now(),
          });
        }
        reject(error);
      };

      if (abortSignal) {
        try {
          abortSignal.addEventListener("abort", onAbort, { once: true });
          abortListenerAttached = true;
        } catch {
          // ignore invalid abort signal implementations
        }
      }

      // Store pending
      this._pending.set(id, {
        resolve: (result) => {
          cleanup();
          // P0: 发射 worker:task:end 事件
          if (eventBus && typeof eventBus.emit === "function") {
            eventBus.emit("worker:task:end", {
              workerId,
              workerTaskId: id,
              method,
              runId,
              stage,
              success: true,
              durationMs: Date.now() - taskStartTime,
              timestamp: Date.now(),
            });
          }
          resolve(result);
        },
        reject: (error) => {
          cleanup();
          // P0: 发射 worker:task:error 事件
          if (eventBus && typeof eventBus.emit === "function") {
            eventBus.emit("worker:task:error", {
              workerId,
              workerTaskId: id,
              method,
              runId,
              stage,
              error: error instanceof Error ? error.message : String(error),
              reason: "execution_failed",
              durationMs: Date.now() - taskStartTime,
              timestamp: Date.now(),
            });
          }
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
        if (abortSignal?.aborted) {
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
          if (abortSignal?.aborted) {
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

  /**
   * Backward-compatible alias for terminate()
   * @param {string} [reason]
   */
  destroy(reason) {
    this.terminate(reason || "Worker destroyed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Side Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create RPC handler for worker side
 * @param {Object<string, function>} methods - Method implementations
 * @param {{
 *   postMessage?: (message: any) => void,
 *   target?: { postMessage?: (message: any) => void } | null,
 *   cancelWatchdogMs?: number,
 *   onNonCooperativeCancel?: (info: { id: string, method: string, elapsedMs: number }) => void
 * }} [options]
 * @returns {function} Message handler
 */
export function createRpcHandler(methods, options = {}) {
  /** @type {Map<string, { controller: AbortController, method: string, cancelledAt?: number, watchdogTimer?: ReturnType<typeof setTimeout> | null }>} */
  const inFlight = new Map();
  const cancelWatchdogMs = normalizeTimeoutMs(options.cancelWatchdogMs, 1000);
  const postMessageFn = typeof options.postMessage === "function"
    ? options.postMessage
    : (typeof options?.target?.postMessage === "function"
      ? options.target.postMessage.bind(options.target)
      : (typeof self !== "undefined" && typeof self.postMessage === "function"
        ? self.postMessage.bind(self)
        : (typeof globalThis?.postMessage === "function" ? globalThis.postMessage.bind(globalThis) : null)));

  const safePost = (message) => {
    if (typeof postMessageFn !== "function") return false;
    try {
      postMessageFn(message);
      return true;
    } catch {
      return false;
    }
  };

  return async function handleMessage(event) {
    const data = event?.data ?? event;
    if (!data) return;

    if (data.type === "rpc:cancel") {
      const id = typeof data.id === "string" ? data.id : "";
      if (!id) return;

      const inflight = inFlight.get(id);
      if (!inflight) return;

      try {
        inflight.controller.abort(data.reason || "cancelled");
      } catch {
        inflight.controller.abort();
      }

      if (!inflight.watchdogTimer && cancelWatchdogMs > 0) {
        inflight.cancelledAt = Date.now();
        inflight.watchdogTimer = setTimeout(() => {
          const current = inFlight.get(id);
          if (!current) return;
          const elapsedMs = Date.now() - (current.cancelledAt || Date.now());
          const info = { id, method: current.method, elapsedMs };
          try {
            options.onNonCooperativeCancel?.(info);
          } catch {
            // ignore monitor hook failures
          }
          safePost({
            type: "rpc:cancel:noncooperative",
            id,
            method: current.method,
            elapsedMs,
          });
        }, cancelWatchdogMs);
      }
      return;
    }

    if (data.type !== "rpc:request") return;

    const id = typeof data.id === "string" ? data.id : "";
    const method = typeof data.method === "string" ? data.method : "";
    const params = data.params;
    if (!id || !method) return;

    const controller = new AbortController();
    inFlight.set(id, { controller, method, cancelledAt: undefined, watchdogTimer: null });

    try {
      const fn = methods[method];
      if (typeof fn !== "function") {
        throw new Error(`Unknown method: ${method}`);
      }

      const result = await fn(params, { signal: controller.signal, id, method });
      if (controller.signal.aborted) return;

      safePost({
        type: "rpc:response",
        id,
        ok: true,
        result,
      });
    } catch (err) {
      if (controller.signal.aborted) return;

      safePost({
        type: "rpc:response",
        id,
        ok: false,
        error: err?.message || String(err),
      });
    } finally {
      const inflight = inFlight.get(id);
      if (inflight?.watchdogTimer) {
        clearTimeout(inflight.watchdogTimer);
      }
      inFlight.delete(id);
    }
  };
}

export default WorkerRpcClient;
