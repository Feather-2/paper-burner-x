import { describe, it, expect, vi, beforeEach } from 'vitest';

const syncClockMock = vi.hoisted(() => vi.fn());
const currentSeqMock = vi.hoisted(() => vi.fn());
const cloneJsonMock = vi.hoisted(() =>
  vi.fn((value) => {
    if (value === null || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  })
);
const buildStatePatchMock = vi.hoisted(() => vi.fn());
const generateIdMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../js/agents/core/lamport-clock.js', () => ({
  sync: syncClockMock,
  currentSeq: currentSeqMock,
}));

vi.mock('../../../../../js/agents/plugins/memory/state-diff.js', () => ({
  cloneJson: cloneJsonMock,
  buildStatePatch: buildStatePatchMock,
}));

vi.mock('../../../../../js/agents/plugins/memory/action-types.js', () => ({
  L3_ADD_CHECKPOINT: 'L3_ADD_CHECKPOINT',
}));

vi.mock('../../../../../js/agents/plugins/memory/state-engine.utils.js', () => ({
  generateId: generateIdMock,
}));

import {
  createSnapshot,
  restoreSnapshot,
  saveCheckpoint,
  restoreCheckpoint,
} from '../../../../../js/agents/plugins/memory/state-engine.persistence.js';
import { L3_ADD_CHECKPOINT } from '../../../../../js/agents/plugins/memory/action-types.js';

const buildDeepState = (depth) => {
  let node = { value: 'leaf' };
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, child: node };
  }
  return node;
};

const makeEngine = (state = { runId: 'run-1', L3: { checkpoints: [] } }) => {
  const engine = {
    _state: state,
    _checkpoints: new Map(),
    _actorId: 'actor-0',
    dispatchSync: vi.fn(),
  };

  engine.dispatchSync.mockImplementation((action) => {
    if (action?.type !== L3_ADD_CHECKPOINT) return;
    if (!engine._state.L3 || typeof engine._state.L3 !== 'object') {
      engine._state.L3 = {};
    }
    if (!Array.isArray(engine._state.L3.checkpoints)) {
      engine._state.L3.checkpoints = [];
    }
    engine._state.L3.checkpoints.push(action.payload.checkpoint);
  });

  return engine;
};

beforeEach(() => {
  vi.clearAllMocks();
  currentSeqMock.mockReturnValue(1);
  generateIdMock.mockReturnValue('cp-1');
  buildStatePatchMock.mockReturnValue([{ op: 'replace', path: ['value'], value: 'patched' }]);
});

describe('createSnapshot', () => {
  it('creates snapshot with cloned state, clock, and timestamp', () => {
    currentSeqMock.mockReturnValue(42);
    const state = { runId: 'run-1', data: { count: 1 } };

    const snapshot = createSnapshot(state);

    expect(snapshot.clock).toBe(42);
    expect(typeof snapshot.ts).toBe('number');
    expect(snapshot.state).toEqual(state);
    expect(snapshot.state).not.toBe(state);

    state.data.count = 2;
    expect(snapshot.state.data.count).toBe(1);
    expect(cloneJsonMock).toHaveBeenCalledWith(state);
  });

  it('handles nullish, empty, whitespace, and boundary numeric states', () => {
    currentSeqMock.mockReturnValue(0);
    const emptyArray = [];
    const emptyObject = {};
    const cases = [
      null,
      undefined,
      '',
      '   ',
      emptyArray,
      emptyObject,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
    ];

    const snapshots = cases.map((value) => createSnapshot(value));

    expect(snapshots.map((snapshot) => snapshot.state)).toEqual(cases);
    expect(snapshots.every((snapshot) => snapshot.clock === 0)).toBe(true);
    expect(snapshots.every((snapshot) => typeof snapshot.ts === 'number')).toBe(true);
    expect(snapshots[4].state).not.toBe(emptyArray);
    expect(snapshots[5].state).not.toBe(emptyObject);
    expect(cloneJsonMock).toHaveBeenCalledTimes(cases.length);
  });

  it('supports rapid consecutive snapshots for large and deep states', async () => {
    currentSeqMock.mockReturnValueOnce(1).mockReturnValueOnce(2);
    const hugeString = 'x'.repeat(100000);
    const largeState = { text: hugeString, items: [1, 2, 3] };
    const deepState = buildDeepState(40);

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => createSnapshot(largeState)),
      Promise.resolve().then(() => createSnapshot(deepState)),
    ]);

    expect(first.clock).toBe(1);
    expect(second.clock).toBe(2);
    expect(first.state).toEqual(largeState);
    expect(second.state).toEqual(deepState);
    expect(first.state).not.toBe(largeState);
    expect(second.state).not.toBe(deepState);
  });
});

