import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedDeps = vi.hoisted(() => {
  class LWWRegister {}
  class GCounter {}
  class PNCounter {}
  class LWWMap {}
  class ORSet {}
  class CRDTDocument {}
  class CRDTSyncManager {}
  const createMemoryTransport = vi.fn((...args) => ({ kind: 'memory-transport', args }));

  return {
    LWWRegister,
    GCounter,
    PNCounter,
    LWWMap,
    ORSet,
    CRDTDocument,
    CRDTSyncManager,
    createMemoryTransport,
  };
});

vi.mock('../../../../../js/agents/core/crdt/lww-register.js', () => ({
  LWWRegister: mockedDeps.LWWRegister,
}));

vi.mock('../../../../../js/agents/core/crdt/counters.js', () => ({
  GCounter: mockedDeps.GCounter,
  PNCounter: mockedDeps.PNCounter,
}));

vi.mock('../../../../../js/agents/core/crdt/lww-map.js', () => ({
  LWWMap: mockedDeps.LWWMap,
}));

vi.mock('../../../../../js/agents/core/crdt/or-set.js', () => ({
  ORSet: mockedDeps.ORSet,
}));

vi.mock('../../../../../js/agents/core/crdt/document.js', () => ({
  CRDTDocument: mockedDeps.CRDTDocument,
}));

vi.mock('../../../../../js/agents/core/crdt/sync-manager.js', () => ({
  CRDTSyncManager: mockedDeps.CRDTSyncManager,
  createMemoryTransport: mockedDeps.createMemoryTransport,
}));

const importIndex = async () => import('../../../../../js/agents/core/crdt/index.js');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('OpType', () => {
  it('exposes the expected operation type constants', async () => {
    const { OpType } = await importIndex();
    expect(OpType).toEqual({
      SET: 'set',
      DELETE: 'delete',
      INCREMENT: 'increment',
      DECREMENT: 'decrement',
      ADD: 'add',
      REMOVE: 'remove',
    });
  });

  it('contains unique non-empty string values', async () => {
    const { OpType } = await importIndex();

    const values = Object.values(OpType);
    expect(values.length).toBe(6);

    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v.trim()).not.toBe('');
    }

    expect(new Set(values).size).toBe(values.length);
  });
});

describe('createOp', () => {
  it('creates an op with provided clock and derived nodeId from the prefix before "_"', async () => {
    const { createOp } = await importIndex();

    const clock = { seq: 7, ts: 123, id: 'agentA_42' };
    const op = createOp('set', 'k', 123, clock);

    expect(op).toEqual({
      type: 'set',
      key: 'k',
      value: 123,
      clock,
      nodeId: 'agentA',
    });
    expect(op.clock).toBe(clock);
  });

  it('derives nodeId from clock.id and falls back to "unknown" when the prefix is empty', async () => {
    const { createOp } = await importIndex();

    expect(createOp('set', 'k', 'v', { seq: 0, ts: 0, id: 'solo' }).nodeId).toBe('solo');
    expect(createOp('set', 'k', 'v', { seq: 0, ts: 0, id: '_suffix' }).nodeId).toBe('unknown');
    expect(createOp('set', 'k', 'v', { seq: 0, ts: 0, id: '' }).nodeId).toBe('unknown');
  });

  it('uses a default clock when clock is omitted and sets nodeId to "unknown"', async () => {
    const { createOp } = await importIndex();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const op = createOp('set', 'k', 'v');

    expect(nowSpy).toHaveBeenCalledTimes(1);
    expect(op.clock).toEqual({ seq: 0, ts: 1700000000000, id: '' });
    expect(op.nodeId).toBe('unknown');
  });

  it('treats null/0/"" clock as absent and generates a default clock', async () => {
    const { createOp } = await importIndex();
    vi.spyOn(Date, 'now').mockReturnValue(42);

    expect(createOp('set', 'k', 'v', null).clock).toEqual({ seq: 0, ts: 42, id: '' });
    expect(createOp('set', 'k', 'v', 0).clock).toEqual({ seq: 0, ts: 42, id: '' });
    expect(createOp('set', 'k', 'v', '').clock).toEqual({ seq: 0, ts: 42, id: '' });
  });

  it('preserves null/undefined/empty values without coercion', async () => {
    const { createOp } = await importIndex();

    const clock = { seq: 0, ts: 0, id: 'node_1' };
    const op = createOp(' ', null, undefined, clock);

    expect(op.type).toBe(' ');
    expect(op.key).toBeNull();
    expect(op.value).toBeUndefined();
    expect(op.clock).toBe(clock);
    expect(op.nodeId).toBe('node');
  });

  it('does not validate type/key/value types (type boundary) and keeps references', async () => {
    const { createOp } = await importIndex();

    const keyObj = { k: 'v' };
    const valueArr = ['1', '2', '3'];

    const op = createOp(123, keyObj, valueArr, { seq: 1, ts: 1, id: 'agent_1' });

    expect(op.type).toBe(123);
    expect(op.key).toBe(keyObj);
    expect(op.value).toBe(valueArr);
    expect(op.nodeId).toBe('agent');
  });

  it('handles boundary numbers and very large payloads', async () => {
    const { createOp } = await importIndex();

    const veryLongString = 'x'.repeat(100_000);

    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 2000; i++) {
      cursor.child = {};
      cursor = cursor.child;
    }

    const clock = { seq: Number.MAX_SAFE_INTEGER, ts: -1, id: 'n' };
    const op = createOp('set', veryLongString, { deep, nums: [0, -1, Number.MAX_SAFE_INTEGER] }, clock);

    expect(op.key).toBe(veryLongString);
    expect(op.value).toEqual({ deep, nums: [0, -1, Number.MAX_SAFE_INTEGER] });
    expect(op.clock).toBe(clock);
    expect(op.nodeId).toBe('n');
  });

  it('can be called concurrently; omitted clocks are independent objects', async () => {
    const { createOp } = await importIndex();
    vi.spyOn(Date, 'now').mockReturnValue(1);

    const ops = await Promise.all(
      Array.from({ length: 50 }, (_, i) => Promise.resolve().then(() => createOp('set', `k${i}`, i))),
    );

    const clocks = ops.map((o) => o.clock);
    expect(new Set(clocks).size).toBe(clocks.length);

    for (const op of ops) {
      expect(op.nodeId).toBe('unknown');
    }
  });

  it('can be called concurrently with a shared clock object', async () => {
    const { createOp } = await importIndex();

    const clock = { seq: 1, ts: 2, id: 'agentX_9' };
    const ops = await Promise.all(
      Array.from({ length: 25 }, (_, i) => Promise.resolve().then(() => createOp('set', i, i, clock))),
    );

    for (const op of ops) {
      expect(op.clock).toBe(clock);
      expect(op.nodeId).toBe('agentX');
    }
  });

  it('throws a TypeError when clock.id is non-nullish but does not support split()', async () => {
    const { createOp } = await importIndex();

    expect(() => createOp('set', 'k', 'v', { seq: 0, ts: 0, id: 123 })).toThrow(TypeError);
    expect(() => createOp('set', 'k', 'v', { seq: 0, ts: 0, id: {} })).toThrow(TypeError);
  });
});

