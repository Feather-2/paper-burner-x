/**
 * OR-Set - Observed-Remove Set
 *
 * 支持添加和删除的 CRDT 集合。
 * 使用唯一标签避免 add-remove 竞争。
 */

import { nextTick } from '../lamport-clock.js';

export class ORSet {
  constructor(options = {}) {
    this._nodeId = options.nodeId || nextTick().id.split('_')[0];
    // element → Set<tag>
    this._elements = new Map();
    // 已删除的 tag
    this._tombstones = new Set();
    // tag → element（反向索引）
    this._tagToElement = new Map();
  }

  /**
   * 生成唯一标签
   */
  _makeTag() {
    const clock = nextTick();
    return `${this._nodeId}_${clock.seq}_${clock.ts}`;
  }

  /**
   * 获取所有元素
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
   */
  get size() {
    return this.values().length;
  }

  /**
   * 检查是否包含
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
      clock: nextTick(),
      nodeId: this._nodeId,
    };
  }

  /**
   * 删除元素（删除所有观察到的 tag）
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
      clock: nextTick(),
      nodeId: this._nodeId,
    };
  }

  /**
   * 应用远程操作
   */
  apply(op) {
    if (op.type === 'set-add') {
      if (!this._elements.has(op.element)) {
        this._elements.set(op.element, new Set());
      }
      this._elements.get(op.element).add(op.tag);
      this._tagToElement.set(op.tag, op.element);
      return true;
    }

    if (op.type === 'set-remove') {
      let changed = false;
      for (const tag of op.tags || []) {
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
   */
  clear() {
    const ops = [];
    for (const element of this.values()) {
      const op = this.delete(element);
      if (op) ops.push(op);
    }
    return ops;
  }

  /**
   * 垃圾回收（删除已完全删除的元素）
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
   */
  toJSON() {
    const elements = {};
    for (const [element, tags] of this._elements) {
      elements[element] = Array.from(tags);
    }
    return {
      type: 'ORSet',
      nodeId: this._nodeId,
      elements,
      tombstones: Array.from(this._tombstones),
    };
  }

  /**
   * 反序列化
   */
  static fromJSON(json) {
    if (json?.type !== 'ORSet') {
      throw new Error('Invalid ORSet JSON');
    }
    const set = new ORSet({ nodeId: json.nodeId });
    for (const [element, tags] of Object.entries(json.elements || {})) {
      set._elements.set(element, new Set(tags));
      for (const tag of tags) {
        set._tagToElement.set(tag, element);
      }
    }
    set._tombstones = new Set(json.tombstones || []);
    return set;
  }
}

export default ORSet;
