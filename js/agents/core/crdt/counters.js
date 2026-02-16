/**
 * G-Counter & PN-Counter
 *
 * G-Counter: 只增计数器（每个节点维护自己的计数）
 * PN-Counter: 正负计数器（两个 G-Counter 相减）
 */

import { nextTick } from '../lamport-clock.js';
import { cryptoRandomHex } from '../../shared/index.js';

/** @typedef {import("../types.d.ts").LamportClockState} LamportClockState */
/** @typedef {{ nextTick: () => LamportClockState }} ClockServiceLike */
/** @typedef {{ nodeId?: string, clockService?: ClockServiceLike }} CounterOptions */
/** @typedef {{ type: 'increment', nodeId: string, value: number, clock: LamportClockState }} GCounterIncrementOp */
/** @typedef {GCounterIncrementOp | { type: string, [key: string]: unknown }} GCounterOp */
/** @typedef {{ type: 'GCounter', nodeId: string, counts: Record<string, number> }} GCounterJSON */
/** @typedef {{ type: 'pn-increment', op: GCounterIncrementOp }} PNCounterIncrementOp */
/** @typedef {{ type: 'pn-decrement', op: GCounterIncrementOp }} PNCounterDecrementOp */
/** @typedef {PNCounterIncrementOp | PNCounterDecrementOp | { type: string, [key: string]: unknown }} PNCounterOp */
/** @typedef {{ type: 'PNCounter', nodeId: string, positive: GCounterJSON, negative: GCounterJSON }} PNCounterJSON */

/**
 * G-Counter - Grow-only Counter
 */
export class GCounter {
  /**
   * @param {CounterOptions} [options={}]
   */
  constructor(options = {}) {
    /** @type {ClockServiceLike | null} */
    this._clockService = options.clockService || null;
    /** @type {string} */
    if (options.nodeId) {
      this._nodeId = options.nodeId;
    } else {
      try { this._nodeId = cryptoRandomHex(8); } catch (_) { this._nodeId = Math.random().toString(36).slice(2, 10); }
      if (typeof console !== 'undefined' && console.warn) console.warn('GCounter: nodeId not provided, generated fallback:', this._nodeId);
    }
    /** @type {Map<string, number>} */
    this._counts = new Map(); // nodeId → count
    this._counts.set(this._nodeId, 0);
  }

  /**
   * 获取下一个时钟值（优先使用注入的 clockService）
   * @returns {LamportClockState}
   */
  _nextTick() {
    const tick = this._clockService ? this._clockService.nextTick() : nextTick();
    if (!tick || typeof tick.id !== 'string' || typeof tick.seq !== 'number') {
      return nextTick();
    }
    return tick;
  }

  /**
   * 获取总计数
   * @returns {number}
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
   * @param {number} [delta=1]
   * @returns {GCounterIncrementOp}
   */
  increment(delta = 1) {
    if (delta < 0) throw new Error('GCounter can only increment');

    const current = this._counts.get(this._nodeId) || 0;
    this._counts.set(this._nodeId, current + delta);

    return {
      type: 'increment',
      nodeId: this._nodeId,
      value: this._counts.get(this._nodeId),
      clock: this._nextTick(),
    };
  }

  /**
   * 应用远程操作
   * @param {GCounterOp} op
   * @returns {boolean}
   */
  apply(op) {
    if (op.type !== 'increment') return false;

    const incOp = /** @type {GCounterIncrementOp} */ (op);
    const current = this._counts.get(incOp.nodeId) || 0;
    if (incOp.value > current) {
      this._counts.set(incOp.nodeId, incOp.value);
      return true;
    }
    return false;
  }

  /**
   * 合并另一个 GCounter
   * @param {GCounter} other
   * @returns {boolean}
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
   * @returns {GCounterJSON}
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
   * @param {GCounterJSON} json
   * @returns {GCounter}
   */
  static fromJSON(json) {
    if (json?.type !== 'GCounter') {
      throw new Error('Invalid GCounter JSON');
    }
    const counter = new GCounter({ nodeId: json.nodeId });
    counter._counts = new Map(Object.entries(json.counts || {}).map(([nodeId, count]) => [nodeId, Number(count)]));
    return counter;
  }
}

/**
 * PN-Counter - Positive-Negative Counter
 */
export class PNCounter {
  /**
   * @param {CounterOptions} [options={}]
   */
  constructor(options = {}) {
    /** @type {ClockServiceLike | null} */
    this._clockService = options.clockService || null;
    /** @type {string} */
    if (options.nodeId) {
      this._nodeId = options.nodeId;
    } else {
      try { this._nodeId = cryptoRandomHex(8); } catch (_) { this._nodeId = Math.random().toString(36).slice(2, 10); }
      if (typeof console !== 'undefined' && console.warn) console.warn('PNCounter: nodeId not provided, generated fallback:', this._nodeId);
    }
    /** @type {GCounter} */
    this._positive = new GCounter({ nodeId: this._nodeId, clockService: this._clockService });
    /** @type {GCounter} */
    this._negative = new GCounter({ nodeId: this._nodeId, clockService: this._clockService });
  }

  /**
   * 获取下一个时钟值（优先使用注入的 clockService）
   * @returns {LamportClockState}
   */
  _nextTick() {
    const tick = this._clockService ? this._clockService.nextTick() : nextTick();
    if (!tick || typeof tick.id !== 'string' || typeof tick.seq !== 'number') {
      return nextTick();
    }
    return tick;
  }

  /**
   * 获取净计数
   * @returns {number}
   */
  get value() {
    return this._positive.value - this._negative.value;
  }

  /**
   * 增加
   * @param {number} [delta=1]
   * @returns {PNCounterIncrementOp | PNCounterDecrementOp}
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
   * @param {number} [delta=1]
   * @returns {PNCounterIncrementOp | PNCounterDecrementOp}
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
   * @param {PNCounterOp} op
   * @returns {boolean}
   */
  apply(op) {
    if (op.type === 'pn-increment') {
      const incOp = /** @type {PNCounterIncrementOp} */ (op);
      return this._positive.apply(incOp.op);
    }
    if (op.type === 'pn-decrement') {
      const decOp = /** @type {PNCounterDecrementOp} */ (op);
      return this._negative.apply(decOp.op);
    }
    return false;
  }

  /**
   * 合并另一个 PNCounter
   * @param {PNCounter} other
   * @returns {boolean}
   */
  merge(other) {
    if (!(other instanceof PNCounter)) return false;

    const p = this._positive.merge(other._positive);
    const n = this._negative.merge(other._negative);
    return p || n;
  }

  /**
   * 序列化
   * @returns {PNCounterJSON}
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
   * @param {PNCounterJSON} json
   * @returns {PNCounter}
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
