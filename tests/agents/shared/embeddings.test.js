import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  EmbeddingService,
  createEmbeddingService,
  normalizeEmbeddingConfig,
} from "../../../js/agents/shared/embeddings/embedding-service.js";
import { VectorIndex } from "../../../js/agents/shared/embeddings/vector-index.js";

// ============================================================================
// normalizeEmbeddingConfig Tests
// ============================================================================

describe("normalizeEmbeddingConfig", () => {
  it("should return null for invalid input", () => {
    assert.strictEqual(normalizeEmbeddingConfig(null), null);
    assert.strictEqual(normalizeEmbeddingConfig(undefined), null);
    assert.strictEqual(normalizeEmbeddingConfig("string"), null);
    assert.strictEqual(normalizeEmbeddingConfig(123), null);
  });

  it("should return null without endpoint", () => {
    assert.strictEqual(normalizeEmbeddingConfig({}), null);
    assert.strictEqual(normalizeEmbeddingConfig({ model: "test" }), null);
  });

  it("should return null when disabled", () => {
    assert.strictEqual(
      normalizeEmbeddingConfig({ endpoint: "http://test", enabled: false }),
      null
    );
  });

  it("should normalize valid config with defaults", () => {
    const cfg = normalizeEmbeddingConfig({ endpoint: "http://test" });
    assert.strictEqual(cfg.endpoint, "http://test");
    assert.strictEqual(cfg.model, null);
    assert.strictEqual(cfg.apiKey, null);
    assert.deepStrictEqual(cfg.headers, {});
    assert.strictEqual(cfg.timeoutMs, 5000);
    assert.strictEqual(cfg.batchSize, 32);
    assert.strictEqual(cfg.flushIntervalMs, 30);
    assert.strictEqual(cfg.maxQueue, 2000);
    assert.strictEqual(cfg.cooldownMs, 300000);
  });

  it("should accept url or baseUrl as endpoint", () => {
    const cfg1 = normalizeEmbeddingConfig({ url: "http://a" });
    const cfg2 = normalizeEmbeddingConfig({ baseUrl: "http://b" });
    assert.strictEqual(cfg1.endpoint, "http://a");
    assert.strictEqual(cfg2.endpoint, "http://b");
  });

  it("should normalize model and apiKey", () => {
    const cfg = normalizeEmbeddingConfig({
      endpoint: "http://test",
      model: "text-embedding-3",
      key: "sk-123",
    });
    assert.strictEqual(cfg.model, "text-embedding-3");
    assert.strictEqual(cfg.apiKey, "sk-123");
  });

  it("should accept apiKey field", () => {
    const cfg = normalizeEmbeddingConfig({
      endpoint: "http://test",
      apiKey: "sk-456",
    });
    assert.strictEqual(cfg.apiKey, "sk-456");
  });

  it("should parse custom headers", () => {
    const cfg = normalizeEmbeddingConfig({
      endpoint: "http://test",
      headers: { "X-Custom": "value", invalid: null },
    });
    assert.strictEqual(cfg.headers["X-Custom"], "value");
    assert.strictEqual(cfg.headers["invalid"], "");
  });

  it("should ignore non-object headers", () => {
    const cfg = normalizeEmbeddingConfig({
      endpoint: "http://test",
      headers: "not-an-object",
    });
    assert.deepStrictEqual(cfg.headers, {});
  });
});

// ============================================================================
// EmbeddingService Tests
// ============================================================================

