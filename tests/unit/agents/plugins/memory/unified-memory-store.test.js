import { describe, it, expect, vi, beforeEach } from 'vitest';

const getGlobalTokenCounter = vi.fn();
const isPlainObject = vi.fn();
const toNonEmptyString = vi.fn();

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  getGlobalTokenCounter,
  isPlainObject,
  toNonEmptyString,
}));

const diffLayers = vi.fn();
vi.mock('../../../../../js/agents/plugins/memory/state-diff.js', () => ({
  diffLayers,
}));

let lastEngineOptions = null;
let lastEngineInstance = null;

const StateEngine = vi.fn();
vi.mock('../../../../../js/agents/plugins/memory/state-engine.js', () => ({
  StateEngine,
}));

const applyIndexMethods = vi.fn();
vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.index.js', () => ({
  applyIndexMethods,
}));

const applyLifecycleMethods = vi.fn();
vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.lifecycle.js', () => ({
  applyLifecycleMethods,
}));

const applyQueryMethods = vi.fn();
vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.query.js', () => ({
  applyQueryMethods,
}));

const applyWriteMethods = vi.fn();
vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.write.js', () => ({
  applyWriteMethods,
}));

const DEFAULT_CONFIG = Object.freeze({ foo: 'default', keep: true });
const genId = vi.fn();
const isFiniteNumber = vi.fn();

vi.mock('../../../../../js/agents/plugins/memory/unified-memory-store.utils.js', () => ({
  DEFAULT_CONFIG,
  genId,
  isFiniteNumber,
}));

const MODULE_PATH = '../../../../../js/agents/plugins/memory/unified-memory-store.js';

function makeDeepObject(depth) {
  let current = { leaf: true };
  for (let i = 0; i < depth; i++) current = { level: i, next: current };
  return current;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  lastEngineOptions = null;
  lastEngineInstance = null;

  getGlobalTokenCounter.mockReturnValue({ id: 'global-token-counter' });
  toNonEmptyString.mockImplementation((value) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null,
  );
  isPlainObject.mockImplementation(
    (value) => value != null && typeof value === 'object' && !Array.isArray(value),
  );

  genId.mockImplementation((prefix) => `${prefix}_generated`);
  isFiniteNumber.mockImplementation((value) => typeof value === 'number' && Number.isFinite(value));

  diffLayers.mockReturnValue({});

  StateEngine.mockImplementation(function StateEngineMock(options) {
    lastEngineOptions = options;

    const globalListeners = [];

    const engine = {
      dispatch: vi.fn((action) => Promise.resolve({ ok: true, kind: 'dispatch', action })),
      dispatchSync: vi.fn((action) => ({ ok: true, kind: 'dispatchSync', action })),
      dispatchBatch: vi.fn((actions) => Promise.resolve({ ok: true, kind: 'dispatchBatch', actions })),
      dispatchBatchSync: vi.fn((actions) => ({ ok: true, kind: 'dispatchBatchSync', actions })),
      subscribe: vi.fn((listenerOrLayer, layerListener) => {
        void layerListener;
        if (typeof listenerOrLayer === 'function') globalListeners.push(listenerOrLayer);
        return vi.fn();
      }),
      subscribeLayer: vi.fn((layer, listener) => {
        void layer;
        void listener;
        return vi.fn();
      }),
      getActionHistory: vi.fn((limit) => ({ ok: true, kind: 'getActionHistory', limit })),
      replay: vi.fn((actions, initialState) => ({ ok: true, kind: 'replay', actions, initialState })),
      getClockValue: vi.fn(() => 123),
      receiveClockValue: vi.fn((externalSeq) => ({ ok: true, kind: 'receiveClockValue', externalSeq })),
      getState: vi.fn(() => ({ ok: true, kind: 'getState', state: options?.initialState ?? null })),
      _getStateRef: vi.fn(() => ({ ok: true, kind: '_getStateRef' })),

      __emit(action, prevState, nextState) {
        for (const listener of globalListeners) listener(action, prevState, nextState);
      },
    };

    lastEngineInstance = engine;
    return engine;
  });
});

async function importUnderTest() {
  return import(MODULE_PATH);
}

