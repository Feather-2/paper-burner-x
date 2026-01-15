import { afterEach, describe, it, expect, vi } from 'vitest';

import { Archive, FallbackAdapter, IndexedDBAdapter, MapAdapter } from '../../../js/agents/shared/archive/archive.js';
import {
  CHECKPOINT_SCHEMA_VERSION,
  CheckpointType,
  createCheckpoint,
  migrateCheckpoint,
  validateCheckpoint,
} from '../../../js/agents/shared/archive/checkpoint-schema.js';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const DAY_MS = 24 * 60 * 60 * 1000;

function withMockedDateNow(fakeNow, fn) {
  const originalNow = Date.now;
  Date.now = () => fakeNow;

  const restore = () => {
    Date.now = originalNow;
  };

  try {
    const result = fn();
    if (result && typeof result.finally === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

function jsonRoundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('checkpoint-schema', () => {
  it('createCheckpoint: builds schema with defaults and merges metadata', () => {
    const checkpoint = withMockedDateNow(123456, () =>
      createCheckpoint({ ok: true }, { runId: 'run_1', iteration: 2, extra: 'x' }),
    );

    expect(checkpoint).toEqual({
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      nodeStates: { ok: true },
      timestamp: 123456,
      metadata: {
        type: CheckpointType.PRE_ACTION,
        runId: 'run_1',
        iteration: 2,
        extra: 'x',
      },
    });
  });

  it('createCheckpoint: respects explicit metadata.type', () => {
    const checkpoint = withMockedDateNow(1, () =>
      createCheckpoint({ ok: true }, { type: CheckpointType.PAUSE }),
    );
    expect(checkpoint.metadata.type).toBe(CheckpointType.PAUSE);
  });

  it('validateCheckpoint: accepts minimal valid shape', () => {
    expect(validateCheckpoint({ schemaVersion: CHECKPOINT_SCHEMA_VERSION, nodeStates: {} })).toBe(true);
  });

  it('validateCheckpoint: rejects invalid payloads', () => {
    expect(validateCheckpoint(null)).toBe(false);
    expect(validateCheckpoint(undefined)).toBe(false);
    expect(validateCheckpoint('nope')).toBe(false);
    expect(validateCheckpoint({})).toBe(false);
    expect(validateCheckpoint({ schemaVersion: CHECKPOINT_SCHEMA_VERSION })).toBe(false);
    expect(validateCheckpoint({ nodeStates: {} })).toBe(false);
    expect(validateCheckpoint({ schemaVersion: '', nodeStates: {} })).toBe(false);
  });

  it('serialize/deserialize: checkpoint stays valid after JSON round-trip', () => {
    const checkpoint = withMockedDateNow(999, () =>
      createCheckpoint(
        { a: 1 },
        { runId: 'run_1', iteration: 3, type: CheckpointType.COMPRESS, extra: { ok: true } },
      ),
    );

    const restored = jsonRoundTrip(checkpoint);
    expect(validateCheckpoint(restored)).toBe(true);
    expect(restored).toMatchObject({
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      nodeStates: { a: 1 },
      timestamp: 999,
      metadata: {
        type: CheckpointType.COMPRESS,
        runId: 'run_1',
        iteration: 3,
        extra: { ok: true },
      },
    });
  });

  it('migrateCheckpoint: returns null for empty input', () => {
    expect(migrateCheckpoint(null)).toBe(null);
    expect(migrateCheckpoint(undefined)).toBe(null);
  });

  it('migrateCheckpoint: returns input when already schemaVersioned', () => {
    const checkpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      nodeStates: { a: 1 },
      timestamp: 1,
      metadata: { type: CheckpointType.PAUSE },
    };
    expect(migrateCheckpoint(checkpoint)).toBe(checkpoint);
  });

  it('migrateCheckpoint: upgrades legacy snapshots without schemaVersion', () => {
    const migrated = withMockedDateNow(654321, () => migrateCheckpoint({ nodeStates: { a: 1 } }));
    expect(migrated).toEqual({
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      nodeStates: { a: 1 },
      timestamp: 654321,
      metadata: { type: CheckpointType.ARCHIVE },
    });
  });

  it('migrateCheckpoint: treats legacy object as nodeStates when missing nodeStates field', () => {
    const migrated = withMockedDateNow(111, () => migrateCheckpoint({ a: 1, b: 2 }));
    expect(migrated).toMatchObject({
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      nodeStates: { a: 1, b: 2 },
      timestamp: 111,
      metadata: { type: CheckpointType.ARCHIVE },
    });
  });

  it('serialize/deserialize: legacy checkpoint can be migrated after JSON round-trip', () => {
    const legacy = {
      nodeStates: { a: 1 },
      timestamp: 123,
      metadata: { type: CheckpointType.PAUSE, ok: true },
    };
    const restoredLegacy = jsonRoundTrip(legacy);
    const migrated = migrateCheckpoint(restoredLegacy);

    expect(validateCheckpoint(migrated)).toBe(true);
    expect(migrated).toEqual({
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      nodeStates: { a: 1 },
      timestamp: 123,
      metadata: { type: CheckpointType.PAUSE, ok: true },
    });
  });
});

describe('Archive', () => {
  it('save: generates checkpointId {runId}:{timestamp}', async () => {
    const archive = new Archive(new MapAdapter());

    const before = Date.now();
    const checkpointId = await archive.save('run_123', { nodeStates: { a: 1 } });
    const after = Date.now();

    expect(checkpointId).toMatch(/^run_123:\d+$/);
    const timestampPart = checkpointId.split(':')[1];
    expect(timestampPart).toBeTruthy();
    const ts = Number(timestampPart);
    expect(Number.isFinite(ts)).toBe(true);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);

    const snapshot = await archive.load(checkpointId);
    expect(snapshot).toEqual({
      nodeStates: { a: 1 },
      timestamp: timestampPart,
      metadata: undefined,
    });

    const explicit = await archive.save('run_123', {
      nodeStates: { b: 2 },
      timestamp: '999',
      metadata: { ok: true },
    });
    expect(explicit).toBe('run_123:999');

    await expect(archive.save('', { nodeStates: {} })).rejects.toThrow(/runId must be a non-empty string/);
    await expect(archive.save('run:bad', { nodeStates: {} })).rejects.toThrow(/must not include ':'/);
  });

  it('save: avoids checkpointId collisions within same millisecond', async () => {
    const archive = new Archive(new MapAdapter());

    const ids = await withMockedDateNow(1234567890, async () => {
      const list = [];
      for (let i = 0; i < 3; i += 1) {
        list.push(await archive.save('run_collision', { nodeStates: { i } }));
      }
      return list;
    });

    expect(ids).toEqual([
      'run_collision:1234567890',
      'run_collision:1234567890-1',
      'run_collision:1234567890-2',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('load: missing key returns null', async () => {
    const archive = new Archive(new MapAdapter());

    await expect(archive.load('run_missing')).resolves.toBe(null);
    await expect(archive.load('run_missing:1')).resolves.toBe(null);

    await archive.save('run_present', { nodeStates: { a: 1 }, timestamp: '100' });
    await archive.save('run_present', { nodeStates: { a: 2 }, timestamp: '200' });
    const latest = await archive.load('run_present');
    expect(latest?.timestamp).toBe('200');
  });

  it('restore: returns full snapshot', async () => {
    const archive = new Archive(new MapAdapter());

    const checkpointId = await archive.save('run_restore', {
      nodeStates: { x: 1 },
      timestamp: '333',
      metadata: { source: 'test' },
    });

    const restored = await archive.restore(checkpointId);
    expect(restored).toEqual({
      nodeStates: { x: 1 },
      timestamp: '333',
      metadata: { source: 'test' },
    });

    await expect(archive.restore('run_restore:missing')).rejects.toThrow(/Checkpoint not found/);
  });

  it('restore: supports checkpointId with counter suffix', async () => {
    const archive = new Archive(new MapAdapter());

    await withMockedDateNow(777, async () => {
      await archive.save('run_restore_counter', { nodeStates: { a: 1 } });
      const checkpointId = await archive.save('run_restore_counter', { nodeStates: { a: 2 } });

      const restored = await archive.restore(checkpointId);
      expect(restored).toEqual({
        nodeStates: { a: 2 },
        timestamp: '777',
        metadata: undefined,
      });
    });
  });

  it('restore: caps in-memory restore cache (LRU)', async () => {
    const archive = new Archive(new MapAdapter(), { restoreCacheMax: 2 });

    const id1 = await archive.save('run_cache', { nodeStates: { v: 1 }, timestamp: '100' });
    const id2 = await archive.save('run_cache', { nodeStates: { v: 2 }, timestamp: '200' });
    const id3 = await archive.save('run_cache', { nodeStates: { v: 3 }, timestamp: '300' });

    await archive.restore(id1);
    await archive.restore(id2);

    expect(archive._restoreCache.size).toBe(2);
    expect(archive._restoreCache.has(id1)).toBe(true);
    expect(archive._restoreCache.has(id2)).toBe(true);

    // Touch id1 so it becomes most recently used; then adding id3 should evict id2.
    await archive.restore(id1);
    await archive.restore(id3);

    expect(archive._restoreCache.size).toBe(2);
    expect(archive._restoreCache.has(id1)).toBe(true);
    expect(archive._restoreCache.has(id3)).toBe(true);
    expect(archive._restoreCache.has(id2)).toBe(false);
  });

  it('listCheckpoints: sorts by timestamp desc', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage);

    await archive.save('run_sort', { nodeStates: { v: 1 }, timestamp: '100' });
    await archive.save('run_sort', { nodeStates: { v: 2 }, timestamp: '200' });
    await storage.set('run_sort:abc', { nodeStates: { v: 3 }, timestamp: 'abc' });
    await storage.set('run_sort:zzz', { nodeStates: { v: 4 }, timestamp: 'zzz' });

    const list = await archive.listCheckpoints('run_sort');
    expect(list.map((entry) => entry.checkpointId)).toEqual([
      'run_sort:200',
      'run_sort:100',
      'run_sort:zzz',
      'run_sort:abc',
    ]);
  });

  it('listCheckpoints: sorts by timestamp and counter desc', async () => {
    const archive = new Archive(new MapAdapter());

    const ids = await withMockedDateNow(1000, async () => {
      const base = await archive.save('run_sort_counter', { nodeStates: { v: 1 } });
      const first = await archive.save('run_sort_counter', { nodeStates: { v: 2 } });
      const second = await archive.save('run_sort_counter', { nodeStates: { v: 3 } });
      const later = await withMockedDateNow(1001, () =>
        archive.save('run_sort_counter', { nodeStates: { v: 4 } }),
      );

      return { base, first, second, later };
    });

    const list = await archive.listCheckpoints('run_sort_counter');
    expect(list.map((entry) => entry.checkpointId)).toEqual([ids.later, ids.second, ids.first, ids.base]);
  });

  it('listCheckpoints: supports numeric and ISO timestamp values via toEpochMs', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage);

    await storage.set('run_time:1', { nodeStates: { n: 1 }, timestamp: 100 });
    await storage.set('run_time:2', { nodeStates: { n: 2 }, timestamp: '2021-01-01T00:00:00.000Z' });
    await storage.set('run_time:3', { nodeStates: { n: 3 }, timestamp: 'not-a-date' });

    const list = await archive.listCheckpoints('run_time');
    expect(list.map((e) => e.checkpointId)).toEqual(['run_time:2', 'run_time:1', 'run_time:3']);
  });

  it('deleteOlderThan: deletes old snapshots', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage);

    await expect(archive.deleteOlderThan(-1)).rejects.toThrow(/days must be a non-negative/);

    const now = Date.now();
    const oldTs = String(now - 8 * DAY_MS);
    const keepTs = String(now - 2 * DAY_MS);

    await archive.save('run_gc', { nodeStates: { old: true }, timestamp: oldTs });
    await archive.save('run_gc', { nodeStates: { keep: true }, timestamp: keepTs });
    await archive.save('run_gc', { nodeStates: { ignore: true }, timestamp: 'bad_ts' });

    // Not a checkpoint id, should be ignored by deleteOlderThan
    await storage.set('misc', { ok: true });
    await storage.set('run_gc:', { nodeStates: { empty: true } });

    const deleted = await archive.deleteOlderThan(7);
    expect(deleted).toBe(1);

    await expect(archive.load(`run_gc:${oldTs}`)).resolves.toBe(null);
    await expect(archive.load(`run_gc:${keepTs}`)).resolves.toBeTruthy();
  });

  it('save: throws after too many collisions', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage);

    await withMockedDateNow(555, async () => {
      await storage.set('run_limit:555', { nodeStates: {} });
      for (let i = 1; i <= 100; i += 1) {
        await storage.set(`run_limit:555-${i}`, { nodeStates: {} });
      }

      await expect(archive.save('run_limit', { nodeStates: {} })).rejects.toThrow(/CHECKPOINT_ID_COLLISION/);
    });
  });

  it('MapAdapter.keys: supports wildcard pattern', async () => {
    const storage = new MapAdapter();

    await storage.set('run_1:1', { ok: 1 });
    await storage.set('run_2:1', { ok: 2 });
    await storage.set('task_1:1', { ok: 3 });

    await expect(storage.keys('run_*')).resolves.toEqual(['run_1:1', 'run_2:1']);
    await expect(storage.keys()).resolves.toEqual(['run_1:1', 'run_2:1', 'task_1:1']);
  });

  it('rejects invalid storage adapter', () => {
    expect(() => new Archive({})).toThrow(/must implement get\/set\/delete\/keys/);
  });

  it('diff: stores patch snapshots and restores full nodeStates', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage, {
      diff: {
        enabled: true,
        fullSnapshotEvery: 100,
        minSavingsBytes: 1,
        maxDepth: 12,
        maxOps: 5000,
      },
    });

    const bigText = 'x'.repeat(20000);
    const first = await archive.save('run_diff', { nodeStates: { bigText, n: 1 }, timestamp: '100' });
    const second = await archive.save('run_diff', { nodeStates: { bigText, n: 2 }, timestamp: '200' });

    const rawSecond = await storage.get(second);
    expect(rawSecond?.encoding).toBe('diff');
    expect(rawSecond?.base).toBe(first);
    expect(Array.isArray(rawSecond?.patch)).toBe(true);

    const restored = await archive.restore(second);
    expect(restored).toEqual({ nodeStates: { bigText, n: 2 }, timestamp: '200', metadata: undefined });
  });

  it('diff: falls back to full snapshots when patch generation fails (unsafe path / ops limit)', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage, {
      diff: {
        enabled: true,
        fullSnapshotEvery: 100,
        // Make diff "always worth it" when it can be computed.
        minSavingsBytes: 1,
        // Keep the safety limits small so we can trigger fallback branches.
        maxDepth: 12,
        maxOps: 1,
      },
    });

    await archive.save('run_diff_fallback_unsafe', { nodeStates: { a: 1, b: 1 }, timestamp: '100' });

    // Trigger "unsafe_path_segment" via an own "__proto__" property.
    const unsafe = Object.create(null);
    unsafe.__proto__ = { polluted: true };
    const id2 = await archive.save('run_diff_fallback_unsafe', { nodeStates: unsafe, timestamp: '200' });
    expect((await storage.get(id2))?.encoding).not.toBe('diff');

    // Trigger "patch_ops_limit" fallback by exceeding maxOps.
    await archive.save('run_diff_fallback_ops', { nodeStates: { a: 1, b: 1 }, timestamp: '300' });
    const id3 = await archive.save('run_diff_fallback_ops', { nodeStates: { a: 2, c: 3 }, timestamp: '400' });
    expect((await storage.get(id3))?.encoding).not.toBe('diff');
  });

  it('restore: diff snapshots missing base/patch degrade to full snapshots', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage);

    await storage.set('run_diff_missing:100', { encoding: 'diff', nodeStates: { a: 1 }, timestamp: '100' });
    await expect(archive.restore('run_diff_missing:100')).resolves.toEqual({
      nodeStates: { a: 1 },
      timestamp: '100',
      metadata: undefined,
    });
  });

  it('restore: supports root-level patch ops and array element ops', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage);

    await storage.set('run_patch:100', { nodeStates: { arr: [1, 2] }, timestamp: '100' });

    // Root add (path="") should also replace the entire nodeStates object.
    await storage.set('run_patch:150', {
      encoding: 'diff',
      base: 'run_patch:100',
      patch: [{ op: 'add', path: '', value: { added: true } }],
      timestamp: '150',
    });
    await expect(archive.restore('run_patch:150')).resolves.toEqual({
      nodeStates: { added: true },
      timestamp: '150',
      metadata: undefined,
    });

    // Root replace (path="") should replace the entire nodeStates object.
    await storage.set('run_patch:200', {
      encoding: 'diff',
      base: 'run_patch:100',
      patch: [{ op: 'replace', path: '', value: { ok: true } }],
      timestamp: '200',
    });
    await expect(archive.restore('run_patch:200')).resolves.toEqual({
      nodeStates: { ok: true },
      timestamp: '200',
      metadata: undefined,
    });

    // Root remove should yield an empty nodeStates object (undefined is normalized to {}).
    await storage.set('run_patch:300', {
      encoding: 'diff',
      base: 'run_patch:100',
      patch: [{ op: 'remove', path: '' }],
      timestamp: '300',
    });
    await expect(archive.restore('run_patch:300')).resolves.toEqual({
      nodeStates: {},
      timestamp: '300',
      metadata: undefined,
    });

    // Patch into an array element (buildJsonPatch() doesn't emit these, but applyJsonPatch supports them).
    await storage.set('run_patch:400', {
      encoding: 'diff',
      base: 'run_patch:100',
      patch: [
        { op: 'replace', path: '/arr/1', value: 99 },
        { op: 'add', path: '/arr/2', value: 3 },
        // Ignore negative index (best-effort).
        { op: 'add', path: '/arr/-1', value: 0 },
        // Ignore non-finite index (best-effort).
        { op: 'add', path: '/arr/nope', value: 0 },
        // Invalid indexes should be ignored (best-effort).
        { op: 'remove', path: '/arr/nope' },
        // Out-of-range remove should be ignored.
        { op: 'remove', path: '/arr/99' },
        // replace with idx>=length should push.
        { op: 'replace', path: '/arr/5', value: 7 },
      ],
      timestamp: '400',
    });
    const restored = await archive.restore('run_patch:400');
    expect(restored.nodeStates.arr).toEqual([1, 99, 3, 7]);
  });

  it('restore: can remove array elements via in-range splice ops', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage);

    await storage.set('run_patch_splice:100', { nodeStates: { arr: [1, 2, 3] }, timestamp: '100' });
    await storage.set('run_patch_splice:200', {
      encoding: 'diff',
      base: 'run_patch_splice:100',
      patch: [{ op: 'remove', path: '/arr/1' }],
      timestamp: '200',
    });

    const restored = await archive.restore('run_patch_splice:200');
    expect(restored.nodeStates.arr).toEqual([1, 3]);
  });

  it('restore: rejects invalid JSON pointer patch paths', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage);

    await storage.set('run_bad_ptr:100', { nodeStates: { a: 1 }, timestamp: '100' });
    await storage.set('run_bad_ptr:200', {
      encoding: 'diff',
      base: 'run_bad_ptr:100',
      patch: [{ op: 'replace', path: 'not-a-pointer', value: { a: 2 } }],
      timestamp: '200',
    });

    await expect(archive.restore('run_bad_ptr:200')).rejects.toThrow(/Invalid JSON pointer/);
  });

  it('restore cache: restoreCacheMax=0 disables caching; Infinity disables pruning', async () => {
    const storage = new MapAdapter();

    const a0 = new Archive(storage, { restoreCacheMax: 0 });
    const id0 = await a0.save('run_cache0', { nodeStates: { a: 1 }, timestamp: '100' });
    await a0.restore(id0);
    expect(a0._restoreCache.size).toBe(0);

    const aInf = new Archive(storage, { restoreCacheMax: Infinity });
    const ids = [
      await aInf.save('run_cache_inf', { nodeStates: { v: 1 }, timestamp: '1' }),
      await aInf.save('run_cache_inf', { nodeStates: { v: 2 }, timestamp: '2' }),
      await aInf.save('run_cache_inf', { nodeStates: { v: 3 }, timestamp: '3' }),
    ];
    for (const id of ids) await aInf.restore(id);
    expect(aInf._restoreCache.size).toBe(3);
  });

  it('MapAdapter.keys: treats regex metacharacters as literals', async () => {
    const storage = new MapAdapter();
    await storage.set('run.1:1', { ok: true });
    await storage.set('runx1:1', { ok: true });

    await expect(storage.keys('run.1:*')).resolves.toEqual(['run.1:1']);
  });

  it('diff: does not store diffs when disabled / fullSnapshotEvery=1 / minSavingsBytes too high', async () => {
    const storage = new MapAdapter();
    const bigText = 'x'.repeat(20000);

    {
      const archive = new Archive(storage, { diff: { enabled: false } });
      await archive.save('run_no_diff_disabled', { nodeStates: { bigText, n: 1 }, timestamp: '100' });
      const second = await archive.save('run_no_diff_disabled', { nodeStates: { bigText, n: 2 }, timestamp: '200' });
      expect((await storage.get(second))?.encoding).not.toBe('diff');
    }

    {
      const archive = new Archive(storage, { diff: { enabled: true, fullSnapshotEvery: 1, minSavingsBytes: 1 } });
      await archive.save('run_no_diff_full_every_1', { nodeStates: { bigText, n: 1 }, timestamp: '100' });
      const second = await archive.save('run_no_diff_full_every_1', { nodeStates: { bigText, n: 2 }, timestamp: '200' });
      expect((await storage.get(second))?.encoding).not.toBe('diff');
    }

    {
      const archive = new Archive(storage, { diff: { enabled: true, fullSnapshotEvery: 100, minSavingsBytes: 999_999_999 } });
      await archive.save('run_no_diff_min_savings', { nodeStates: { bigText, n: 1 }, timestamp: '100' });
      const second = await archive.save('run_no_diff_min_savings', { nodeStates: { bigText, n: 2 }, timestamp: '200' });
      expect((await storage.get(second))?.encoding).not.toBe('diff');
    }
  });

  it('diff: safeJsonSize failures (BigInt) prevent diff snapshots and preserve values', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage, { diff: { enabled: true, fullSnapshotEvery: 100, minSavingsBytes: 1 } });
    const bigText = 'x'.repeat(20000);

    await archive.save('run_bigint', { nodeStates: { bigText, big: 1n }, timestamp: '100' });
    const second = await archive.save('run_bigint', { nodeStates: { bigText, big: 2n }, timestamp: '200' });

    expect((await storage.get(second))?.encoding).not.toBe('diff');

    const restored = await archive.restore(second);
    expect(typeof restored.nodeStates.big).toBe('bigint');
    expect(restored.nodeStates.big).toBe(2n);
  });

  it('diff: encodes/decodes JSON Pointer segments for keys with \"/\" and \"~\" and array replacements', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage, { diff: { enabled: true, fullSnapshotEvery: 100, minSavingsBytes: 1 } });

    const bigText = 'x'.repeat(20000);
    const first = await archive.save('run_ptr', {
      nodeStates: { bigText, 'a/b': 1, 'a~b': 2, arr: [1, 2] },
      timestamp: '100',
    });
    const second = await archive.save('run_ptr', {
      nodeStates: { bigText, 'a/b': 3, 'a~b': 4, arr: [1, 2, 3] },
      timestamp: '200',
    });

    const rawSecond = await storage.get(second);
    expect(rawSecond?.encoding).toBe('diff');
    const paths = Array.isArray(rawSecond?.patch) ? rawSecond.patch.map((op) => op.path) : [];
    expect(paths).toContain('/a~1b');
    expect(paths).toContain('/a~0b');
    expect(paths).toContain('/arr');

    const restored = await archive.restore(second);
    expect(restored.nodeStates['a/b']).toBe(3);
    expect(restored.nodeStates['a~b']).toBe(4);
    expect(restored.nodeStates.arr).toEqual([1, 2, 3]);
  });

  it('safeClone: falls back when structuredClone throws (diff restore still works)', async () => {
    const original = globalThis.structuredClone;
    try {
      // Force safeClone() to take its JSON fallback path.
      vi.stubGlobal('structuredClone', () => {
        throw new Error('no structuredClone');
      });

      const storage = new MapAdapter();
      const archive = new Archive(storage, { diff: { enabled: true, fullSnapshotEvery: 100, minSavingsBytes: 1 } });
      const bigText = 'x'.repeat(20000);

      await archive.save('run_clone', { nodeStates: { bigText, arr: [1, 2] }, timestamp: '100' });
      const second = await archive.save('run_clone', { nodeStates: { bigText, arr: [1, 2, 3] }, timestamp: '200' });
      expect((await storage.get(second))?.encoding).toBe('diff');

      const restored = await archive.restore(second);
      expect(restored.nodeStates.arr).toEqual([1, 2, 3]);
    } finally {
      // Restore for the rest of the suite.
      // eslint-disable-next-line no-global-assign
      globalThis.structuredClone = original;
      vi.unstubAllGlobals();
    }
  });

  it('restore: surfaces patch application errors (unsupported op / unsafe path / missing parent)', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage);

    await storage.set('run_patch_err:100', { nodeStates: { a: 1 }, timestamp: '100' });

    // Unsupported op at root.
    await storage.set('run_patch_err:200', {
      encoding: 'diff',
      base: 'run_patch_err:100',
      patch: [{ op: 'move', path: '', value: { a: 2 } }],
      timestamp: '200',
    });
    await expect(archive.restore('run_patch_err:200')).rejects.toThrow(/Unsupported patch op/);

    // Unsupported op on a non-root path.
    await storage.set('run_patch_err:250', {
      encoding: 'diff',
      base: 'run_patch_err:100',
      patch: [{ op: 'move', path: '/a', value: 2 }],
      timestamp: '250',
    });
    await expect(archive.restore('run_patch_err:250')).rejects.toThrow(/Unsupported patch op/);

    // Unsafe path segment should be rejected.
    await storage.set('run_patch_err:300', {
      encoding: 'diff',
      base: 'run_patch_err:100',
      patch: [{ op: 'replace', path: '/__proto__', value: { polluted: true } }],
      timestamp: '300',
    });
    await expect(archive.restore('run_patch_err:300')).rejects.toThrow(/unsafe_path_segment/);

    // Parent is not an object.
    await storage.set('run_patch_err:350', {
      encoding: 'diff',
      base: 'run_patch_err:100',
      patch: [{ op: 'replace', path: '/a/b', value: 1 }],
      timestamp: '350',
    });
    await expect(archive.restore('run_patch_err:350')).rejects.toThrow(/patch_parent_not_object/);

    // Path traversal hits a non-object before reaching the parent.
    await storage.set('run_patch_err:360', {
      encoding: 'diff',
      base: 'run_patch_err:100',
      patch: [{ op: 'replace', path: '/a/b/c', value: 1 }],
      timestamp: '360',
    });
    await expect(archive.restore('run_patch_err:360')).rejects.toThrow(/patch_path_not_object/);

    // Missing path in parent traversal (a is undefined, then trying to traverse /a/b/c).
    await storage.set('run_patch_err:400', {
      encoding: 'diff',
      base: 'run_patch_err:100',
      patch: [{ op: 'replace', path: '/missing/path/here', value: 1 }],
      timestamp: '400',
    });
    await expect(archive.restore('run_patch_err:400')).rejects.toThrow(/patch_path_missing|patch_parent_not_object/);
  });

  it('diff: stores add/remove ops and restores object key changes', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage, { diff: { enabled: true, fullSnapshotEvery: 100, minSavingsBytes: 1 } });

    const bigText = 'x'.repeat(20000);
    await archive.save('run_add_remove', { nodeStates: { bigText, keep: 1, removeMe: 1 }, timestamp: '100' });
    const second = await archive.save('run_add_remove', { nodeStates: { bigText, keep: 1, added: 2 }, timestamp: '200' });

    const rawSecond = await storage.get(second);
    expect(rawSecond?.encoding).toBe('diff');
    const ops = Array.isArray(rawSecond?.patch) ? rawSecond.patch.map((op) => op.op) : [];
    expect(ops).toContain('remove');
    expect(ops).toContain('add');

    const restored = await archive.restore(second);
    expect(restored.nodeStates.keep).toBe(1);
    expect(restored.nodeStates.added).toBe(2);
    expect(restored.nodeStates.removeMe).toBeUndefined();
  });

  it('diff: replaces non-plain objects (Date) via replace ops', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage, { diff: { enabled: true, fullSnapshotEvery: 100, minSavingsBytes: 1 } });

    const bigText = 'x'.repeat(20000);
    const d1 = new Date('2020-01-01T00:00:00.000Z');
    const d2 = new Date('2021-01-01T00:00:00.000Z');

    await archive.save('run_date', { nodeStates: { bigText, when: d1 }, timestamp: '100' });
    const second = await archive.save('run_date', { nodeStates: { bigText, when: d2 }, timestamp: '200' });

    const rawSecond = await storage.get(second);
    expect(rawSecond?.encoding).toBe('diff');

    const restored = await archive.restore(second);
    expect(restored.nodeStates.when).toBeInstanceOf(Date);
    expect(restored.nodeStates.when.toISOString()).toBe(d2.toISOString());
  });

  it('diff: does not emit replace ops for identical arrays (deepEqualLimited fast-path)', async () => {
    const storage = new MapAdapter();
    const archive = new Archive(storage, { diff: { enabled: true, fullSnapshotEvery: 100, minSavingsBytes: 1 } });

    const bigText = 'x'.repeat(20000);
    await archive.save('run_array_equal', { nodeStates: { bigText, arr: [1, 2], n: 1 }, timestamp: '100' });
    const second = await archive.save('run_array_equal', { nodeStates: { bigText, arr: [1, 2], n: 2 }, timestamp: '200' });

    const rawSecond = await storage.get(second);
    expect(rawSecond?.encoding).toBe('diff');
    const paths = Array.isArray(rawSecond?.patch) ? rawSecond.patch.map((op) => op.path) : [];
    expect(paths).not.toContain('/arr');
  });

  it('_getLatestCheckpointId: tolerates listCheckpoints errors (best-effort)', async () => {
    const storage = {
      get: async () => null,
      set: async () => true,
      delete: async () => true,
      keys: async () => {
        throw new Error('boom');
      },
    };

    const archive = new Archive(storage, { diff: { enabled: true, fullSnapshotEvery: 100, minSavingsBytes: 1 } });
    await expect(archive.save('run_latest_fallback', { nodeStates: { a: 1 }, timestamp: '100' })).resolves.toMatch(/^run_latest_fallback:/);
  });
});

