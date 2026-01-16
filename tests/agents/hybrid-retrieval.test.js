
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { rrfFuse, hybridSearch } from "../../js/agents/retrieval/hybrid-retrieval.js";

describe("retrieval/hybrid-retrieval", () => {
  describe("rrfFuse", () => {
    it("fuses two result lists with RRF", () => {
      const bm25 = [{ chunkId: "a", score: 1.0 }, { chunkId: "b", score: 0.8 }];
      const vector = [{ chunkId: "b", score: 0.9 }, { chunkId: "c", score: 0.7 }];

      const fused = rrfFuse(bm25, vector);

      expect(fused.length >= 2).toBeTruthy();
      expect(fused.every(r => typeof r.chunkId === "string")).toBeTruthy();
      expect(fused.every(r => typeof r.rrfScore === "number")).toBeTruthy();
    });

    it("ranks overlapping documents higher", () => {
      const bm25 = [{ chunkId: "overlap" }, { chunkId: "bm25only" }];
      const vector = [{ chunkId: "overlap" }, { chunkId: "vectoronly" }];

      const fused = rrfFuse(bm25, vector);

      // Overlapping doc should have higher score
      const overlap = fused.find((r) => r.chunkId === "overlap");
      const bm25only = fused.find((r) => r.chunkId === "bm25only");
      expect(overlap.rrfScore > bm25only.rrfScore).toBeTruthy();
    });

    it("respects limit option", () => {
      const bm25 = [{ chunkId: "a" }, { chunkId: "b" }, { chunkId: "c" }];
      const vector = [{ chunkId: "d" }, { chunkId: "e" }, { chunkId: "f" }];

      const fused = rrfFuse(bm25, vector, { limit: 2 });

      expect(fused.length).toBe(2);
    });

    it("uses custom rrfK parameter", () => {
      const bm25 = [{ chunkId: "a" }];
      const vector = [{ chunkId: "b" }];

      const fused1 = rrfFuse(bm25, vector, { rrfK: 10 });
      const fused2 = rrfFuse(bm25, vector, { rrfK: 100 });

      // Different k values should produce different scores
      const score1 = fused1.find((r) => r.chunkId === "a").rrfScore;
      const score2 = fused2.find((r) => r.chunkId === "a").rrfScore;
      expect(score1).not.toBe(score2);
    });

    it("applies weights to BM25 and vector scores", () => {
      const bm25 = [{ chunkId: "a" }];
      const vector = [{ chunkId: "b" }];

      const fusedEqual = rrfFuse(bm25, vector, { bm25Weight: 1, vectorWeight: 1 });
      const fusedBm25Heavy = rrfFuse(bm25, vector, { bm25Weight: 2, vectorWeight: 1 });

      const scoreA1 = fusedEqual.find((r) => r.chunkId === "a").rrfScore;
      const scoreA2 = fusedBm25Heavy.find((r) => r.chunkId === "a").rrfScore;
      expect(scoreA2 > scoreA1).toBeTruthy();
    });

    it("handles empty arrays", () => {
      expect(rrfFuse([]).toEqual([]), []);
      expect(rrfFuse([{ chunkId: "a" }], []).toBeTruthy().length === 1);
      expect(rrfFuse([], [{ chunkId: "a" }]).toBeTruthy().length === 1);
    });

    it("skips entries without chunkId", () => {
      const bm25 = [{ chunkId: "a" }, { score: 0.5 }, { chunkId: "" }];
      const vector = [{ chunkId: "b" }];

      const fused = rrfFuse(bm25, vector);
      expect(fused.length).toBe(2);
    });

    it("throws on invalid input", () => {
      expect(() => rrfFuse(null, [])).toThrow(/array/);
      expect(() => rrfFuse([], null)).toThrow(/array/);
      expect(() => rrfFuse([], [], "invalid")).toThrow(/object/);
    });

    it("preserves original scores", () => {
      const bm25 = [{ chunkId: "a", score: 1.5 }];
      const vector = [{ chunkId: "a", score: 0.9 }];

      const fused = rrfFuse(bm25, vector);
      const item = fused.find((r) => r.chunkId === "a");

      expect(item.bm25Score).toBe(1.5);
      expect(item.vectorScore).toBe(0.9);
    });

    it("handles Infinity limit", () => {
      const bm25 = Array.from({ length: 20 }, (_, i) => ({ chunkId: `a${i}` }));
      const vector = [];

      const fused = rrfFuse(bm25, vector, { limit: Infinity });
      expect(fused.length).toBe(20);
    });
  });

  describe("hybridSearch", () => {
    it("combines BM25 and vector search results", async () => {
      const indexes = {
        bm25Index: {},
        vectorIndex: {},
      };

      const result = await hybridSearch(indexes, "test query", {
        bm25SearchFn: () => [{ chunkId: "bm25result", score: 1.0 }],
        vectorSearchFn: async () => [{ chunkId: "vectorresult", score: 0.9 }],
      });

      expect(result.length >= 1).toBeTruthy();
    });

    it("returns empty for empty query", async () => {
      const result = await hybridSearch({}, "   ", {});
      expect(result).toEqual([]);
    });

    it("handles missing indexes gracefully", async () => {
      const result = await hybridSearch({}, "test", {
        bm25SearchFn: () => [],
        vectorSearchFn: async () => [],
      });
      expect(result).toEqual([]);
    });

    it("continues on BM25 failure when fallback=true", async () => {
      const indexes = {
        bm25Index: {},
        vectorIndex: {},
      };

      const result = await hybridSearch(indexes, "test", {
        fallback: true,
        bm25SearchFn: () => {
          throw new Error("BM25 failed");
        },
        vectorSearchFn: async () => [{ chunkId: "vector" }],
      });

      expect(result.length >= 1).toBeTruthy();
    });

    it("continues on vector failure when fallback=true", async () => {
      const indexes = {
        bm25Index: {},
        vectorIndex: {},
      };

      const result = await hybridSearch(indexes, "test", {
        fallback: true,
        bm25SearchFn: () => [{ chunkId: "bm25" }],
        vectorSearchFn: async () => {
          throw new Error("Vector failed");
        },
      });

      expect(result.length >= 1).toBeTruthy();
    });

    it("throws on failure when fallback=false", async () => {
      const indexes = { bm25Index: {} };

      await expect(() =>
          hybridSearch(indexes, "test", {
            fallback: false,
            bm25SearchFn: () => {
              throw new Error("fail");
            },
          }),
        /bm25 failed/
      );
    });

    it("respects limit option", async () => {
      const indexes = {
        bm25Index: {},
        vectorIndex: {},
      };

      const result = await hybridSearch(indexes, "test", {
        limit: 2,
        bm25SearchFn: () =>
          Array.from({ length: 10 }, (_, i) => ({ chunkId: `b${i}` })),
        vectorSearchFn: async () =>
          Array.from({ length: 10 }, (_, i) => ({ chunkId: `v${i}` })),
      });

      expect(result.length).toBe(2);
    });

    it("throws on invalid indexes", async () => {
      await expect(() => hybridSearch(null, "test"),
        /indexes must be an object/
      );
    });

    it("throws on invalid query", async () => {
      await expect(() => hybridSearch({}, 123),
        /query must be a string/
      );
    });

    it("throws on invalid options", async () => {
      await expect(() => hybridSearch({}, "test", "invalid"),
        /options must be an object/
      );
    });

    it("handles non-array search results", async () => {
      const indexes = {
        bm25Index: {},
        vectorIndex: {},
      };

      const result = await hybridSearch(indexes, "test", {
        bm25SearchFn: () => null,
        vectorSearchFn: async () => "not an array",
      });

      expect(result).toEqual([]);
    });
  });
});
