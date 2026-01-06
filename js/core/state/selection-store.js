/**
 * @file js/core/state/selection-store.js
 * @description 选区状态管理，替代 window.globalCurrentSelection 等全局变量
 */

/**
 * 创建选区状态存储
 * @returns {Object} 选区存储对象
 */
export function createSelectionStore() {
  let state = {
    selection: null,
    contentIdentifier: null,
    range: null,
    text: '',
    position: null
  };

  const listeners = new Set();

  return {
    /**
     * 获取当前选区
     */
    getSelection() {
      return state.selection;
    },

    /**
     * 获取内容标识符
     */
    getContentIdentifier() {
      return state.contentIdentifier;
    },

    /**
     * 获取完整状态
     */
    getState() {
      return { ...state };
    },

    /**
     * 设置选区
     */
    setSelection(selection, contentIdentifier = null) {
      const prevState = { ...state };
      state.selection = selection;
      if (contentIdentifier !== null) {
        state.contentIdentifier = contentIdentifier;
      }
      if (selection) {
        state.text = selection.toString() || '';
        try {
          if (selection.rangeCount > 0) {
            state.range = selection.getRangeAt(0).cloneRange();
          }
        } catch (e) {
          state.range = null;
        }
      } else {
        state.text = '';
        state.range = null;
      }
      this._notify({ type: 'SET_SELECTION', prevState });
    },

    /**
     * 设置位置信息
     */
    setPosition(position) {
      const prevState = { ...state };
      state.position = position;
      this._notify({ type: 'SET_POSITION', prevState });
    },

    /**
     * 清除选区
     */
    clear() {
      const prevState = { ...state };
      state = {
        selection: null,
        contentIdentifier: null,
        range: null,
        text: '',
        position: null
      };
      this._notify({ type: 'CLEAR', prevState });
    },

    /**
     * 订阅变更
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * 通知监听器
     */
    _notify(action) {
      listeners.forEach(listener => {
        try {
          listener(state, action);
        } catch (e) {
          console.error('[SelectionStore] Listener error:', e);
        }
      });
    },

    /**
     * 安装到 window 兼容层
     */
    installCompat() {
      if (typeof window === 'undefined') return;

      const store = this;

      // window.globalCurrentSelection 兼容
      Object.defineProperty(window, 'globalCurrentSelection', {
        get() {
          console.warn('[Deprecated] Use selectionStore.getSelection() instead');
          return store.getSelection();
        },
        set(value) {
          console.warn('[Deprecated] Use selectionStore.setSelection() instead');
          store.setSelection(value);
        },
        configurable: true
      });

      // window.globalCurrentContentIdentifier 兼容
      Object.defineProperty(window, 'globalCurrentContentIdentifier', {
        get() {
          console.warn('[Deprecated] Use selectionStore.getContentIdentifier() instead');
          return store.getContentIdentifier();
        },
        set(value) {
          console.warn('[Deprecated] Use selectionStore.setSelection(selection, contentIdentifier) instead');
          state.contentIdentifier = value;
        },
        configurable: true
      });

      window.__selectionStore__ = store;
    }
  };
}

/**
 * 选区存储类封装
 */
export class SelectionStore {
  constructor() {
    this._store = createSelectionStore();
  }

  get selection() {
    return this._store.getSelection();
  }

  get contentIdentifier() {
    return this._store.getContentIdentifier();
  }

  get text() {
    return this._store.getState().text;
  }

  get range() {
    return this._store.getState().range;
  }

  get position() {
    return this._store.getState().position;
  }

  setSelection(selection, contentIdentifier = null) {
    this._store.setSelection(selection, contentIdentifier);
  }

  setPosition(position) {
    this._store.setPosition(position);
  }

  clear() {
    this._store.clear();
  }

  subscribe(listener) {
    return this._store.subscribe(listener);
  }

  installCompat() {
    this._store.installCompat();
  }
}

// 默认导出
export default SelectionStore;