describe("EmbeddingService", () => {
  describe("constructor and enabled state", () => {
    it("should be disabled without valid config", () => {
      const svc = new EmbeddingService(null);
      assert.strictEqual(svc.enabled, false);
    });

    it("should be disabled without fetch", () => {
      const svc = new EmbeddingService({ endpoint: "http://test" }, { fetchImpl: null });
      assert.strictEqual(svc.enabled, false);
    });

    it("should be enabled with valid config and fetch", () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        { fetchImpl: () => Promise.resolve({ ok: true, json: () => ({}) }) }
      );
      assert.strictEqual(svc.enabled, true);
    });
  });

  describe("getStatus", () => {
    it("should return status object", () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", model: "text-3" },
        { fetchImpl: () => {} }
      );
      const status = svc.getStatus();
      assert.strictEqual(status.enabled, true);
      assert.strictEqual(status.available, null);
      assert.strictEqual(status.failures, 0);
      assert.strictEqual(status.endpoint, "http://test");
      assert.strictEqual(status.model, "text-3");
    });

    it("should return null endpoint/model when disabled", () => {
      const svc = new EmbeddingService(null);
      const status = svc.getStatus();
      assert.strictEqual(status.enabled, false);
      assert.strictEqual(status.endpoint, null);
      assert.strictEqual(status.model, null);
    });
  });

  describe("embed with mock API", () => {
    let fetchCalls;

    beforeEach(() => {
      fetchCalls = [];
    });

    function createMockFetch(response) {
      return async (url, options) => {
        fetchCalls.push({ url, options });
        return response;
      };
    }

    it("should return null when disabled", async () => {
      const svc = new EmbeddingService(null);
      const result = await svc.embed("hello");
      assert.strictEqual(result, null);
    });

    it("should return empty array for empty input", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ data: [{ embedding: [1, 2, 3], index: 0 }] }),
          }),
        }
      );
      const result = await svc.embed([]);
      assert.deepStrictEqual(result, []);
      assert.strictEqual(fetchCalls.length, 0);
    });

    it("should filter out empty/whitespace strings", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ data: [{ embedding: [1], index: 0 }] }),
          }),
        }
      );
      const result = await svc.embed(["", "  ", "valid"]);
      assert.strictEqual(result.length, 1);
      const body = JSON.parse(fetchCalls[0].options.body);
      assert.deepStrictEqual(body.input, ["valid"]);
    });

    it("should call API and return embeddings (OpenAI format)", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", model: "text-3", apiKey: "sk-test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({
              data: [
                { embedding: [0.1, 0.2, 0.3], index: 0 },
                { embedding: [0.4, 0.5, 0.6], index: 1 },
              ],
            }),
          }),
        }
      );

      const result = await svc.embed(["hello", "world"]);
      assert.strictEqual(result.length, 2);
      assert.ok(result[0] instanceof Float32Array);
      assert.ok(result[1] instanceof Float32Array);
      assert.strictEqual(result[0].length, 3);
      assert.ok(Math.abs(result[0][0] - 0.1) < 0.001);
      assert.ok(Math.abs(result[1][0] - 0.4) < 0.001);

      assert.strictEqual(fetchCalls.length, 1);
      const body = JSON.parse(fetchCalls[0].options.body);
      assert.strictEqual(body.model, "text-3");
      assert.deepStrictEqual(body.input, ["hello", "world"]);
      assert.ok(fetchCalls[0].options.headers.Authorization.includes("sk-test"));
    });

    it("should handle unordered index in response", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({
              data: [
                { embedding: [0.4, 0.5, 0.6], index: 1 },
                { embedding: [0.1, 0.2, 0.3], index: 0 },
              ],
            }),
          }),
        }
      );

      const result = await svc.embed(["a", "b"]);
      assert.ok(Math.abs(result[0][0] - 0.1) < 0.001);
      assert.ok(Math.abs(result[1][0] - 0.4) < 0.001);
    });

    it("should handle embeddings array format", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
          }),
        }
      );

      const result = await svc.embed(["a", "b"]);
      assert.strictEqual(result.length, 2);
    });

    it("should handle single embedding format", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ embedding: [0.1, 0.2, 0.3] }),
          }),
        }
      );

      const result = await svc.embed("single");
      assert.strictEqual(result.length, 1);
    });

    it("should handle vector format", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ vector: [0.1, 0.2, 0.3] }),
          }),
        }
      );

      const result = await svc.embed("single");
      assert.strictEqual(result.length, 1);
    });

    it("should handle nested array format in data", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ data: [[0.1, 0.2], [0.3, 0.4]] }),
          }),
        }
      );

      const result = await svc.embed(["a", "b"]);
      assert.strictEqual(result.length, 2);
    });

    it("should mark failure on non-ok response", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 1000 },
        { fetchImpl: createMockFetch({ ok: false, status: 500 }) }
      );

      const result = await svc.embed("test");
      assert.strictEqual(result, null);
      assert.strictEqual(svc.getStatus().available, false);
      assert.strictEqual(svc.getStatus().failures, 1);
    });

    it("should mark failure on json parse error", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 1000 },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => {
              throw new Error("parse error");
            },
          }),
        }
      );

      const result = await svc.embed("test");
      assert.strictEqual(result, null);
      assert.strictEqual(svc.getStatus().failures, 1);
    });

    it("should mark failure on invalid response format", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 1000 },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ unexpected: "format" }),
          }),
        }
      );

      const result = await svc.embed("test");
      assert.strictEqual(result, null);
      assert.strictEqual(svc.getStatus().failures, 1);
    });

    it("should mark failure on fetch exception", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 1000 },
        {
          fetchImpl: async () => {
            throw new Error("network error");
          },
        }
      );

      const result = await svc.embed("test");
      assert.strictEqual(result, null);
      assert.strictEqual(svc.getStatus().failures, 1);
    });

    it("should respect cooldown after failure", async () => {
      let callCount = 0;
      const svc = new EmbeddingService(
        { endpoint: "http://test", cooldownMs: 60000 },
        {
          fetchImpl: async () => {
            callCount++;
            throw new Error("fail");
          },
        }
      );

      await svc.embed("test1");
      assert.strictEqual(callCount, 1);

      await svc.embed("test2");
      assert.strictEqual(callCount, 1);
    });

    it("should not skip existing authorization header", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", apiKey: "sk-test", headers: { Authorization: "Custom auth" } },
        {
          fetchImpl: createMockFetch({
            ok: true,
            json: () => ({ embedding: [1] }),
          }),
        }
      );

      await svc.embed("test");
      assert.strictEqual(fetchCalls[0].options.headers.Authorization, "Custom auth");
    });
  });

  describe("enqueue and flush", () => {
    it("should batch multiple enqueue calls", async () => {
      let batchSizes = [];
      const svc = new EmbeddingService(
        { endpoint: "http://test", batchSize: 10, flushIntervalMs: 5 },
        {
          fetchImpl: async (url, opts) => {
            const body = JSON.parse(opts.body);
            batchSizes.push(body.input.length);
            return {
              ok: true,
              json: () => ({
                data: body.input.map((_, i) => ({ embedding: [i], index: i })),
              }),
            };
          },
        }
      );

      const p1 = svc.enqueue(["a", "b", "c"]);
      const p2 = svc.enqueue(["d", "e"]);

      const [r1, r2] = await Promise.all([p1, p2]);
      assert.strictEqual(r1.length, 3);
      assert.strictEqual(r2.length, 2);
    });

    it("should respect maxQueue limit", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test", maxQueue: 5, flushIntervalMs: 1000 },
        {
          fetchImpl: async () => ({
            ok: true,
            json: () => ({ data: [{ embedding: [1], index: 0 }] }),
          }),
        }
      );

      for (let i = 0; i < 10; i++) {
        svc.enqueue(`text-${i}`);
      }

      const result = await svc.enqueue("overflow");
      assert.strictEqual(result, null);
    });

    it("should handle immediate flush", async () => {
      let flushCount = 0;
      const svc = new EmbeddingService(
        { endpoint: "http://test", flushIntervalMs: 10000 },
        {
          fetchImpl: async (url, opts) => {
            flushCount++;
            const body = JSON.parse(opts.body);
            return {
              ok: true,
              json: () => ({
                data: body.input.map((_, i) => ({ embedding: [i], index: i })),
              }),
            };
          },
        }
      );

      const result = await svc.enqueue("test", { immediate: true });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(flushCount, 1);
    });

    it("should return null from enqueue when disabled", async () => {
      const svc = new EmbeddingService(null);
      const result = await svc.enqueue("test");
      assert.strictEqual(result, null);
    });

    it("should return empty array for empty enqueue", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        { fetchImpl: async () => ({ ok: true, json: () => ({}) }) }
      );
      const result = await svc.enqueue([]);
      assert.deepStrictEqual(result, []);
    });
  });

  describe("flush edge cases", () => {
    it("should return false when disabled", async () => {
      const svc = new EmbeddingService(null);
      const result = await svc.flush();
      assert.strictEqual(result, false);
    });

    it("should return true when queue is empty", async () => {
      const svc = new EmbeddingService(
        { endpoint: "http://test" },
        { fetchImpl: async () => ({ ok: true, json: () => ({}) }) }
      );
      const result = await svc.flush();
      assert.strictEqual(result, true);
    });
  });

  describe("createEmbeddingService factory", () => {
    it("should create service instance", () => {
      const svc = createEmbeddingService(
        { endpoint: "http://test" },
        { fetchImpl: () => {} }
      );
      assert.ok(svc instanceof EmbeddingService);
    });
  });
});

