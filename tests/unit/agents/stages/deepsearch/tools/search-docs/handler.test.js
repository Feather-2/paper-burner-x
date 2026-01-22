import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockMmrSelect,
  mockIsPlainObject,
  mockGetGlobalCircuitBreakerRegistry,
  sourceManagerState,
  embeddingState,
} = vi.hoisted(() => ({
  mockMmrSelect: vi.fn(),
  mockIsPlainObject: vi.fn(),
  mockGetGlobalCircuitBreakerRegistry: vi.fn(),
  sourceManagerState: {
    instances: [],
    searchResults: [],
    semanticSearchResults: undefined,
    searchImpl: null,
    semanticSearchImpl: null,
    getSourceImpl: null,
    syncSourcesImpl: null,
  },
  embeddingState: {
    instances: [],
    status: null,
    throwStatus: false,
  },
}));

vi.mock("../../../../../../../js/agents/retrieval/mmr.js", () => ({
  mmrSelect: (...args) => mockMmrSelect(...args),
}));

vi.mock("../../../../../../../js/agents/shared/index.js", () => {
  class EmbeddingServiceMock {
    constructor(cfg, opts) {
      this.cfg = cfg;
      this.opts = opts;
      this.embed = vi.fn();
      this.getStatus = vi.fn(() => {
        if (embeddingState.throwStatus) {
          throw new Error("status check failed");
        }
        return embeddingState.status ?? { endpoint: cfg?.endpoint ?? cfg?.url };
      });
      embeddingState.instances.push(this);
    }
  }

  return {
    EmbeddingService: EmbeddingServiceMock,
    getGlobalCircuitBreakerRegistry: (...args) => mockGetGlobalCircuitBreakerRegistry(...args),
    isPlainObject: (...args) => mockIsPlainObject(...args),
  };
});

vi.mock("../../../../../../../js/agents/stages/deepsearch/source-manager.js", () => {
  class SourceManagerMock {
    constructor(sources = []) {
      this.sources = Array.isArray(sources) ? sources : [];
      this.syncSources = vi.fn((nextSources) => {
        if (sourceManagerState.syncSourcesImpl) {
          return sourceManagerState.syncSourcesImpl(nextSources, this);
        }
        if (Array.isArray(nextSources)) this.sources = nextSources;
      });
      this.getSource = vi.fn((id) => {
        if (sourceManagerState.getSourceImpl) {
          return sourceManagerState.getSourceImpl(id, this);
        }
        return this.sources.find((src) => src && src.id === id);
      });
      this.search = vi.fn((query, options) => {
        if (sourceManagerState.searchImpl) {
          return sourceManagerState.searchImpl(query, options, this);
        }
        return sourceManagerState.searchResults;
      });
      this.semanticSearch = vi.fn(async (query, options) => {
        if (sourceManagerState.semanticSearchImpl) {
          return sourceManagerState.semanticSearchImpl(query, options, this);
        }
        return sourceManagerState.semanticSearchResults ?? sourceManagerState.searchResults;
      });
      sourceManagerState.instances.push(this);
    }
  }

  return { default: SourceManagerMock };
});

const importModule = async () =>
  import("../../../../../../../js/agents/stages/deepsearch/tools/search-docs/handler.js");

const createBreaker = ({ canExecute = true, executeImpl } = {}) => ({
  canExecute: vi.fn(() => canExecute),
  execute: vi.fn(async (fn) => (executeImpl ? executeImpl(fn) : fn())),
});

const createRegistry = (breaker) => ({
  get: vi.fn(() => breaker),
});

const createContext = (overrides = {}) => ({
  state: { L0: { sources: [{ id: "s1" }, { id: "s2" }] } },
  emit: vi.fn(),
  ...overrides,
});

const getLastManager = () => sourceManagerState.instances[sourceManagerState.instances.length - 1];

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  mockMmrSelect.mockReset();
  mockIsPlainObject.mockReset();
  mockGetGlobalCircuitBreakerRegistry.mockReset();
  sourceManagerState.instances = [];
  sourceManagerState.searchResults = [];
  sourceManagerState.semanticSearchResults = undefined;
  sourceManagerState.searchImpl = null;
  sourceManagerState.semanticSearchImpl = null;
  sourceManagerState.getSourceImpl = null;
  sourceManagerState.syncSourcesImpl = null;
  embeddingState.instances = [];
  embeddingState.status = null;
  embeddingState.throwStatus = false;

  mockIsPlainObject.mockImplementation((value) => {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  mockMmrSelect.mockImplementation((candidates, options) => {
    const topK = Number.isFinite(options?.topK) ? options.topK : candidates.length;
    return candidates.slice(0, topK);
  });

  const breaker = createBreaker();
  const registry = createRegistry(breaker);
  mockGetGlobalCircuitBreakerRegistry.mockReturnValue(registry);
});