describe('LWWRegister', () => {
  it('re-exports LWWRegister from lww-register.js', async () => {
    const { LWWRegister } = await importIndex();
    expect(LWWRegister).toBe(mockedDeps.LWWRegister);
  });

  it('is constructable', async () => {
    const { LWWRegister } = await importIndex();
    expect(() => new LWWRegister()).not.toThrow();
  });
});

describe('GCounter', () => {
  it('re-exports GCounter from counters.js', async () => {
    const { GCounter } = await importIndex();
    expect(GCounter).toBe(mockedDeps.GCounter);
  });

  it('is constructable', async () => {
    const { GCounter } = await importIndex();
    expect(() => new GCounter()).not.toThrow();
  });
});

describe('PNCounter', () => {
  it('re-exports PNCounter from counters.js', async () => {
    const { PNCounter } = await importIndex();
    expect(PNCounter).toBe(mockedDeps.PNCounter);
  });

  it('is constructable', async () => {
    const { PNCounter } = await importIndex();
    expect(() => new PNCounter()).not.toThrow();
  });
});

describe('LWWMap', () => {
  it('re-exports LWWMap from lww-map.js', async () => {
    const { LWWMap } = await importIndex();
    expect(LWWMap).toBe(mockedDeps.LWWMap);
  });

  it('is constructable', async () => {
    const { LWWMap } = await importIndex();
    expect(() => new LWWMap()).not.toThrow();
  });
});

describe('ORSet', () => {
  it('re-exports ORSet from or-set.js', async () => {
    const { ORSet } = await importIndex();
    expect(ORSet).toBe(mockedDeps.ORSet);
  });

  it('is constructable', async () => {
    const { ORSet } = await importIndex();
    expect(() => new ORSet()).not.toThrow();
  });
});

describe('CRDTDocument', () => {
  it('re-exports CRDTDocument from document.js', async () => {
    const { CRDTDocument } = await importIndex();
    expect(CRDTDocument).toBe(mockedDeps.CRDTDocument);
  });

  it('is constructable', async () => {
    const { CRDTDocument } = await importIndex();
    expect(() => new CRDTDocument()).not.toThrow();
  });
});

describe('CRDTSyncManager', () => {
  it('re-exports CRDTSyncManager from sync-manager.js', async () => {
    const { CRDTSyncManager } = await importIndex();
    expect(CRDTSyncManager).toBe(mockedDeps.CRDTSyncManager);
  });

  it('is constructable', async () => {
    const { CRDTSyncManager } = await importIndex();
    expect(() => new CRDTSyncManager()).not.toThrow();
  });
});

describe('createMemoryTransport', () => {
  it('re-exports createMemoryTransport from sync-manager.js and forwards calls', async () => {
    const { createMemoryTransport } = await importIndex();

    const payload = { deep: { a: [1, 2, 3] } };
    const result = createMemoryTransport(null, undefined, '', payload);

    expect(mockedDeps.createMemoryTransport).toHaveBeenCalledTimes(1);
    expect(mockedDeps.createMemoryTransport).toHaveBeenCalledWith(null, undefined, '', payload);
    expect(result).toEqual({ kind: 'memory-transport', args: [null, undefined, '', payload] });
  });
});

describe('default', () => {
  it('exports an object containing OpType and createOp by reference', async () => {
    const mod = await importIndex();

    expect(mod.default).not.toBeNull();
    expect(typeof mod.default).toBe('object');
    expect(mod.default.OpType).toBe(mod.OpType);
    expect(mod.default.createOp).toBe(mod.createOp);
  });

  it('does not include other named exports on the default object', async () => {
    const { default: def } = await importIndex();
    expect(Object.keys(def).sort()).toEqual(['OpType', 'createOp']);
  });
});