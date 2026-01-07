/**
 * 浏览器兼容的 EventEmitter 简易实现。
 *
 * 仅实现 on/off/emit/removeAllListeners 这几个常用能力，用于在不依赖 Node.js `events` 的情况下
 * 提供轻量级事件机制。
 */
export class ModelEventEmitter {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._events = new Map();
  }

  /**
   * @param {string} event
   * @param {Function} listener
   * @returns {ModelEventEmitter}
   */
  on(event, listener) {
    if (!this._events.has(event)) this._events.set(event, []);
    this._events.get(event).push(listener);
    return this;
  }

  /**
   * @param {string} event
   * @param {Function} listener
   * @returns {ModelEventEmitter}
   */
  off(event, listener) {
    const listeners = this._events.get(event);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
    return this;
  }

  /**
   * @param {string} event
   * @param {...any} args
   * @returns {boolean}
   */
  emit(event, ...args) {
    const listeners = this._events.get(event);
    if (listeners) for (const fn of [...listeners]) fn(...args);
    return listeners?.length > 0;
  }

  /**
   * @param {string=} event
   * @returns {ModelEventEmitter}
   */
  removeAllListeners(event) {
    if (event) this._events.delete(event);
    else this._events.clear();
    return this;
  }
}
