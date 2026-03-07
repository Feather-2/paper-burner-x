/**
 * @typedef {'update'|'css-update'|'full-reload'} HmrUpdateType
 */

/**
 * @typedef {object} HmrUpdate
 * @property {HmrUpdateType} type
 * @property {string} path
 * @property {string|Uint8Array|ArrayBuffer|null|undefined} [content]
 * @property {number} timestamp
 */

/**
 * @typedef {object} HmrClientOptions
 * @property {Map<string, unknown>} [moduleCache]
 * @property {{ on?: (event: string, callback: Function) => void, off?: (event: string, callback: Function) => void }} [vfs]
 * @property {(update: HmrUpdate) => void|Promise<void>} [onFullReload]
 * @property {boolean} [throwOnError=false]
 */

/**
 * @typedef {object} HotState
 * @property {Set<Function>} selfAcceptCallbacks
 * @property {Map<string, Set<Function>>} depAcceptCallbacks
 * @property {Set<Function>} disposeCallbacks
 * @property {Record<string, unknown>} data
 * @property {boolean} declined
 */

const JS_EXTENSIONS = new Set(['.js', '.mjs']);
const CSS_EXTENSIONS = new Set(['.css']);

/**
 * Tiny EventEmitter mixin.
 */
const EventEmitterMixin = {
  /**
   * @param {string} event
   * @param {Function} listener
   * @returns {() => void}
   */
  on(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }

    this._listeners.get(event).add(listener);
    return () => this.off(event, listener);
  },

  /**
   * @param {string} event
   * @param {Function} listener
   */
  off(event, listener) {
    const listeners = this._listeners.get(event);
    if (!listeners) return;

    listeners.delete(listener);
    if (listeners.size === 0) {
      this._listeners.delete(event);
    }
  },

  /**
   * @param {string} event
   * @param {unknown} payload
   */
  emit(event, payload) {
    const listeners = this._listeners.get(event);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch (error) {
        if (event !== 'hmr:error') {
          this.emit('hmr:error', {
            error,
            event,
            payload,
            phase: 'emit',
          });
        }
      }
    }
  },
};

/**
 * @param {string} moduleId
 * @returns {string}
 */
function normalizeModuleId(moduleId) {
  if (typeof moduleId !== 'string') return '';
  const trimmed = moduleId.trim();
  if (!trimmed) return '';

  let normalized = trimmed;
  const hashIndex = normalized.indexOf('#');
  if (hashIndex >= 0) normalized = normalized.slice(0, hashIndex);

  const queryIndex = normalized.indexOf('?');
  if (queryIndex >= 0) normalized = normalized.slice(0, queryIndex);

  return normalized;
}

/**
 * @param {string} moduleId
 * @returns {string}
 */
function getExtension(moduleId) {
  const normalized = normalizeModuleId(moduleId).toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot < 0) return '';
  return normalized.slice(lastDot);
}

/**
 * @returns {HotState}
 */
function createHotState() {
  return {
    selfAcceptCallbacks: new Set(),
    depAcceptCallbacks: new Map(),
    disposeCallbacks: new Set(),
    data: {},
    declined: false,
  };
}

/**
 * Browser-first HMR client for sandbox runtime.
 */
export class HmrClient {
  /**
   * Event emitter mixin methods are assigned below via Object.assign.
   * Declared here for checkJs.
   * @param {string} _event
   * @param {Function} _listener
   * @returns {() => void}
   */
  on(_event, _listener) { return () => {}; }
  /**
   * @param {string} _event
   * @param {Function} _listener
   * @returns {void}
   */
  off(_event, _listener) {}
  /**
   * @param {string} _event
   * @param {unknown} _payload
   * @returns {void}
   */
  emit(_event, _payload) {}

  /**
   * @param {HmrClientOptions} [options]
   */
  constructor(options = {}) {
    const { moduleCache, vfs, onFullReload } = options;

    this._listeners = new Map();
    this._moduleCache = moduleCache instanceof Map ? moduleCache : new Map();
    this._vfs = vfs;
    this._onFullReload = typeof onFullReload === 'function' ? onFullReload : null;
    this._throwOnError = options.throwOnError === true;
    this._lastError = null;
    this._hotStates = new Map();
    this._vfsChangeHandler = null;
    this._vfsDeleteHandler = null;

    if (this._vfs && typeof this._vfs.on === 'function') {
      this._vfsChangeHandler = (path, content) => {
        void this.handleFileChange(path, content);
      };
      this._vfsDeleteHandler = (path) => {
        void this.handleFileDelete(path);
      };
      this._vfs.on('change', this._vfsChangeHandler);
      this._vfs.on('delete', this._vfsDeleteHandler);
    }
  }

