import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { VectorIndex } from "../../js/agents/shared/embeddings/vector-index.js";

describe("shared/embeddings/vector-index", () => {
  /** @type {VectorIndex} */
  let index;

  beforeEach(() => {
    index = new VectorIndex({ maxItems: 100 });
  });

  describe("constructor", () => {
    it("creates with default options", () => {
      const idx = new VectorIndex();
      assert.ok(idx);
      assert.equal(idx.size, 0);
      assert.equal(idx.dimension, null);
    });

    it("accepts maxItems option", () => {
      const idx = new VectorIndex({ maxItems: 50 });
      assert.ok(idx);
    });

    it("handles non-object options", () => {
      const idx = new VectorIndex("invalid");
      assert.ok(idx);
    });
  });

  describe("upsert", () => {
    it("adds vector with id", () => {
      const result = index.upsert("doc1", [1, 0, 0]);
      assert.ok(result);
      assert.equal(index.size, 1);
    });

    it("sets dimension on first insert", () => {
      index.upsert("doc1", [1, 0, 0]);
      assert.equal(index.dimension, 3);
    });

    it("returns false for empty id", () => {
      const result = index.upsert("", [1, 0, 0]);
      assert.equal(result, false);
    });

    it("returns false for null id", () => {
      const result = index.upsert(null, [1, 0, 0]);
      assert.equal(result, false);
    });

    it("returns false for null vector", () => {
      const result = index.upsert("doc1", null);
      assert.equal(result, false);
    });

    it("returns false for empty vector", () => {
      const result = index.upsert("doc1", []);
      assert.equal(result, false);
    });

    it("throws for dimension mismatch", () => {
      index.upsert("doc1", [1, 0, 0]);
      assert.throws(
        () => index.upsert("doc2", [1, 0]),
        /dimension mismatch/
      );
    });

    it("stores metadata", () => {
      index.upsert("doc1", [1, 0, 0], { title: "Test" });
      const results = index.search([1, 0, 0]);
      assert.equal(results[0].meta.title, "Test");
    });

    it("updates existing entry", () => {
      index.upsert("doc1", [1, 0, 0], { v: 1 });
      index.upsert("doc1", [0, 1, 0], { v: 2 });
      assert.equal(index.size, 1);
      const results = index.search([0, 1, 0]);
      assert.equal(results[0].meta.v, 2);
    });

    it("evicts oldest when over maxItems", () => {
      const smallIndex = new VectorIndex({ maxItems: 3 });
      smallIndex.upsert("a", [1, 0, 0]);
      smallIndex.upsert("b", [0, 1, 0]);
      smallIndex.upsert("c", [0, 0, 1]);
      smallIndex.upsert("d", [1, 1, 0]);
      assert.equal(smallIndex.size, 3);
      assert.equal(smallIndex.has("a"), false);
    });

    it("accepts Float32Array", () => {
      const vec = new Float32Array([1, 0, 0]);
      const result = index.upsert("doc1", vec);
      assert.ok(result);
    });

    it("accepts ArrayBuffer", () => {
      const vec = new Float32Array([1, 0, 0]).buffer;
      const result = index.upsert("doc1", vec);
      assert.ok(result);
    });

    it("handles vector with NaN (converted to 0)", () => {
      // NaN is converted to 0 by Number() in toFloat32Array
      const result = index.upsert("doc1", [1, NaN, 0]);
      // After conversion: [1, 0, 0] - valid vector
      assert.ok(result);
    });
  });

  describe("has", () => {
    it("returns true for existing id", () => {
      index.upsert("doc1", [1, 0, 0]);
      assert.ok(index.has("doc1"));
    });

    it("returns false for non-existing id", () => {
      assert.equal(index.has("missing"), false);
    });

    it("returns false for empty id", () => {
      assert.equal(index.has(""), false);
    });
  });

  describe("delete", () => {
    it("removes existing entry", () => {
      index.upsert("doc1", [1, 0, 0]);
      const result = index.delete("doc1");
      assert.ok(result);
      assert.equal(index.has("doc1"), false);
    });

    it("returns false for non-existing id", () => {
      const result = index.delete("missing");
      assert.equal(result, false);
    });

    it("returns false for empty id", () => {
      const result = index.delete("");
      assert.equal(result, false);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      index.upsert("doc1", [1, 0, 0]);
      index.upsert("doc2", [0, 1, 0]);
      index.clear();
      assert.equal(index.size, 0);
      assert.equal(index.dimension, null);
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
      assert.ok(results.length > 0);
      assert.equal(results[0].id, "doc1");
      assert.ok(results[0].score > 0.9);
    });

    it("respects topK", () => {
      const results = index.search([1, 0, 0], { topK: 2 });
      assert.ok(results.length <= 2);
    });

    it("uses default topK when 0 passed", () => {
      // toPositiveInt returns fallback (5) for 0
      const results = index.search([1, 0, 0], { topK: 0 });
      assert.ok(results.length > 0);
    });

    it("returns empty for empty index", () => {
      const emptyIndex = new VectorIndex();
      const results = emptyIndex.search([1, 0, 0]);
      assert.deepEqual(results, []);
    });

    it("returns empty for null query", () => {
      const results = index.search(null);
      assert.deepEqual(results, []);
    });

    it("returns empty for dimension mismatch", () => {
      const results = index.search([1, 0]);
      assert.deepEqual(results, []);
    });

    it("applies filter function", () => {
      const results = index.search([1, 0, 0], {
        filter: (meta) => meta.label === "y",
      });
      if (results.length > 0) {
        assert.equal(results[0].id, "doc2");
      }
    });

    it("applies minScore threshold", () => {
      const results = index.search([1, 0, 0], { minScore: 0.99 });
      // Only exact match should pass
      assert.ok(results.length <= 1);
    });

    it("returns results sorted by score", () => {
      const results = index.search([0.7, 0.7, 0], { topK: 3 });
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].score >= results[i].score);
      }
    });
  });

  describe("getPartitionStats", () => {
    it("returns partition statistics", () => {
      const stats = index.getPartitionStats();
      assert.equal(typeof stats.hot, "number");
      assert.equal(typeof stats.warm, "number");
      assert.equal(typeof stats.cold, "number");
      assert.equal(typeof stats.total, "number");
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
      assert.equal(stats.hot, 1);
      assert.equal(stats.warm, 1);
      assert.equal(stats.cold, 1);
    });

    it("classifies missing ts as cold", () => {
      index.upsert("doc", [1, 0, 0], {});
      const stats = index.getPartitionStats();
      assert.equal(stats.cold, 1);
    });
  });

  describe("partition filtering in search", () => {
    it("filters by single partition", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("cold1", [0, 1, 0], { ts: now - 48 * 60 * 60 * 1000 });

      const results = index.search([1, 0, 0], { partitions: "hot" });
      assert.equal(results.length, 1);
      assert.equal(results[0].id, "hot1");
    });

    it("filters by multiple partitions", () => {
      const now = Date.now();
      index.upsert("hot1", [1, 0, 0], { ts: now - 1000 });
      index.upsert("warm1", [0, 1, 0], { ts: now - 2 * 60 * 60 * 1000 });
      index.upsert("cold1", [0, 0, 1], { ts: now - 48 * 60 * 60 * 1000 });

      const results = index.search([1, 1, 1], { partitions: ["hot", "warm"] });
      assert.equal(results.length, 2);
    });
  });
});
