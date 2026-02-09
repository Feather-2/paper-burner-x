import { describe, it, expect, vi, beforeEach } from 'vitest';

const retrievalInstances = vi.hoisted(() => []);
const l3StorageInstances = vi.hoisted(() => []);

vi.mock('../../../../../js/agents/plugins/memory/retrieval-engine.js', () => {
  class RetrievalEngine {
    constructor(options = {}) {
      this.options = options;
      this.recall = vi.fn((query, limit) => [{ id: 'recall', query, limit }]);
      this.semanticRecall = vi.fn(async (query, opts) => [{ id: 'semantic', query, opts }]);
      this.hybridRecall = vi.fn(async (query, opts) => [{ id: 'hybrid', query, opts }]);
      this.dispose = vi.fn();
      retrievalInstances.push(this);
    }
  }

  return { RetrievalEngine };
});

vi.mock('../../../../../js/agents/plugins/memory/l3-storage.js', () => {
  class L3Storage {
    constructor(options = {}) {
      this.options = options;
      this.snapshots = new Map();
      this.checkpoints = [];
      this.archive = vi.fn(async (stageKey, data, keywords = []) => {
        const id = `mock-${this.snapshots.size}`;
        const entry = {
          id,
          stageKey,
          summary: data?.summary || '',
          keywords,
          ts: Date.now(),
        };
        this.snapshots.set(id, entry);
        return id;
      });
      this.getSnapshot = vi.fn(async (id) => this.snapshots.get(id) || null);
      this.listCheckpoints = vi.fn(async () => this.checkpoints);
      this.checkpoint = vi.fn(async (snapshot) => {
        this.checkpoints.push(snapshot);
      });
      this.getCheckpoint = vi.fn(async (id) => this.checkpoints.find((item) => item.id === id) || null);
      this.dispose = vi.fn(async () => {});
      l3StorageInstances.push(this);
    }
  }

  return { L3Storage };
});

import { MemoryStore, default as MemoryStoreDefault } from '../../../../../js/agents/plugins/memory/memory-store.impl.core.js';

const buildEventBus = () => ({
  emit: vi.fn(),
  on: vi.fn(() => () => {}),
});

const buildStore = (options = {}) => {
  const hasEventBus = Object.prototype.hasOwnProperty.call(options, 'eventBus');
  const eventBus = hasEventBus ? options.eventBus : buildEventBus();
  return new MemoryStore({ tokenCounter: null, ...options, eventBus });
};

beforeEach(() => {
  vi.clearAllMocks();
  retrievalInstances.length = 0;
  l3StorageInstances.length = 0;
});

