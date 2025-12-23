/**
 * UI V2 View Router
 * 视图路由，根据状态决定显示哪个视图
 */

import { getStateStore, ViewType } from './state-store.js';

export class ViewRouter {
  constructor(options = {}) {
    this._container = options.container || null;
    this._views = new Map(); // viewType -> ViewClass
    this._currentView = null;
    this._currentViewType = null;
    this._stateStore = options.stateStore || getStateStore();
    this._unsubscribe = null;
  }

  /**
   * 注册视图
   * @param {string} viewType - ViewType 枚举值
   * @param {class} ViewClass - 视图类
   */
  register(viewType, ViewClass) {
    this._views.set(viewType, ViewClass);
    return this;
  }

  /**
   * 挂载到容器
   */
  mount(container) {
    this._container = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!this._container) {
      throw new Error('ViewRouter: container not found');
    }

    // 订阅状态变化
    this._unsubscribe = this._stateStore.subscribe((event) => {
      if (event.path === 'ui.view' || event.path === '') {
        this._render();
      }
    });

    // 初始渲染
    this._render();

    return this;
  }

  /**
   * 卸载
   */
  unmount() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._currentView) {
      this._currentView.unmount();
      this._currentView = null;
    }
    this._currentViewType = null;
    if (this._container) {
      this._container.innerHTML = '';
    }
  }

  /**
   * 手动导航到视图
   */
  navigate(viewType) {
    this._stateStore.set('ui.view', viewType);
  }

  /**
   * 渲染当前视图
   */
  _render() {
    const viewType = this._stateStore.get('ui.view') || ViewType.UPLOAD;

    // 如果视图类型没变，不重新渲染
    if (viewType === this._currentViewType && this._currentView) {
      return;
    }

    // 卸载旧视图
    if (this._currentView) {
      this._currentView.unmount();
      this._currentView = null;
    }

    // 获取新视图类
    const ViewClass = this._views.get(viewType);
    if (!ViewClass) {
      console.warn(`ViewRouter: No view registered for type "${viewType}"`);
      this._container.innerHTML = `<div class="error-view">视图未找到: ${viewType}</div>`;
      return;
    }

    // 创建并挂载新视图
    this._currentViewType = viewType;
    this._currentView = new ViewClass({
      stateStore: this._stateStore,
      router: this
    });
    this._currentView.mount(this._container);
  }

  /**
   * 获取当前视图
   */
  getCurrentView() {
    return this._currentView;
  }

  /**
   * 获取当前视图类型
   */
  getCurrentViewType() {
    return this._currentViewType;
  }
}

// 工厂函数
export function createViewRouter(options = {}) {
  return new ViewRouter(options);
}

export default ViewRouter;
