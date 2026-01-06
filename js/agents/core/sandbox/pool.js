/**
 * Sandbox Pool - 沙箱池化管理
 *
 * 复用沙箱实例，减少初始化开销。
 * 支持按能力组合分组池化。
 */

import { WasmSandbox } from './wasm-sandbox.js';
import { SandboxPreset, ResourceLimits } from './index.js';

/**
 * SandboxPool - 沙箱对象池
 */
export class SandboxPool {
  /**
   * @param {Object} options
   * @param {number} [options.maxSize=4] - 池最大容量
   * @param {number} [options.idleTimeoutMs=60000] - 空闲超时
   * @param {string[]} [options.defaultCapabilities] - 默认能力
   * @param {Object} [options.defaultLimits] - 默认资源限制
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || 4;
    this.idleTimeoutMs = options.idleTimeoutMs || 60000;
    this.defaultCapabilities = options.defaultCapabilities || SandboxPreset.SKILL;
    this.defaultLimits = options.defaultLimits || ResourceLimits.STANDARD;

    // 按能力 key 分组的池
    this._pools = new Map();
    this._activeCount = 0;
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
      entry.sandbox.updateState(options.state || {});
      entry.sandbox.onLog = options.onLog || (() => {});
      entry.sandbox.onEmit = options.onEmit || (() => {});
      return entry.sandbox;
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
    this._activeCount++;

    return sandbox;
  }

  /**
   * 归还沙箱
   * @param {WasmSandbox} sandbox
   */
  release(sandbox) {
    if (this._disposed || !sandbox || sandbox._disposed) return;

    const key = this._getCapabilityKey(sandbox.capabilities);

    let pool = this._pools.get(key);
    if (!pool) {
      pool = [];
      this._pools.set(key, pool);
    }

    // 检查池容量
    if (pool.length >= this.maxSize) {
      sandbox.dispose();
      this._activeCount--;
      return;
    }

    // 清理状态（重置 VM）
    sandbox.state = {};
    sandbox.onLog = () => {};
    sandbox.onEmit = () => {};

    // 设置空闲超时
    const timeoutId = setTimeout(() => {
      const idx = pool.findIndex(e => e.sandbox === sandbox);
      if (idx !== -1) {
        pool.splice(idx, 1);
        sandbox.dispose();
        this._activeCount--;
      }
    }, this.idleTimeoutMs);

    pool.push({ sandbox, timeoutId });
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
      active: this._activeCount - pooled,
      pooled,
      total: this._activeCount,
      maxSize: this.maxSize,
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
        this._activeCount--;
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
    this._disposed = true;
  }
}

export default SandboxPool;
