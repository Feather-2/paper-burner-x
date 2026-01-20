// Unit tests for CRDTDocument covering boundaries, ops sync/merge, and JSON round-trips.
// Mocks isolate document behavior while exercising apply/merge paths and resource limits.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/core/lamport-clock.js', () => {
  let seq = 0;
  const nextTick = vi.fn(() => {
    seq += 1;
    return { seq, ts: seq * 10, id: `node${seq}_tick` };
  });
  const sync = vi.fn((remoteSeq) => {
    if (typeof remoteSeq === 'number' && Number.isFinite(remoteSeq) && remoteSeq > seq) {
      seq = remoteSeq;
    }
  });
  const compare = vi.fn((a, b) => {
    const seqA = a?.seq ?? 0;
    const seqB = b?.seq ?? 0;
    if (seqA < seqB) return -1;
    if (seqA > seqB) return 1;
    return 0;
  });
  const __reset = () => {
    seq = 0;
  };
  return { nextTick, sync, compare, __reset };
});

vi.mock('../../../../../js/agents/core/crdt/lww-register.js', async () => {
  const { nextTick, compare } = await import('../../../../../js/agents/core/lamport-clock.js');

  class LWWRegister {
    constructor(initialValue = null, options = {}) {
      this._value = initialValue;
      this._clock = options.clock || nextTick();
      this._nodeId = options.nodeId || this._clock.id.split('_')[0];
    }

    get value() {
      return this._value;
    }

    get clock() {
      return this._clock;
    }

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

    apply(op) {
      if (op.type !== 'set') return false;
      const cmp = compare(op.clock, this._clock);
      if (cmp > 0 || (cmp === 0 && op.nodeId > this._nodeId)) {
        this._value = op.value;
        this._clock = op.clock;
        return true;
      }
      return false;
    }

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

    toJSON() {
      return {
        type: 'LWWRegister',
        value: this._value,
        clock: this._clock,
        nodeId: this._nodeId,
      };
    }

    static fromJSON(json) {
      if (json?.type !== 'LWWRegister') {
        throw new Error('Invalid LWWRegister JSON');
      }
      const reg = new LWWRegister(json.value, { clock: json.clock, nodeId: json.nodeId });
      return reg;
    }
  }

  return { LWWRegister, default: LWWRegister };
});

