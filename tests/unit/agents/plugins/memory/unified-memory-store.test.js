import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedMocks = vi.hoisted(() => ({
  getGlobalTokenCounter: vi.fn(() => ({ source: 'global' })),
  isPlainObject: vi.fn((value) => value !== null && typeof value === 'object' && !Array.isArray(value)),
  toNonEmptyString: vi.fn((value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }),
}));

const diffLayersMock = vi.hoisted(() =>
  vi.fn(() => ({
    L0: true,
    L1: false,
    L2: true,
    L3: false,
  }))
);

const utilsMocks = vi.hoisted(() => ({
  DEFAULT_CONFIG: { base: true, limit: 10 },
  genId: vi.fn((prefix) => `${prefix}-generated`),
  isFiniteNumber: vi.fn((value) => typeof value === 'number' && Number.isFinite(value)),
}));

const applyMocks = vi.hoisted(() => ({
  applyQueryMethods: vi.fn(),
  applyWriteMethods: vi.fn(),
  applyIndexMethods: vi.fn(),
  applyLifecycleMethods: vi.fn((Store) => {
    Store.prototype._markDirty = vi.fn(function markDirty(layer) {
      if (!this._dirty || typeof this._dirty !== 'object') {
        this._dirty = {};
      }
      this._dirty[layer] = true;
    });
  }),
}));

const stateEngineState = vi.hoisted(() => ({
  instances: [],
}));

const MockStateEngine = vi.hoisted(() => {
  return class MockStateEngine {
    constructor(options) {
      this.options = options;
      this.dispatch = vi.fn((action) => ({ dispatched: action }));
      this.dispatchSync = vi.fn((action) => ({ sync: action }));
      this.dispatchBatch = vi.fn((actions) => actions);
      this.dispatchBatchSync = vi.fn((actions) => actions);
      this.subscribe = vi.fn((listenerOrLayer, layerListener) => {
        const listener =
          typeof listenerOrLayer === 'function' ? listenerOrLayer : layerListener;
        this._listener = listener;
        this._unsubscribe = vi.fn();
        return this._unsubscribe;
      });
      this.subscribeLayer = vi.fn(() => 'layer-sub');
      this.getActionHistory = vi.fn((limit) => (limit ? Array(limit).fill('x') : []));
      this.replay = vi.fn((actions, initialState) => ({ actions, initialState }));
      this.getClockValue = vi.fn(() => 123);
      this.receiveClockValue = vi.fn((seq) => seq);
      this.getState = vi.fn(() => ({ state: true }));
      this._getStateRef = vi.fn(() => ({ ref: true }));

      stateEngineState.instances.push(this);
    }
  };
});

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  getGlobalTokenCounter: sharedMocks.getGlobalTokenCounter,
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
}));

vi.mock('../../../../../js/agents/plugins/memory/state-diff.js', () => ({
  diffLayers: diffLayersMock,
}));

vi.mock('../../../../../js/agents/plugins/memory/state-engine.js', () => ({
  StateEngine: MockStateEngine,
}));

vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.index.js', () => ({
  applyIndexMethods: applyMocks.applyIndexMethods,
}));

vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.lifecycle.js', () => ({
  applyLifecycleMethods: applyMocks.applyLifecycleMethods,
}));

vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.query.js', () => ({
  applyQueryMethods: applyMocks.applyQueryMethods,
}));

vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.write.js', () => ({
  applyWriteMethods: applyMocks.applyWriteMethods,
}));

vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.utils.js', () => ({
  DEFAULT_CONFIG: utilsMocks.DEFAULT_CONFIG,
  genId: utilsMocks.genId,
  isFiniteNumber: utilsMocks.isFiniteNumber,
}));

import UnifiedMemoryStoreDefault, {
  UnifiedMemoryStore,
} from '../../../../../js/agents/plugins/memory/unified-memory-store.js';

const HUGE_STRING = 'x'.repeat(100000);
const HUGE_FILE_CONTENT = 'f'.repeat(1024 * 1024);

const buildDeepNested = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  current.leaf = 'end';
  return root;
};

let globalTokenCounter;

beforeEach(() => {
  vi.clearAllMocks();
  stateEngineState.instances.length = 0;
  globalTokenCounter = { source: 'global' };
  sharedMocks.getGlobalTokenCounter.mockReturnValue(globalTokenCounter);
  diffLayersMock.mockReturnValue({ L0: true, L1: false, L2: true, L3: false });
});

