import { EventEmitter } from './shims/events.js';

/**
 * @typedef {object} HmrEvent
 * @property {'update'|'full-reload'|'css-update'} type
 * @property {string} path
 * @property {number} timestamp
 */

/**
 * @typedef {object} HmrConfig
 * @property {object} vfs - VFS with events (withVfsEvents wrapped)
 * @property {Map} [moduleCache] - Module cache to invalidate
 */

/**
 * HMR 引擎。
 */
export class HmrEngine extends EventEmitter {
  /**
   * @param {HmrConfig} config
   */
  constructor(config) {
    super();
    this._vfs = config.vfs;
    this._moduleCache = config.moduleCache || new Map();
    this._acceptedModules = new Map(); // path -> callback
    this._disposed = false;
    this._onChange = null;
  }

  /**
   * 启动 HMR 监听。
   */
  start() {
    this._onChange = (path) => {
      if (this._disposed) return;
      const event = this._classifyChange(path);
      this.emit('hmr', event);

      if (event.type === 'css-update') {
        this.emit('css-update', event);
      } else if (event.type === 'update') {
        // 清除模块缓存
        this._invalidateModule(path);
        const acceptCb = this._acceptedModules.get(path);
        if (acceptCb) {
          acceptCb(event);
        } else {
          // 无 accept handler → full reload
          this.emit('hmr', { type: 'full-reload', path, timestamp: Date.now() });
        }
      }
    };
    if (typeof this._vfs.on === 'function') {
      this._vfs.on('change', this._onChange);
    }
  }

  /**
   * 停止 HMR 监听。
   */
  stop() {
    this._disposed = true;
    if (this._onChange && typeof this._vfs.off === 'function') {
      this._vfs.off('change', this._onChange);
    }
    this._acceptedModules.clear();
  }

  /**
   * 注册模块 accept handler（import.meta.hot.accept）。
   * @param {string} path
   * @param {Function} callback
   */
  accept(path, callback) {
    this._acceptedModules.set(path, callback);
  }

  /**
   * 注册模块 dispose handler。
   * @param {string} path
   * @param {Function} callback
   */
  dispose(path, callback) {
    this._disposeCallbacks = this._disposeCallbacks || new Map();
    this._disposeCallbacks.set(path, callback);
  }

  /**
   * 使模块缓存失效。
   * @param {string} path
   */
  _invalidateModule(path) {
    if (this._disposeCallbacks?.has(path)) {
      this._disposeCallbacks.get(path)();
    }
    this._moduleCache.delete(path);
  }

  /**
   * 根据文件扩展名分类变更类型。
   * @param {string} path
   * @returns {HmrEvent}
   */
  _classifyChange(path) {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    const timestamp = Date.now();
    if (ext === 'css' || ext === 'scss' || ext === 'less') {
      return { type: 'css-update', path, timestamp };
    }
    if (ext === 'js' || ext === 'mjs' || ext === 'jsx' || ext === 'ts' || ext === 'tsx') {
      return { type: 'update', path, timestamp };
    }
    return { type: 'full-reload', path, timestamp };
  }

  /**
   * 创建 import.meta.hot 兼容 API。
   * @param {string} modulePath
   * @returns {object}
   */
  createHotContext(modulePath) {
    return {
      accept: (cb) => this.accept(modulePath, cb || (() => {})),
      dispose: (cb) => this.dispose(modulePath, cb),
      invalidate: () => {
        this._invalidateModule(modulePath);
        this.emit('hmr', { type: 'full-reload', path: modulePath, timestamp: Date.now() });
      },
    };
  }
}

export default HmrEngine;