// ============================================================================
// VectorIndex Tests
// ============================================================================

describe("VectorIndex", () => {
  /** @type {VectorIndex} */
  let index;

  beforeEach(() => {
    index = new VectorIndex({ maxItems: 100 });
  });

  describe("basic operations", () => {
    it("should upsert and retrieve vectors", () => {
      const v1 = [1, 0, 0];
      const v2 = [0, 1, 0];

      assert.ok(index.upsert("a", v1, { label: "first" }));
      assert.ok(index.upsert("b", v2, { label: "second" }));

      assert.strictEqual(index.size, 2);
      assert.strictEqual(index.dimension, 3);
      assert.ok(index.has("a"));
      assert.ok(index.has("b"));
      assert.ok(!index.has("c"));
    });

    it("should update existing vector", () => {
      index.upsert("a", [1, 0, 0]);
      index.upsert("a", [0, 1, 0]);

      assert.strictEqual(index.size, 1);
      const results = index.search([0, 1, 0], { topK: 1 });
      assert.strictEqual(results[0].id, "a");
      assert.ok(results[0].score > 0.99);
    });

    it("should delete vectors", () => {
      index.upsert("a", [1, 0, 0]);
      index.upsert("b", [0, 1, 0]);

      assert.ok(index.delete("a"));
      assert.strictEqual(index.size, 1);
      assert.ok(!index.has("a"));
      assert.ok(index.has("b"));

      assert.ok(!index.delete("nonexistent"));
    });

    it("should clear all vectors", () => {
      index.upsert("a", [1, 0]);
      index.upsert("b", [0, 1]);

      index.clear();

      assert.strictEqual(index.size, 0);
      assert.strictEqual(index.dimension, null);
    });

    it("should throw on dimension mismatch", () => {
      index.upsert("a", [1, 0, 0]);

      assert.throws(
        () => index.upsert("b", [1, 0, 0, 0]),
        { message: /dimension mismatch/ }
      );
    });

    it("should respect maxItems limit with LRU eviction", () => {
      const smallIndex = new VectorIndex({ maxItems: 3 });
      smallIndex.upsert("a", [1, 0]);
      smallIndex.upsert("b", [0, 1]);
      smallIndex.upsert("c", [1, 1]);
      smallIndex.upsert("d", [0.5, 0.5]);

      assert.strictEqual(smallIndex.size, 3);
      assert.ok(!smallIndex.has("a"));
      assert.ok(smallIndex.has("b"));
      assert.ok(smallIndex.has("c"));
      assert.ok(smallIndex.has("d"));
    });

    it("should refresh LRU order on update", () => {
      const smallIndex = new VectorIndex({ maxItems: 3 });
      smallIndex.upsert("a", [1, 0]);
      smallIndex.upsert("b", [0, 1]);
      smallIndex.upsert("a", [1, 0]);
      smallIndex.upsert("c", [1, 1]);
      smallIndex.upsert("d", [0.5, 0.5]);

      assert.strictEqual(smallIndex.size, 3);
      assert.ok(smallIndex.has("a"));
      assert.ok(!smallIndex.has("b"));
    });
  });

  describe("vector normalization", () => {
    it("should accept Float32Array", () => {
      const vec = new Float32Array([1, 0, 0]);
      assert.ok(index.upsert("a", vec));
    });

    it("should accept regular array", () => {
      assert.ok(index.upsert("a", [1, 0, 0]));
    });

    it("should accept ArrayBuffer", () => {
      const arr = new Float32Array([1, 0, 0]);
      assert.ok(index.upsert("a", arr.buffer));
    });

    it("should accept Uint8Array view", () => {
      const f32 = new Float32Array([1, 0, 0]);
      const u8 = new Uint8Array(f32.buffer);
      assert.ok(index.upsert("a", u8));
    });

    it("should reject null/undefined vectors", () => {
      assert.strictEqual(index.upsert("a", null), false);
      assert.strictEqual(index.upsert("a", undefined), false);
    });

    it("should reject empty vectors", () => {
      assert.strictEqual(index.upsert("a", []), false);
    });

    it("should reject zero vectors", () => {
      assert.strictEqual(index.upsert("a", [0, 0, 0]), false);
    });

    it("should reject invalid id", () => {
      assert.strictEqual(index.upsert("", [1, 0]), false);
      assert.strictEqual(index.upsert(null, [1, 0]), false);
    });

    it("should handle NaN by converting to 0", () => {
      assert.ok(index.upsert("a", [NaN, 1, 0]));
    });

    it("should reject vector with all NaN", () => {
      assert.strictEqual(index.upsert("a", [NaN, NaN, NaN]), false);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      index.upsert("north", [0, 1, 0], { direction: "north" });
      index.upsert("south", [0, -1, 0], { direction: "south" });
      index.upsert("east", [1, 0, 0], { direction: "east" });
      index.upsert("west", [-1, 0, 0], { direction: "west" });
      index.upsert("northeast", [0.707, 0.707, 0], { direction: "northeast" });
    });

    it("should return empty for empty index", () => {
      const emptyIndex = new VectorIndex();
      const results = emptyIndex.search([1, 0, 0]);
      assert.strictEqual(results.length, 0);
    });

    it("should find exact match with highest score", () => {
      const results = index.search([0, 1, 0], { topK: 1 });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].id, "north");
      assert.ok(results[0].score > 0.99);
    });

    it("should respect topK parameter", () => {
      const results = index.search([0.5, 0.5, 0], { topK: 3 });
      assert.strictEqual(results.length, 3);
    });

    it("should default topK to 5", () => {
      const results = index.search([0.5, 0.5, 0]);
      assert.strictEqual(results.length, 5);
    });

    it("should sort by descending score", () => {
      const results = index.search([0, 1, 0], { topK: 5 });
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].score >= results[i].score);
      }
    });

    it("should apply minScore filter", () => {
      const results = index.search([0, 1, 0], { topK: 10, minScore: 0.5 });
      for (const r of results) {
        assert.ok(r.score >= 0.5);
      }
    });

    it("should apply custom filter", () => {
      const results = index.search([0, 1, 0], {
        topK: 10,
        filter: (meta) => meta.direction.includes("east"),
      });
      for (const r of results) {
        assert.ok(r.meta.direction.includes("east"));
      }
    });

    it("should pass id to filter function", () => {
      const ids = [];
      index.search([1, 0, 0], {
        topK: 5,
        filter: (meta, id) => {
          ids.push(id);
          return true;
        },
      });
      assert.ok(ids.includes("north"));
      assert.ok(ids.includes("east"));
    });

    it("should return empty for invalid query vector", () => {
      assert.strictEqual(index.search(null).length, 0);
      assert.strictEqual(index.search([]).length, 0);
      assert.strictEqual(index.search([0, 0, 0]).length, 0);
    });

    it("should return empty for dimension mismatch query", () => {
      const results = index.search([1, 0], { topK: 5 });
      assert.strictEqual(results.length, 0);
    });

    it("should include meta in results", () => {
      const results = index.search([1, 0, 0], { topK: 1 });
      assert.strictEqual(results[0].meta.direction, "east");
    });
  });

  describe("partition filtering", () => {
    it("should filter by hot/warm/cold partitions", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("warm1", [0.9, 0.1, 0], { ts: now - 2 * 60 * 60 * 1000 });
      index.upsert("cold1", [0.8, 0.2, 0], { ts: now - 48 * 60 * 60 * 1000 });

      const hotResults = index.search([1, 0, 0], { topK: 10, partitions: "hot" });
      assert.strictEqual(hotResults.length, 1);
      assert.strictEqual(hotResults[0].id, "hot1");

      const warmResults = index.search([1, 0, 0], { topK: 10, partitions: ["warm"] });
      assert.strictEqual(warmResults.length, 1);
      assert.strictEqual(warmResults[0].id, "warm1");

      const multiResults = index.search([1, 0, 0], { topK: 10, partitions: ["hot", "warm"] });
      assert.strictEqual(multiResults.length, 2);
    });

    it("should classify missing ts as cold", () => {
      const now = Date.now();
      index.upsert("no-ts", [1, 0, 0], {});
      index.upsert("hot", [0.9, 0.1, 0], { ts: now - 1000 });

      const coldResults = index.search([1, 0, 0], { topK: 10, partitions: "cold" });
      assert.strictEqual(coldResults.length, 1);
      assert.strictEqual(coldResults[0].id, "no-ts");
    });

    it("should handle null partitions (no filter)", () => {
      const now = Date.now();
      index.upsert("hot", [1, 0, 0], { ts: now - 1000 });
      index.upsert("cold", [0.9, 0.1, 0], {});

      const results = index.search([1, 0, 0], { topK: 10, partitions: null });
      assert.strictEqual(results.length, 2);
    });
  });

  describe("getPartitionStats", () => {
    it("should return partition counts", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("hot2", [0, 1, 0], { ts: now - 2000 });
      index.upsert("warm1", [0, 0, 1], { ts: now - 2 * 60 * 60 * 1000 });
      index.upsert("cold1", [1, 1, 0], { ts: now - 48 * 60 * 60 * 1000 });

      const stats = index.getPartitionStats();
      assert.strictEqual(stats.hot, 2);
      assert.strictEqual(stats.warm, 1);
      assert.strictEqual(stats.cold, 1);
      assert.strictEqual(stats.total, 4);
    });

    it("should return zeros for empty index", () => {
      const stats = index.getPartitionStats();
      assert.strictEqual(stats.hot, 0);
      assert.strictEqual(stats.warm, 0);
      assert.strictEqual(stats.cold, 0);
      assert.strictEqual(stats.total, 0);
    });
  });

  describe("edge cases", () => {
    it("should handle has with invalid id", () => {
      assert.strictEqual(index.has(""), false);
      assert.strictEqual(index.has(null), false);
    });

    it("should handle delete with invalid id", () => {
      assert.strictEqual(index.delete(""), false);
      assert.strictEqual(index.delete(null), false);
    });

    it("should handle search with topK <= 0", () => {
      index.upsert("a", [1, 0]);
      assert.strictEqual(index.search([1, 0], { topK: 0 }).length, 0);
      assert.strictEqual(index.search([1, 0], { topK: -1 }).length, 0);
    });

    it("should handle default options", () => {
      const idx = new VectorIndex();
      assert.strictEqual(idx.dimension, null);
      assert.strictEqual(idx.size, 0);
    });

    it("should handle non-object options", () => {
      const idx = new VectorIndex("invalid");
      assert.strictEqual(idx.size, 0);
    });
  });
});

