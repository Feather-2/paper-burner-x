import { describe, it, expect, vi, beforeEach } from 'vitest';

const deepCloneMock = vi.hoisted(() => vi.fn());
const isPlainObjectMock = vi.hoisted(() => vi.fn());
const toNonEmptyStringMock = vi.hoisted(() => vi.fn());

const ACTION_TYPES = vi.hoisted(() => ({
  L2_SET_HISTORY_SUMMARY: 'L2/SET_HISTORY_SUMMARY',
  L2_APPEND_HISTORY_SUMMARY: 'L2/APPEND_HISTORY_SUMMARY',
  L1_SET_MESSAGES: 'L1/SET_MESSAGES',
  L3_ARCHIVE: 'L3/ARCHIVE',
  L3_ADD_CHECKPOINT: 'L3/ADD_CHECKPOINT',
}));

const DEFAULT_CONFIG_MOCK = vi.hoisted(() => ({
  maxMessages: 20,
  maxSignals: 50,
  maxDecisions: 30,
  keepLastTurns: 2,
  compressThreshold: 0.5,
  contextWindow: 100,
  maxL3Bytes: 200,
}));

const estimateBytesMock = vi.hoisted(() => vi.fn());
const estimateTokensValueMock = vi.hoisted(() => vi.fn());
const genIdMock = vi.hoisted(() => vi.fn());
const truncateMock = vi.hoisted(() => vi.fn());

const L3StorageMock = vi.hoisted(() =>
  vi.fn().mockImplementation(function L3Storage({ vfs, runId }) {
    this.vfs = vfs;
    this.runId = runId;
    this.archive = vi.fn();
    this.getSnapshot = vi.fn();
    this.listCheckpoints = vi.fn();
    this.checkpoint = vi.fn();
  })
);

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  deepClone: deepCloneMock,
  isPlainObject: isPlainObjectMock,
  toNonEmptyString: toNonEmptyStringMock,
}));

vi.mock('../../../../../js/agents/plugins/memory/action-types.js', () => ACTION_TYPES);

vi.mock('../../../../../js/agents/plugins/memory/l3-storage.js', () => ({
  L3Storage: L3StorageMock,
}));

vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.utils.js', () => ({
  DEFAULT_CONFIG: DEFAULT_CONFIG_MOCK,
  estimateBytes: estimateBytesMock,
  estimateTokensValue: estimateTokensValueMock,
  genId: genIdMock,
  truncate: truncateMock,
}));

import { applyLifecycleMethods } from '../../../../../js/agents/plugins/memory/unified-memory-store.lifecycle.js';

const defaultDeepClone = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
};

const defaultIsPlainObject = (value) => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const defaultToNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const defaultEstimateBytes = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'object' && typeof value._bytes === 'number') return value._bytes;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 4;
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 1024;
  }
};

const defaultEstimateTokensValue = (text) => {
  if (text === null || text === undefined) return 0;
  let raw = '';
  if (typeof text === 'string') {
    raw = text;
  } else {
    try {
      raw = JSON.stringify(text);
    } catch {
      raw = String(text);
    }
  }
  return raw.length;
};

const defaultTruncate = (text, maxLen = 200) => {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  if (!Number.isFinite(maxLen) || maxLen <= 0) return '';
  if (!raw || raw.length <= maxLen) return raw || '';
  if (maxLen <= 3) return raw.slice(0, maxLen);
  return raw.slice(0, maxLen - 3) + '...';
};

class UnifiedMemoryStore {}
applyLifecycleMethods(UnifiedMemoryStore);

const createState = (overrides = {}) => {
  const base = {
    L0: { systemPrompt: '', todos: [] },
    L1: {
      messages: [],
      signals: [],
      decisions: [],
      deck: null,
      syncTable: { discoveries: {}, subagents: {} },
      scratchpad: {},
      flags: {},
    },
    L2: { historySummary: '', stageSummaries: {}, claims: [] },
    L3: { snapshots: {}, index: { keywords: {}, stages: {}, timeline: [] }, checkpoints: [] },
  };

  return {
    ...base,
    ...overrides,
    L0: { ...base.L0, ...(overrides.L0 || {}) },
    L1: { ...base.L1, ...(overrides.L1 || {}) },
    L2: { ...base.L2, ...(overrides.L2 || {}) },
    L3: {
      ...base.L3,
      ...(overrides.L3 || {}),
      index: { ...base.L3.index, ...(overrides.L3?.index || {}) },
    },
  };
};

