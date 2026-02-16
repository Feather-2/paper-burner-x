/**
 * OR-Set - Observed-Remove Set
 *
 * 支持添加和删除的 CRDT 集合。
 * 使用唯一标签避免 add-remove 竞争。
 */

import { nextTick } from '../lamport-clock.js';

/** @typedef {import("../types.d.ts").LamportClockState} LamportClockState */
/** @typedef {{ nextTick: () => LamportClockState }} ClockServiceLike */
/** @typedef {{ nodeId?: string, clockService?: ClockServiceLike }} ORSetOptions */
/**
 * @template T
 * @typedef {{ type: 'set-add', element: T, tag: string, clock: LamportClockState, nodeId: string }} ORSetAddOp
 */
/**
 * @template T
 * @typedef {{ type: 'set-remove', element: T, tags: string[], clock: LamportClockState, nodeId: string }} ORSetRemoveOp
 */
/**
 * @template T
 * @typedef {ORSetAddOp<T> | ORSetRemoveOp<T> | { type: string, [key: string]: unknown }} ORSetOp
 */
/** @typedef {{ type: 'ORSet', nodeId: string, entries?: Array<{element: *, tags: string[]}>, elements?: Record<string, string[]>, tombstones: string[] }} ORSetJSON */

/**
 * Observed-Remove Set (OR-Set)
 *
 * 通过为每次 add 分配唯一 tag，remove 时只“观察性”删除已知 tag，
 * 从而解决并发 add/remove 的竞争问题。
 *
 * @template T
 */
export class ORSet {
  /**
   * @param {ORSetOptions} [options={}]
   */
  constructor(options = {}) {
    /** @type {ClockServiceLike | null} */
    this._clockService = options.clockService || null;
    /** @type {string} */
    this._nodeId = options.nodeId || this._nextTick().id.split('_')[0];
    // element → Set<tag>
    /** @type {Map<T, Set<string>>} */
    this._elements = new Map();
    // 已删除的 tag
    /** @type {Set<string>} */
    this._tombstones = new Set();
    // tag → element（反向索引）
    /** @type {Map<string, T>} */
    this._tagToElement = new Map();
  }

  /**
   * 获取下一个时钟值（优先使用注入的 clockService）
   * @returns {LamportClockState}
   */
  _nextTick() {
    return this._clockService ? this._clockService.nextTick() : nextTick();
  }

  /**
   * 生成唯一标签
   * @returns {string}
   */
  _makeTag() {
    const clock = this._nextTick();
    return `${this._nodeId}_${clock.seq}_${clock.ts}`;
  }

  /**
   * 获取所有元素
   * @returns {T[]}
   */
  values() {
    const result = [];
    for (const [element, tags] of this._elements) {
      // 只有当存在未删除的 tag 时才算存在
      for (const tag of tags) {
        if (!this._tombstones.has(tag)) {
          result.push(element);
          break;
        }
      }
    }
    return result;
  }

  /**
   * 获取大小
   * @returns {number}
   */
  get size() {
    return this.values().length;
  }

