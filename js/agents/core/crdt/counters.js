/**
 * G-Counter & PN-Counter
 *
 * G-Counter: 只增计数器（每个节点维护自己的计数）
 * PN-Counter: 正负计数器（两个 G-Counter 相减）
 */

import { nextTick } from '../lamport-clock.js';

/**
 * G-Counter - Grow-only Counter
 */
export class GCounter {
  constructor(options = {}) {
    this._nodeId = options.nodeId || nextTick().id.split('_')[0];
    this._counts = new Map(); // nodeId → count
    this._counts.set(this._nodeId, 0);
  }

  /**
   * 获取总计数
   */
  get value() {
    let sum = 0;
    for (const count of this._counts.values()) {
      sum += count;
    }
    return sum;
  }

  /**
   * 增加（只能本节点）
   */
  increment(delta = 1) {
    if (delta < 0) throw new Error('GCounter can only increment');

    const current = this._counts.get(this._nodeId) || 0;
    this._counts.set(this._nodeId, current + delta);

    return {
      type: 'increment',
      nodeId: this._nodeId,
      value: this._counts.get(this._nodeId),
      clock: nextTick(),
    };
  }

  /**
   * 应用远程操作
   */
  apply(op) {
    if (op.type !== 'increment') return false;

    const current = this._counts.get(op.nodeId) || 0;
    if (op.value > current) {
      this._counts.set(op.nodeId, op.value);
      return true;
    }
    return false;
  }

  /**
   * 合并另一个 GCounter
   */
  merge(other) {
    if (!(other instanceof GCounter)) return false;

    let changed = false;
    for (const [nodeId, count] of other._counts) {
      const current = this._counts.get(nodeId) || 0;
      if (count > current) {
        this._counts.set(nodeId, count);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * 序列化
   */
  toJSON() {
    return {
      type: 'GCounter',
      nodeId: this._nodeId,
      counts: Object.fromEntries(this._counts),
    };
  }

  /**
   * 反序列化
   */
  static fromJSON(json) {
    if (json?.type !== 'GCounter') {
      throw new Error('Invalid GCounter JSON');
    }
    const counter = new GCounter({ nodeId: json.nodeId });
    counter._counts = new Map(Object.entries(json.counts || {}));
    return counter;
  }
}

/**
 * PN-Counter - Positive-Negative Counter
 */
export class PNCounter {
  constructor(options = {}) {
    this._nodeId = options.nodeId || nextTick().id.split('_')[0];
    this._positive = new GCounter({ nodeId: this._nodeId });
    this._negative = new GCounter({ nodeId: this._nodeId });
  }

  /**
   * 获取净计数
   */
  get value() {
    return this._positive.value - this._negative.value;
  }

  /**
   * 增加
   */
  increment(delta = 1) {
    if (delta < 0) {
      return this.decrement(-delta);
    }
    return {
      type: 'pn-increment',
      op: this._positive.increment(delta),
    };
  }

  /**
   * 减少
   */
  decrement(delta = 1) {
    if (delta < 0) {
      return this.increment(-delta);
    }
    return {
      type: 'pn-decrement',
      op: this._negative.increment(delta),
    };
  }

  /**
   * 应用远程操作
   */
  apply(op) {
    if (op.type === 'pn-increment') {
      return this._positive.apply(op.op);
    }
    if (op.type === 'pn-decrement') {
      return this._negative.apply(op.op);
    }
    return false;
  }

  /**
   * 合并另一个 PNCounter
   */
  merge(other) {
    if (!(other instanceof PNCounter)) return false;

    const p = this._positive.merge(other._positive);
    const n = this._negative.merge(other._negative);
    return p || n;
  }

  /**
   * 序列化
   */
  toJSON() {
    return {
      type: 'PNCounter',
      nodeId: this._nodeId,
      positive: this._positive.toJSON(),
      negative: this._negative.toJSON(),
    };
  }

  /**
   * 反序列化
   */
  static fromJSON(json) {
    if (json?.type !== 'PNCounter') {
      throw new Error('Invalid PNCounter JSON');
    }
    const counter = new PNCounter({ nodeId: json.nodeId });
    counter._positive = GCounter.fromJSON(json.positive);
    counter._negative = GCounter.fromJSON(json.negative);
    return counter;
  }
}

export default { GCounter, PNCounter };