// ============================================================================
// Multi-provider Support Tests
// ============================================================================

describe("Multi-provider embedding support", () => {
  it("should work with OpenAI response format", async () => {
    const svc = new EmbeddingService(
      { endpoint: "https://api.openai.com/v1/embeddings" },
      {
        fetchImpl: async () => ({
          ok: true,
          json: () => ({
            object: "list",
            data: [{ object: "embedding", embedding: [0.1, 0.2], index: 0 }],
            model: "text-embedding-3-small",
            usage: { prompt_tokens: 5, total_tokens: 5 },
          }),
        }),
      }
    );

    const result = await svc.embed("test");
    assert.strictEqual(result.length, 1);
    assert.ok(result[0] instanceof Float32Array);
  });

  it("should work with Ollama response format", async () => {
    const svc = new EmbeddingService(
      { endpoint: "http://localhost:11434/api/embeddings" },
      {
        fetchImpl: async () => ({
          ok: true,
          json: () => ({
            embedding: [0.1, 0.2, 0.3, 0.4],
          }),
        }),
      }
    );

    const result = await svc.embed("test");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].length, 4);
  });

  it("should work with batch array format", async () => {
    const svc = new EmbeddingService(
      { endpoint: "http://custom-api/embed" },
      {
        fetchImpl: async () => ({
          ok: true,
          json: () => ({
            data: [[0.1, 0.2], [0.3, 0.4]],
          }),
        }),
      }
    );

    const result = await svc.embed(["a", "b"]);
    assert.strictEqual(result.length, 2);
  });

  it("should include custom headers", async () => {
    let capturedHeaders;
    const svc = new EmbeddingService(
      {
        endpoint: "http://test",
        headers: { "X-Api-Version": "2024-01" },
        apiKey: "test-key",
      },
      {
        fetchImpl: async (url, opts) => {
          capturedHeaders = opts.headers;
          return {
            ok: true,
            json: () => ({ embedding: [1, 2, 3] }),
          };
        },
      }
    );

    await svc.embed("test");
    assert.strictEqual(capturedHeaders["X-Api-Version"], "2024-01");
    assert.ok(capturedHeaders["Authorization"].includes("test-key"));
  });

  it("should omit model when not provided", async () => {
    let capturedBody;
    const svc = new EmbeddingService(
      { endpoint: "http://test" },
      {
        fetchImpl: async (url, opts) => {
          capturedBody = JSON.parse(opts.body);
          return {
            ok: true,
            json: () => ({ embedding: [1] }),
          };
        },
      }
    );

    await svc.embed("test");
    assert.strictEqual(capturedBody.model, undefined);
  });
});

