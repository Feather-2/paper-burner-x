/**
 * LWW Map - Last-Writer-Wins 键值对
 *
 * 每个 key 都是一个 LWW Register
 * 适用于状态管理场景
 */

import { nextTick, compare } from '../lamport-clock.js';

/** @typedef {import("../types.d.ts").LamportClockState} LamportClockState */
/** @typedef {{ nextTick: () => LamportClockState }} ClockServiceLike */
/** @typedef {{ nodeId?: string, clockService?: ClockServiceLike }} LWWMapOptions */
/**
 * @template V
 * @typedef {{ value: V, clock: LamportClockState, deleted: boolean, nodeId: string }} LWWMapEntry
 */
/**
 * @template V
 * @typedef {{ type: 'map-set', key: string, value: V, clock: LamportClockState, nodeId: string }} LWWMapSetOp
 */
/** @typedef {{ type: 'map-delete', key: string, clock: LamportClockState, nodeId: string }} LWWMapDeleteOp */
/**
 * @template V
 * @typedef {LWWMapSetOp<V> | LWWMapDeleteOp | { type: string, [key: string]: unknown }} LWWMapOp
 */
/**
 * @template V
 * @typedef {{ type: 'LWWMap', nodeId: string, entries: Record<string, LWWMapEntry<V>> }} LWWMapJSON
 */

/**
 * Last-Writer-Wins Map (LWW-Map)
 *
 * 对每个 key 维护独立的 LWW 元数据（clock + nodeId tie-break）。
 *
 * @template V
 */
export class LWWMap {
  /**
   * @param {LWWMapOptions} [options={}]
   */
  constructor(options = {}) {
    /** @type {ClockServiceLike | null} */
    this._clockService = options.clockService || null;
    /** @type {string} */
    this._nodeId = options.nodeId || this._nextTick().id.split('_')[0];
    /** @type {Map<string, LWWMapEntry<V>>} */
    this._entries = new Map(); // key → { value, clock, deleted }
  }

  /**
   * 获取下一个时钟值（优先使用注入的 clockService）
   * @returns {LamportClockState}
   */
  _nextTick() {
    return this._clockService ? this._clockService.nextTick() : nextTick();
  }

  /**
   * 获取所有键
   * @returns {string[]}
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
   * @returns {V[]}
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
   * @returns {Array<[string, V]>}
   */
  entries() {
    /** @type {Array<[string, V]>} */
    const result = [];
    for (const [key, entry] of this._entries) {
      if (!entry.deleted) {
        result.push(/** @type {[string, V]} */ ([key, entry.value]));
      }
    }
    return result;
  }

  /**
   * 转换为普通对象
   * @returns {Record<string, V>}
   */
  toObject() {
    /** @type {Record<string, V>} */
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
   * @param {string} key
   * @returns {V | undefined}
   */
  get(key) {
    const entry = this._entries.get(key);
    if (!entry || entry.deleted) return undefined;
    return entry.value;
  }

  /**
   * 检查是否存在
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this._entries.get(key);
    return entry && !entry.deleted;
  }

  /**
   * 获取大小
   * @returns {number}
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
   * @param {string} key
   * @param {V} value
   * @returns {LWWMapSetOp<V>}
   */
  set(key, value) {
    const clock = this._nextTick();
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
   * @param {string} key
   * @returns {LWWMapDeleteOp}
   */
  delete(key) {
    const clock = this._nextTick();
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
   * @param {LWWMapOp<V>} op
   * @returns {boolean}
   */
  apply(op) {
    if (op.type !== 'map-set' && op.type !== 'map-delete') {
      return false;
    }

    const mapOp = /** @type {LWWMapSetOp<V> | LWWMapDeleteOp} */ (op);
    const existing = this._entries.get(mapOp.key);

    // 比较时钟
    if (existing) {
      const cmp = compare(mapOp.clock, existing.clock);
      if (cmp < 0) return false;
      if (cmp === 0 && mapOp.nodeId <= existing.nodeId) return false;
    }

    this._entries.set(mapOp.key, {
      value: mapOp.type === 'map-set' ? /** @type {LWWMapSetOp<V>} */ (mapOp).value : existing?.value,
      clock: mapOp.clock,
      deleted: mapOp.type === 'map-delete',
      nodeId: mapOp.nodeId,
    });

    return true;
  }

  /**
   * 合并另一个 LWWMap
   * @param {LWWMap<V>} other
   * @returns {boolean}
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
   * @returns {LWWMapDeleteOp[]}
   */
  clear() {
    /** @type {LWWMapDeleteOp[]} */
    const ops = [];
    for (const key of this._entries.keys()) {
      ops.push(this.delete(key));
    }
    return ops;
  }

  /**
   * 序列化
   * @returns {LWWMapJSON<V>}
   */
  toJSON() {
    /** @type {Record<string, LWWMapEntry<V>>} */
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
   * @template U
   * @param {LWWMapJSON<U>} json
   * @returns {LWWMap<U>}
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
