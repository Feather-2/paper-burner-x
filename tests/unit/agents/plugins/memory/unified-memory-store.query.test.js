import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedShared = vi.hoisted(() => ({
  deepClone: vi.fn(),
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));

const mockedTodoNormalize = vi.hoisted(() => ({
  normalizeTodoStatus: vi.fn(),
}));

const mockedUtils = vi.hoisted(() => ({
  estimateTokensValue: vi.fn(),
  truncate: vi.fn(),
}));

vi.mock('../../../../../js/agents/shared/index.js', () => mockedShared);
vi.mock('../../../../../js/agents/plugins/memory/todo-normalize.js', () => mockedTodoNormalize);
vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.utils.js', () => mockedUtils);

import { applyQueryMethods } from '../../../../../js/agents/plugins/memory/unified-memory-store.query.js';

const baseState = () => ({
  L0: {
    systemPrompt: 'system',
    taskGoal: 'goal',
    todos: [],
  },
  L1: {
    messages: [],
    signals: [],
    decisions: [],
    deck: null,
    syncTable: {
      discoveries: {},
      subagents: {},
    },
    scratchpad: {},
    flags: {},
  },
  L2: {
    historySummary: '',
    stageSummaries: {},
    decisions: [],
    claims: [],
  },
  L3: {
    snapshots: {},
    index: {
      keywords: {},
      stages: {},
      timeline: [],
    },
    checkpoints: [],
  },
});

function createStore(stateOverrides = {}, options = {}) {
  const state = baseState();
  Object.assign(state, stateOverrides);

  class UnifiedMemoryStore {
    constructor(source) {
      this._state = source;
    }

    _getStateRef() {
      return this._state;
    }
  }

  applyQueryMethods(UnifiedMemoryStore);

  const store = new UnifiedMemoryStore(state);
  store.runId = options.runId ?? 'run_1';
  store._stats = {
    tokenUsage: 0,
    compressionCount: 0,
    recallCount: 0,
    ...(options.stats || {}),
  };
  store._tokenCounter =
    options.tokenCounter ?? ((text) => (text === null || text === undefined ? 0 : String(text).length));
  store._updateTokenUsage =
    options.updateTokenUsage ??
    vi.fn(() => {
      store._stats.tokenUsage += 1;
    });

  return store;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockedShared.deepClone.mockImplementation((value) => JSON.parse(JSON.stringify(value)));
  mockedShared.isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== 'object') return false;
    return !Array.isArray(value);
  });
  mockedShared.toNonEmptyString.mockImplementation((value) => {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    return text ? text : '';
  });
  mockedTodoNormalize.normalizeTodoStatus.mockImplementation((value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  });
  mockedUtils.estimateTokensValue.mockImplementation((content, counter) => {
    if (typeof counter === 'function') return counter(content);
    return String(content ?? '').length;
  });
  mockedUtils.truncate.mockImplementation((text, maxLen) => {
    const source = String(text ?? '');
    return source.length > maxLen ? `${source.slice(0, maxLen)}...` : source;
  });
});

