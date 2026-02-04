/**
 * CRDT Document - 组合多个 CRDT 类型的文档
 *
 * 适用于多 Agent 协作的复杂状态管理
 */

import { nextTick, sync as syncClock } from '../lamport-clock.js';
import { LWWRegister } from './lww-register.js';
import { LWWMap } from './lww-map.js';
import { ORSet } from './or-set.js';
import { GCounter, PNCounter } from './counters.js';

/** @typedef {import("../types.d.ts").LamportClockState} LamportClockState */
/** @typedef {{ nodeId?: string, docId?: string, maxOpLogSize?: number }} CRDTDocumentOptions */
/** @typedef {'register' | 'map' | 'set' | 'counter'} CRDTFieldType */
/** @typedef {{ type: string, [key: string]: unknown }} CounterOpLike */
/**
 * @template T
 * @typedef {{ type: 'LWWRegister', value: T, clock: LamportClockState, nodeId: string }} LWWRegisterJSON
 */
/**
 * @template V
 * @typedef {{ value: V, clock: LamportClockState, deleted: boolean, nodeId: string }} LWWMapEntry
 */
/**
 * @template V
 * @typedef {{ type: 'LWWMap', nodeId: string, entries: Record<string, LWWMapEntry<V>> }} LWWMapJSON
 */
/** @typedef {{ type: 'ORSet', nodeId: string, elements: Record<string, string[]>, tombstones: string[] }} ORSetJSON */
/** @typedef {{ type: 'GCounter', nodeId: string, counts: Record<string, number> }} GCounterJSON */
/** @typedef {{ type: 'PNCounter', nodeId: string, positive: GCounterJSON, negative: GCounterJSON }} PNCounterJSON */
/**
 * 单条操作日志记录（用于同步与幂等重放）。
 *
 * 说明：当前实现的 op 结构包含多种 CRDT 子类型的字段（例如 `key/element/op` 等），
 * 因此这里保持为宽松结构，仅固定同步所需的元数据字段。
 *
 * @typedef {{
 *   type: string,
 *   field: string,
 *   fieldType: CRDTFieldType,
 *   version: number,
 *   docId: string,
 *   clock?: LamportClockState,
 *   op?: { clock?: LamportClockState, [key: string]: unknown },
 *   nodeId?: string,
 *   [key: string]: unknown
 * }} CRDTDocumentOp
 */
/**
 * 文档快照（便于 UI/存储使用）。
 *
 * @typedef {{
 *   docId: string,
 *   nodeId: string,
 *   version: number,
 *   registers: Record<string, unknown>,
 *   maps: Record<string, Record<string, unknown>>,
 *   sets: Record<string, unknown[]>,
 *   counters: Record<string, number>
 * }} CRDTDocumentSnapshot
 */
/** @typedef {{ type: 'CRDTDocument', docId: string, nodeId: string, version: number, registers: Record<string, unknown>, maps: Record<string, unknown>, sets: Record<string, unknown>, counters: Record<string, unknown> }} CRDTDocumentJSON */

/**
 * CRDT Document - 组合多个 CRDT 类型的文档
 *
 * - 以 field 为单位管理多种 CRDT primitive
 * - 记录操作日志以支持多副本同步
 */
export class CRDTDocument {
  /**
   * @param {CRDTDocumentOptions} [options={}]
   */
  constructor(options = {}) {
    /** @type {string} */
    this._nodeId = options.nodeId || nextTick().id.split('_')[0];
    /** @type {string} */
    this._docId = options.docId || `doc_${Date.now()}`;

    // 不同类型的 CRDT 字段
    /** @type {Map<string, LWWRegister<unknown>>} */
    this._registers = new Map(); // name → LWWRegister
    /** @type {Map<string, LWWMap<unknown>>} */
    this._maps = new Map();      // name → LWWMap
    /** @type {Map<string, ORSet<unknown>>} */
    this._sets = new Map();      // name → ORSet
    /** @type {Map<string, GCounter | PNCounter>} */
    this._counters = new Map();  // name → GCounter | PNCounter

    // 操作日志（用于同步）
    /** @type {CRDTDocumentOp[]} */
    this._opLog = [];
    /** @type {number} */
    this._maxOpLogSize = options.maxOpLogSize || 1000;
    /** @type {number} */
    this._version = 0;
  }