describe('archive adapters', () => {
  it('FallbackAdapter: logs a warning and uses MapAdapter when IndexedDB is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = globalThis.indexedDB;

    try {
      // Ensure primary adapter creation fails.
      // (In node, indexedDB is typically undefined already.)
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = undefined;

      const adapter = new FallbackAdapter('db_unavailable', 'store_unavailable');
      await expect(adapter.set('k', { a: 1 })).resolves.toBe(true);
      await expect(adapter.get('k')).resolves.toEqual({ a: 1 });

      // Once degraded, it should not warn again.
      await expect(adapter.set('k2', { b: 2 })).resolves.toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = original;
    }
  });

  it('IndexedDBAdapter: can retry after an init failure and perform basic operations', async () => {
    const original = globalThis.indexedDB;
    const dbName = `vitest_archive_${Math.random().toString(16).slice(2)}`;
    const storeName = 'checkpoints';

    try {
      // 1) Init failure path (IndexedDB not available) should reset _initPromise, allowing retry.
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = undefined;

      const adapter = new IndexedDBAdapter(dbName, storeName);
      await expect(adapter.get('missing')).rejects.toThrow(/IndexedDB not available/);

      // 2) Retry with a working IndexedDB implementation.
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = fakeIndexedDB;

      // _ensureDb should reuse the in-flight init promise.
      const [db1, db2] = await Promise.all([adapter._ensureDb(), adapter._ensureDb()]);
      expect(db1).toBe(db2);

      await expect(adapter.set('a', { v: 1 })).resolves.toBe(true);
      await expect(adapter.set('b', { v: 2 })).resolves.toBe(true);
      await expect(adapter.get('a')).resolves.toEqual({ v: 1 });

      await expect(adapter.keys('*')).resolves.toEqual(['a', 'b']);
      await expect(adapter.keys('a*')).resolves.toEqual(['a']);
      await expect(adapter.keys()).resolves.toEqual(['a', 'b']);

      await expect(adapter.delete('a')).resolves.toBe(true);
      await expect(adapter.get('a')).resolves.toBe(null);

      await expect(adapter.clear()).resolves.toBe(true);
      await expect(adapter.keys('*')).resolves.toEqual([]);

      adapter.close();
      // close() should be idempotent.
      adapter.close();
    } finally {
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = original;
    }
  });

  it('FallbackAdapter: uses IndexedDBAdapter when IndexedDB is available', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = globalThis.indexedDB;

    try {
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = fakeIndexedDB;

      const dbName = `vitest_fallback_primary_${Math.random().toString(16).slice(2)}`;
      const adapter = new FallbackAdapter(dbName, 'checkpoints');
      await expect(adapter.set('k', { ok: true })).resolves.toBe(true);
      await expect(adapter.get('k')).resolves.toEqual({ ok: true });

      expect(warn).not.toHaveBeenCalled();
      expect(adapter._useFallback).toBe(false);
      expect(adapter._primary).toBeTruthy();
    } finally {
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = original;
    }
  });

  it('FallbackAdapter: reuses an existing primary adapter even if indexedDB later disappears', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = globalThis.indexedDB;

    try {
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = fakeIndexedDB;

      const dbName = `vitest_fallback_reuse_${Math.random().toString(16).slice(2)}`;
      const adapter = new FallbackAdapter(dbName, 'checkpoints');
      await expect(adapter.set('k', { ok: 1 })).resolves.toBe(true);

      // Now remove indexedDB; _ensureAdapter() should return the cached primary adapter.
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = undefined;
      await expect(adapter.get('k')).resolves.toEqual({ ok: 1 });

      expect(adapter._useFallback).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      // eslint-disable-next-line no-global-assign
      globalThis.indexedDB = original;
    }
  });
});
