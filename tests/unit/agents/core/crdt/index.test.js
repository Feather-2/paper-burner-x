import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/core/crdt/lww-register.js', () => {
  class LWWRegisterMock {
    constructor(...args) {
      if (args[0] === '__throw__') {
        throw new Error('LWWRegisterMock constructor error');
      }
      this.args = args;
    }
  }
  return { LWWRegister: LWWRegisterMock };
});

vi.mock('../../../../../js/agents/core/crdt/counters.js', () => {
  class GCounterMock {
    constructor(...args) {
      if (args[0] === '__throw__') {
        throw new Error('GCounterMock constructor error');
      }
      this.args = args;
    }
  }
  class PNCounterMock {
    constructor(...args) {
      if (args[0] === '__throw__') {
        throw new Error('PNCounterMock constructor error');
      }
      this.args = args;
    }
  }
  return { GCounter: GCounterMock, PNCounter: PNCounterMock };
});

vi.mock('../../../../../js/agents/core/crdt/lww-map.js', () => {
  class LWWMapMock {
    constructor(...args) {
      if (args[0] === '__throw__') {
        throw new Error('LWWMapMock constructor error');
      }
      this.args = args;
    }
  }
  return { LWWMap: LWWMapMock };
});

vi.mock('../../../../../js/agents/core/crdt/or-set.js', () => {
  class ORSetMock {
    constructor(...args) {
      if (args[0] === '__throw__') {
        throw new Error('ORSetMock constructor error');
      }
      this.args = args;
    }
  }
  return { ORSet: ORSetMock };
});

vi.mock('../../../../../js/agents/core/crdt/document.js', () => {
  class CRDTDocumentMock {
    constructor(...args) {
      if (args[0] === '__throw__') {
        throw new Error('CRDTDocumentMock constructor error');
      }
      this.args = args;
    }
  }
  return { CRDTDocument: CRDTDocumentMock };
});

vi.mock('../../../../../js/agents/core/crdt/sync-manager.js', () => {
  class CRDTSyncManagerMock {
    constructor(...args) {
      if (args[0] === '__throw__') {
        throw new Error('CRDTSyncManagerMock constructor error');
      }
      this.args = args;
    }
  }
  const createMemoryTransport = vi.fn((...args) => {
    if (args[0] === '__throw__') {
      throw new Error('createMemoryTransportMock error');
    }
    return { type: 'memory', args };
  });
  return { CRDTSyncManager: CRDTSyncManagerMock, createMemoryTransport };
});

let crdtIndex;
let lwwRegisterModule;
let countersModule;
let lwwMapModule;
let orSetModule;
let documentModule;
let syncManagerModule;

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();

  [
    lwwRegisterModule,
    countersModule,
    lwwMapModule,
    orSetModule,
    documentModule,
    syncManagerModule,
  ] = await Promise.all([
    import('../../../../../js/agents/core/crdt/lww-register.js'),
    import('../../../../../js/agents/core/crdt/counters.js'),
    import('../../../../../js/agents/core/crdt/lww-map.js'),
    import('../../../../../js/agents/core/crdt/or-set.js'),
    import('../../../../../js/agents/core/crdt/document.js'),
    import('../../../../../js/agents/core/crdt/sync-manager.js'),
  ]);

  crdtIndex = await import('../../../../../js/agents/core/crdt/index.js');
});

