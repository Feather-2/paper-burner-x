/**
 * LWW Register - Last-Writer-Wins 寄存器
 *
 * 最简单的 CRDT：保留时间戳最大的值
 */

import { nextTick, compare } from '../lamport-clock.js';

/** @typedef {import("../types.d.ts").LamportClockState} LamportClockState */
/** @typedef {{ nodeId?: string, clock?: LamportClockState }} LWWRegisterOptions */
/**
 * @template T
 * @typedef {{ type: 'set', value: T, clock: LamportClockState, nodeId: string }} LWWRegisterSetOp
 */
/**
 * @template T
 * @typedef {LWWRegisterSetOp<T> | { type: string, [key: string]: unknown }} LWWRegisterOp
 */
/**
 * @template T
 * @typedef {{ type: 'LWWRegister', value: T, clock: LamportClockState, nodeId: string }} LWWRegisterJSON
 */

/**
 * Last-Writer-Wins Register (LWW-Register)
 *
 * 基于 Lamport Clock 的 LWW 规则：
 * - clock.seq 更大的写入胜出
 * - clock 相同则 nodeId 字典序更大的写入胜出（保证确定性）
 *
 * @template T
 */
export class LWWRegister {
  /**
   * @param {T} [initialValue=null]
   * @param {LWWRegisterOptions} [options={}]
   */
  constructor(initialValue = null, options = {}) {
    /** @type {T} */
    this._value = initialValue;
    /** @type {LamportClockState} */
    this._clock = options.clock || nextTick();
    /** @type {string} */
    this._nodeId = options.nodeId || this._clock.id.split('_')[0];
  }

  /**
   * 获取当前值
   * @returns {T}
   */
  get value() {
    return this._value;
  }

  /**
   * 获取时钟
   * @returns {LamportClockState}
   */
  get clock() {
    return this._clock;
  }

  /**
   * 设置值（生成新操作）
   * @param {T} value
   * @returns {LWWRegisterSetOp<T>}
   */
  set(value) {
    this._clock = nextTick();
    this._value = value;
    return {
      type: 'set',
      value,
      clock: this._clock,
      nodeId: this._nodeId,
    };
  }

  /**
   * 应用远程操作
   * @param {LWWRegisterOp<T>} op
   * @returns {boolean}
   */
  apply(op) {
    if (op.type !== 'set') return false;

    const setOp = /** @type {LWWRegisterSetOp<T>} */ (op);

    // LWW：比较时钟，大的胜出
    const cmp = compare(setOp.clock, this._clock);
    if (cmp > 0) {
      this._value = setOp.value;
      this._clock = setOp.clock;
      return true;
    }

    // 时钟相等时，比较 nodeId（字典序）保证确定性
    if (cmp === 0 && setOp.nodeId > this._nodeId) {
      this._value = setOp.value;
      this._clock = setOp.clock;
      return true;
    }

    return false;
  }

  /**
   * 合并另一个 Register
   * @param {LWWRegister<T>} other
   * @returns {boolean}
   */
  merge(other) {
    if (!(other instanceof LWWRegister)) return false;

    const cmp = compare(other._clock, this._clock);
    if (cmp > 0 || (cmp === 0 && other._nodeId > this._nodeId)) {
      this._value = other._value;
      this._clock = other._clock;
      return true;
    }
    return false;
  }

  /**
   * 序列化
   * @returns {LWWRegisterJSON<T>}
   */
  toJSON() {
    return {
      type: 'LWWRegister',
      value: this._value,
      clock: this._clock,
      nodeId: this._nodeId,
    };
  }

  /**
   * 反序列化
   * @template U
   * @param {LWWRegisterJSON<U>} json
   * @returns {LWWRegister<U>}
   */
  static fromJSON(json) {
    if (json?.type !== 'LWWRegister') {
      throw new Error('Invalid LWWRegister JSON');
    }
    const reg = new LWWRegister(json.value);
    reg._clock = json.clock;
    reg._nodeId = json.nodeId;
    return reg;
  }
}

export default LWWRegister;
