/**
 * @file js/shared/core/event-bus.js
 * @description 统一 UI 事件总线 - 连接 Agent 和 UI
 *
 * 从 js/ppt/ui-v2/core/event-bus.js 迁移
 */

const WILDCARD = '*';

export class UIEventBus {
  constructor() {
    this._listeners = new Map(); // eventName -> Set<handler>
    this._wildcardListeners = new Set();
    this._history = []; // 最近 100 条事件
    this._maxHistory = 100;
  }

  /**
   * 订阅事件
   * @param {string} eventName - 事件名，支持 '*' 通配符
   * @param {Function} handler - (eventName, payload) => void
   * @returns {Function} unsubscribe
   */
  on(eventName, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }

    if (eventName === WILDCARD || eventName.endsWith('.*')) {
      const prefix = eventName === WILDCARD ? '' : eventName.slice(0, -2);
      const entry = { prefix, handler };
      this._wildcardListeners.add(entry);
      return () => this._wildcardListeners.delete(entry);
    }

    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(handler);

    return () => {
      const set = this._listeners.get(eventName);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this._listeners.delete(eventName);
      }
    };
  }

  /**
   * 发送事件
   * @param {string} eventName
   * @param {any} payload
   */
  emit(eventName, payload = {}) {
    const event = {
      name: eventName,
      payload,
      timestamp: Date.now()
    };

    // 记录历史
    this._history.push(event);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    // 精确匹配
    const handlers = this._listeners.get(eventName);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(eventName, payload);
        } catch (err) {
          console.error(`[UIEventBus] Handler error for ${eventName}:`, err);
        }
      }
    }

    // 通配符匹配
    for (const { prefix, handler } of this._wildcardListeners) {
      if (!prefix || eventName.startsWith(prefix + '.')) {
        try {
          handler(eventName, payload);
        } catch (err) {
          console.error(`[UIEventBus] Wildcard handler error for ${eventName}:`, err);
        }
      }
    }
  }

  /**
   * 一次性订阅
   */
  once(eventName, handler) {
    const off = this.on(eventName, (name, payload) => {
      off();
      handler(name, payload);
    });
    return off;
  }

  /**
   * 获取事件历史
   */
  getHistory(filter) {
    if (!filter) return [...this._history];
    if (typeof filter === 'string') {
      return this._history.filter(e => e.name.startsWith(filter));
    }
    if (typeof filter === 'function') {
      return this._history.filter(filter);
    }
    return [...this._history];
  }

  /**
   * 清空历史
   */
  clearHistory() {
    this._history = [];
  }

  /**
   * 销毁
   */
  destroy() {
    this._listeners.clear();
    this._wildcardListeners.clear();
    this._history = [];
  }
}

// 全局单例
let _instance = null;

export function getUIEventBus() {
  if (!_instance) {
    _instance = new UIEventBus();
  }
  return _instance;
}

export function resetUIEventBus() {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}

export default UIEventBus;