describe('OpType', () => {
  it('exposes the expected operation constants', () => {
    expect(crdtIndex.OpType).toEqual({
      SET: 'set',
      DELETE: 'delete',
      INCREMENT: 'increment',
      DECREMENT: 'decrement',
      ADD: 'add',
      REMOVE: 'remove',
    });
  });

  it('handles unknown keys without throwing (error handling)', () => {
    expect(crdtIndex.OpType.UNKNOWN).toBeUndefined();
    expect(crdtIndex.OpType['']).toBeUndefined();
    expect(crdtIndex.OpType['   ']).toBeUndefined();
    expect(crdtIndex.OpType[/** @type {any} */ (null)]).toBeUndefined();
    expect(crdtIndex.OpType[/** @type {any} */ (undefined)]).toBeUndefined();
  });

  it('exposes only non-empty string values (boundary)', () => {
    const values = Object.values(crdtIndex.OpType);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe('createOp', () => {
  it('creates an operation using the provided clock and extracts nodeId', () => {
    const clock = { seq: 7, ts: 42, id: 'nodeA_99' };
    const op = crdtIndex.createOp('set', 'title', 'hello', clock);

    expect(op.type).toBe('set');
    expect(op.key).toBe('title');
    expect(op.value).toBe('hello');
    expect(op.clock).toBe(clock);
    expect(op.nodeId).toBe('nodeA');
  });

  it('defaults clock and nodeId when no clock is provided', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123456);
    const op = crdtIndex.createOp('set', 'k', 'v');

    expect(op.clock).toEqual({ seq: 0, ts: 123456, id: '' });
    expect(op.nodeId).toBe('unknown');
    expect(nowSpy).toHaveBeenCalledTimes(1);
  });

  it('handles empty and nullish values without throwing', () => {
    const clock = { seq: 0, ts: 0, id: '' };
    const op = crdtIndex.createOp('', null, undefined, clock);

    expect(op.type).toBe('');
    expect(op.key).toBeNull();
    expect(op.value).toBeUndefined();
    expect(op.clock).toBe(clock);
    expect(op.nodeId).toBe('unknown');
  });

  it('preserves empty collections and whitespace strings', () => {
    const emptyArray = [];
    const emptyObject = {};
    const clock = { seq: 1, ts: 1, id: '   ' };
    const op = crdtIndex.createOp('   ', emptyArray, emptyObject, clock);

    expect(op.type).toBe('   ');
    expect(op.key).toBe(emptyArray);
    expect(op.value).toBe(emptyObject);
    expect(op.nodeId).toBe('   ');
  });

  it('keeps boundary numeric values intact', () => {
    const clock = { seq: 2, ts: 2, id: 'node' };
    const op = crdtIndex.createOp('increment', 0, Number.MAX_SAFE_INTEGER, clock);

    expect(op.key).toBe(0);
    expect(op.value).toBe(Number.MAX_SAFE_INTEGER);
    expect(op.nodeId).toBe('node');

    const opNegative = crdtIndex.createOp('decrement', -1, -1, clock);
    expect(opNegative.key).toBe(-1);
    expect(opNegative.value).toBe(-1);
  });

  it('accepts type boundary inputs without coercion', () => {
    const clock = { seq: 3, ts: 3, id: 'nodeB_1' };
    const arrayLike = { 0: 'x', length: 1 };
    const op = crdtIndex.createOp('add', '42', arrayLike, clock);

    expect(op.key).toBe('42');
    expect(op.value).toBe(arrayLike);
    expect(op.nodeId).toBe('nodeB');
  });

  it('preserves numeric strings when values are expected to be numbers (type boundary)', () => {
    const clock = { seq: 5, ts: 5, id: 'nodeD_1' };
    const op = crdtIndex.createOp('increment', 'count', '1', clock);

    expect(op.value).toBe('1');
    expect(op.nodeId).toBe('nodeD');
  });

  it('supports large payloads and deep nesting', () => {
    const largeString = 'x'.repeat(100000);
    const largeArray = new Array(50000).fill('data');
    const deepObject = { level: 0 };
    let cursor = deepObject;
    for (let i = 1; i <= 50; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    const value = { largeArray, deepObject };
    const clock = { seq: 4, ts: 4, id: 'nodeC_2' };
    const op = crdtIndex.createOp('set', largeString, value, clock);

    expect(op.key).toBe(largeString);
    expect(op.value).toBe(value);
    expect(op.value.largeArray).toBe(largeArray);
    expect(op.value.deepObject).toBe(deepObject);
  });

  it('accepts empty object/array clocks and keeps references (boundary)', () => {
    const emptyObjectClock = {};
    const opObjectClock = crdtIndex.createOp('set', 'k', 'v', emptyObjectClock);
    expect(opObjectClock.clock).toBe(emptyObjectClock);
    expect(opObjectClock.nodeId).toBe('unknown');

    const emptyArrayClock = [];
    const opArrayClock = crdtIndex.createOp('set', 'k', 'v', emptyArrayClock);
    expect(opArrayClock.clock).toBe(emptyArrayClock);
    expect(opArrayClock.nodeId).toBe('unknown');
  });

  it('creates independent default clocks for rapid consecutive calls', () => {
    let now = 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now++);

    const ops = [
      crdtIndex.createOp('set', 'a', 1),
      crdtIndex.createOp('set', 'b', 2),
      crdtIndex.createOp('set', 'c', 3),
    ];

    expect(ops[0].clock).not.toBe(ops[1].clock);
    expect(ops[1].clock).not.toBe(ops[2].clock);
    expect(ops.map((op) => op.clock.ts)).toEqual([1000, 1001, 1002]);
    expect(nowSpy).toHaveBeenCalledTimes(3);
  });

  it('handles simultaneous calls with distinct clocks', async () => {
    const clocks = [
      { seq: 1, ts: 10, id: 'alpha_1' },
      { seq: 2, ts: 20, id: 'beta_2' },
      { seq: 3, ts: 30, id: 'gamma_3' },
    ];

    const [opA, opB, opC] = await Promise.all([
      crdtIndex.createOp('set', 'a', 1, clocks[0]),
      crdtIndex.createOp('set', 'b', 2, clocks[1]),
      crdtIndex.createOp('set', 'c', 3, clocks[2]),
    ]);

    expect(opA.clock).toBe(clocks[0]);
    expect(opB.clock).toBe(clocks[1]);
    expect(opC.clock).toBe(clocks[2]);
    expect(opA.nodeId).toBe('alpha');
    expect(opB.nodeId).toBe('beta');
    expect(opC.nodeId).toBe('gamma');
  });

  it('throws when clock id is not a string', () => {
    const badClock = { seq: 1, ts: 1, id: 123 };
    expect(() => crdtIndex.createOp('set', 'k', 'v', badClock)).toThrow(TypeError);
  });
});

describe('LWWRegister', () => {
  it('re-exports LWWRegister from the lww-register module', () => {
    expect(crdtIndex.LWWRegister).toBe(lwwRegisterModule.LWWRegister);
  });

  it('constructs with boundary inputs (boundary)', () => {
    const emptyArray = [];
    const emptyObject = {};
    const longString = 'x'.repeat(10000);
    const deepObject = { a: { b: { c: { d: { e: [] } } } } };

    const instance = new crdtIndex.LWWRegister(
      null,
      undefined,
      '',
      '   ',
      emptyArray,
      emptyObject,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      longString,
      deepObject,
    );

    expect(instance).toBeInstanceOf(crdtIndex.LWWRegister);
    expect(instance.args[0]).toBeNull();
    expect(instance.args[1]).toBeUndefined();
    expect(instance.args[2]).toBe('');
    expect(instance.args[3]).toBe('   ');
    expect(instance.args[4]).toBe(emptyArray);
    expect(instance.args[5]).toBe(emptyObject);
    expect(instance.args[6]).toBe(0);
    expect(instance.args[7]).toBe(-1);
    expect(instance.args[8]).toBe(Number.MAX_SAFE_INTEGER);
    expect(instance.args[9]).toBe(longString);
    expect(instance.args[10]).toBe(deepObject);
  });

  it('propagates constructor errors (error handling)', () => {
    expect(() => new crdtIndex.LWWRegister('__throw__')).toThrow('LWWRegisterMock constructor error');
  });
});

describe('GCounter', () => {
  it('re-exports GCounter from the counters module', () => {
    expect(crdtIndex.GCounter).toBe(countersModule.GCounter);
  });

  it('constructs with boundary inputs (boundary)', () => {
    const instance = new crdtIndex.GCounter(null, undefined, '', [], {}, 0, -1, Number.MAX_SAFE_INTEGER, '   ');
    expect(instance).toBeInstanceOf(crdtIndex.GCounter);
    expect(instance.args[0]).toBeNull();
  });

  it('propagates constructor errors (error handling)', () => {
    expect(() => new crdtIndex.GCounter('__throw__')).toThrow('GCounterMock constructor error');
  });
});

describe('PNCounter', () => {
  it('re-exports PNCounter from the counters module', () => {
    expect(crdtIndex.PNCounter).toBe(countersModule.PNCounter);
  });

  it('constructs with boundary inputs (boundary)', () => {
    const instance = new crdtIndex.PNCounter(undefined, [], {}, 'x'.repeat(10000));
    expect(instance).toBeInstanceOf(crdtIndex.PNCounter);
    expect(instance.args[0]).toBeUndefined();
  });

  it('propagates constructor errors (error handling)', () => {
    expect(() => new crdtIndex.PNCounter('__throw__')).toThrow('PNCounterMock constructor error');
  });
});

describe('LWWMap', () => {
  it('re-exports LWWMap from the lww-map module', () => {
    expect(crdtIndex.LWWMap).toBe(lwwMapModule.LWWMap);
  });

  it('constructs with boundary inputs (boundary)', () => {
    const instance = new crdtIndex.LWWMap('', '   ', [], {}, 0, -1, Number.MAX_SAFE_INTEGER);
    expect(instance).toBeInstanceOf(crdtIndex.LWWMap);
    expect(instance.args[0]).toBe('');
  });

  it('propagates constructor errors (error handling)', () => {
    expect(() => new crdtIndex.LWWMap('__throw__')).toThrow('LWWMapMock constructor error');
  });
});

describe('ORSet', () => {
  it('re-exports ORSet from the or-set module', () => {
    expect(crdtIndex.ORSet).toBe(orSetModule.ORSet);
  });

  it('constructs with boundary inputs (boundary)', () => {
    const deep = { a: { b: { c: { d: { e: [] } } } } };
    const instance = new crdtIndex.ORSet(null, deep);
    expect(instance).toBeInstanceOf(crdtIndex.ORSet);
    expect(instance.args[0]).toBeNull();
    expect(instance.args[1]).toBe(deep);
  });

  it('propagates constructor errors (error handling)', () => {
    expect(() => new crdtIndex.ORSet('__throw__')).toThrow('ORSetMock constructor error');
  });
});

describe('CRDTDocument', () => {
  it('re-exports CRDTDocument from the document module', () => {
    expect(crdtIndex.CRDTDocument).toBe(documentModule.CRDTDocument);
  });

  it('constructs with boundary inputs (boundary)', () => {
    const largeString = 'x'.repeat(100000);
    const instance = new crdtIndex.CRDTDocument(largeString, [], {});
    expect(instance).toBeInstanceOf(crdtIndex.CRDTDocument);
    expect(instance.args[0]).toBe(largeString);
  });

  it('propagates constructor errors (error handling)', () => {
    expect(() => new crdtIndex.CRDTDocument('__throw__')).toThrow('CRDTDocumentMock constructor error');
  });
});

describe('CRDTSyncManager', () => {
  it('re-exports CRDTSyncManager from the sync-manager module', () => {
    expect(crdtIndex.CRDTSyncManager).toBe(syncManagerModule.CRDTSyncManager);
  });

  it('constructs with boundary inputs (boundary)', () => {
    const instance = new crdtIndex.CRDTSyncManager({ nodeId: '   ' });
    expect(instance).toBeInstanceOf(crdtIndex.CRDTSyncManager);
    expect(instance.args[0]).toEqual({ nodeId: '   ' });
  });

  it('propagates constructor errors (error handling)', () => {
    expect(() => new crdtIndex.CRDTSyncManager('__throw__')).toThrow(
      'CRDTSyncManagerMock constructor error',
    );
  });
});

describe('createMemoryTransport', () => {
  it('re-exports createMemoryTransport from the sync-manager module', () => {
    expect(crdtIndex.createMemoryTransport).toBe(syncManagerModule.createMemoryTransport);
  });

  it('passes through boundary arguments and returns transport (boundary)', () => {
    const emptyObject = {};
    const transport = crdtIndex.createMemoryTransport(null, undefined, '', [], emptyObject, '   ');

    expect(transport).toEqual({ type: 'memory', args: [null, undefined, '', [], emptyObject, '   '] });
    expect(syncManagerModule.createMemoryTransport).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from the underlying transport factory (error handling)', () => {
    expect(() => crdtIndex.createMemoryTransport('__throw__')).toThrow('createMemoryTransportMock error');
  });
});

describe('default', () => {
  it('exposes OpType and createOp on the default export', () => {
    expect(crdtIndex.default.OpType).toBe(crdtIndex.OpType);
    expect(crdtIndex.default.createOp).toBe(crdtIndex.createOp);
  });

  it('handles unknown properties without throwing (boundary)', () => {
    expect(crdtIndex.default.NOPE).toBeUndefined();
    expect(crdtIndex.default['']).toBeUndefined();
    expect(crdtIndex.default['   ']).toBeUndefined();
  });

  it('surfaces createOp errors via default export (error handling)', () => {
    const badClock = { seq: 1, ts: 1, id: 123 };
    expect(() => crdtIndex.default.createOp('set', 'k', 'v', badClock)).toThrow(TypeError);
  });
});