  /**
   * 检查是否包含
   * @param {T} element
   * @returns {boolean}
   */
  has(element) {
    const tags = this._elements.get(element);
    if (!tags) return false;
    for (const tag of tags) {
      if (!this._tombstones.has(tag)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 添加元素
   * @param {T} element
   * @returns {ORSetAddOp<T>}
   */
  add(element) {
    const tag = this._makeTag();

    if (!this._elements.has(element)) {
      this._elements.set(element, new Set());
    }
    this._elements.get(element).add(tag);
    this._tagToElement.set(tag, element);

    return {
      type: 'set-add',
      element,
      tag,
      clock: this._nextTick(),
      nodeId: this._nodeId,
    };
  }

  /**
   * 删除元素（删除所有观察到的 tag）
   * @param {T} element
   * @returns {ORSetRemoveOp<T> | null}
   */
  delete(element) {
    const tags = this._elements.get(element);
    if (!tags) return null;

    const removedTags = [];
    for (const tag of tags) {
      if (!this._tombstones.has(tag)) {
        this._tombstones.add(tag);
        removedTags.push(tag);
      }
    }

    if (removedTags.length === 0) return null;

    return {
      type: 'set-remove',
      element,
      tags: removedTags,
      clock: this._nextTick(),
      nodeId: this._nodeId,
    };
  }

  /**
   * 应用远程操作
   * @param {ORSetOp<T>} op
   * @returns {boolean}
   */
  apply(op) {
    if (op.type === 'set-add') {
      const addOp = /** @type {ORSetAddOp<T>} */ (op);
      if (!this._elements.has(addOp.element)) {
        this._elements.set(addOp.element, new Set());
      }
      const tags = this._elements.get(addOp.element);
      if (!tags) return false;
      const hadTag = tags.has(addOp.tag);
      tags.add(addOp.tag);

      const prevElement = this._tagToElement.get(addOp.tag);
      this._tagToElement.set(addOp.tag, addOp.element);
      return !hadTag || prevElement !== addOp.element;
    }

    if (op.type === 'set-remove') {
      const removeOp = /** @type {ORSetRemoveOp<T>} */ (op);
      let changed = false;
      for (const tag of removeOp.tags) {
        if (!this._tombstones.has(tag)) {
          this._tombstones.add(tag);
          changed = true;
        }
      }
      return changed;
    }

    return false;
  }

  /**
   * 合并另一个 ORSet
   * @param {ORSet<T>} other
   * @returns {boolean}
   */
  merge(other) {
    if (!(other instanceof ORSet)) return false;

    let changed = false;

    // 合并元素和标签
    for (const [element, tags] of other._elements) {
      if (!this._elements.has(element)) {
        this._elements.set(element, new Set());
      }
      for (const tag of tags) {
        if (!this._elements.get(element).has(tag)) {
          this._elements.get(element).add(tag);
          this._tagToElement.set(tag, element);
          changed = true;
        }
      }
    }

    // 合并墓碑
    for (const tag of other._tombstones) {
      if (!this._tombstones.has(tag)) {
        this._tombstones.add(tag);
        changed = true;
      }
    }

    return changed;
  }

  /**
   * 清空
   * @returns {ORSetRemoveOp<T>[]}
   */
  clear() {
    /** @type {ORSetRemoveOp<T>[]} */
    const ops = [];
    for (const element of this.values()) {
      const op = this.delete(element);
      if (op) ops.push(op);
    }
    return ops;
  }

  /**
   * 垃圾回收（删除已完全删除的元素）
   * @returns {number}
   */
  gc() {
    const toDelete = [];
    for (const [element, tags] of this._elements) {
      let allDeleted = true;
      for (const tag of tags) {
        if (!this._tombstones.has(tag)) {
          allDeleted = false;
          break;
        }
      }
      if (allDeleted) {
        toDelete.push(element);
      }
    }
    for (const element of toDelete) {
      const tags = this._elements.get(element);
      for (const tag of tags) {
        this._tagToElement.delete(tag);
        this._tombstones.delete(tag);
      }
      this._elements.delete(element);
    }
    return toDelete.length;
  }

  /**
   * 序列化
   * @returns {ORSetJSON}
   */
  toJSON() {
    /** @type {Array<{element: T, tags: string[]}>} */
    const entries = [];
    for (const [element, tags] of this._elements) {
      entries.push({ element, tags: Array.from(tags) });
    }
    return {
      type: 'ORSet',
      nodeId: this._nodeId,
      entries,
      tombstones: Array.from(this._tombstones),
    };
  }

  /**
   * 反序列化
   * @template U
   * @param {ORSetJSON} json
   * @returns {ORSet<U>}
   */
  static fromJSON(json) {
    if (json?.type !== 'ORSet') {
      throw new Error('Invalid ORSet JSON');
    }
    const set = new ORSet({ nodeId: json.nodeId });
    if (json.entries) {
      // New format: array of {element, tags} — preserves original types
      for (const { element, tags } of json.entries) {
        const tagList = /** @type {string[]} */ (tags);
        set._elements.set(/** @type {U} */ (element), new Set(tagList));
        for (const tag of tagList) {
          set._tagToElement.set(tag, /** @type {U} */ (element));
        }
      }
    } else if (json.elements) {
      // Legacy format: object keys (string-only)
      for (const [key, tags] of Object.entries(json.elements)) {
        const tagList = /** @type {string[]} */ (tags);
        set._elements.set(/** @type {U} */ (key), new Set(tagList));
        for (const tag of tagList) {
          set._tagToElement.set(tag, /** @type {U} */ (key));
        }
      }
    }
    set._tombstones = new Set(json.tombstones || []);
    return set;
  }
}

export default ORSet;
