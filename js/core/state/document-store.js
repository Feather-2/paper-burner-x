/**
 * @file js/core/state/document-store.js
 * @description 文档状态管理，替代 window.data 全局变量
 */

/**
 * 创建文档状态存储
 * @param {Object} initialState - 初始状态
 * @returns {Object} 状态存储对象
 */
export function createDocumentStore(initialState = {}) {
  const defaultState = {
    id: '',
    name: '',
    ocr: '',
    translation: '',
    images: [],
    summaries: {},
    annotations: [],
    metadata: {}
  };

  let state = { ...defaultState, ...initialState };
  const listeners = new Set();

  return {
    /**
     * 获取当前状态
     */
    getState() {
      return { ...state };
    },

    /**
     * 获取特定字段
     */
    get(key) {
      return state[key];
    },

    /**
     * 设置状态
     */
    setState(updates) {
      const prevState = { ...state };
      state = { ...state, ...updates };
      this._notify({ type: 'SET_STATE', payload: updates, prevState });
    },

    /**
     * 派发动作
     */
    dispatch(action) {
      const prevState = { ...state };

      switch (action.type) {
        case 'SET_OCR':
          state.ocr = action.payload;
          break;
        case 'SET_TRANSLATION':
          state.translation = action.payload;
          break;
        case 'SET_IMAGES':
          state.images = action.payload;
          break;
        case 'ADD_SUMMARY':
          state.summaries[action.payload.key] = action.payload.value;
          break;
        case 'SET_ANNOTATIONS':
          state.annotations = action.payload;
          break;
        case 'ADD_ANNOTATION':
          state.annotations = [...state.annotations, action.payload];
          break;
        case 'REMOVE_ANNOTATION':
          state.annotations = state.annotations.filter(a => a.id !== action.payload);
          break;
        case 'UPDATE_ANNOTATION':
          state.annotations = state.annotations.map(a =>
            a.id === action.payload.id ? { ...a, ...action.payload } : a
          );
          break;
        case 'SET_METADATA':
          state.metadata = { ...state.metadata, ...action.payload };
          break;
        case 'RESET':
          state = { ...defaultState, ...action.payload };
          break;
        default:
          console.warn('[DocumentStore] Unknown action:', action.type);
          return;
      }

      this._notify({ ...action, prevState });
    },

    /**
     * 订阅状态变更
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * 通知所有监听器
     */
    _notify(action) {
      listeners.forEach(listener => {
        try {
          listener(state, action);
        } catch (e) {
          console.error('[DocumentStore] Listener error:', e);
        }
      });
    },

    /**
     * 重置状态
     */
    reset(newState = {}) {
      this.dispatch({ type: 'RESET', payload: newState });
    }
  };
}

/**
 * 创建带有 window.data 兼容层的文档存储
 * @param {Object} initialState - 初始状态
 * @returns {Object} 状态存储对象
 */
export function createDocumentStoreWithCompat(initialState = {}) {
  const store = createDocumentStore(initialState);

  // 创建 window.data 代理
  if (typeof window !== 'undefined') {
    const handler = {
      get(target, prop) {
        if (prop === '__store__') return store;
        return store.get(prop);
      },
      set(target, prop, value) {
        console.warn(`[Deprecated] Direct assignment to window.data.${prop}. Use store.dispatch() instead.`);
        store.setState({ [prop]: value });
        return true;
      }
    };

    window.data = new Proxy({}, handler);
    window.__documentStore__ = store;
  }

  return store;
}

/**
 * 文档存储类封装
 */
export class DocumentStore {
  constructor(initialState = {}) {
    this._store = createDocumentStore(initialState);
  }

  get state() {
    return this._store.getState();
  }

  get(key) {
    return this._store.get(key);
  }

  set(key, value) {
    this._store.setState({ [key]: value });
  }

  dispatch(action) {
    this._store.dispatch(action);
  }

  subscribe(listener) {
    return this._store.subscribe(listener);
  }

  reset(newState = {}) {
    this._store.reset(newState);
  }

  /**
   * 从文件处理结果加载
   */
  loadFromResult(result) {
    this._store.dispatch({
      type: 'RESET',
      payload: {
        id: result.id || '',
        name: result.name || result.file?.name || '',
        ocr: result.markdown || result.ocr || '',
        translation: result.translation || '',
        images: result.images || [],
        summaries: result.summaries || {},
        annotations: [],
        metadata: {
          processedAt: result.processedAt || new Date().toISOString(),
          fileSize: result.file?.size,
          fileType: result.file?.type
        }
      }
    });
  }

  /**
   * 安装到 window.data 兼容层
   */
  installCompat() {
    if (typeof window === 'undefined') return;

    const store = this._store;
    const handler = {
      get(target, prop) {
        if (prop === '__store__') return store;
        return store.get(prop);
      },
      set(target, prop, value) {
        console.warn(`[Deprecated] Direct assignment to window.data.${prop}. Use documentStore.dispatch() instead.`);
        store.setState({ [prop]: value });
        return true;
      }
    };

    window.data = new Proxy({}, handler);
    window.__documentStore__ = this;
  }
}

// 默认导出
export default DocumentStore;
