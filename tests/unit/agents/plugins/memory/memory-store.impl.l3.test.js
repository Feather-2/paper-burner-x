import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedMocks = vi.hoisted(() => {
  const deepClone = vi.fn((v) => ({ __cloned: true, v }));
  const isPlainObject = vi.fn((v) => {
    if (v === null || typeof v !== 'object') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  });
  const toNonEmptyString = vi.fn((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
      const s = v.trim();
      return s ? s : null;
    }
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return null;
  });

  return { deepClone, isPlainObject, toNonEmptyString };
});

vi.mock('../../../../../js/agents/shared/index.js', () => sharedMocks);

const retrievalEngineMocks = vi.hoisted(() => {
  class RetrievalEngine {
    constructor() {}
  }
  return { RetrievalEngine };
});

vi.mock('../../../../../js/agents/plugins/memory/retrieval-engine.js', () => retrievalEngineMocks);

const l3StorageMocks = vi.hoisted(() => {
  const L3Storage = vi.fn().mockImplementation(function (opts) {
    this.opts = opts;
    this.archive = vi.fn();
    this.getSnapshot = vi.fn();
  });
  return { L3Storage };
});

vi.mock('../../../../../js/agents/plugins/memory/l3-storage.js', () => l3StorageMocks);

const utilsMocks = vi.hoisted(() => {
  const defineGetter = vi.fn((getter) => ({
    get: getter,
    enumerable: true,
    configurable: true,
  }));

  const defineMethod = vi.fn((fn) => ({
    value: fn,
    enumerable: true,
    configurable: true,
    writable: true,
  }));

  const estimateBytes = vi.fn(() => 1);
  const genId = vi.fn((prefix) => `${prefix}-mock`);
  const truncate = vi.fn((str, max) => String(str).slice(0, max));

  return { defineGetter, defineMethod, estimateBytes, genId, truncate };
});

vi.mock('../../../../../js/agents/plugins/memory/memory-store.impl.utils.js', () => utilsMocks);

import { defineL3Layer } from '../../../../../js/agents/plugins/memory/memory-store.impl.l3.js';

function applyLayer(target, layer) {
  for (const [key, descOrVal] of Object.entries(layer)) {
    const isDescriptor =
      descOrVal &&
      typeof descOrVal === 'object' &&
      ('get' in descOrVal || 'set' in descOrVal || 'value' in descOrVal || 'writable' in descOrVal);

    if (isDescriptor) Object.defineProperty(target, key, descOrVal);
    else target[key] = descOrVal;
  }
  return target;
}

function createStore(overrides = {}) {
  const store = {
    runId: 'run-1',
    config: { maxL3Bytes: Number.MAX_SAFE_INTEGER },
    _vfs: null,
    _l3Storage: null,
    _l3StoragePromise: null,
    _l3BytesUsed: 0,
    _L3: {
      snapshots: new Map(),
      index: {
        keywords: new Map(),
        stages: new Map(),
        timeline: [],
      },
      checkpoints: [],
    },
    _emit: vi.fn(),
    _markDirty: vi.fn(),
    _stats: {},
    ...overrides,
  };

  applyLayer(store, defineL3Layer());
  return store;
}

