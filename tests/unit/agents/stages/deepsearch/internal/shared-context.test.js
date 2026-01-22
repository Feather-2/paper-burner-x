import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../js/agents/shared/index.js', async () => {
  const actual = await vi.importActual('../../../../../../js/agents/shared/index.js');
  return {
    ...actual,
    cryptoRandomHex: vi.fn(() => 'deadbeef'),
  };
});

import SharedContextDefault, {
  SharedContext,
  createSharedContext,
} from '../../../../../../js/agents/stages/deepsearch/internal/shared-context.js';

beforeEach(() => {
  vi.clearAllMocks();
});

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let node = root;
  for (let i = 1; i < depth; i += 1) {
    node.next = { level: i };
    node = node.next;
  }
  return root;
};

describe('SharedContext', () => {
  it('constructs with defaults and normalized limits', () => {
    const ctx = new SharedContext({
      runId: '   ',
      limits: { summariesMax: 2, indexKeywordsMax: 3, storeMax: 7 },
      maxL1Entries: '4',
      maxL2Entries: 0,
    });

    expect(ctx.runId).toMatch(/^ctx_\d+$/);
    expect(new Date(ctx.createdAt).toISOString()).toBe(ctx.createdAt);
    expect(ctx.limits.summariesMax).toBe(4);
    expect(ctx.limits.indexKeywordsMax).toBe(3);
    expect(ctx.limits.storeMax).toBe(7);
    expect(ctx.getVersion()).toBe(0);
    expect(ctx.getStats().summaryCount).toBe(0);
  });

  it('constructs with invalid limits input', () => {
    const ctx = new SharedContext({ limits: 'not-an-object' });
    expect(ctx.limits).toEqual(expect.objectContaining({ storeMax: 50, signalsMax: 200 }));
  });

  it('manages summaries and prunes with limits', () => {
    const ctx = new SharedContext({ maxL1Entries: 2 });

    ctx.setSummary('', 'ignored');
    ctx.setSummary('stage1', 'first');
    ctx.setSummary('stage2', 'second');
    ctx.setSummary('stage3', '');

    expect(ctx.getSummary('stage1')).toBeNull();
    expect(ctx.getSummary('stage2')).toBe('second');
    expect(ctx.getSummary('stage3')).toBeNull();
    expect(ctx.buildSummaryText()).toContain('[stage2] second');
    expect(ctx.buildSummaryText()).not.toContain('stage3');
    expect(ctx.getAllSummaries()).toEqual({ stage2: 'second', stage3: '' });
  });

  it('builds blackboard prompt with filters and safe stringification', () => {
    const ctx = new SharedContext();

    ctx.setSummary('s1', 'summary');
    ctx.signal('note', { message: 'broadcast' });
    ctx.signal('note', { message: 'task', targetTaskId: 'task-1' });
    ctx.signal('note', { message: 'other', targetTaskId: 'task-2' });
    ctx.signal('sync', { type: 'sync', message: 'skip' });

    const badPayload = {
      type: 'weird',
      toJSON() {
        throw new Error('nope');
      },
      toString() {
        throw new Error('nope');
      },
    };
    ctx.signal('weird', badPayload);
    ctx.recordDecision({ action: 'approve', reason: 'ok' });

    const prompt = ctx.buildBlackboardPrompt({
      targetTaskId: 'task-1',
      maxSignals: 10,
      maxDecisions: 5,
    });

    expect(prompt).toContain('##');
    expect(prompt).toContain('[s1] summary');
    expect(prompt).toContain('[info] broadcast');
    expect(prompt).toContain('[info] task');
    expect(prompt).not.toContain('other');
    expect(prompt).not.toContain('skip');
    expect(prompt).toContain('[weird] [unserializable payload]');
    expect(prompt).toContain('approve: ok');
  });

  it('builds blackboard prompt empty when there is no data', () => {
    const ctx = new SharedContext();
    expect(ctx.buildBlackboardPrompt()).toBe('');
  });

  it('indexes keywords and supports search/searchAll with type boundaries', () => {
    const ctx = new SharedContext();

    ctx.addToIndex('   ', 'id1');
    ctx.addToIndex('alpha', '');
    expect(ctx.search('alpha')).toEqual([]);

    ctx.addToIndex('Alpha', 'id1');
    ctx.addToIndex('Beta', 'id1');
    ctx.addToIndex('Beta', 'id2');

    expect(ctx.search('alpha')).toEqual(['id1']);
    const betaResults = ctx.search('beta');
    expect(betaResults).toEqual(expect.arrayContaining(['id1', 'id2']));
    expect(betaResults.length).toBe(2);

    ctx.indexMany({ not: 'array' }, 'id3');
    expect(ctx.search('not')).toEqual([]);

    expect(ctx.searchAll(['alpha', 'beta'])).toEqual(['id1']);
    expect(ctx.searchAll([])).toEqual([]);
    expect(ctx.searchAll({})).toEqual([]);
  });

  it('records a single action for indexMany and does not record nested addToIndex', () => {
    const ctx = new SharedContext();

    ctx.indexMany(['alpha', 'beta'], 'id1');
    expect(ctx.search('alpha')).toEqual(['id1']);
    expect(ctx.search('beta')).toEqual(['id1']);
    expect(ctx.getActions()).toEqual([
      expect.objectContaining({ kind: 'indexMany' }),
    ]);
  });

  it('prunes index keywords and ids based on limits', () => {
    const ctx = new SharedContext({
      limits: { indexKeywordsMax: 1, indexIdsPerKeywordMax: 1 },
    });

    ctx.addToIndex('alpha', 'id1');
    ctx.addToIndex('alpha', 'id2');
    expect(ctx.search('alpha')).toEqual(['id2']);

    ctx.addToIndex('beta', 'id3');
    expect(ctx.search('alpha')).toEqual([]);
    expect(ctx.search('beta')).toEqual(['id3']);
  });

  it('setIndex stores stage metadata and seeds keyword index', () => {
    const ctx = new SharedContext();

    ctx.setIndex('   ', { keywords: ['skip'] });
    expect(ctx.getIndex('')).toBeNull();

    const mapIndex = new Map([
      ['keywords', ['kw1']],
      ['ids', ['id1']],
      ['paths', ['/tmp/file']],
    ]);
    ctx.setIndex('stage1', mapIndex);

    expect(ctx.getIndex('stage1')).toEqual({
      keywords: ['kw1'],
      ids: ['id1'],
      paths: ['/tmp/file'],
    });
    expect(ctx.search('kw1')).toEqual(['stage1']);
    expect(ctx.search('id1')).toEqual(['stage1']);
    expect(ctx.search('/tmp/file')).toEqual(['stage1']);

    ctx.setIndex('stage2', 'raw');
    expect(ctx.getIndex('stage2')).toEqual({ value: 'raw' });

    const actions = ctx.getActions();
    expect(actions.map((a) => a.kind)).toEqual(['setIndex', 'setIndex']);
  });

  it('stores items, prunes store, and retrieves details', () => {
    const ctx = new SharedContext({ limits: { storeMax: 1 } });
    const deep = buildDeepObject(30);

    ctx.store('stage_a', deep);
    ctx.store('stage_b', { value: 2 });

    expect(ctx.has('stage_a')).toBe(false);
    expect(ctx.has('stage_b')).toBe(true);
    expect(ctx.getDetail('stage_b')).toEqual({ value: 2 });
    expect(ctx.getStoreKeys()).toEqual(['stage_b']);
  });

  it('clears store by stage prefix or entirely', () => {
    const ctx = new SharedContext();

    ctx.store('stage_item', { v: 1 });
    ctx.store('other_item', { v: 2 });
    ctx.store(0, { v: 0 });

    ctx.clearStore('stage');
    expect(ctx.has('stage_item')).toBe(false);
    expect(ctx.has('other_item')).toBe(true);
    expect(ctx.has('0')).toBe(true);

    ctx.clearStore('');
    expect(ctx.getStoreKeys()).toEqual([]);
  });

  it('commit persists stage results and records a single action', () => {
    const ctx = new SharedContext();

    const commitId = ctx.commit('Stage@1', {
      full: { data: 'x' },
      summary: 'sum',
      keywords: ['Alpha', 'Beta'],
    });

    expect(commitId).toMatch(/^Stage_1_deadbeef_/);
    expect(ctx.getDetail(commitId)).toEqual({ data: 'x' });
    expect(ctx.getSummary('Stage@1')).toBe('sum');
    expect(ctx.search('alpha')).toContain(commitId);
    expect(ctx.search('beta')).toContain(commitId);

    const actions = ctx.getActions();
    expect(actions.length).toBe(1);
    expect(actions[0].kind).toBe('commit');

    const commitNoFull = ctx.commit('stage2', { summary: 'only' });
    expect(commitNoFull).toMatch(/^stage2_deadbeef_/);
    expect(ctx.getDetail(commitNoFull)).toBeNull();
  });

  it('commit uses provided id and sanitizes long stage prefixes', () => {
    const ctx = new SharedContext();

    const explicit = ctx.commit('stage', { id: 'commit-1', full: { v: 1 } });
    expect(explicit).toBe('commit-1');
    expect(ctx.getDetail('commit-1')).toEqual({ v: 1 });

    const longStage = 'a'.repeat(200);
    const generated = ctx.commit(longStage, { summary: 's' });
    expect(generated.startsWith(`${'a'.repeat(80)}_deadbeef_`)).toBe(true);
  });

  it('commit handles invalid stage, empty summary, and non-array keywords', () => {
    const ctx = new SharedContext();

    expect(ctx.commit('   ', { summary: 'x' })).toBeNull();

    const id = ctx.commit('stage', { summary: '', keywords: { not: 'array' } });
    expect(id).toMatch(/^stage_deadbeef_/);
    expect(ctx.getSummary('stage')).toBeNull();
    expect(ctx.search('not')).toEqual([]);
    expect(ctx.getDetail(id)).toBeNull();
  });

  it('generates unique ids even when Date.now collides', async () => {
    const ctx = new SharedContext();
    const now = vi.spyOn(Date, 'now').mockReturnValue(123);
    try {
      const ids = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          Promise.resolve().then(() => ctx.signal('note', { message: `m${i}` }).id)
        )
      );
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      now.mockRestore();
    }
  });

  it('signals with defaults, prunes, and creates unique ids under rapid calls', async () => {
    const ctx = new SharedContext({ limits: { signalsMax: 2 } });

    const sig = ctx.signal('ping', 'payload');
    expect(sig.stage).toBe('ping');
    expect(sig.type).toBe('info');
    expect(sig.payload).toEqual({ value: 'payload' });

    const signals = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        Promise.resolve(ctx.signal('note', { message: `m${i}` }))
      )
    );
    const ids = new Set(signals.map((s) => s.id));
    expect(ids.size).toBe(signals.length);
    expect(ctx.getSignals().length).toBe(2);
    expect(ctx.getLatestSignal('info').id).toBe(signals[signals.length - 1].id);
  });

  it('upsertSignal updates sync state and filters signals', () => {
    const ctx = new SharedContext();

    expect(ctx.upsertSignal(null)).toBeNull();

    ctx.signal('note', { message: 'broadcast' });
    ctx.signal('note', { message: 'task1', targetTaskId: 'task-1' });
    ctx.signal('note', { message: 'task2', targetTaskId: 'task-2' });

    const first = ctx.upsertSignal({
      type: 'job',
      id: '123',
      status: 'open',
      keywords: ['a', 'b', 'c', 'd', 'e', 'f'],
      by: 'tester',
    });

    expect(first.type).toBe('sync');
    expect(first.payload._syncKey).toBe('job:123');
    expect(first.payload.keywords).toEqual(['a', 'b', 'c', 'd', 'e']);

    const updated = ctx.upsertSignal({ type: 'job', id: '123', status: 'done' });
    expect(updated).not.toBeNull();

    const syncTable = ctx.getSyncTable('job');
    expect(syncTable).toEqual([
      expect.objectContaining({ status: 'done', type: 'job', id: '123' }),
    ]);
    expect(ctx.getSignals({ type: 'sync' }).length).toBe(1);

    const filtered = ctx.getSignals({ includeSync: false, targetTaskId: 'task-1' });
    const messages = filtered.map((s) => s.payload?.message);
    expect(messages).toEqual(expect.arrayContaining(['broadcast', 'task1']));
    expect(messages).not.toContain('task2');

    const latestInfo = ctx.getLatestSignal('info');
    expect(latestInfo.payload.message).toBe('task2');

    ctx.clearSignals();
    expect(ctx.getSignals()).toEqual([]);
  });

  it('getSignals supports string and function filters and getLatestSignal handles empty state', () => {
    const ctx = new SharedContext();

    expect(ctx.getLatestSignal()).toBeNull();
    expect(ctx.getLatestSignal('info')).toBeNull();

    ctx.signal('note', { message: 'm1' });
    ctx.signal('note2', { message: 'm2' });
    ctx.signal('note', { stage: 'stage2', message: 'm3' });
    ctx.upsertSignal({ type: 'job', id: '1', status: 'open' });

    expect(ctx.getSignals('info').length).toBe(2);
    expect(ctx.getSignals('stage2').length).toBe(1);
    expect(ctx.getSignals((s) => s.payload?.message === 'm1').length).toBe(1);

    const syncTable = ctx.getSyncTable();
    expect(syncTable.length).toBe(1);
    expect(syncTable[0]).toEqual(expect.objectContaining({ type: 'job', id: '1' }));
  });

  it('records decisions and prunes history', () => {
    const ctx = new SharedContext({ limits: { decisionsMax: 1 } });

    const d1 = ctx.recordDecision('approve');
    const d2 = ctx.recordDecision({ action: 'reject', reason: 'bad' });

    expect(d1.action).toBe('approve');
    expect(d2.reason).toBe('bad');
    const decisions = ctx.getDecisions();
    expect(decisions.length).toBe(1);
    expect(decisions[0].action).toBe('reject');
    expect(ctx.getDecisions((d) => d.action === 'reject')).toEqual([d2]);
  });

  it('tracks seen content and normalizes fingerprints', () => {
    const ctx = new SharedContext();

    ctx.markSeen('Hello   World');
    expect(ctx.hasSeen('hello world')).toBe(true);

    const longA = `${'a'.repeat(10000)}X`;
    const longB = `${'a'.repeat(10000)}Y`;
    ctx.markSeen(longA);
    expect(ctx.hasSeen(longB)).toBe(true);

    const first = ctx.checkAndMark(null);
    expect(first.seen).toBe(false);
    const second = ctx.checkAndMark(undefined);
    expect(second.seen).toBe(true);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('prunes seen fingerprints based on limits', () => {
    const ctx = new SharedContext({ limits: { seenMax: 1 } });

    ctx.markSeen('first');
    ctx.markSeen('second');

    expect(ctx.getStats().seenCount).toBe(1);
    expect(ctx.hasSeen('first')).toBe(false);
    expect(ctx.hasSeen('second')).toBe(true);
  });

  it('reports stats and serializes snapshots', () => {
    const ctx = new SharedContext();

    ctx.setSummary('s1', 'sum');
    ctx.addToIndex('kw', 'id1');
    ctx.store('id1', { v: 1 });
    ctx.signal('note', { message: 'm' });
    ctx.recordDecision('approve');
    ctx.markSeen('content');

    const stats = ctx.getStats();
    expect(stats.summaryCount).toBe(1);
    expect(stats.indexKeywords).toBe(1);
    expect(stats.storeItems).toBe(1);
    expect(stats.signalCount).toBe(1);
    expect(stats.decisionCount).toBe(1);
    expect(stats.seenCount).toBe(1);
    expect(stats.actionCount).toBe(5);
    expect(stats.version).toBe(5);

    const json = ctx.toJSON();
    expect(json.runId).toBe(ctx.runId);
    expect(json.summaries).toEqual({ s1: 'sum' });
    expect(json.indexKeys).toEqual(['kw']);
    expect(json.storeKeys).toEqual(['id1']);
    expect(json.signals.length).toBe(1);
    expect(json.decisions.length).toBe(1);
    expect(json.actionsMeta.actionCount).toBe(stats.actionCount);
  });

  it('filters actions by version and limit boundaries', () => {
    const ctx = new SharedContext({ limits: { actionsMax: 3 } });

    ctx.setSummary('a', '1');
    ctx.store('id1', { x: 1 });
    ctx.signal('note', { message: 'm' });
    ctx.recordDecision('dec');

    const all = ctx.getActions();
    expect(all.length).toBe(3);
    expect(all[0].kind).toBe('store');
    expect(ctx.getVersion()).toBe(4);

    const since2 = ctx.getActions({ sinceVersion: 2 });
    expect(since2.length).toBe(2);
    expect(since2.map((a) => a.kind)).toEqual(['signal', 'decision']);

    const limit1 = ctx.getActions({ limit: 1 });
    expect(limit1.length).toBe(1);
    expect(limit1[0].kind).toBe('decision');

    const limitZero = ctx.getActions({ limit: 0 });
    expect(limitZero.length).toBe(all.length);

    const limitNegative = ctx.getActions({ limit: -1 });
    expect(limitNegative.length).toBe(all.length);

    const sinceString = ctx.getActions({
      sinceVersion: '2',
      limit: Number.MAX_SAFE_INTEGER,
    });
    expect(sinceString.length).toBe(all.length);

    const sinceMax = ctx.getActions({ sinceVersion: Number.MAX_SAFE_INTEGER });
    expect(sinceMax).toEqual([]);
  });

  it('respects actionsMax=0 while still advancing version', () => {
    const ctx = new SharedContext({ limits: { actionsMax: 0 } });
    ctx.setSummary('s', 'x');
    ctx.store('k', { v: 1 });
    expect(ctx.getVersion()).toBe(2);
    expect(ctx.getActions()).toEqual([]);
  });

  it('applies action streams without double-recording', () => {
    const ctx = new SharedContext();

    ctx.applyActions(null);
    expect(ctx.getVersion()).toBe(0);

    ctx.applyActions([{}]);
    expect(ctx.getVersion()).toBe(0);
    expect(ctx.getActions().length).toBe(0);

    const actions = [
      { id: 'a1', version: 5, kind: 'setSummary', payload: { stage: 's', summary: 'sum' } },
      { id: 'a2', version: 2, kind: 'store', payload: { id: 'k', data: { value: 1 } } },
      { id: 'a3', version: 7, kind: 'addToIndex', payload: { keyword: 'kw', id: 'k' } },
      {
        id: 'a4',
        version: 6,
        kind: 'signal',
        payload: {
          signal: { id: 'sig', stage: 's', type: 'info', payload: { message: 'm' }, ts: 1 },
        },
      },
      {
        id: 'a5',
        version: 8,
        kind: 'decision',
        payload: { decision: { action: 'do', reason: 'r', ts: 1 } },
      },
      {
        id: 'a6',
        version: 9,
        kind: 'commit',
        payload: { stage: 'c', id: 'c1', full: { a: 1 }, summary: 'sum-c', keywords: ['k'] },
      },
      { id: 'a7', version: 10, kind: '', payload: { stage: 'x' } },
    ];

    ctx.applyActions(actions);

    expect(ctx.getVersion()).toBe(10);
    expect(ctx.getSummary('s')).toBe('sum');
    expect(ctx.getDetail('k')).toEqual({ value: 1 });
    expect(ctx.search('kw')).toEqual(['k']);
    expect(ctx.getSignals().length).toBe(1);
    expect(ctx.getDecisions().length).toBe(1);
    expect(ctx.getDetail('c1')).toEqual({ a: 1 });
    expect(ctx.getSummary('c')).toBe('sum-c');
    expect(ctx.search('k')).toContain('c1');

    const actionLog = ctx.getActions();
    expect(actionLog.length).toBe(7);
    expect(actionLog.map((a) => a.id)).toEqual(expect.arrayContaining(['a1', 'a6']));
  });

  it('applies setIndex/indexMany/upsertSignal actions and dedupes by id', () => {
    const ctx = new SharedContext();

    const actions = [
      {
        id: 'b1',
        version: 1,
        kind: 'setIndex',
        payload: { stage: 'st', index: { keywords: ['k1'], ids: ['i1'], paths: ['p1'] } },
      },
      { id: 'b2', version: 2, kind: 'indexMany', payload: { keywords: ['k2', 'k3'], id: 'doc' } },
      {
        id: 'b3',
        version: 3,
        kind: 'upsertSignal',
        payload: { signal: { type: 'sync', payload: { _syncKey: 'job:1', status: 'open' } } },
      },
      {
        id: 'b4',
        version: 4,
        kind: 'upsertSignal',
        payload: { signal: { type: 'sync', payload: { _syncKey: 'job:1', status: 'done' } } },
      },
    ];

    ctx.applyActions(actions);

    expect(ctx.getVersion()).toBe(4);
    expect(ctx.getIndex('st')).toEqual({ keywords: ['k1'], ids: ['i1'], paths: ['p1'] });
    expect(ctx.search('k1')).toEqual(['st']);
    expect(ctx.search('k2')).toEqual(['doc']);
    expect(ctx.search('k3')).toEqual(['doc']);

    const syncSignals = ctx.getSignals({ type: 'sync' });
    expect(syncSignals.length).toBe(1);
    expect(syncSignals[0].payload.status).toBe('done');

    ctx.applyActions(actions);
    expect(ctx.getActions().length).toBe(4);
  });
});

describe('createSharedContext', () => {
  it('creates a SharedContext instance with options', () => {
    const ctx = createSharedContext({ runId: 'run-1', maxL1Entries: 1 });
    const ctxDefault = createSharedContext();

    expect(ctx).toBeInstanceOf(SharedContext);
    expect(ctx.runId).toBe('run-1');
    expect(ctx.limits.summariesMax).toBe(1);
    expect(ctxDefault).toBeInstanceOf(SharedContext);
  });
});

describe('default export', () => {
  it('exposes SharedContext as default export', () => {
    expect(SharedContextDefault).toBe(SharedContext);
  });
});
