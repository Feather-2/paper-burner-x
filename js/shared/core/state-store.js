/**
 * @file js/shared/core/state-store.js
 * @description 通用 UI 状态存储 - 细粒度响应式状态管理
 *
 * 提供路径式状态访问和订阅能力，无业务依赖。
 * PPT 等模块可以基于此扩展特定状态管理。
 */

/**
 * @typedef {Object} StateSubscription
 * @property {string} path - 订阅路径
 * @property {Function} handler - 处理函数
 */

/**
 * 通用状态存储
 */
export class StateStore {
  constructor(initialState = {}) {
    this._state = this._deepClone(initialState);
    this._listeners = new Map(); // path -> Set<handler>
    this._wildcardListeners = new Set(); // Set<{prefix, handler}>
    this._batchUpdates = null;
  }

  /**
   * 获取状态值
   * @param {string} [path] - 路径，如 'data.files'，不传返回整个状态
   * @returns {any}
   */
  get(path) {
    if (!path) return this._deepClone(this._state);
    return this._getByPath(this._state, path);
  }

  /**
   * 设置状态值
   * @param {string} path - 路径
   * @param {any} value - 值
   */
  set(path, value) {
    const oldValue = this._getByPath(this._state, path);
    this._setByPath(this._state, path, this._deepClone(value));

    if (this._batchUpdates) {
      this._batchUpdates.set(path, { oldValue, newValue: value });
    } else {
      this._notify(path, value, oldValue);
    }
  }

  /**
   * 批量更新
   * @param {Object} updates - { path: value }
   */
  update(updates) {
    if (!updates || typeof updates !== 'object') return;

    this._batchUpdates = new Map();

    for (const [path, value] of Object.entries(updates)) {
      this.set(path, value);
    }

    // 批量通知
    for (const [path, { oldValue, newValue }] of this._batchUpdates) {
      this._notify(path, newValue, oldValue);
    }

    this._batchUpdates = null;
  }

  /**
   * 订阅状态变化
   * @param {string} pattern - 路径模式，支持 '*' 通配符
   * @param {Function} handler - (path, newValue, oldValue) => void
   * @returns {Function} 取消订阅
   */
  subscribe(pattern, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }

    if (pattern === '*' || pattern.endsWith('.*')) {
      const prefix = pattern === '*' ? '' : pattern.slice(0, -2);
      const entry = { prefix, handler };
      this._wildcardListeners.add(entry);
      return () => this._wildcardListeners.delete(entry);
    }

    if (!this._listeners.has(pattern)) {
      this._listeners.set(pattern, new Set());
    }
    this._listeners.get(pattern).add(handler);

    return () => {
      const set = this._listeners.get(pattern);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this._listeners.delete(pattern);
      }
    };
  }

  /**
   * 获取全部状态快照
   * @returns {Object}
   */
  getSnapshot() {
    return this._deepClone(this._state);
  }

  /**
   * 重置状态
   * @param {Object} [newState={}]
   */
  reset(newState = {}) {
    this._state = this._deepClone(newState);
    this._notify('*', this._state, null);
  }

  /**
   * 销毁
   */
  destroy() {
    this._listeners.clear();
    this._wildcardListeners.clear();
    this._state = {};
  }

  /**
   * 通知监听器
   * @private
   */
  _notify(path, newValue, oldValue) {
    // 精确匹配
    const handlers = this._listeners.get(path);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(path, newValue, oldValue);
        } catch (err) {
          console.error(`[StateStore] Handler error for ${path}:`, err);
        }
      }
    }

    // 通配符匹配
    for (const { prefix, handler } of this._wildcardListeners) {
      if (!prefix || path.startsWith(prefix + '.')) {
        try {
          handler(path, newValue, oldValue);
        } catch (err) {
          console.error(`[StateStore] Wildcard handler error for ${path}:`, err);
        }
      }
    }

    // 通知父路径 (冒泡)
    const parts = path.split('.');
    if (parts.length > 1) {
      parts.pop();
      const parentPath = parts.join('.');
      const parentHandlers = this._listeners.get(parentPath);
      if (parentHandlers) {
        const parentValue = this._getByPath(this._state, parentPath);
        for (const handler of parentHandlers) {
          try {
            handler(parentPath, parentValue, undefined);
          } catch (err) {
            console.error(`[StateStore] Parent handler error for ${parentPath}:`, err);
          }
        }
      }
    }
  }

  /**
   * 路径取值
   * @private
   */
  _getByPath(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }
    return this._deepClone(current);
  }

  /**
   * 路径赋值
   * @private
   */
  _setByPath(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] == null || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }
    current[parts[parts.length - 1]] = value;
  }

  /**
   * 深拷贝
   * @private
   */
  _deepClone(value) {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(item => this._deepClone(item));
    if (typeof value === 'object') {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return { ...value };
      }
    }
    return value;
  }
}

// 全局单例
let _instance = null;

export function getStateStore() {
  if (!_instance) {
    _instance = new StateStore();
  }
  return _instance;
}

export function resetStateStore() {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}

export default StateStore;
