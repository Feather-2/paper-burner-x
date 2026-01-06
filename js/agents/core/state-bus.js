/**
 * StateBus - 统一状态管理
 *
 * 特性：
 * - 路径式访问 (get/set)
 * - 变更订阅（支持通配符）
 * - 快照与回滚
 * - 自动与 EventBus 联动
 */

export class StateBus {
  constructor(options = {}) {
    this._events = options.events || null;
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
    this._subscribers = new Map();
    this._snapshots = new Map();
    this._changeLog = options.keepLog ? [] : null;
    this._maxLog = options.maxLog || 500;
  }

  /**
   * 获取状态值
   * @param {string} path - 点分隔路径，如 'runtime.tokens.input'
   * @returns {*}
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
   * @param {string} path - 点分隔路径
   * @param {*} value - 新值
   * @param {Object} meta - 变更元数据
   */
  set(path, value, meta = {}) {
    const oldValue = this.get(path);
    if (oldValue === value) return false;

    const keys = path.split('.');
    const lastKey = keys.pop();
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
    return true;
  }

  /**
   * 合并对象到指定路径
   */
  merge(path, updates, meta = {}) {
    const current = this.get(path) || {};
    if (typeof current !== 'object' || typeof updates !== 'object') {
      return this.set(path, updates, meta);
    }

    const merged = { ...current, ...updates };
    return this.set(path, merged, meta);
  }

  /**
   * 数组追加
   */
  push(path, item, meta = {}) {
    const arr = this.get(path);
    if (!Array.isArray(arr)) {
      return this.set(path, [item], meta);
    }

    const newArr = [...arr, item];
    return this.set(path, newArr, meta);
  }

  /**
   * 订阅状态变更
   * @param {string} pattern - 路径模式，支持 * 通配符
   * @param {Function} callback - (newValue, oldValue, path) => void
   * @returns {Function} 取消订阅函数
   */
  subscribe(pattern, callback) {
    if (!this._subscribers.has(pattern)) {
      this._subscribers.set(pattern, new Set());
    }
    this._subscribers.get(pattern).add(callback);

    return () => {
      const subs = this._subscribers.get(pattern);
      if (subs) subs.delete(callback);
    };
  }

  /**
   * 创建快照
   */
  snapshot(id = null) {
    const snapshotId = id || `snap_${Date.now()}`;
    const data = JSON.parse(JSON.stringify(this._state));
    this._snapshots.set(snapshotId, data);

    this._emit('state.snapshot', { id: snapshotId });
    return snapshotId;
  }

  /**
   * 回滚到快照
   */
  rollback(snapshotId) {
    const data = this._snapshots.get(snapshotId);
    if (!data) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const oldState = this._state;
    this._state = JSON.parse(JSON.stringify(data));

    this._emit('state.rollback', { id: snapshotId, oldState });
    this._notifyChange('*', this._state, oldState, { rollback: true });

    return true;
  }

  /**
   * 删除快照
   */
  deleteSnapshot(snapshotId) {
    return this._snapshots.delete(snapshotId);
  }

  /**
   * 列出所有快照
   */
  listSnapshots() {
    return [...this._snapshots.keys()];
  }

  /**
   * 导出状态
   */
  toJSON() {
    return JSON.parse(JSON.stringify(this._state));
  }

  /**
   * 导入状态
   */
  fromJSON(data) {
    if (data && typeof data === 'object') {
      this._state = JSON.parse(JSON.stringify(data));
      this._emit('state.imported', { state: this._state });
    }
  }

  /**
   * 重置状态
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
   */
  getChangeLog(limit = 50) {
    if (!this._changeLog) return [];
    return this._changeLog.slice(-limit);
  }

  /**
   * 通知变更
   */
  _notifyChange(path, newValue, oldValue, meta) {
    // 记录变更日志
    if (this._changeLog) {
      this._changeLog.push({
        path,
        newValue,
        oldValue,
        timestamp: Date.now(),
        ...meta,
      });
      if (this._changeLog.length > this._maxLog) {
        this._changeLog.shift();
      }
    }

    // 通知订阅者
    for (const [pattern, callbacks] of this._subscribers) {
      if (this._matchPath(pattern, path)) {
        for (const cb of callbacks) {
          try {
            cb(newValue, oldValue, path);
          } catch (err) {
            console.error(`[StateBus] Subscriber error for "${pattern}":`, err);
          }
        }
      }
    }

    // 发射事件
    this._emit('state.change', { path, newValue, oldValue, ...meta });
  }

  /**
   * 路径匹配
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
   */
  _emit(event, data) {
    if (this._events) {
      this._events.emitSync(event, data);
    }
  }
}

export default StateBus;
