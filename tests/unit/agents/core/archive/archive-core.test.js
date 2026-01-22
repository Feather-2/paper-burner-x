import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/shared/utils/value-utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    toPositiveInt: vi.fn(actual.toPositiveInt),
  };
});

vi.mock('../../../../../js/agents/core/archive/serialization.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    applyJsonPatch: vi.fn(actual.applyJsonPatch),
    buildJsonPatch: vi.fn(actual.buildJsonPatch),
    safeJsonSize: vi.fn(actual.safeJsonSize),
  };
});

const DAY_MS = 24 * 60 * 60 * 1000;

function createStorageAdapter(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries));
  return {
    store,
    get: vi.fn(async (key) => store.get(key)),
    set: vi.fn(async (key, value) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key) => {
      store.delete(key);
    }),
    keys: vi.fn(async (pattern) => {
      const pat = String(pattern ?? '');
      if (pat === '*') return Array.from(store.keys());
      if (pat.endsWith('*')) {
        const prefix = pat.slice(0, -1);
        return Array.from(store.keys()).filter((key) => key.startsWith(prefix));
      }
      return store.has(pat) ? [pat] : [];
    }),
  };
}

function createDeepObject(depth) {
  let current = { value: 'leaf' };
  for (let i = 0; i < depth; i += 1) {
    current = { level: current };
  }
  return current;
}

