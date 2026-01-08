import { describe, it, expect } from 'vitest';

import { Archive, MapAdapter } from '../../../js/agents/shared/archive/archive.js';
import {
  CHECKPOINT_SCHEMA_VERSION,
  CheckpointType,
  createCheckpoint,
  migrateCheckpoint,
  validateCheckpoint,
} from '../../../js/agents/shared/archive/checkpoint-schema.js';

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
});
