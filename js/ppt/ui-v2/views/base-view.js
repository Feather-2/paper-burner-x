/**
 * UI V2 Base View
 * 视图基类，所有视图继承此类
 */

import { getUIEventBus } from '../../../shared/core/event-bus.js';
import { getStateStore } from '../core/state-store.js';
import { bindActionEvents } from '../core/action-binder.js';

export class BaseView {
  constructor(options = {}) {
    this._container = null;
    this._stateStore = options.stateStore || getStateStore();
    this._eventBus = options.eventBus || getUIEventBus();
    this._router = options.router || null;
    this._subscriptions = [];
    this._mounted = false;
  }

  /**
   * 挂载视图
   * @param {HTMLElement|string} container
   */
  mount(container) {
    this._container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this._container) {
      throw new Error(`${this.constructor.name}: container not found`);
    }

    this._mounted = true;
    this._container.innerHTML = this.render();
    this._bindEvents();
    this.onMount();
  }

  /**
   * 卸载视图
   */
  unmount() {
    this.onUnmount();

    // 清理订阅
    for (const unsub of this._subscriptions) {
      if (typeof unsub === 'function') unsub();
    }
    this._subscriptions = [];

    this._mounted = false;
    if (this._container) {
      this._container.innerHTML = '';
    }
  }

  /**
   * 渲染 HTML（子类重写）
   * @returns {string} HTML 字符串
   */
  render() {
    return '<div>Base View</div>';
  }

  /**
   * 绑定事件（子类重写）
   */
  _bindEvents() {
    if (!this._container) return;
    const off = bindActionEvents(this._container, (action) => {
      const method = `_on${action.charAt(0).toUpperCase()}${action.slice(1)}`;
      if (typeof this[method] !== 'function') return null;
      return (ctx) => this[method](ctx);
    });
    this._subscriptions.push(off);
  }

  /**
   * 生命周期：挂载后（子类重写）
   */
  onMount() {}

  /**
   * 生命周期：卸载前（子类重写）
   */
  onUnmount() {}

  /**
   * 订阅状态变化
   */
  subscribeState(handler) {
    const unsub = this._stateStore.subscribe(handler);
    this._subscriptions.push(unsub);
    return unsub;
  }

  /**
   * 订阅事件
   */
  subscribeEvent(eventName, handler) {
    const unsub = this._eventBus.on(eventName, handler);
    this._subscriptions.push(unsub);
    return unsub;
  }

  /**
   * 获取状态
   */
  getState(path) {
    return path ? this._stateStore.get(path) : this._stateStore.getState();
  }

  /**
   * 设置状态
   */
  setState(path, value) {
    this._stateStore.set(path, value);
  }

  /**
   * 发送事件
   */
  emit(eventName, payload) {
    this._eventBus.emit(eventName, payload);
  }

  /**
   * 导航到其他视图
   */
  navigate(viewType) {
    if (this._router) {
      this._router.navigate(viewType);
    } else {
      this._stateStore.set('ui.view', viewType);
    }
  }

  /**
   * 局部更新（不重新渲染整个视图）
   */
  updateElement(selector, html) {
    const el = this._container?.querySelector(selector);
    if (el) {
      el.innerHTML = html;
    }
  }

  /**
   * 查询元素
   */
  $(selector) {
    return this._container?.querySelector(selector);
  }

  /**
   * 查询所有元素
   */
  $$(selector) {
    return this._container?.querySelectorAll(selector) || [];
  }
}

export default BaseView;