describe('applyQueryMethods', () => {
  it('returns frozen L0 snapshots with copied todos', () => {
    const state = baseState();
    state.L0.systemPrompt = 'sys';
    state.L0.taskGoal = 'Ship';
    state.L0.todos = [{ id: 1 }, { id: 2 }];

    const store = createStore(state);
    const l0 = store.L0;

    expect(l0.systemPrompt).toBe('sys');
    expect(l0.taskGoal).toBe('Ship');
    expect(l0.todos).toEqual(state.L0.todos);
    expect(l0.todos).not.toBe(state.L0.todos);
    expect(Object.isFrozen(l0)).toBe(true);
    expect(Object.isFrozen(l0.todos)).toBe(true);
  });

  it('defaults L0 todos to empty for non-array inputs', () => {
    const state = baseState();
    state.L0.todos = { bad: true };

    const store = createStore(state);

    expect(store.L0.todos).toEqual([]);
  });

  it('returns frozen L1 snapshots with deck, syncTable, scratchpad, and flags', () => {
    const state = baseState();
    state.L1.messages = [{ role: 'user', content: 'hi' }];
    state.L1.signals = [{ id: 'sig_1' }];
    state.L1.decisions = [{ action: 'do' }];
    state.L1.deck = { id: 'deck_1' };
    state.L1.syncTable.discoveries = { d1: { id: 'd1' } };
    state.L1.syncTable.subagents = { a1: { id: 'a1' } };
    state.L1.scratchpad = { note: 'memo' };
    state.L1.flags = { busy: true };

    const store = createStore(state);
    const l1 = store.L1;

    expect(l1.messages).toEqual(state.L1.messages);
    expect(l1.messages).not.toBe(state.L1.messages);
    expect(l1.signals).toEqual(state.L1.signals);
    expect(l1.decisions).toEqual(state.L1.decisions);
    expect(l1.deck).toBe(state.L1.deck);
    expect(l1.syncTable.discoveries).toBe(state.L1.syncTable.discoveries);
    expect(l1.syncTable.subagents).toBe(state.L1.syncTable.subagents);
    expect(l1.scratchpad).toEqual(state.L1.scratchpad);
    expect(l1.scratchpad).not.toBe(state.L1.scratchpad);
    expect(l1.flags).toEqual(state.L1.flags);
    expect(l1.flags).not.toBe(state.L1.flags);
    expect(Object.isFrozen(l1)).toBe(true);
    expect(Object.isFrozen(l1.messages)).toBe(true);
    expect(Object.isFrozen(l1.syncTable)).toBe(true);
  });

  it('handles missing or invalid L1 fields and ignores prototype deck', () => {
    const proto = { deck: 'proto' };
    const L1 = Object.create(proto);
    L1.messages = 'nope';
    L1.signals = null;
    L1.decisions = undefined;
    L1.syncTable = null;
    L1.scratchpad = [];
    L1.flags = 'bad';

    const state = baseState();
    state.L1 = L1;

    const store = createStore(state);
    const l1 = store.L1;

    expect(l1.messages).toEqual([]);
    expect(l1.signals).toEqual([]);
    expect(l1.decisions).toEqual([]);
    expect(l1.deck).toBeNull();
    expect(l1.syncTable).toEqual({ discoveries: {}, subagents: {} });
    expect(l1.scratchpad).toEqual({});
    expect(l1.flags).toEqual({});
  });

  it('returns L2 snapshots with normalized historySummary and defaults', () => {
    const state = baseState();
    state.L2 = {
      historySummary: '   ',
      stageSummaries: null,
      decisions: 'bad',
      claims: ['c1'],
    };

    const store = createStore(state);
    const l2 = store.L2;

    expect(l2.historySummary).toBe('');
    expect(l2.stageSummaries).toEqual({});
    expect(l2.decisions).toEqual([]);
    expect(l2.claims).toEqual(['c1']);
    expect(Object.isFrozen(l2.decisions)).toBe(true);
    expect(Object.isFrozen(l2.claims)).toBe(true);
  });

  it('returns L3 snapshots with index defaults and frozen arrays', () => {
    const state = baseState();
    state.L3 = {
      snapshots: { s1: { id: 1 } },
      index: {
        keywords: { key: 1 },
        stages: { stage: 2 },
        timeline: [1, 2, 3],
      },
      checkpoints: ['c1'],
    };

    const store = createStore(state);
    const l3 = store.L3;

    expect(l3.snapshots).toBe(state.L3.snapshots);
    expect(l3.index.keywords).toBe(state.L3.index.keywords);
    expect(l3.index.stages).toBe(state.L3.index.stages);
    expect(l3.index.timeline).toEqual([1, 2, 3]);
    expect(Object.isFrozen(l3.index)).toBe(true);
    expect(Object.isFrozen(l3.index.timeline)).toBe(true);
    expect(Object.isFrozen(l3.checkpoints)).toBe(true);
  });

  it('defaults L3 timeline to an empty array when invalid', () => {
    const state = baseState();
    state.L3.index.timeline = { not: 'array' };

    const store = createStore(state);

    expect(store.L3.index.timeline).toEqual([]);
  });

  it('cloneL0/L1/L2/L3 delegate to deepClone', () => {
    const state = baseState();
    mockedShared.deepClone.mockImplementation((value) => ({ cloned: value }));

    const store = createStore(state);

    expect(store.cloneL0()).toEqual({ cloned: state.L0 });
    expect(store.cloneL1()).toEqual({ cloned: state.L1 });
    expect(store.cloneL2()).toEqual({ cloned: state.L2 });
    expect(store.cloneL3()).toEqual({ cloned: state.L3 });
    expect(mockedShared.deepClone).toHaveBeenCalledTimes(4);
    expect(mockedShared.deepClone).toHaveBeenCalledWith(state.L0);
    expect(mockedShared.deepClone).toHaveBeenCalledWith(state.L1);
    expect(mockedShared.deepClone).toHaveBeenCalledWith(state.L2);
    expect(mockedShared.deepClone).toHaveBeenCalledWith(state.L3);
  });

  it('getTaskGoal returns trimmed values and handles empty inputs', () => {
    const state = baseState();
    state.L0.taskGoal = '  Finish release  ';

    const store = createStore(state);

    expect(store.getTaskGoal()).toBe('Finish release');

    state.L0.taskGoal = '   ';
    expect(createStore(state).getTaskGoal()).toBe('');

    state.L0.taskGoal = 0;
    expect(createStore(state).getTaskGoal()).toBe('0');
  });

  it('getTodos returns copies and handles non-array todos', () => {
    const state = baseState();
    state.L0.todos = [{ id: 1 }, { id: 2 }];

    const store = createStore(state);
    const todos = store.getTodos();

    expect(todos).toEqual(state.L0.todos);
    expect(todos).not.toBe(state.L0.todos);

    const badState = baseState();
    badState.L0.todos = { bad: true };
    expect(createStore(badState).getTodos()).toEqual([]);
  });

  it('getTodos filters by predicate and status string', () => {
    const state = baseState();
    state.L0.todos = [
      { id: 1, status: 'In Progress' },
      { id: 2, status: 'done' },
      { id: 3, status: 'pending' },
    ];

    const store = createStore(state);

    expect(store.getTodos((todo) => todo.id === 2)).toEqual([{ id: 2, status: 'done' }]);
    expect(store.getTodos('in-progress')).toEqual([{ id: 1, status: 'In Progress' }]);
  });

  it('getTodos filters by status and predicate when filter object provided', () => {
    const state = baseState();
    state.L0.todos = [
      { id: 1, status: 'done', priority: 'high' },
      { id: 2, status: 'done', priority: 'low' },
      { id: 3, status: 'pending', priority: 'high' },
    ];

    const store = createStore(state);
    const filtered = store.getTodos({ status: 'done', filter: (todo) => todo.priority === 'high' });

    expect(filtered).toEqual([{ id: 1, status: 'done', priority: 'high' }]);
  });

  it('getTodos ignores invalid filter object fields', () => {
    const state = baseState();
    state.L0.todos = [{ id: 1 }, { id: 2 }];

    const store = createStore(state);
    const filtered = store.getTodos({ status: 1, filter: 'nope' });

    expect(filtered).toEqual(state.L0.todos);
  });

  it('getMessages returns copies and handles non-array messages', () => {
    const state = baseState();
    state.L1.messages = [{ id: 1 }];

    const store = createStore(state);
    const messages = store.getMessages();

    expect(messages).toEqual(state.L1.messages);
    expect(messages).not.toBe(state.L1.messages);

    const badState = baseState();
    badState.L1.messages = { bad: true };
    expect(createStore(badState).getMessages()).toEqual([]);
  });

  it('getSignals filters pending, predicate, and returns copies', () => {
    const state = baseState();
    state.L1.signals = [
      { id: 1, acknowledged: false, type: 'alert' },
      { id: 2, acknowledged: true, type: 'info' },
      { id: 3, type: 'notice' },
    ];

    const store = createStore(state);

    expect(store.getSignals('pending').map((sig) => sig.id)).toEqual([1, 3]);
    expect(store.getSignals((sig) => sig.id === 2)).toEqual([{ id: 2, acknowledged: true, type: 'info' }]);

    const all = store.getSignals();
    expect(all).toEqual(state.L1.signals);
    expect(all).not.toBe(state.L1.signals);
  });

  it('getDecisions returns recent items and handles limit boundaries', () => {
    const state = baseState();
    state.L1.decisions = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

    const store = createStore(state);

    expect(store.getDecisions(2).map((d) => d.id)).toEqual([3, 4]);
    expect(store.getDecisions(2.7).map((d) => d.id)).toEqual([3, 4]);
    expect(store.getDecisions(0).map((d) => d.id)).toEqual([1, 2, 3, 4]);
    expect(store.getDecisions(-1).map((d) => d.id)).toEqual([1, 2, 3, 4]);
    expect(store.getDecisions('2').map((d) => d.id)).toEqual([1, 2, 3, 4]);
    expect(store.getDecisions(Number.MAX_SAFE_INTEGER).length).toBe(4);
  });

  it('getScratchpad returns shallow copies and key access', () => {
    const state = baseState();
    const nested = { deep: { level: 1 } };
    state.L1.scratchpad = { note: 'memo', nested };

    const store = createStore(state);
    const scratchpad = store.getScratchpad();

    expect(scratchpad).toEqual({ note: 'memo', nested });
    expect(scratchpad).not.toBe(state.L1.scratchpad);
    expect(scratchpad.nested).toBe(nested);
    expect(store.getScratchpad('note')).toBe('memo');
    expect(store.getScratchpad('missing')).toBeUndefined();

    const badState = baseState();
    badState.L1.scratchpad = [];
    const badStore = createStore(badState);
    expect(badStore.getScratchpad()).toEqual({});
    expect(badStore.getScratchpad('note')).toBeUndefined();
  });

  it('getFlags returns copies and handles invalid inputs', () => {
    const state = baseState();
    state.L1.flags = { ready: true };

    const store = createStore(state);
    const flags = store.getFlags();

    expect(flags).toEqual({ ready: true });
    expect(flags).not.toBe(state.L1.flags);
    flags.ready = false;
    expect(state.L1.flags.ready).toBe(true);

    const badState = baseState();
    badState.L1.flags = [];
    expect(createStore(badState).getFlags()).toEqual({});
  });

  it('getDiscovery and getAllDiscoveries handle ids and tables safely', () => {
    const state = baseState();
    state.L1.syncTable.discoveries = {
      d1: { id: 'd1' },
      d2: { id: 'd2' },
    };

    const store = createStore(state);

    expect(store.getDiscovery('d1')).toEqual({ id: 'd1' });
    expect(store.getDiscovery('   ')).toBeNull();
    expect(store.getDiscovery(null)).toBeNull();
    expect(store.getDiscovery(undefined)).toBeNull();
    expect(store.getAllDiscoveries()).toEqual([{ id: 'd1' }, { id: 'd2' }]);

    const badState = baseState();
    badState.L1.syncTable.discoveries = 'bad';
    expect(createStore(badState).getAllDiscoveries()).toEqual([]);
  });

  it('getSubagent and getAllSubagents handle ids and tables safely', () => {
    const state = baseState();
    state.L1.syncTable.subagents = {
      a1: { id: 'a1' },
      a2: { id: 'a2' },
    };

    const store = createStore(state);

    expect(store.getSubagent('a1')).toEqual({ id: 'a1' });
    expect(store.getSubagent('')).toBeNull();
    expect(store.getSubagent(undefined)).toBeNull();
    expect(store.getAllSubagents()).toEqual([{ id: 'a1' }, { id: 'a2' }]);

    const badState = baseState();
    badState.L1.syncTable.subagents = 'bad';
    expect(createStore(badState).getAllSubagents()).toEqual([]);
  });

  it('getStageSummary and getAllStageSummaries handle invalid stages', () => {
    const state = baseState();
    state.L2.stageSummaries = { plan: 'summary' };

    const store = createStore(state);

    expect(store.getStageSummary('plan')).toBe('summary');
    expect(store.getStageSummary('missing')).toBe('');
    expect(store.getStageSummary('   ')).toBe('');
    expect(store.getStageSummary(null)).toBe('');

    const all = store.getAllStageSummaries();
    expect(all).toEqual({ plan: 'summary' });
    expect(all).not.toBe(state.L2.stageSummaries);

    const badState = baseState();
    badState.L2.stageSummaries = 0;
    expect(createStore(badState).getAllStageSummaries()).toEqual({});
  });

  it('getClaims returns copies and supports predicate filtering', () => {
    const state = baseState();
    state.L2.claims = [{ id: 1 }, { id: 2 }];

    const store = createStore(state);

    expect(store.getClaims().map((claim) => claim.id)).toEqual([1, 2]);
    expect(store.getClaims((claim) => claim.id === 2)).toEqual([{ id: 2 }]);

    const badState = baseState();
    badState.L2.claims = { bad: true };
    expect(createStore(badState).getClaims()).toEqual([]);
  });

  it('listArchives slices and reverses timeline with limit boundaries', () => {
    const state = baseState();
    state.L3.index.timeline = ['a', 'b', 'c', 'd'];

    const store = createStore(state);

    expect(store.listArchives(2)).toEqual(['d', 'c']);
    expect(store.listArchives(0)).toEqual(['d', 'c', 'b', 'a']);
    expect(store.listArchives(-1)).toEqual(['d', 'c', 'b', 'a']);
    expect(store.listArchives('2')).toEqual(['d', 'c', 'b', 'a']);
    expect(store.listArchives(Number.MAX_SAFE_INTEGER)).toEqual(['d', 'c', 'b', 'a']);

    const badState = baseState();
    badState.L3.index.timeline = { bad: true };
    expect(createStore(badState).listArchives()).toEqual([]);
  });

  it('buildPromptContext composes sections and uses truncation helpers', () => {
    const state = baseState();
    state.L0.taskGoal = 'Ship release';
    state.L0.todos = [
      { status: 'completed', text: 'Done 1' },
      { status: 'in progress', text: 'Doing 2' },
      { status: 'pending', title: 'Todo 3' },
    ];
    state.L2.historySummary = 'h'.repeat(600);
    state.L2.stageSummaries = {
      phase1: 's'.repeat(150),
      phase2: 'short',
    };
    state.L1.syncTable.discoveries = {
      d1: { id: 'd1', status: 'pending', keywords: ['alpha', 'beta'] },
      d2: { id: 'd2', status: 'satisfied' },
    };
    state.L1.syncTable.subagents = {
      a1: { id: 'a1', status: 'running', progress: 50 },
      a2: { id: 'a2', status: 'completed', progress: 100 },
    };
    state.L1.signals = [
      { type: 'alert', message: 'Check', acknowledged: false },
      { type: 'info', payload: { code: 1 }, acknowledged: false },
    ];
    state.L1.decisions = [
      { action: 'first' },
      { action: 'second', reason: 'because' },
      { action: 'third' },
      { action: 'fourth' },
    ];

    const store = createStore(state);
    const signalsSpy = vi.spyOn(store, 'getSignals');
    const decisionsSpy = vi.spyOn(store, 'getDecisions');

    const output = store.buildPromptContext();

    expect(output).toContain('## 目标');
    expect(output).toContain('Ship release');
    expect(output).toContain('## 待办 (2/3)');
    expect(output).toContain('✓ Done 1');
    expect(output).toContain('→ Doing 2');
    expect(output).toContain('○ Todo 3');
    expect(output).toContain('## 历史摘要');
    expect(output).toContain('## 阶段发现');
    expect(output).toContain('[phase1]');
    expect(output).toContain('[phase2] short');
    expect(output).toContain('## 待验证 (1)');
    expect(output).toContain('- d1: pending [alpha,beta]');
    expect(output).toContain('## SubAgents (1)');
    expect(output).toContain('- a1: running (50%)');
    expect(output).toContain('## 待处理信号');
    expect(output).toContain('- [alert] Check');
    expect(output).toContain('- [info] {"code":1}');
    expect(output).toContain('## 最近决策');
    expect(output).toContain('- second: because');
    expect(output).toContain('- third');
    expect(output).toContain('- fourth');
    expect(output).not.toContain('- first');

    expect(mockedUtils.truncate).toHaveBeenCalledWith(state.L2.historySummary, 500);
    expect(mockedUtils.truncate).toHaveBeenCalledWith(state.L2.stageSummaries.phase1, 100);
    expect(mockedUtils.truncate).toHaveBeenCalledWith(state.L2.stageSummaries.phase2, 100);
    expect(signalsSpy).toHaveBeenCalledWith('pending');
    expect(decisionsSpy).toHaveBeenCalledWith(3);
  });

  it('buildPromptContext returns empty string when no sections are available', () => {
    const state = baseState();
    state.L0.taskGoal = '   ';
    state.L0.todos = [];
    state.L1.signals = [];
    state.L1.decisions = [];
    state.L1.syncTable.discoveries = {};
    state.L1.syncTable.subagents = {};
    state.L2.historySummary = '';
    state.L2.stageSummaries = {};

    const store = createStore(state);

    expect(store.buildPromptContext()).toBe('');
  });

  it('getLatestCheckpoint returns the last checkpoint or null', () => {
    const state = baseState();
    state.L3.checkpoints = ['c1', 'c2'];

    const store = createStore(state);

    expect(store.getLatestCheckpoint()).toBe('c2');
    expect(createStore(baseState()).getLatestCheckpoint()).toBeNull();
  });

  it('estimateTokens delegates to estimateTokensValue with the token counter', () => {
    const tokenCounter = vi.fn(() => 42);
    mockedUtils.estimateTokensValue.mockReturnValue(99);

    const store = createStore(baseState(), { tokenCounter });
    const result = store.estimateTokens('hello');

    expect(result).toBe(99);
    expect(mockedUtils.estimateTokensValue).toHaveBeenCalledWith('hello', tokenCounter);
  });

  it('getStats updates token usage and counts state entries', () => {
    const state = baseState();
    state.L0.todos = [1, 2];
    state.L1.messages = [{}, {}];
    state.L1.signals = [{}, {}, {}];
    state.L1.decisions = [{}, {}];
    state.L1.syncTable.discoveries = { d1: {}, d2: {} };
    state.L1.syncTable.subagents = { a1: {} };
    state.L2.claims = ['c1', 'c2', 'c3'];
    state.L3.snapshots = { s1: {}, s2: {}, s3: {} };
    state.L3.checkpoints = ['cp1', 'cp2'];

    const store = createStore(state, {
      runId: 'run_42',
      stats: { tokenUsage: 3, compressionCount: 2, recallCount: 4 },
    });
    store._updateTokenUsage = vi.fn(() => {
      store._stats.tokenUsage += 7;
    });

    const stats = store.getStats();

    expect(store._updateTokenUsage).toHaveBeenCalledTimes(1);
    expect(stats).toEqual({
      runId: 'run_42',
      tokenUsage: 10,
      messageCount: 2,
      todoCount: 2,
      signalCount: 3,
      decisionCount: 2,
      discoveryCount: 2,
      subagentCount: 1,
      claimCount: 3,
      archiveCount: 3,
      checkpointCount: 2,
      compressionCount: 2,
      recallCount: 4,
    });
  });

  it('getStats handles invalid array/object sections safely', () => {
    const state = baseState();
    state.L0.todos = {};
    state.L1.messages = 'no';
    state.L1.signals = null;
    state.L1.decisions = undefined;
    state.L1.syncTable.discoveries = 'bad';
    state.L1.syncTable.subagents = 123;
    state.L2.claims = 'no';
    state.L3.snapshots = 'bad';
    state.L3.checkpoints = {};

    const store = createStore(state);
    const stats = store.getStats();

    expect(stats.messageCount).toBe(0);
    expect(stats.todoCount).toBe(0);
    expect(stats.signalCount).toBe(0);
    expect(stats.decisionCount).toBe(0);
    expect(stats.discoveryCount).toBe(0);
    expect(stats.subagentCount).toBe(0);
    expect(stats.claimCount).toBe(0);
    expect(stats.archiveCount).toBe(0);
    expect(stats.checkpointCount).toBe(0);
  });

  it('supports concurrent access and large data without shared state', async () => {
    const state = baseState();
    state.L0.todos = Array.from({ length: 1000 }, (_, i) => ({ id: i, status: 'pending' }));
    state.L3.index.timeline = Array.from({ length: 2000 }, (_, i) => `t${i}`);

    const store = createStore(state);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => store.getTodos()))
    );

    expect(results.every((todos) => todos.length === 1000)).toBe(true);
    expect(new Set(results).size).toBe(5);

    const archives = store.listArchives(3);
    const repeated = Array.from({ length: 3 }, () => store.listArchives(3));
    expect(repeated.every((value) => value.join(',') === archives.join(','))).toBe(true);
  });
});