const createStore = (options = {}) => {
  const store = new UnifiedMemoryStore();
  store.runId = options.runId ?? 'run-1';
  store.config = { ...DEFAULT_CONFIG_MOCK, ...(options.config || {}) };
  store._stats = {
    l0Tokens: 0,
    l1Tokens: 0,
    l2Tokens: 0,
    tokenUsage: 0,
    compressionCount: 0,
    ...(options.stats || {}),
  };
  store._dirty = {
    L0: false,
    L1: false,
    L2: false,
    L3: false,
    ...(options.dirty || {}),
  };
  store._l3BytesUsed = options.l3BytesUsed ?? 0;
  store._state = options.state ?? createState();
  store._tokenCounter = vi.fn();
  store._engine = options.engine ?? { restoreSnapshot: vi.fn() };
  store.eventBus = options.eventBus ?? { emit: vi.fn() };
  store._vfs = options.vfs ?? null;
  store._l3Storage = options.l3Storage ?? null;
  store._l3StoragePromise = options.l3StoragePromise ?? null;
  store._unsubscribeEngine = options.unsubscribeEngine ?? null;
  store._retrievalEngine = options.retrievalEngine ?? null;
  store._lastSnapshotTs = null;

  store._getStateRef = vi.fn(() => store._state);

  store.dispatchSync = vi.fn((action) => {
    if (!action) return;
    if (action.type === ACTION_TYPES.L3_ARCHIVE) {
      const payload = action.payload || {};
      const data = payload.data;
      const id = payload.id || data?.id || `snap-${store._state.L3.index.timeline.length + 1}`;
      const summary =
        data?.summary ||
        (typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : String(data).slice(0, 200));
      const entry = { id, stageKey: payload.stageKey ?? null, summary, ts: Date.now() };
      store._state.L3.index.timeline = [...store._state.L3.index.timeline, entry];
      store._state.L3.snapshots = { ...store._state.L3.snapshots, [id]: { ...entry, data } };
      if (Array.isArray(payload.keywords)) {
        const nextKeywords = { ...(store._state.L3.index.keywords || {}) };
        for (const keyword of payload.keywords) {
          const existing = Array.isArray(nextKeywords[keyword]) ? nextKeywords[keyword] : [];
          nextKeywords[keyword] = [...existing, id];
        }
        store._state.L3.index.keywords = nextKeywords;
      }
      return;
    }

    if (action.type === ACTION_TYPES.L3_ADD_CHECKPOINT) {
      const ckpt = action.payload?.checkpoint;
      store._state.L3.checkpoints = [...store._state.L3.checkpoints, ckpt];
      return;
    }

    if (action.type === ACTION_TYPES.L1_SET_MESSAGES) {
      store._state.L1 = { ...store._state.L1, messages: action.payload?.messages ?? [] };
      return;
    }

    if (action.type === ACTION_TYPES.L2_SET_HISTORY_SUMMARY) {
      store._state.L2 = { ...store._state.L2, historySummary: action.payload?.summary ?? '' };
      return;
    }

    if (action.type === ACTION_TYPES.L2_APPEND_HISTORY_SUMMARY) {
      const prev = store._state.L2.historySummary || '';
      const next = action.payload?.summary ?? '';
      store._state.L2 = { ...store._state.L2, historySummary: prev ? `${prev}\n${next}` : next };
    }
  });

  store.dispatchBatchSync = vi.fn((actions) => {
    if (!Array.isArray(actions)) return;
    actions.forEach((action) => store.dispatchSync(action));
  });

  store.cloneL0 = vi.fn(() => deepCloneMock(store._state.L0));
  store.cloneL1 = vi.fn(() => deepCloneMock(store._state.L1));
  store.cloneL2 = vi.fn(() => deepCloneMock(store._state.L2));
  store.getClockValue = vi.fn(() => 42);
  store.init = vi.fn().mockResolvedValue(undefined);

  return store;
};

beforeEach(() => {
  vi.clearAllMocks();
  deepCloneMock.mockImplementation(defaultDeepClone);
  isPlainObjectMock.mockImplementation(defaultIsPlainObject);
  toNonEmptyStringMock.mockImplementation(defaultToNonEmptyString);
  estimateBytesMock.mockImplementation(defaultEstimateBytes);
  estimateTokensValueMock.mockImplementation(defaultEstimateTokensValue);
  genIdMock.mockImplementation(() => 'ckpt-1');
  truncateMock.mockImplementation(defaultTruncate);
});