describe('UnifiedMemoryStore', () => {
  it('applies mixin methods on module load', async () => {
    const { UnifiedMemoryStore } = await importUnderTest();

    expect(applyQueryMethods).toHaveBeenCalledTimes(1);
    expect(applyWriteMethods).toHaveBeenCalledTimes(1);
    expect(applyIndexMethods).toHaveBeenCalledTimes(1);
    expect(applyLifecycleMethods).toHaveBeenCalledTimes(1);

    expect(applyQueryMethods).toHaveBeenCalledWith(UnifiedMemoryStore);
    expect(applyWriteMethods).toHaveBeenCalledWith(UnifiedMemoryStore);
    expect(applyIndexMethods).toHaveBeenCalledWith(UnifiedMemoryStore);
    expect(applyLifecycleMethods).toHaveBeenCalledWith(UnifiedMemoryStore);
  });

  describe('constructor', () => {
    it('uses provided runId when toNonEmptyString returns a value', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const store = new UnifiedMemoryStore({ runId: '  run-123  ' });

      expect(toNonEmptyString).toHaveBeenCalledWith('  run-123  ');
      expect(store.runId).toBe('run-123');
      expect(genId).not.toHaveBeenCalled();
    });

    it('falls back to genId for null/undefined/empty/whitespace runId', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const cases = [undefined, null, '', '   \n\t '];
      for (const runId of cases) {
        const store = new UnifiedMemoryStore({ runId });
        expect(store.runId).toBe('run_generated');
      }

      expect(genId).toHaveBeenCalledTimes(cases.length);
      for (const call of genId.mock.calls) expect(call[0]).toBe('run');
    });

    it('merges DEFAULT_CONFIG with options.config without mutating DEFAULT_CONFIG', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const store = new UnifiedMemoryStore({
        config: { foo: 'override', extra: { enabled: true }, emptyObj: {} },
      });

      expect(store.config).toEqual({
        foo: 'override',
        keep: true,
        extra: { enabled: true },
        emptyObj: {},
      });
      expect(DEFAULT_CONFIG).toEqual({ foo: 'default', keep: true });
    });

    it('handles tokenCounter null/undefined/falsy/custom correctly', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const storeNull = new UnifiedMemoryStore({ tokenCounter: null });
      expect(storeNull._tokenCounter).toBeNull();
      expect(getGlobalTokenCounter).not.toHaveBeenCalled();

      getGlobalTokenCounter.mockClear();

      const storeUndefined = new UnifiedMemoryStore();
      expect(storeUndefined._tokenCounter).toEqual({ id: 'global-token-counter' });
      expect(getGlobalTokenCounter).toHaveBeenCalledTimes(1);

      getGlobalTokenCounter.mockClear();

      const storeFalsyZero = new UnifiedMemoryStore({ tokenCounter: 0 });
      expect(storeFalsyZero._tokenCounter).toEqual({ id: 'global-token-counter' });
      expect(getGlobalTokenCounter).toHaveBeenCalledTimes(1);

      getGlobalTokenCounter.mockClear();

      const customCounter = { id: 'custom' };
      const storeCustom = new UnifiedMemoryStore({ tokenCounter: customCounter });
      expect(storeCustom._tokenCounter).toBe(customCounter);
      expect(getGlobalTokenCounter).not.toHaveBeenCalled();
    });

    it('accepts only object-typed optional services (including arrays)', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const embeddingService = [];
      const vectorIndex = { ok: true };
      const retrievalEngine = 'not-an-object';

      const store = new UnifiedMemoryStore({ embeddingService, vectorIndex, retrievalEngine });

      expect(store._embeddingService).toBe(embeddingService);
      expect(store._vectorIndex).toBe(vectorIndex);
      expect(store._retrievalEngine).toBeNull();
    });

    it('selects l3Storage over vfs and supports array boundary', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const l3Storage = [];
      const vfs = { fs: true };

      const store = new UnifiedMemoryStore({ l3Storage, vfs });

      expect(store._l3Storage).toBe(l3Storage);
      expect(store._vfs).toBeNull();
    });

    it('uses vfs when l3Storage is not provided as object', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const vfs = {};
      const store = new UnifiedMemoryStore({ l3Storage: 123, vfs });

      expect(store._vfs).toBe(vfs);
      expect(store._l3Storage).toBeNull();
    });

    it('passes normalized options into StateEngine and initializes internal state', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const eventBus = { id: 'bus' };
      const archiveAdapter = { id: 'archive' };
      const sharedContext = { sc: true };
      const discoveryManager = { dm: true };
      const initialState = { L0: { a: 1 }, emptyObj: {} };

      const store = new UnifiedMemoryStore({
        runId: 'my-run',
        initialState,
        maxActionHistory: 0,
        enableActionHistory: false,
        eventBus,
        archiveAdapter,
        actorId: '',
        sharedContext,
        discoveryManager,
      });

      expect(store.eventBus).toBe(eventBus);
      expect(store.archiveAdapter).toBe(archiveAdapter);
      expect(store._sharedContext).toBe(sharedContext);
      expect(store._discoveryManager).toBe(discoveryManager);

      expect(StateEngine).toHaveBeenCalledTimes(1);
      expect(lastEngineOptions).toEqual({
        initialState: { ...initialState, runId: 'my-run' },
        maxActionHistory: 0,
        enableActionHistory: false,
        eventBus,
        actorId: 'my-run',
      });

      const ctorUnsubscribe = lastEngineInstance.subscribe.mock.results[0]?.value;
      expect(store._unsubscribeEngine).toBe(ctorUnsubscribe);

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
    });

    it('defaults maxActionHistory when given a string and accepts boundary numbers', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      new UnifiedMemoryStore({ maxActionHistory: '10' });
      expect(lastEngineOptions.maxActionHistory).toBe(1000);

      new UnifiedMemoryStore({ maxActionHistory: -1 });
      expect(lastEngineOptions.maxActionHistory).toBe(-1);

      new UnifiedMemoryStore({ maxActionHistory: Number.MAX_SAFE_INTEGER });
      expect(lastEngineOptions.maxActionHistory).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('ignores non-plain initialState values and does not throw', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const storeArray = new UnifiedMemoryStore({ initialState: [] });
      expect(lastEngineOptions.initialState).toEqual({ runId: storeArray.runId });

      const storeNull = new UnifiedMemoryStore({ initialState: null });
      expect(lastEngineOptions.initialState).toEqual({ runId: storeNull.runId });
    });

    it('marks dirty layers based on diffLayers output (rapid consecutive emits)', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      diffLayers.mockReturnValue({ L0: true, L1: false, L2: true, L3: false });

      const store = new UnifiedMemoryStore();
      store._markDirty = vi.fn();

      lastEngineInstance.__emit({ type: 'A' }, { x: 1 }, { x: 2 });
      lastEngineInstance.__emit({ type: 'B' }, { y: 1 }, { y: 2 });

      expect(diffLayers).toHaveBeenCalledTimes(2);
      expect(store._markDirty).toHaveBeenCalledTimes(4);
      expect(store._markDirty).toHaveBeenCalledWith('L0');
      expect(store._markDirty).toHaveBeenCalledWith('L2');
      expect(store._markDirty).not.toHaveBeenCalledWith('L1');
      expect(store._markDirty).not.toHaveBeenCalledWith('L3');
    });

    it('handles deep initialState and very long runId (resource boundary)', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();

      const longRunId = 'x'.repeat(50_000);
      const deep = makeDeepObject(75);

      const store = new UnifiedMemoryStore({ runId: longRunId, initialState: { deep } });

      expect(store.runId).toBe(longRunId);
      expect(lastEngineOptions.initialState).toEqual({ deep, runId: longRunId });
    });

    it('throws when options is null (error handling)', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();
      expect(() => new UnifiedMemoryStore(null)).toThrow();
    });
  });

  describe('delegated APIs', () => {
    it('delegates dispatch methods and returns engine results', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();
      const store = new UnifiedMemoryStore();

      const action = { type: 'X', payload: { n: 1 } };
      const actions = Array.from({ length: 10_000 }, (_, i) => ({ type: 'BATCH', i }));

      lastEngineInstance.dispatch.mockResolvedValueOnce('r1');
      lastEngineInstance.dispatchSync.mockReturnValueOnce('r2');
      lastEngineInstance.dispatchBatch.mockResolvedValueOnce('r3');
      lastEngineInstance.dispatchBatchSync.mockReturnValueOnce('r4');

      await expect(store.dispatch(action)).resolves.toBe('r1');
      expect(lastEngineInstance.dispatch).toHaveBeenCalledWith(action);

      expect(store.dispatchSync(action)).toBe('r2');
      expect(lastEngineInstance.dispatchSync).toHaveBeenCalledWith(action);

      await expect(store.dispatchBatch(actions)).resolves.toBe('r3');
      expect(lastEngineInstance.dispatchBatch).toHaveBeenCalledWith(actions);

      expect(store.dispatchBatchSync(actions)).toBe('r4');
      expect(lastEngineInstance.dispatchBatchSync).toHaveBeenCalledWith(actions);

      const emptyActions = [];
      store.dispatchBatchSync(emptyActions);
      expect(lastEngineInstance.dispatchBatchSync).toHaveBeenCalledWith(emptyActions);
    });

    it('propagates errors from the underlying engine', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();
      const store = new UnifiedMemoryStore();

      lastEngineInstance.dispatchSync.mockImplementation(() => {
        throw new Error('boom');
      });

      expect(() => store.dispatchSync({ type: 'ERR' })).toThrow('boom');
    });

    it('delegates subscription/history/clock/state helpers and preserves arguments', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();
      const store = new UnifiedMemoryStore();

      // Clear constructor subscription call
      lastEngineInstance.subscribe.mockClear();

      const listener = vi.fn();
      const layerListener = vi.fn();
      const unsubscribe = vi.fn();
      const layerUnsub = vi.fn();

      lastEngineInstance.subscribe.mockReturnValue(unsubscribe);
      lastEngineInstance.subscribeLayer.mockReturnValue(layerUnsub);

      expect(store.subscribe(listener)).toBe(unsubscribe);
      expect(store.subscribe('L0', layerListener)).toBe(unsubscribe);
      expect(lastEngineInstance.subscribe).toHaveBeenCalledTimes(2);
      expect(lastEngineInstance.subscribe).toHaveBeenNthCalledWith(1, listener, undefined);
      expect(lastEngineInstance.subscribe).toHaveBeenNthCalledWith(2, 'L0', layerListener);

      expect(store.subscribeLayer('L1', layerListener)).toBe(layerUnsub);
      expect(lastEngineInstance.subscribeLayer).toHaveBeenCalledWith('L1', layerListener);

      expect(store.getActionHistory(0)).toEqual({ ok: true, kind: 'getActionHistory', limit: 0 });
      expect(lastEngineInstance.getActionHistory).toHaveBeenCalledWith(0);

      const replayActions = [{ type: 'R' }];
      const replayState = { s: 1 };
      expect(store.replay(replayActions, replayState)).toEqual({
        ok: true,
        kind: 'replay',
        actions: replayActions,
        initialState: replayState,
      });
      expect(lastEngineInstance.replay).toHaveBeenCalledWith(replayActions, replayState);

      expect(store.getClockValue()).toBe(123);
      expect(lastEngineInstance.getClockValue).toHaveBeenCalledWith();

      expect(store.receiveClockValue(0)).toEqual({ ok: true, kind: 'receiveClockValue', externalSeq: 0 });
      expect(lastEngineInstance.receiveClockValue).toHaveBeenCalledWith(0);

      expect(store.getState()).toEqual({ ok: true, kind: 'getState', state: lastEngineOptions.initialState });
      expect(lastEngineInstance.getState).toHaveBeenCalledWith();

      expect(store._getStateRef()).toEqual({ ok: true, kind: '_getStateRef' });
      expect(lastEngineInstance._getStateRef).toHaveBeenCalledWith();
    });

    it('supports concurrent dispatch calls (concurrency boundary)', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();
      const store = new UnifiedMemoryStore();

      lastEngineInstance.dispatch.mockImplementation(async (action) => ({ action }));

      const a1 = { type: 'A', payload: { text: ' '.repeat(10) } };
      const a2 = { type: 'B', payload: { text: 'x'.repeat(1_000) } };

      const [r1, r2] = await Promise.all([store.dispatch(a1), store.dispatch(a2)]);

      expect(r1).toEqual({ action: a1 });
      expect(r2).toEqual({ action: a2 });
      expect(lastEngineInstance.dispatch).toHaveBeenCalledTimes(2);
    });

    it('passes through non-array actions object to dispatchBatch (type boundary)', async () => {
      const { UnifiedMemoryStore } = await importUnderTest();
      const store = new UnifiedMemoryStore();

      const notAnArray = { 0: { type: 'X' }, length: 1 };
      lastEngineInstance.dispatchBatch.mockResolvedValueOnce('ok');

      await expect(store.dispatchBatch(notAnArray)).resolves.toBe('ok');
      expect(lastEngineInstance.dispatchBatch).toHaveBeenCalledWith(notAnArray);
    });
  });
});

describe('default export', () => {
  it('is the same as the named UnifiedMemoryStore export', async () => {
    const mod = await importUnderTest();
    expect(mod.default).toBe(mod.UnifiedMemoryStore);
  });

  it('constructs via default export with the same core behavior', async () => {
    const { default: UnifiedMemoryStoreDefault } = await importUnderTest();
    const store = new UnifiedMemoryStoreDefault({ runId: 'default-run' });

    expect(store.runId).toBe('default-run');
    expect(StateEngine).toHaveBeenCalledTimes(1);
  });
});
