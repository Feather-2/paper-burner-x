import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/core/crdt/lww-register.js', () => {
  class LWWRegisterMock {}
  return { LWWRegister: LWWRegisterMock };
});

vi.mock('../../../../../js/agents/core/crdt/counters.js', () => {
  class GCounterMock {}
  class PNCounterMock {}
  return { GCounter: GCounterMock, PNCounter: PNCounterMock };
});

vi.mock('../../../../../js/agents/core/crdt/lww-map.js', () => {
  class LWWMapMock {}
  return { LWWMap: LWWMapMock };
});

vi.mock('../../../../../js/agents/core/crdt/or-set.js', () => {
  class ORSetMock {}
  return { ORSet: ORSetMock };
});

vi.mock('../../../../../js/agents/core/crdt/document.js', () => {
  class CRDTDocumentMock {}
  return { CRDTDocument: CRDTDocumentMock };
});

vi.mock('../../../../../js/agents/core/crdt/sync-manager.js', () => {
  class CRDTSyncManagerMock {}
  const createMemoryTransport = vi.fn(() => ({ type: 'memory' }));
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
});

describe('GCounter', () => {
  it('re-exports GCounter from the counters module', () => {
    expect(crdtIndex.GCounter).toBe(countersModule.GCounter);
  });
});

describe('PNCounter', () => {
  it('re-exports PNCounter from the counters module', () => {
    expect(crdtIndex.PNCounter).toBe(countersModule.PNCounter);
  });
});

describe('LWWMap', () => {
  it('re-exports LWWMap from the lww-map module', () => {
    expect(crdtIndex.LWWMap).toBe(lwwMapModule.LWWMap);
  });
});

describe('ORSet', () => {
  it('re-exports ORSet from the or-set module', () => {
    expect(crdtIndex.ORSet).toBe(orSetModule.ORSet);
  });
});

describe('CRDTDocument', () => {
  it('re-exports CRDTDocument from the document module', () => {
    expect(crdtIndex.CRDTDocument).toBe(documentModule.CRDTDocument);
  });
});

describe('CRDTSyncManager', () => {
  it('re-exports CRDTSyncManager from the sync-manager module', () => {
    expect(crdtIndex.CRDTSyncManager).toBe(syncManagerModule.CRDTSyncManager);
  });
});

describe('createMemoryTransport', () => {
  it('re-exports createMemoryTransport from the sync-manager module', () => {
    expect(crdtIndex.createMemoryTransport).toBe(syncManagerModule.createMemoryTransport);
  });
});

describe('default', () => {
  it('exposes OpType and createOp on the default export', () => {
    expect(crdtIndex.default.OpType).toBe(crdtIndex.OpType);
    expect(crdtIndex.default.createOp).toBe(crdtIndex.createOp);
  });
});
