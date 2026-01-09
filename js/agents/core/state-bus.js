/**
 * StateBus - 统一状态管理
 *
 * 特性：
 * - 路径式访问 (get/set)
 * - 变更订阅（支持通配符）
 * - 快照与回滚
 * - 自动与 EventBus 联动
 */

/**
 * @typedef {import('./types').EventBus} EventBus
 * @typedef {import('./types').StateBusOptions} StateBusOptions
 * @typedef {import('./types').StateChangeRecord} StateChangeRecord
 * @typedef {(change: StateChangeRecord) => void} StateChangeSubscriber
 * @typedef {(newValue: unknown, oldValue: unknown, path: string) => void} LegacyStateSubscriber
 * @typedef {StateChangeSubscriber | LegacyStateSubscriber} StateSubscriber
 */

/**
 * Deep clone helper with structuredClone preferred.
 * Falls back to JSON clone for environments/values that are not cloneable.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fallback for non-cloneable values
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export class StateBus {
  /**
   * @param {StateBusOptions} [options]
   */
  constructor(options = {}) {
    /** @type {EventBus | null} */
    this._events = options.events || null;

    /** @type {Record<string, any>} */
    this._state = {
      meta: {
        runId: null,
        status: 'idle',
        startedAt: null,
        updatedAt: null,
      },
      input: {},
      context: {},
      stages: {},
      runtime: {
        iteration: 0,
        messages: [],
        tokens: { input: 0, output: 0 },
      },
      plugins: {},
    };

    /**
     * pattern -> (rawCallback -> wrappedCallback)
     * @type {Map<string, Map<Function, (change: StateChangeRecord) => void>>}
     */
    this._subscribers = new Map();

    /** @type {Map<string, Record<string, unknown>>} */
    this._snapshots = new Map();

    /** @type {number} */
    this._maxSnapshots = options.maxSnapshots || 50;

    /** @type {StateChangeRecord[] | null} */
    this._changeLog = options.keepLog ? [] : null;

    /** @type {number} */
    this._maxLog = options.maxLog || 500;
  }

  /**
   * 获取状态值
   * @overload
   * @returns {Record<string, unknown>}
   */
  /**
   * 获取状态值（点分隔路径，如 'runtime.tokens.input'）
   * @template T
   * @overload
   * @param {string} path
   * @returns {T | undefined}
   */
  /**
   * @param {string} [path]
   * @returns {unknown}
   */
  get(path) {
    if (!path) return this._state;

    const keys = path.split('.');
    let current = this._state;

    for (const key of keys) {
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * 设置状态值
   * @param {string} path
   * @param {unknown} value
   * @param {Record<string, unknown>} [meta]
   * @returns {void}
   */
  set(path, value, meta = {}) {
    const oldValue = this.get(path);
    if (oldValue === value) return;

    const keys = path.split('.');
    const lastKey = keys.pop();
    if (!lastKey) return;
    let current = this._state;

    for (const key of keys) {
      if (current[key] == null || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    current[lastKey] = value;
    this._state.meta.updatedAt = Date.now();

    this._notifyChange(path, value, oldValue, meta);
  }

  /**
   * 合并对象到指定路径
   * @param {string} path
   * @param {Record<string, unknown>} updates
   * @param {Record<string, unknown>} [meta]
   * @returns {void}
   */
  merge(path, updates, meta = {}) {
    const current = this.get(path) || {};
    if (current == null || typeof current !== 'object' || updates == null || typeof updates !== 'object') {
      this.set(path, updates, meta);
      return;
    }

    const merged = { ...current, ...updates };
    this.set(path, merged, meta);
  }

  /**
   * 删除状态值
   * @param {string} path
   * @returns {boolean}
   */
  delete(path) {
    const oldValue = this.get(path);
    if (oldValue === undefined) return false;

    const keys = path.split('.');
    const lastKey = keys.pop();
    if (!lastKey) return false;

    let current = this._state;
    for (const key of keys) {
      if (current == null || typeof current !== 'object') return false;
      current = current[key];
    }

    if (current == null || typeof current !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(current, lastKey)) return false;

    delete current[lastKey];
    this._state.meta.updatedAt = Date.now();
    this._notifyChange(path, undefined, oldValue, { op: 'delete' });
    return true;
  }

  /**
   * 数组追加
   * @param {string} path
   * @param {unknown} item
   * @param {Record<string, unknown>} [meta]
   * @returns {void}
   */
  push(path, item, meta = {}) {
    const arr = this.get(path);
    if (!Array.isArray(arr)) {
      this.set(path, [item], meta);
      return;
    }

    const newArr = [...arr, item];
    this.set(path, newArr, meta);
  }

  /**
   * 订阅状态变更
   * @param {string} pattern - 路径模式，支持 * 通配符
   * @param {StateSubscriber} callback
   * @returns {() => void} 取消订阅函数
   */
  subscribe(pattern, callback) {
    if (!this._subscribers.has(pattern)) {
      this._subscribers.set(pattern, new Map());
    }

    const subs = this._subscribers.get(pattern);

    /** @type {StateChangeSubscriber} */
    const wrapped = callback.length >= 2
      ? (change) => /** @type {LegacyStateSubscriber} */ (callback)(change.newValue, change.oldValue, change.path)
      : /** @type {StateChangeSubscriber} */ (callback);

    subs.set(callback, wrapped);

    return () => { subs.delete(callback); };
  }

  /**
   * 创建快照
   * @param {string | null} [id]
   * @returns {string}
   */
  snapshot(id = null) {
    const snapshotId = id || `snap_${Date.now()}`;
    const data = deepClone(this._state);

    // LRU eviction: remove oldest snapshots when limit exceeded
    if (this._snapshots.size >= this._maxSnapshots && !this._snapshots.has(snapshotId)) {
      const oldest = this._snapshots.keys().next().value;
      if (oldest) this._snapshots.delete(oldest);
    }

    // Move to end for LRU ordering (delete + set)
    if (this._snapshots.has(snapshotId)) {
      this._snapshots.delete(snapshotId);
    }
    this._snapshots.set(snapshotId, data);

    this._emit('state.snapshot', { id: snapshotId });
    return snapshotId;
  }

  /**
   * 回滚到快照
   * @param {string} snapshotId
   * @returns {boolean}
   */
  rollback(snapshotId) {
    const data = this._snapshots.get(snapshotId);
    if (!data) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const oldState = this._state;
    this._state = deepClone(data);

    this._emit('state.rollback', { id: snapshotId, oldState });
    this._notifyChange('*', this._state, oldState, { rollback: true });

    return true;
  }

  /**
   * 删除快照
   * @param {string} snapshotId
   * @returns {boolean}
   */
  deleteSnapshot(snapshotId) {
    return this._snapshots.delete(snapshotId);
  }

  /**
   * 列出所有快照
   * @returns {string[]}
   */
  listSnapshots() {
    return [...this._snapshots.keys()];
  }

  /**
   * 导出状态
   * @returns {Record<string, unknown>}
   */
  toJSON() {
    return deepClone(this._state);
  }

  /**
   * 导入状态
   * @param {Record<string, unknown>} data
   * @returns {void}
   */
  fromJSON(data) {
    if (data && typeof data === 'object') {
      this._state = deepClone(data);
      this._emit('state.imported', { state: this._state });
    }
  }

  /**
   * 重置状态
   * @returns {void}
   */
  reset() {
    const oldState = this._state;
    this._state = {
      meta: { runId: null, status: 'idle', startedAt: null, updatedAt: null },
      input: {},
      context: {},
      stages: {},
      runtime: { iteration: 0, messages: [], tokens: { input: 0, output: 0 } },
      plugins: {},
    };
    this._emit('state.reset', { oldState });
  }

  /**
   * 获取变更日志
   * @param {number} [limit]
   * @returns {StateChangeRecord[]}
   */
  getChangeLog(limit = 50) {
    if (!this._changeLog) return [];
    return this._changeLog.slice(-limit);
  }

  /**
   * 通知变更
   * @private
   * @param {string} path
   * @param {unknown} newValue
   * @param {unknown} oldValue
   * @param {Record<string, unknown>} [meta]
   * @returns {void}
   */
  _notifyChange(path, newValue, oldValue, meta) {
    /** @type {StateChangeRecord} */
    const change = {
      path,
      oldValue,
      newValue,
      timestamp: Date.now(),
      meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
    };

    // 记录变更日志
    if (this._changeLog) {
      this._changeLog.push(change);
      if (this._changeLog.length > this._maxLog) {
        this._changeLog.shift();
      }
    }

    // 通知订阅者
    for (const [pattern, callbacks] of this._subscribers.entries()) {
      if (this._matchPath(pattern, path)) {
        for (const cb of callbacks.values()) {
          try {
            cb(change);
          } catch (err) {
            console.error(`[StateBus] Subscriber error for "${pattern}":`, err);
          }
        }
      }
    }

    // 发射事件
    this._emit('state.changed', change);
    this._emit('state.change', { path, newValue, oldValue, ...(meta || {}) }); // legacy alias
  }

  /**
   * 路径匹配
   * @private
   * @param {string} pattern
   * @param {string} path
   * @returns {boolean}
   */
  _matchPath(pattern, path) {
    if (pattern === '*' || pattern === path) return true;

    // 前缀匹配: 'runtime.*' 匹配 'runtime.tokens.input'
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return path === prefix || path.startsWith(prefix + '.');
    }

    // 通配符匹配
    const regex = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]*') + '$'
    );
    return regex.test(path);
  }

  /**
   * 发射事件到 EventBus
   * @private
   * @param {string} event
   * @param {unknown} data
   * @returns {void}
   */
  _emit(event, data) {
    if (this._events) {
      this._events.emitSync(event, data);
    }
  }
}

export default StateBus;
