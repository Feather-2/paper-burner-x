/**
 * Circuit Breaker - 熔断器模式实现
 *
 * 用于保护对外部服务（如 MCP、LLM API）的调用，
 * 在服务不稳定时快速失败，避免雪崩效应。
 *
 * 状态机：CLOSED → OPEN → HALF_OPEN → CLOSED
 *
 * 浏览器友好，无 Node.js 依赖。
 */

import { toPositiveInt } from "./value-utils.js";

export const CircuitState = Object.freeze({
  CLOSED: "closed",       // 正常状态，允许请求
  OPEN: "open",           // 熔断状态，拒绝请求
  HALF_OPEN: "half_open", // 半开状态，允许有限请求探测
});

function defaultTime() {
  return {
    now: () => Date.now(),
  };
}

/**
 * 熔断器配置
 * @typedef {Object} CircuitBreakerOptions
 * @property {string} [name] - 熔断器名称（用于日志/事件）
 * @property {number} [failureThreshold=5] - 触发熔断的连续失败次数
 * @property {number} [successThreshold=2] - 半开状态下恢复所需的连续成功次数
 * @property {number} [openDurationMs=30000] - 熔断状态持续时间（毫秒）
 * @property {number} [halfOpenMaxCalls=3] - 半开状态允许的最大探测请求数
 * @property {(err: unknown) => boolean} [isFailure] - 自定义失败判断函数
 * @property {(event: { name: string, from: string, to: string, reason: string, stats?: any }) => void} [onStateChange] - 状态变更回调
 * @property {{ now: () => number }=} time - 可注入时间实现（测试/模拟用）
 */

export class CircuitBreaker {
  /**
   * @param {CircuitBreakerOptions} options
   */
  constructor({
    failureThreshold = 5,
    successThreshold = 2,
    openDurationMs = 30_000,
    halfOpenMaxCalls = 3,
    isFailure = null,
    onStateChange = null,
    time = null,
    name = "default",
  } = {}) {
    this.name = String(name);
    this.failureThreshold = toPositiveInt(failureThreshold, 5);
    this.successThreshold = toPositiveInt(successThreshold, 2);
    this.openDurationMs = toPositiveInt(openDurationMs, 30_000);
    this.halfOpenMaxCalls = toPositiveInt(halfOpenMaxCalls, 3);
    this.isFailure = typeof isFailure === "function" ? isFailure : (err) => true;
    this.onStateChange = typeof onStateChange === "function" ? onStateChange : null;
    this._time = time && typeof time.now === "function" ? time : defaultTime();

    // 内部状态
    /** @type {string} */
    this._state = CircuitState.CLOSED;
    this._failureCount = 0;
    this._successCount = 0;
    this._lastFailureTime = 0;
    this._openedAt = 0;
    this._halfOpenCalls = 0;
    this._totalCalls = 0;
    this._totalFailures = 0;
    this._totalSuccesses = 0;
  }