describe('defineL3Layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    sharedMocks.toNonEmptyString.mockImplementation((v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'string') {
        const s = v.trim();
        return s ? s : null;
      }
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
      return null;
    });

    sharedMocks.deepClone.mockImplementation((v) => ({ __cloned: true, v }));
    utilsMocks.estimateBytes.mockImplementation(() => 1);
    utilsMocks.genId.mockImplementation((prefix) => `${prefix}-mock`);
    utilsMocks.truncate.mockImplementation((str, max) => String(str).slice(0, max));
  });

  it('returns a layer containing the expected L3 API surface', () => {
    const layer = defineL3Layer();
    expect(layer).toEqual(
      expect.objectContaining({
        L3: expect.anything(),
        cloneL3: expect.anything(),
        _getL3Storage: expect.anything(),
        _evictOldestSnapshot: expect.anything(),
        _evictOldestCheckpoint: expect.anything(),
        _ensureL3Capacity: expect.anything(),
        archive: expect.anything(),
      }),
    );
  });

  describe('L3 (getter)', () => {
    it('returns a frozen shallow view with correct references and copies', () => {
      const store = createStore();

      store._L3.snapshots.set('s1', { id: 's1', data: { a: 1 } });
      store._L3.index.keywords.set('k', new Set(['s1']));
      store._L3.index.stages.set('stageA', 's1');
      store._L3.index.timeline.push({ id: 's1', ts: 1, summary: 'sum1' });
      store._L3.checkpoints.push({ cp: 1 });

      const view = store.L3;

      expect(Object.isFrozen(view)).toBe(true);
      expect(Object.isFrozen(view.index)).toBe(true);
      expect(Object.isFrozen(view.index.timeline)).toBe(true);
      expect(Object.isFrozen(view.checkpoints)).toBe(true);

      expect(view.snapshots).toBe(store._L3.snapshots);
      expect(view.index.keywords).toBe(store._L3.index.keywords);
      expect(view.index.stages).toBe(store._L3.index.stages);

      expect(view.index.timeline).not.toBe(store._L3.index.timeline);
      expect(view.index.timeline).toEqual(store._L3.index.timeline);
      expect(view.checkpoints).not.toBe(store._L3.checkpoints);
      expect(view.checkpoints).toEqual(store._L3.checkpoints);

      expect(() => view.index.timeline.push({ id: 'x' })).toThrow();
      expect(() => view.checkpoints.pop()).toThrow();

      store._L3.snapshots.set('s2', { id: 's2' });
      store._L3.index.timeline.push({ id: 's2', ts: 2, summary: 'sum2' });
      store._L3.checkpoints.push({ cp: 2 });

      expect(view.snapshots.has('s2')).toBe(true);
      expect(view.index.timeline).toHaveLength(1);
      expect(view.checkpoints).toHaveLength(1);
    });

    it('works with empty timeline/checkpoints (empty values)', () => {
      const store = createStore();
      const view = store.L3;

      expect(view.index.timeline).toEqual([]);
      expect(view.checkpoints).toEqual([]);
      expect(Object.isFrozen(view.index.timeline)).toBe(true);
      expect(Object.isFrozen(view.checkpoints)).toBe(true);
    });
  });

  describe('cloneL3', () => {
    it('deep-clones the internal _L3 state via deepClone()', () => {
      const store = createStore();
      const sentinel = { ok: true };
      sharedMocks.deepClone.mockReturnValueOnce(sentinel);

      const result = store.cloneL3();

      expect(sharedMocks.deepClone).toHaveBeenCalledTimes(1);
      expect(sharedMocks.deepClone).toHaveBeenCalledWith(store._L3);
      expect(result).toBe(sentinel);
    });
  });

  describe('_getL3Storage', () => {
    it('returns cached _l3Storage when available', async () => {
      const cached = { kind: 'storage' };
      const store = createStore({ _l3Storage: cached, _vfs: { v: 1 } });

      const result = await store._getL3Storage();

      expect(result).toBe(cached);
      expect(l3StorageMocks.L3Storage).not.toHaveBeenCalled();
    });

    it('returns null when no vfs is configured (null boundary)', async () => {
      const store = createStore({ _vfs: null });

      const result = await store._getL3Storage();

      expect(result).toBeNull();
      expect(l3StorageMocks.L3Storage).not.toHaveBeenCalled();
      expect(store._l3Storage).toBeNull();
    });

    it('creates and caches an L3Storage instance when vfs is provided', async () => {
      const vfs = { root: '/virtual' };
      const store = createStore({ _vfs: vfs, runId: 'run-xyz' });

      const storage1 = await store._getL3Storage();
      const storage2 = await store._getL3Storage();

      expect(l3StorageMocks.L3Storage).toHaveBeenCalledTimes(1);
      expect(l3StorageMocks.L3Storage).toHaveBeenCalledWith({ vfs, runId: 'run-xyz' });
      expect(storage1).toBe(storage2);
      expect(store._l3Storage).toBe(storage1);
    });

    it('coalesces concurrent calls (concurrency boundary)', async () => {
      const store = createStore({ _vfs: { root: '/virtual' } });

      const p1 = store._getL3Storage();
      const p2 = store._getL3Storage();
      const [s1, s2] = await Promise.all([p1, p2]);

      expect(l3StorageMocks.L3Storage).toHaveBeenCalledTimes(1);
      expect(s1).toBe(s2);
    });

    it('awaits an in-flight promise and propagates its rejection (error handling)', async () => {
      const store = createStore({ _vfs: { root: '/virtual' } });

      const inFlight = Promise.reject(new Error('boom'));
      inFlight.catch(() => {});
      store._l3StoragePromise = inFlight;

      await expect(store._getL3Storage()).rejects.toThrow('boom');
      expect(l3StorageMocks.L3Storage).not.toHaveBeenCalled();
    });
  });

  describe('_evictOldestSnapshot', () => {
    it('is a no-op when timeline is empty (empty array boundary)', () => {
      const store = createStore();
      store._l3BytesUsed = 10;

      store._evictOldestSnapshot();

      expect(store._L3.index.timeline).toEqual([]);
      expect(store._l3BytesUsed).toBe(10);
      expect(utilsMocks.estimateBytes).not.toHaveBeenCalled();
    });

    it('shifts timeline even when the oldest entry has no id (nullish/id boundary)', () => {
      const store = createStore();
      store._L3.index.timeline.push({ ts: 1 }); // missing id
      store._L3.snapshots.set('s1', { id: 's1' });
      store._L3.index.keywords.set('k', new Set(['s1']));
      store._l3BytesUsed = 10;

      store._evictOldestSnapshot();

      expect(store._L3.index.timeline).toEqual([]);
      expect(store._L3.snapshots.has('s1')).toBe(true);
      expect(store._L3.index.keywords.get('k').has('s1')).toBe(true);
      expect(store._l3BytesUsed).toBe(10);
    });

    it('evicts the oldest snapshot, updates bytes, and cleans keyword index', () => {
      const store = createStore();
      const entry = { id: 's1', payload: 'x' };

      store._L3.snapshots.set('s1', entry);
      store._L3.index.timeline.push({ id: 's1', ts: 1, summary: 'sum1' });
      store._L3.index.keywords.set('k1', new Set(['s1', 's2']));
      store._L3.index.keywords.set('k2', new Set(['s1']));
      store._l3BytesUsed = 50;

      utilsMocks.estimateBytes.mockImplementation((obj) => (obj === entry ? 13 : 1));

      store._evictOldestSnapshot();

      expect(store._L3.index.timeline).toEqual([]);
      expect(store._L3.snapshots.has('s1')).toBe(false);
      expect(store._l3BytesUsed).toBe(37);

      expect(store._L3.index.keywords.get('k1').has('s1')).toBe(false);
      expect(store._L3.index.keywords.get('k1').has('s2')).toBe(true);
      expect(store._L3.index.keywords.get('k2').has('s1')).toBe(false);

      expect(utilsMocks.estimateBytes).toHaveBeenCalledWith(entry);
    });

    it('cleans keyword index even if the snapshot entry is missing', () => {
      const store = createStore();
      store._L3.index.timeline.push({ id: 'missing', ts: 1, summary: 'x' });
      store._L3.index.keywords.set('k', new Set(['missing']));
      store._l3BytesUsed = 10;

      store._evictOldestSnapshot();

      expect(store._L3.index.timeline).toEqual([]);
      expect(store._l3BytesUsed).toBe(10);
      expect(store._L3.index.keywords.get('k').has('missing')).toBe(false);
      expect(utilsMocks.estimateBytes).not.toHaveBeenCalled();
    });
  });

  describe('_evictOldestCheckpoint', () => {
    it('is a no-op when checkpoints is empty (empty array boundary)', () => {
      const store = createStore();
      store._l3BytesUsed = 10;

      store._evictOldestCheckpoint();

      expect(store._L3.checkpoints).toEqual([]);
      expect(store._l3BytesUsed).toBe(10);
      expect(utilsMocks.estimateBytes).not.toHaveBeenCalled();
    });

    it('evicts the oldest checkpoint and updates bytes', () => {
      const store = createStore();
      const cp1 = { cp: 'c1' };
      const cp2 = { cp: 'c2' };

      store._L3.checkpoints.push(cp1, cp2);
      store._l3BytesUsed = 100;

      utilsMocks.estimateBytes.mockImplementation((obj) => (obj === cp1 ? 30 : 1));

      store._evictOldestCheckpoint();

      expect(store._L3.checkpoints).toEqual([cp2]);
      expect(store._l3BytesUsed).toBe(70);
      expect(utilsMocks.estimateBytes).toHaveBeenCalledWith(cp1);
    });

    it('does not subtract bytes when the oldest checkpoint is 0 (boundary value 0)', () => {
      const store = createStore();
      store._L3.checkpoints.push(0, { cp: 'c2' });
      store._l3BytesUsed = 100;

      store._evictOldestCheckpoint();

      expect(store._L3.checkpoints).toHaveLength(1);
      expect(store._l3BytesUsed).toBe(100);
      expect(utilsMocks.estimateBytes).not.toHaveBeenCalled();
    });
  });

  describe('_ensureL3Capacity', () => {
    it('returns early when maxL3Bytes is invalid (non-finite, <= 0, or wrong type)', () => {
      const invalidMaxes = [undefined, null, NaN, Infinity, 0, -1, '100'];

      for (const max of invalidMaxes) {
        const store = createStore({ config: { maxL3Bytes: max } });

        store._L3.index.timeline.push({ id: 's1', ts: 1, summary: 'x' });
        store._L3.snapshots.set('s1', { id: 's1' });
        store._L3.checkpoints.push({ cp: 'c1' }, { cp: 'c2' });
        store._l3BytesUsed = 999;

        const snapSpy = vi.spyOn(store, '_evictOldestSnapshot');
        const cpSpy = vi.spyOn(store, '_evictOldestCheckpoint');

        store._ensureL3Capacity(10);

        expect(snapSpy).not.toHaveBeenCalled();
        expect(cpSpy).not.toHaveBeenCalled();
        expect(store._L3.index.timeline).toHaveLength(1);
        expect(store._L3.checkpoints).toHaveLength(2);
      }
    });

    it('evicts snapshots first, then checkpoints, and never evicts the last checkpoint', () => {
      const store = createStore({ config: { maxL3Bytes: 100 } });

      store._l3BytesUsed = 150;

      const s1 = { id: 's1' };
      const s2 = { id: 's2' };
      store._L3.snapshots.set('s1', s1);
      store._L3.snapshots.set('s2', s2);
      store._L3.index.timeline.push(
        { id: 's1', ts: 1, summary: 'a' },
        { id: 's2', ts: 2, summary: 'b' },
      );
      store._L3.index.keywords.set('k', new Set(['s1', 's2']));

      const c1 = { cp: 'c1' };
      const c2 = { cp: 'c2' };
      const c3 = { cp: 'c3' };
      store._L3.checkpoints.push(c1, c2, c3);

      utilsMocks.estimateBytes.mockImplementation((obj) => {
        if (obj && obj.id === 's1') return 30;
        if (obj && obj.id === 's2') return 30;
        if (obj && obj.cp) return 20;
        return 1;
      });

      store._ensureL3Capacity(50);

      expect(store._L3.index.timeline).toHaveLength(0);
      expect(store._L3.snapshots.size).toBe(0);
      expect(store._L3.index.keywords.get('k').has('s1')).toBe(false);
      expect(store._L3.index.keywords.get('k').has('s2')).toBe(false);

      expect(store._L3.checkpoints).toEqual([c3]);
      expect(store._l3BytesUsed).toBe(50);
    });

    it('does not evict the last checkpoint even if still over capacity', () => {
      const store = createStore({ config: { maxL3Bytes: 10 } });

      store._L3.checkpoints.push({ cp: 'only' });
      store._l3BytesUsed = 1000;

      store._ensureL3Capacity(1);

      expect(store._L3.checkpoints).toHaveLength(1);
      expect(store._l3BytesUsed).toBe(1000);
    });

    it('does not throw when incomingBytes is a string (type boundary: string as number)', () => {
      const store = createStore({ config: { maxL3Bytes: 100 } });
      expect(() => store._ensureL3Capacity('10')).not.toThrow();
    });
  });

  describe('archive', () => {
    it('archives in-memory when no L3Storage is available, builds indexes, emits events, and updates stats', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(111);

      utilsMocks.genId.mockReturnValueOnce('snap-123');
      utilsMocks.estimateBytes.mockReturnValueOnce(42);
      utilsMocks.truncate.mockReturnValueOnce('TRUNC');

      const store = createStore({ _vfs: null, config: { maxL3Bytes: Number.MAX_SAFE_INTEGER } });
      const ensureSpy = vi.spyOn(store, '_ensureL3Capacity');

      const data = { hello: 'world' };
      const id = await store.archive('StageA', data, [
        ' HeLLo ',
        '',
        '   ',
        null,
        undefined,
        'WORLD',
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
      ]);

      expect(id).toBe('snap-123');
      expect(ensureSpy).toHaveBeenCalledWith(42);

      const entry = store._L3.snapshots.get('snap-123');
      expect(entry).toEqual(
        expect.objectContaining({
          id: 'snap-123',
          stageKey: 'StageA',
          data,
          summary: 'TRUNC',
          ts: 111,
        }),
      );

      expect(utilsMocks.truncate).toHaveBeenCalledWith(JSON.stringify(data), 200);
      expect(store._l3BytesUsed).toBe(42);
      expect(store._markDirty).toHaveBeenCalledWith('L3');

      expect(store._L3.index.keywords.get('hello').has('snap-123')).toBe(true);
      expect(store._L3.index.keywords.get('world').has('snap-123')).toBe(true);
      expect(store._L3.index.keywords.get('0').has('snap-123')).toBe(true);
      expect(store._L3.index.keywords.get('-1').has('snap-123')).toBe(true);
      expect(store._L3.index.keywords.get(String(Number.MAX_SAFE_INTEGER)).has('snap-123')).toBe(true);

      expect(store._L3.index.stages.get('StageA')).toBe('snap-123');
      expect(store._L3.index.timeline).toEqual([{ id: 'snap-123', ts: 111, summary: 'TRUNC' }]);

      expect(store._emit).toHaveBeenCalledTimes(2);
      expect(store._emit).toHaveBeenNthCalledWith(
        1,
        'memory:archived',
        expect.objectContaining({ id: 'snap-123', stageKey: 'StageA', summary: 'TRUNC', ts: 111 }),
      );
      expect(store._emit).toHaveBeenNthCalledWith(
        2,
        'memory:l3:archive',
        expect.objectContaining({ id: 'snap-123', stageKey: 'StageA', keywordCount: 9 }),
      );

      expect(store._stats.archiveCount).toBe(1);

      nowSpy.mockRestore();
    });

    it('uses data.summary when it is truthy; otherwise falls back to truncate(JSON.stringify(data), 200)', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(222);

      utilsMocks.genId.mockReturnValueOnce('snap-a');
      utilsMocks.estimateBytes.mockReturnValueOnce(1);

      const store1 = createStore({ _vfs: null });
      const id1 = await store1.archive('S', { summary: 'Custom', x: 1 }, []);
      expect(id1).toBe('snap-a');
      expect(store1._L3.snapshots.get('snap-a').summary).toBe('Custom');
      expect(utilsMocks.truncate).not.toHaveBeenCalled();

      utilsMocks.genId.mockReturnValueOnce('snap-b');
      utilsMocks.estimateBytes.mockReturnValueOnce(1);
      utilsMocks.truncate.mockReturnValueOnce('TRUNC2');

      const store2 = createStore({ _vfs: null });
      const data2 = { summary: '', x: 2 };
      const id2 = await store2.archive('S', data2, []);
      expect(id2).toBe('snap-b');
      expect(store2._L3.snapshots.get('snap-b').summary).toBe('TRUNC2');
      expect(utilsMocks.truncate).toHaveBeenCalledWith(JSON.stringify(data2), 200);

      nowSpy.mockRestore();
    });

    it('does not write stage index when stageKey is an empty string (empty string boundary)', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(333);

      utilsMocks.genId.mockReturnValueOnce('snap-1');
      utilsMocks.estimateBytes.mockReturnValueOnce(1);

      const store = createStore({ _vfs: null });
      await store.archive('', { a: 1 }, ['k']);

      expect(store._L3.index.stages.size).toBe(0);

      nowSpy.mockRestore();
    });

    it('handles deep nesting and very long strings (resource boundary) without throwing', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(444);

      utilsMocks.genId.mockReturnValueOnce('snap-big');
      utilsMocks.estimateBytes.mockReturnValueOnce(5);

      const makeDeep = (depth) => {
        let node = { leaf: 'x'.repeat(10000) };
        for (let i = 0; i < depth; i += 1) node = { level: i, next: node };
        return node;
      };

      const store = createStore({ _vfs: null });
      const data = makeDeep(50);

      await expect(store.archive('S', data, [])).resolves.toBe('snap-big');
      expect(utilsMocks.truncate).toHaveBeenCalledWith(expect.any(String), 200);

      const [json] = utilsMocks.truncate.mock.calls[0];
      expect(json.length).toBeGreaterThan(200);

      nowSpy.mockRestore();
    });

    it('rejects on circular data when JSON.stringify fails (error handling)', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(555);

      utilsMocks.genId.mockReturnValueOnce('snap-circ');
      utilsMocks.estimateBytes.mockReturnValueOnce(1);

      const store = createStore({ _vfs: null });
      const data = {};
      data.self = data;

      await expect(store.archive('S', data, [])).rejects.toThrow();
      expect(store._emit).not.toHaveBeenCalled();
      expect(store._stats.archiveCount).toBeUndefined();
      expect(store._L3.snapshots.size).toBe(0);

      nowSpy.mockRestore();
    });

    it('rejects when keywords is a non-iterable object (type boundary: object as array)', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(666);

      utilsMocks.genId.mockReturnValueOnce('snap-badkw');
      utilsMocks.estimateBytes.mockReturnValueOnce(1);
      utilsMocks.truncate.mockReturnValueOnce('TR');

      const store = createStore({ _vfs: null });

      await expect(store.archive('S', { a: 1 }, { not: 'iterable' })).rejects.toThrow(TypeError);
      expect(store._emit).not.toHaveBeenCalled();
      expect(store._stats.archiveCount).toBeUndefined();

      nowSpy.mockRestore();
    });

    it('supports concurrent archive calls in in-memory mode (concurrency boundary)', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(777);

      utilsMocks.genId.mockReturnValueOnce('snap-1').mockReturnValueOnce('snap-2');
      utilsMocks.estimateBytes.mockReturnValue(1);

      const store = createStore({ _vfs: null });

      const [id1, id2] = await Promise.all([store.archive('S', { a: 1 }, []), store.archive('S', { a: 2 }, [])]);

      expect(new Set([id1, id2]).size).toBe(2);
      expect(store._L3.snapshots.has('snap-1')).toBe(true);
      expect(store._L3.snapshots.has('snap-2')).toBe(true);
      expect(store._L3.index.timeline).toHaveLength(2);
      expect(store._emit).toHaveBeenCalledTimes(4);
      expect(store._stats.archiveCount).toBe(2);

      nowSpy.mockRestore();
    });

    it('uses L3Storage when available and emits events based on the stored snapshot entry', async () => {
      const store = createStore({ _vfs: { root: '/virtual' }, runId: 'run-99' });
      store._stats.archiveCount = 41;

      const storage = await store._getL3Storage();
      storage.archive.mockResolvedValueOnce('remote-1');
      storage.getSnapshot.mockResolvedValueOnce({
        id: 'remote-1',
        stageKey: 'StageFromStorage',
        summary: 'SummaryFromStorage',
        ts: 999,
      });

      const id = await store.archive('StageInput', { payload: true }, ['a', 'b', 'c']);

      expect(id).toBe('remote-1');
      expect(l3StorageMocks.L3Storage).toHaveBeenCalledTimes(1);
      expect(storage.archive).toHaveBeenCalledWith('StageInput', expect.objectContaining({ payload: true }), ['a', 'b', 'c']);
      expect(storage.getSnapshot).toHaveBeenCalledWith('remote-1');

      expect(store._emit).toHaveBeenCalledTimes(2);
      expect(store._emit).toHaveBeenNthCalledWith(
        1,
        'memory:archived',
        expect.objectContaining({
          id: 'remote-1',
          stageKey: 'StageFromStorage',
          summary: 'SummaryFromStorage',
          ts: 999,
        }),
      );
      expect(store._emit).toHaveBeenNthCalledWith(
        2,
        'memory:l3:archive',
        expect.objectContaining({
          id: 'remote-1',
          stageKey: 'StageFromStorage',
          keywordCount: 3,
        }),
      );

      expect(store._stats.archiveCount).toBe(42);
    });

    it('falls back when storage snapshot lookup returns null (null boundary)', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(888);

      const store = createStore({ _vfs: { root: '/virtual' } });
      const storage = await store._getL3Storage();

      storage.archive.mockResolvedValueOnce('remote-2');
      storage.getSnapshot.mockResolvedValueOnce(null);

      const id = await store.archive('StageInput', { payload: true }, []);

      expect(id).toBe('remote-2');
      expect(store._emit).toHaveBeenCalledTimes(2);

      const [event1, payload1] = store._emit.mock.calls[0];
      expect(event1).toBe('memory:archived');
      expect(payload1).toEqual(expect.objectContaining({ id: 'remote-2', stageKey: 'StageInput', ts: 888 }));
      expect(payload1.summary).toBeUndefined();

      expect(store._emit).toHaveBeenNthCalledWith(
        2,
        'memory:l3:archive',
        expect.objectContaining({ id: 'remote-2', stageKey: 'StageInput', keywordCount: 0 }),
      );

      nowSpy.mockRestore();
    });

    it('propagates storage errors and does not emit events or increment stats (error handling)', async () => {
      const store = createStore({ _vfs: { root: '/virtual' } });

      const storage = await store._getL3Storage();
      storage.archive.mockRejectedValueOnce(new Error('archive failed'));

      await expect(store.archive('S', { a: 1 }, ['k'])).rejects.toThrow('archive failed');

      expect(store._emit).not.toHaveBeenCalled();
      expect(store._stats.archiveCount).toBeUndefined();
      expect(storage.getSnapshot).not.toHaveBeenCalled();
    });
  });
});