  /**
   * @returns {string}
   */
  get nodeId() {
    return this._nodeId;
  }

  /**
   * @returns {string}
   */
  get docId() {
    return this._docId;
  }

  /**
   * @returns {number}
   */
  get version() {
    return this._version;
  }

  // ===== Register 操作 =====

  /**
   * 获取寄存器当前值（若不存在则为 undefined）
   * @param {string} name
   * @returns {unknown}
   */
  getRegister(name) {
    return this._registers.get(name)?.value;
  }

  /**
   * 设置寄存器值并记录操作
   * @param {string} name
   * @param {unknown} value
   * @returns {{ type: string, clock: LamportClockState, nodeId: string, [key: string]: unknown }}
   */
  setRegister(name, value) {
    if (!this._registers.has(name)) {
      this._registers.set(name, new LWWRegister(null, { nodeId: this._nodeId }));
    }
    const op = this._registers.get(name).set(value);
    this._recordOp({ ...op, field: name, fieldType: 'register' });
    return op;
  }

  // ===== Map 操作 =====

  /**
   * 获取（或创建）指定名称的 LWWMap
   * @param {string} name
   * @returns {LWWMap<unknown>}
   */
  getMap(name) {
    if (!this._maps.has(name)) {
      this._maps.set(name, new LWWMap({ nodeId: this._nodeId }));
    }
    return this._maps.get(name);
  }

  /**
   * 设置 map 的键值并记录操作
   * @param {string} mapName
   * @param {string} key
   * @param {unknown} value
   * @returns {{ type: string, key: string, clock: LamportClockState, nodeId: string, [key: string]: unknown }}
   */
  setMapValue(mapName, key, value) {
    const map = this.getMap(mapName);
    const op = map.set(key, value);
    this._recordOp({ ...op, field: mapName, fieldType: 'map' });
    return op;
  }

  /**
   * 删除 map 的键并记录操作
   * @param {string} mapName
   * @param {string} key
   * @returns {{ type: string, key: string, clock: LamportClockState, nodeId: string, [key: string]: unknown }}
   */
  deleteMapValue(mapName, key) {
    const map = this.getMap(mapName);
    const op = map.delete(key);
    this._recordOp({ ...op, field: mapName, fieldType: 'map' });
    return op;
  }

  // ===== Set 操作 =====

  /**
   * 获取（或创建）指定名称的 ORSet
   * @param {string} name
   * @returns {ORSet<unknown>}
   */
  getSet(name) {
    if (!this._sets.has(name)) {
      this._sets.set(name, new ORSet({ nodeId: this._nodeId }));
    }
    return this._sets.get(name);
  }

  /**
   * 向 set 添加元素并记录操作
   * @param {string} setName
   * @param {unknown} element
   * @returns {{ type: string, clock: LamportClockState, nodeId: string, [key: string]: unknown }}
   */
  addToSet(setName, element) {
    const set = this.getSet(setName);
    const op = set.add(element);
    this._recordOp({ ...op, field: setName, fieldType: 'set' });
    return op;
  }

  /**
   * 从 set 移除元素（若本地未观察到该元素则返回 null）
   * @param {string} setName
   * @param {unknown} element
   * @returns {{ type: string, clock: LamportClockState, nodeId: string, [key: string]: unknown } | null}
   */
  removeFromSet(setName, element) {
    const set = this.getSet(setName);
    const op = set.delete(element);
    if (op) {
      this._recordOp({ ...op, field: setName, fieldType: 'set' });
    }
    return op;
  }

  // ===== Counter 操作 =====

  /**
   * 获取（或创建）计数器
   * @param {string} name
   * @param {'pn' | 'g'} [type='pn']
   * @returns {GCounter | PNCounter}
   */
  getCounter(name, type = 'pn') {
    if (!this._counters.has(name)) {
      const Counter = type === 'g' ? GCounter : PNCounter;
      this._counters.set(name, new Counter({ nodeId: this._nodeId }));
    }
    return this._counters.get(name);
  }

  /**
   * 增加计数器并记录操作
   * @param {string} name
   * @param {number} [delta=1]
   * @returns {Record<string, unknown>}
   */
  incrementCounter(name, delta = 1) {
    const counter = this.getCounter(name);
    const op = counter.increment(delta);
    this._recordOp({ ...op, field: name, fieldType: 'counter' });
    return op;
  }

