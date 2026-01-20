// Unit tests for run-store-crud exports with mocked storage utilities and boundary coverage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
}));

const utilsMocks = vi.hoisted(() => ({
  STORE_RUNS: 'runs',
  STORE_ARTIFACTS: 'artifacts',
  STORE_EVENTS: 'events',
  STORE_COUNTERS: 'counters',
  deleteByIndexKey: vi.fn(),
  encodeUtf8Bytes: vi.fn(),
  getLastByCompoundIndex: vi.fn(),
  promisifyRequest: vi.fn(),
  promisifyTransaction: vi.fn(),
  toISO: vi.fn(),
}));

vi.mock('../../../../js/agents/shared/index.js', () => ({
  isPlainObject: sharedMocks.isPlainObject,
}));

vi.mock('../../../../js/agents/storage/run-store-utils.js', () => ({
  STORE_RUNS: utilsMocks.STORE_RUNS,
  STORE_ARTIFACTS: utilsMocks.STORE_ARTIFACTS,
  STORE_EVENTS: utilsMocks.STORE_EVENTS,
  STORE_COUNTERS: utilsMocks.STORE_COUNTERS,
  deleteByIndexKey: utilsMocks.deleteByIndexKey,
  encodeUtf8Bytes: utilsMocks.encodeUtf8Bytes,
  getLastByCompoundIndex: utilsMocks.getLastByCompoundIndex,
  promisifyRequest: utilsMocks.promisifyRequest,
  promisifyTransaction: utilsMocks.promisifyTransaction,
  toISO: utilsMocks.toISO,
}));

async function loadCrud() {
  return await import('../../../../js/agents/storage/run-store-crud.js');
}

function makeDbWithStores(storeNames) {
  const storeMap = new Map();
  for (const name of storeNames) {
    storeMap.set(name, {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    });
  }
  const tx = {
    objectStore: vi.fn((name) => storeMap.get(name)),
  };
  const db = {
    transaction: vi.fn(() => tx),
  };
  return { db, tx, storeMap };
}