describe('UnifiedMemoryStore', () => {
  it('initializes with defaults and wires StateEngine', () => {
    utilsMocks.genId.mockReturnValueOnce('run-default');

    const store = new UnifiedMemoryStore();
    const engine = stateEngineState.instances[0];

    expect(store.runId).toBe('run-default');
    expect(utilsMocks.genId).toHaveBeenCalledWith('run');
    expect(store.config).toEqual(utilsMocks.DEFAULT_CONFIG);
    expect(store.eventBus).toBe(null);
    expect(store.archiveAdapter).toBe(null);
    expect(store._tokenCounter).toBe(globalTokenCounter);
    expect(sharedMocks.getGlobalTokenCounter).toHaveBeenCalledTimes(1);

    expect(store._embeddingService).toBe(null);
    expect(store._vectorIndex).toBe(null);
    expect(store._retrievalEngine).toBe(null);
    expect(store._sharedContext).toBe(null);
    expect(store._discoveryManager).toBe(null);

    expect(store._vfs).toBe(null);
    expect(store._l3Storage).toBe(null);
    expect(store._l3StoragePromise).toBe(null);

    expect(store._stats).toEqual({
      l0Tokens: 0,
      l1Tokens: 0,
      l2Tokens: 0,
      tokenUsage: 0,
      compressionCount: 0,
      recallCount: 0,
    });
    expect(store._dirty).toEqual({ L0: true, L1: true, L2: true, L3: false });
    expect(store._lastSnapshotTs).toBe(0);
    expect(store._l3BytesUsed).toBe(0);

    expect(engine.options).toEqual({
      initialState: { runId: 'run-default' },
      maxActionHistory: 1000,
      enableActionHistory: true,
      eventBus: null,
      actorId: 'run-default',
    });
    expect(engine.subscribe).toHaveBeenCalledTimes(1);
    expect(typeof engine.subscribe.mock.calls[0][0]).toBe('function');
    expect(store._unsubscribeEngine).toBe(engine._unsubscribe);
  });

  it('merges config and respects provided options', () => {
    const eventBus = { emit: vi.fn() };
    const archiveAdapter = { save: vi.fn() };
    const tokenCounter = { count: vi.fn() };
    const embeddingService = { embed: vi.fn() };
    const vectorIndex = { search: vi.fn() };
    const retrievalEngine = { query: vi.fn() };
    const sharedContext = { id: 'ctx' };
    const discoveryManager = { discover: vi.fn() };

    const store = new UnifiedMemoryStore({
      runId: '  RUN-001  ',
      config: { limit: 5 },
      eventBus,
      archiveAdapter,
      tokenCounter,
      embeddingService,
      vectorIndex,
      retrievalEngine,
      sharedContext,
      discoveryManager,
      actorId: 'actor-1',
      enableActionHistory: false,
      maxActionHistory: -1,
      initialState: { status: 'ok' },
    });

    const engine = stateEngineState.instances[0];

    expect(store.runId).toBe('RUN-001');
    expect(sharedMocks.toNonEmptyString).toHaveBeenCalledWith('  RUN-001  ');
    expect(utilsMocks.genId).not.toHaveBeenCalled();
    expect(store.config).toEqual({ ...utilsMocks.DEFAULT_CONFIG, limit: 5 });
    expect(store.eventBus).toBe(eventBus);
    expect(store.archiveAdapter).toBe(archiveAdapter);
    expect(store._tokenCounter).toBe(tokenCounter);
    expect(sharedMocks.getGlobalTokenCounter).not.toHaveBeenCalled();

    expect(store._embeddingService).toBe(embeddingService);
    expect(store._vectorIndex).toBe(vectorIndex);
    expect(store._retrievalEngine).toBe(retrievalEngine);
    expect(store._sharedContext).toBe(sharedContext);
    expect(store._discoveryManager).toBe(discoveryManager);

    expect(engine.options).toEqual({
      initialState: { status: 'ok', runId: 'RUN-001' },
      maxActionHistory: -1,
      enableActionHistory: false,
      eventBus,
      actorId: 'actor-1',
    });
  });

  it('handles null and empty inputs with boundary values', () => {
    const vfs = { root: 'mem' };
    utilsMocks.genId.mockReturnValueOnce('run-empty');

    const store = new UnifiedMemoryStore({
      runId: '',
      initialState: null,
      tokenCounter: null,
      config: {},
      enableActionHistory: 0,
      maxActionHistory: 0,
      actorId: '',
      l3Storage: 'bad',
      vfs,
      embeddingService: 'not-object',
      vectorIndex: {},
      retrievalEngine: null,
      sharedContext: null,
      discoveryManager: undefined,
    });

    const engine = stateEngineState.instances[0];

    expect(store.runId).toBe('run-empty');
    expect(store.config).toEqual(utilsMocks.DEFAULT_CONFIG);
    expect(store._tokenCounter).toBe(null);
    expect(sharedMocks.getGlobalTokenCounter).not.toHaveBeenCalled();

    expect(store._vfs).toBe(vfs);
    expect(store._l3Storage).toBe(null);

    expect(store._embeddingService).toBe(null);
    expect(store._vectorIndex).toEqual({});
    expect(store._retrievalEngine).toBe(null);
    expect(store._sharedContext).toBe(null);
    expect(store._discoveryManager).toBe(null);

    expect(engine.options).toEqual({
      initialState: { runId: 'run-empty' },
      maxActionHistory: 0,
      enableActionHistory: true,
      eventBus: null,
      actorId: 'run-empty',
    });
  });

  it.each([
    ['negative', -1],
    ['max', Number.MAX_SAFE_INTEGER],
  ])('uses finite maxActionHistory for %s values', (_label, value) => {
    const store = new UnifiedMemoryStore({ maxActionHistory: value });
    const engine = stateEngineState.instances[0];

    expect(store.runId).toBeDefined();
    expect(engine.options.maxActionHistory).toBe(value);
  });

  it.each([
    ['string', '10'],
    ['object', { count: 1 }],
    ['nan', Number.NaN],
  ])('falls back to default maxActionHistory for %s values', (_label, value) => {
    const store = new UnifiedMemoryStore({ maxActionHistory: value });
    const engine = stateEngineState.instances[0];

    expect(store.runId).toBeDefined();
    expect(engine.options.maxActionHistory).toBe(1000);
  });

  it('prefers explicit l3Storage over vfs', () => {
    const l3Storage = { id: 'l3' };
    const vfs = { root: 'vfs' };

    const store = new UnifiedMemoryStore({ l3Storage, vfs });

    expect(store._l3Storage).toBe(l3Storage);
    expect(store._vfs).toBe(null);
  });

  it('passes deep nested and large initialState data', () => {
    const deep = buildDeepNested(20);
    const initialState = {
      deep,
      text: HUGE_STRING,
      file: HUGE_FILE_CONTENT,
      emptyArray: [],
      emptyObject: {},
    };

    const store = new UnifiedMemoryStore({
      runId: '  big-run  ',
      initialState,
    });

    const engine = stateEngineState.instances[0];

    expect(store.runId).toBe('big-run');
    expect(engine.options.initialState).toEqual({ ...initialState, runId: 'big-run' });
    expect(engine.options.initialState.text.length).toBe(HUGE_STRING.length);
    expect(engine.options.initialState.file.length).toBe(HUGE_FILE_CONTENT.length);
    expect(engine.options.initialState.deep).toEqual(deep);
    expect(engine.options.initialState.emptyArray).toEqual([]);
    expect(engine.options.initialState.emptyObject).toEqual({});
  });

  it('marks dirty layers from state diffs', () => {
    const store = new UnifiedMemoryStore();
    const engine = stateEngineState.instances[0];

    store._dirty = { L0: false, L1: false, L2: false, L3: false };
    diffLayersMock.mockReturnValue({ L0: true, L1: false, L2: true, L3: false });

    const prevState = { value: 1 };
    const nextState = { value: 2 };
    engine._listener({ type: 'TEST' }, prevState, nextState);

    expect(diffLayersMock).toHaveBeenCalledWith(prevState, nextState);
    expect(store._markDirty).toHaveBeenCalledTimes(2);
    expect(store._markDirty).toHaveBeenCalledWith('L0');
    expect(store._markDirty).toHaveBeenCalledWith('L2');
    expect(store._dirty).toEqual({ L0: true, L1: false, L2: true, L3: false });
  });

  it('skips dirty marking when diff has no changes', () => {
    const store = new UnifiedMemoryStore();
    const engine = stateEngineState.instances[0];

    diffLayersMock.mockReturnValue({ L0: false, L1: false });
    engine._listener({ type: 'TEST' }, {}, {});

    expect(store._markDirty).not.toHaveBeenCalled();
  });

  it('delegates dispatch variants and supports concurrent calls', async () => {
    const store = new UnifiedMemoryStore();
    const engine = stateEngineState.instances[0];

    engine.dispatch.mockImplementation((action) => Promise.resolve({ ok: action.type }));
    engine.dispatchBatch.mockImplementation((actions) =>
      Promise.resolve(actions.map((action) => action.type))
    );
    engine.dispatchSync.mockImplementation((action) => ({ sync: action.type }));
    engine.dispatchBatchSync.mockImplementation((actions) => ({ batchSync: actions }));

    const [first, second] = await Promise.all([
      store.dispatch({ type: 'A' }),
      store.dispatch({ type: 'B' }),
    ]);

    expect(first).toEqual({ ok: 'A' });
    expect(second).toEqual({ ok: 'B' });
    expect(engine.dispatch).toHaveBeenCalledTimes(2);

    const emptyBatch = await store.dispatchBatch([]);
    expect(emptyBatch).toEqual([]);

    const batchResult = await store.dispatchBatch([{ type: 'C' }, { type: 'D' }]);
    expect(batchResult).toEqual(['C', 'D']);

    const syncResults = [
      store.dispatchSync({ type: 'S1' }),
      store.dispatchSync({ type: 'S2' }),
      store.dispatchSync({ type: 'S3' }),
    ];
    expect(syncResults).toEqual([
      { sync: 'S1' },
      { sync: 'S2' },
      { sync: 'S3' },
    ]);

    const batchSyncInput = { not: 'array' };
    const batchSyncResult = store.dispatchBatchSync(batchSyncInput);
    expect(batchSyncResult).toEqual({ batchSync: batchSyncInput });
    expect(engine.dispatchBatchSync).toHaveBeenCalledWith(batchSyncInput);
  });

  it('propagates errors from engine dispatch', () => {
    const store = new UnifiedMemoryStore();
    const engine = stateEngineState.instances[0];
    const error = new Error('boom');

    engine.dispatch.mockImplementation(() => {
      throw error;
    });

    expect(() => store.dispatch({ type: 'BAD' })).toThrow('boom');
    expect(engine.dispatch).toHaveBeenCalledWith({ type: 'BAD' });
  });

  it('delegates subscription and state accessors', () => {
    const store = new UnifiedMemoryStore();
    const engine = stateEngineState.instances[0];
    const listener = vi.fn();
    const layerListener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    expect(engine.subscribe).toHaveBeenCalledWith(listener, undefined);
    expect(unsubscribe).toBe(engine._unsubscribe);

    const layerUnsubscribe = store.subscribe('L1', layerListener);
    expect(engine.subscribe).toHaveBeenCalledWith('L1', layerListener);
    expect(layerUnsubscribe).toBe(engine._unsubscribe);

    const layerResult = store.subscribeLayer('L2', layerListener);
    expect(engine.subscribeLayer).toHaveBeenCalledWith('L2', layerListener);
    expect(layerResult).toBe('layer-sub');

    expect(store.getActionHistory(0)).toEqual([]);
    expect(engine.getActionHistory).toHaveBeenCalledWith(0);

    const replayResult = store.replay([{ type: 'A' }], { runId: 'x' });
    expect(engine.replay).toHaveBeenCalledWith([{ type: 'A' }], { runId: 'x' });
    expect(replayResult).toEqual({ actions: [{ type: 'A' }], initialState: { runId: 'x' } });

    expect(store.getClockValue()).toBe(123);
    expect(engine.getClockValue).toHaveBeenCalledTimes(1);

    expect(store.receiveClockValue(7)).toBe(7);
    expect(engine.receiveClockValue).toHaveBeenCalledWith(7);

    expect(store.getState()).toEqual({ state: true });
    expect(engine.getState).toHaveBeenCalledTimes(1);

    expect(store._getStateRef()).toEqual({ ref: true });
    expect(engine._getStateRef).toHaveBeenCalledTimes(1);
  });
});

describe('default', () => {
  it('exports UnifiedMemoryStore as default', () => {
    expect(UnifiedMemoryStoreDefault).toBe(UnifiedMemoryStore);
  });
});