  /**
   * Creates import.meta.hot compatible context API for a module.
   *
   * @param {string} moduleId
   * @returns {{
   *   accept: (depsOrCallback?: string|string[]|Function, callback?: Function) => void,
   *   dispose: (callback: Function) => void,
   *   invalidate: () => void,
   *   decline: () => void,
   *   data: Record<string, unknown>
   * }}
   */
  createHotContext(moduleId) {
    const normalizedId = normalizeModuleId(moduleId);
    if (!normalizedId) {
      throw new TypeError('moduleId must be a non-empty string');
    }

    const state = this._ensureHotState(normalizedId);

    return {
      accept: (depsOrCallback, callback) => {
        this._registerAccept(normalizedId, depsOrCallback, callback);
      },
      dispose: (callback) => {
        if (typeof callback !== 'function') {
          throw new TypeError('dispose callback must be a function');
        }
        state.disposeCallbacks.add(callback);
      },
      invalidate: () => {
        const update = this._createUpdate('full-reload', normalizedId);
        void this.applyUpdate(update);
      },
      decline: () => {
        state.declined = true;
      },
      get data() {
        return state.data;
      },
      set data(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new TypeError('hot.data must be an object');
        }
        state.data = value;
      },
    };
  }

  /**
   * Classifies the changed file and applies the update lifecycle.
   *
   * @param {string} path
   * @param {string|Uint8Array|ArrayBuffer|null|undefined} [content]
   * @returns {Promise<HmrUpdate>}
   */
  async handleFileChange(path, content) {
    const normalizedPath = normalizeModuleId(path);
    const extension = getExtension(normalizedPath);

    /** @type {HmrUpdateType} */
    let type = 'full-reload';

    if (CSS_EXTENSIONS.has(extension)) {
      type = 'css-update';
    } else if (JS_EXTENSIONS.has(extension) && this._hasAcceptedUpdate(normalizedPath)) {
      type = 'update';
    }

    const update = /** @type {HmrUpdate} */ (this._createUpdate(type, normalizedPath || String(path || ''), content));
    await this.applyUpdate(update);
    return update;
  }

  /**
   * Handles deleted or removed files from VFS and triggers a full reload.
   *
   * @param {string} path
   * @returns {Promise<HmrUpdate>}
   */
  async handleFileDelete(path) {
    const normalizedPath = normalizeModuleId(path);
    const update = this._createUpdate('full-reload', normalizedPath || String(path || ''));
    await this.applyUpdate(update);
    return update;
  }

  /**
   * Applies a precomputed update and triggers HMR hooks.
   *
   * @param {HmrUpdate} update
   * @returns {Promise<boolean>} true when update path completed, false when failed
   */
  async applyUpdate(update) {
    if (!update || typeof update !== 'object') {
      const error = new TypeError('update must be an object');
      this._lastError = error;
      this.emit('hmr:error', { error, update });
      if (this._throwOnError) throw error;
      return false;
    }

    const moduleId = normalizeModuleId(update.path);
    const patch = {
      ...update,
      path: moduleId || String(update.path || ''),
      timestamp: typeof update.timestamp === 'number' ? update.timestamp : Date.now(),
    };

    try {
      if (patch.type === 'css-update') {
        this.emit('hmr:css-update', patch);
        this._lastError = null;
        return true;
      }

      if (patch.type === 'update') {
        await this._applyModuleUpdate(patch);
        this._lastError = null;
        return true;
      }

      if (patch.type !== 'full-reload') {
        throw new TypeError(`Unsupported update type: ${String(patch.type)}`);
      }

      this._moduleCache.clear();
      this.emit('hmr:full-reload', patch);
      if (this._onFullReload) {
        await this._onFullReload(patch);
      }
      this._lastError = null;
      return true;
    } catch (error) {
      this._lastError = /** @type {Error} */ (error);
      this.emit('hmr:error', {
        error,
        update: patch,
        phase: 'applyUpdate',
      });
      if (this._throwOnError) throw error;
      return false;
    }
  }

  /**
   * Detaches VFS listeners and clears in-memory HMR metadata.
   */
  dispose() {
    if (this._vfs && this._vfsChangeHandler && typeof this._vfs.off === 'function') {
      this._vfs.off('change', this._vfsChangeHandler);
    }
    if (this._vfs && this._vfsDeleteHandler && typeof this._vfs.off === 'function') {
      this._vfs.off('delete', this._vfsDeleteHandler);
    }
    this._vfsChangeHandler = null;
    this._vfsDeleteHandler = null;
    this._hotStates.clear();
    this._listeners.clear();
  }

  /**
   * @param {HmrUpdate} update
   * @returns {Promise<void>}
   */
  async _applyModuleUpdate(update) {
    const moduleId = normalizeModuleId(update.path);
    if (!moduleId) {
      await this._triggerFullReload(update);
      return;
    }

    const state = this._hotStates.get(moduleId);

    if (state?.declined) {
      await this._triggerFullReload(update);
      return;
    }

    const depCallbacks = this._collectDependencyAcceptCallbacks(moduleId);
    const hasSelfAccept = Boolean(state && state.selfAcceptCallbacks.size > 0);
    const hasDepAccept = depCallbacks.length > 0;

    if (!hasSelfAccept && !hasDepAccept) {
      await this._triggerFullReload(update);
      return;
    }

    if (state) {
      for (const callback of state.disposeCallbacks) {
        await this._runCallback(callback, {
          phase: 'dispose',
          moduleId,
          update,
        }, [state.data]);
      }
    }

    this._clearModuleCache(moduleId);
    this.emit('hmr:update', update);

    if (state) {
      for (const callback of state.selfAcceptCallbacks) {
        await this._runCallback(callback, {
          phase: 'accept',
          moduleId,
          update,
        }, [update]);
      }
    }

    for (const callback of depCallbacks) {
      await this._runCallback(callback, {
        phase: 'accept',
        moduleId,
        update,
        isDependencyAccept: true,
      }, [[update]]);
    }
  }

  /**
   * @param {string} moduleId
   * @returns {HotState}
   */
  _ensureHotState(moduleId) {
    if (!this._hotStates.has(moduleId)) {
      this._hotStates.set(moduleId, createHotState());
    }

    return this._hotStates.get(moduleId);
  }

  /**
   * @param {string} moduleId
   * @param {string|string[]|Function|undefined} depsOrCallback
   * @param {Function|undefined} callback
   */
  _registerAccept(moduleId, depsOrCallback, callback) {
    const state = this._ensureHotState(moduleId);

    if (typeof depsOrCallback === 'function' || depsOrCallback === undefined) {
      state.selfAcceptCallbacks.add(typeof depsOrCallback === 'function' ? depsOrCallback : () => {});
      return;
    }

    const depIds = Array.isArray(depsOrCallback) ? depsOrCallback : [depsOrCallback];
    if (!depIds.every((dep) => typeof dep === 'string')) {
      throw new TypeError('accept dependencies must be a string or array of strings');
    }

    const depCallback = typeof callback === 'function' ? callback : () => {};

    for (const depId of depIds) {
      const normalizedDep = normalizeModuleId(depId);
      if (!normalizedDep) continue;

      if (!state.depAcceptCallbacks.has(normalizedDep)) {
        state.depAcceptCallbacks.set(normalizedDep, new Set());
      }

      state.depAcceptCallbacks.get(normalizedDep).add(depCallback);
    }
  }

  /**
   * @param {string} moduleId
   * @returns {boolean}
   */
  _hasAcceptedUpdate(moduleId) {
    const state = this._hotStates.get(moduleId);

    if (state && !state.declined && state.selfAcceptCallbacks.size > 0) {
      return true;
    }

    for (const candidateState of this._hotStates.values()) {
      if (candidateState.declined) continue;
      const callbacks = candidateState.depAcceptCallbacks.get(moduleId);
      if (callbacks && callbacks.size > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {string} moduleId
   * @returns {Function[]}
   */
  _collectDependencyAcceptCallbacks(moduleId) {
    const callbackSet = new Set();

    for (const state of this._hotStates.values()) {
      if (state.declined) continue;
      const handlers = state.depAcceptCallbacks.get(moduleId);
      if (!handlers || handlers.size === 0) continue;

      for (const callback of handlers) {
        callbackSet.add(callback);
      }
    }

    return Array.from(callbackSet);
  }

  /**
   * @param {string} moduleId
   */
  _clearModuleCache(moduleId) {
    if (!(this._moduleCache instanceof Map)) return;

    for (const key of [...this._moduleCache.keys()]) {
      if (normalizeModuleId(String(key)) === moduleId) {
        this._moduleCache.delete(key);
      }
    }
  }

  /**
   * @param {HmrUpdate} update
   * @returns {Promise<void>}
   */
  async _triggerFullReload(update) {
    const reloadUpdate = /** @type {HmrUpdate} */ ({
      ...update,
      type: 'full-reload',
      timestamp: typeof update.timestamp === 'number' ? update.timestamp : Date.now(),
    });

    this._moduleCache.clear();
    this.emit('hmr:full-reload', reloadUpdate);

    if (this._onFullReload) {
      await this._onFullReload(reloadUpdate);
    }
  }

  /**
   * @param {Function} callback
   * @param {Record<string, unknown>} errorContext
   * @param {unknown[]} args
   * @returns {Promise<void>}
   */
  async _runCallback(callback, errorContext, args) {
    try {
      await callback(...args);
    } catch (error) {
      this.emit('hmr:error', {
        ...errorContext,
        error,
      });
    }
  }

  /**
   * @param {HmrUpdateType} type
   * @param {string} path
   * @param {string|Uint8Array|ArrayBuffer|null|undefined} [content]
   * @returns {HmrUpdate}
   */
  _createUpdate(type, path, content) {
    return {
      type,
      path,
      content,
      timestamp: Date.now(),
    };
  }

  /** @returns {Error | null} */
  get lastError() {
    return this._lastError;
  }
}

Object.assign(HmrClient.prototype, EventEmitterMixin);

/**
 * @param {HmrClientOptions} [options]
 * @returns {HmrClient}
 */
export function createHmrClient(options = {}) {
  return new HmrClient(options);
}
