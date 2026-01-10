/**
 * Sandbox Pool - 沙箱池化管理
 *
 * 复用沙箱实例，减少初始化开销。
 * 支持按能力组合分组池化。
 */

import { WasmSandbox } from './wasm-sandbox.js';
import { SandboxPreset, ResourceLimits } from './constants.js';

/**
 * SandboxPool - 沙箱对象池
 */
export class SandboxPool {
  /**
   * @param {Object} options
   * @param {number} [options.maxSize=4] - 池最大容量
   * @param {number} [options.maxActive] - 最大并发（获取中的沙箱数）；默认等于 maxSize
   * @param {number} [options.idleTimeoutMs=60000] - 空闲超时
   * @param {string[]} [options.defaultCapabilities] - 默认能力
   * @param {Object} [options.defaultLimits] - 默认资源限制
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || 4;
    this.maxActive = Math.max(1, options.maxActive || this.maxSize);
    this.idleTimeoutMs = options.idleTimeoutMs || 60000;
    this.defaultCapabilities = options.defaultCapabilities || SandboxPreset.SKILL;
    this.defaultLimits = options.defaultLimits || ResourceLimits.STANDARD;

    // 按能力 key 分组的池
    this._pools = new Map();
    this._totalCount = 0;
    this._inUseCount = 0;
    /** @type {Array<{ key: string, options: any, resolve: (sb: WasmSandbox) => void, reject: (err: any) => void }>} */
    this._waitQueue = [];
    this._draining = false;
    this._disposed = false;
  }

  /**
   * 生成能力 key
   */
  _getCapabilityKey(capabilities) {
    return [...capabilities].sort().join(',');
  }

  /**
   * 获取沙箱
   * @param {Object} options
   * @returns {Promise<WasmSandbox>}
   */
  async acquire(options = {}) {
    if (this._disposed) throw new Error('Pool has been disposed');

    const capabilities = options.capabilities || this.defaultCapabilities;
    const limits = { ...this.defaultLimits, ...options.limits };
    const key = this._getCapabilityKey(capabilities);

    // 尝试从池中获取
    const pool = this._pools.get(key);
    if (pool && pool.length > 0) {
      const entry = pool.pop();
      clearTimeout(entry.timeoutId);
      entry.sandbox.recycle({
        state: options.state || {},
        onLog: options.onLog || (() => {}),
        onEmit: options.onEmit || (() => {}),
        limits,
      });
      await entry.sandbox.init();
      this._inUseCount++;
      return entry.sandbox;
    }

    // 并发限制：等待释放后再创建/获取
    if (this._inUseCount >= this.maxActive) {
      return await new Promise((resolve, reject) => {
        this._waitQueue.push({ key, options: { ...options, capabilities, limits }, resolve, reject });
        this._scheduleDrain();
      });
    }

    // 创建新沙箱
    const sandbox = new WasmSandbox({
      capabilities,
      limits,
      state: options.state,
      onLog: options.onLog,
      onEmit: options.onEmit,
    });

    await sandbox.init();
    this._totalCount++;
    this._inUseCount++;

    return sandbox;
  }

  _scheduleDrain() {
    if (this._draining) return;
    this._draining = true;
    Promise.resolve()
      .then(() => this._drainWaitQueue())
      .catch(() => { })
      .finally(() => {
        this._draining = false;
        if (!this._disposed && this._waitQueue.length && this._inUseCount < this.maxActive) {
          this._scheduleDrain();
        }
      });
  }

  async _drainWaitQueue() {
    while (!this._disposed && this._waitQueue.length && this._inUseCount < this.maxActive) {
      const waiter = this._waitQueue.shift();
      if (!waiter) break;

      const { key, options, resolve, reject } = waiter;
      const capabilities = options?.capabilities || this.defaultCapabilities;
      const limits = options?.limits || this.defaultLimits;

      let sandbox = null;
      const pool = this._pools.get(key);
      if (pool && pool.length > 0) {
        const entry = pool.pop();
        clearTimeout(entry.timeoutId);
        sandbox = entry.sandbox;
      }

      if (!sandbox) {
        sandbox = new WasmSandbox({
          capabilities,
          limits,
          state: options?.state,
          onLog: options?.onLog,
          onEmit: options?.onEmit,
        });
        this._totalCount++;
      }

      sandbox.recycle({
        state: options?.state || {},
        onLog: options?.onLog || (() => {}),
        onEmit: options?.onEmit || (() => {}),
        limits,
      });

      try {
        await sandbox.init();
        this._inUseCount++;
        resolve(sandbox);
      } catch (err) {
        try {
          sandbox.dispose();
        } catch {
          // ignore
        }
        this._totalCount = Math.max(0, this._totalCount - 1);
        reject(err);
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
      sandbox.recycle({
        state: waiter?.options?.state || {},
        onLog: waiter?.options?.onLog || (() => {}),
        onEmit: waiter?.options?.onEmit || (() => {}),
        limits: waiter?.options?.limits || this.defaultLimits,
      });
      sandbox
        .init()
        .then(() => {
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
    const timeoutId = setTimeout(() => {
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
   * 清空池
   */
  clear() {
    for (const pool of this._pools.values()) {
      for (const entry of pool) {
        clearTimeout(entry.timeoutId);
        entry.sandbox.dispose();
        this._totalCount = Math.max(0, this._totalCount - 1);
      }
    }
    this._pools.clear();
  }

  /**
   * 销毁池
   */
  dispose() {
    if (this._disposed) return;
    this.clear();
    const waiters = this._waitQueue.splice(0, this._waitQueue.length);
    for (const waiter of waiters) {
      try {
        waiter.reject(new Error("Pool has been disposed"));
      } catch {
        // ignore
      }
    }
    this._disposed = true;
  }
}

export default SandboxPool;