describe('restoreSnapshot', () => {
  it('restores state and syncs clock when snapshot is valid', () => {
    const engine = makeEngine({ runId: 'run-1', L3: { checkpoints: [] }, value: 1 });
    const snapshotState = { runId: 'run-2', value: { count: 2 } };

    const result = restoreSnapshot(engine, { version: 1, state: snapshotState, clock: 9 });

    expect(result).toBe(true);
    expect(engine._state).toEqual(snapshotState);
    expect(engine._state).not.toBe(snapshotState);
    expect(engine._actorId).toBe('run-2');
    expect(syncClockMock).toHaveBeenCalledWith(9);
  });

  it('returns false for missing or falsy snapshot state', () => {
    const engine = makeEngine({ runId: 'run-1', L3: { checkpoints: [] }, value: 1 });
    const originalState = engine._state;
    const cases = [null, undefined, {}, { state: null }, { state: undefined }, { state: '' }, { state: 0 }];

    const results = cases.map((snapshot) => restoreSnapshot(engine, snapshot));

    expect(results).toEqual(cases.map(() => false));
    expect(engine._state).toBe(originalState);
    expect(syncClockMock).not.toHaveBeenCalled();
  });

  it('restores empty object state without syncing when clock is missing', () => {
    const engine = makeEngine({ runId: 'run-1', L3: { checkpoints: [] } });

    const result = restoreSnapshot(engine, { version: 1, state: {} });

    expect(result).toBe(true);
    expect(engine._state).toEqual({});
    expect(syncClockMock).not.toHaveBeenCalled();
  });

  it('does not sync clock when clock is non-numeric and restores whitespace state', () => {
    const engine = makeEngine({ runId: 'run-1', L3: { checkpoints: [] } });
    engine._actorId = 'actor-keep';

    const result = restoreSnapshot(engine, { version: 1, state: '   ', clock: '12' });

    expect(result).toBe(true);
    expect(engine._state).toBe('   ');
    expect(engine._actorId).toBe('actor-keep');
    expect(syncClockMock).not.toHaveBeenCalled();
  });

  it('handles rapid consecutive restores with numeric clocks', async () => {
    const engine = makeEngine({ runId: 'run-1', L3: { checkpoints: [] } });
    const first = { version: 1, state: { runId: 'run-a', value: 1 }, clock: 1 };
    const second = { version: 1, state: { runId: 'run-b', value: 2 }, clock: 2 };

    await Promise.all([
      Promise.resolve().then(() => restoreSnapshot(engine, first)),
      Promise.resolve().then(() => restoreSnapshot(engine, second)),
    ]);

    expect(engine._state).toEqual(second.state);
    expect(engine._actorId).toBe('run-b');
    expect(syncClockMock).toHaveBeenCalledTimes(2);
  });
});