describe('applyLifecycleMethods', () => {
  describe('dispose', () => {
    it('clears unsubscribe and retrieval engine even when they throw', () => {
      const unsubscribe = vi.fn(() => {
        throw new Error('boom');
      });
      const retrievalEngine = {
        dispose: vi.fn(() => {
          throw new Error('dispose');
        }),
      };
      const store = createStore({ unsubscribeEngine: unsubscribe, retrievalEngine });

      expect(() => store.dispose()).not.toThrow();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(retrievalEngine.dispose).toHaveBeenCalledTimes(1);
      expect(store._unsubscribeEngine).toBeNull();
    });

    it('handles missing engines without errors', () => {
      const store = createStore({ unsubscribeEngine: null, retrievalEngine: null });

      expect(() => store.dispose()).not.toThrow();
      expect(store._unsubscribeEngine).toBeNull();
    });
  });

  describe('archive', () => {
    it('archives through L3 storage and emits snapshot details', async () => {
      const store = createStore();
      const l3Storage = {
        archive: vi.fn().mockResolvedValue('snap-1'),
        getSnapshot: vi.fn().mockResolvedValue({ id: 'snap-1', stageKey: 'stage', summary: 'sum', ts: 123 }),
      };
      store._getL3Storage = vi.fn().mockResolvedValue(l3Storage);

      const id = await store.archive('stage', { summary: 'sum' }, ['kw']);

      expect(id).toBe('snap-1');
      expect(l3Storage.archive).toHaveBeenCalledWith('stage', { summary: 'sum' }, ['kw']);
      expect(store.eventBus.emit).toHaveBeenCalledWith('memory:archived', {
        actor: 'memory',
        payload: { id: 'snap-1', stageKey: 'stage', summary: 'sum', ts: 123 },
      });
    });

    it('archives through L3 storage and falls back when snapshot is missing', async () => {
      const store = createStore();
      const l3Storage = {
        archive: vi.fn().mockResolvedValue('snap-2'),
        getSnapshot: vi.fn().mockResolvedValue(null),
      };
      store._getL3Storage = vi.fn().mockResolvedValue(l3Storage);

      const id = await store.archive(null, null, []);

      expect(id).toBe('snap-2');
      expect(store.eventBus.emit).toHaveBeenCalledWith('memory:archived', {
        actor: 'memory',
        payload: { id: 'snap-2', stageKey: null, ts: expect.any(Number) },
      });
    });

    it('archives locally, updates bytes, and truncates huge payload summaries', async () => {
      const store = createStore();
      store._getL3Storage = vi.fn().mockResolvedValue(null);
      store._l3BytesUsed = 5;
      estimateBytesMock.mockReturnValue(10);
      const ensureSpy = vi.spyOn(store, '_ensureL3Capacity');
      const huge = 'x'.repeat(50000);

      const id = await store.archive('stage-local', huge, []);

      expect(id).toBe('snap-1');
      expect(ensureSpy).toHaveBeenCalledWith(10);
      expect(store._l3BytesUsed).toBe(15);
      expect(store.eventBus.emit).toHaveBeenCalledTimes(1);
      const emitted = store.eventBus.emit.mock.calls[0][1].payload;
      expect(emitted.stageKey).toBe('stage-local');
      expect(emitted.summary).toBe(huge.slice(0, 200));
      expect(emitted.summary.length).toBe(200);
    });

    it('returns raw ids when timeline ids are whitespace', async () => {
      const store = createStore();
      store._getL3Storage = vi.fn().mockResolvedValue(null);
      store.dispatchSync = vi.fn(() => {
        store._state.L3.index.timeline.push({ id: '   ', stageKey: 'stage', summary: 'sum', ts: 1 });
      });

      const id = await store.archive('stage', { summary: 'sum' }, []);

      expect(id).toBe('   ');
      expect(store.eventBus.emit).not.toHaveBeenCalled();
      expect(store._l3BytesUsed).toBe(0);
    });
  });

  describe('checkpoint', () => {
    it('creates a full checkpoint via L3 storage when not dirty', async () => {
      const store = createStore();
      store.cloneL0.mockReturnValue({ from: 'L0' });
      store.cloneL1.mockReturnValue({ from: 'L1' });
      store.cloneL2.mockReturnValue({ from: 'L2' });
      const l3Storage = {
        listCheckpoints: vi.fn().mockResolvedValue([]),
        checkpoint: vi.fn(),
      };
      store._getL3Storage = vi.fn().mockResolvedValue(l3Storage);
      const updateSpy = vi.spyOn(store, '_updateTokenUsage');
      const clearSpy = vi.spyOn(store, '_clearDirty');

      const id = await store.checkpoint();

      expect(id).toBe('ckpt-1');
      const snapshot = l3Storage.checkpoint.mock.calls[0][0];
      expect(snapshot.encoding).toBe('full');
      expect(snapshot.L0).toEqual({ from: 'L0' });
      expect(snapshot.L1).toEqual({ from: 'L1' });
      expect(snapshot.L2).toEqual({ from: 'L2' });
      expect(updateSpy).toHaveBeenCalled();
      expect(clearSpy).toHaveBeenCalled();
    });

    it('creates an incremental checkpoint with dirty layers and base id', async () => {
      const store = createStore({ dirty: { L0: true, L1: false, L2: true, L3: false } });
      store.cloneL0.mockReturnValue({ l0: 'ok' });
      store.cloneL2.mockReturnValue({ l2: 'ok' });
      const l3Storage = {
        listCheckpoints: vi.fn().mockResolvedValue([{ id: 'base-1' }]),
        checkpoint: vi.fn(),
      };
      store._getL3Storage = vi.fn().mockResolvedValue(l3Storage);

      await store.checkpoint({ incremental: true, fullSnapshotEvery: '2' });

      const snapshot = l3Storage.checkpoint.mock.calls[0][0];
      expect(snapshot.encoding).toBe('incremental');
      expect(snapshot.dirtyLayers).toEqual({ L0: true, L1: false, L2: true, L3: false });
      expect(snapshot.L0).toEqual({ l0: 'ok' });
      expect(snapshot.L2).toEqual({ l2: 'ok' });
      expect(snapshot.L1).toBeUndefined();
      expect(snapshot.baseId).toBe('base-1');
    });

    it('omits baseId when last checkpoint id is whitespace', async () => {
      const store = createStore({ dirty: { L0: true, L1: false, L2: false, L3: false } });
      const l3Storage = {
        listCheckpoints: vi.fn().mockResolvedValue([{ id: '   ' }]),
        checkpoint: vi.fn(),
      };
      store._getL3Storage = vi.fn().mockResolvedValue(l3Storage);

      await store.checkpoint({ incremental: true, fullSnapshotEvery: 3 });

      const snapshot = l3Storage.checkpoint.mock.calls[0][0];
      expect(snapshot.encoding).toBe('incremental');
      expect(snapshot.baseId).toBeUndefined();
    });

    it('handles local checkpoints with fullSnapshotEvery = 0 boundary', async () => {
      const state = createState({
        L3: { checkpoints: [{ id: 'base-ckpt' }] },
      });
      const store = createStore({ state, dirty: { L1: true } });
      store._getL3Storage = vi.fn().mockResolvedValue(null);
      estimateBytesMock.mockReturnValue(12);
      genIdMock.mockImplementation(() => 'ckpt-local');
      const ensureSpy = vi.spyOn(store, '_ensureL3Capacity');

      const id = await store.checkpoint({ incremental: true, fullSnapshotEvery: 0 });

      expect(id).toBe('ckpt-local');
      expect(ensureSpy).toHaveBeenCalledWith(12);
      expect(store._state.L3.checkpoints).toHaveLength(2);
      expect(store._l3BytesUsed).toBe(12);
      const snapshot = store._state.L3.checkpoints[1];
      expect(snapshot.encoding).toBe('incremental');
      expect(snapshot.baseId).toBe('base-ckpt');
    });

    it('treats non-object options as empty defaults', async () => {
      const store = createStore();
      const l3Storage = {
        listCheckpoints: vi.fn().mockResolvedValue([]),
        checkpoint: vi.fn(),
      };
      store._getL3Storage = vi.fn().mockResolvedValue(l3Storage);

      await store.checkpoint('oops');

      const snapshot = l3Storage.checkpoint.mock.calls[0][0];
      expect(snapshot.encoding).toBe('full');
    });
  });

  describe('restore', () => {
    it('returns false for nullish, empty, or non-string checkpoint ids', () => {
      const store = createStore();

      expect(store.restore(null)).toBe(false);
      expect(store.restore(undefined)).toBe(false);
      expect(store.restore('')).toBe(false);
      expect(store.restore('   ')).toBe(false);
      expect(store.restore(123)).toBe(false);
    });

    it('returns false when checkpoint is missing or restore fails', () => {
      const store = createStore();

      expect(store.restore('missing')).toBe(false);

      const state = createState({
        L3: { checkpoints: [{ id: 'ckpt', encoding: 'full', L0: {}, L1: {}, L2: {} }] },
      });
      const storeWithCkpt = createStore({ state });
      storeWithCkpt._restoreCheckpointLayers = vi.fn().mockReturnValue(null);

      expect(storeWithCkpt.restore('ckpt')).toBe(false);
    });

    it('restores checkpoint layers and updates engine state', () => {
      const state = createState({
        L3: { checkpoints: [{ id: 'ckpt', encoding: 'full', L0: {}, L1: {}, L2: {} }] },
      });
      const store = createStore({ state });
      store._restoreCheckpointLayers = vi
        .fn()
        .mockReturnValue({ L0: { systemPrompt: 'new' }, L1: { messages: [] }, L2: { historySummary: 'sum' } });
      const updateSpy = vi.spyOn(store, '_updateTokenUsage');
      const clearSpy = vi.spyOn(store, '_clearDirty');

      const result = store.restore('ckpt');

      expect(result).toBe(true);
      expect(store._engine.restoreSnapshot).toHaveBeenCalledWith({
        state: expect.objectContaining({
          L0: { systemPrompt: 'new' },
          L1: { messages: [] },
          L2: { historySummary: 'sum' },
        }),
        clock: 42,
        ts: expect.any(Number),
      });
      expect(updateSpy).toHaveBeenCalled();
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('_restoreCheckpointLayers', () => {
    it('rebuilds incremental chains from the nearest full checkpoint', () => {
      const store = createStore();
      const deep = { level: 0 };
      let node = deep;
      for (let i = 1; i <= 8; i += 1) {
        node.next = { level: i };
        node = node.next;
      }
      const full = { id: 'full', encoding: 'full', L0: deep, L1: { b: 1 }, L2: { c: 1 } };
      const inc1 = { id: 'inc1', encoding: 'incremental', baseId: 'full', L1: { b: 2 } };
      const inc2 = { id: 'inc2', encoding: 'incremental', baseId: 'inc1', L2: { c: 3 } };

      const result = store._restoreCheckpointLayers(inc2, [full, inc1, inc2]);

      expect(result).toEqual({ L0: deep, L1: { b: 2 }, L2: { c: 3 } });
      expect(result.L0).not.toBe(full.L0);
      expect(result.L1).not.toBe(inc1.L1);
    });

    it('returns null when no full checkpoint exists in the chain', () => {
      const store = createStore();
      const inc = { id: 'inc', encoding: 'incremental', baseId: 'missing', L0: { a: 1 } };

      expect(store._restoreCheckpointLayers(inc, [inc])).toBeNull();
    });

    it('clones full checkpoints directly when encoding is full', () => {
      const store = createStore();
      const ckpt = { id: 'full', encoding: 'full', L0: { a: 1 }, L1: { b: 1 }, L2: { c: 1 } };

      const result = store._restoreCheckpointLayers(ckpt, [ckpt]);

      expect(result).toEqual({ L0: { a: 1 }, L1: { b: 1 }, L2: { c: 1 } });
      expect(result.L1).not.toBe(ckpt.L1);
    });
  });

  describe('compress', () => {
    it('returns false when there are no messages', () => {
      const store = createStore({ state: createState({ L1: { messages: [] } }) });

      expect(store.compress()).toBe(false);
    });

    it('treats non-array messages as empty', () => {
      const store = createStore({ state: createState({ L1: { messages: { bad: true } } }) });

      expect(store.compress()).toBe(false);
    });

    it('skips compression when under budget and within keepLastTurns', () => {
      const state = createState({
        L1: {
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'ok' },
            { role: 'user', content: 'more' },
            { role: 'assistant', content: 'done' },
          ],
        },
      });
      const store = createStore({ state, config: { keepLastTurns: 2, contextWindow: 100, compressThreshold: 0.9 } });

      expect(store.compress()).toBe(false);
      expect(store.dispatchBatchSync).not.toHaveBeenCalled();
    });

    it('compresses over-budget messages and emits updates', () => {
      const messages = [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'another' },
        { role: 'assistant', content: 'final' },
      ];
      const state = createState({ L1: { messages }, L2: { historySummary: '' } });
      const store = createStore({ state, config: { keepLastTurns: 0, contextWindow: 10, compressThreshold: 0.5 } });
      const summarizeSpy = vi.spyOn(store, '_summarizeMessages');

      const result = store.compress();

      expect(result).toBe(true);
      expect(summarizeSpy).toHaveBeenCalled();
      expect(store.dispatchBatchSync).toHaveBeenCalledTimes(1);
      const actions = store.dispatchBatchSync.mock.calls[0][0];
      expect(actions[0].type).toBe(ACTION_TYPES.L2_SET_HISTORY_SUMMARY);
      expect(actions[1].type).toBe(ACTION_TYPES.L1_SET_MESSAGES);
      expect(store._stats.compressionCount).toBe(1);
      expect(store.eventBus.emit).toHaveBeenCalledWith('memory:compressed', {
        actor: 'memory',
        payload: { compressedCount: 3, keptCount: 1 },
      });
    });

    it('appends to existing history summaries when compressing', () => {
      const messages = [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' },
        { role: 'assistant', content: 'four' },
      ];
      const state = createState({ L1: { messages }, L2: { historySummary: 'existing' } });
      const store = createStore({ state, config: { keepLastTurns: 1, contextWindow: 10, compressThreshold: 0.1 } });

      store.compress();

      const actions = store.dispatchBatchSync.mock.calls[0][0];
      expect(actions[0].type).toBe(ACTION_TYPES.L2_APPEND_HISTORY_SUMMARY);
    });

    it('forces compression and keeps at least two messages with negative keepLastTurns', () => {
      const messages = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ];
      const state = createState({ L1: { messages } });
      const store = createStore({ state, config: { keepLastTurns: -1, contextWindow: 100, compressThreshold: 0.9 } });

      const result = store.compress({ force: true });

      expect(result).toBe(true);
      const actions = store.dispatchBatchSync.mock.calls[0][0];
      expect(actions[1].payload.messages).toHaveLength(2);
    });
  });

  describe('_checkCompress', () => {
    it('triggers compression when token usage exceeds threshold', () => {
      const state = createState({ L1: { messages: [{ content: 'abcdef' }] } });
      const store = createStore({ state, config: { contextWindow: 10, compressThreshold: 0.5 } });
      const compressSpy = vi.spyOn(store, 'compress').mockReturnValue(true);

      store._checkCompress();

      expect(compressSpy).toHaveBeenCalled();
    });

    it('skips compression when thresholds are not finite', () => {
      const store = createStore({ config: { contextWindow: '10', compressThreshold: 0.5 } });
      const compressSpy = vi.spyOn(store, 'compress');

      store._checkCompress();

      expect(compressSpy).not.toHaveBeenCalled();
    });
  });

  describe('_summarizeMessages', () => {
    it('summarizes roles, trims whitespace, and truncates long content', () => {
      const store = createStore();
      const longContent = 'z'.repeat(150);

      const summary = store._summarizeMessages([
        { role: 'assistant', content: 'Hello   world' },
        { role: null, content: '' },
        { role: 'user', content: longContent },
      ]);

      const lines = summary.split('\n');
      expect(lines[0]).toBe('[assistant] Hello world');
      expect(lines[1].startsWith('[user] ')).toBe(true);
      expect(lines[1].length).toBe('[user] '.length + 100);
    });

    it('returns empty summary for non-array input', () => {
      const store = createStore();

      expect(store._summarizeMessages({})).toBe('');
    });
  });

  describe('toSnapshot', () => {
    it('creates a full snapshot without L3 by default', () => {
      const deep = { level: 0 };
      let node = deep;
      for (let i = 1; i <= 6; i += 1) {
        node.child = { level: i };
        node = node.child;
      }
      const state = createState({
        L0: { systemPrompt: 'sys', todos: [{ content: 'todo' }], deep },
        L1: {
          messages: [{ role: 'user', content: 'hi' }],
          syncTable: { discoveries: { d1: 'x' }, subagents: { s1: 'y' } },
          deck: null,
          scratchpad: { note: 'x' },
          flags: { fast: true },
        },
        L2: { historySummary: 'summary', stageSummaries: { stage1: 'sum' }, claims: ['c1'] },
      });
      const store = createStore({ state, stats: { tokenUsage: 9 } });

      const snapshot = store.toSnapshot();

      expect(snapshot.schemaVersion).toBe('0.1');
      expect(snapshot._dirtyLayers).toBeNull();
      expect(snapshot.L0.systemPrompt).toBe('sys');
      expect(snapshot.L1.syncTable.discoveries).toEqual([['d1', 'x']]);
      expect(snapshot.L1.syncTable.subagents).toEqual([['s1', 'y']]);
      expect(snapshot.L1).toHaveProperty('deck', null);
      expect(snapshot).not.toHaveProperty('L3');
      expect(store._lastSnapshotTs).toEqual(expect.any(Number));
      expect(snapshot.L0.deep).toEqual(deep);
      expect(snapshot.L0.deep).not.toBe(deep);
    });

    it('creates incremental snapshots with dirty layers and L3 when requested', () => {
      const state = createState({
        L1: { messages: [{ content: 'hi' }] },
        L3: {
          snapshots: { s1: { summary: 'a' } },
          index: {
            keywords: { foo: ['s1'] },
            stages: { stage: ['s1'] },
            timeline: [{ id: 's1', stageKey: 'stage', summary: 'a', ts: 1 }],
          },
          checkpoints: [{ id: 'c1', encoding: 'full', L0: {}, L1: {}, L2: {} }],
        },
      });
      const store = createStore({ state, dirty: { L1: true, L3: true } });
      const clearSpy = vi.spyOn(store, '_clearDirty');

      const snapshot = store.toSnapshot({ includeL3: true, incremental: true });

      expect(snapshot._dirtyLayers).toEqual({ L0: false, L1: true, L2: false, L3: true });
      expect(snapshot.L1).toBeDefined();
      expect(snapshot).not.toHaveProperty('L0');
      expect(snapshot).not.toHaveProperty('L2');
      expect(snapshot.L3.index.keywords).toEqual([['foo', ['s1']]]);
      expect(clearSpy).toHaveBeenCalled();
      expect(store._dirty).toEqual({ L0: false, L1: false, L2: false, L3: false });
    });
  });

  describe('fromSnapshot', () => {
    it('returns false for nullish snapshots', () => {
      const store = createStore();

      expect(store.fromSnapshot(null)).toBe(false);
      expect(store.fromSnapshot(undefined)).toBe(false);
    });

    it('restores snapshot data and merges config defaults', () => {
      const prevState = createState();
      prevState.L1.flags = { existing: true };
      const store = createStore({ state: prevState });
      store._engine.restoreSnapshot = vi.fn(({ state }) => {
        store._state = state;
      });
      const recalcSpy = vi.spyOn(store, '_recalculateL3Bytes');
      const snapshot = {
        runId: 'new-run',
        config: { keepLastTurns: 9, maxL3Bytes: 321 },
        L0: { systemPrompt: 'sys', todos: [{ content: 'task' }] },
        L1: {
          messages: 'not-array',
          signals: [],
          decisions: [],
          deck: null,
          syncTable: { discoveries: [['a', 1]], subagents: [['b', 2]] },
          scratchpad: { note: 'x' },
          flags: { newFlag: true },
        },
        L2: {
          historySummary: 'summary',
          stageSummaries: [['stage', 'sum']],
          claims: ['claim'],
        },
        L3: {
          snapshots: [['snap-1', { summary: 's', _bytes: 10 }]],
          index: {
            keywords: [['kw', ['snap-1']]],
            stages: [['stage', ['snap-1']]],
            timeline: [{ id: 'snap-1', stageKey: 'stage', summary: 's', ts: 1 }],
          },
          checkpoints: [{ id: 'ckpt-1', encoding: 'full', L0: {}, L1: {}, L2: {}, _bytes: 5 }],
        },
        stats: { tokenUsage: 99, compressionCount: 3 },
      };

      const result = store.fromSnapshot(snapshot);

      expect(result).toBe(true);
      expect(store.runId).toBe('new-run');
      expect(store.config.keepLastTurns).toBe(9);
      expect(store.config.contextWindow).toBe(DEFAULT_CONFIG_MOCK.contextWindow);
      expect(store._engine.restoreSnapshot).toHaveBeenCalled();
      const restoredState = store._engine.restoreSnapshot.mock.calls[0][0].state;
      expect(restoredState.L1.messages).toEqual([]);
      expect(restoredState.L1.flags).toEqual({ existing: true, newFlag: true });
      expect(restoredState.L1).toHaveProperty('deck', null);
      expect(restoredState.L2.stageSummaries).toEqual({ stage: 'sum' });
      expect(restoredState.L3.snapshots).toEqual({ 'snap-1': { summary: 's', _bytes: 10 } });
      expect(restoredState.L3.index.keywords).toEqual({ kw: ['snap-1'] });
      expect(recalcSpy).toHaveBeenCalled();
      expect(store._stats.compressionCount).toBe(3);
      expect(store._stats.tokenUsage).toBe(14);
    });
  });

  describe('_recalculateL3Bytes', () => {
    it('sums snapshot and checkpoint bytes', () => {
      const state = createState({
        L3: {
          snapshots: { a: { _bytes: 10 }, b: { _bytes: 5 } },
          checkpoints: [{ _bytes: 7 }],
        },
      });
      const store = createStore({ state });

      store._recalculateL3Bytes();

      expect(store._l3BytesUsed).toBe(22);
    });
  });

  describe('_updateTokenUsage', () => {
    it('updates token usage totals across layers', () => {
      const state = createState({
        L0: { systemPrompt: 'sys', todos: [{ content: 'todo' }] },
        L1: { messages: [{ content: 'hi' }] },
        L2: { historySummary: 'sum' },
      });
      const store = createStore({ state });

      const total = store._updateTokenUsage();

      expect(store._stats.l0Tokens).toBe(7);
      expect(store._stats.l1Tokens).toBe(2);
      expect(store._stats.l2Tokens).toBe(3);
      expect(total).toBe(12);
    });

    it('handles rapid consecutive updates with evolving state', () => {
      const state = createState({
        L1: { messages: [{ content: 'a' }] },
      });
      const store = createStore({ state });

      const first = store._updateTokenUsage();
      store._state.L1.messages.push({ content: 'bbbb' });
      const second = store._updateTokenUsage();

      expect(second).toBeGreaterThan(first);
    });
  });

  describe('_getL3Storage', () => {
    it('returns null when vfs is missing', async () => {
      const store = createStore({ vfs: null });

      await expect(store._getL3Storage()).resolves.toBeNull();
      expect(L3StorageMock).not.toHaveBeenCalled();
    });

    it('returns existing storage without rebuilding', async () => {
      const existing = { id: 'existing' };
      const store = createStore({ vfs: {}, l3Storage: existing });

      await expect(store._getL3Storage()).resolves.toBe(existing);
      expect(L3StorageMock).not.toHaveBeenCalled();
    });

    it('handles concurrent requests by sharing the same promise', async () => {
      const store = createStore({ vfs: {} });

      const [first, second] = await Promise.all([store._getL3Storage(), store._getL3Storage()]);

      expect(L3StorageMock).toHaveBeenCalledTimes(1);
      expect(first).toBe(second);
      expect(store._l3Storage).toBe(first);
    });
  });

  describe('_markDirty/_clearDirty/_hasAnyDirty', () => {
    it('tracks dirty layers and resets correctly', () => {
      const store = createStore();

      store._markDirty('L1');
      store._markDirty('L9');
      expect(store._dirty.L1).toBe(true);
      expect(store._dirty.L9).toBeUndefined();
      expect(store._hasAnyDirty()).toBe(true);

      store._clearDirty('L1');
      expect(store._dirty.L1).toBe(false);

      store._dirty.L2 = true;
      store._clearDirty();
      expect(store._hasAnyDirty()).toBe(false);
    });
  });

  describe('_evictOldestSnapshot', () => {
    it('evicts the oldest snapshot and updates indices', () => {
      const state = createState({
        L3: {
          snapshots: { a: { _bytes: 10 }, b: { _bytes: 5 } },
          index: {
            keywords: { foo: ['a', 'b'], bar: ['a'] },
            timeline: [
              { id: 'a', stageKey: 'stage', summary: 'a', ts: 1 },
              { id: 'b', stageKey: 'stage', summary: 'b', ts: 2 },
            ],
          },
        },
      });
      const store = createStore({ state, l3BytesUsed: 50 });

      store._evictOldestSnapshot();

      expect(store._l3BytesUsed).toBe(40);
      const nextState = store._engine.restoreSnapshot.mock.calls[0][0].state;
      expect(nextState.L3.snapshots).toEqual({ b: { _bytes: 5 } });
      expect(nextState.L3.index.timeline).toEqual([{ id: 'b', stageKey: 'stage', summary: 'b', ts: 2 }]);
      expect(nextState.L3.index.keywords).toEqual({ foo: ['b'] });
    });

    it('no-ops when timeline is empty or invalid', () => {
      const state = createState({
        L3: { index: { timeline: [] } },
      });
      const store = createStore({ state });

      store._evictOldestSnapshot();

      expect(store._engine.restoreSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('_evictOldestCheckpoint', () => {
    it('evicts the oldest checkpoint and updates bytes', () => {
      const state = createState({
        L3: { checkpoints: [{ id: 'c1', _bytes: 7 }, { id: 'c2', _bytes: 4 }] },
      });
      const store = createStore({ state, l3BytesUsed: 20 });

      store._evictOldestCheckpoint();

      expect(store._l3BytesUsed).toBe(13);
      const nextState = store._engine.restoreSnapshot.mock.calls[0][0].state;
      expect(nextState.L3.checkpoints).toEqual([{ id: 'c2', _bytes: 4 }]);
    });

    it('no-ops when there are no checkpoints', () => {
      const store = createStore({ state: createState({ L3: { checkpoints: [] } }) });

      store._evictOldestCheckpoint();

      expect(store._engine.restoreSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('_ensureL3Capacity', () => {
    it('does nothing when maxL3Bytes is non-positive or infinite', () => {
      const store = createStore({ config: { maxL3Bytes: 0 } });
      const snapSpy = vi.spyOn(store, '_evictOldestSnapshot');

      store._ensureL3Capacity(100);

      expect(snapSpy).not.toHaveBeenCalled();

      const storeMax = createStore({ config: { maxL3Bytes: Number.MAX_SAFE_INTEGER } });
      const snapSpyMax = vi.spyOn(storeMax, '_evictOldestSnapshot');

      storeMax._ensureL3Capacity(1);

      expect(snapSpyMax).not.toHaveBeenCalled();
    });

    it('evicts snapshots and checkpoints until under capacity', () => {
      const state = createState({
        L3: {
          index: { timeline: [{ id: 'a' }], keywords: {} },
          checkpoints: [{ id: 'c1' }, { id: 'c2' }],
        },
      });
      const store = createStore({ state, config: { maxL3Bytes: 100 }, l3BytesUsed: 120 });
      const snapSpy = vi.spyOn(store, '_evictOldestSnapshot').mockImplementation(() => {
        store._l3BytesUsed -= 10;
        store._state.L3.index.timeline = [];
      });
      const ckptSpy = vi.spyOn(store, '_evictOldestCheckpoint').mockImplementation(() => {
        store._l3BytesUsed -= 30;
        store._state.L3.checkpoints = store._state.L3.checkpoints.slice(1);
      });

      store._ensureL3Capacity(20);

      expect(snapSpy).toHaveBeenCalledTimes(1);
      expect(ckptSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('_emit/_emitUpdate', () => {
    it('emits events when eventBus is available and no-ops otherwise', () => {
      const store = createStore();

      store._emit('memory:updated', { field: 'x' });

      expect(store.eventBus.emit).toHaveBeenCalledWith('memory:updated', {
        actor: 'memory',
        payload: { field: 'x' },
      });

      store.eventBus = null;
      expect(() => store._emit('memory:updated', { field: 'y' })).not.toThrow();
    });

    it('emits update events with timestamps', () => {
      const store = createStore();
      const emitSpy = vi.spyOn(store, '_emit');

      store._emitUpdate('field', { value: 1 });

      expect(emitSpy).toHaveBeenCalledWith('memory:updated', {
        field: 'field',
        delta: { value: 1 },
        ts: expect.any(Number),
      });
    });
  });
});