  /**
   * 获取当前状态
   */
  get state() {
    this._checkStateTransition();
    return this._state;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      state: this.state,
      failureCount: this._failureCount,
      successCount: this._successCount,
      totalCalls: this._totalCalls,
      totalFailures: this._totalFailures,
      totalSuccesses: this._totalSuccesses,
      lastFailureTime: this._lastFailureTime,
      openedAt: this._openedAt,
    };
  }

  /**
   * 检查是否允许请求通过
   */
  canExecute() {
    this._checkStateTransition();

    switch (this._state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        return false;

      case CircuitState.HALF_OPEN:
        return this._halfOpenCalls < this.halfOpenMaxCalls;

      default:
        return false;
    }
  }

  /**
   * 执行受保护的操作
   * @template T
   * @param {() => Promise<T>} fn - 要执行的异步函数
   * @returns {Promise<T>}
   */
  async execute(fn) {
    this._checkStateTransition();

    if (this._state === CircuitState.OPEN) {
      const err = /** @type {any} */ (new Error(`Circuit breaker is ${this._state}`));
      err.name = "CircuitBreakerOpenError";
      err.circuitBreaker = this.name;
      err.state = this._state;
      throw err;
    }

    if (this._state === CircuitState.HALF_OPEN) {
      if (this._halfOpenCalls >= this.halfOpenMaxCalls) {
        const err = /** @type {any} */ (new Error(`Circuit breaker is ${this._state}`));
        err.name = "CircuitBreakerOpenError";
        err.circuitBreaker = this.name;
        err.state = this._state;
        throw err;
      }
      this._halfOpenCalls++;
    }

    this._totalCalls++;

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      if (this.isFailure(err)) {
        this._onFailure(err);
      } else {
        // 非致命错误，视为成功
        this._onSuccess();
      }
      throw err;
    }
  }

  /**
   * 手动重置熔断器
   */
  reset() {
    const prevState = this._state;
    this._state = CircuitState.CLOSED;
    this._failureCount = 0;
    this._successCount = 0;
    this._halfOpenCalls = 0;

    if (prevState !== CircuitState.CLOSED && this.onStateChange) {
      this.onStateChange({
        name: this.name,
        from: prevState,
        to: CircuitState.CLOSED,
        reason: "manual_reset",
      });
    }
  }

  /**
   * 手动触发熔断
   */
  trip(reason = "manual") {
    this._transitionTo(CircuitState.OPEN, reason);
  }

  // --- 内部方法 ---

  _checkStateTransition() {
    const now = this._time.now();

    if (this._state === CircuitState.OPEN) {
      const elapsed = now - this._openedAt;
      if (elapsed >= this.openDurationMs) {
        this._transitionTo(CircuitState.HALF_OPEN, "timeout_elapsed");
      }
    }
  }

  _onSuccess() {
    this._totalSuccesses++;

    switch (this._state) {
      case CircuitState.CLOSED:
        this._failureCount = 0;
        break;

      case CircuitState.HALF_OPEN:
        this._successCount++;
        if (this._successCount >= this.successThreshold) {
          this._transitionTo(CircuitState.CLOSED, "recovery_success");
        }
        break;
    }
  }

  _onFailure(err) {
    this._totalFailures++;
    this._lastFailureTime = this._time.now();

    switch (this._state) {
      case CircuitState.CLOSED:
        this._failureCount++;
        if (this._failureCount >= this.failureThreshold) {
          this._transitionTo(CircuitState.OPEN, "failure_threshold");
        }
        break;

      case CircuitState.HALF_OPEN:
        this._transitionTo(CircuitState.OPEN, "half_open_failure");
        break;
    }
  }

  _transitionTo(newState, reason) {
    const prevState = this._state;
    if (prevState === newState) return;

    this._state = newState;

    switch (newState) {
      case CircuitState.OPEN:
        this._openedAt = this._time.now();
        this._successCount = 0;
        break;

      case CircuitState.HALF_OPEN:
        this._halfOpenCalls = 0;
        this._successCount = 0;
        break;

      case CircuitState.CLOSED:
        this._failureCount = 0;
        this._successCount = 0;
        this._halfOpenCalls = 0;
        break;
    }

    if (this.onStateChange) {
      this.onStateChange({
        name: this.name,
        from: prevState,
        to: newState,
        reason,
        stats: this.getStats(),
      });
    }
  }
}

/**
 * 熔断器注册表 - 管理多个熔断器实例
 */
export class CircuitBreakerRegistry {
  constructor() {
    this._breakers = new Map();
  }

  /**
   * 获取或创建熔断器
   * @param {string} name
   * @param {CircuitBreakerOptions} options
   */
  get(name, options = {}) {
    const key = String(name);
    if (!this._breakers.has(key)) {
      this._breakers.set(key, new CircuitBreaker({ ...options, name: key }));
    }
    return this._breakers.get(key);
  }

  /**
   * 检查熔断器是否存在
   */
  has(name) {
    return this._breakers.has(String(name));
  }

  /**
   * 移除熔断器
   */
  remove(name) {
    return this._breakers.delete(String(name));
  }

  /**
   * 获取所有熔断器状态
   */
  getAllStats() {
    const stats = {};
    for (const [name, breaker] of this._breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  /**
   * 重置所有熔断器
   */
  resetAll() {
    for (const breaker of this._breakers.values()) {
      breaker.reset();
    }
  }
}

// 全局默认注册表
let _globalRegistry = null;

export function getGlobalCircuitBreakerRegistry() {
  if (!_globalRegistry) {
    _globalRegistry = new CircuitBreakerRegistry();
  }
  return _globalRegistry;
}

/**
 * 便捷函数：使用全局注册表获取熔断器
 */
export function getCircuitBreaker(name, options = {}) {
  return getGlobalCircuitBreakerRegistry().get(name, options);
}

/**
 * 装饰器：为函数添加熔断器保护
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @param {CircuitBreakerOptions} options
 * @returns {Promise<T>}
 */
export async function withCircuitBreaker(name, fn, options = {}) {
  const breaker = getCircuitBreaker(name, options);
  return breaker.execute(fn);
}

export default {
  CircuitState,
  CircuitBreaker,
  CircuitBreakerRegistry,
  getGlobalCircuitBreakerRegistry,
  getCircuitBreaker,
  withCircuitBreaker,
};