describe('saveCheckpoint', () => {
  it('creates a full checkpoint when no prior checkpoints exist', () => {
    const hugeString = 'x'.repeat(100000);
    const state = {
      runId: 'run-1',
      payload: hugeString,
      nested: buildDeepState(20),
      L3: { checkpoints: [] },
    };
    const engine = makeEngine(state);
    currentSeqMock.mockReturnValue(7);
    generateIdMock.mockReturnValue('cp-1');
    const preSaveState = JSON.parse(JSON.stringify(state));

    const checkpoint = saveCheckpoint(engine);

    expect(checkpoint.checkpointId).toBe('cp-1');
    expect(checkpoint.encoding).toBe('full');
    expect(checkpoint.clock).toBe(7);
    expect(checkpoint.data).toEqual(preSaveState);
    expect(checkpoint.data).not.toBe(state);
    expect(engine._checkpoints.get('cp-1').data).toEqual(preSaveState);
    expect(engine._checkpoints.get('cp-1').data).not.toBe(state);
    expect(buildStatePatchMock).not.toHaveBeenCalled();
    expect(engine._state.L3.checkpoints).toHaveLength(1);

    const dispatched = engine.dispatchSync.mock.calls[0][0];
    expect(dispatched.type).toBe(L3_ADD_CHECKPOINT);
    expect(dispatched.payload.checkpoint.checkpointId).toBe('cp-1');
    expect(dispatched.payload.checkpoint.encoding).toBe('full');
    expect(dispatched.payload.checkpoint.baseId).toBe(undefined);
    expect(dispatched.payload.checkpoint.ts).toBe(checkpoint.ts);
    expect(dispatched.payload.checkpoint.clock).toBe(checkpoint.clock);
  });

  it('creates a diff checkpoint when base exists and fullSnapshotEvery is a string', () => {
    const baseState = { runId: 'run-1', value: 1, L3: { checkpoints: [] } };
    const engine = makeEngine({
      runId: 'run-1',
      value: 2,
      L3: { checkpoints: [{ checkpointId: 'cp-0' }] },
    });
    engine._checkpoints.set('cp-0', { data: baseState });
    const patch = [{ op: 'replace', path: ['value'], value: 2 }];
    buildStatePatchMock.mockReturnValue(patch);
    generateIdMock.mockReturnValue('cp-1');
    currentSeqMock.mockReturnValue(Number.MAX_SAFE_INTEGER);
    const preSaveState = JSON.parse(JSON.stringify(engine._state));

    const checkpoint = saveCheckpoint(engine, { fullSnapshotEvery: '2' });

    expect(checkpoint.encoding).toBe('diff');
    expect(checkpoint.baseId).toBe('cp-0');
    expect(checkpoint.patch).toEqual(patch);
    expect(checkpoint.data).toBe(undefined);
    expect(checkpoint.clock).toBe(Number.MAX_SAFE_INTEGER);
    expect(buildStatePatchMock).toHaveBeenCalledWith(baseState, engine._state);

    const stored = engine._checkpoints.get('cp-1');
    expect(stored.data).toEqual(preSaveState);
    expect(stored.data).not.toBe(engine._state);

    const dispatchPayload = engine.dispatchSync.mock.calls[0][0].payload.checkpoint;
    expect(dispatchPayload.baseId).toBe('cp-0');
    expect(dispatchPayload.encoding).toBe('diff');
  });

  it('falls back to full checkpoint when base state is missing and fullSnapshotEvery is 0', () => {
    const engine = makeEngine({
      runId: 'run-1',
      value: 1,
      L3: { checkpoints: [{ checkpointId: 'cp-missing' }] },
    });
    const preSaveState = JSON.parse(JSON.stringify(engine._state));

    const checkpoint = saveCheckpoint(engine, { fullSnapshotEvery: 0 });

    expect(checkpoint.encoding).toBe('full');
    expect(checkpoint.data).toEqual(preSaveState);
    expect(buildStatePatchMock).not.toHaveBeenCalled();
  });

  it('forces full checkpoint when fullSnapshotEvery is negative', () => {
    const engine = makeEngine({
      runId: 'run-1',
      value: 2,
      L3: { checkpoints: [{ checkpointId: 'cp-0' }] },
    });
    engine._checkpoints.set('cp-0', { data: { runId: 'run-1', value: 1, L3: { checkpoints: [] } } });
    const preSaveState = JSON.parse(JSON.stringify(engine._state));

    const checkpoint = saveCheckpoint(engine, { fullSnapshotEvery: -1 });

    expect(checkpoint.encoding).toBe('full');
    expect(checkpoint.data).toEqual(preSaveState);
    expect(buildStatePatchMock).not.toHaveBeenCalled();
  });

  it('handles non-array checkpoint lists as a type boundary', () => {
    const engine = makeEngine({ runId: 'run-1', value: 1, L3: { checkpoints: {} } });

    const checkpoint = saveCheckpoint(engine);

    expect(checkpoint.encoding).toBe('full');
    expect(Array.isArray(engine._state.L3.checkpoints)).toBe(true);
    expect(engine._state.L3.checkpoints).toHaveLength(1);
  });

  it('supports rapid consecutive checkpoint saves without shared state', async () => {
    const engine = makeEngine({ runId: 'run-1', value: 1, L3: { checkpoints: [] } });
    generateIdMock.mockReturnValueOnce('cp-1').mockReturnValueOnce('cp-2');
    currentSeqMock.mockReturnValueOnce(1).mockReturnValueOnce(2);

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => saveCheckpoint(engine, { fullSnapshotEvery: 1 })),
      Promise.resolve().then(() => saveCheckpoint(engine, { fullSnapshotEvery: 1 })),
    ]);

    expect(first.checkpointId).toBe('cp-1');
    expect(second.checkpointId).toBe('cp-2');
    expect(engine._checkpoints.size).toBe(2);
    expect(engine._state.L3.checkpoints).toHaveLength(2);
    expect(engine.dispatchSync).toHaveBeenCalledTimes(2);
    expect(buildStatePatchMock).not.toHaveBeenCalled();
  });
});