// ============================================================================
// Integration Tests with MemoryStore/SourceManager
// ============================================================================

describe("EmbeddingService integration", () => {
  it("should integrate with VectorIndex for semantic search", async () => {
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      const inputs = Array.isArray(body.input) ? body.input : [];
      const data = inputs.map((text, index) => {
        const s = String(text).toLowerCase();
        const revenue = s.includes("revenue") ? 1 : 0;
        const market = s.includes("market") ? 1 : 0;
        return { index, embedding: [revenue, market, 0] };
      });
      return { ok: true, json: () => ({ data }) };
    };

    const svc = new EmbeddingService(
      { endpoint: "http://test", flushIntervalMs: 0 },
      { fetchImpl }
    );

    const vectorIndex = new VectorIndex({ maxItems: 100 });

    const texts = ["Q3 revenue analysis", "Market share data", "Other content"];
    const embeddings = await svc.embed(texts);

    texts.forEach((text, i) => {
      vectorIndex.upsert(`doc-${i}`, embeddings[i], { text });
    });

    const queryEmbedding = await svc.embed("revenue");
    const results = vectorIndex.search(queryEmbedding[0], { topK: 2 });

    assert.strictEqual(results[0].id, "doc-0");
    assert.ok(results[0].meta.text.includes("revenue"));
  });
});
