/**
 * Sandbox Pool - 沙箱池化管理
 *
 * 复用沙箱实例，减少初始化开销。
 * 支持按能力组合分组池化。
 */

import { WasmSandbox } from './wasm-sandbox.js';
import { SandboxPreset, ResourceLimits } from './constants.js';
import { ResourceLock } from './resource-lock.js';
import { createLogger } from "../../shared/index.js";

const logger = createLogger("core/sandbox/pool");

/**
 * SandboxPool - 沙箱对象池
 */
export class SandboxPool {
  /**
   * @param {Object} options
   * @param {number} [options.maxSize=4] - 池最大容量
   * @param {number} [options.maxActive] - 最大并发（获取中的沙箱数）；默认等于 maxSize
   * @param {number} [options.idleTimeoutMs=60000] - 空闲超时
   * @param {number} [options.acquireTimeoutMs=30000] - 等待队列超时
   * @param {number} [options.maxConsecutiveFailures=8] - 等待队列连续初始化失败阈值
   * @param {string[]} [options.defaultCapabilities] - 默认能力
   * @param {Object} [options.defaultLimits] - 默认资源限制
   * @param {number} [options.preWarmCount=2] - 预热实例数（默认 2，减少冷启动）
   * @param {boolean} [options.enableResourceLock=true] - 启用资源锁防护
   * @param {boolean} [options.enableMemoryMonitoring=true] - 启用内存泄漏监控
   * @param {number} [options.memoryCheckIntervalMs=30000] - 内存检查间隔
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || 4;
    this.maxActive = Math.max(1, options.maxActive || this.maxSize);
    this.idleTimeoutMs = options.idleTimeoutMs || 60000;
    this.acquireTimeoutMs = options.acquireTimeoutMs || 30000;
    this.defaultCapabilities = options.defaultCapabilities || SandboxPreset.SKILL;
    this.defaultLimits = options.defaultLimits || ResourceLimits.STANDARD;
    this.preWarmCount = options.preWarmCount !== undefined ? options.preWarmCount : 2;

    // 按能力 key 分组的池
    this._pools = new Map();
    this._totalCount = 0;
    this._inUseCount = 0;
    /** @type {Array<{ key: string, options: any, resolve: (sb: WasmSandbox) => void, reject: (err: any) => void, priority: number, timestamp: number }>} */
    this._waitQueue = [];
    this._draining = false;
    this._disposed = false;
    this._consecutiveFailures = 0;
    this._maxConsecutiveFailures = Math.max(1, Number(options.maxConsecutiveFailures) || 8);

    // 资源锁（防止多进程访问同一沙箱资源）
    // 默认禁用，仅在多进程场景下需要启用
    this._enableResourceLock = options.enableResourceLock === true;
    this._resourceLock = this._enableResourceLock ? new ResourceLock() : null;
    /** @type {Map<WasmSandbox, import('./resource-lock.js').LockHandle>} */
    this._sandboxLocks = new Map();
    this._sandboxIdCounter = 0;

    // 内存监控
    this._enableMemoryMonitoring = options.enableMemoryMonitoring !== false;
    this._memoryCheckIntervalMs = options.memoryCheckIntervalMs || 30000;
    this._memoryCheckTimer = null;
    this._memoryBaseline = null;
    /** @type {Set<ReturnType<typeof setTimeout>>} tracks all pending timers for leak-safe disposal */
    this._pendingTimers = new Set();
    if (this._enableMemoryMonitoring && typeof performance !== 'undefined' && performance.memory) {
      this._startMemoryMonitoring();
    }