function createDeferred() {
  /** @type {(value?: any) => void} */
  let resolve;
  /** @type {(reason?: any) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Archive', () => {
  let Archive;
  let applyJsonPatch;
  let buildJsonPatch;
  let safeJsonSize;
  let isPlainObject;
  let toNonEmptyString;
  let toPositiveInt;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.resetModules();

    ({ Archive } = await import('../../../../../js/agents/core/archive/archive-core.js'));
    ({ applyJsonPatch, buildJsonPatch, safeJsonSize } = await import(
      '../../../../../js/agents/core/archive/serialization.js'
    ));
    ({ isPlainObject, toNonEmptyString, toPositiveInt } = await import(
      '../../../../../js/agents/shared/utils/value-utils.js'
    ));
  });

  describe('constructor', () => {
    it('throws when storage adapter is missing required methods', () => {
      expect(() => new Archive(null)).toThrow(TypeError);
      expect(() => new Archive({})).toThrow(TypeError);
      expect(() => new Archive({ get: () => {}, set: () => {}, delete: () => {} })).toThrow(TypeError);
    });

    it('normalizes diff config and restoreCacheMax boundaries', () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage, {
        diff: {
          enabled: 0,
          fullSnapshotEvery: '2',
          minSavingsBytes: '3',
          maxOps: '4',
          maxDepth: '5',
        },
        restoreCacheMax: '-1',
      });

      expect(archive._diff).toEqual({
        enabled: false,
        fullSnapshotEvery: 2,
        minSavingsBytes: 3,
        maxOps: 4,
        maxDepth: 5,
      });
      expect(archive._restoreCacheMax).toBe(0);
      expect(toPositiveInt).toHaveBeenCalled();
    });

    it.each([
      ['zero', 0, 0],
      ['negative', -1, 0],
      ['max safe', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      ['whitespace string', ' 7 ', 7],
      ['null', null, 200],
      ['undefined', undefined, 200],
      ['infinity', Infinity, Infinity],
    ])('normalizes restoreCacheMax (%s)', (_label, input, expected) => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage, { restoreCacheMax: input });

      expect(archive._restoreCacheMax).toBe(expected);
    });
  });

  describe('save', () => {
    it.each([null, undefined, '', '   '])('throws for invalid runId (%s)', async (runId) => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await expect(archive.save(runId, {})).rejects.toThrow(TypeError);
    });

    it('throws when runId contains ":"', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await expect(archive.save('bad:run', {})).rejects.toThrow("runId must not include ':'");
    });

    it.each([
      ['empty array', []],
      ['empty object', {}],
    ])('stores defaults for %s payload', async (_label, payload) => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123);

      const checkpointId = await archive.save('run', payload);

      nowSpy.mockRestore();

      expect(checkpointId).toBe('run:123');
      expect(storage.set).toHaveBeenCalledTimes(1);
      const stored = storage.store.get(checkpointId);
      expect(stored.nodeStates).toEqual({});
      expect(stored.timestamp).toBe('123');
      expect(isPlainObject).toHaveBeenCalledWith(payload);
    });

    it('serializes concurrent saves and resolves collisions with counters', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);
      const data = { timestamp: '1000', nodeStates: { a: 1 } };

      const [firstId, secondId] = await Promise.all([archive.save('run', data), archive.save('run', data)]);

      expect(firstId).toBe('run:1000');
      expect(secondId).toBe('run:1000-1');
      expect(storage.set).toHaveBeenCalledTimes(2);
    });

    it('cleans up save locks after rapid consecutive saves', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);
      const data = { timestamp: '2000', nodeStates: { a: 1 } };

      const firstId = await archive.save('run', data);
      const secondId = await archive.save('run', data);

      expect(firstId).toBe('run:2000');
      expect(secondId).toBe('run:2000-1');
      expect(archive._saveLocks.size).toBe(0);
    });

    it('per-runId mutex allows different runIds to save concurrently', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);
      const originalSet = storage.set;
      const blockRunA = createDeferred();
      const runASetStarted = createDeferred();
      const runBSetStarted = createDeferred();

      storage.set = vi.fn(async (key, value) => {
        if (String(key).startsWith('runA:')) {
          runASetStarted.resolve();
          await blockRunA.promise;
        }
        if (String(key).startsWith('runB:')) {
          runBSetStarted.resolve();
        }
        return originalSet(key, value);
      });

      const saveA = archive.save('runA', { timestamp: '100', nodeStates: { a: 1 } });
      await runASetStarted.promise;

      const saveB = archive.save('runB', { timestamp: '100', nodeStates: { b: 2 } });
      await runBSetStarted.promise;

      blockRunA.resolve();

      const [idA, idB] = await Promise.all([saveA, saveB]);

      expect(idA).toBe('runA:100');
      expect(idB).toBe('runB:100');
      expect(storage.set).toHaveBeenCalledTimes(2);
    });

    it('throws CHECKPOINT_ID_COLLISION after 100 collision attempts', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      storage.get = vi.fn(async () => ({ nodeStates: {} }));

      await expect(archive.save('run', { timestamp: '999', nodeStates: {} })).rejects.toThrow(
        'CHECKPOINT_ID_COLLISION'
      );
      expect(storage.get).toHaveBeenCalledTimes(101);
    });

    it('preserves schemaVersion in saved snapshot', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      const checkpointId = await archive.save('run', {
        timestamp: '50',
        nodeStates: { x: 1 },
        schemaVersion: 'v2.0',
      });

      const stored = storage.store.get(checkpointId);
      expect(stored.schemaVersion).toBe('v2.0');
    });

    it('forces full snapshot when fullSnapshotEvery threshold is reached', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage, {
        diff: { enabled: true, minSavingsBytes: 1, fullSnapshotEvery: 3, maxOps: 100, maxDepth: 5 },
      });

      safeJsonSize.mockImplementation((value) => (value && value.encoding === 'diff' ? 10 : 1000));

      await archive.save('run', { timestamp: '1', nodeStates: { a: 1 } });
      expect(archive._diffSinceFullByRunId.get('run')).toBe(0);

      await archive.save('run', { timestamp: '2', nodeStates: { a: 2 } });
      expect(archive._diffSinceFullByRunId.get('run')).toBe(1);

      await archive.save('run', { timestamp: '3', nodeStates: { a: 3 } });
      expect(archive._diffSinceFullByRunId.get('run')).toBe(2);

      const fourthId = await archive.save('run', { timestamp: '4', nodeStates: { a: 4 } });
      const fourthStored = storage.store.get(fourthId);
      expect(fourthStored.encoding).toBeUndefined();
      expect(archive._diffSinceFullByRunId.get('run')).toBe(0);
    });

    it('stores diff snapshots when savings exceed threshold (large payload + deep nesting)', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage, {
        diff: { enabled: true, minSavingsBytes: 100, fullSnapshotEvery: 10, maxOps: 9, maxDepth: 3 },
      });

      const bigString = 'x'.repeat(10000);
      const deep = createDeepObject(8);

      await archive.save('run', { timestamp: '10', nodeStates: { big: bigString, deep } });

      safeJsonSize.mockImplementation((value) => (value && value.encoding === 'diff' ? 100 : 5000));

      const nextId = await archive.save('run', {
        timestamp: '11',
        nodeStates: { big: bigString, deep, extra: 'y'.repeat(2000) },
      });

      const stored = storage.store.get(nextId);
      expect(stored.encoding).toBe('diff');
      expect(stored.base).toBe('run:10');
      expect(buildJsonPatch).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ maxDepth: 3, maxOps: 9 })
      );
      expect(safeJsonSize).toHaveBeenCalled();
    });

    it('falls back to full snapshot when diff generation throws', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await archive.save('run', { timestamp: '1', nodeStates: { a: 1 } });

      buildJsonPatch.mockImplementationOnce(() => {
        throw new Error('boom');
      });

      const nextId = await archive.save('run', { timestamp: '2', nodeStates: { a: 2 } });
      const stored = storage.store.get(nextId);

      expect(stored.encoding).toBeUndefined();
      expect(safeJsonSize).not.toHaveBeenCalled();
    });

    it('uses latest checkpoint from storage when in-memory last checkpoint is missing', async () => {
      const storage = createStorageAdapter({
        'run:1': { nodeStates: { a: 1 }, timestamp: '1' },
      });
      const archive = new Archive(storage, {
        diff: { enabled: true, minSavingsBytes: 1, fullSnapshotEvery: 10, maxOps: 100, maxDepth: 5 },
      });

      safeJsonSize.mockImplementation((value) => (value && value.encoding === 'diff' ? 1 : 1000));

      const nextId = await archive.save('run', { timestamp: '2', nodeStates: { a: 2 } });

      const stored = storage.store.get(nextId);
      expect(stored.encoding).toBe('diff');
      expect(stored.base).toBe('run:1');
    });
  });

  describe('load', () => {
    it.each([null, undefined, '', '   '])('returns null for empty key (%s)', async (key) => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await expect(archive.load(key)).resolves.toBeNull();
    });

    it('loads by checkpointId', async () => {
      const storage = createStorageAdapter({
        'run:10': { nodeStates: { a: 1 }, timestamp: '10' },
      });
      const archive = new Archive(storage);

      const result = await archive.load('run:10');

      expect(result.nodeStates).toEqual({ a: 1 });
      expect(result.timestamp).toBe('10');
    });

    it('returns null when checkpointId is not found', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await expect(archive.load('run:missing')).resolves.toBeNull();
    });

    it('loads latest checkpoint for runId using timestamp and counter ordering', async () => {
      const storage = createStorageAdapter({
        'run:100': { nodeStates: { a: 1 } },
        'run:100-2': { nodeStates: { a: 2 } },
        'run:99': { nodeStates: { a: 3 } },
      });
      const archive = new Archive(storage);

      const result = await archive.load('run');

      expect(result.nodeStates).toEqual({ a: 2 });
      expect(toNonEmptyString).toHaveBeenCalled();
    });

    it('returns null when runId has no checkpoints', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await expect(archive.load('missing')).resolves.toBeNull();
    });
  });

  describe('restore', () => {
    it.each([null, undefined, '', '   '])('throws for invalid checkpointId (%s)', async (checkpointId) => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await expect(archive.restore(checkpointId)).rejects.toThrow(TypeError);
    });

    it('throws when checkpoint is not found', async () => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await expect(archive.restore('run:404')).rejects.toThrow('Checkpoint not found');
    });

    it('restores diff snapshots and uses cache on repeated calls', async () => {
      const storage = createStorageAdapter({
        'run:100': { nodeStates: { a: 1 }, timestamp: '100' },
        'run:200': {
          encoding: 'diff',
          base: 'run:100',
          patch: [{ op: 'replace', path: '/a', value: 2 }],
          timestamp: '200',
        },
      });
      const archive = new Archive(storage, { restoreCacheMax: 2 });

      const first = await archive.restore('run:200');
      const second = await archive.restore('run:200');

      expect(first.nodeStates).toEqual({ a: 2 });
      expect(second.nodeStates).toEqual({ a: 2 });
      expect(applyJsonPatch).toHaveBeenCalled();
      expect(storage.get).toHaveBeenCalledTimes(2);
    });

    it('falls back to full snapshot when diff patch is not an array (object-as-array boundary)', async () => {
      const storage = createStorageAdapter({
        'run:base': { nodeStates: { a: 1 }, timestamp: '1' },
        'run:diff': {
          encoding: 'diff',
          base: 'run:base',
          patch: { op: 'replace', path: '/a', value: 2 },
          nodeStates: { a: 9 },
          timestamp: '2',
        },
      });
      const archive = new Archive(storage);

      const result = await archive.restore('run:diff');

      expect(result.nodeStates).toEqual({ a: 9 });
      expect(applyJsonPatch).not.toHaveBeenCalled();
    });

    it('detects circular diff references', async () => {
      const storage = createStorageAdapter({
        'run:loop': {
          encoding: 'diff',
          base: 'run:loop',
          patch: [],
          timestamp: '1',
        },
      });
      const archive = new Archive(storage);

      await expect(archive.restore('run:loop')).rejects.toThrow('Circular checkpoint reference detected');
    });

    it('enforces max restore depth for deep diff chains', async () => {
      const store = {};
      store['run:0'] = { nodeStates: { a: 1 }, timestamp: '0' };
      for (let i = 1; i <= 51; i += 1) {
        store[`run:${i}`] = {
          encoding: 'diff',
          base: `run:${i - 1}`,
          patch: [],
          timestamp: String(i),
        };
      }

      const storage = createStorageAdapter(store);
      const archive = new Archive(storage);

      await expect(archive.restore('run:51')).rejects.toThrow('Checkpoint restore max depth exceeded');
    });

    it('restores schemaVersion from stored snapshot', async () => {
      const storage = createStorageAdapter({
        'run:1': { nodeStates: { a: 1 }, timestamp: '1', schemaVersion: 'v3.0' },
      });
      const archive = new Archive(storage);

      const result = await archive.restore('run:1');

      expect(result.schemaVersion).toBe('v3.0');
    });

    it('evicts oldest entries when restore cache exceeds max', async () => {
      const storage = createStorageAdapter({
        'run:1': { nodeStates: { a: 1 }, timestamp: '1' },
        'run:2': { nodeStates: { a: 2 }, timestamp: '2' },
        'run:3': { nodeStates: { a: 3 }, timestamp: '3' },
      });
      const archive = new Archive(storage, { restoreCacheMax: 2 });

      await archive.restore('run:1');
      await archive.restore('run:2');

      expect(archive._restoreCache.size).toBe(2);
      expect(archive._restoreCache.has('run:1')).toBe(true);
      expect(archive._restoreCache.has('run:2')).toBe(true);

      await archive.restore('run:3');

      expect(archive._restoreCache.size).toBe(2);
      expect(archive._restoreCache.has('run:1')).toBe(false);
      expect(archive._restoreCache.has('run:2')).toBe(true);
      expect(archive._restoreCache.has('run:3')).toBe(true);
    });

    it('touchRestoreCache promotes recently accessed entries', async () => {
      const storage = createStorageAdapter({
        'run:1': { nodeStates: { a: 1 }, timestamp: '1' },
        'run:2': { nodeStates: { a: 2 }, timestamp: '2' },
        'run:3': { nodeStates: { a: 3 }, timestamp: '3' },
      });
      const archive = new Archive(storage, { restoreCacheMax: 2 });

      await archive.restore('run:1');
      await archive.restore('run:2');

      await archive.restore('run:1');

      await archive.restore('run:3');

      expect(archive._restoreCache.has('run:1')).toBe(true);
      expect(archive._restoreCache.has('run:2')).toBe(false);
      expect(archive._restoreCache.has('run:3')).toBe(true);
    });

    it('skips cache operations when restoreCacheMax is 0', async () => {
      const storage = createStorageAdapter({
        'run:1': { nodeStates: { a: 1 }, timestamp: '1' },
      });
      const archive = new Archive(storage, { restoreCacheMax: 0 });

      await archive.restore('run:1');
      await archive.restore('run:1');

      expect(archive._restoreCache.size).toBe(0);
      expect(storage.get).toHaveBeenCalledTimes(2);
    });

    it('does not evict when restoreCacheMax is Infinity', async () => {
      const storage = createStorageAdapter({
        'run:1': { nodeStates: { a: 1 }, timestamp: '1' },
        'run:2': { nodeStates: { a: 2 }, timestamp: '2' },
        'run:3': { nodeStates: { a: 3 }, timestamp: '3' },
      });
      const archive = new Archive(storage, { restoreCacheMax: Infinity });

      await archive.restore('run:1');
      await archive.restore('run:2');
      await archive.restore('run:3');

      expect(archive._restoreCache.size).toBe(3);
    });
  });

  describe('listCheckpoints', () => {
    it.each([null, undefined, '', '   '])('returns empty list for invalid runId (%s)', async (runId) => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await expect(archive.listCheckpoints(runId)).resolves.toEqual([]);
    });

    it('returns checkpoints sorted by timestamp and counter and defaults nodeStates', async () => {
      const storage = createStorageAdapter({
        'run:1': { timestamp: '1000', nodeStates: { c: 3 } },
        'run:100': { nodeStates: null },
        'run:100-2': { nodeStates: { a: 1 } },
        'run:99': { nodeStates: { b: 2 } },
        'run:abc': { nodeStates: { d: 4 } },
      });
      const archive = new Archive(storage);

      const checkpoints = await archive.listCheckpoints('run');

      expect(checkpoints.map((entry) => entry.checkpointId)).toEqual([
        'run:1',
        'run:100-2',
        'run:100',
        'run:99',
        'run:abc',
      ]);
      expect(checkpoints.find((entry) => entry.checkpointId === 'run:100').nodeStates).toEqual({});
    });
  });

  describe('deleteOlderThan', () => {
    it.each([-1, NaN, 'nope', {}, undefined])('throws for invalid days (%s)', async (days) => {
      const storage = createStorageAdapter();
      const archive = new Archive(storage);

      await expect(archive.deleteOlderThan(days)).rejects.toThrow(TypeError);
    });

    it('deletes checkpoints older than cutoff and clears restore cache (string number boundary)', async () => {
      const now = 10 * DAY_MS;
      const oldTs = now - 2 * DAY_MS;
      const newTs = now - 1000;

      const storage = createStorageAdapter({
        [`run:${oldTs}`]: { nodeStates: { a: 1 } },
        [`run:${newTs}`]: { nodeStates: { b: 2 } },
        'run:abc': { nodeStates: { c: 3 } },
      });
      const archive = new Archive(storage);
      archive._cacheRestoredCheckpoint(`run:${oldTs}`, { nodeStates: { a: 1 } });
      archive._cacheRestoredCheckpoint(`run:${newTs}`, { nodeStates: { b: 2 } });

      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
      const deleted = await archive.deleteOlderThan('1');
      nowSpy.mockRestore();

      expect(deleted).toBe(1);
      expect(storage.delete).toHaveBeenCalledWith(`run:${oldTs}`);
      expect(archive._restoreCache.has(`run:${oldTs}`)).toBe(false);
      expect(archive._restoreCache.has(`run:${newTs}`)).toBe(true);
    });

    it('handles boundary values for days (0 and MAX_SAFE_INTEGER)', async () => {
      const now = 5 * DAY_MS;
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

      const storageAtZero = createStorageAdapter({
        [`run:${now - 1}`]: { nodeStates: { a: 1 } },
      });
      const archiveAtZero = new Archive(storageAtZero);
      const deletedAtZero = await archiveAtZero.deleteOlderThan(0);

      const storageAtMax = createStorageAdapter({
        [`run:${now - 1}`]: { nodeStates: { a: 1 } },
      });
      const archiveAtMax = new Archive(storageAtMax);
      const deletedAtMax = await archiveAtMax.deleteOlderThan(Number.MAX_SAFE_INTEGER);

      nowSpy.mockRestore();

      expect(deletedAtZero).toBe(1);
      expect(deletedAtMax).toBe(0);
      expect(storageAtMax.delete).not.toHaveBeenCalled();
    });
  });
});
