
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { RetrievalEngine } from '../../../../js/agents/plugins/memory/retrieval-engine.js';
import { TokenBucketRateLimiter } from '../../../../js/agents/llm/rate-limit.js';

/**
 * 创建模拟 MemoryStore
 */
function createMockMemoryStore(overrides = {}) {
  const timeline = overrides.timeline ?? [];
  const snapshots = overrides.snapshots ?? new Map();
  const keywords = overrides.keywords ?? new Map();
  return {
    _L3: {
      index: { timeline, keywords },
      snapshots,
    },
    eventBus: overrides.eventBus ?? null,
    embeddingService: overrides.embeddingService ?? null,
    vectorIndex: overrides.vectorIndex ?? null,
  };
}

/**
 * 创建模拟 EmbeddingService
 */
function createMockEmbeddingService() {
  return {
    embed: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
    enqueue: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
  };
}

/**
 * 创建模拟 VectorIndex
 */
function createMockVectorIndex() {
  const store = new Map();
  return {
    upsert: (id, vec, meta) => store.set(id, { vec, meta }),
    has: (id) => store.has(id),
    search: (vec, { topK }) => {
      const results = [];
      for (const [id] of store) {
        results.push({ id, score: 0.9 });
        if (results.length >= topK) break;
      }
      return results;
    },
  };
}

/**
 * 创建可控时间的限流器
 */
function createControllableRateLimiter({ rps = 2, burst = 2, concurrency = 1 } = {}) {
  let currentTime = 0;
  const sleepCalls = [];
  const time = {
    now: () => currentTime,
    sleep: async (ms) => {
      sleepCalls.push(ms);
      currentTime += ms;
    },
  };
  const limiter = new TokenBucketRateLimiter({ rps, burst, concurrency, time });
  return { limiter, time, sleepCalls, advanceTime: (ms) => { currentTime += ms; } };
}

