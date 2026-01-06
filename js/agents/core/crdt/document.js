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

export class CRDTDocument {
  constructor(options = {}) {
    this._nodeId = options.nodeId || nextTick().id.split('_')[0];
    this._docId = options.docId || `doc_${Date.now()}`;

    // 不同类型的 CRDT 字段
    this._registers = new Map(); // name → LWWRegister
    this._maps = new Map();      // name → LWWMap
    this._sets = new Map();      // name → ORSet
    this._counters = new Map();  // name → GCounter | PNCounter

    // 操作日志（用于同步）
    this._opLog = [];
    this._maxOpLogSize = options.maxOpLogSize || 1000;
    this._version = 0;
  }

  get nodeId() {
    return this._nodeId;
  }

  get docId() {
    return this._docId;
  }

  get version() {
    return this._version;
  }

  // ===== Register 操作 =====

  getRegister(name) {
    return this._registers.get(name)?.value;
  }

  setRegister(name, value) {
    if (!this._registers.has(name)) {
      this._registers.set(name, new LWWRegister(null, { nodeId: this._nodeId }));
    }
    const op = this._registers.get(name).set(value);
    this._recordOp({ ...op, field: name, fieldType: 'register' });
    return op;
  }

  // ===== Map 操作 =====

  getMap(name) {
    if (!this._maps.has(name)) {
      this._maps.set(name, new LWWMap({ nodeId: this._nodeId }));
    }
    return this._maps.get(name);
  }

  setMapValue(mapName, key, value) {
    const map = this.getMap(mapName);
    const op = map.set(key, value);
    this._recordOp({ ...op, field: mapName, fieldType: 'map' });
    return op;
  }

  deleteMapValue(mapName, key) {
    const map = this.getMap(mapName);
    const op = map.delete(key);
    this._recordOp({ ...op, field: mapName, fieldType: 'map' });
    return op;
  }

  // ===== Set 操作 =====

  getSet(name) {
    if (!this._sets.has(name)) {
      this._sets.set(name, new ORSet({ nodeId: this._nodeId }));
    }
    return this._sets.get(name);
  }

  addToSet(setName, element) {
    const set = this.getSet(setName);
    const op = set.add(element);
    this._recordOp({ ...op, field: setName, fieldType: 'set' });
    return op;
  }

  removeFromSet(setName, element) {
    const set = this.getSet(setName);
    const op = set.delete(element);
    if (op) {
      this._recordOp({ ...op, field: setName, fieldType: 'set' });
    }
    return op;
  }

  // ===== Counter 操作 =====

  getCounter(name, type = 'pn') {
    if (!this._counters.has(name)) {
      const Counter = type === 'g' ? GCounter : PNCounter;
      this._counters.set(name, new Counter({ nodeId: this._nodeId }));
    }
    return this._counters.get(name);
  }

  incrementCounter(name, delta = 1) {
    const counter = this.getCounter(name);
    const op = counter.increment(delta);
    this._recordOp({ ...op, field: name, fieldType: 'counter' });
    return op;
  }

  decrementCounter(name, delta = 1) {
    const counter = this.getCounter(name);
    if (counter.decrement) {
      const op = counter.decrement(delta);
      this._recordOp({ ...op, field: name, fieldType: 'counter' });
      return op;
    }
    throw new Error('GCounter cannot decrement');
  }

  // ===== 操作日志 =====

  _recordOp(op) {
    this._version++;
    this._opLog.push({
      ...op,
      version: this._version,
      docId: this._docId,
    });

    // 限制日志大小
    while (this._opLog.length > this._maxOpLogSize) {
      this._opLog.shift();
    }
  }

  /**
   * 获取自某版本以来的操作
   */
  getOps(sinceVersion = 0) {
    return this._opLog.filter(op => op.version > sinceVersion);
  }

  /**
   * 应用远程操作
   */
  applyOp(op) {
    if (!op || !op.field || !op.fieldType) return false;

    // 同步时钟
    if (op.clock?.seq) {
      syncClock(op.clock.seq);
    }

    let changed = false;

    switch (op.fieldType) {
      case 'register':
        if (!this._registers.has(op.field)) {
          this._registers.set(op.field, new LWWRegister(null, { nodeId: this._nodeId }));
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
        changed = this._counters.get(op.field).apply(op.op || op);
        break;
    }

    if (changed && op.version > this._version) {
      this._version = op.version;
    }

    return changed;
  }

  /**
   * 批量应用操作
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
   */
  merge(other) {
    if (!(other instanceof CRDTDocument)) return false;

    let changed = false;

    // 合并 registers
    for (const [name, reg] of other._registers) {
      if (!this._registers.has(name)) {
        this._registers.set(name, new LWWRegister(null, { nodeId: this._nodeId }));
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
      if (this._counters.get(name).merge(counter)) {
        changed = true;
      }
    }

    if (other._version > this._version) {
      this._version = other._version;
    }

    return changed;
  }

  /**
   * 获取文档快照
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
      doc._registers.set(k, LWWRegister.fromJSON(v));
    }

    for (const [k, v] of Object.entries(json.maps || {})) {
      doc._maps.set(k, LWWMap.fromJSON(v));
    }

    for (const [k, v] of Object.entries(json.sets || {})) {
      doc._sets.set(k, ORSet.fromJSON(v));
    }

    for (const [k, v] of Object.entries(json.counters || {})) {
      if (v.type === 'GCounter') {
        doc._counters.set(k, GCounter.fromJSON(v));
      } else {
        doc._counters.set(k, PNCounter.fromJSON(v));
      }
    }

    return doc;
  }
}

export default CRDTDocument;