    // 自动预热
    if (this.preWarmCount > 0) {
      this.warmUp(this.preWarmCount).catch(err => {
        logger.error('Pre-warm failed', { error: err?.message });
      });
    }
  }

  /**
   * 生成能力 key
   */
  _getCapabilityKey(capabilities) {
    return [...capabilities].sort().join(',');
  }

  /** @private track a setTimeout and auto-remove on fire */
  _tracked(fn, ms) {
    if (this._disposed) return null;
    const id = setTimeout(() => {
      this._pendingTimers.delete(id);
      fn();
    }, ms);
    this._pendingTimers.add(id);
    return id;
  }

  /** @private cancel a tracked timer */
  _cancelTracked(id) {
    if (id != null) {
      clearTimeout(id);
      this._pendingTimers.delete(id);
    }
  }

  /**
   * 获取沙箱
   * @param {Object} options
   * @param {number} [options.priority=0] - 任务优先级（数值越大优先级越高）
   * @returns {Promise<WasmSandbox>}
   */
  async acquire(options = {}) {
    if (this._disposed) throw new Error('Pool has been disposed');

    const capabilities = options.capabilities || this.defaultCapabilities;
    const limits = { ...this.defaultLimits, ...options.limits };
    const key = this._getCapabilityKey(capabilities);
    const priority = typeof options.priority === 'number' ? options.priority : 0;

    // 并发限制：达到上限时统一进入等待队列（无论池中是否有空闲实例）
    if (this._inUseCount >= this.maxActive) {
      return await new Promise((resolve, reject) => {
        const timeoutId = this._tracked(() => {
          const idx = this._waitQueue.findIndex(w => w.timeoutId === timeoutId);
          if (idx !== -1) {
            this._waitQueue.splice(idx, 1);
            reject(new Error(`Sandbox acquire timeout after ${this.acquireTimeoutMs}ms`));
          }
        }, this.acquireTimeoutMs);
        this._waitQueue.push({
          key,
          options: { ...options, capabilities, limits },
          resolve,
          reject,
          timeoutId,
          priority,
          timestamp: Date.now()
        });
        // 按优先级排序（高优先级在前，同优先级按时间戳 FIFO）
        this._waitQueue.sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          return a.timestamp - b.timestamp;
        });
        this._scheduleDrain();
      });
    }

    // 尝试从池中获取
    const pool = this._pools.get(key);
    if (pool && pool.length > 0) {
      const entry = pool.pop();
      this._cancelTracked(entry.timeoutId);
      entry.sandbox.recycle({
        state: options.state || {},
        onLog: options.onLog || (() => {}),
        onEmit: options.onEmit || (() => {}),
        limits,
      });
      await entry.sandbox.init();
      this._consecutiveFailures = 0;
      this._inUseCount++;
      return entry.sandbox;
    }

    // 创建新沙箱
    let lockHandle = null;
    if (this._resourceLock) {
      const sandboxId = `sandbox-${this._sandboxIdCounter++}`;
      lockHandle = await this._resourceLock.acquire(sandboxId);
    }

    const sandbox = new WasmSandbox({
      capabilities,
      limits,
      state: options.state,
      onLog: options.onLog,
      onEmit: options.onEmit,
    });

    try {
      await sandbox.init();
      this._consecutiveFailures = 0;
      this._totalCount++;
      this._inUseCount++;

      if (lockHandle) {
        this._sandboxLocks.set(sandbox, lockHandle);
      }

      return sandbox;
    } catch (err) {
      // 初始化失败，释放锁
      if (lockHandle) {
        await lockHandle.release();
      }
      throw err;
    }
  }

  _scheduleDrain() {
    if (this._draining) return;
    this._draining = true;
    Promise.resolve()
      .then(() => this._drainWaitQueue())
      .catch((err) => {
        logger.error("SandboxPool drain failed", { error: err?.message, stack: err?.stack });
        this._rejectAllWaiters(err);
      })
      .finally(() => {
        this._draining = false;
        if (!this._disposed && this._waitQueue.length && this._inUseCount < this.maxActive) {
          this._scheduleDrain();
        }
      });
  }

  _rejectAllWaiters(err) {
    const waiters = this._waitQueue.splice(0, this._waitQueue.length);
    if (!waiters.length) return;

    const error = err instanceof Error ? err : new Error(err ? String(err) : "SandboxPool drain failed");
    for (const waiter of waiters) {
      try {
        this._cancelTracked(waiter?.timeoutId);
        waiter?.reject?.(error);
      } catch {
        // ignore
      }
    }
  }

  async _drainWaitQueue() {
    while (!this._disposed && this._waitQueue.length && this._inUseCount < this.maxActive) {
      const waiter = this._waitQueue.shift();
      if (!waiter) break;

      const { key, options, resolve, reject, timeoutId } = waiter;
      this._cancelTracked(timeoutId);

      let sandbox = null;
      let lockHandle = null;
      let isNewSandbox = false;
      try {
        const capabilities = options?.capabilities || this.defaultCapabilities;
        const limits = options?.limits || this.defaultLimits;

        const pool = this._pools.get(key);
        if (pool && pool.length > 0) {
          const entry = pool.pop();
          this._cancelTracked(entry.timeoutId);
          sandbox = entry.sandbox;
        }

        if (!sandbox) {
          // 只在创建新沙箱时获取锁
          if (this._resourceLock) {
            const sandboxId = `sandbox-${this._sandboxIdCounter++}`;
            lockHandle = await this._resourceLock.acquire(sandboxId);
          }

          sandbox = new WasmSandbox({
            capabilities,
            limits,
            state: options?.state,
            onLog: options?.onLog,
            onEmit: options?.onEmit,
          });
          this._totalCount++;
          isNewSandbox = true;
        }

        sandbox.recycle({
          state: options?.state || {},
          onLog: options?.onLog || (() => {}),
          onEmit: options?.onEmit || (() => {}),
          limits,
        });

        await sandbox.init();
        this._consecutiveFailures = 0;
        this._inUseCount++;

        if (lockHandle) {
          this._sandboxLocks.set(sandbox, lockHandle);
        }

        resolve(sandbox);
      } catch (err) {
        this._consecutiveFailures++;
        reject(err);

        // 释放锁
        if (lockHandle) {
          lockHandle.release().catch(() => {});
        }

        if (sandbox && isNewSandbox) {
          try {
            sandbox.dispose();
          } catch (err) {
            logger.debug("Failed to dispose sandbox", { error: err?.message });
          }
          this._totalCount = Math.max(0, this._totalCount - 1);
        }
        if (this._consecutiveFailures >= this._maxConsecutiveFailures) {
          const failure = new Error(
            `SandboxPool wait queue aborted after ${this._consecutiveFailures} consecutive initialization failures`
          );
          logger.error("SandboxPool consecutive init failures exceeded threshold", {
            consecutiveFailures: this._consecutiveFailures,
            maxConsecutiveFailures: this._maxConsecutiveFailures,
            waiting: this._waitQueue.length,
            error: err?.message,
          });
          this._rejectAllWaiters(failure);
          break;
        }
      }
    }
  }

  /**
   * 归还沙箱
   * @param {WasmSandbox} sandbox
   */
  release(sandbox) {
    if (this._inUseCount > 0) this._inUseCount--;
    if (this._disposed || !sandbox || sandbox._disposed) return;

    const key = this._getCapabilityKey(sandbox.capabilities);

    let pool = this._pools.get(key);
    if (!pool) {
      pool = [];
      this._pools.set(key, pool);
    }

    // If there is a queued waiter for the same key, hand over directly (avoids dispose-on-full waste).
    const waiterIndex = this._waitQueue.findIndex((w) => w && w.key === key);
    if (waiterIndex !== -1) {
      const waiter = this._waitQueue.splice(waiterIndex, 1)[0];
      this._cancelTracked(waiter.timeoutId);
      sandbox.recycle({
        state: waiter?.options?.state || {},
        onLog: waiter?.options?.onLog || (() => {}),
        onEmit: waiter?.options?.onEmit || (() => {}),
        limits: waiter?.options?.limits || this.defaultLimits,
      });
      sandbox
        .init()
        .then(() => {
          this._consecutiveFailures = 0;
          this._inUseCount++;
          waiter.resolve(sandbox);
        })
        .catch((err) => {
          try {
            sandbox.dispose();
          } catch {
            // ignore
          }
          this._totalCount = Math.max(0, this._totalCount - 1);
          waiter.reject(err);
        })
        .finally(() => this._scheduleDrain());
      return;
    }

    // 检查池容量
    if (pool.length >= this.maxSize) {
      sandbox.dispose();
      this._totalCount = Math.max(0, this._totalCount - 1);
      return;
    }

    // 清理状态（重置 VM）
    sandbox.recycle({ state: {}, onLog: () => {}, onEmit: () => {}, limits: this.defaultLimits });

    // 设置空闲超时
    const timeoutId = this._tracked(() => {
      const idx = pool.findIndex(e => e.sandbox === sandbox);
      if (idx !== -1) {
        pool.splice(idx, 1);
        sandbox.dispose();
        this._totalCount = Math.max(0, this._totalCount - 1);
      }
    }, this.idleTimeoutMs);

    pool.push({ sandbox, timeoutId });
    this._scheduleDrain();
  }

  /**
   * 使用后自动归还的执行
   */
  async withSandbox(options, fn) {
    const sandbox = await this.acquire(options);
    try {
      return await fn(sandbox);
    } finally {
      this.release(sandbox);
    }
  }

  /**
   * 预热池 - 预创建指定数量的沙箱实例
   * @param {number} count - 预热数量
   * @param {Object} [options] - 沙箱选项
   * @returns {Promise<void>}
   */
  async warmUp(count, options = {}) {
    if (this._disposed) throw new Error('Pool has been disposed');
    const capabilities = options.capabilities || this.defaultCapabilities;
    const limits = { ...this.defaultLimits, ...options.limits };
    const key = this._getCapabilityKey(capabilities);

    const toCreate = Math.min(count, this.maxSize);
    const sandboxes = [];

    for (let i = 0; i < toCreate; i++) {
      const sandbox = new WasmSandbox({ capabilities, limits, state: {}, onLog: () => {}, onEmit: () => {} });
      await sandbox.init();
      this._consecutiveFailures = 0;
      sandboxes.push(sandbox);
      this._totalCount++;
    }

    let pool = this._pools.get(key);
    if (!pool) {
      pool = [];
      this._pools.set(key, pool);
    }

    for (const sandbox of sandboxes) {
      const timeoutId = this._tracked(() => {
        const idx = pool.findIndex(e => e.sandbox === sandbox);
        if (idx !== -1) {
          pool.splice(idx, 1);
          sandbox.dispose();
          this._totalCount = Math.max(0, this._totalCount - 1);
        }
      }, this.idleTimeoutMs);
      pool.push({ sandbox, timeoutId });
    }

    logger.info(`Pre-warmed ${toCreate} sandboxes`, { key, total: this._totalCount });
  }

  /**
   * 运行时更新默认配置
   * @param {Object} config
   * @param {string[]} [config.defaultCapabilities] - 新的默认能力
   * @param {Object} [config.defaultLimits] - 新的默认资源限制
   */
  updateConfig(config) {
    if (config.defaultCapabilities !== undefined) {
      this.defaultCapabilities = config.defaultCapabilities;
    }
    if (config.defaultLimits !== undefined) {
      this.defaultLimits = { ...this.defaultLimits, ...config.defaultLimits };
    }
  }

  /**
   * 获取池状态
   */
  getStats() {
    let pooled = 0;
    for (const pool of this._pools.values()) {
      pooled += pool.length;
    }

    return {
      active: this._inUseCount,
      pooled,
      total: this._totalCount,
      maxSize: this.maxSize,
      maxActive: this.maxActive,
      waiting: this._waitQueue.length,
    };
  }

  /**
   * 清空池（带优雅超时）
   * @param {Object} [options]
   * @param {number} [options.disposeTimeoutMs=2000] - 单个沙箱清理超时
   */
  clear(options = {}) {
    const disposeTimeoutMs = options.disposeTimeoutMs || 2000;

    for (const pool of this._pools.values()) {
      for (const entry of pool) {
        this._cancelTracked(entry.timeoutId);

        // 释放锁
        if (this._sandboxLocks.has(entry.sandbox)) {
          const lockHandle = this._sandboxLocks.get(entry.sandbox);
          this._sandboxLocks.delete(entry.sandbox);
          lockHandle.release().catch(() => {});
        }

        // 使用带超时的 dispose
        try {
          entry.sandbox.dispose({ timeoutMs: disposeTimeoutMs });
        } catch (err) {
          logger.warn('Sandbox dispose failed during clear', { error: err?.message });
        }
        this._totalCount = Math.max(0, this._totalCount - 1);
      }
    }
    this._pools.clear();
  }

  /**
   * 启动内存监控
   * @private
   */
  _startMemoryMonitoring() {
    if (this._disposed || !this._enableMemoryMonitoring || this._memoryCheckTimer) return;

    // 记录基线内存
    if (typeof performance !== 'undefined' && performance.memory) {
      this._memoryBaseline = performance.memory.usedJSHeapSize;
    }

    this._memoryCheckTimer = setInterval(() => {
      if (this._disposed) {
        this._stopMemoryMonitoring();
        return;
      }
      if (typeof performance === 'undefined' || !performance.memory) return;

      const current = performance.memory.usedJSHeapSize;
      const baseline = this._memoryBaseline || current;
      const growth = current - baseline;
      const growthRate = baseline > 0 ? growth / baseline : 0;

      // 如果内存增长超过 50%，发出警告
      if (growthRate > 0.5) {
        logger.warn('Potential memory leak detected in sandbox pool', {
          baseline: Math.round(baseline / 1024 / 1024) + 'MB',
          current: Math.round(current / 1024 / 1024) + 'MB',
          growth: Math.round(growth / 1024 / 1024) + 'MB',
          growthRate: (growthRate * 100).toFixed(1) + '%',
          poolStats: this.getStats()
        });
      }
    }, this._memoryCheckIntervalMs);
  }

  /**
   * 停止内存监控
   * @private
   */
  _stopMemoryMonitoring() {
    const timer = this._memoryCheckTimer;
    this._memoryCheckTimer = null;
    this._memoryBaseline = null;
    if (!timer) return;
    clearInterval(timer);
  }

  /**
   * 销毁池（带优雅超时）
   * @param {Object} [options]
   * @param {number} [options.disposeTimeoutMs=2000] - 单个沙箱清理超时
   */
  dispose(options = {}) {
    if (this._disposed) return;
    this._disposed = true;

    // 停止内存监控
    this._stopMemoryMonitoring();

    this.clear(options);

    // 清理所有剩余的锁
    for (const [sandbox, lockHandle] of this._sandboxLocks.entries()) {
      lockHandle.release().catch(() => {});
    }
    this._sandboxLocks.clear();

    const waiters = this._waitQueue.splice(0, this._waitQueue.length);
    for (const waiter of waiters) {
      this._cancelTracked(waiter.timeoutId);
      try {
        waiter.reject(new Error("Pool has been disposed"));
      } catch {
        // ignore
      }
    }

    // sweep any orphaned timers as safety net
    for (const id of this._pendingTimers) {
      clearTimeout(id);
    }
    this._pendingTimers.clear();
  }
}

export default SandboxPool;