vi.mock('../../../../../js/agents/core/crdt/lww-map.js', async () => {
  const { nextTick, compare } = await import('../../../../../js/agents/core/lamport-clock.js');

  class LWWMap {
    constructor(options = {}) {
      this._nodeId = options.nodeId || nextTick().id.split('_')[0];
      this._entries = new Map();
    }

    keys() {
      const result = [];
      for (const [key, entry] of this._entries) {
        if (!entry.deleted) result.push(key);
      }
      return result;
    }

    values() {
      const result = [];
      for (const entry of this._entries.values()) {
        if (!entry.deleted) result.push(entry.value);
      }
      return result;
    }

    entries() {
      const result = [];
      for (const [key, entry] of this._entries) {
        if (!entry.deleted) result.push([key, entry.value]);
      }
      return result;
    }

    toObject() {
      const result = {};
      for (const [key, entry] of this._entries) {
        if (!entry.deleted) result[key] = entry.value;
      }
      return result;
    }

    get(key) {
      const entry = this._entries.get(key);
      if (!entry || entry.deleted) return undefined;
      return entry.value;
    }

    has(key) {
      const entry = this._entries.get(key);
      return !!entry && !entry.deleted;
    }

    get size() {
      let count = 0;
      for (const entry of this._entries.values()) {
        if (!entry.deleted) count += 1;
      }
      return count;
    }

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

    apply(op) {
      if (op.type !== 'map-set' && op.type !== 'map-delete') return false;
      const existing = this._entries.get(op.key);
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

  return { LWWMap, default: LWWMap };
});

vi.mock('../../../../../js/agents/core/crdt/or-set.js', async () => {
  const { nextTick } = await import('../../../../../js/agents/core/lamport-clock.js');

  class ORSet {
    constructor(options = {}) {
      this._nodeId = options.nodeId || nextTick().id.split('_')[0];
      this._elements = new Map();
      this._tombstones = new Set();
      this._tagToElement = new Map();
    }

    _makeTag() {
      const clock = nextTick();
      return `${this._nodeId}_${clock.seq}_${clock.ts}`;
    }

    values() {
      const result = [];
      for (const [element, tags] of this._elements) {
        for (const tag of tags) {
          if (!this._tombstones.has(tag)) {
            result.push(element);
            break;
          }
        }
      }
      return result;
    }

    get size() {
      return this.values().length;
    }

    has(element) {
      const tags = this._elements.get(element);
      if (!tags) return false;
      for (const tag of tags) {
        if (!this._tombstones.has(tag)) return true;
      }
      return false;
    }

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

    apply(op) {
      if (op.type === 'set-add') {
        if (!this._elements.has(op.element)) {
          this._elements.set(op.element, new Set());
        }
        const tags = this._elements.get(op.element);
        const hadTag = tags.has(op.tag);
        tags.add(op.tag);
        const prevElement = this._tagToElement.get(op.tag);
        this._tagToElement.set(op.tag, op.element);
        return !hadTag || prevElement !== op.element;
      }
      if (op.type === 'set-remove') {
        let changed = false;
        for (const tag of op.tags) {
          if (!this._tombstones.has(tag)) {
            this._tombstones.add(tag);
            changed = true;
          }
        }
        return changed;
      }
      return false;
    }

    merge(other) {
      if (!(other instanceof ORSet)) return false;
      let changed = false;
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
      for (const tag of other._tombstones) {
        if (!this._tombstones.has(tag)) {
          this._tombstones.add(tag);
          changed = true;
        }
      }
      return changed;
    }

    toJSON() {
      const elements = {};
      for (const [element, tags] of this._elements) {
        elements[String(element)] = Array.from(tags);
      }
      return {
        type: 'ORSet',
        nodeId: this._nodeId,
        elements,
        tombstones: Array.from(this._tombstones),
      };
    }

    static fromJSON(json) {
      if (json?.type !== 'ORSet') {
        throw new Error('Invalid ORSet JSON');
      }
      const set = new ORSet({ nodeId: json.nodeId });
      for (const [element, tags] of Object.entries(json.elements || {})) {
        const tagList = tags;
        set._elements.set(element, new Set(tagList));
        for (const tag of tagList) {
          set._tagToElement.set(tag, element);
        }
      }
      set._tombstones = new Set(json.tombstones || []);
      return set;
    }
  }

  return { ORSet, default: ORSet };
});

vi.mock('../../../../../js/agents/core/crdt/counters.js', async () => {
  const { nextTick } = await import('../../../../../js/agents/core/lamport-clock.js');

  class GCounter {
    constructor(options = {}) {
      this._nodeId = options.nodeId || nextTick().id.split('_')[0];
      this._counts = new Map();
      this._counts.set(this._nodeId, 0);
    }

    get value() {
      let sum = 0;
      for (const count of this._counts.values()) {
        sum += count;
      }
      return sum;
    }

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

    apply(op) {
      if (op.type !== 'increment') return false;
      const current = this._counts.get(op.nodeId) || 0;
      if (op.value > current) {
        this._counts.set(op.nodeId, op.value);
        return true;
      }
      return false;
    }

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

    toJSON() {
      return {
        type: 'GCounter',
        nodeId: this._nodeId,
        counts: Object.fromEntries(this._counts),
      };
    }

    static fromJSON(json) {
      if (json?.type !== 'GCounter') {
        throw new Error('Invalid GCounter JSON');
      }
      const counter = new GCounter({ nodeId: json.nodeId });
      counter._counts = new Map(
        Object.entries(json.counts || {}).map(([nodeId, count]) => [nodeId, Number(count)])
      );
      return counter;
    }
  }

  class PNCounter {
    constructor(options = {}) {
      this._nodeId = options.nodeId || nextTick().id.split('_')[0];
      this._positive = new GCounter({ nodeId: this._nodeId });
      this._negative = new GCounter({ nodeId: this._nodeId });
    }

    get value() {
      return this._positive.value - this._negative.value;
    }

    increment(delta = 1) {
      if (delta < 0) {
        return this.decrement(-delta);
      }
      return {
        type: 'pn-increment',
        op: this._positive.increment(delta),
      };
    }

    decrement(delta = 1) {
      if (delta < 0) {
        return this.increment(-delta);
      }
      return {
        type: 'pn-decrement',
        op: this._negative.increment(delta),
      };
    }

    apply(op) {
      if (op.type === 'pn-increment') {
        return this._positive.apply(op.op);
      }
      if (op.type === 'pn-decrement') {
        return this._negative.apply(op.op);
      }
      return false;
    }

    merge(other) {
      if (!(other instanceof PNCounter)) return false;
      const p = this._positive.merge(other._positive);
      const n = this._negative.merge(other._negative);
      return p || n;
    }

    toJSON() {
      return {
        type: 'PNCounter',
        nodeId: this._nodeId,
        positive: this._positive.toJSON(),
        negative: this._negative.toJSON(),
      };
    }

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

  return { GCounter, PNCounter, default: { GCounter, PNCounter } };
});

const docPath = '../../../../../js/agents/core/crdt/document.js';
const clockPath = '../../../../../js/agents/core/lamport-clock.js';
const countersPath = '../../../../../js/agents/core/crdt/counters.js';

let CRDTDocument;
let CRDTDocumentDefault;
let clockModule;
let countersModule;

const lastOp = (doc) => doc.getOps(doc.version - 1)[0];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  clockModule = await import(clockPath);
  clockModule.__reset();
  ({ CRDTDocument, default: CRDTDocumentDefault } = await import(docPath));
  countersModule = await import(countersPath);
});

describe('CRDTDocument', () => {
  it('initializes defaults and exposes getters', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);
    const doc = new CRDTDocument();

    expect(doc.nodeId).toBe('node1');
    expect(doc.docId).toBe('doc_12345');
    expect(doc.version).toBe(0);
    expect(clockModule.nextTick).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it('sets and gets registers with boundary values and records ops', () => {
    const doc = new CRDTDocument({ nodeId: 'A', docId: 'doc' });

    expect(doc.getRegister('missing')).toBeUndefined();

    const cases = [
      { field: '', value: 'ok' },
      { field: 'null', value: null },
      { field: 'undef', value: undefined },
      { field: 'empty', value: '' },
      { field: 'space', value: '   ' },
      { field: 'zero', value: 0 },
      { field: 'neg', value: -1 },
      { field: 'max', value: Number.MAX_SAFE_INTEGER },
      { field: 'arr', value: [] },
      { field: 'obj', value: {} },
    ];

    for (const testCase of cases) {
      const op = doc.setRegister(testCase.field, testCase.value);
      expect(op.type).toBe('set');
      expect(doc.getRegister(testCase.field)).toBe(testCase.value);
    }

    const snapshot = doc.snapshot();
    expect(Object.prototype.hasOwnProperty.call(snapshot.registers, 'undef')).toBe(true);
    expect(snapshot.registers.undef).toBeUndefined();
    expect(snapshot.registers.null).toBeNull();
    expect(snapshot.registers.empty).toBe('');
    expect(snapshot.registers.space).toBe('   ');
    expect(doc.version).toBe(cases.length);
    expect(doc.getOps(0).length).toBe(cases.length);

    const op = lastOp(doc);
    expect(op.field).toBe('obj');
    expect(op.fieldType).toBe('register');
    expect(op.docId).toBe('doc');
    expect(op.version).toBe(cases.length);
  });

  it('manages maps with boundary keys/values and deletions', () => {
    const doc = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
    const map = doc.getMap('meta');

    expect(map).toBe(doc.getMap('meta'));

    const arrayLike = { 0: 'x', length: 1 };

    doc.setMapValue('meta', '', {});
    doc.setMapValue('meta', '   ', []);
    doc.setMapValue('meta', 'arrayLike', arrayLike);

    expect(doc.getMap('meta').get('')).toEqual({});
    expect(doc.getMap('meta').get('   ')).toEqual([]);
    expect(doc.getMap('meta').get('arrayLike')).toBe(arrayLike);

    const deleteOp = doc.deleteMapValue('meta', '   ');
    expect(deleteOp.type).toBe('map-delete');
    expect(doc.getMap('meta').has('   ')).toBe(false);

    const sizeBefore = doc.getMap('meta').size;
    const deleteMissing = doc.deleteMapValue('meta', 'missing');
    expect(deleteMissing.type).toBe('map-delete');
    expect(doc.getMap('meta').size).toBe(sizeBefore);
  });

  it('handles set add/remove with nullish and object elements', () => {
    const doc = new CRDTDocument({ nodeId: 'A', docId: 'doc' });

    const set = doc.getSet('tags');
    expect(set).toBe(doc.getSet('tags'));

    const arrayLike = { 0: 'x', length: 1 };

    doc.addToSet('tags', null);
    doc.addToSet('tags', undefined);
    doc.addToSet('tags', '');
    doc.addToSet('tags', '   ');
    doc.addToSet('tags', 0);
    doc.addToSet('tags', -1);
    doc.addToSet('tags', arrayLike);

    const values = doc.getSet('tags').values();
    expect(values).toEqual(expect.arrayContaining([null, undefined, '', '   ', 0, -1, arrayLike]));

    const versionBefore = doc.version;
    const missingRemove = doc.removeFromSet('tags', 'missing');
    expect(missingRemove).toBeNull();
    expect(doc.version).toBe(versionBefore);

    const removeOp = doc.removeFromSet('tags', arrayLike);
    expect(removeOp.type).toBe('set-remove');
    expect(doc.getSet('tags').has(arrayLike)).toBe(false);
  });

  it('supports counter boundaries, type edges, and errors', () => {
    const doc = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
    const { PNCounter, GCounter } = countersModule;

    expect(doc.getCounter('pn')).toBeInstanceOf(PNCounter);
    expect(doc.getCounter('pn')).toBe(doc.getCounter('pn'));

    doc.incrementCounter('zero', 0);
    expect(doc.snapshot().counters.zero).toBe(0);

    doc.incrementCounter('negative', -1);
    expect(doc.snapshot().counters.negative).toBe(-1);

    doc.incrementCounter('max', Number.MAX_SAFE_INTEGER);
    expect(doc.snapshot().counters.max).toBe(Number.MAX_SAFE_INTEGER);

    doc.incrementCounter('stringy', '2');
    expect(doc.snapshot().counters.stringy).toBe(2);

    doc.decrementCounter('dec', 2);
    expect(doc.snapshot().counters.dec).toBe(-2);

    doc.decrementCounter('dec', -3);
    expect(doc.snapshot().counters.dec).toBe(1);

    doc.getCounter('g', 'g');
    expect(doc.getCounter('g')).toBeInstanceOf(GCounter);
    expect(() => doc.decrementCounter('g')).toThrow('GCounter cannot decrement');
    expect(() => doc.incrementCounter('g', -1)).toThrow('GCounter can only increment');
  });

  it('records ops and trims the log to max size', () => {
    const doc = new CRDTDocument({ nodeId: 'A', docId: 'doc', maxOpLogSize: 2 });

    doc.setRegister('a', 1);
    doc.setRegister('b', 2);
    doc.addToSet('s', 'x');

    expect(doc.version).toBe(3);

    const ops = doc.getOps(0);
    expect(ops.length).toBe(2);
    expect(ops[0].version).toBe(2);
    expect(ops[1].version).toBe(3);
    expect(doc.getOps(2).length).toBe(1);
  });

  it('handles rapid consecutive and concurrent updates', async () => {
    const doc = new CRDTDocument({ nodeId: 'A', docId: 'doc' });

    for (let i = 0; i < 5; i += 1) {
      doc.incrementCounter('fast', 1);
    }

    const ops = await Promise.all([
      Promise.resolve(doc.setRegister('r1', 1)),
      Promise.resolve(doc.setRegister('r2', 2)),
      Promise.resolve(doc.setRegister('r3', 3)),
    ]);

    expect(doc.snapshot().counters.fast).toBe(5);
    expect(doc.getRegister('r1')).toBe(1);
    expect(doc.getRegister('r2')).toBe(2);
    expect(doc.getRegister('r3')).toBe(3);
    expect(ops.map((op) => op.type)).toEqual(['set', 'set', 'set']);
    expect(doc.version).toBe(8);
  });

  it('applies register/map/set ops and syncs clock', () => {
    const docA = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
    const docB = new CRDTDocument({ nodeId: 'B', docId: 'doc' });

    docA.setRegister('title', 'hello');
    const regOp = lastOp(docA);
    regOp.clock = { seq: 10, ts: 0, id: 'A_10' };

    expect(docB.applyOp(regOp)).toBe(true);
    expect(docB.getRegister('title')).toBe('hello');
    expect(clockModule.sync).toHaveBeenCalledWith(10);
    expect(docB.version).toBe(regOp.version);

    docA.setMapValue('meta', 'k', 'v');
    const mapOp = lastOp(docA);
    expect(docB.applyOp(mapOp)).toBe(true);
    expect(docB.getMap('meta').get('k')).toBe('v');

    docA.addToSet('tags', 'x');
    const setOp = lastOp(docA);
    expect(docB.applyOp(setOp)).toBe(true);
    expect(docB.getSet('tags').has('x')).toBe(true);
  });

  it('applies counter ops and rejects mismatched types', () => {
    const docA = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
    const docB = new CRDTDocument({ nodeId: 'B', docId: 'doc' });

    docA.getCounter('g', 'g');
    docA.incrementCounter('g', 2);
    const gOp = lastOp(docA);

    expect(docB.applyOp(gOp)).toBe(true);
    expect(docB.snapshot().counters.g).toBe(2);

    docA.incrementCounter('pn', 1);
    const pnOp = lastOp(docA);
    pnOp.op.clock = { seq: 22, ts: 0, id: 'A_22' };

    clockModule.sync.mockClear();
    expect(docB.applyOp(pnOp)).toBe(true);
    expect(clockModule.sync).toHaveBeenCalledWith(22);
    expect(docB.snapshot().counters.pn).toBe(1);

    docB.getCounter('mismatch', 'g');
    docA.incrementCounter('mismatch', 1);
    const mismatchOp = lastOp(docA);

    expect(docB.applyOp(mismatchOp)).toBe(false);
    expect(docB.snapshot().counters.mismatch).toBe(0);
  });

  it('handles invalid ops and unknown types safely', () => {
    const doc = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
    const versionBefore = doc.version;

    expect(doc.applyOp(null)).toBe(false);
    expect(doc.applyOp({})).toBe(false);
    expect(doc.applyOp({ field: 'x' })).toBe(false);
    expect(doc.applyOp({ field: 'x', fieldType: 'unknown', type: 'noop' })).toBe(false);
    expect(doc.version).toBe(versionBefore);
  });

  it('applies batches and counts applied ops', () => {
    const docA = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
    const docB = new CRDTDocument({ nodeId: 'B', docId: 'doc' });

    docA.setRegister('r', 'v');
    const op1 = lastOp(docA);
    docA.addToSet('s', 'x');
    const op2 = lastOp(docA);

    const applied = docB.applyOps([op1, { field: 'bad' }, op2]);
    expect(applied).toBe(2);
    expect(docB.getRegister('r')).toBe('v');
    expect(docB.getSet('s').has('x')).toBe(true);
  });

  it('merges documents and updates versions', () => {
    const docA = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
    const docB = new CRDTDocument({ nodeId: 'B', docId: 'doc' });

    docA.setRegister('title', 'from-A');
    docA.setMapValue('meta', 'k', 'vA');
    docA.addToSet('tags', 'x');
    docA.incrementCounter('cnt', 2);

    docB.setRegister('title', 'from-B');
    docB.setMapValue('meta', 'k2', 'vB');
    docB.addToSet('tags', 'y');
    docB.getCounter('g', 'g');
    docB.incrementCounter('g', 1);

    expect(docA.merge(docB)).toBe(true);

    const snapshot = docA.snapshot();
    expect(snapshot.registers.title).toBe('from-B');
    expect(snapshot.maps.meta).toMatchObject({ k: 'vA', k2: 'vB' });
    expect(snapshot.sets.tags).toEqual(expect.arrayContaining(['x', 'y']));
    expect(snapshot.counters.cnt).toBe(2);
    expect(snapshot.counters.g).toBe(1);
    expect(docA.version).toBeGreaterThanOrEqual(docB.version);
    expect(docA.merge({})).toBe(false);
  });

  it('supports snapshots, JSON round-trips, and large payloads', () => {
    const doc = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
    const largeString = 'x'.repeat(120000);
    const largeArray = new Array(10000).fill('data');
    const deepObject = { level: 0 };
    let cursor = deepObject;
    for (let i = 1; i <= 30; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    doc.setRegister('blob', { largeString, largeArray, deepObject });
    doc.setMapValue('meta', 'k', 'v');
    doc.addToSet('tags', 'x');
    doc.incrementCounter('cnt', 1);

    const snapshot = doc.snapshot();
    expect(snapshot.docId).toBe('doc');
    expect(snapshot.nodeId).toBe('A');
    expect(snapshot.registers.blob.largeString).toBe(largeString);
    expect(snapshot.registers.blob.largeArray).toBe(largeArray);
    expect(snapshot.registers.blob.deepObject).toBe(deepObject);

    const json = doc.toJSON();
    const restored = CRDTDocument.fromJSON(json);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(() => CRDTDocument.fromJSON({ type: 'nope' })).toThrow('Invalid CRDTDocument JSON');
  });
});

describe('CRDTDocument default export', () => {
  it('matches the named export', () => {
    expect(CRDTDocumentDefault).toBe(CRDTDocument);
  });
});