describe("definition", () => {
  it("exposes tool metadata", async () => {
    const { definition } = await importModule();

    expect(definition).toMatchObject({
      name: "search-docs",
      layer: 0,
      activation: {
        keywords: expect.arrayContaining(["search", "find"]),
        phases: expect.arrayContaining(["researching"]),
      },
    });
    expect(typeof definition.description).toBe("string");
  });
});

describe("default export", () => {
  it("bundles definition and handler", async () => {
    const mod = await importModule();

    expect(mod.default.definition).toBe(mod.definition);
    expect(mod.default.handler).toBe(mod.handler);
  });
});

describe("handler", () => {
  it("throws when args is not an object", async () => {
    const { handler } = await importModule();
    const context = createContext();

    await expect(handler(undefined, context)).rejects.toBeInstanceOf(TypeError);
    await expect(handler(null, context)).rejects.toBeInstanceOf(TypeError);
  });

  it("returns error when args is an empty object", async () => {
    const { handler } = await importModule();

    const result = await handler({}, createContext());

    expect(result).toEqual({ success: false, error: "query is required" });
  });

  it("returns error for missing or blank query values", async () => {
    const { handler } = await importModule();
    const context = createContext();
    const cases = [undefined, null, "", "   "];

    for (const query of cases) {
      const result = await handler({ query }, context);
      expect(result).toEqual({ success: false, error: "query is required" });
    }
  });

  it("returns empty results when no sources are available", async () => {
    const { handler } = await importModule();

    const result = await handler({ query: "topic", sources: [] }, {});

    expect(result).toEqual({ success: true, results: [], message: "No sources available" });
  });

  it("floors limit values within range", async () => {
    const { handler } = await importModule();
    const context = createContext();

    await handler({ query: "q", limit: 9.9, mmr: false }, context);

    const manager = getLastManager();
    expect(manager.search).toHaveBeenCalledWith("q", expect.objectContaining({ limit: 9 }));
  });

  it("defaults invalid limits to 10 and skips MMR when disabled", async () => {
    const { handler } = await importModule();
    const context = createContext();
    const cases = [0, -1, Number.MAX_SAFE_INTEGER, "5"];

    for (const limit of cases) {
      const result = await handler({ query: "limit", limit, mmr: false }, context);
      expect(result.success).toBe(true);
      const manager = getLastManager();
      expect(manager.search).toHaveBeenCalledWith("limit", expect.objectContaining({ limit: 10 }));
    }

    expect(mockMmrSelect).not.toHaveBeenCalled();
  });

  it("clamps semanticTimeoutMs to 60000 and passes it to semantic search", async () => {
    const { handler } = await importModule();
    sourceManagerState.semanticSearchResults = [];

    const embeddingService = { embed: vi.fn() };
    const context = createContext({ embeddingService });

    await handler({ query: "q", semanticTimeoutMs: 999999, mmr: false }, context);

    const manager = getLastManager();
    expect(manager.semanticSearch).toHaveBeenCalledTimes(1);
    const [, options] = manager.semanticSearch.mock.calls[0];
    expect(options.timeoutMs).toBe(60000);
  });

  it("omits semantic timeout when semanticTimeoutMs is invalid", async () => {
    const { handler } = await importModule();
    sourceManagerState.semanticSearchResults = [];

    const embeddingService = { embed: vi.fn() };
    const context = createContext({ embeddingService });

    await handler({ query: "q", semanticTimeoutMs: "5000", mmr: false }, context);

    const manager = getLastManager();
    expect(manager.semanticSearch).toHaveBeenCalledTimes(1);
    const [, options] = manager.semanticSearch.mock.calls[0];
    expect("timeoutMs" in options).toBe(false);
  });

  it("truncates long query strings and uses state sources when sources is not an array", async () => {
    const { handler } = await importModule();
    sourceManagerState.searchResults = [];

    const longQuery = "x".repeat(3000);
    const stateSources = [{ id: "s1" }, { id: "s2" }];
    const context = createContext({ state: { L0: { sources: stateSources } } });

    const result = await handler(
      { query: longQuery, sources: { bad: "value" }, mmr: false },
      context,
    );

    expect(result.success).toBe(true);
    const manager = getLastManager();
    const [queryArg, options] = manager.search.mock.calls[0];
    expect(queryArg).toBe(longQuery.slice(0, 2048));
    expect(options.sources).toBe(stateSources);
  });

  it("normalizes sources and caps to MAX_SOURCE_COUNT", async () => {
    const { handler } = await importModule();
    sourceManagerState.searchResults = [];
    sourceManagerState.getSourceImpl = (id) => ({ id });

    const sources = Array.from({ length: 105 }, (_, i) => (i === 0 ? " s-0 " : `s-${i}`));
    const context = createContext({ state: { L0: { sources: [{ id: "fallback" }] } } });

    const result = await handler({ query: "q", sources, mmr: false }, context);

    expect(result.success).toBe(true);
    const manager = getLastManager();
    expect(manager.getSource).toHaveBeenCalledTimes(100);
    expect(manager.getSource).toHaveBeenCalledWith("s-0");
    expect(manager.getSource.mock.calls.some(([id]) => id === "s-104")).toBe(false);

    const [, options] = manager.search.mock.calls[0];
    expect(options.sources).toHaveLength(100);
  });

  it("filters non-string and blank source IDs before lookup", async () => {
    const { handler } = await importModule();
    sourceManagerState.searchResults = [];
    sourceManagerState.getSourceImpl = (id) => ({ id });

    const context = createContext({ state: { L0: { sources: [{ id: "fallback" }] } } });
    const result = await handler(
      { query: "q", sources: ["", "   ", null, undefined, 1, {}, " s1 "], mmr: false },
      context,
    );

    expect(result.success).toBe(true);
    const manager = getLastManager();
    expect(manager.getSource).toHaveBeenCalledTimes(1);
    expect(manager.getSource).toHaveBeenCalledWith("s1");
    expect(manager.search).toHaveBeenCalledWith("q", expect.objectContaining({ sources: [{ id: "s1" }] }));
  });

  it("creates a new embedding service when cached endpoint does not match new config", async () => {
    const { handler } = await importModule();
    sourceManagerState.semanticSearchResults = [];

    const context = createContext({ embedding: { endpoint: "http://embed-a" } });
    await handler({ query: "first", mmr: false }, context);

    context.embedding = { endpoint: "http://embed-b" };
    await handler({ query: "second", mmr: false }, context);

    expect(embeddingState.instances).toHaveLength(2);
    expect(context._pbEmbeddingService).toBe(embeddingState.instances[1]);
  });

  it("uses semantic search when embedding service is provided and records gap evidence", async () => {
    const { handler } = await importModule();
    const embeddingService = { embed: vi.fn() };
    sourceManagerState.semanticSearchResults = [
      { sourceId: "s1", snippet: "hit", score: 0.9 },
    ];

    const discoveryManager = { addEvidence: vi.fn() };
    const emit = vi.fn();
    const context = createContext({ embeddingService, discoveryManager, emit });

    const result = await handler(
      { query: "term", gapId: "gap-1", semanticTimeoutMs: 5000, mmr: false },
      context,
    );

    expect(result).toMatchObject({ success: true, fallback: "local" });
    const manager = getLastManager();
    expect(manager.semanticSearch).toHaveBeenCalledTimes(1);
    expect(manager.search).not.toHaveBeenCalled();
    const [, options] = manager.semanticSearch.mock.calls[0];
    expect(options).toMatchObject({
      limit: 10,
      embeddingService,
      timeoutMs: 5000,
    });
    expect(discoveryManager.addEvidence).toHaveBeenCalledWith("gap-1", {
      query: "term",
      sourceId: "s1",
      snippet: "hit",
      confidence: 0.9,
    });
    expect(emit).toHaveBeenCalledWith(
      "deepsearch:search_completed",
      expect.objectContaining({
        query: "term",
        gapId: "gap-1",
        resultCount: 1,
        fallback: "local",
      }),
    );
  });

  it("uses keyword search when embedding config is invalid", async () => {
    const { handler } = await importModule();
    sourceManagerState.searchResults = [{ sourceId: "k1" }];
    sourceManagerState.semanticSearchResults = [{ sourceId: "s1" }];

    const context = createContext({ embedding: "not-an-object" });
    const result = await handler({ query: "term", mmr: false }, context);

    expect(result).toMatchObject({ success: true, fallback: "local", results: [{ sourceId: "k1" }] });
    const manager = getLastManager();
    expect(manager.search).toHaveBeenCalledTimes(1);
    expect(manager.semanticSearch).not.toHaveBeenCalled();
    expect(embeddingState.instances).toHaveLength(0);
  });

  it("passes fetchImpl to EmbeddingService", async () => {
    const { handler } = await importModule();
    sourceManagerState.semanticSearchResults = [];

    const fetchImpl = vi.fn();
    const context = createContext({ embedding: { endpoint: "http://embed" }, fetchImpl });

    await handler({ query: "q", mmr: false }, context);

    expect(embeddingState.instances).toHaveLength(1);
    expect(embeddingState.instances[0].opts).toMatchObject({ fetchImpl });
  });

  it("disables MMR when mmr is not a boolean or plain object", async () => {
    const { handler } = await importModule();

    sourceManagerState.searchResults = [{ sourceId: "a" }, { sourceId: "b" }];

    const result = await handler({ query: "q", limit: 1, mmr: [] }, createContext());

    expect(result).toMatchObject({ success: true, fallback: "local" });
    expect(result.mmr).toBeUndefined();
    expect(mockMmrSelect).not.toHaveBeenCalled();
  });

  it("enables MMR with default settings when mmr is true and expands the pool", async () => {
    const { handler } = await importModule();

    sourceManagerState.searchResults = Array.from({ length: 12 }, (_, i) => ({ sourceId: `s${i}` }));

    const result = await handler({ query: "q", limit: 4, mmr: true }, createContext());

    const manager = getLastManager();
    expect(manager.search).toHaveBeenCalledWith("q", expect.objectContaining({ limit: 12 }));
    expect(mockMmrSelect).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual(sourceManagerState.searchResults.slice(0, 4));
    expect(result.mmr).toEqual({ applied: true, pool: 12, lambda: 0.7 });
  });

  it("applies MMR reordering with pool limit and metadata", async () => {
    const { handler } = await importModule();
    const emit = vi.fn();

    sourceManagerState.searchResults = [
      { sourceId: "a", chunkId: "chunk-a1", text: "x".repeat(5000), score: 0.1 },
      { docId: "b", startLine: 2, snippet: "second", score: 0.9 },
      { id: "c", line: 3, content: "third", score: 0.2 },
    ];

    mockMmrSelect.mockImplementation((candidates) => [candidates[1], candidates[0]]);

    const context = createContext({ emit });
    const result = await handler(
      {
        query: "mmr",
        limit: 2,
        mmr: {
          lambda: 0.5,
          maxTokens: 50,
          poolLimit: 1000,
          nested: { a: { b: { c: 1 } } },
        },
      },
      context,
    );

    const manager = getLastManager();
    expect(manager.search).toHaveBeenCalledWith("mmr", expect.objectContaining({ limit: 100 }));
    expect(mockMmrSelect).toHaveBeenCalledTimes(1);
    const [candidates, options] = mockMmrSelect.mock.calls[0];
    expect(options).toEqual({ topK: 2, lambda: 0.5, maxTokens: 50 });

    const candidateForB = candidates.find((c) => c._row?.docId === "b");
    expect(candidateForB?.chunkId).toBe("b:2");
    expect(candidates.some((c) => c.text.length === 5000)).toBe(true);

    expect(result.results).toEqual([sourceManagerState.searchResults[1], sourceManagerState.searchResults[0]]);
    expect(result.mmr).toEqual({ applied: true, pool: 3, lambda: 0.5 });
    expect(emit).toHaveBeenCalledWith(
      "deepsearch:search_completed",
      expect.objectContaining({
        fallback: "local",
        mmr: { applied: true, pool: 3, lambda: 0.5 },
      }),
    );
  });

  it("does not call MMR selector when pool size is 1", async () => {
    const { handler } = await importModule();
    sourceManagerState.searchResults = [{ sourceId: "only", text: "one", score: 0.9 }];

    const result = await handler({ query: "mmr", limit: 1 }, createContext());

    expect(result).toMatchObject({
      success: true,
      results: [{ sourceId: "only", text: "one", score: 0.9 }],
      mmr: { applied: true, pool: 1, lambda: 0.7 },
    });
    expect(mockMmrSelect).not.toHaveBeenCalled();
  });

  it("falls back to top-k when MMR selection lacks original rows", async () => {
    const { handler } = await importModule();

    sourceManagerState.searchResults = [
      { sourceId: "a", text: "first", score: 0.2 },
      { sourceId: "b", text: "second", score: 0.1 },
      { sourceId: "c", text: "third", score: 0.3 },
    ];

    mockMmrSelect.mockImplementation(() => [{ chunkId: "x", text: "y", score: 0 }]);

    const result = await handler({ query: "mmr", limit: 2 }, createContext());

    expect(mockMmrSelect).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual(sourceManagerState.searchResults.slice(0, 2));
  });

  it("falls back to top-k when MMR selection is empty", async () => {
    const { handler } = await importModule();

    sourceManagerState.searchResults = [
      { sourceId: "a", text: "first", score: 0.2 },
      { sourceId: "b", text: "second", score: 0.1 },
      { sourceId: "c", text: "third", score: 0.3 },
    ];

    mockMmrSelect.mockImplementation(() => []);

    const result = await handler({ query: "mmr", limit: 2 }, createContext());

    expect(mockMmrSelect).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual(sourceManagerState.searchResults.slice(0, 2));
  });

  it("propagates TIMEOUT code from retriever timeout through breaker.execute", async () => {
    const { handler } = await importModule();
    vi.useFakeTimers();

    const retriever = { search: vi.fn(() => new Promise(() => {})) };
    sourceManagerState.searchResults = [];

    /** @type {any[]} */
    const captured = [];
    const breaker = createBreaker({
      executeImpl: async (fn) => {
        try {
          return await fn();
        } catch (e) {
          captured.push(e);
          throw e;
        }
      },
    });
    const registry = createRegistry(breaker);

    const context = createContext({ retriever, circuitBreakerRegistry: registry });
    const promise = handler({ query: "timeout", retrieverTimeoutMs: 5, mmr: false }, context);

    await vi.advanceTimersByTimeAsync(5);
    await promise;

    expect(captured[0]).toMatchObject({ code: "TIMEOUT" });
  });

  it("uses default retriever timeout when semanticTimeoutMs is invalid", async () => {
    const { handler } = await importModule();

    const retriever = { search: vi.fn().mockResolvedValue([{ sourceId: "r1" }]) };
    const breaker = createBreaker();
    const registry = createRegistry(breaker);
    const context = createContext({ retriever, circuitBreakerRegistry: registry });

    await handler({ query: "remote", semanticTimeoutMs: 0, mmr: false }, context);

    expect(retriever.search).toHaveBeenCalledWith(
      "remote",
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("uses retriever results when circuit breaker allows execution", async () => {
    const { handler } = await importModule();
    const retriever = {
      search: vi.fn().mockResolvedValue({ results: [{ sourceId: "r1" }] }),
    };
    const breaker = createBreaker();
    const registry = createRegistry(breaker);
    const emit = vi.fn();

    const context = createContext({ retriever, circuitBreakerRegistry: registry, emit });
    const result = await handler(
      { query: "remote", retrieverTimeoutMs: 5000, mmr: false },
      context,
    );

    expect(retriever.search).toHaveBeenCalledWith(
      "remote",
      expect.objectContaining({ limit: 10, timeoutMs: 5000 }),
    );
    expect(breaker.canExecute).toHaveBeenCalled();
    expect(breaker.execute).toHaveBeenCalled();
    expect(mockGetGlobalCircuitBreakerRegistry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, results: [{ sourceId: "r1" }] });
    const [, payload] = emit.mock.calls[0];
    expect(payload.fallback).toBeUndefined();
  });

  it("applies MMR to retriever results and emits metadata", async () => {
    const { handler } = await importModule();

    const retrieverResults = [
      { sourceId: "a", snippet: "a", score: 0.1 },
      { sourceId: "b", snippet: "b", score: 0.9 },
      { sourceId: "c", snippet: "c", score: 0.2 },
    ];
    const retriever = { search: vi.fn().mockResolvedValue({ results: retrieverResults }) };

    mockMmrSelect.mockImplementation((candidates) => [candidates[1], candidates[0]]);

    const emit = vi.fn();
    const breaker = createBreaker();
    const registry = createRegistry(breaker);
    const context = createContext({ retriever, circuitBreakerRegistry: registry, emit });

    const result = await handler({ query: "q", limit: 2 }, context);

    expect(mockMmrSelect).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([retrieverResults[1], retrieverResults[0]]);
    expect(result.mmr).toEqual({ applied: true, pool: 3, lambda: 0.7 });
    expect(emit).toHaveBeenCalledWith(
      "deepsearch:search_completed",
      expect.objectContaining({ mmr: { applied: true, pool: 3, lambda: 0.7 } }),
    );
  });

  it("uses stageApi circuit breaker registry when provided", async () => {
    const { handler } = await importModule();
    const retriever = {
      search: vi.fn().mockResolvedValue([{ sourceId: "r1" }]),
    };
    const breaker = createBreaker();
    const registry = createRegistry(breaker);
    const stageApi = { circuitBreakerRegistry: registry };

    const context = createContext({ retriever, stageApi });
    const result = await handler({ query: "remote", mmr: false }, context);

    expect(result).toMatchObject({ success: true, results: [{ sourceId: "r1" }] });
    expect(registry.get).toHaveBeenCalled();
    expect(mockGetGlobalCircuitBreakerRegistry).not.toHaveBeenCalled();
  });

  it("derives retriever timeout from semanticTimeoutMs and clamps to max", async () => {
    const { handler } = await importModule();
    const retriever = {
      search: vi.fn().mockResolvedValue([{ sourceId: "r1" }]),
    };
    const breaker = createBreaker();
    const registry = createRegistry(breaker);
    const context = createContext({ retriever, circuitBreakerRegistry: registry });

    await handler({ query: "remote", semanticTimeoutMs: 1234, retrieverTimeoutMs: 999999, mmr: false }, context);
    expect(retriever.search).toHaveBeenCalledWith(
      "remote",
      expect.objectContaining({ timeoutMs: 60000 }),
    );

    retriever.search.mockClear();
    await handler({ query: "remote", semanticTimeoutMs: 4321, mmr: false }, context);
    expect(retriever.search).toHaveBeenCalledWith(
      "remote",
      expect.objectContaining({ timeoutMs: 4321 }),
    );
  });

  it("falls back to local search when retriever returns invalid data", async () => {
    const { handler } = await importModule();
    const retriever = {
      search: vi.fn().mockResolvedValue({ foo: "bar" }),
    };

    sourceManagerState.searchResults = [{ sourceId: "l1" }];

    const emit = vi.fn();
    const context = createContext({ retriever, emit });
    const result = await handler({ query: "remote", mmr: false }, context);

    expect(mockGetGlobalCircuitBreakerRegistry).toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      fallback: "local",
      results: [{ sourceId: "l1" }],
    });
  });

  it("falls back to local search when retriever.search rejects", async () => {
    const { handler } = await importModule();
    const retriever = { search: vi.fn().mockRejectedValue(new Error("network")) };

    sourceManagerState.searchResults = [{ sourceId: "local" }];

    const context = createContext({ retriever });
    const result = await handler({ query: "q", mmr: false }, context);

    expect(result).toMatchObject({ success: true, fallback: "local", results: [{ sourceId: "local" }] });
  });

  it("falls back to local search when circuit breaker execute throws", async () => {
    const { handler } = await importModule();
    const retriever = { search: vi.fn().mockResolvedValue([{ sourceId: "remote" }]) };
    const breaker = createBreaker({
      executeImpl: async () => {
        throw new Error("breaker failed");
      },
    });
    const registry = createRegistry(breaker);

    sourceManagerState.searchResults = [{ sourceId: "local" }];

    const context = createContext({ retriever, circuitBreakerRegistry: registry });
    const result = await handler({ query: "q", mmr: false }, context);

    expect(result).toMatchObject({ success: true, fallback: "local", results: [{ sourceId: "local" }] });
    expect(retriever.search).not.toHaveBeenCalled();
  });

  it("skips retriever when circuit breaker cannot execute", async () => {
    const { handler } = await importModule();
    const retriever = { search: vi.fn() };
    const breaker = createBreaker({ canExecute: false });
    const registry = createRegistry(breaker);

    sourceManagerState.searchResults = [{ sourceId: "local" }];

    const context = createContext({ retriever, circuitBreakerRegistry: registry });
    const result = await handler({ query: "local", mmr: false }, context);

    expect(retriever.search).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, fallback: "local" });
  });

  it("returns a structured error when local search fails", async () => {
    const { handler } = await importModule();
    sourceManagerState.searchImpl = () => {
      throw new Error("boom");
    };

    const emit = vi.fn();
    const result = await handler({ query: "fail", mmr: false }, createContext({ emit }));

    expect(result).toEqual({ success: false, error: "Local search failed", fallback: "local" });
    expect(emit).toHaveBeenCalledWith(
      "deepsearch:search_failed",
      expect.objectContaining({ error: "boom", fallback: "local" }),
    );
  });

  it("falls back to local search when retriever times out", async () => {
    const { handler } = await importModule();
    vi.useFakeTimers();

    const retriever = {
      search: vi.fn(() => new Promise(() => {})),
    };
    sourceManagerState.searchResults = [{ sourceId: "local" }];

    const context = createContext({ retriever });
    const promise = handler({ query: "timeout", retrieverTimeoutMs: 5, mmr: false }, context);

    await vi.advanceTimersByTimeAsync(5);
    const result = await promise;

    expect(result).toMatchObject({ success: true, fallback: "local" });
    expect(retriever.search).toHaveBeenCalledTimes(1);
  });

  it("handles concurrent calls without cross-talk", async () => {
    const { handler } = await importModule();
    sourceManagerState.searchImpl = (query) => [{ sourceId: query, snippet: query }];

    const context = createContext();
    const [alpha, beta] = await Promise.all([
      handler({ query: "alpha", mmr: false }, context),
      handler({ query: "beta", mmr: false }, context),
    ]);

    expect(alpha.results[0].sourceId).toBe("alpha");
    expect(beta.results[0].sourceId).toBe("beta");
    expect(sourceManagerState.instances).toHaveLength(2);
  });

  it("reuses cached embedding service across successive calls", async () => {
    const { handler } = await importModule();
    sourceManagerState.semanticSearchResults = [];

    const context = createContext({ embedding: { endpoint: "http://embed" } });

    await handler({ query: "first", mmr: false }, context);
    await handler({ query: "second", mmr: false }, context);

    expect(embeddingState.instances).toHaveLength(1);
    expect(context._pbEmbeddingService).toBe(embeddingState.instances[0]);
  });

  it("creates a new embedding service when cached status check fails", async () => {
    const { handler } = await importModule();
    sourceManagerState.semanticSearchResults = [];

    const logger = { warn: vi.fn() };
    const context = createContext({ embedding: { endpoint: "http://embed" }, logger });

    await handler({ query: "first", mmr: false }, context);
    embeddingState.throwStatus = true;
    await handler({ query: "second", mmr: false }, context);

    expect(embeddingState.instances).toHaveLength(2);
    expect(context._pbEmbeddingService).toBe(embeddingState.instances[1]);
    expect(logger.warn).toHaveBeenCalledWith(
      "[search-docs] cached embedding service status check failed",
      expect.objectContaining({ error: "status check failed" }),
    );
  });

  it("does not cache embedding service when context is not extensible", async () => {
    const { handler } = await importModule();
    sourceManagerState.semanticSearchResults = [];

    const logger = { debug: vi.fn() };
    const context = Object.preventExtensions(createContext({ embedding: { endpoint: "http://embed" }, logger }));

    await handler({ query: "q", mmr: false }, context);

    expect(embeddingState.instances).toHaveLength(1);
    expect(context._pbEmbeddingService).toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "[search-docs] cannot cache embedding service on context",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("uses provided sourceManager instance when available", async () => {
    const { handler } = await importModule();
    const { default: SourceManager } = await import("../../../../../../../js/agents/stages/deepsearch/source-manager.js");

    const existingManager = new SourceManager([{ id: "s1" }, { id: "s2" }]);
    sourceManagerState.searchResults = [{ sourceId: "hit" }];

    const context = createContext({ sourceManager: existingManager });
    const result = await handler({ query: "q", mmr: false }, context);

    expect(result.success).toBe(true);
    expect(sourceManagerState.instances).toHaveLength(1);
    expect(sourceManagerState.instances[0]).toBe(existingManager);
  });
});