beforeEach(() => {
  vi.resetAllMocks();
  sharedMocks.isPlainObject.mockImplementation(
    (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  );
  utilsMocks.promisifyRequest.mockImplementation(async (req) => req);
  utilsMocks.promisifyTransaction.mockResolvedValue(undefined);
  utilsMocks.toISO.mockReturnValue('2024-01-01T00:00:00.000Z');
  utilsMocks.deleteByIndexKey.mockResolvedValue(undefined);
  utilsMocks.encodeUtf8Bytes.mockImplementation((text) => (typeof text === 'string' ? text.length : 0));
  utilsMocks.getLastByCompoundIndex.mockResolvedValue(null);

  vi.stubGlobal('IDBKeyRange', {
    only: vi.fn((value) => ({ only: value })),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveTask', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'nope'],
    ['number 0', 0],
    ['number -1', -1],
  ])('throws for invalid task values (%s)', async (_label, task) => {
    const { saveTask } = await loadCrud();
    await expect(saveTask.call({}, task)).rejects.toThrow(/task must be an object/i);
  });

  it.each([
    ['empty object', {}],
    ['empty array', []],
    ['empty string', { taskId: '' }],
    ['number 0', { taskId: 0 }],
    ['number -1', { taskId: -1 }],
    ['MAX_SAFE_INTEGER', { taskId: Number.MAX_SAFE_INTEGER }],
  ])('throws for invalid taskId (%s)', async (_label, task) => {
    const { saveTask } = await loadCrud();
    await expect(saveTask.call({}, task)).rejects.toThrow(/task\.taskId must be a string/i);
  });

  it('stores tasks via storage adapter with deep payloads', async () => {
    const { saveTask } = await loadCrud();
    const storage = { set: vi.fn(async () => {}) };
    const ctx = {
      storage,
      _keyForTask: vi.fn((taskId) => `task:${taskId}`),
      saveArtifact: vi.fn(),
    };

    const longText = 'x'.repeat(100_000);
    const task = {
      taskId: 'task_big',
      meta: { nested: { level: { depth: 3 } } },
      payload: longText,
    };

    await saveTask.call(ctx, task);

    expect(storage.set).toHaveBeenCalledWith('task:task_big', expect.any(String));
    const storedValue = storage.set.mock.calls[0][1];
    expect(storedValue.length).toBeGreaterThan(longText.length);
    expect(ctx.saveArtifact).not.toHaveBeenCalled();
  });

  it('falls back to saveArtifact when no storage adapter exists', async () => {
    const { saveTask } = await loadCrud();
    const saveArtifact = vi.fn(async () => 'art_task');
    const ctx = { saveArtifact };
    const task = { taskId: 'task_1', title: 'hello' };

    await saveTask.call(ctx, task);

    expect(saveArtifact).toHaveBeenCalledWith('task_1', 'task.json', task, {
      artifactId: 'task_task_1',
      storageKey: 'runs/task_1/task.json',
      seq: 1,
      mime: 'application/json',
    });
  });
});

describe('saveState', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['number 0', 0],
    ['number -1', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
  ])('throws for invalid runId (%s)', async (_label, runId) => {
    const { saveState } = await loadCrud();
    await expect(saveState.call({}, runId, { ok: true })).rejects.toThrow(/runId must be a string/i);
  });

  it('uses state.toJSON in adapter mode and accepts numeric-like runId', async () => {
    const { saveState } = await loadCrud();
    const storage = { set: vi.fn(async () => {}) };
    const ctx = {
      storage,
      _keyForState: vi.fn((id) => `state:${id}`),
      saveArtifact: vi.fn(),
    };
    const state = { ok: true, toJSON: () => ({ ok: true, json: true }) };

    await saveState.call(ctx, '123', state);

    expect(storage.set).toHaveBeenCalledWith('state:123', JSON.stringify({ ok: true, json: true }));
    expect(ctx.saveArtifact).not.toHaveBeenCalled();
  });

  it('saves via saveArtifact when no storage adapter exists', async () => {
    const { saveState } = await loadCrud();
    const saveArtifact = vi.fn(async () => 'art_state');
    const ctx = { saveArtifact };
    const state = { ready: true };

    await saveState.call(ctx, 'run_1', state);

    expect(saveArtifact).toHaveBeenCalledWith('run_1', 'state.json', state, {
      artifactId: 'state_run_1',
      storageKey: 'runs/run_1/state.json',
      seq: 1,
      mime: 'application/json',
    });
  });

  it('handles long runIds and large nested payloads', async () => {
    const { saveState } = await loadCrud();
    const storage = { set: vi.fn(async () => {}) };
    const ctx = {
      storage,
      _keyForState: vi.fn((id) => `state:${id}`),
      saveArtifact: vi.fn(),
    };

    const longRunId = `run_${'x'.repeat(2048)}`;
    const hugeText = 'y'.repeat(1_000_000);
    const state = { level1: { level2: { level3: { payload: hugeText } } } };

    await saveState.call(ctx, longRunId, state);

    expect(storage.set).toHaveBeenCalledWith(`state:${longRunId}`, expect.any(String));
    const storedValue = storage.set.mock.calls[0][1];
    expect(storedValue.length).toBeGreaterThan(hugeText.length);
  });
});

describe('createRun', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['empty runId', { runId: '' }],
    ['runId number 0', { runId: 0 }],
    ['runId number -1', { runId: -1 }],
    ['runId MAX_SAFE_INTEGER', { runId: Number.MAX_SAFE_INTEGER }],
  ])('throws for invalid runContext (%s)', async (_label, runContext) => {
    const { createRun } = await loadCrud();
    await expect(createRun.call({}, runContext)).rejects.toThrow(/runContext\.runId must be a string/i);
  });

  it('stores run context and returns runId', async () => {
    const { createRun } = await loadCrud();
    const { db, storeMap } = makeDbWithStores([utilsMocks.STORE_RUNS]);
    const ctx = { open: vi.fn(async () => db) };
    const runContext = { runId: 'run_1', mode: 'test' };

    const runId = await createRun.call(ctx, runContext);

    expect(runId).toBe('run_1');
    expect(db.transaction).toHaveBeenCalledWith(['runs'], 'readwrite');
    const store = storeMap.get('runs');
    expect(store.put).toHaveBeenCalledWith({
      runId: 'run_1',
      runContext,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      manifest: null,
    });
    expect(utilsMocks.promisifyTransaction).toHaveBeenCalled();
  });

  it('wraps non-plain runContext values from toJSON', async () => {
    const { createRun } = await loadCrud();
    const { db, storeMap } = makeDbWithStores([utilsMocks.STORE_RUNS]);
    const ctx = { open: vi.fn(async () => db) };

    const arrayContext = Object.assign(['a'], { runId: 'run_arr' });
    const runContext = { toJSON: () => arrayContext };

    const runId = await createRun.call(ctx, runContext);

    expect(runId).toBe('run_arr');
    const store = storeMap.get('runs');
    expect(store.put).toHaveBeenCalledWith({
      runId: 'run_arr',
      runContext: { value: arrayContext },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      manifest: null,
    });
  });
});

