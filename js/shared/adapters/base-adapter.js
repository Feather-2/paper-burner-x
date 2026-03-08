/**
 * @file js/shared/adapters/base-adapter.js
 * @description UI 适配器基类 - Agent 事件与 UI 状态的桥接层
 *
 * 所有具体适配器（DeepSearch、Design、CodeSearch）继承此基类
 */

/**
 * @typedef {Object} AdapterState
 * @property {'idle'|'running'|'completed'|'failed'} status - 当前状态
 * @property {Error|null} error - 错误信息
 */

/**
 * UI 适配器基类
 */
export class BaseAdapter {
  /**
   * @param {Object} eventBus - 事件总线实例
   * @param {Object} [options={}] - 配置选项
   */
  constructor(eventBus, options = {}) {
    this._eventBus = eventBus;
    this._options = options;
    this._subscriptions = [];
    /** @type {AdapterState} */
    this._state = {
      status: 'idle',
      error: null
    };
    this._listeners = new Set();
  }

  /**
   * 获取当前状态
   * @returns {AdapterState}
   */
  getState() {
    return { ...this._state };
  }

  /**
   * 更新状态并通知监听器
   * @param {Partial<AdapterState>} partial - 部分状态更新
   * @protected
   */
  _setState(partial) {
    this._state = { ...this._state, ...partial };
    this._notifyListeners();
  }

  /**
   * 订阅事件
   * @param {string} pattern - 事件模式 (支持通配符)
   * @param {Function} handler - 处理函数
   * @returns {Function} 取消订阅函数
   */
  subscribe(pattern, handler) {
    const unsubscribe = this._eventBus.on(pattern, handler);
    this._subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * 添加状态变化监听器
   * @param {Function} listener - 监听函数
   * @returns {Function} 取消监听函数
   */
  onStateChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   * @private
   */
  _notifyListeners() {
    const state = this.getState();
    for (const listener of this._listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[BaseAdapter] Listener error:', err);
      }
    }
  }

  /**
   * 清理资源
   */
  dispose() {
    for (const unsubscribe of this._subscriptions) {
      try {
        unsubscribe();
      } catch (err) {
        // ignore
      }
    }
    this._subscriptions = [];
    this._listeners.clear();
    this._state = { status: 'idle', error: null };
  }
}

export default BaseAdapter;
