/**
 * Resource Guard - 资源配额与时间片管理
 *
 * 特性：
 * - CPU 时间片限制（通过任务计数近似）
 * - 内存配额（通过 performance.memory 或估算）
 * - 并发任务限制
 * - 配额超限回调
 */

import { createLogger } from "../../shared/index.js";

const logger = createLogger("runtime/core/resource-guard");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENT = 8;
const DEFAULT_MAX_TASKS_PER_SECOND = 100;
const DEFAULT_MAX_MEMORY_MB = 512;
const DEFAULT_CHECK_INTERVAL_MS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// ResourceGuard
// ─────────────────────────────────────────────────────────────────────────────

export class ResourceGuard {
  /**
   * @param {object} options
   * @param {number} [options.maxConcurrent=8]
   * @param {number} [options.maxTasksPerSecond=100]
   * @param {number} [options.maxMemoryMB=512]
   * @param {number} [options.checkIntervalMs=1000]
   * @param {function} [options.onQuotaExceeded] - Callback when quota exceeded
   */
  constructor({
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    maxTasksPerSecond = DEFAULT_MAX_TASKS_PER_SECOND,
    maxMemoryMB = DEFAULT_MAX_MEMORY_MB,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    onQuotaExceeded,
  } = {}) {
    this._maxConcurrent = maxConcurrent;
    this._maxTasksPerSecond = maxTasksPerSecond;
    this._maxMemoryMB = maxMemoryMB;
    this._checkIntervalMs = checkIntervalMs;
    this._onQuotaExceeded = typeof onQuotaExceeded === "function" ? onQuotaExceeded : null;

    this._currentConcurrent = 0;
    this._taskCountWindow = []; // timestamps of recent tasks
    this._checkTimer = null;
    this._paused = false;
    this._waiters = new Set();
  }

  /**
   * Get current stats
   */
  get stats() {
    const now = Date.now();
    const windowStart = now - 1000;
    const recentTasks = this._taskCountWindow.filter((t) => t > windowStart).length;

    return {
      concurrent: this._currentConcurrent,
      maxConcurrent: this._maxConcurrent,
      tasksPerSecond: recentTasks,
      maxTasksPerSecond: this._maxTasksPerSecond,
      memoryMB: this._getMemoryUsageMB(),
      maxMemoryMB: this._maxMemoryMB,
      paused: this._paused,
    };
  }

  /**
   * Check if can acquire resource
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canAcquire() {
    if (this._paused) {
      return { allowed: false, reason: "paused" };
    }

    if (this._currentConcurrent >= this._maxConcurrent) {
      return { allowed: false, reason: "max_concurrent" };
    }

    const now = Date.now();
    const windowStart = now - 1000;
    const recentTasks = this._taskCountWindow.filter((t) => t > windowStart).length;
    if (recentTasks >= this._maxTasksPerSecond) {
      return { allowed: false, reason: "rate_limit" };
    }

    const memoryMB = this._getMemoryUsageMB();
    if (memoryMB > this._maxMemoryMB) {
      return { allowed: false, reason: "memory_limit" };
    }

    return { allowed: true };
  }

  /**
   * Acquire resource slot
   * @returns {boolean} Success
   */
  acquire() {
    const check = this.canAcquire();
    if (!check.allowed) {
      this._notifyQuotaExceeded(check.reason);
      return false;
    }

    this._currentConcurrent++;
    this._taskCountWindow.push(Date.now());
    this._cleanupTaskWindow();

    return true;
  }

  /**
   * Release resource slot
   */
  release() {
    if (this._currentConcurrent > 0) {
      this._currentConcurrent--;
      this._notifyWaiters();
    }
  }

  /**
   * Wait until resource available
   * @param {object} [options]
   * @param {number} [options.timeoutMs=30000]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<void>}
   */
  async waitForSlot(options = {}) {
    const { timeoutMs = 30000, signal } = options;
    const startTime = Date.now();
    const timeoutLimit = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 30000;
    const deadline = startTime + timeoutLimit;

    while (true) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      if (this.acquire()) {
        return;
      }

      const now = Date.now();
      if (now >= deadline) {
        throw new Error("ResourceGuard timeout waiting for slot");
      }

      const check = this.canAcquire();
      const delayMs = Math.min(this._nextWaitDelay(check?.reason), Math.max(0, deadline - now));
      await this._waitForNotification(delayMs, signal);
    }
  }

  /**
   * Run task with resource guard
   * @param {function} task
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  async run(task, options = {}) {
    await this.waitForSlot(options);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  /**
   * Pause resource acquisition
   */
  pause() {
    this._paused = true;
    logger.info("ResourceGuard paused");
  }

  /**
   * Resume resource acquisition
   */
  resume() {
    this._paused = false;
    logger.info("ResourceGuard resumed");
    this._notifyWaiters();
  }

  _nextWaitDelay(reason) {
    if (reason === "rate_limit" && this._taskCountWindow.length > 0) {
      const earliest = Math.min(...this._taskCountWindow);
      const untilWindowClears = earliest + 1000 - Date.now();
      if (Number.isFinite(untilWindowClears) && untilWindowClears > 0) {
        return Math.max(1, Math.floor(untilWindowClears));
      }
    }
    const intervalMs = Number(this._checkIntervalMs);
    return Number.isFinite(intervalMs) && intervalMs >= 0 ? Math.floor(intervalMs) : 50;
  }

  _notifyWaiters() {
    if (!this._waiters.size) return;
    const waiters = Array.from(this._waiters);
    this._waiters.clear();
    for (const waiter of waiters) {
      try {
        waiter();
      } catch {
        // ignore waiter callback errors
      }
    }
  }

  async _waitForNotification(delayMs, signal) {
    const ms = Number.isFinite(delayMs) ? Math.max(0, Math.floor(delayMs)) : 0;
    return await new Promise((resolve, reject) => {
      let settled = false;
      const onWake = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Aborted"));
      };
      const timer = setTimeout(onWake, ms);
      this._waiters.add(onWake);

      if (signal?.addEventListener) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const cleanup = () => {
        clearTimeout(timer);
        this._waiters.delete(onWake);
        if (signal?.removeEventListener) {
          signal.removeEventListener("abort", onAbort);
        }
      };
    });
  }

  /**
   * Get memory usage in MB
   * @private
   */
  _getMemoryUsageMB() {
    try {
      // Chrome-specific API
      const perf = typeof performance !== "undefined"
        ? /** @type {Performance & { memory?: { usedJSHeapSize: number } }} */ (performance)
        : null;
      if (perf && perf.memory) {
        return Math.round(perf.memory.usedJSHeapSize / (1024 * 1024));
      }
    } catch {
      // Ignore
    }
    // Return 0 if not available (no enforcement)
    return 0;
  }

  /**
   * Cleanup old task timestamps
   * @private
   */
  _cleanupTaskWindow() {
    const windowStart = Date.now() - 1000;
    this._taskCountWindow = this._taskCountWindow.filter((t) => t > windowStart);
  }

  /**
   * Notify quota exceeded
   * @private
   */
  _notifyQuotaExceeded(reason) {
    if (this._onQuotaExceeded) {
      try {
        this._onQuotaExceeded({ reason, stats: this.stats });
      } catch (err) {
        logger.error("onQuotaExceeded callback error", { error: err?.message });
      }
    }
  }
}

export default ResourceGuard;