describe('MemoryStore', () => {
  it('initializes with defaults and boundary configs', () => {
    const store = buildStore({
      runId: '   ',
      config: { maxSignals: 0, contextWindow: Number.MAX_SAFE_INTEGER },
    });

    expect(store.runId).toEqual(expect.any(String));
    expect(store.runId.trim()).not.toBe('');
    expect(store.config.maxSignals).toBe(0);
    expect(store.config.contextWindow).toBe(Number.MAX_SAFE_INTEGER);
    expect(store.config.compressThreshold).toBe(0.8);
    expect(store._tokenCounter).toBeNull();
  });

  it('returns false when there is nothing to compress or under threshold', () => {
    const store = buildStore({
      config: { keepLastTurns: 2, contextWindow: Number.MAX_SAFE_INTEGER, compressThreshold: 0.9 },
    });

    expect(store.compress()).toBe(false);

    store.addMessages([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ]);
    store._stats.tokenUsage = 1;

    expect(store.compress()).toBe(false);
    expect(store._L2.historySummary).toBe('');
  });

  it('compresses with force and emits events', () => {
    const eventBus = buildEventBus();
    const store = buildStore({ eventBus, config: { keepLastTurns: 1 } });

    store.addMessages([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'final' },
    ]);

    const result = store.compress({ force: true });

    expect(result).toBe(true);
    expect(store._L1.messages.length).toBe(1);
    expect(store._L2.historySummary).toContain('[user]');
    expect(store._stats.compressionCount).toBe(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'memory:compressed',
      expect.objectContaining({
        actor: 'memory',
        payload: expect.objectContaining({ compressedCount: 3, keptCount: 1 }),
      })
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      'memory:l2:compress',
      expect.objectContaining({
        actor: 'memory',
        payload: expect.objectContaining({ compressedCount: 3, keptCount: 1 }),
      })
    );
  });

  it('compresses when over budget without assistant turns and handles negative keepLastTurns', () => {
    const store = buildStore({
      config: { keepLastTurns: -1, compressThreshold: 1, contextWindow: Number.MAX_SAFE_INTEGER },
    });

    store.addMessages([
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
      { role: 'user', content: 'three' },
    ]);
    store.config.compressThreshold = 0.1;
    store.config.contextWindow = 10;
    store._stats.tokenUsage = 999;

    const result = store.compress();

    expect(result).toBe(true);
    expect(store._L1.messages.length).toBe(2);
    expect(store._L2.historySummary).not.toBe('');
  });

  it('buildPromptContext returns empty string for empty state', () => {
    const store = buildStore({ eventBus: null });

    expect(store.buildPromptContext()).toBe('');
  });

  it('buildPromptContext assembles sections and truncates large summaries', () => {
    const store = buildStore();
    const longHistory = 'h'.repeat(600);

    store.setTaskGoal('Ship it');
    store.addTodo({ text: 'open', status: 'pending' });
    store.addTodo({ text: 'done', status: 'completed' });
    store._L2.historySummary = longHistory;
    store.setStageSummary('phase1', 'discovered issue');
    store.syncDiscovery('disc1', { status: 'open', keywords: ['Alpha', 'Beta'] });
    store.syncSubagent('agent1', { status: 'running', progress: 50 });
    store.addSignal({ type: 'warn', message: 'check', payload: { code: 1 } });
    store.recordDecision({ action: 'act', reason: 'why' });

    const context = store.buildPromptContext();
    const truncated = `${longHistory.slice(0, 497)}...`;

    expect(context).toContain('Ship it');
    expect(context).toContain('open');
    expect(context).toContain('done');
    expect(context).toContain('[phase1]');
    expect(context).toContain('disc1');
    expect(context).toContain('agent1');
    expect(context).toContain('[warn]');
    expect(context).toContain('act: why');
    expect(context.includes(longHistory)).toBe(false);
    expect(context).toContain(truncated);
  });

  it('tokenizes and summarizes with nullish and long inputs', () => {
    const store = buildStore();
    const longText = 'x'.repeat(150);

    expect(store._tokenize(null)).toEqual([]);
    expect(store._tokenize(undefined)).toEqual([]);
    expect(store._tokenize('')).toEqual([]);
    expect(store._tokenize('   ')).toEqual([]);
    expect(store._tokenize('Hello, world!! hi')).toEqual(['hello', 'world!!', 'hi']);

    const summary = store._summarizeMessages([
      { content: longText },
      { role: 'assistant', content: '' },
    ]);

    expect(summary).toContain('[unknown]');
    expect(summary).toContain('...');
    expect(summary.includes(longText)).toBe(false);
  });

  it('manages L0 todos with boundary inputs', () => {
    const store = buildStore();

    const emptyTodo = store.addTodo(null);
    expect(emptyTodo.status).toBe('pending');

    const doneTodo = store.addTodo({ id: 't1', content: 'first', status: 'done' });
    const pendingTodo = store.addTodo({ id: 't2', content: 'second', status: 'pending' });

    const updated = store.addTodo({ id: 't1', content: 'updated', status: 'done' });
    expect(updated).toBe(doneTodo);

    expect(store.getTodos('completed').map((todo) => todo.id)).toEqual(['t1']);
    expect(store.getTodos((todo) => todo.id === 't2')).toEqual([pendingTodo]);

    expect(store.updateTodo('   ', { content: 'ignored' })).toBeNull();
    expect(store.removeTodo('missing')).toBeNull();

    const removed = store.removeTodo('t1');
    expect(removed.id).toBe('t1');

    const replaced = store.replaceTodos({});
    expect(replaced).toEqual([]);
  });

  it('handles messages and decisions with type boundaries and concurrency', async () => {
    const store = buildStore({ config: { maxDecisions: 2, contextWindow: Number.MAX_SAFE_INTEGER } });

    const first = store.addMessage('hello');
    expect(first.role).toBe('user');
    expect(store.addMessages({})).toEqual([]);

    store.recordDecision({ action: 'a' });
    store.recordDecision({ action: 'b' });
    store.recordDecision({ action: 'c' });

    expect(store.getDecisions('2').length).toBe(2);
    expect(store.getDecisions().length).toBe(2);

    const results = await Promise.all([
      Promise.resolve().then(() => store.addMessage('m1')),
      Promise.resolve().then(() => store.addMessage('m2')),
    ]);

    expect(results.map((msg) => msg.content)).toEqual(['m1', 'm2']);
  });

  it('manages signals and scratchpad safely', () => {
    const store = buildStore({ config: { maxSignals: 0 } });
    const signal = store.addSignal({ type: 'warn', message: 'watch' });

    expect(signal.acknowledged).toBe(false);
    expect(store.getSignals().length).toBe(0);

    const storeWithSignals = buildStore();
    const sig = storeWithSignals.addSignal({ type: 'info', message: 'ok' });

    expect(storeWithSignals.getSignals('pending').length).toBe(1);
    storeWithSignals.acknowledgeSignal(sig.id);
    expect(storeWithSignals.getSignals('pending').length).toBe(0);

    storeWithSignals.setScratchpad({ safe: 1, __proto__: 'x' });
    storeWithSignals.setScratchpad('   ', 2);

    const scratch = storeWithSignals.getScratchpad();
    expect(scratch.safe).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(scratch, '__proto__')).toBe(false);
    expect(storeWithSignals.eventBus.emit).toHaveBeenCalledWith(
      'memory:updated',
      expect.objectContaining({ actor: 'memory' })
    );
  });

  it('syncs discoveries and subagents with defaults', () => {
    const store = buildStore();

    const discovery = store.syncDiscovery('disc', {});
    const subagent = store.syncSubagent('agent', { progress: '10' });

    expect(discovery.status).toBe('open');
    expect(discovery.keywords).toEqual([]);
    expect(subagent.status).toBe('pending');
    expect(subagent.progress).toBe(0);
  });

  it('handles stage summaries and claims with boundary inputs', () => {
    const store = buildStore();

    store.setStageSummary('   ', 'ignored');
    expect(store.getAllStageSummaries()).toEqual({});

    store.setStageSummary('stage', 'summary');
    expect(store.getStageSummary('stage')).toBe('summary');

    const claim = store.addClaim('fact');
    expect(claim.content).toBe('fact');
    expect(store.getClaims().length).toBe(1);

    const replaced = store.replaceClaims({});
    expect(replaced).toEqual([]);
  });

  it('binds and syncs data from sharedContext and discoveryManager', () => {
    const store = buildStore();
    const sharedContext = {
      getSignals: vi.fn(() => [{ id: 'sig1', type: 'info', message: 'one' }]),
      getAllSummaries: vi.fn(() => ({ phase: 'summary' })),
      getDecisions: vi.fn(() => [{ id: 'dec1', action: 'act' }]),
    };
    const discoveryManager = {
      getAllDiscoveries: vi.fn(() => [{ id: 'disc1', status: 'open', keywords: ['k'] }]),
    };

    expect(store.bind({ sharedContext, discoveryManager })).toBe(store);
    expect(store.sharedContext).toBe(sharedContext);
    expect(store.discoveryManager).toBe(discoveryManager);

    store.syncAll();
    store.syncAll();

    expect(store.getSignals().length).toBe(1);
    expect(store.getAllStageSummaries()).toEqual({ phase: 'summary' });
    expect(store.getDecisions().length).toBe(1);
    expect(store.getAllDiscoveries().length).toBe(1);
  });

  it('creates incremental snapshots and handles invalid restore input', () => {
    const store = buildStore();

    store.setSystemPrompt('system');
    store.addMessage('hello');
    store.setStageSummary('stage', 'summary');

    const snapshot = store.toSnapshot({ incremental: true });

    expect(snapshot._dirtyLayers).toEqual(expect.any(Object));
    expect(snapshot.L0).toBeDefined();
    expect(snapshot.L1).toBeDefined();
    expect(snapshot.L2).toBeDefined();
    expect(snapshot.L3).toBeUndefined();

    expect(store._dirty.L0).toBe(false);
    expect(store._dirty.L1).toBe(false);
    expect(store._dirty.L2).toBe(false);
    expect(store._dirty.L3).toBe(false);

    expect(store.fromSnapshot(null)).toBe(false);
    expect(store.fromSnapshot('bad')).toBe(false);
  });

  it('restores full snapshots with deep data without sharing references', async () => {
    const store = buildStore();
    const deep = { a: { b: { c: [1, { d: 'e' }] } } };

    store.setScratchpad('deep', deep);
    const id = await store.archive('stage', { summary: 'sum', payload: 'x' }, ['Key']);

    const snapshot = store.toSnapshot({ includeL3: true });
    const restored = buildStore({ eventBus: null });

    const ok = restored.fromSnapshot(snapshot);

    expect(ok).toBe(true);
    expect(restored.getScratchpad().deep.a.b.c[1].d).toBe('e');

    snapshot.L1.scratchpad.deep.a.b.c[1].d = 'mutated';
    expect(restored.getScratchpad().deep.a.b.c[1].d).toBe('e');

    expect(restored._L3.snapshots.size).toBe(1);
    expect(restored._L3.snapshots.has(id)).toBe(true);
  });

  it('archives in memory with keyword indexing and truncation', async () => {
    const store = buildStore();
    const big = { payload: 'x'.repeat(10000) };

    const [id1, id2] = await Promise.all([
      store.archive('stage1', big, ['Alpha', 'Beta']),
      store.archive('stage2', { summary: 'ok', payload: 'y' }, ['beta']),
    ]);

    const entry = await store.getSnapshot(id1);

    expect(new Set([id1, id2]).size).toBe(2);
    expect(entry.summary.length).toBeLessThanOrEqual(200);
    expect(store._L3.index.keywords.get('alpha').has(id1)).toBe(true);
    expect(store._L3.index.stages.get('stage1')).toBe(id1);
    expect(await store.getSnapshot('')).toBeNull();
    expect(await store.getSnapshot(null)).toBeNull();
  });

  it('evicts oldest snapshots when over capacity', async () => {
    const store = buildStore({ config: { maxL3Bytes: 100 } });
    const big = { payload: 'x'.repeat(1000) };

    const id1 = await store.archive('stage1', big, []);
    const id2 = await store.archive('stage2', big, []);

    expect(store._L3.snapshots.size).toBe(1);
    expect(store._L3.snapshots.has(id2)).toBe(true);
    expect(store._L3.snapshots.has(id1)).toBe(false);
  });

  it('uses L3Storage when vfs is provided', async () => {
    const vfs = { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() };
    const eventBus = buildEventBus();
    const store = buildStore({ vfs, eventBus });

    const id = await store.archive('stage', { summary: 'sum' }, ['k']);

    expect(l3StorageInstances.length).toBe(1);
    const storage = l3StorageInstances[0];
    expect(storage.archive).toHaveBeenCalledWith('stage', expect.anything(), ['k']);
    expect(await store.getSnapshot(id)).toEqual(expect.objectContaining({ id, stageKey: 'stage' }));
    expect(eventBus.emit).toHaveBeenCalledWith(
      'memory:archived',
      expect.objectContaining({ actor: 'memory' })
    );
  });

  it('creates and restores checkpoints in memory', async () => {
    const store = buildStore();

    store.setTaskGoal('goal');
    const id = await store.checkpoint({ incremental: false, fullSnapshotEvery: 1 });
    store.setTaskGoal('changed');

    expect(await store.restore(id)).toBe(true);
    expect(store.getTaskGoal()).toBe('goal');
    expect(store.getLatestCheckpoint().id).toBe(id);
    expect(await store.restore('missing')).toBe(false);
  });

  it('uses retrieval engine for recall variants and emits events', async () => {
    const eventBus = buildEventBus();
    const store = buildStore({ eventBus });

    const recallResults = store.recall({ query: 'obj' }, 2);
    const [semantic, hybrid] = await Promise.all([
      store.semanticRecall('q2', { topK: 1 }),
      store.hybridRecall('q3', { topK: 2 }),
    ]);

    expect(recallResults[0].id).toBe('recall');
    expect(semantic[0].id).toBe('semantic');
    expect(hybrid[0].id).toBe('hybrid');
    expect(store.getStats().recallCount).toBe(3);
    expect(retrievalInstances.length).toBe(1);

    const recallEvents = eventBus.emit.mock.calls.filter(([name]) => name === 'memory:recall');
    expect(recallEvents.length).toBe(3);
  });

  it('returns stats and metrics for current state', async () => {
    const store = buildStore({ config: { contextWindow: Number.MAX_SAFE_INTEGER } });

    store.addMessage('hi');
    store.addSignal({ type: 'info', message: 'sig' });
    store.recordDecision({ action: 'act' });
    store.addTodo({ text: 'todo' });
    store.addClaim({ content: 'claim' });
    await store.archive('stage', { summary: 'sum' }, ['k']);

    const stats = store.getStats();
    const metrics = store.getMetrics();

    expect(stats.messageCount).toBe(1);
    expect(stats.signalCount).toBe(1);
    expect(stats.decisionCount).toBe(1);
    expect(stats.todoCount).toBe(1);
    expect(stats.claimCount).toBe(1);
    expect(stats.archiveCount).toBe(1);
    expect(stats.tokenUsage).toBeGreaterThan(0);

    expect(metrics.l1.messageCount).toBe(1);
    expect(metrics.l1.signalCount).toBe(1);
    expect(metrics.l1.decisionCount).toBe(1);
    expect(metrics.l2.claimCount).toBe(1);
    expect(metrics.l3.archiveCount).toBe(1);
    expect(metrics.operations.archiveCount).toBe(1);
  });

  it('disposes internal resources and swallows errors', async () => {
    const retrievalEngine = { recall: vi.fn(), dispose: vi.fn(() => { throw new Error('fail'); }) };
    const l3Storage = { dispose: vi.fn(() => { throw new Error('fail'); }) };
    const eventBus = buildEventBus();
    const store = buildStore({ retrievalEngine, l3Storage, eventBus });

    await expect(store.dispose()).resolves.toBeUndefined();
    expect(store._retrievalEngine).toBeNull();
    expect(store._l3Storage).toBeNull();
    expect(store.eventBus).toBeNull();
  });
});

describe('default export', () => {
  it('matches the MemoryStore class export', () => {
    expect(MemoryStoreDefault).toBe(MemoryStore);
  });
});
