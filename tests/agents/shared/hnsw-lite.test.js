import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { HnswLiteIndex } from "../../../js/agents/shared/embeddings/hnsw-lite.js";

describe("HnswLiteIndex", () => {
  let index;

  beforeEach(() => {
    index = new HnswLiteIndex({ maxItems: 1000, numHashBits: 6, seed: 42 });
  });

  describe("basic operations", () => {
    it("should upsert and search vectors", () => {
      const v1 = [1, 0, 0, 0];
      const v2 = [0.9, 0.1, 0, 0];
      const v3 = [0, 1, 0, 0];

      index.upsert("a", v1, { label: "first" });
      index.upsert("b", v2, { label: "second" });
      index.upsert("c", v3, { label: "third" });

      assert.strictEqual(index.size, 3);

      const results = index.search(v1, { topK: 2 });
      assert.strictEqual(results.length, 2);
      // v1 should be most similar to itself, then v2
      assert.strictEqual(results[0].id, "a");
      assert.ok(results[0].score > 0.99);
    });

    it("should handle dimension mismatch", () => {
      index.upsert("a", [1, 0, 0]);
      assert.throws(
        () => index.upsert("b", [1, 0, 0, 0]),
        { message: /dimension mismatch/ }
      );
    });

    it("should delete vectors", () => {
      index.upsert("a", [1, 0, 0]);
      index.upsert("b", [0, 1, 0]);

      assert.strictEqual(index.size, 2);
      assert.ok(index.has("a"));

      index.delete("a");

      assert.strictEqual(index.size, 1);
      assert.ok(!index.has("a"));
      assert.ok(index.has("b"));
    });

    it("should clear all vectors", () => {
      index.upsert("a", [1, 0]);
      index.upsert("b", [0, 1]);

      index.clear();

      assert.strictEqual(index.size, 0);
      assert.strictEqual(index.dimension, null);
    });

    it("should respect maxItems limit", () => {
      const smallIndex = new HnswLiteIndex({ maxItems: 3 });
      for (let i = 0; i < 10; i++) {
        smallIndex.upsert(`id_${i}`, [Math.random(), Math.random(), Math.random()]);
      }
      assert.strictEqual(smallIndex.size, 3);
    });
  });

  describe("search functionality", () => {
    beforeEach(() => {
      // Create a set of vectors with known similarities
      index.upsert("north", [0, 1, 0], { direction: "north" });
      index.upsert("south", [0, -1, 0], { direction: "south" });
      index.upsert("east", [1, 0, 0], { direction: "east" });
      index.upsert("west", [-1, 0, 0], { direction: "west" });
      index.upsert("northeast", [0.707, 0.707, 0], { direction: "northeast" });
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

    it("should respect minScore filter", () => {
      const results = index.search([0, 1, 0], { topK: 10, minScore: 0.5 });
      // Only north and northeast should have score > 0.5
      assert.ok(results.length <= 3);
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
  });

  describe("partition filtering", () => {
    it("should filter by hot/warm/cold partitions", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 }); // 1 second ago (hot)
      index.upsert("warm1", [0.9, 0.1, 0], { ts: now - 2 * 60 * 60 * 1000 }); // 2 hours ago (warm)
      index.upsert("cold1", [0.8, 0.2, 0], { ts: now - 48 * 60 * 60 * 1000 }); // 48 hours ago (cold)

      const hotResults = index.search([1, 0, 0], { topK: 10, partitions: "hot" });
      assert.strictEqual(hotResults.length, 1);
      assert.strictEqual(hotResults[0].id, "hot1");

      const warmResults = index.search([1, 0, 0], { topK: 10, partitions: ["warm"] });
      assert.strictEqual(warmResults.length, 1);
      assert.strictEqual(warmResults[0].id, "warm1");

      const coldResults = index.search([1, 0, 0], { topK: 10, partitions: "cold" });
      assert.strictEqual(coldResults.length, 1);
      assert.strictEqual(coldResults[0].id, "cold1");
    });

    it("should get partition stats", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("hot2", [0, 1, 0], { ts: now - 2000 });
      index.upsert("warm1", [0, 0, 1], { ts: now - 2 * 60 * 60 * 1000 });

      const stats = index.getPartitionStats();
      assert.strictEqual(stats.hot, 2);
      assert.strictEqual(stats.warm, 1);
      assert.strictEqual(stats.cold, 0);
      assert.strictEqual(stats.total, 3);
    });
  });

  describe("brute force comparison", () => {
    it("should return same results as brute force for small datasets", () => {
      // Create random vectors
      const rng = () => Math.random() - 0.5;
      for (let i = 0; i < 100; i++) {
        index.upsert(`v_${i}`, [rng(), rng(), rng(), rng()]);
      }

      const query = [rng(), rng(), rng(), rng()];
      const hnswResults = index.search(query, { topK: 5 });
      const bruteResults = index.searchBruteForce(query, { topK: 5 });

      // HNSW-Lite is approximate, so results may differ
      // But the top result should often be the same
      assert.strictEqual(hnswResults.length, bruteResults.length);

      // At least one of the top results should match
      const hnswIds = new Set(hnswResults.map((r) => r.id));
      const bruteIds = new Set(bruteResults.map((r) => r.id));
      const overlap = [...hnswIds].filter((id) => bruteIds.has(id));
      // Allow some tolerance for approximate search
      assert.ok(overlap.length >= 2, `Expected at least 2 overlap, got ${overlap.length}`);
    });
  });

  describe("serialization", () => {
    it("should serialize and deserialize correctly", () => {
      index.upsert("a", [1, 0, 0], { label: "first" });
      index.upsert("b", [0, 1, 0], { label: "second" });

      const json = index.toJSON();
      const restored = HnswLiteIndex.fromJSON(json);

      assert.strictEqual(restored.size, 2);
      assert.ok(restored.has("a"));
      assert.ok(restored.has("b"));

      // Search should work on restored index
      const results = restored.search([1, 0, 0], { topK: 1 });
      assert.strictEqual(results[0].id, "a");
    });

    it("should reject invalid JSON", () => {
      assert.throws(
        () => HnswLiteIndex.fromJSON({ version: 999 }),
        { message: /Invalid/ }
      );
    });
  });

  describe("stats", () => {
    it("should track statistics", () => {
      index.upsert("a", [1, 0, 0]);
      index.upsert("b", [0, 1, 0]);
      index.search([1, 0, 0], { topK: 1 });
      index.delete("a");

      const stats = index.getStats();
      assert.strictEqual(stats.inserts, 2);
      assert.strictEqual(stats.deletes, 1);
      assert.strictEqual(stats.searches, 1);
      assert.strictEqual(stats.size, 1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty index search", () => {
      const results = index.search([1, 0, 0], { topK: 5 });
      assert.strictEqual(results.length, 0);
    });

    it("should handle invalid vectors", () => {
      assert.strictEqual(index.upsert("a", null), false);
      assert.strictEqual(index.upsert("a", []), false);
      assert.strictEqual(index.upsert("", [1, 0]), false);
    });

    it("should handle zero vector", () => {
      assert.strictEqual(index.upsert("a", [0, 0, 0]), false);
    });

    it("should handle NaN values by converting to 0", () => {
      // NaN gets converted to 0 by defensive Number(x || 0)
      // This is acceptable behavior - the vector [0, 1, 0] is valid
      assert.strictEqual(index.upsert("a", [NaN, 1, 0]), true);
    });

    it("should handle delete non-existent", () => {
      assert.strictEqual(index.delete("nonexistent"), false);
    });
  });
});
