import { describe, it, expect, vi, beforeEach } from 'vitest';

const retrievalEngineState = vi.hoisted(() => {
  const instances = [];
  const next = {
    recallResult: 'recall-result',
    semanticResult: 'semantic-result',
    hybridResult: 'hybrid-result',
    recallImpl: null,
    semanticImpl: null,
    hybridImpl: null,
  };

  const buildMethod = (name) =>
    vi.fn((...args) => {
      const impl = next[`${name}Impl`];
      if (impl) {
        return impl(...args);
      }
      return next[`${name}Result`];
    });

  const RetrievalEngine = vi.fn(function RetrievalEngine(options) {
    const instance = {
      options,
      recall: buildMethod('recall'),
      semanticRecall: buildMethod('semantic'),
      hybridRecall: buildMethod('hybrid'),
    };
    instances.push(instance);
    return instance;
  });

  return { instances, next, RetrievalEngine };
});

vi.mock('../../../../../js/agents/plugins/memory/retrieval-engine.js', () => ({
  RetrievalEngine: retrievalEngineState.RetrievalEngine,
}));

import { applyIndexMethods } from '../../../../../js/agents/plugins/memory/unified-memory-store.index.js';

const buildDeepNested = (depth = 25) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.child = { level: i, items: [i, i + 1] };
    current = current.child;
  }
  current.leaf = 'end';
  return root;
};

const createStore = (overrides = {}) => {
  class UnifiedMemoryStore {
    constructor() {
      this._stats = overrides._stats ?? { recallCount: 0 };
      this._embeddingService = overrides._embeddingService ?? { id: 'embed' };
      this._vectorIndex = overrides._vectorIndex ?? { id: 'vector' };
      this.eventBus = overrides.eventBus ?? { id: 'bus' };
      this._retrievalEngine = overrides._retrievalEngine;
    }
  }

  applyIndexMethods(UnifiedMemoryStore);
  return new UnifiedMemoryStore();
};

beforeEach(() => {
  vi.clearAllMocks();
  retrievalEngineState.instances.length = 0;
  retrievalEngineState.next.recallResult = 'recall-result';
  retrievalEngineState.next.semanticResult = 'semantic-result';
  retrievalEngineState.next.hybridResult = 'hybrid-result';
  retrievalEngineState.next.recallImpl = null;
  retrievalEngineState.next.semanticImpl = null;
  retrievalEngineState.next.hybridImpl = null;
});