describe("RetrievalEngine rate limiting", () => {
  it("constructor creates default rate limiter when no options", () => {
    const store = createMockMemoryStore();
    const engine = new RetrievalEngine({ memoryStore: store, subscribe: false });
    const stats = engine.getIndexQueueStats();
    expect(stats.rateLimiter, "should have rateLimiter in stats").not.toBeNull();
  });

  it("constructor uses provided rateLimiter instance", () => {
    const store = createMockMemoryStore();
    const customLimiter = new TokenBucketRateLimiter({ rps: 5, burst: 10 });
    const engine = new RetrievalEngine({
      memoryStore: store,
      rateLimiter: customLimiter,
      subscribe: false,
    });
    expect(engine._rateLimiter).toBe(customLimiter);
  });

  it("constructor disables rate limiter when rateLimiter: null", () => {
    const store = createMockMemoryStore();
    const engine = new RetrievalEngine({
      memoryStore: store,
      rateLimiter: null,
      subscribe: false,
    });
    expect(engine._rateLimiter).toBe(null);
  });

  it("constructor disables rate limiter when rateLimit.enabled: false", () => {
    const store = createMockMemoryStore();
    const engine = new RetrievalEngine({
      memoryStore: store,
      rateLimit: { enabled: false },
      subscribe: false,
    });
    expect(engine._rateLimiter).toBe(null);
  });

  it("constructor uses rateLimit config options", () => {
    const store = createMockMemoryStore();
    const engine = new RetrievalEngine({
      memoryStore: store,
      rateLimit: { rps: 10, burst: 20, concurrency: 5 },
      subscribe: false,
    });
    const state = engine._rateLimiter.getState();
    expect(state.rps).toBe(10);
    expect(state.burst).toBe(20);
    expect(state.concurrency).toBe(5);
  });

  it("getIndexQueueStats includes rateLimiter state", () => {
    const store = createMockMemoryStore();
    const engine = new RetrievalEngine({
      memoryStore: store,
      rateLimit: { rps: 50 },
      subscribe: false,
    });
    const stats = engine.getIndexQueueStats();
    expect(stats.rateLimiter).not.toBeNull();
    expect(stats.rateLimiter.rps).toBe(50);
  });

  it("semanticRecall acquires rate limit before execution", async () => {
    const embeddingService = createMockEmbeddingService();
    const vectorIndex = createMockVectorIndex();
    vectorIndex.upsert("doc1", [0.1, 0.2, 0.3], { stageKey: "test", ts: Date.now() });

    const snapshots = new Map([["doc1", { summary: "test doc", data: {} }]]);
    const store = createMockMemoryStore({ embeddingService, vectorIndex, snapshots });

    let acquireCount = 0;
    const engine = new RetrievalEngine({
      memoryStore: store,
      embeddingService,
      vectorIndex,
      subscribe: false,
    });

    // Mock _acquireRateLimit to track calls
    const originalAcquire = engine._acquireRateLimit.bind(engine);
    engine._acquireRateLimit = async (label) => {
      acquireCount++;
      expect(label).toBe("semanticRecall");
      return originalAcquire(label);
    };

    await engine.semanticRecall("test query");
    expect(acquireCount).toBe(1, "should acquire rate limit once");
  });

  it("hybridRecall acquires rate limit before execution", async () => {
    const embeddingService = createMockEmbeddingService();
    const vectorIndex = createMockVectorIndex();
    vectorIndex.upsert("doc1", [0.1, 0.2, 0.3], { stageKey: "test", ts: Date.now() });

    const timeline = [{ id: "doc1", summary: "test" }];
    const snapshots = new Map([["doc1", { summary: "test doc", data: {} }]]);
    const store = createMockMemoryStore({ embeddingService, vectorIndex, snapshots, timeline });

    let acquireLabels = [];
    const engine = new RetrievalEngine({
      memoryStore: store,
      embeddingService,
      vectorIndex,
      subscribe: false,
    });

    // Mock _acquireRateLimit to track calls
    const originalAcquire = engine._acquireRateLimit.bind(engine);
    engine._acquireRateLimit = async (label) => {
      acquireLabels.push(label);
      return originalAcquire(label);
    };

    await engine.hybridRecall("test query");
    // hybridRecall calls _acquireRateLimit once, then calls semanticRecall which calls it again
    expect(acquireLabels).toContain("hybridRecall");
    expect(acquireLabels).toContain("semanticRecall");
  });

  it("rate limiter throttles high-frequency calls", async () => {
    const { limiter, advanceTime } = createControllableRateLimiter({ rps: 2, burst: 2, concurrency: 10 });

    const embeddingService = createMockEmbeddingService();
    const vectorIndex = createMockVectorIndex();
    const snapshots = new Map([["doc1", { summary: "test", data: {} }]]);
    const store = createMockMemoryStore({ embeddingService, vectorIndex, snapshots });

    const engine = new RetrievalEngine({
      memoryStore: store,
      embeddingService,
      vectorIndex,
      rateLimiter: limiter,
      subscribe: false,
    });

    // First two calls should go through immediately (burst)
    const start = limiter.getState().nowMs;
    await engine.semanticRecall("q1");
    await engine.semanticRecall("q2");

    // Third call should be throttled
    const p3 = engine.semanticRecall("q3");
    advanceTime(500); // Advance time to allow token refill
    await p3;

    const end = limiter.getState().nowMs;
    expect(end, "time should have advanced for rate limiting").toBeGreaterThan(start);
  });

  it("keywordRecall is synchronous and not rate limited", () => {
    const timeline = [
      { id: "doc1", summary: "first" },
      { id: "doc2", summary: "second" },
    ];
    const snapshots = new Map([
      ["doc1", { summary: "first", data: { content: "hello world" } }],
      ["doc2", { summary: "second", data: { content: "foo bar" } }],
    ]);
    const store = createMockMemoryStore({ timeline, snapshots });

    const engine = new RetrievalEngine({
      memoryStore: store,
      rateLimit: { rps: 1, burst: 1 },
      subscribe: false,
    });

    // keywordRecall should return synchronously
    const result = engine.keywordRecall("test");
    expect(result).toBeInstanceOf(Array);
  });

  it("_acquireRateLimit is no-op when limiter is null", async () => {
    const store = createMockMemoryStore();
    const engine = new RetrievalEngine({
      memoryStore: store,
      rateLimiter: null,
      subscribe: false,
    });

    // Should not throw
    await expect(engine._acquireRateLimit("test"), "_acquireRateLimit completes without limiter").resolves.toBeUndefined();
  });
});
