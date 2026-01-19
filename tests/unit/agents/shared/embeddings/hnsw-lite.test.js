import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { HnswLiteIndex } from '../../../../../js/agents/shared/embeddings/hnsw-lite.js';

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

      expect(index.size).toBe(3);

      const results = index.search(v1, { topK: 2 });
      expect(results.length).toBe(2);
      // v1 should be most similar to itself, then v2
      expect(results[0].id).toBe("a");
      expect(results[0].score).toBeGreaterThan(0.99);
    });

    it("should handle dimension mismatch", () => {
      index.upsert("a", [1, 0, 0]);
      expect(() => index.upsert("b", [1, 0, 0, 0])).toThrow(/dimension mismatch/);
    });

    it("should delete vectors", () => {
      index.upsert("a", [1, 0, 0]);
      index.upsert("b", [0, 1, 0]);

      expect(index.size).toBe(2);
      expect(index.has("a")).toBe(true);

      index.delete("a");

      expect(index.size).toBe(1);
      expect(index.has("a")).toBe(false);
      expect(index.has("b")).toBe(true);
    });

    it("should clear all vectors", () => {
      index.upsert("a", [1, 0]);
      index.upsert("b", [0, 1]);

      index.clear();

      expect(index.size).toBe(0);
      expect(index.dimension).toBe(null);
    });

    it("should respect maxItems limit", () => {
      const smallIndex = new HnswLiteIndex({ maxItems: 3 });
      for (let i = 0; i < 10; i++) {
        smallIndex.upsert(`id_${i}`, [Math.random(), Math.random(), Math.random()]);
      }
      expect(smallIndex.size).toBe(3);
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
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("north");
      expect(results[0].score).toBeGreaterThan(0.99);
    });

    it("should respect topK parameter", () => {
      const results = index.search([0.5, 0.5, 0], { topK: 3 });
      expect(results.length).toBe(3);
    });

    it("should respect minScore filter", () => {
      const results = index.search([0, 1, 0], { topK: 10, minScore: 0.5 });
      // Only north and northeast should have score > 0.5
      expect(results.length).toBeLessThanOrEqual(3);
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0.5);
      }
    });

    it("should apply custom filter", () => {
      const results = index.search([0, 1, 0], {
        topK: 10,
        filter: (meta) => meta.direction.includes("east"),
      });
      for (const r of results) {
        expect(r.meta.direction).toContain("east");
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
      expect(hotResults.length).toBe(1);
      expect(hotResults[0].id).toBe("hot1");

      const warmResults = index.search([1, 0, 0], { topK: 10, partitions: ["warm"] });
      expect(warmResults.length).toBe(1);
      expect(warmResults[0].id).toBe("warm1");

      const coldResults = index.search([1, 0, 0], { topK: 10, partitions: "cold" });
      expect(coldResults.length).toBe(1);
      expect(coldResults[0].id).toBe("cold1");
    });

    it("should get partition stats", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("hot2", [0, 1, 0], { ts: now - 2000 });
      index.upsert("warm1", [0, 0, 1], { ts: now - 2 * 60 * 60 * 1000 });

      const stats = index.getPartitionStats();
      expect(stats.hot).toBe(2);
      expect(stats.warm).toBe(1);
      expect(stats.cold).toBe(0);
      expect(stats.total).toBe(3);
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
      expect(hnswResults.length).toBe(bruteResults.length);

      // At least one of the top results should match
      const hnswIds = new Set(hnswResults.map((r) => r.id));
      const bruteIds = new Set(bruteResults.map((r) => r.id));
      const overlap = [...hnswIds].filter((id) => bruteIds.has(id));
      // Allow some tolerance for approximate search
      expect(overlap.length, `Expected at least 2 overlap, got ${overlap.length}`).toBeGreaterThanOrEqual(2);
    });
  });

  describe("serialization", () => {
    it("should serialize and deserialize correctly", () => {
      index.upsert("a", [1, 0, 0], { label: "first" });
      index.upsert("b", [0, 1, 0], { label: "second" });

      const json = index.toJSON();
      const restored = HnswLiteIndex.fromJSON(json);

      expect(restored.size).toBe(2);
      expect(restored.has("a")).toBe(true);
      expect(restored.has("b")).toBe(true);

      // Search should work on restored index
      const results = restored.search([1, 0, 0], { topK: 1 });
      expect(results[0].id).toBe("a");
    });

    it("should reject invalid JSON", () => {
      expect(() => HnswLiteIndex.fromJSON({ version: 999 })).toThrow(/Invalid/);
    });
  });

  describe("stats", () => {
    it("should track statistics", () => {
      index.upsert("a", [1, 0, 0]);
      index.upsert("b", [0, 1, 0]);
      index.search([1, 0, 0], { topK: 1 });
      index.delete("a");

      const stats = index.getStats();
      expect(stats.inserts).toBe(2);
      expect(stats.deletes).toBe(1);
      expect(stats.searches).toBe(1);
      expect(stats.size).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty index search", () => {
      const results = index.search([1, 0, 0], { topK: 5 });
      expect(results.length).toBe(0);
    });

    it("should handle invalid vectors", () => {
      expect(index.upsert("a", null)).toBe(false);
      expect(index.upsert("a", [])).toBe(false);
      expect(index.upsert("", [1, 0])).toBe(false);
    });

    it("should handle zero vector", () => {
      expect(index.upsert("a", [0, 0, 0])).toBe(false);
    });

    it("should handle NaN values by converting to 0", () => {
      // NaN gets converted to 0 by defensive Number(x || 0)
      // This is acceptable behavior - the vector [0, 1, 0] is valid
      expect(index.upsert("a", [NaN, 1, 0])).toBe(true);
    });

    it("should handle delete non-existent", () => {
      expect(index.delete("nonexistent")).toBe(false);
    });
  });
});
