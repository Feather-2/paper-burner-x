/**
 * @file tests/unit/agents/plugins/memory/retrieval-engine.test.js
 * @description Unit tests for RetrievalEngine memory retrieval behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import RetrievalEngineDefault, { RetrievalEngine as RetrievalEngineNamed } from "../../../../../js/agents/plugins/memory/retrieval-engine.js";
import { EmbeddingService } from "../../../../../js/agents/shared/index.js";
import { VectorIndex } from "../../../../../js/agents/shared/index.js";
import { TokenBucketRateLimiter } from "../../../../../js/agents/llm/rate-limit.js";

const getOption = (options, key, fallback) => (
  Object.prototype.hasOwnProperty.call(options, key) ? options[key] : fallback
);

const createEventBus = () => {
  const handlers = new Map();
  return {
    handlers,
    on: vi.fn((event, handler) => {
      handlers.set(event, handler);
      return vi.fn();
    }),
    emit: vi.fn(),
  };
};

const createMemoryStore = (options = {}) => {
  const timeline = getOption(options, "timeline", []);
  const keywordIndex = getOption(options, "keywordIndex", new Map());
  const snapshots = getOption(options, "snapshots", new Map());
  const eventBus = getOption(options, "eventBus", null);
  const embeddingService = getOption(options, "embeddingService", null);
  const vectorIndex = getOption(options, "vectorIndex", null);
  const config = getOption(options, "config", {});
  const store = {
    _L3: {
      index: {
        timeline,
        keywords: keywordIndex,
      },
      snapshots,
    },
    eventBus,
    embeddingService,
    _embeddingService: embeddingService,
    vectorIndex,
    _vectorIndex: vectorIndex,
    config,
  };

  if (options.useL3) {
    store.L3 = {
      index: { timeline, keywords: keywordIndex },
      snapshots,
    };
  }

  return store;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("default export", () => {
  it("aliases the named export", () => {
    expect(RetrievalEngineDefault).toBe(RetrievalEngineNamed);
  });
});

describe("RetrievalEngine", () => {
  describe("constructor", () => {
    it("throws when memoryStore is missing or invalid", () => {
      expect(() => new RetrievalEngineNamed()).toThrow("RetrievalEngine requires { memoryStore }");
      expect(() => new RetrievalEngineNamed("bad-options")).toThrow("RetrievalEngine requires { memoryStore }");
    });

    it("creates a vector index when embedding service exists", () => {
      const embeddingService = new EmbeddingService();
      const store = createMemoryStore({
        embeddingService,
        config: { vectorMaxItems: "5" },
      });

      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      expect(engine.embeddingService).toBe(embeddingService);
      expect(engine.vectorIndex).toBeInstanceOf(VectorIndex);
      expect(engine.vectorIndex._maxItems).toBe(5);
    });

    it("applies vectorMaxItems fallback for invalid values", () => {
      const embeddingService = new EmbeddingService();
      const store = createMemoryStore({ embeddingService });

      const engine = new RetrievalEngineNamed({
        memoryStore: store,
        vectorMaxItems: -1,
        subscribe: false,
      });

      expect(engine.vectorIndex).toBeInstanceOf(VectorIndex);
      expect(engine.vectorIndex._maxItems).toBe(1000);
    });

    it("uses provided vectorIndex and keeps null without embeddingService", () => {
      const vectorIndex = { marker: true };
      const store = createMemoryStore({ vectorIndex });

      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      expect(engine.vectorIndex).toBe(vectorIndex);

      const storeNoEmbedding = createMemoryStore();
      const engineNoEmbedding = new RetrievalEngineNamed({ memoryStore: storeNoEmbedding, subscribe: false });

      expect(engineNoEmbedding.vectorIndex).toBeNull();
    });

    it("honors queue config boundaries", () => {
      const store = createMemoryStore();

      const engine = new RetrievalEngineNamed({
        memoryStore: store,
        indexQueueMaxSize: Number.MAX_SAFE_INTEGER,
        indexRetryMax: 0,
        indexRetryDelayMs: -1,
        indexMaxConcurrent: "2",
        subscribe: false,
      });

      expect(engine._indexQueueMaxSize).toBe(Number.MAX_SAFE_INTEGER);
      expect(engine._indexRetryMax).toBe(2);
      expect(engine._indexRetryDelayMs).toBe(500);
      expect(engine._indexMaxConcurrent).toBe(2);
    });

    it("configures rate limiter and supports disabling", () => {
      const store = createMemoryStore();
      const rateLimiter = new TokenBucketRateLimiter({ rps: 1 });

      const engineFromInstance = new RetrievalEngineNamed({
        memoryStore: store,
        rateLimiter,
        subscribe: false,
      });

      expect(engineFromInstance._rateLimiter).toBe(rateLimiter);

      const engineFromOptions = new RetrievalEngineNamed({
        memoryStore: store,
        rateLimit: { rps: "7", enabled: true },
        subscribe: false,
      });

      expect(engineFromOptions._rateLimiter).toBeInstanceOf(TokenBucketRateLimiter);
      expect(engineFromOptions._rateLimiter._rps).toBe(7);

      const engineDisabled = new RetrievalEngineNamed({
        memoryStore: store,
        rateLimit: { enabled: false },
        subscribe: false,
      });

      expect(engineDisabled._rateLimiter).toBeNull();
    });

    it("subscribes to memory events unless disabled", () => {
      const eventBus = createEventBus();
      const store = createMemoryStore({ eventBus });

      new RetrievalEngineNamed({ memoryStore: store });
      expect(eventBus.on).toHaveBeenCalledTimes(1);
      expect(eventBus.on).toHaveBeenCalledWith("memory:archived", expect.any(Function));

      const storeNoSub = createMemoryStore({ eventBus: createEventBus() });
      new RetrievalEngineNamed({ memoryStore: storeNoSub, subscribe: false });
      expect(storeNoSub.eventBus.on).not.toHaveBeenCalled();
    });
  });

  describe("_subscribeToMemoryEvents", () => {
    it("registers archive handler and queues ids", () => {
      const eventBus = createEventBus();
      const store = createMemoryStore({ eventBus });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      const queueSpy = vi.spyOn(engine, "queueIndexArchive").mockReturnValue(true);

      engine._subscribeToMemoryEvents();
      engine._subscribeToMemoryEvents();

      expect(eventBus.on).toHaveBeenCalledTimes(1);

      const handler = eventBus.handlers.get("memory:archived");
      handler({ payload: { id: "archive-1" } });
      handler({ payload: { id: "" } });

      expect(queueSpy).toHaveBeenCalledTimes(1);
      expect(queueSpy).toHaveBeenCalledWith("archive-1");
    });

    it("does nothing without event bus", () => {
      const store = createMemoryStore({ eventBus: null });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      expect(() => engine._subscribeToMemoryEvents()).not.toThrow();
    });
  });

  describe("dispose", () => {
    it("clears queue, aborts prewarm, and unsubscribes safely", () => {
      const eventBus = createEventBus();
      const store = createMemoryStore({ eventBus });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const unsubscribe = vi.fn();
      engine._unsubscribeArchived = unsubscribe;
      engine._indexQueue.push({ id: "a" });
      engine._prewarmAbort = { abort: vi.fn() };

      engine.dispose();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(engine._unsubscribeArchived).toBeNull();
      expect(engine._indexQueue).toHaveLength(0);
      expect(engine._prewarmAbort).toBeNull();
    });

    it("swallows unsubscribe errors", () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      engine._unsubscribeArchived = () => {
        throw new Error("boom");
      };

      expect(() => engine.dispose()).not.toThrow();
      expect(engine._unsubscribeArchived).toBeNull();
    });
  });

  describe("getIndexQueueStats", () => {
    it("returns queue and limiter stats", () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      engine._indexQueue.push({ id: "a" }, { id: "b" });
      engine._indexQueueMaxSize = 10;
      engine._indexInFlight = 2;
      engine._indexMaxConcurrent = 4;
      engine._indexDroppedCount = 1;
      engine._rateLimiter = { getState: vi.fn(() => ({ ok: true })) };

      const stats = engine.getIndexQueueStats();

      expect(stats).toEqual({
        queueSize: 2,
        maxSize: 10,
        inFlight: 2,
        maxConcurrent: 4,
        droppedCount: 1,
        rateLimiter: { ok: true },
      });
    });
  });

  describe("isWarmed", () => {
    it("returns false without a vector index", () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      expect(engine.isWarmed).toBe(false);
    });

    it("returns true when no snapshots", () => {
      const vectorIndex = { has: vi.fn(() => true) };
      const store = createMemoryStore({ snapshots: null, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      expect(engine.isWarmed).toBe(true);
    });

    it("detects missing embeddings", () => {
      const snapshots = new Map([
        ["a", { summary: "alpha", data: { v: 1 } }],
        ["b", { summary: "beta", data: { v: 2 } }],
        ["c", { summary: " ", data: { v: 3 } }],
      ]);
      const vectorIndex = { has: vi.fn((id) => id === "a") };
      const store = createMemoryStore({ snapshots, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      expect(engine.isWarmed).toBe(false);

      vectorIndex.has = vi.fn(() => true);
      expect(engine.isWarmed).toBe(true);
    });
  });

  describe("getWarmupProgress", () => {
    it("returns defaults when missing snapshots or index", () => {
      const store = createMemoryStore({ snapshots: null });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      expect(engine.getWarmupProgress()).toEqual({ indexed: 0, total: 0, coverage: 1 });
    });

    it("counts only entries with text", () => {
      const snapshots = {
        a: { summary: "alpha", data: {} },
        b: { summary: " ", data: {} },
        c: { summary: "gamma", data: {} },
      };
      const vectorIndex = { has: vi.fn((id) => id === "a") };
      const store = createMemoryStore({ snapshots, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const progress = engine.getWarmupProgress();

      expect(progress.total).toBe(2);
      expect(progress.indexed).toBe(1);
      expect(progress.coverage).toBe(0.5);
    });
  });

  describe("prewarm", () => {
    it("returns early without embedding service or index", async () => {
      const snapshots = new Map([["a", { summary: "alpha" }]]);
      const vectorIndex = { upsert: vi.fn(), has: vi.fn(() => false) };
      const store = createMemoryStore({ snapshots, vectorIndex, embeddingService: null });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = await engine.prewarm();

      expect(result).toEqual({ indexed: 0, skipped: 0, elapsed: expect.any(Number) });
      expect(vectorIndex.upsert).not.toHaveBeenCalled();
    });

    it("indexes pending entries and reports progress", async () => {
      const snapshots = new Map([
        ["a", { summary: "alpha", stageKey: "s1", ts: 1, data: {} }],
        ["b", { summary: "beta", stageKey: "s2", ts: 2, data: {} }],
      ]);
      const embeddingService = { embed: vi.fn().mockImplementation((texts) => Promise.resolve(texts.map(() => [1]))) };
      const vectorIndex = { has: vi.fn(() => false), upsert: vi.fn() };
      const eventBus = createEventBus();
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex, eventBus });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      const progressCallback = vi.fn();

      const result = await engine.prewarm({ batchSize: 1, progressCallback });

      expect(embeddingService.embed).toHaveBeenCalledTimes(2);
      expect(vectorIndex.upsert).toHaveBeenCalledTimes(2);
      expect(eventBus.emit).toHaveBeenCalledWith(
        "retrieval:indexProgress",
        expect.objectContaining({ indexed: 2, total: 2, coverage: 1 })
      );
      expect(progressCallback).toHaveBeenCalled();
      expect(result.indexed).toBe(2);
      expect(result.skipped).toBe(0);
      expect(engine._indexedCount).toBe(2);
      expect(engine._prewarmAbort).toBeNull();
    });

    it("skips already indexed entries and empty text", async () => {
      const snapshots = new Map([
        ["a", { summary: "alpha", stageKey: "s1", ts: 1 }],
        ["b", { summary: " ", stageKey: "", ts: 2 }],
      ]);
      const embeddingService = { embed: vi.fn() };
      const vectorIndex = { has: vi.fn(() => true), upsert: vi.fn() };
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = await engine.prewarm();

      expect(embeddingService.embed).not.toHaveBeenCalled();
      expect(result).toEqual({ indexed: 0, skipped: 2, elapsed: expect.any(Number) });
    });

    it("emits errors when progress callback throws", async () => {
      const snapshots = new Map([["a", { summary: "alpha" }]]);
      const embeddingService = { embed: vi.fn().mockResolvedValue([[1]]) };
      const vectorIndex = { has: vi.fn(() => false), upsert: vi.fn() };
      const eventBus = createEventBus();
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex, eventBus });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = await engine.prewarm({
        progressCallback: () => {
          throw new Error("callback failed");
        },
      });

      expect(result.indexed).toBe(1);
      expect(eventBus.emit).toHaveBeenCalledWith(
        "retrieval:error",
        expect.objectContaining({ method: "prewarm:progressCallback" })
      );
    });

    it("skips batches when embedding length mismatches", async () => {
      const snapshots = new Map([
        ["a", { summary: "alpha" }],
        ["b", { summary: "beta" }],
      ]);
      const embeddingService = {
        embed: vi.fn().mockResolvedValue([[1]]),
      };
      const vectorIndex = { has: vi.fn(() => false), upsert: vi.fn() };
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = await engine.prewarm({ batchSize: 2 });

      expect(embeddingService.embed).toHaveBeenCalledTimes(1);
      expect(vectorIndex.upsert).not.toHaveBeenCalled();
      expect(result.indexed).toBe(0);
    });

    it("respects abort signals", async () => {
      const snapshots = new Map([["a", { summary: "alpha" }]]);
      const embeddingService = { embed: vi.fn().mockResolvedValue([[1]]) };
      const vectorIndex = { has: vi.fn(() => false), upsert: vi.fn() };
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const controller = new AbortController();
      controller.abort();

      const result = await engine.prewarm({ signal: controller.signal });

      expect(result.indexed).toBe(0);
      expect(embeddingService.embed).not.toHaveBeenCalled();
      expect(engine._prewarmAbort).toBeNull();
    });
  });

  describe("queueIndexArchive", () => {
    it("returns false for invalid ids and missing dependencies", () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      expect(engine.queueIndexArchive(null)).toBe(false);
      expect(engine.queueIndexArchive(undefined)).toBe(false);
      expect(engine.queueIndexArchive("")).toBe(false);
      expect(engine.queueIndexArchive("   ")).toBe(false);

      const engineNoServices = new RetrievalEngineNamed({
        memoryStore: createMemoryStore({
          snapshots: new Map([["a", { summary: "alpha" }]]),
          embeddingService: {},
          vectorIndex: { upsert: vi.fn() },
        }),
        subscribe: false,
      });

      expect(engineNoServices.queueIndexArchive("a")).toBe(false);

      const engineEmptySnapshots = new RetrievalEngineNamed({
        memoryStore: createMemoryStore({
          snapshots: {},
          embeddingService: { enqueue: vi.fn() },
          vectorIndex: { upsert: vi.fn() },
        }),
        subscribe: false,
      });

      expect(engineEmptySnapshots.queueIndexArchive("a")).toBe(false);
    });

    it("drops oldest tasks when queue is full", () => {
      const snapshots = new Map([
        ["a", { summary: "alpha" }],
        ["b", { summary: "beta" }],
      ]);
      const embeddingService = { enqueue: vi.fn() };
      const vectorIndex = { upsert: vi.fn() };
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({
        memoryStore: store,
        indexQueueMaxSize: 1,
        subscribe: false,
      });

      const processSpy = vi.spyOn(engine, "_processIndexQueue").mockImplementation(() => {});

      expect(engine.queueIndexArchive("a")).toBe(true);
      expect(engine.queueIndexArchive("b")).toBe(true);

      expect(engine._indexQueue).toHaveLength(1);
      expect(engine._indexQueue[0].id).toBe("b");
      expect(engine._indexDroppedCount).toBe(1);
      expect(processSpy).toHaveBeenCalledTimes(2);
    });

    it("enqueues valid tasks and triggers processing", () => {
      const snapshots = new Map([["a", { summary: "alpha", stageKey: "s", ts: 1 }]]);
      const embeddingService = { enqueue: vi.fn() };
      const vectorIndex = { upsert: vi.fn() };
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const processSpy = vi.spyOn(engine, "_processIndexQueue").mockImplementation(() => {});
      const result = engine.queueIndexArchive("a");

      expect(result).toBe(true);
      expect(engine._indexQueue).toHaveLength(1);
      expect(processSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("_processIndexQueue", () => {
    it("respects max concurrency across rapid calls", () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      engine._indexMaxConcurrent = 2;
      engine._indexQueue = [
        { id: "a", text: "x", entry: {}, retries: 0 },
        { id: "b", text: "y", entry: {}, retries: 0 },
        { id: "c", text: "z", entry: {}, retries: 0 },
      ];

      const execSpy = vi.spyOn(engine, "_executeIndexTask").mockImplementation(() => {});

      engine._processIndexQueue();
      engine._processIndexQueue();

      expect(execSpy).toHaveBeenCalledTimes(2);
      expect(engine._indexInFlight).toBe(2);
      expect(engine._indexQueue).toHaveLength(1);
    });
  });

  describe("_executeIndexTask", () => {
    it("upserts vectors on success", async () => {
      const embeddingService = { enqueue: vi.fn().mockResolvedValue([[0.1, 0.2]]) };
      const vectorIndex = { upsert: vi.fn() };
      const store = createMemoryStore({ embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      engine._processIndexQueue = vi.fn();
      engine._indexInFlight = 1;

      await engine._executeIndexTask({
        id: "a",
        text: "alpha",
        entry: { stageKey: "s", ts: 1 },
        retries: 0,
      });

      expect(embeddingService.enqueue).toHaveBeenCalledWith(["alpha"], { immediate: false });
      expect(vectorIndex.upsert).toHaveBeenCalledWith("a", [0.1, 0.2], { stageKey: "s", ts: 1 });
      expect(engine._indexInFlight).toBe(0);
    });

    it("retries failed tasks with backoff", async () => {
      vi.useFakeTimers();
      try {
        const embeddingService = { enqueue: vi.fn().mockRejectedValue(new Error("fail")) };
        const vectorIndex = { upsert: vi.fn() };
        const store = createMemoryStore({ embeddingService, vectorIndex });
        const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
        engine._processIndexQueue = vi.fn();
        engine._indexRetryMax = 1;
        engine._indexRetryDelayMs = 5;
        engine._indexInFlight = 1;

        const taskPromise = engine._executeIndexTask({
          id: "a",
          text: "alpha",
          entry: { stageKey: "s", ts: 1 },
          retries: 0,
        });

        await vi.advanceTimersByTimeAsync(5);
        await taskPromise;

        expect(engine._indexQueue).toHaveLength(1);
        expect(engine._indexQueue[0].retries).toBe(1);
        expect(engine._indexInFlight).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("emits error when retries are exhausted", async () => {
      const embeddingService = { enqueue: vi.fn().mockRejectedValue(new Error("fail")) };
      const vectorIndex = { upsert: vi.fn() };
      const eventBus = createEventBus();
      const store = createMemoryStore({ embeddingService, vectorIndex, eventBus });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      engine._processIndexQueue = vi.fn();
      engine._indexRetryMax = 0;
      engine._indexInFlight = 1;

      await engine._executeIndexTask({
        id: "a",
        text: "alpha",
        entry: { stageKey: "s", ts: 1 },
        retries: 0,
      });

      expect(eventBus.emit).toHaveBeenCalledWith(
        "retrieval:indexError",
        expect.objectContaining({ id: "a", retries: 0 })
      );
      expect(engine._indexQueue).toHaveLength(0);
      expect(engine._indexInFlight).toBe(0);
    });
  });

  describe("ensureIndexed", () => {
    it("returns false without embedding service or vector index", async () => {
      // Case 1: No embeddingService at all
      const store = createMemoryStore({ snapshots: new Map() });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      await expect(engine.ensureIndexed()).resolves.toBe(false);

      // Case 2: Has embeddingService but mock without embed function
      // (Cannot easily prevent vectorIndex auto-creation, so test embed function check)
      const embeddingService = { notEmbed: vi.fn() };
      const storeNoEmbed = createMemoryStore({ snapshots: new Map(), embeddingService });
      const engineNoEmbed = new RetrievalEngineNamed({ memoryStore: storeNoEmbed, subscribe: false });

      await expect(engineNoEmbed.ensureIndexed()).resolves.toBe(false);
    });

    it("returns true when no snapshots exist", async () => {
      const embeddingService = { embed: vi.fn() };
      const vectorIndex = { upsert: vi.fn() };
      const store = createMemoryStore({ snapshots: null, embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      await expect(engine.ensureIndexed()).resolves.toBe(true);
    });

    it("indexes pending entries in a single batch", async () => {
      const snapshots = new Map([
        ["a", { summary: "alpha", stageKey: "s", ts: 1 }],
        ["b", { summary: "beta", stageKey: "s", ts: 2 }],
      ]);
      const embeddingService = { embed: vi.fn().mockResolvedValue([[1], [2]]) };
      const vectorIndex = { has: vi.fn(() => false), upsert: vi.fn() };
      const eventBus = createEventBus();
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex, eventBus });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = await engine.ensureIndexed({ batchSize: 0 });

      expect(result).toBe(true);
      expect(vectorIndex.upsert).toHaveBeenCalledTimes(2);
      expect(eventBus.emit).toHaveBeenCalledWith(
        "retrieval:indexProgress",
        expect.objectContaining({ indexed: 2, total: 2, coverage: 1 })
      );
    });

    it("returns false when embedding length mismatches", async () => {
      const snapshots = new Map([["a", { summary: "alpha" }]]);
      const embeddingService = { embed: vi.fn().mockResolvedValue([[1], [2]]) };
      const vectorIndex = { has: vi.fn(() => false), upsert: vi.fn() };
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = await engine.ensureIndexed();

      expect(result).toBe(false);
      expect(vectorIndex.upsert).not.toHaveBeenCalled();
    });

    it("processes batches and emits errors", async () => {
      const snapshots = new Map([
        ["a", { summary: "alpha" }],
        ["b", { summary: "beta" }],
      ]);
      const embeddingService = {
        embed: vi
          .fn()
          .mockResolvedValueOnce([[1]])
          .mockRejectedValueOnce(new Error("fail")),
      };
      const vectorIndex = { has: vi.fn(() => false), upsert: vi.fn() };
      const eventBus = createEventBus();
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex, eventBus });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = await engine.ensureIndexed({ batchSize: 1 });

      expect(result).toBe(true);
      expect(embeddingService.embed).toHaveBeenCalledTimes(2);
      expect(eventBus.emit).toHaveBeenCalledWith(
        "retrieval:error",
        expect.objectContaining({ method: "ensureIndexed:embed" })
      );
    });
  });

  describe("recall", () => {
    it("delegates to keywordRecall", () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      const spy = vi.spyOn(engine, "keywordRecall").mockReturnValue([]);

      engine.recall("query", 4);
      engine.recall("query", { limit: 2 });

      expect(spy).toHaveBeenCalledWith("query", { limit: 4 });
      expect(spy).toHaveBeenCalledWith("query", { limit: 2 });
    });
  });

  describe("_acquireRateLimit", () => {
    it("calls schedule when rate limiter exists", async () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      const limiter = new TokenBucketRateLimiter({});
      engine._rateLimiter = limiter;
      const scheduleSpy = vi.spyOn(limiter, "schedule");

      await engine._acquireRateLimit("label");

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      expect(scheduleSpy).toHaveBeenCalledWith(expect.any(Function), { label: "label" });
    });

    it("no-ops without rate limiter", async () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      await expect(engine._acquireRateLimit("label")).resolves.toBeUndefined();
    });
  });

  describe("keywordRecall", () => {
    it("returns empty when timeline or snapshots are invalid", () => {
      const store = createMemoryStore({ timeline: {}, snapshots: null });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      expect(engine.keywordRecall("query")).toEqual([]);
    });

    it("returns latest timeline entries for empty query", () => {
      const deepData = { level1: { level2: { level3: { value: "x" } } } };
      const timeline = [
        { id: "a", summary: "sum-a" },
        { id: "b", summary: "sum-b" },
        { id: "c", summary: "sum-c" },
        { id: "d", summary: "sum-d" },
      ];
      const snapshots = new Map([
        ["b", { summary: "sum-b", data: deepData }],
        ["c", { summary: "sum-c", data: { value: "c" } }],
        ["d", { summary: "sum-d", data: { value: "d" } }],
      ]);
      const store = createMemoryStore({ timeline, snapshots });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = engine.keywordRecall("   ", { limit: "3" });

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe("d");
      expect(result[1].id).toBe("c");
      expect(result[2].id).toBe("b");
      expect(result[1].data).toEqual({ value: "c" });
      expect(result[2].data).toBe(deepData);
    });

    it("returns empty for empty timeline arrays", () => {
      const store = createMemoryStore({
        timeline: [],
        snapshots: new Map([["a", { summary: "sum-a", data: {} }]]),
      });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = engine.keywordRecall(" ", { limit: 2 });

      expect(result).toEqual([]);
    });

    it("uses default limit for negative values", () => {
      const timeline = [
        { id: "a", summary: "sum-a" },
        { id: "b", summary: "sum-b" },
        { id: "c", summary: "sum-c" },
        { id: "d", summary: "sum-d" },
      ];
      const snapshots = new Map([
        ["a", { summary: "sum-a", data: {} }],
        ["b", { summary: "sum-b", data: {} }],
        ["c", { summary: "sum-c", data: {} }],
        ["d", { summary: "sum-d", data: {} }],
      ]);
      const store = createMemoryStore({ timeline, snapshots });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = engine.keywordRecall("", { limit: -1 });

      expect(result).toHaveLength(3);
    });

    it("ranks keyword matches using map and set entries", () => {
      const keywordIndex = new Map([
        ["alpha", new Set(["a", "b"])],
        ["beta", ["b", "c"]],
      ]);
      const snapshots = new Map([
        ["a", { summary: "A", data: { a: 1 } }],
        ["b", { summary: "B", data: { b: 2 } }],
        ["c", { summary: "C", data: { c: 3 } }],
      ]);
      const store = createMemoryStore({ timeline: [], snapshots, keywordIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = engine.keywordRecall("alpha beta beta", { limit: 2 });

      expect(result.map((row) => row.id)).toEqual(["b", "c"]);
    });

    it("handles object-backed indexes and long queries", () => {
      const longQuery = "a".repeat(10000);
      const keywordIndex = { [longQuery]: ["x"] };
      const snapshots = { x: { summary: "long", data: { ok: true } } };
      const timeline = [{ id: "x", summary: "long" }];
      const store = createMemoryStore({ timeline, snapshots, keywordIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      const result = engine.keywordRecall(longQuery, { limit: Number.MAX_SAFE_INTEGER });

      expect(result).toEqual([{ id: "x", summary: "long", data: { ok: true } }]);
    });
  });

  describe("semanticRecall", () => {
    it("falls back to keyword recall when embeddings are unavailable", async () => {
      const store = createMemoryStore({ timeline: [], snapshots: new Map() });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      const keywordSpy = vi.spyOn(engine, "keywordRecall").mockReturnValue([{ id: "k" }]);

      const result = await engine.semanticRecall("query", { fallback: true });

      expect(result).toEqual([{ id: "k" }]);
      expect(keywordSpy).toHaveBeenCalled();
    });

    it("returns semantic hits and ignores missing snapshots", async () => {
      const snapshots = new Map([["a", { summary: "A", data: { a: 1 } }]]);
      const embeddingService = { embed: vi.fn().mockResolvedValue([[0.1]]) };
      const vectorIndex = { search: vi.fn(() => [{ id: "a", score: 0.9 }, { id: "b", score: 0.1 }]) };
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      const ensureSpy = vi.spyOn(engine, "ensureIndexed").mockResolvedValue(true);

      const result = await engine.semanticRecall("query", { limit: 2, timeoutMs: 10 });

      expect(ensureSpy).toHaveBeenCalledWith({ timeoutMs: 10 });
      expect(embeddingService.embed).toHaveBeenCalledWith(["query"], { timeoutMs: 10 });
      expect(result).toEqual([{ id: "a", score: 0.9, summary: "A", data: { a: 1 } }]);
    });

    it("handles embedding errors and respects fallback flag", async () => {
      const snapshots = new Map([["a", { summary: "A", data: {} }]]);
      const embeddingService = { embed: vi.fn().mockRejectedValue(new Error("fail")) };
      const vectorIndex = { search: vi.fn(() => []) };
      const eventBus = createEventBus();
      const store = createMemoryStore({ snapshots, embeddingService, vectorIndex, eventBus });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      vi.spyOn(engine, "ensureIndexed").mockResolvedValue(true);
      vi.spyOn(engine, "keywordRecall").mockReturnValue([{ id: "k" }]);

      const result = await engine.semanticRecall("query", { fallback: true });

      expect(result).toEqual([{ id: "k" }]);
      expect(eventBus.emit).toHaveBeenCalledWith(
        "retrieval:error",
        expect.objectContaining({ method: "semanticRecall" })
      );

      const noFallback = await engine.semanticRecall("query", { fallback: false });
      expect(noFallback).toEqual([]);
    });

    it("returns fallback on empty vectors", async () => {
      const embeddingService = { embed: vi.fn().mockResolvedValue([null]) };
      const vectorIndex = { search: vi.fn(() => []) };
      const store = createMemoryStore({ embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      vi.spyOn(engine, "ensureIndexed").mockResolvedValue(true);
      const keywordSpy = vi.spyOn(engine, "keywordRecall").mockReturnValue([{ id: "k" }]);

      const result = await engine.semanticRecall("query", { fallback: true });

      expect(result).toEqual([{ id: "k" }]);
      expect(keywordSpy).toHaveBeenCalled();
    });

    it("supports concurrent calls with rate limiting", async () => {
      const embeddingService = { embed: vi.fn().mockResolvedValue([[0.1]]) };
      const vectorIndex = { search: vi.fn(() => []) };
      const store = createMemoryStore({ embeddingService, vectorIndex });
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });
      const limiter = new TokenBucketRateLimiter({});
      const scheduleSpy = vi.spyOn(limiter, "schedule");
      engine._rateLimiter = limiter;
      vi.spyOn(engine, "ensureIndexed").mockResolvedValue(true);

      await Promise.all([
        engine.semanticRecall("query-1", { fallback: false }),
        engine.semanticRecall("query-2", { fallback: false }),
      ]);

      expect(scheduleSpy).toHaveBeenCalledTimes(2);
      expect(embeddingService.embed).toHaveBeenCalledTimes(2);
    });
  });

  describe("hybridRecall", () => {
    it("falls back when both sources are empty", async () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      vi.spyOn(engine, "semanticRecall").mockResolvedValue([]);
      vi
        .spyOn(engine, "keywordRecall")
        .mockReturnValueOnce([])
        .mockReturnValueOnce([{ id: "fallback" }]);

      const result = await engine.hybridRecall("query", { fallback: true, limit: 1 });

      expect(result).toEqual([{ id: "fallback" }]);
    });

    it("combines semantic and keyword results with RRF", async () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      vi.spyOn(engine, "semanticRecall").mockResolvedValue([
        { id: "a", summary: "A", data: { a: 1 } },
        { id: "b", summary: "B", data: { b: 2 } },
      ]);
      vi.spyOn(engine, "keywordRecall").mockReturnValue([
        { id: "b", summary: "B", data: { b: 2 } },
        { id: "c", summary: "C", data: { c: 3 } },
      ]);

      const result = await engine.hybridRecall("query", {
        limit: 2,
        rrfK: 1,
        semanticWeight: 2,
        keywordWeight: 1,
      });

      expect(result.map((row) => row.id)).toEqual(["b", "a"]);
      expect(result[0].rrfScore).toBeCloseTo(1.1667, 3);
      expect(result[1].rrfScore).toBeCloseTo(1, 3);
    });

    it("ignores semantic results when weight is negative", async () => {
      const store = createMemoryStore();
      const engine = new RetrievalEngineNamed({ memoryStore: store, subscribe: false });

      vi.spyOn(engine, "semanticRecall").mockResolvedValue([
        { id: "a", summary: "A", data: {} },
      ]);
      vi.spyOn(engine, "keywordRecall").mockReturnValue([
        { id: "b", summary: "B", data: {} },
        { id: "c", summary: "C", data: {} },
      ]);

      const result = await engine.hybridRecall("query", {
        limit: 2,
        semanticWeight: -1,
        keywordWeight: 1,
        rrfK: -1,
      });

      expect(result.map((row) => row.id)).toEqual(["b", "c"]);
    });
  });
});
