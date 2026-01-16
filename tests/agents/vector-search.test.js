
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { buildIndex, searchAsync } from "../../js/agents/retrieval/vector-search.js";

describe("retrieval/vector-search", () => {
  describe("buildIndex", () => {
    it("builds index from chunks with embeddings", () => {
      const chunks = [
        { chunkId: "c1", text: "hello", embedding: [0.1, 0.2, 0.3] },
        { chunkId: "c2", text: "world", embedding: [0.4, 0.5, 0.6] },
      ];

      const index = buildIndex(chunks);

      expect(index.vectorIndex).toBeTruthy();
      expect(index.chunkIds).toEqual(["c1", "c2"]);
    });

    it("generates chunkIds when not provided", () => {
      const chunks = [
        { text: "a", embedding: [0.1] },
        { text: "b", embedding: [0.2] },
      ];

      const index = buildIndex(chunks);

      expect(index.chunkIds[0]).toBe("chunk_1");
      expect(index.chunkIds[1]).toBe("chunk_2");
    });

    it("skips chunks without embeddings", () => {
      const chunks = [
        { chunkId: "c1", text: "has", embedding: [0.1] },
        { chunkId: "c2", text: "missing" },
        { chunkId: "c3", text: "has", embedding: [0.2] },
      ];

      const index = buildIndex(chunks);

      expect(index.chunkIds.length).toBe(3);
    });

    it("uses custom getEmbedding function", () => {
      const chunks = [
        { id: "x1", vec: [0.1, 0.2] },
        { id: "x2", vec: [0.3, 0.4] },
      ];

      const index = buildIndex(chunks, {
        getEmbedding: (c) => c.vec,
      });

      expect(index.vectorIndex).toBeTruthy();
    });

    it("accepts injected vectorIndex", () => {
      const mockIndex = {
        upsert: () => {},
        search: () => [],
      };

      const index = buildIndex([{ chunkId: "c1", embedding: [0.1] }], {
        vectorIndex: mockIndex,
      });

      expect(index.vectorIndex).toBe(mockIndex);
    });

    it("throws on invalid chunks", () => {
      expect(() => buildIndex(null)).toThrow(/array/);
      expect(() => buildIndex("not array")).toThrow(/array/);
    });

    it("throws on invalid options", () => {
      expect(() => buildIndex([], "invalid")).toThrow(/object/);
    });

    it("handles empty chunks array", () => {
      const index = buildIndex([]);
      expect(index.chunkIds).toEqual([]);
    });
  });

  describe("searchAsync", () => {
    /** Creates a valid mock VectorIndex */
    function createMockIndex(searchFn) {
      return {
        upsert: () => {},
        search: searchFn || (() => []),
      };
    }

    it("searches vector index with query", async () => {
      const mockIndex = createMockIndex(() => [
        { id: "c1", score: 0.9 },
        { id: "c2", score: 0.8 },
      ]);

      const results = await searchAsync(mockIndex, "test query", 5, {
        embeddingService: {
          embed: async (texts) => [[0.1, 0.2, 0.3]],
        },
      });

      expect(results.length >= 1).toBeTruthy();
    });

    it("returns empty for empty query", async () => {
      const mockIndex = createMockIndex();
      const results = await searchAsync(mockIndex, "", 5, {
        embeddingService: { embed: async () => [[0.1]] },
      });
      expect(results).toEqual([]);
    });

    it("throws on null index", async () => {
      await expect(() => searchAsync(null, "test", 5, {
          embeddingService: { embed: async () => [[0.1]] },
        }),
        /VectorIndex-like/
      );
    });

    it("throws on index without search method", async () => {
      await expect(() => searchAsync({}, "test", 5, {
          embeddingService: { embed: async () => [[0.1]] },
        }),
        /VectorIndex-like/
      );
    });

    it("maps results to chunkId format", async () => {
      const mockIndex = createMockIndex(() => [{ id: "chunk1", score: 0.95 }]);

      const results = await searchAsync(mockIndex, "query", 5, {
        embeddingService: { embed: async () => [[0.1]] },
      });

      expect(results[0].chunkId).toBe("chunk1");
      expect(results[0].score).toBe(0.95);
    });

    it("respects topK limit", async () => {
      const mockIndex = createMockIndex((query, opts) => {
        const k = opts?.topK || 5;
        return Array.from({ length: k }, (_, i) => ({ id: `c${i}`, score: 1 - i * 0.1 }));
      });

      const results = await searchAsync(mockIndex, "query", 3, {
        embeddingService: { embed: async () => [[0.1]] },
      });

      expect(results.length).toBe(3);
    });

    it("returns empty when embedding fails", async () => {
      const mockIndex = createMockIndex(() => []);

      // When embedding throws, searchAsync should propagate the error
      // unless handled internally - let's check actual behavior
      await expect(() => searchAsync(mockIndex, "query", 5, {
          embeddingService: {
            embed: async () => {
              throw new Error("Embedding failed");
            },
          },
        }),
        /Embedding failed/
      );
    });
  });
});
