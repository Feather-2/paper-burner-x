import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../js/agents/shared/index.js', () => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
  makeSecureTimestampedId: vi.fn(),
}));

import { DiscoveryManager, DiscoveryStatus } from '../../../../js/agents/sdk/DiscoveryManager.js';
import { makeSecureTimestampedId } from '../../../../js/agents/shared/index.js';

const NOW = 1700000000000;

const createSharedContext = (overrides = {}) => {
  const records = new Map();
  const indices = new Map();

  return {
    upsertSignal: vi.fn(),
    store: vi.fn((id, value) => {
      records.set(id, value);
    }),
    addToIndex: vi.fn((key, id) => {
      const list = indices.get(key) || [];
      list.push(id);
      indices.set(key, list);
    }),
    search: vi.fn((key) => indices.get(key) || []),
    getDetail: vi.fn((id) => records.get(id) ?? null),
    getSignals: vi.fn(() => []),
    getSyncTable: vi.fn(() => []),
    ...overrides,
  };
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

describe('DiscoveryStatus', () => {
  it('exposes frozen status values', () => {
    expect(DiscoveryStatus).toEqual({
      OPEN: 'open',
      PARTIAL: 'partial',
      SATISFIED: 'satisfied',
      CONTRADICTED: 'contradicted',
      VERIFYING: 'verifying',
      BLOCKED: 'blocked',
    });
    expect(Object.isFrozen(DiscoveryStatus)).toBe(true);
  });
});

describe('DiscoveryManager', () => {
  it('upsertDiscovery stores defaults for empty data', () => {
    const sharedContext = createSharedContext();
    const manager = new DiscoveryManager({ sharedContext });

    manager.upsertDiscovery('gap-1', {});

    expect(sharedContext.upsertSignal).toHaveBeenCalledTimes(1);
    const record = sharedContext.upsertSignal.mock.calls[0][0];
    expect(record).toMatchObject({
      type: 'discovery',
      id: 'gap-1',
      status: DiscoveryStatus.OPEN,
      keywords: [],
    });
    expect(record.ts).toBe(NOW);
  });

  it('upsertDiscovery preserves explicit falsy and non-array values', () => {
    const sharedContext = createSharedContext();
    const manager = new DiscoveryManager({ sharedContext });
    const keywordsObject = { 0: 'alpha' };

    manager.upsertDiscovery(0, { status: '', keywords: keywordsObject, note: null });

    const record = sharedContext.upsertSignal.mock.calls[0][0];
    expect(record.id).toBe(0);
    expect(record.status).toBe('');
    expect(record.keywords).toBe(keywordsObject);
    expect(record.note).toBeNull();
  });

  it('addEvidence returns undefined without sharedContext', () => {
    const manager = new DiscoveryManager();

    const result = manager.addEvidence('gap', { sourceId: 's1' });

    expect(result).toBeUndefined();
    expect(makeSecureTimestampedId).not.toHaveBeenCalled();
  });

  it('addEvidence stores evidence, indexes it, and timestamps', () => {
    const sharedContext = createSharedContext();
    const manager = new DiscoveryManager({ sharedContext });
    makeSecureTimestampedId.mockReturnValue('ev-1');
    const conflictSpy = vi.spyOn(manager, '_checkConflicts');

    const result = manager.addEvidence('gap-1', {
      sourceId: null,
      snippet: '',
      confidence: 0,
      query: '   ',
      ts: 123,
    });

    expect(result).toBe('ev-1');
    expect(makeSecureTimestampedId).toHaveBeenCalledWith('ev');
    expect(sharedContext.store).toHaveBeenCalledTimes(1);
    const stored = sharedContext.store.mock.calls[0][1];
    expect(stored).toMatchObject({
      discoveryId: 'gap-1',
      sourceId: null,
      snippet: '',
      confidence: 0,
      query: '   ',
    });
    expect(stored.ts).toBe(NOW);
    expect(sharedContext.addToIndex).toHaveBeenCalledWith('evidence:gap-1', 'ev-1');
    expect(conflictSpy).toHaveBeenCalledWith('gap-1');
  });

  it('addEvidence handles rapid calls with large and nested payloads', async () => {
    const sharedContext = createSharedContext();
    const manager = new DiscoveryManager({ sharedContext });

    makeSecureTimestampedId
      .mockImplementationOnce(() => 'ev-1')
      .mockImplementationOnce(() => 'ev-2')
      .mockImplementationOnce(() => 'ev-3');

    const largeSnippet = 'a'.repeat(200000);
    const deepPayload = {
      level1: { level2: { level3: { level4: { level5: { value: 'x' } } } } },
    };

    const evidences = [
      { sourceId: 's1', confidence: -1, snippet: 'small' },
      { sourceId: 's2', confidence: Number.MAX_SAFE_INTEGER, snippet: largeSnippet, payload: deepPayload },
      { sourceId: 's3', confidence: '42', snippet: 'text' },
    ];

    const ids = await Promise.all(
      evidences.map((evidence) => Promise.resolve().then(() => manager.addEvidence('gap-rapid', evidence)))
    );

    expect(ids).toHaveLength(3);
    expect(ids).toEqual(expect.arrayContaining(['ev-1', 'ev-2', 'ev-3']));
    expect(sharedContext.store).toHaveBeenCalledTimes(3);
    expect(sharedContext.addToIndex).toHaveBeenCalledTimes(3);

    const storedRecords = sharedContext.store.mock.calls.map((call) => call[1]);
    const confidences = storedRecords.map((record) => record.confidence);

    expect(confidences).toEqual(expect.arrayContaining([-1, Number.MAX_SAFE_INTEGER, '42']));

    const largeRecord = storedRecords.find((record) => record.snippet.length === largeSnippet.length);
    expect(largeRecord).toBeDefined();
    expect(largeRecord.snippet).toHaveLength(largeSnippet.length);
    expect(largeRecord.payload).toEqual(deepPayload);

    const indexKeys = sharedContext.addToIndex.mock.calls.map((call) => call[0]);
    const indexIds = sharedContext.addToIndex.mock.calls.map((call) => call[1]);
    expect(indexKeys).toHaveLength(3);
    expect(indexKeys.every((key) => key === 'evidence:gap-rapid')).toBe(true);
    expect(indexIds).toEqual(expect.arrayContaining(ids));
  });

  it('getEvidences filters out nullish details', () => {
    const sharedContext = createSharedContext({
      search: vi.fn(() => ['ev-1', 'ev-2', 'ev-3']),
      getDetail: vi.fn((id) => {
        if (id === 'ev-1') return { id: 'ev-1' };
        if (id === 'ev-2') return null;
        return undefined;
      }),
    });
    const manager = new DiscoveryManager({ sharedContext });

    const results = manager.getEvidences('gap-1');

    expect(results).toEqual([{ id: 'ev-1' }]);
  });

  it('getEvidences returns empty array without sharedContext', () => {
    const manager = new DiscoveryManager();

    expect(manager.getEvidences('gap-1')).toEqual([]);
  });

  it('getDiscovery returns matching payload or null', () => {
    const signals = [
      { payload: { _syncKey: 'discovery:alpha', id: 'alpha' } },
      { payload: { _syncKey: 'discovery:beta', id: 'beta' } },
    ];
    const sharedContext = createSharedContext({
      getSignals: vi.fn((predicate) => signals.filter(predicate)),
    });
    const manager = new DiscoveryManager({ sharedContext });

    expect(manager.getDiscovery('beta')).toEqual(signals[1].payload);
    expect(manager.getDiscovery('missing')).toBeNull();
  });

  it('getDiscovery returns null when sharedContext is null', () => {
    const manager = new DiscoveryManager({ sharedContext: null });

    expect(manager.getDiscovery('gap-1')).toBeNull();
  });

  it('getAllDiscoveries returns empty array without sharedContext', () => {
    const manager = new DiscoveryManager();

    expect(manager.getAllDiscoveries()).toEqual([]);
  });

  it('getAllDiscoveries returns sync table content', () => {
    const sharedContext = createSharedContext({
      getSyncTable: vi.fn(() => [{ id: 'a' }, { id: 'b' }]),
    });
    const manager = new DiscoveryManager({ sharedContext });

    expect(manager.getAllDiscoveries()).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(sharedContext.getSyncTable).toHaveBeenCalledWith('discovery');
  });

  it('getConflictTasks filters contradicted discoveries', () => {
    const sharedContext = createSharedContext({
      getSyncTable: vi.fn(() => [
        { id: 'a', status: DiscoveryStatus.CONTRADICTED },
        { id: 'b', status: DiscoveryStatus.OPEN },
        { id: 'c', status: null },
      ]),
    });
    const manager = new DiscoveryManager({ sharedContext });

    const tasks = manager.getConflictTasks();

    expect(tasks).toEqual([{ id: 'a', status: DiscoveryStatus.CONTRADICTED }]);
  });

  it('evaluateGap upserts and emits when emitter provided', () => {
    const sharedContext = createSharedContext();
    const emit = vi.fn();
    const manager = new DiscoveryManager({ sharedContext, emit });

    const data = { status: DiscoveryStatus.PARTIAL, keywords: ['k'], detail: 'x' };
    manager.evaluateGap('gap-1', data);

    expect(sharedContext.upsertSignal).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('deepsearch:gapEvaluated', {
      payload: { gapId: 'gap-1', ...data },
    });
  });

  it('evaluateGap does not require an emitter', () => {
    const sharedContext = createSharedContext();
    const manager = new DiscoveryManager({ sharedContext });

    expect(() => manager.evaluateGap('gap-2', { status: DiscoveryStatus.OPEN })).not.toThrow();
    expect(sharedContext.upsertSignal).toHaveBeenCalledTimes(1);
  });
});
