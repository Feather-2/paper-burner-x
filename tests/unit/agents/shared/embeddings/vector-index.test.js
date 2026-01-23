
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { VectorIndex } from '../../../../../js/agents/shared/index.js';

describe("shared/embeddings/vector-index", () => {
  /** @type {VectorIndex} */
  let index;

  beforeEach(() => {
    index = new VectorIndex({ maxItems: 100 });
  });

  describe("constructor", () => {
    it("creates with default options", () => {
      const idx = new VectorIndex();
      expect(idx).toBeInstanceOf(VectorIndex);
      expect(idx.size).toBe(0);
      expect(idx.dimension).toBe(null);
    });

    it("accepts maxItems option", () => {
      const idx = new VectorIndex({ maxItems: 50 });
      expect(idx).toBeInstanceOf(VectorIndex);
    });

    it("handles non-object options", () => {
      const idx = new VectorIndex("invalid");
      expect(idx).toBeInstanceOf(VectorIndex);
    });
  });

  describe("upsert", () => {
    it("adds vector with id", () => {
      const result = index.upsert("doc1", [1, 0, 0]);
      expect(result).toBe(true);
      expect(index.size).toBe(1);
    });

    it("sets dimension on first insert", () => {
      index.upsert("doc1", [1, 0, 0]);
      expect(index.dimension).toBe(3);
    });

    it("returns false for empty id", () => {
      const result = index.upsert("", [1, 0, 0]);
      expect(result).toBe(false);
    });

    it("returns false for null id", () => {
      const result = index.upsert(null, [1, 0, 0]);
      expect(result).toBe(false);
    });

    it("returns false for null vector", () => {
      const result = index.upsert("doc1", null);
      expect(result).toBe(false);
    });

    it("returns false for empty vector", () => {
      const result = index.upsert("doc1", []);
      expect(result).toBe(false);
    });

    it("throws for dimension mismatch", () => {
      index.upsert("doc1", [1, 0, 0]);
      expect(() => index.upsert("doc2", [1, 0])).toThrow(/dimension mismatch/);
    });

    it("stores metadata", () => {
      index.upsert("doc1", [1, 0, 0], { title: "Test" });
      const results = index.search([1, 0, 0]);
      expect(results[0].meta.title).toBe("Test");
    });

    it("updates existing entry", () => {
      index.upsert("doc1", [1, 0, 0], { v: 1 });
      index.upsert("doc1", [0, 1, 0], { v: 2 });
      expect(index.size).toBe(1);
      const results = index.search([0, 1, 0]);
      expect(results[0].meta.v).toBe(2);
    });

    it("evicts oldest when over maxItems", () => {
      const smallIndex = new VectorIndex({ maxItems: 3 });
      smallIndex.upsert("a", [1, 0, 0]);
      smallIndex.upsert("b", [0, 1, 0]);
      smallIndex.upsert("c", [0, 0, 1]);
      smallIndex.upsert("d", [1, 1, 0]);
      expect(smallIndex.size).toBe(3);
      expect(smallIndex.has("a")).toBe(false);
    });

    it("accepts Float32Array", () => {
      const vec = new Float32Array([1, 0, 0]);
      const result = index.upsert("doc1", vec);
      expect(result).toBe(true);
    });

    it("accepts ArrayBuffer", () => {
      const vec = new Float32Array([1, 0, 0]).buffer;
      const result = index.upsert("doc1", vec);
      expect(result).toBe(true);
    });

    it("handles vector with NaN (converted to 0)", () => {
      // NaN is converted to 0 by Number() in toFloat32Array
      const result = index.upsert("doc1", [1, NaN, 0]);
      // After conversion: [1, 0, 0] - valid vector
      expect(result).toBe(true);
    });
  });

  describe("has", () => {
    it("returns true for existing id", () => {
      index.upsert("doc1", [1, 0, 0]);
      expect(index.has("doc1")).toBe(true);
    });

    it("returns false for non-existing id", () => {
      expect(index.has("missing")).toBe(false);
    });

    it("returns false for empty id", () => {
      expect(index.has("")).toBe(false);
    });
  });

  describe("delete", () => {
    it("removes existing entry", () => {
      index.upsert("doc1", [1, 0, 0]);
      const result = index.delete("doc1");
      expect(result).toBe(true);
      expect(index.has("doc1")).toBe(false);
    });

    it("returns false for non-existing id", () => {
      const result = index.delete("missing");
      expect(result).toBe(false);
    });

    it("returns false for empty id", () => {
      const result = index.delete("");
      expect(result).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      index.upsert("doc1", [1, 0, 0]);
      index.upsert("doc2", [0, 1, 0]);
      index.clear();
      expect(index.size).toBe(0);
      expect(index.dimension).toBe(null);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      index.upsert("doc1", [1, 0, 0], { label: "x" });
      index.upsert("doc2", [0, 1, 0], { label: "y" });
      index.upsert("doc3", [0, 0, 1], { label: "z" });
    });

    it("returns top matches", () => {
      const results = index.search([1, 0, 0]);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("doc1");
      expect(results[0].score).toBeGreaterThan(0.9);
    });

    it("respects topK", () => {
      const results = index.search([1, 0, 0], { topK: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("uses default topK when 0 passed", () => {
      // toPositiveInt returns fallback (5) for 0
      const results = index.search([1, 0, 0], { topK: 0 });
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty for empty index", () => {
      const emptyIndex = new VectorIndex();
      const results = emptyIndex.search([1, 0, 0]);
      expect(results).toEqual([]);
    });

    it("returns empty for null query", () => {
      const results = index.search(null);
      expect(results).toEqual([]);
    });

    it("returns empty for dimension mismatch", () => {
      const results = index.search([1, 0]);
      expect(results).toEqual([]);
    });

    it("applies filter function", () => {
      const results = index.search([1, 0, 0], {
        filter: (meta) => meta.label === "y",
      });
      if (results.length > 0) {
        expect(results[0].id).toBe("doc2");
      }
    });

    it("applies minScore threshold", () => {
      const results = index.search([1, 0, 0], { minScore: 0.99 });
      // Only exact match should pass
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("returns results sorted by score", () => {
      const results = index.search([0.7, 0.7, 0], { topK: 3 });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe("getPartitionStats", () => {
    it("returns partition statistics", () => {
      const stats = index.getPartitionStats();
      expect(typeof stats.hot).toBe("number");
      expect(typeof stats.warm).toBe("number");
      expect(typeof stats.cold).toBe("number");
      expect(typeof stats.total).toBe("number");
    });

    it("classifies by timestamp", () => {
      const now = Date.now();
      // Hot: less than 1 hour ago
      index.upsert("hot", [1, 0, 0], { ts: now - 1000 });
      // Warm: 1-24 hours ago
      index.upsert("warm", [0, 1, 0], { ts: now - 2 * 60 * 60 * 1000 });
      // Cold: more than 24 hours ago
      index.upsert("cold", [0, 0, 1], { ts: now - 48 * 60 * 60 * 1000 });

      const stats = index.getPartitionStats();
      expect(stats.hot).toBe(1);
      expect(stats.warm).toBe(1);
      expect(stats.cold).toBe(1);
    });

    it("classifies missing ts as cold", () => {
      index.upsert("doc", [1, 0, 0], {});
      const stats = index.getPartitionStats();
      expect(stats.cold).toBe(1);
    });
  });

  describe("partition filtering in search", () => {
    it("filters by single partition", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("cold1", [0, 1, 0], { ts: now - 48 * 60 * 60 * 1000 });

      const results = index.search([1, 0, 0], { partitions: "hot" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("hot1");
    });

    it("filters by multiple partitions", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("warm1", [0, 1, 0], { ts: now - 2 * 60 * 60 * 1000 });
      index.upsert("cold1", [0, 0, 1], { ts: now - 48 * 60 * 60 * 1000 });

      const results = index.search([1, 1, 1], { partitions: ["hot", "warm"] });
      expect(results.length).toBe(2);
    });
  });
});