  /**
   * 减少计数器并记录操作（仅 PNCounter 支持）
   * @param {string} name
   * @param {number} [delta=1]
   * @returns {Record<string, unknown>}
   */
  decrementCounter(name, delta = 1) {
    const counter = this.getCounter(name);
    if (!(counter instanceof PNCounter)) {
      throw new Error('GCounter cannot decrement');
    }
    const op = counter.decrement(delta);
    this._recordOp({ ...op, field: name, fieldType: 'counter' });
    return op;
  }

  // ===== 操作日志 =====

  /**
   * 记录单条操作（写入本地 op log，并递增版本）
   * @param {Record<string, unknown>} op
   * @returns {void}
   */
  _recordOp(op) {
    this._version++;
    this._opLog.push(/** @type {CRDTDocumentOp} */ ({
      ...op,
      version: this._version,
      docId: this._docId,
    }));

    // 限制日志大小
    while (this._opLog.length > this._maxOpLogSize) {
      this._opLog.shift();
    }
  }

  /**
   * 获取自某版本以来的操作
   * @param {number} [sinceVersion=0]
   * @returns {CRDTDocumentOp[]}
   */
  getOps(sinceVersion = 0) {
    return this._opLog.filter(op => op.version > sinceVersion);
  }

  /**
   * 应用远程操作
   * @param {CRDTDocumentOp} op
   * @returns {boolean}
   */
  applyOp(op) {
    if (!op || !op.field || !op.fieldType) return false;

    // 同步时钟
    const remoteSeq = op.clock?.seq ?? op.op?.clock?.seq;
    if (typeof remoteSeq === 'number' && Number.isFinite(remoteSeq)) {
      syncClock(remoteSeq);
    }

    let changed = false;

    switch (op.fieldType) {
      case 'register':
        if (!this._registers.has(op.field)) {
          this._registers.set(
            op.field,
            new LWWRegister(null, { nodeId: this._nodeId, clock: { seq: 0, ts: 0, id: `${this._nodeId}_0` } })
          );
        }
        changed = this._registers.get(op.field).apply(op);
        break;

      case 'map':
        if (!this._maps.has(op.field)) {
          this._maps.set(op.field, new LWWMap({ nodeId: this._nodeId }));
        }
        changed = this._maps.get(op.field).apply(op);
        break;

      case 'set':
        if (!this._sets.has(op.field)) {
          this._sets.set(op.field, new ORSet({ nodeId: this._nodeId }));
        }
        changed = this._sets.get(op.field).apply(op);
        break;

      case 'counter':
        if (!this._counters.has(op.field)) {
          const type = op.type?.startsWith('pn') ? 'pn' : 'g';
          this._counters.set(op.field,
            type === 'g' ? new GCounter({ nodeId: this._nodeId }) : new PNCounter({ nodeId: this._nodeId })
          );
        }
        {
          const counter = this._counters.get(op.field);
          const isPNOp = op.type?.startsWith('pn') || op.type === 'decrement';
          const isPNCounter = counter instanceof PNCounter;
          // 类型不一致：GCounter 收到 decrement，拒绝
          if (isPNOp && !isPNCounter) {
            // GCounter 无法处理 PNCounter 操作，跳过
            return false;
          }
          if (counter instanceof PNCounter) {
            changed = counter.apply(/** @type {CounterOpLike} */ (op));
          } else {
            const opForCounter = typeof op.op?.type === 'string' ? op.op : op;
            changed = counter.apply(/** @type {CounterOpLike} */ (opForCounter));
          }
        }
        break;
    }

    if (changed && op.version > this._version) {
      this._version = op.version;
    }

    return changed;
  }

  /**
   * 批量应用操作
   * @param {CRDTDocumentOp[]} ops
   * @returns {number}
   */
  applyOps(ops) {
    let applied = 0;
    for (const op of ops) {
      if (this.applyOp(op)) {
        applied++;
      }
    }
    return applied;
  }

