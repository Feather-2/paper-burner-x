/**
 * DisposableBase - Disposable 接口的基类实现
 * @module shared/base/disposable-base
 */

import { isDisposable } from "../../core/contracts/disposable.js";
import { createLogger } from "../utils/logger.js";
const logger = createLogger("agents");

/**
 * Disposable 基类
 *
 * 子类通过 _registerDisposable() 注册需要清理的资源，
 * dispose() 时自动倒序释放。
 *
 * @example
 * class MyComponent extends DisposableBase {
 *   constructor(eventBus) {
 *     super();
 *     const unsub = eventBus.subscribe("event", this._handler);
 *     this._registerSubscription(unsub);
 *
 *     this._timer = setInterval(() => this._tick(), 1000);
 *     this._registerDisposable(() => clearInterval(this._timer));
 *   }
 * }
 *
 * @see Disposable (../../core/contracts/disposable.js)
 */
export class DisposableBase {
  constructor() {
    /** @type {boolean} */
    this.disposed = false;

    /** @type {Array<() => void | Promise<void>>} */
    this._disposables = [];
  }

  /**
   * 注册需要清理的资源
   * @param {(() => void | Promise<void>) | import('../../core/contracts/disposable.js').Disposable} cleanup
   * @returns {void}
   */
  _registerDisposable(cleanup) {
    if (this.disposed) {
      logger.warn(`[${this.constructor.name}] registering disposable after disposed`);
      return;
    }

    if (typeof cleanup === "function") {
      this._disposables.push(cleanup);
    } else if (isDisposable(cleanup)) {
      this._disposables.push(() => cleanup.dispose());
    }
  }

  /**
   * 注册订阅（返回 unsubscribe 函数）
   * @param {() => void} unsubscribe
   * @returns {void}
   */
  _registerSubscription(unsubscribe) {
    if (typeof unsubscribe === "function") {
      this._registerDisposable(unsubscribe);
    }
  }

  /**
   * 注册定时器
   * @param {ReturnType<typeof setInterval>} timerId
   * @param {"interval" | "timeout"} [type="interval"]
   * @returns {void}
   */
  _registerTimer(timerId, type = "interval") {
    const clear = type === "timeout" ? clearTimeout : clearInterval;
    this._registerDisposable(() => clear(timerId));
  }

  /**
   * 释放所有资源
   * @returns {Promise<void>}
   */
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;

    // 子类可覆盖此方法添加额外清理
    await this._onDispose();

    // 倒序释放（后注册的先释放）
    for (let i = this._disposables.length - 1; i >= 0; i--) {
      try {
        await this._disposables[i]();
      } catch (e) {
        logger.warn(`[${this.constructor.name}] dispose error:`, e);
      }
    }
    this._disposables.length = 0;
  }

  /**
   * 子类可覆盖的清理钩子（在 disposables 释放前调用）
   * @protected
   * @returns {void | Promise<void>}
   */
  _onDispose() {
    // 默认空实现
  }

  /**
   * 确保对象未被释放
   * @throws {Error} 如果已释放
   * @protected
   */
  _ensureNotDisposed() {
    if (this.disposed) {
      throw new Error(`${this.constructor.name} has been disposed`);
    }
  }
}

export default DisposableBase;
