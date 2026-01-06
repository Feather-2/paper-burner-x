/**
 * LWW Map - Last-Writer-Wins 键值对
 *
 * 每个 key 都是一个 LWW Register
 * 适用于状态管理场景
 */

import { nextTick, compare } from '../lamport-clock.js';

export class LWWMap {
  constructor(options = {}) {
    this._nodeId = options.nodeId || nextTick().id.split('_')[0];
    this._entries = new Map(); // key → { value, clock, deleted }
  }

  /**
   * 获取所有键
   */
  keys() {
    const result = [];
    for (const [key, entry] of this._entries) {
      if (!entry.deleted) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * 获取所有值（不含已删除）
   */
  values() {
    const result = [];
    for (const entry of this._entries.values()) {
      if (!entry.deleted) {
        result.push(entry.value);
      }
    }
    return result;
  }

  /**
   * 获取所有条目
   */
  entries() {
    const result = [];
    for (const [key, entry] of this._entries) {
      if (!entry.deleted) {
        result.push([key, entry.value]);
      }
    }
    return result;
  }

  /**
   * 转换为普通对象
   */
  toObject() {
    const result = {};
    for (const [key, entry] of this._entries) {
      if (!entry.deleted) {
        result[key] = entry.value;
      }
    }
    return result;
  }

  /**
   * 获取值
   */
  get(key) {
    const entry = this._entries.get(key);
    if (!entry || entry.deleted) return undefined;
    return entry.value;
  }

  /**
   * 检查是否存在
   */
  has(key) {
    const entry = this._entries.get(key);
    return entry && !entry.deleted;
  }

  /**
   * 获取大小
   */
  get size() {
    let count = 0;
    for (const entry of this._entries.values()) {
      if (!entry.deleted) count++;
    }
    return count;
  }

  /**
   * 设置值
   */
  set(key, value) {
    const clock = nextTick();
    this._entries.set(key, {
      value,
      clock,
      deleted: false,
      nodeId: this._nodeId,
    });

    return {
      type: 'map-set',
      key,
      value,
      clock,
      nodeId: this._nodeId,
    };
  }

  /**
   * 删除键
   */
  delete(key) {
    const clock = nextTick();
    const existing = this._entries.get(key);

    this._entries.set(key, {
      value: existing?.value,
      clock,
      deleted: true,
      nodeId: this._nodeId,
    });

    return {
      type: 'map-delete',
      key,
      clock,
      nodeId: this._nodeId,
    };
  }

  /**
   * 应用远程操作
   */
  apply(op) {
    if (op.type !== 'map-set' && op.type !== 'map-delete') {
      return false;
    }

    const existing = this._entries.get(op.key);

    // 比较时钟
    if (existing) {
      const cmp = compare(op.clock, existing.clock);
      if (cmp < 0) return false;
      if (cmp === 0 && op.nodeId <= existing.nodeId) return false;
    }

    this._entries.set(op.key, {
      value: op.type === 'map-set' ? op.value : existing?.value,
      clock: op.clock,
      deleted: op.type === 'map-delete',
      nodeId: op.nodeId,
    });

    return true;
  }

  /**
   * 合并另一个 LWWMap
   */
  merge(other) {
    if (!(other instanceof LWWMap)) return false;

    let changed = false;
    for (const [key, entry] of other._entries) {
      const existing = this._entries.get(key);

      if (!existing) {
        this._entries.set(key, { ...entry });
        changed = true;
        continue;
      }

      const cmp = compare(entry.clock, existing.clock);
      if (cmp > 0 || (cmp === 0 && entry.nodeId > existing.nodeId)) {
        this._entries.set(key, { ...entry });
        changed = true;
      }
    }
    return changed;
  }

  /**
   * 清空
   */
  clear() {
    const ops = [];
    for (const key of this._entries.keys()) {
      ops.push(this.delete(key));
    }
    return ops;
  }

  /**
   * 序列化
   */
  toJSON() {
    const entries = {};
    for (const [key, entry] of this._entries) {
      entries[key] = entry;
    }
    return {
      type: 'LWWMap',
      nodeId: this._nodeId,
      entries,
    };
  }

  /**
   * 反序列化
   */
  static fromJSON(json) {
    if (json?.type !== 'LWWMap') {
      throw new Error('Invalid LWWMap JSON');
    }
    const map = new LWWMap({ nodeId: json.nodeId });
    for (const [key, entry] of Object.entries(json.entries || {})) {
      map._entries.set(key, entry);
    }
    return map;
  }
}

export default LWWMap;
