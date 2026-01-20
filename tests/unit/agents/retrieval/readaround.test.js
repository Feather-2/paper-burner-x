import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock(
  "virtual:readaround-fixtures",
  () => {
    const makeChunks = (count, options = {}) => {
      const { prefix = "c", textSeed = null } = options;
      return Array.from({ length: count }, (_, i) => {
        const chunk = { chunkId: `${prefix}${i}` };
        if (textSeed !== null && textSeed !== undefined) {
          chunk.text = `${textSeed}${i}`;
        }
        return chunk;
      });
    };

    const makeHitIds = (ids) => ids.slice();

    return { makeChunks, makeHitIds };
  },
  { virtual: true }
);

const loadModule = async () => import("../../../../js/agents/retrieval/readaround.js");
const loadFixtures = async () => import("virtual:readaround-fixtures");

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("readAround", () => {
  it("expands around hit chunks and preserves order", async () => {
    const { readAround } = await loadModule();
    const { makeChunks } = await loadFixtures();

    const allChunks = makeChunks(5);
    const out = readAround(allChunks, ["c2"], 1);

    expect(out.map((c) => c.chunkId)).toEqual(["c1", "c2", "c3"]);
  });

  it("merges overlapping windows and skips missing hit ids", async () => {
    const { readAround } = await loadModule();
    const { makeChunks } = await loadFixtures();

    const allChunks = makeChunks(5);
    const out = readAround(allChunks, ["missing", "c1", "c3"], 1);

    expect(out.map((c) => c.chunkId)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it.each([0, -1])("treats windowSize %s as zero-width", async (windowSize) => {
    const { readAround } = await loadModule();
    const { makeChunks } = await loadFixtures();

    const allChunks = makeChunks(4);
    const out = readAround(allChunks, ["c2"], windowSize);

    expect(out.map((c) => c.chunkId)).toEqual(["c2"]);
  });

  it.each(["2", Number.NaN, Infinity])("defaults windowSize %s to 1", async (windowSize) => {
    const { readAround } = await loadModule();
    const { makeChunks } = await loadFixtures();

    const allChunks = makeChunks(5);
    const out = readAround(allChunks, ["c2"], windowSize);

    expect(out.map((c) => c.chunkId)).toEqual(["c1", "c2", "c3"]);
  });

  it("treats MAX_SAFE_INTEGER windowSize as full range", async () => {
    const { readAround } = await loadModule();
    const { makeChunks } = await loadFixtures();

    const allChunks = makeChunks(3);
    const out = readAround(allChunks, ["c1"], Number.MAX_SAFE_INTEGER);

    expect(out.map((c) => c.chunkId)).toEqual(["c0", "c1", "c2"]);
  });

  it("returns empty array when inputs are empty arrays", async () => {
    const { readAround } = await loadModule();

    expect(readAround([], ["c1"], 1)).toEqual([]);
    expect(readAround([{ chunkId: "c1" }], [], 1)).toEqual([]);
  });

  it("throws TypeError for invalid allChunks values", async () => {
    const { readAround } = await loadModule();

    const badValues = [null, undefined, "", {}];
    for (const value of badValues) {
      expect(() => readAround(value, [])).toThrow(TypeError);
    }
  });

  it("throws TypeError for invalid hitChunkIds values", async () => {
    const { readAround } = await loadModule();

    const allChunks = [{ chunkId: "a" }];
    const badValues = [null, undefined, "", {}];
    for (const value of badValues) {
      expect(() => readAround(allChunks, value)).toThrow(TypeError);
    }
  });

  it("supports empty and whitespace chunkIds", async () => {
    const { readAround } = await loadModule();

    const allChunks = [{ chunkId: "" }, { chunkId: "   " }, { chunkId: "c2" }];
    const out = readAround(allChunks, ["", "   "], 0);

    expect(out.map((c) => c.chunkId)).toEqual(["", "   "]);
  });

  it("handles concurrent calls without shared state", async () => {
    const { readAround } = await loadModule();
    const { makeChunks } = await loadFixtures();

    const allChunks = makeChunks(5);
    const [left, right] = await Promise.all([
      Promise.resolve().then(() => readAround(allChunks, ["c1"], 1)),
      Promise.resolve().then(() => readAround(allChunks, ["c3"], 1)),
    ]);

    expect(left.map((c) => c.chunkId)).toEqual(["c0", "c1", "c2"]);
    expect(right.map((c) => c.chunkId)).toEqual(["c2", "c3", "c4"]);
  });

  it("handles rapid consecutive calls consistently", async () => {
    const { readAround } = await loadModule();
    const { makeChunks } = await loadFixtures();

    const allChunks = makeChunks(5);
    const expected = ["c1", "c2", "c3"];

    for (let i = 0; i < 25; i += 1) {
      const out = readAround(allChunks, ["c2"], 1);
      expect(out.map((c) => c.chunkId)).toEqual(expected);
    }
  });

  it("handles large inputs with long chunk ids", async () => {
    const { readAround } = await loadModule();

    const size = 10000;
    const mid = 5000;
    const longId = "x".repeat(10000);
    const allChunks = Array.from({ length: size }, (_, i) => ({
      chunkId: i === mid ? longId : `c${i}`,
      text: i === mid ? "t".repeat(2000) : `t${i}`,
    }));

    const out = readAround(allChunks, [longId], 2);

    expect(out.map((c) => c.chunkId)).toEqual([
      `c${mid - 2}`,
      `c${mid - 1}`,
      longId,
      `c${mid + 1}`,
      `c${mid + 2}`,
    ]);
  });

  it("returns deep nested chunks intact", async () => {
    const { readAround } = await loadModule();

    const deepChunk = {
      chunkId: "deep",
      data: {
        level1: {
          level2: {
            items: [1, { foo: "bar" }],
          },
        },
      },
    };
    const allChunks = [deepChunk, { chunkId: "next" }];
    const out = readAround(allChunks, ["deep"], 0);

    expect(out[0]).toBe(deepChunk);
    expect(out[0].data.level1.level2.items[1].foo).toBe("bar");
  });
});
