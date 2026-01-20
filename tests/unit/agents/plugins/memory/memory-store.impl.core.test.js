import { describe, it, expect, vi, beforeEach } from 'vitest';

const utilsMocks = vi.hoisted(() => {
  let idCounter = 0;
  const defineMethod = (fn) => ({ value: fn, writable: true, configurable: true });
  const defineGetter = (fn) => ({ get: fn, configurable: true });
  const defineAccessor = (get, set) => ({ get, set, configurable: true });
  const estimateTokens = vi.fn((text) => {
    if (text === null || text === undefined) return 0;
    return String(text).length;
  });
  const truncate = vi.fn((text, maxLen = 200) => {
    if (!text || text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 3)}...`;
  });
  const genId = vi.fn((prefix = 'id') => `${prefix}-${idCounter++}`);
  const estimateBytes = vi.fn((obj) => {
    if (obj === null || obj === undefined) return 0;
    if (typeof obj === 'string') return obj.length * 2;
    if (typeof obj === 'number') return 8;
    if (typeof obj === 'boolean') return 4;
    try {
      return JSON.stringify(obj).length * 2;
    } catch {
      return 1024;
    }
  });
  const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
  const reset = () => {
    idCounter = 0;
  };

  return {
    defineMethod,
    defineGetter,
    defineAccessor,
    estimateTokens,
    truncate,
    genId,
    estimateBytes,
    isFiniteNumber,
    __reset: reset,
  };
});

vi.mock('../../../../../js/agents/plugins/memory/memory-store.impl.utils.js', () => utilsMocks);

import { MemoryStore } from '../../../../../js/agents/plugins/memory/memory-store.impl.core.js';

const tokenLen = (value) => (value === null || value === undefined ? 0 : String(value).length);

const truncateExpected = (text, maxLen) => {
  if (!text || text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
};

const buildDeepObject = (depth = 10) => {
  const root = { level: 0 };
  let node = root;
  for (let i = 1; i <= depth; i += 1) {
    node.child = { level: i };
    node = node.child;
  }
  return root;
};

const createStore = (options = {}) => new MemoryStore(options);

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof utilsMocks.__reset === 'function') utilsMocks.__reset();
});

describe('MemoryStore', () => {
  describe('constructor', () => {
    it('initializes defaults and normalizes options', () => {
      const eventBus = { emit: vi.fn() };
      const archiveAdapter = { id: 'archive' };
      const tokenCounter = { count: vi.fn() };
      const embeddingService = {};
      const vectorIndex = {};
      const l3Storage = { dispose: vi.fn() };
      const sharedContext = { id: 'shared' };
      const discoveryManager = { id: 'disc' };

      const store = createStore({
        runId: '   ',
        config: {
          maxMessages: 5,
          keepLastTurns: 0,
          compressThreshold: 0,
          contextWindow: 0,
          maxL3Bytes: 0,
        },
        eventBus,
        archiveAdapter,
        tokenCounter,
        embeddingService,
        vectorIndex,
        retrievalEngine: 'not-object',
        sharedContext,
        discoveryManager,
        l3Storage,
      });

      expect(utilsMocks.genId).toHaveBeenCalledWith('run');
      expect(store.runId).toBe('run-0');
      expect(store.config.maxMessages).toBe(5);
      expect(store.config.maxSignals).toBe(50);
      expect(store.config.keepLastTurns).toBe(0);
      expect(store.config.contextWindow).toBe(0);
      expect(store.eventBus).toBe(eventBus);
      expect(store.archiveAdapter).toBe(archiveAdapter);
      expect(store._tokenCounter).toBe(tokenCounter);
      expect(store._embeddingService).toBe(embeddingService);
      expect(store._vectorIndex).toBe(vectorIndex);
      expect(store._retrievalEngine).toBeNull();
      expect(store.sharedContext).toBe(sharedContext);
      expect(store.discoveryManager).toBe(discoveryManager);
      expect(store._l3Storage).toBe(l3Storage);
      expect(store._vfs).toBeNull();
      expect(store._l3StoragePromise).toBeNull();
      expect(store._L0).toEqual({ systemPrompt: '', taskGoal: '', todos: [] });
      expect(store._L1.messages).toEqual([]);
      expect(store._L1.syncTable.discoveries).toBeInstanceOf(Map);
      expect(store._L2.stageSummaries).toBeInstanceOf(Map);
      expect(store._L3.snapshots).toBeInstanceOf(Map);
      expect(store._stats.tokenUsage).toBe(0);
      expect(store._dirty).toEqual({ L0: true, L1: true, L2: true, L3: false });
      expect(store._l3BytesUsed).toBe(0);
    });

    it('accepts numeric runId, null tokenCounter, and vfs with array-like indexes', () => {
      const vfs = { readFile: vi.fn() };
      const vectorIndex = [];
      const retrievalEngine = {};

      const store = createStore({
        runId: 0,
        tokenCounter: null,
        vfs,
        vectorIndex,
        retrievalEngine,
      });

      expect(store.runId).toBe('0');
      expect(store._tokenCounter).toBeNull();
      expect(store._vfs).toBe(vfs);
      expect(store._l3Storage).toBeNull();
      expect(store._vectorIndex).toBe(vectorIndex);
      expect(store._retrievalEngine).toBe(retrievalEngine);
      expect(store.config.maxMessages).toBe(20);
    });

    it('handles empty runId and boundary config values', () => {
      const store = createStore({
        runId: '',
        config: {
          maxMessages: Number.MAX_SAFE_INTEGER,
          keepLastTurns: -1,
          compressThreshold: -1,
        },
      });

      expect(utilsMocks.genId).toHaveBeenCalledWith('run');
      expect(store.runId).toBe('run-0');
      expect(store.config.maxMessages).toBe(Number.MAX_SAFE_INTEGER);
      expect(store.config.keepLastTurns).toBe(-1);
      expect(store.config.compressThreshold).toBe(-1);
    });
  });

  describe('_markDirty/_clearDirty', () => {
    it('marks and clears dirty flags safely', () => {
      const store = createStore();
      store._dirty = { L0: false, L1: false, L2: false, L3: false };

      store._markDirty('L1');
      expect(store._dirty).toEqual({ L0: false, L1: true, L2: false, L3: false });

      store._markDirty('NOPE');
      expect(store._dirty).toEqual({ L0: false, L1: true, L2: false, L3: false });

      store._clearDirty('L1');
      expect(store._dirty).toEqual({ L0: false, L1: false, L2: false, L3: false });

      store._dirty.L0 = true;
      store._dirty.L2 = true;
      store._clearDirty();
      expect(store._dirty).toEqual({ L0: false, L1: false, L2: false, L3: false });
    });
  });

  describe('compress', () => {
    it('returns false when there are no messages', () => {
      const store = createStore();
      store._L1.messages = [];

      expect(store.compress()).toBe(false);

      store._L1.messages = null;
      expect(store.compress()).toBe(false);
    });

    it('skips compression when under keepLastTurns and not over budget', () => {
      const store = createStore({
        config: {
          keepLastTurns: 2,
          contextWindow: 100,
          compressThreshold: 0.8,
        },
      });

      store._L1.messages = [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
      ];
      store._stats.tokenUsage = 0;

      expect(store.compress()).toBe(false);
      expect(store._L1.messages.length).toBe(4);
    });

    it('compresses with force and updates stats and events', () => {
      const eventBus = { emit: vi.fn() };
      const store = createStore({
        eventBus,
        config: {
          keepLastTurns: 1,
          contextWindow: 100,
          compressThreshold: 0.8,
        },
      });

      const messages = [
        { role: 'user', content: 'Hello there' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Another' },
      ];
      store._L1.messages = messages;
      store._stats.l1Tokens = tokenLen('Hello there') + tokenLen('Reply') + tokenLen('Another');
      store._stats.tokenUsage = store._stats.l1Tokens;

      const result = store.compress({ force: true });

      const expectedSummary = '[user] Hello there';
      const expectedL1Tokens = tokenLen('Reply') + tokenLen('Another');
      const expectedAddedL2Tokens = expectedSummary.length;
      const expectedTokenUsage = expectedL1Tokens + expectedAddedL2Tokens;

      expect(result).toBe(true);
      expect(store._L1.messages).toEqual([messages[1], messages[2]]);
      expect(store._L2.historySummary).toBe(expectedSummary);
      expect(store._stats.compressionCount).toBe(1);
      expect(store._stats.l1Tokens).toBe(expectedL1Tokens);
      expect(store._stats.l2Tokens).toBe(expectedAddedL2Tokens);
      expect(store._stats.tokenUsage).toBe(expectedTokenUsage);
      expect(store._dirty.L1).toBe(true);
      expect(store._dirty.L2).toBe(true);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'memory:compressed',
        expect.objectContaining({
          actor: 'memory',
          payload: { compressedCount: 1, keptCount: 2 },
        })
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        'memory:l2:compress',
        expect.objectContaining({
          actor: 'memory',
          payload: expect.objectContaining({
            compressedCount: 1,
            keptCount: 2,
            summaryTokens: expectedAddedL2Tokens,
          }),
        })
      );
    });

    it('compresses over budget without assistant turns by keeping the last two messages', () => {
      const store = createStore({
        config: {
          keepLastTurns: 2,
          contextWindow: 10,
          compressThreshold: 0.5,
        },
      });

      const messages = [
        { role: 'user', content: 'm1' },
        { role: 'user', content: 'm2' },
        { role: 'user', content: 'm3' },
      ];
      store._L1.messages = messages;
      store._stats.tokenUsage = 10;

      const result = store.compress();

      expect(result).toBe(true);
      expect(store._L1.messages).toEqual([messages[1], messages[2]]);
      expect(store._L2.historySummary).toContain('m1');
    });

    it('falls back to keeping one turn when keepLastTurns is not numeric', () => {
      const store = createStore({
        config: {
          keepLastTurns: '2',
          contextWindow: 1,
          compressThreshold: 0.1,
        },
      });

      const messages = [
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'u3' },
      ];
      store._L1.messages = messages;
      store._stats.tokenUsage = 100;

      const result = store.compress();

      expect(result).toBe(true);
      expect(store._L1.messages).toEqual([messages[2], messages[3]]);
    });

    it('handles rapid consecutive compress calls without corrupting state', () => {
      const store = createStore({
        config: {
          keepLastTurns: 1,
          contextWindow: 1000,
          compressThreshold: 0.9,
        },
      });

      store._L1.messages = [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
      ];
      store._stats.tokenUsage = 50;

      const first = store.compress({ force: true });
      const second = store.compress({ force: true });

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(store._L1.messages.length).toBeGreaterThan(0);
    });
  });

  describe('buildPromptContext', () => {
    it('returns empty string when there is no context', () => {
      const store = createStore();
      expect(store.buildPromptContext()).toBe('');
    });

    it('builds prompt context with truncation and filtered lists', () => {
      const store = createStore();
      store._L0.taskGoal = 'Ship feature';
      store._L0.todos = [
        { status: 'completed', text: 'done item' },
        { status: 'in_progress', title: 'doing item' },
        { status: 'pending', content: 'todo item' },
      ];
      store._L2.historySummary = 'h'.repeat(600);
      store._L2.stageSummaries.set('plan', 'plan summary');
      store._L2.stageSummaries.set('exec', 'e'.repeat(150));

      store._L1.syncTable.discoveries.set('d0', { id: 'd0', status: 'satisfied', keywords: ['skip'] });
      store._L1.syncTable.discoveries.set('d1', { id: 'd1', status: 'open', keywords: ['k1'] });
      store._L1.syncTable.discoveries.set('d2', { id: 'd2', status: 'open', keywords: [] });
      store._L1.syncTable.discoveries.set('d3', { id: 'd3', status: 'open', keywords: [] });
      store._L1.syncTable.discoveries.set('d4', { id: 'd4', status: 'open', keywords: [] });
      store._L1.syncTable.discoveries.set('d5', { id: 'd5', status: 'open', keywords: [] });
      store._L1.syncTable.discoveries.set('d6', { id: 'd6', status: 'open', keywords: [] });

      store._L1.syncTable.subagents.set('s1', { id: 's1', status: 'running', progress: 60 });
      store._L1.syncTable.subagents.set('s2', { id: 's2', status: 'completed', progress: 100 });
      store._L1.syncTable.subagents.set('s3', { id: 's3', status: 'failed', progress: 20 });

      store._L1.signals = [
        { id: 'sig1', type: 'info', message: 'one', acknowledged: false },
        { id: 'sig2', type: 'warn', payload: { code: 1 }, acknowledged: false },
        { id: 'sig3', type: 'debug', message: 'skip', acknowledged: true },
        { id: 'sig4', type: 'info', message: 'four', acknowledged: false },
        { id: 'sig5', type: 'info', message: 'five', acknowledged: false },
        { id: 'sig6', type: 'info', message: 'six', acknowledged: false },
        { id: 'sig7', type: 'info', message: 'seven', acknowledged: false },
      ];

      store._L1.decisions = [
        { id: 'dec1', action: 'choose', reason: 'because' },
        { id: 'dec2', action: 'skip' },
        { id: 'dec3', action: 'done', reason: 'ok' },
        { id: 'dec4', action: 'extra' },
      ];

      const output = store.buildPromptContext();
      const expectedHistory = truncateExpected(store._L2.historySummary, 500);
      const expectedExecSummary = truncateExpected('e'.repeat(150), 100);

      expect(output).toContain('Ship feature');
      expect(output).toContain('done item');
      expect(output).toContain('doing item');
      expect(output).toContain('todo item');
      expect(output).toContain('(2/3)');
      expect(output).toContain(expectedHistory);
      expect(output).toContain('[plan] plan summary');
      expect(output).toContain(`[exec] ${expectedExecSummary}`);
      expect(output).toContain('- d2: open');
      expect(output).toContain('- d6: open');
      expect(output).not.toContain('d1: open');
      expect(output).not.toContain('d0: satisfied');
      expect(output).toContain('- s1: running (60%)');
      expect(output).not.toContain('s2: completed');
      expect(output).toContain('- [warn] {"code":1}');
      expect(output).toContain('- [info] seven');
      expect(output).not.toContain('- [info] one');
      expect(output).not.toContain('- [debug] skip');
      expect(output).toContain('- skip');
      expect(output).toContain('- done: ok');
      expect(output).toContain('- extra');
      expect(output).not.toContain('choose');
    });
  });

  describe('token accounting', () => {
    it('recalculates total tokens from layer counts', () => {
      const store = createStore();
      store._stats.l0Tokens = 1;
      store._stats.l1Tokens = 2;
      store._stats.l2Tokens = 3;

      const total = store._recalculateTotalTokens();

      expect(total).toBe(6);
      expect(store._stats.tokenUsage).toBe(6);
    });

    it('updates token usage based on current layer contents', () => {
      const store = createStore();
      store._L0.systemPrompt = 'abc';
      store._L0.todos = { not: 'array' };
      store._L1.messages = [{ content: 'x' }, { content: null }];
      store._L2.historySummary = 'sum';

      const total = store._updateTokenUsage();

      expect(store._stats.l0Tokens).toBe(3);
      expect(store._stats.l1Tokens).toBe(1);
      expect(store._stats.l2Tokens).toBe(3);
      expect(total).toBe(7);
    });
  });

  describe('_checkCompress', () => {
    it('triggers compression when token usage crosses threshold', () => {
      const store = createStore({
        config: {
          contextWindow: '10',
          compressThreshold: '0.5',
        },
      });
      const spy = vi.spyOn(store, 'compress').mockReturnValue(true);

      store._stats.tokenUsage = 5;
      store._checkCompress();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not compress when below threshold', () => {
      const store = createStore({
        config: {
          contextWindow: 10,
          compressThreshold: 0.9,
        },
      });
      const spy = vi.spyOn(store, 'compress').mockReturnValue(true);

      store._stats.tokenUsage = 5;
      store._checkCompress();

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('_pruneArray', () => {
    it('prunes arrays beyond max without reordering', () => {
      const store = createStore();
      const arr = [1, 2, 3, 4];

      store._pruneArray(arr, 2);

      expect(arr).toEqual([3, 4]);
    });
  });

  describe('_summarizeMessages', () => {
    it('summarizes messages with normalized whitespace and truncation', () => {
      const store = createStore();
      const longContent = 'x'.repeat(150);

      const summary = store._summarizeMessages([
        { role: 'user', content: 'Hello   world\n\nok' },
        { role: 'assistant', content: null },
        { content: longContent },
      ]);

      const lines = summary.split('\n');
      expect(lines[0]).toBe('[user] Hello world ok');
      expect(lines[1].startsWith('[unknown] ')).toBe(true);

      const content = lines[1].slice('[unknown] '.length);
      expect(content.length).toBeLessThanOrEqual(100);
      expect(content.endsWith('...')).toBe(true);
    });
  });

  describe('_tokenize', () => {
    it('tokenizes input, filters short tokens, and handles non-strings', () => {
      const store = createStore();

      expect(store._tokenize(null)).toEqual([]);
      expect(store._tokenize(undefined)).toEqual([]);
      expect(store._tokenize('')).toEqual([]);
      expect(store._tokenize('   ')).toEqual([]);
      expect(store._tokenize('A b, cd ef')).toEqual(['cd', 'ef']);
      expect(store._tokenize(99)).toEqual(['99']);
      expect(store._tokenize('x y')).toEqual([]);
    });
  });

  describe('_emit/_emitUpdate', () => {
    it('emits events when eventBus is available', () => {
      const eventBus = { emit: vi.fn() };
      const store = createStore({ eventBus });

      store._emit('memory:test', { ok: true });

      expect(eventBus.emit).toHaveBeenCalledWith('memory:test', {
        actor: 'memory',
        payload: { ok: true },
      });
    });

    it('emits update events with timestamps', () => {
      const eventBus = { emit: vi.fn() };
      const store = createStore({ eventBus });
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234);

      store._emitUpdate('flags', { task: true });

      expect(eventBus.emit).toHaveBeenCalledWith('memory:updated', {
        actor: 'memory',
        payload: {
          field: 'flags',
          delta: { task: true },
          ts: 1234,
        },
      });

      nowSpy.mockRestore();
    });

    it('does nothing when eventBus is missing', () => {
      const store = createStore();

      expect(() => store._emit('memory:test', { ok: true })).not.toThrow();
    });
  });

  describe('getStats/getMetrics', () => {
    it('returns stats with recalculated totals', () => {
      const store = createStore({ runId: 'run-42' });
      store._L1.messages = [{}, {}];
      store._L1.signals = [{}, {}, {}];
      store._L1.decisions = [{}];
      store._L1.syncTable.discoveries.set('d1', { id: 'd1' });
      store._L1.syncTable.subagents.set('s1', { id: 's1' });
      store._L2.claims = [{}, {}, {}, {}];
      store._L3.snapshots.set('snap', {});
      store._L3.checkpoints.push({});
      store._stats.l0Tokens = 2;
      store._stats.l1Tokens = 3;
      store._stats.l2Tokens = 4;
      store._stats.compressionCount = 2;
      store._stats.recallCount = 1;

      const stats = store.getStats();

      expect(stats.runId).toBe('run-42');
      expect(stats.tokenUsage).toBe(9);
      expect(stats.messageCount).toBe(2);
      expect(stats.todoCount).toBe(0);
      expect(stats.signalCount).toBe(3);
      expect(stats.decisionCount).toBe(1);
      expect(stats.discoveryCount).toBe(1);
      expect(stats.subagentCount).toBe(1);
      expect(stats.claimCount).toBe(4);
      expect(stats.archiveCount).toBe(1);
      expect(stats.checkpointCount).toBe(1);
      expect(stats.compressionCount).toBe(2);
      expect(stats.recallCount).toBe(1);
    });

    it('returns metrics with operation counts', () => {
      const store = createStore();
      store._L1.messages = [{}, {}];
      store._L1.signals = [{}];
      store._L1.decisions = [{}, {}];
      store._L2.stageSummaries.set('stage', 'summary');
      store._L2.claims = [{}, {}];
      store._L3.snapshots.set('snap', {});
      store._L3.checkpoints.push({});
      store._stats.l1Tokens = 10;
      store._stats.compressionCount = 2;
      store._stats.recallCount = 1;
      store._stats.archiveCount = 3;

      const metrics = store.getMetrics();

      expect(metrics.l1).toEqual({
        messageCount: 2,
        signalCount: 1,
        decisionCount: 2,
        tokenEstimate: 10,
      });
      expect(metrics.l2).toEqual({
        stageSummaryCount: 1,
        claimCount: 2,
      });
      expect(metrics.l3).toEqual({
        archiveCount: 1,
        checkpointCount: 1,
      });
      expect(metrics.operations).toEqual({
        recallCount: 1,
        compressCount: 2,
        archiveCount: 3,
      });
    });
  });

  describe('binding and sync', () => {
    it('exposes sharedContext and discoveryManager and supports bind', () => {
      const sharedContext = { id: 1 };
      const discoveryManager = { id: 2 };
      const store = createStore({ sharedContext, discoveryManager });

      expect(store.sharedContext).toBe(sharedContext);
      expect(store.discoveryManager).toBe(discoveryManager);

      const nextShared = { id: 3 };
      const result = store.bind({ sharedContext: nextShared });

      expect(result).toBe(store);
      expect(store.sharedContext).toBe(nextShared);
      expect(store.discoveryManager).toBe(discoveryManager);

      store.bind();
      expect(store.sharedContext).toBe(nextShared);
    });

    it('syncs signals, summaries, and decisions from sharedContext', () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(999);
      const sharedContext = {
        getSignals: vi.fn(() => [
          { id: 'sig1', type: 'info', message: 'new' },
          { id: 'sig2', type: 'warn', message: 'warn', ts: 12 },
        ]),
        getAllSummaries: vi.fn(() => ({ stageA: 'summaryA' })),
        getDecisions: vi.fn(() => [
          { id: 'dec1', action: 'act' },
          { id: 'dec2', action: 'act2', ts: 44 },
        ]),
      };

      const store = createStore({ sharedContext });
      store._L1.signals = [{ id: 'sig1', type: 'info', message: 'existing', ts: 1 }];
      store._L1.decisions = [{ id: 'dec1', action: 'existing' }];

      store.syncFromSharedContext();

      expect(store._L1.signals).toHaveLength(2);
      expect(store._L1.signals[1].ts).toBe(12);
      expect(store._L1.signals[0].id).toBe('sig1');
      expect(store._L1.signals[1].id).toBe('sig2');
      expect(store._L1.signals[1].ts).toBe(12);
      expect(store._L1.decisions).toHaveLength(2);
      expect(store._L1.decisions[1].ts).toBe(44);
      expect(store._L2.stageSummaries.get('stageA')).toBe('summaryA');

      nowSpy.mockRestore();
    });

    it('syncs discoveries from discoveryManager with defaults', () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(321);
      const discoveryManager = {
        getAllDiscoveries: vi.fn(() => [
          { id: 'd1', status: '', keywords: null },
          { id: 'd2', status: 'satisfied', keywords: ['k1'], by: 'agent' },
        ]),
      };

      const store = createStore({ discoveryManager });
      store.syncFromDiscoveryManager();

      const d1 = store._L1.syncTable.discoveries.get('d1');
      const d2 = store._L1.syncTable.discoveries.get('d2');

      expect(d1).toEqual({
        id: 'd1',
        status: 'open',
        keywords: [],
        by: null,
        ts: 321,
      });
      expect(d2).toEqual({
        id: 'd2',
        status: 'satisfied',
        keywords: ['k1'],
        by: 'agent',
        ts: 321,
      });

      nowSpy.mockRestore();
    });

    it('syncAll calls both sync methods', () => {
      const store = createStore();
      const sharedSpy = vi.spyOn(store, 'syncFromSharedContext').mockImplementation(() => {});
      const discoverySpy = vi.spyOn(store, 'syncFromDiscoveryManager').mockImplementation(() => {});

      store.syncAll();

      expect(sharedSpy).toHaveBeenCalledTimes(1);
      expect(discoverySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('toSnapshot/fromSnapshot', () => {
    it('creates full snapshots with deep clones and map serialization', () => {
      const store = createStore({ config: { maxMessages: 5 } });
      store.runId = 'run-1';
      store._L0.systemPrompt = 'x'.repeat(100000);
      store._L0.taskGoal = 'goal';
      store._L0.todos = [{ id: 't1', content: 'todo' }];
      store._L1.messages = [{ role: 'user', content: 'hello' }];
      store._L1.signals = [{ id: 's1', type: 'info' }];
      store._L1.decisions = [{ id: 'd1', action: 'go' }];
      store._L1.syncTable.discoveries.set('disc1', { id: 'disc1', status: 'open' });
      store._L1.syncTable.subagents.set('sa1', { id: 'sa1', status: 'pending' });
      const deepScratch = buildDeepObject(12);
      store._L1.scratchpad = { nested: deepScratch };
      store._L1.flags.awaitUserFeedback = true;
      store._L2.historySummary = 'summary';
      store._L2.stageSummaries.set('stage', 'summary2');
      store._L2.claims = [{ id: 'c1', content: 'claim' }];
      store._L3.snapshots.set('snap1', { id: 'snap1', stageKey: 's', summary: 'sum', ts: 1 });
      store._L3.index.keywords.set('kw', new Set(['snap1']));
      store._L3.index.stages.set('stage', 'snap1');
      store._L3.index.timeline.push({ id: 'snap1', ts: 1, summary: 'sum' });
      store._L3.checkpoints.push({ id: 'ck1', ts: 2 });
      store._dirty = { L0: true, L1: true, L2: true, L3: true };

      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234);
      const snapshot = store.toSnapshot({ includeL3: true });

      expect(snapshot.runId).toBe('run-1');
      expect(snapshot.L0.systemPrompt.length).toBe(100000);
      expect(snapshot.L1.syncTable.discoveries).toEqual([['disc1', { id: 'disc1', status: 'open' }]]);
      expect(snapshot.L2.stageSummaries).toEqual([['stage', 'summary2']]);
      expect(snapshot.L3.index.keywords).toEqual([['kw', ['snap1']]]);
      expect(snapshot._dirtyLayers).toBeNull();
      expect(store._lastSnapshotTs).toBe(1234);

      snapshot.L1.scratchpad.nested.child.child.level = 99;
      expect(store._L1.scratchpad.nested.child.child.level).toBe(2);

      nowSpy.mockRestore();
    });

    it('creates incremental snapshots and clears dirty flags', () => {
      const store = createStore();
      store._L1.messages = [{ role: 'user', content: 'hi' }];
      store._L3.snapshots.set('snap', { id: 'snap', summary: 's', ts: 1 });
      store._dirty = { L0: false, L1: true, L2: false, L3: true };

      const snapshot = store.toSnapshot({ includeL3: true, incremental: true });

      expect(snapshot.L0).toBeUndefined();
      expect(snapshot.L1).toBeDefined();
      expect(snapshot.L2).toBeUndefined();
      expect(snapshot.L3).toBeDefined();
      expect(snapshot._dirtyLayers).toEqual({ L0: false, L1: true, L2: false, L3: true });
      expect(store._dirty).toEqual({ L0: false, L1: false, L2: false, L3: false });
    });

    it('restores from snapshots and recomputes tokens', () => {
      const store = createStore();
      store._L0.taskGoal = 'keep';

      const snapshot = {
        runId: 'snapshot-run',
        config: { maxMessages: 5 },
        L0: { systemPrompt: 'sys', taskGoal: 'goal', todos: [{ id: 't1', content: 'todo' }] },
        L1: {
          messages: [{ role: 'user', content: 'hi' }],
          signals: [],
          decisions: [],
          syncTable: { discoveries: [['d1', { id: 'd1' }]], subagents: [] },
          scratchpad: { nested: { value: 1 } },
          flags: { awaitUserFeedback: true },
        },
        L2: { historySummary: 'summary', stageSummaries: [['stage', 'sum']], claims: [{ id: 'c1' }] },
        L3: {
          snapshots: [['s1', { id: 's1', stageKey: 's', summary: 'sum', ts: 1 }]],
          index: { keywords: [['k1', ['s1']]], stages: [['stage', 's1']], timeline: [{ id: 's1', ts: 1, summary: 'sum' }] },
          checkpoints: [{ id: 'ck1', ts: 1 }],
        },
        stats: { l0Tokens: 10, l1Tokens: 20, l2Tokens: 30, tokenUsage: 60, compressionCount: 2, recallCount: 1 },
        _dirtyLayers: null,
      };

      const restored = store.fromSnapshot(snapshot);

      expect(restored).toBe(true);
      expect(store.runId).toBe('snapshot-run');
      expect(store.config.maxMessages).toBe(5);
      expect(store.config.keepLastTurns).toBe(6);
      expect(store._L0.systemPrompt).toBe('sys');
      expect(store._L0.taskGoal).toBe('goal');
      expect(store._L0.todos).toEqual([{ id: 't1', content: 'todo' }]);
      expect(store._L1.messages).toEqual([{ role: 'user', content: 'hi' }]);
      expect(store._L1.syncTable.discoveries.get('d1')).toEqual({ id: 'd1' });
      expect(store._L1.flags).toEqual({ awaitUserFeedback: true, taskImpossible: false });
      expect(store._L2.historySummary).toBe('summary');
      expect(store._L2.stageSummaries.get('stage')).toBe('sum');
      expect(Array.from(store._L3.index.keywords.get('k1'))).toEqual(['s1']);
      expect(store._dirty).toEqual({ L0: false, L1: false, L2: false, L3: false });
      expect(store._stats.compressionCount).toBe(2);
      expect(store._stats.recallCount).toBe(1);
      expect(store._l3BytesUsed).toBeGreaterThan(0);

      const expectedTotal = tokenLen('sys') + tokenLen('todo') + tokenLen('hi') + tokenLen('summary');
      expect(store._stats.tokenUsage).toBe(expectedTotal);
    });

    it('preserves existing layers when snapshot omits them and handles type boundaries', () => {
      const store = createStore();
      store._L0.taskGoal = 'keep';
      store._L2.historySummary = 'keep summary';

      const snapshot = {
        L1: {
          messages: [{ role: 'user', content: 'new' }],
          signals: 'not-array',
          decisions: [],
          syncTable: { discoveries: 'bad', subagents: [] },
          scratchpad: [],
          flags: [],
        },
        _dirtyLayers: { L1: true },
      };

      const restored = store.fromSnapshot(snapshot);

      expect(restored).toBe(true);
      expect(store._L0.taskGoal).toBe('keep');
      expect(store._L2.historySummary).toBe('keep summary');
      expect(store._L1.messages).toEqual([{ role: 'user', content: 'new' }]);
      expect(store._L1.signals).toEqual([]);
      expect(store._L1.syncTable.discoveries.size).toBe(0);
      expect(store._L1.scratchpad).toEqual({});
      expect(store._L1.flags).toEqual({ awaitUserFeedback: false, taskImpossible: false });
    });

    it('returns false for invalid snapshots', () => {
      const store = createStore();

      expect(store.fromSnapshot(null)).toBe(false);
      expect(store.fromSnapshot(undefined)).toBe(false);
    });
  });

  describe('_onDispose', () => {
    it('disposes retrieval engine and L3 storage safely', async () => {
      const engine = {
        dispose: vi.fn(() => {
          throw new Error('boom');
        }),
      };
      const l3Storage = { dispose: vi.fn(async () => {}) };
      const store = createStore({ l3Storage });
      store._retrievalEngine = engine;
      store._l3Storage = l3Storage;
      store._l3StoragePromise = Promise.resolve(l3Storage);
      store._sharedContext = { id: 1 };
      store._discoveryManager = { id: 2 };
      store.eventBus = { emit: vi.fn() };

      await store.dispose();

      expect(engine.dispose).toHaveBeenCalledTimes(1);
      expect(l3Storage.dispose).toHaveBeenCalledTimes(1);
      expect(store._retrievalEngine).toBeNull();
      expect(store._l3Storage).toBeNull();
      expect(store._l3StoragePromise).toBeNull();
      expect(store.sharedContext).toBeNull();
      expect(store.discoveryManager).toBeNull();
      expect(store.eventBus).toBeNull();
    });
  });
});