  /**
   * 合并另一个文档
   * @param {CRDTDocument} other
   * @returns {boolean}
   */
  merge(other) {
    if (!(other instanceof CRDTDocument)) return false;

    let changed = false;

    // 合并 registers
    for (const [name, reg] of other._registers) {
      if (!this._registers.has(name)) {
        this._registers.set(
          name,
          new LWWRegister(null, { nodeId: this._nodeId, clock: { seq: 0, ts: 0, id: `${this._nodeId}_0` } })
        );
      }
      if (this._registers.get(name).merge(reg)) {
        changed = true;
      }
    }

    // 合并 maps
    for (const [name, map] of other._maps) {
      if (!this._maps.has(name)) {
        this._maps.set(name, new LWWMap({ nodeId: this._nodeId }));
      }
      if (this._maps.get(name).merge(map)) {
        changed = true;
      }
    }

    // 合并 sets
    for (const [name, set] of other._sets) {
      if (!this._sets.has(name)) {
        this._sets.set(name, new ORSet({ nodeId: this._nodeId }));
      }
      if (this._sets.get(name).merge(set)) {
        changed = true;
      }
    }

    // 合并 counters
    for (const [name, counter] of other._counters) {
      if (!this._counters.has(name)) {
        this._counters.set(name,
          counter instanceof GCounter
            ? new GCounter({ nodeId: this._nodeId })
            : new PNCounter({ nodeId: this._nodeId })
        );
      }
      const localCounter = this._counters.get(name);
      if (counter instanceof GCounter) {
        if ((/** @type {GCounter} */ (localCounter)).merge(counter)) changed = true;
      } else {
        if ((/** @type {PNCounter} */ (localCounter)).merge(counter)) changed = true;
      }
    }

    if (other._version > this._version) {
      this._version = other._version;
    }

    return changed;
  }

  /**
   * 获取文档快照
   * @returns {CRDTDocumentSnapshot}
   */
  snapshot() {
    return {
      docId: this._docId,
      nodeId: this._nodeId,
      version: this._version,
      registers: Object.fromEntries(
        Array.from(this._registers).map(([k, v]) => [k, v.value])
      ),
      maps: Object.fromEntries(
        Array.from(this._maps).map(([k, v]) => [k, v.toObject()])
      ),
      sets: Object.fromEntries(
        Array.from(this._sets).map(([k, v]) => [k, v.values()])
      ),
      counters: Object.fromEntries(
        Array.from(this._counters).map(([k, v]) => [k, v.value])
      ),
    };
  }

  /**
   * 序列化
   * @returns {CRDTDocumentJSON}
   */
  toJSON() {
    return {
      type: 'CRDTDocument',
      docId: this._docId,
      nodeId: this._nodeId,
      version: this._version,
      registers: Object.fromEntries(
        Array.from(this._registers).map(([k, v]) => [k, v.toJSON()])
      ),
      maps: Object.fromEntries(
        Array.from(this._maps).map(([k, v]) => [k, v.toJSON()])
      ),
      sets: Object.fromEntries(
        Array.from(this._sets).map(([k, v]) => [k, v.toJSON()])
      ),
      counters: Object.fromEntries(
        Array.from(this._counters).map(([k, v]) => [k, v.toJSON()])
      ),
    };
  }

  /**
   * 反序列化
   * @param {CRDTDocumentJSON} json
   * @returns {CRDTDocument}
   */
  static fromJSON(json) {
    if (json?.type !== 'CRDTDocument') {
      throw new Error('Invalid CRDTDocument JSON');
    }

    const doc = new CRDTDocument({
      docId: json.docId,
      nodeId: json.nodeId,
    });
    doc._version = json.version || 0;

    for (const [k, v] of Object.entries(json.registers || {})) {
      doc._registers.set(k, LWWRegister.fromJSON(/** @type {LWWRegisterJSON<unknown>} */ (v)));
    }

    for (const [k, v] of Object.entries(json.maps || {})) {
      doc._maps.set(k, LWWMap.fromJSON(/** @type {LWWMapJSON<unknown>} */ (v)));
    }

    for (const [k, v] of Object.entries(json.sets || {})) {
      doc._sets.set(k, ORSet.fromJSON(/** @type {ORSetJSON} */ (v)));
    }

    for (const [k, v] of Object.entries(json.counters || {})) {
      const counterJson = /** @type {GCounterJSON | PNCounterJSON} */ (v);
      if (counterJson.type === 'GCounter') {
        doc._counters.set(k, GCounter.fromJSON(counterJson));
      } else {
        doc._counters.set(k, PNCounter.fromJSON(counterJson));
      }
    }

    return doc;
  }
}

export default CRDTDocument;