describe('restoreCheckpoint', () => {
  it('restores from checkpoint and preserves the checkpoint log', () => {
    const engine = makeEngine({
      runId: 'run-1',
      value: 0,
      L3: { checkpoints: [{ checkpointId: 'cp-log' }] },
    });
    const originalLog = engine._state.L3.checkpoints;
    const checkpointData = {
      runId: 'run-2',
      value: { count: 2 },
      L3: { checkpoints: [{ checkpointId: 'cp-old' }], extra: 'keep' },
    };
    engine._checkpoints.set('cp-1', { data: checkpointData, clock: 11 });

    const result = restoreCheckpoint(engine, 'cp-1');

    expect(result).toBe(true);
    expect(engine._state.runId).toBe('run-2');
    expect(engine._state.value).toEqual({ count: 2 });
    expect(engine._state.L3.extra).toBe('keep');
    expect(engine._state.L3.checkpoints).toBe(originalLog);
    expect(engine._state.L3.checkpoints).not.toBe(checkpointData.L3.checkpoints);
    expect(engine._actorId).toBe('run-2');
    expect(syncClockMock).toHaveBeenCalledWith(11);
  });

  it('returns false for missing checkpoints or nullish data', () => {
    const engine = makeEngine({ runId: 'run-1', value: 1, L3: { checkpoints: [] } });
    const originalState = engine._state;
    engine._checkpoints.set('cp-null', { data: null });
    const cases = [undefined, null, '', '   ', {}, 'missing', 'cp-null'];

    const results = cases.map((checkpointId) => restoreCheckpoint(engine, checkpointId));

    expect(results).toEqual(cases.map(() => false));
    expect(engine._state).toBe(originalState);
    expect(syncClockMock).not.toHaveBeenCalled();
  });

  it('restores state without syncing when clock is not a number', () => {
    const engine = makeEngine({ runId: 'run-1', value: 1, L3: { checkpoints: [] } });
    engine._actorId = 'actor-1';
    engine._checkpoints.set('cp-1', {
      data: { runId: 'run-9', value: 9, L3: { checkpoints: [] } },
      clock: '9',
    });

    const result = restoreCheckpoint(engine, 'cp-1');

    expect(result).toBe(true);
    expect(engine._state.runId).toBe('run-9');
    expect(engine._actorId).toBe('actor-1');
    expect(syncClockMock).not.toHaveBeenCalled();
  });

  it('handles rapid consecutive restores with numeric clocks', async () => {
    const engine = makeEngine({ runId: 'run-1', value: 0, L3: { checkpoints: [] } });
    engine._checkpoints.set('cp-1', {
      data: { runId: 'run-a', value: 1, L3: { checkpoints: [] } },
      clock: 1,
    });
    engine._checkpoints.set('cp-2', {
      data: { runId: 'run-b', value: 2, L3: { checkpoints: [] } },
      clock: 2,
    });

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => restoreCheckpoint(engine, 'cp-1')),
      Promise.resolve().then(() => restoreCheckpoint(engine, 'cp-2')),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(engine._state.runId).toBe('run-b');
    expect(engine._actorId).toBe('run-b');
    expect(syncClockMock).toHaveBeenCalledTimes(2);
  });
});