describe('updateRunContext', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['number 0', 0],
    ['number -1', -1],
  ])('throws for invalid runId (%s)', async (_label, runId) => {
    const { updateRunContext } = await loadCrud();
    await expect(updateRunContext.call({}, runId, { ok: true })).rejects.toThrow(/non-empty string/i);
  });

  it('throws when storage adapter is present', async () => {
    const { updateRunContext } = await loadCrud();
    const ctx = { storage: {}, open: vi.fn() };

    await expect(updateRunContext.call(ctx, 'run_1', { ok: true })).rejects.toThrow(/not supported/i);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'no'],
    ['number 0', 0],
  ])('throws for invalid patch (%s)', async (_label, patch) => {
    const { updateRunContext } = await loadCrud();
    await expect(updateRunContext.call({ open: vi.fn() }, 'run_1', patch)).rejects.toThrow(/patch must be an object/i);
  });

  it('throws when run is not found', async () => {
    const { updateRunContext } = await loadCrud();
    const { db, tx, storeMap } = makeDbWithStores([utilsMocks.STORE_RUNS]);
    const store = storeMap.get('runs');
    store.get.mockReturnValue(null);
    const ctx = { open: vi.fn(async () => db) };

    await expect(updateRunContext.call(ctx, 'run_1', { ok: true })).rejects.toThrow(/run not found/i);
    expect(utilsMocks.promisifyTransaction).toHaveBeenCalledWith(tx);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('merges patches and preserves runId', async () => {
    const { updateRunContext } = await loadCrud();
    const { db, storeMap } = makeDbWithStores([utilsMocks.STORE_RUNS]);
    const store = storeMap.get('runs');
    const existing = {
      runId: 'run_1',
      runContext: { runId: 'run_1', title: 'old', count: 1 },
      createdAt: 't1',
      updatedAt: 't1',
    };
    store.get.mockReturnValue(existing);
    const ctx = { open: vi.fn(async () => db) };

    const merged = await updateRunContext.call(ctx, ' run_1 ', { title: 'new', runId: 'evil' });

    expect(store.get).toHaveBeenCalledWith('run_1');
    expect(merged).toEqual({ runId: 'run_1', title: 'new', count: 1 });
    const putRecord = store.put.mock.calls[0][0];
    expect(putRecord.runContext).toEqual(merged);
    expect(putRecord.updatedAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('replaces runContext when replace is true and sets runId', async () => {
    const { updateRunContext } = await loadCrud();
    const { db, storeMap } = makeDbWithStores([utilsMocks.STORE_RUNS]);
    const store = storeMap.get('runs');
    const existing = {
      runId: 'run_1',
      runContext: { runId: 'run_1', title: 'old' },
      createdAt: 't1',
      updatedAt: 't1',
    };
    store.get.mockReturnValue(existing);
    const ctx = { open: vi.fn(async () => db) };

    const merged = await updateRunContext.call(ctx, 'run_1', { only: true }, { replace: true });

    expect(merged).toEqual({ runId: 'run_1', only: true });
    expect(store.put).toHaveBeenCalledWith({
      ...existing,
      runContext: merged,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('accepts array patches and wraps non-plain contexts', async () => {
    const { updateRunContext } = await loadCrud();
    const { db, storeMap } = makeDbWithStores([utilsMocks.STORE_RUNS]);
    const store = storeMap.get('runs');
    const existing = {
      runId: 'run_1',
      runContext: 'legacy',
      createdAt: 't1',
      updatedAt: 't1',
    };
    store.get.mockReturnValue(existing);
    const ctx = { open: vi.fn(async () => db) };

    const merged = await updateRunContext.call(ctx, 'run_1', []);

    expect(merged).toEqual({ runId: 'run_1', value: [] });
    expect(store.put).toHaveBeenCalledWith({
      ...existing,
      runContext: merged,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });
});

describe('deleteRun', () => {
  it('deletes run data and related indexed records', async () => {
    const { deleteRun } = await loadCrud();
    const { db, tx, storeMap } = makeDbWithStores([
      utilsMocks.STORE_RUNS,
      utilsMocks.STORE_ARTIFACTS,
      utilsMocks.STORE_EVENTS,
      utilsMocks.STORE_COUNTERS,
    ]);
    const ctx = { open: vi.fn(async () => db) };
    const runId = 'run_del';

    await deleteRun.call(ctx, runId);

    expect(db.transaction).toHaveBeenCalledWith(['runs', 'artifacts', 'events', 'counters'], 'readwrite');
    expect(storeMap.get('runs').delete).toHaveBeenCalledWith(runId);
    expect(globalThis.IDBKeyRange.only).toHaveBeenCalledWith(runId);
    expect(utilsMocks.deleteByIndexKey).toHaveBeenCalledWith(storeMap.get('artifacts'), 'byRunId', { only: runId });
    expect(utilsMocks.deleteByIndexKey).toHaveBeenCalledWith(storeMap.get('events'), 'byRunId', { only: runId });
    expect(utilsMocks.deleteByIndexKey).toHaveBeenCalledWith(storeMap.get('counters'), 'byRunId', { only: runId });
    expect(utilsMocks.promisifyTransaction).toHaveBeenCalledWith(tx);
  });
});

describe('appendEvent', () => {
  it.each([
    ['null', null, /event must be an object/i],
    ['undefined', undefined, /event must be an object/i],
    ['empty array', [], /event\.eventId must be a string/i],
    ['empty object', {}, /event\.eventId must be a string/i],
    ['numeric eventId', { eventId: 0 }, /event\.eventId must be a string/i],
  ])('throws for invalid events (%s)', async (_label, event, errorPattern) => {
    const { appendEvent } = await loadCrud();
    await expect(appendEvent.call({}, 'run_1', event)).rejects.toThrow(errorPattern);
  });

  it('stores events and overrides mismatched runId', async () => {
    const { appendEvent } = await loadCrud();
    const { db, storeMap } = makeDbWithStores([utilsMocks.STORE_EVENTS]);
    const store = storeMap.get('events');
    const ctx = { open: vi.fn(async () => db) };
    const event = { eventId: 'evt_1', runId: 'other', payload: { ok: true } };

    const eventId = await appendEvent.call(ctx, 'run_1', event);

    expect(eventId).toBe('evt_1');
    const stored = store.put.mock.calls[0][0];
    expect(stored).toEqual({ ...event, runId: 'run_1' });
    expect(stored).not.toBe(event);
  });

  it('keeps the same event object when runId matches', async () => {
    const { appendEvent } = await loadCrud();
    const { db, storeMap } = makeDbWithStores([utilsMocks.STORE_EVENTS]);
    const store = storeMap.get('events');
    const ctx = { open: vi.fn(async () => db) };
    const event = { eventId: 'evt_2', runId: 'run_1', payload: 'ok' };

    await appendEvent.call(ctx, 'run_1', event);

    expect(store.put).toHaveBeenCalledWith(event);
  });

  it('handles concurrent appends', async () => {
    const { appendEvent } = await loadCrud();
    const { db, storeMap } = makeDbWithStores([utilsMocks.STORE_EVENTS]);
    const store = storeMap.get('events');
    const ctx = { open: vi.fn(async () => db) };

    const results = await Promise.all([
      appendEvent.call(ctx, 'run_1', { eventId: 'evt_a', runId: 'run_1' }),
      appendEvent.call(ctx, 'run_1', { eventId: 'evt_b', runId: 'other' }),
    ]);

    expect(results).toEqual(['evt_a', 'evt_b']);
    expect(store.put).toHaveBeenCalledTimes(2);
  });

  it('handles rapid sequential appends with large payloads', async () => {
    const { appendEvent } = await loadCrud();
    const { db, storeMap } = makeDbWithStores([utilsMocks.STORE_EVENTS]);
    const store = storeMap.get('events');
    const ctx = { open: vi.fn(async () => db) };
    const bigPayload = 'z'.repeat(1_000_000);

    for (const eventId of ['evt_1', 'evt_2', 'evt_3']) {
      await appendEvent.call(ctx, 'run_1', { eventId, runId: 'run_1', payload: bigPayload });
    }

    expect(store.put).toHaveBeenCalledTimes(3);
    expect(store.put.mock.calls[0][0].payload.length).toBe(bigPayload.length);
  });
});