describe('applyIndexMethods', () => {
  it('attaches index methods and constructs retrieval engine with store context', () => {
    const embeddingService = { name: 'embed' };
    const vectorIndex = { name: 'vector' };
    const eventBus = { name: 'bus' };
    const store = createStore({
      _embeddingService: embeddingService,
      _vectorIndex: vectorIndex,
      eventBus,
    });

    expect(typeof store._getRetrievalEngine).toBe('function');
    expect(typeof store.recall).toBe('function');
    expect(typeof store.semanticRecall).toBe('function');
    expect(typeof store.hybridRecall).toBe('function');

    const engine = store._getRetrievalEngine();

    expect(retrievalEngineState.RetrievalEngine).toHaveBeenCalledTimes(1);
    expect(retrievalEngineState.RetrievalEngine).toHaveBeenCalledWith({
      memoryStore: store,
      embeddingService,
      vectorIndex,
      eventBus,
    });
    expect(engine).toBe(retrievalEngineState.instances[0]);
    expect(store._retrievalEngine).toBe(engine);
  });

  it('returns cached engine when valid and avoids new construction', () => {
    const cached = {
      recall: vi.fn(() => 'cached'),
      semanticRecall: vi.fn(),
      hybridRecall: vi.fn(),
    };
    const store = createStore({ _retrievalEngine: cached });

    const engine = store._getRetrievalEngine();

    expect(engine).toBe(cached);
    expect(retrievalEngineState.RetrievalEngine).not.toHaveBeenCalled();

    const result = store.recall('query');
    expect(result).toBe('cached');
    expect(cached.recall).toHaveBeenCalledWith('query', 3);
    expect(store._stats.recallCount).toBe(1);
    expect(retrievalEngineState.RetrievalEngine).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['empty array', []],
    ['empty object', {}],
    ['missing recall function', { recall: 'nope' }],
  ])('creates new retrieval engine when cached value is %s', (_label, cached) => {
    const store = createStore({ _retrievalEngine: cached });

    const engine = store._getRetrievalEngine();

    expect(retrievalEngineState.RetrievalEngine).toHaveBeenCalledTimes(1);
    expect(engine).toBe(retrievalEngineState.instances[0]);
    expect(store._retrievalEngine).toBe(engine);
  });

  it('recall forwards boundary inputs on rapid consecutive calls', () => {
    const store = createStore();
    const emptyArray = [];
    const emptyObject = {};

    const cases = [
      { query: null, limit: 0, expectedLimit: 0 },
      { query: undefined, limit: -1, expectedLimit: -1 },
      { query: '', limit: Number.MAX_SAFE_INTEGER, expectedLimit: Number.MAX_SAFE_INTEGER },
      { query: '   ', limit: '2', expectedLimit: '2' },
      { query: emptyArray, limit: 3, expectedLimit: 3 },
      { query: emptyObject, limit: undefined, expectedLimit: 3 },
    ];

    const results = cases.map(({ query, limit }) =>
      limit === undefined ? store.recall(query) : store.recall(query, limit)
    );

    const engine = retrievalEngineState.instances[0];
    const expectedCalls = cases.map(({ query, expectedLimit }) => [query, expectedLimit]);

    expect(results).toEqual(cases.map(() => 'recall-result'));
    expect(engine.recall.mock.calls).toEqual(expectedCalls);
    expect(store._stats.recallCount).toBe(cases.length);
    expect(retrievalEngineState.RetrievalEngine).toHaveBeenCalledTimes(1);
  });

  it('recall propagates engine errors and still increments stats', () => {
    retrievalEngineState.next.recallImpl = () => {
      throw new Error('boom');
    };

    const store = createStore();

    expect(() => store.recall('explode')).toThrow('boom');
    expect(store._stats.recallCount).toBe(1);
    expect(retrievalEngineState.instances[0].recall).toHaveBeenCalledWith('explode', 3);
  });

  it('semanticRecall handles concurrent calls and forwards array-like options', async () => {
    retrievalEngineState.next.semanticImpl = (query, options) =>
      Promise.resolve({ query, options });

    const store = createStore();
    const arrayLike = { 0: 'alpha', 1: 'beta', length: 2 };

    const [first, second] = await Promise.all([
      store.semanticRecall('first', arrayLike),
      store.semanticRecall('second', null),
    ]);

    const engine = retrievalEngineState.instances[0];

    expect(first).toEqual({ query: 'first', options: arrayLike });
    expect(second).toEqual({ query: 'second', options: null });
    expect(engine.semanticRecall.mock.calls).toEqual([
      ['first', arrayLike],
      ['second', null],
    ]);
    expect(store._stats.recallCount).toBe(2);
    expect(retrievalEngineState.RetrievalEngine).toHaveBeenCalledTimes(1);
  });

  it('semanticRecall propagates rejections and increments stats', async () => {
    retrievalEngineState.next.semanticImpl = () => Promise.reject(new Error('semantic fail'));

    const store = createStore();

    await expect(store.semanticRecall('query', undefined)).rejects.toThrow('semantic fail');
    expect(store._stats.recallCount).toBe(1);
  });

  it('hybridRecall forwards resource-heavy inputs', async () => {
    const longText = 'x'.repeat(120000);
    const hugeFile = 'f'.repeat(1024 * 1024);
    const deepNested = buildDeepNested(30);
    const options = { file: hugeFile, meta: deepNested, list: [] };

    retrievalEngineState.next.hybridImpl = (query, opts) => ({ query, options: opts });

    const store = createStore();
    const result = await store.hybridRecall(longText, options);

    expect(result).toEqual({ query: longText, options });
    expect(retrievalEngineState.instances[0].hybridRecall).toHaveBeenCalledWith(longText, options);
    expect(store._stats.recallCount).toBe(1);
  });
});
