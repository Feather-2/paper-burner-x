/**
 * LWW Register - Last-Writer-Wins 寄存器
 *
 * 最简单的 CRDT：保留时间戳最大的值
 */

import { nextTick, compare } from '../lamport-clock.js';

export class LWWRegister {
  constructor(initialValue = null, options = {}) {
    this._value = initialValue;
    this._clock = options.clock || nextTick();
    this._nodeId = options.nodeId || this._clock.id.split('_')[0];
  }

  /**
   * 获取当前值
   */
  get value() {
    return this._value;
  }

  /**
   * 获取时钟
   */
  get clock() {
    return this._clock;
  }

  /**
   * 设置值（生成新操作）
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
   */
  apply(op) {
    if (op.type !== 'set') return false;

    // LWW：比较时钟，大的胜出
    const cmp = compare(op.clock, this._clock);
    if (cmp > 0) {
      this._value = op.value;
      this._clock = op.clock;
      return true;
    }

    // 时钟相等时，比较 nodeId（字典序）保证确定性
    if (cmp === 0 && op.nodeId > this._nodeId) {
      this._value = op.value;
      this._clock = op.clock;
      return true;
    }

    return false;
  }

  /**
   * 合并另一个 Register
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
