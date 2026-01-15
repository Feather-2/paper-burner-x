import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { RetrievalEngine } from "../../../../js/agents/runtime/memory/retrieval-engine.js";

/**
 * Creates a mock memory store with L3 snapshots.
 */
function createMockMemoryStore(snapshots = {}) {
  return {
    _L3: {
      snapshots: new Map(Object.entries(snapshots)),
      index: {
        timeline: Object.keys(snapshots).map((id) => ({ id, summary: snapshots[id].summary })),
        keywords: new Map(),
      },
    },
    eventBus: {
      on: mock.fn(() => () => {}),
      emit: mock.fn(),
    },
  };
}

/**
 * Creates a mock embedding service.
 */
function createMockEmbeddingService({ embedFn } = {}) {
  const defaultEmbed = async (texts) => {
    return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
  };

  return {
    embed: embedFn || defaultEmbed,
    enqueue: async (texts) => {
      return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
    },
  };
}

describe("RetrievalEngine prewarm", () => {
  let store;
  let embeddingService;
  let engine;

  beforeEach(() => {
    store = createMockMemoryStore({
      arch1: { stageKey: "search", summary: "First archive", ts: Date.now() - 1000 },
      arch2: { stageKey: "search", summary: "Second archive", ts: Date.now() - 2000 },
      arch3: { stageKey: "analyze", summary: "Third archive", ts: Date.now() - 3000 },
    });
    embeddingService = createMockEmbeddingService();
    engine = new RetrievalEngine({
      memoryStore: store,
      embeddingService,
      subscribe: false,
    });
  });

  describe("isWarmed", () => {
    it("should return false when no archives are indexed", () => {
      assert.strictEqual(engine.isWarmed, false);
    });

    it("should return true when all archives are indexed", async () => {
      await engine.prewarm();
      assert.strictEqual(engine.isWarmed, true);
    });

    it("should return true when memoryStore has no snapshots", () => {
      const emptyStore = createMockMemoryStore({});
      const emptyEngine = new RetrievalEngine({
        memoryStore: emptyStore,
        embeddingService,
        subscribe: false,
      });
      assert.strictEqual(emptyEngine.isWarmed, true);
    });

    it("should return false when vectorIndex is null", () => {
      const noIdxEngine = new RetrievalEngine({
        memoryStore: store,
        embeddingService: null,
        subscribe: false,
      });
      assert.strictEqual(noIdxEngine.isWarmed, false);
    });
  });

  describe("getWarmupProgress", () => {
    it("should return zero indexed before prewarm", () => {
      const progress = engine.getWarmupProgress();
      assert.strictEqual(progress.indexed, 0);
      assert.strictEqual(progress.total, 3);
      assert.strictEqual(progress.coverage, 0);
    });

    it("should return full coverage after prewarm", async () => {
      await engine.prewarm();
      const progress = engine.getWarmupProgress();
      assert.strictEqual(progress.indexed, 3);
      assert.strictEqual(progress.total, 3);
      assert.strictEqual(progress.coverage, 1);
    });

    it("should return partial coverage during incremental indexing", async () => {
      // Index only first 2 with batchSize=2
      let batchCount = 0;
      const limitedService = createMockEmbeddingService({
        embedFn: async (texts) => {
          batchCount++;
          if (batchCount > 1) throw new Error("Simulated failure");
          return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
        },
      });

      const partialEngine = new RetrievalEngine({
        memoryStore: store,
        embeddingService: limitedService,
        subscribe: false,
      });

      await partialEngine.prewarm({ batchSize: 2 });
      const progress = partialEngine.getWarmupProgress();

      assert.strictEqual(progress.indexed, 2);
      assert.strictEqual(progress.total, 3);
      assert.ok(progress.coverage > 0 && progress.coverage < 1);
    });

    it("should handle empty snapshots gracefully", () => {
      const emptyStore = createMockMemoryStore({});
      const emptyEngine = new RetrievalEngine({
        memoryStore: emptyStore,
        embeddingService,
        subscribe: false,
      });
      const progress = emptyEngine.getWarmupProgress();
      assert.strictEqual(progress.indexed, 0);
      assert.strictEqual(progress.total, 0);
      assert.strictEqual(progress.coverage, 1);
    });
  });

  describe("prewarm()", () => {
    it("should index all archives and return stats", async () => {
      const result = await engine.prewarm();

      assert.strictEqual(result.indexed, 3);
      assert.strictEqual(result.skipped, 0);
      assert.ok(result.elapsed >= 0);
      assert.strictEqual(engine.isWarmed, true);
    });

    it("should respect batchSize parameter", async () => {
      let embedCalls = 0;
      const trackingService = createMockEmbeddingService({
        embedFn: async (texts) => {
          embedCalls++;
          return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
        },
      });

      const trackingEngine = new RetrievalEngine({
        memoryStore: store,
        embeddingService: trackingService,
        subscribe: false,
      });

      await trackingEngine.prewarm({ batchSize: 2 });

      // 3 archives with batchSize=2 should result in 2 embed calls
      assert.strictEqual(embedCalls, 2);
    });

    it("should call progressCallback with correct values", async () => {
      const progressCalls = [];
      const progressCallback = (indexed, total) => {
        progressCalls.push({ indexed, total });
      };

      await engine.prewarm({ batchSize: 1, progressCallback });

      // Should have initial call + one call per batch
      assert.ok(progressCalls.length >= 2);
      assert.strictEqual(progressCalls[0].total, 3);
      assert.strictEqual(progressCalls[progressCalls.length - 1].indexed, 3);
    });

    it("should skip already indexed archives", async () => {
      // First prewarm
      await engine.prewarm();

      let embedCalls = 0;
      const trackingService = createMockEmbeddingService({
        embedFn: async (texts) => {
          embedCalls++;
          return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
        },
      });

      // Replace embedding service and try again
      engine.embeddingService = trackingService;
      const result = await engine.prewarm();

      assert.strictEqual(embedCalls, 0);
      assert.strictEqual(result.indexed, 0);
      assert.strictEqual(result.skipped, 3);
    });

    it("should handle empty snapshots", async () => {
      const emptyStore = createMockMemoryStore({});
      const emptyEngine = new RetrievalEngine({
        memoryStore: emptyStore,
        embeddingService,
        subscribe: false,
      });

      const result = await emptyEngine.prewarm();

      assert.strictEqual(result.indexed, 0);
      assert.strictEqual(result.skipped, 0);
    });

    it("should be interruptible via dispose()", async () => {
      // Create a slow embedding service
      const slowService = createMockEmbeddingService({
        embedFn: async (texts) => {
          await new Promise((r) => setTimeout(r, 100));
          return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
        },
      });

      const slowEngine = new RetrievalEngine({
        memoryStore: store,
        embeddingService: slowService,
        subscribe: false,
      });

      // Start prewarm and immediately dispose
      const prewarmPromise = slowEngine.prewarm({ batchSize: 1 });

      // Allow first batch to start
      await new Promise((r) => setTimeout(r, 10));
      slowEngine.dispose();

      const result = await prewarmPromise;

      // Should have partial results due to interruption
      assert.ok(result.indexed < 3);
    });

    it("should emit retrieval:indexProgress events", async () => {
      await engine.prewarm({ batchSize: 2 });

      const emitCalls = store.eventBus.emit.mock.calls;
      const progressEvents = emitCalls.filter(
        (call) => call.arguments[0] === "retrieval:indexProgress"
      );

      assert.ok(progressEvents.length > 0);
      const lastEvent = progressEvents[progressEvents.length - 1];
      assert.strictEqual(lastEvent.arguments[0], "retrieval:indexProgress");
      assert.ok(lastEvent.arguments[1].coverage > 0);
    });

    it("should handle embedding service errors gracefully", async () => {
      let callCount = 0;
      const failingService = createMockEmbeddingService({
        embedFn: async (texts) => {
          callCount++;
          if (callCount === 1) {
            throw new Error("Simulated embedding error");
          }
          return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
        },
      });

      const failingEngine = new RetrievalEngine({
        memoryStore: store,
        embeddingService: failingService,
        subscribe: false,
      });

      const result = await failingEngine.prewarm({ batchSize: 1 });

      // Should continue despite first batch failing
      assert.ok(result.indexed > 0);
      assert.ok(result.indexed < 3);
    });

    it("should return early when no embedding service", async () => {
      const noSvcEngine = new RetrievalEngine({
        memoryStore: store,
        embeddingService: null,
        subscribe: false,
      });

      const result = await noSvcEngine.prewarm();

      assert.strictEqual(result.indexed, 0);
      assert.strictEqual(result.skipped, 0);
    });
  });

  describe("ensureIndexed with batchSize", () => {
    it("should work without batchSize (original behavior)", async () => {
      const result = await engine.ensureIndexed();
      assert.strictEqual(result, true);
      assert.strictEqual(engine.isWarmed, true);
    });

    it("should process in batches when batchSize specified", async () => {
      let embedCalls = 0;
      const trackingService = createMockEmbeddingService({
        embedFn: async (texts) => {
          embedCalls++;
          return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
        },
      });

      const trackingEngine = new RetrievalEngine({
        memoryStore: store,
        embeddingService: trackingService,
        subscribe: false,
      });

      await trackingEngine.ensureIndexed({ batchSize: 2 });

      // 3 archives with batchSize=2 should result in 2 embed calls
      assert.strictEqual(embedCalls, 2);
    });

    it("should emit progress events during batched processing", async () => {
      await engine.ensureIndexed({ batchSize: 2 });

      const emitCalls = store.eventBus.emit.mock.calls;
      const progressEvents = emitCalls.filter(
        (call) => call.arguments[0] === "retrieval:indexProgress"
      );

      assert.ok(progressEvents.length > 0);
    });

    it("should continue on partial batch failures", async () => {
      let callCount = 0;
      const partialFailService = createMockEmbeddingService({
        embedFn: async (texts) => {
          callCount++;
          if (callCount === 1) {
            return null; // Simulate partial failure
          }
          return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
        },
      });

      const partialEngine = new RetrievalEngine({
        memoryStore: store,
        embeddingService: partialFailService,
        subscribe: false,
      });

      const result = await partialEngine.ensureIndexed({ batchSize: 2 });

      // Should return true if at least some indexed
      assert.strictEqual(result, true);
    });
  });

  describe("dispose()", () => {
    it("should abort running prewarm", async () => {
      const slowService = createMockEmbeddingService({
        embedFn: async (texts) => {
          await new Promise((r) => setTimeout(r, 50));
          return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
        },
      });

      const slowEngine = new RetrievalEngine({
        memoryStore: store,
        embeddingService: slowService,
        subscribe: false,
      });

      const prewarmPromise = slowEngine.prewarm({ batchSize: 1 });
      await new Promise((r) => setTimeout(r, 10));

      slowEngine.dispose();

      const result = await prewarmPromise;
      assert.ok(result.indexed < 3);
    });

    it("should clean up prewarm abort controller", async () => {
      await engine.prewarm();
      engine.dispose();
      assert.strictEqual(engine._prewarmAbort, null);
    });
  });
});
