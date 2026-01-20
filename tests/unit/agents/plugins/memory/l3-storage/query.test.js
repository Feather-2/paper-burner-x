import { beforeEach, describe, expect, it, vi } from "vitest";

const computeContentHashMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../js/agents/plugins/memory/l3-storage/hash.js", () => ({
  computeContentHash: computeContentHashMock,
}));

import {
  getTimeline,
  getSupersededTimeline,
  searchByKeyword,
  isDuplicate,
} from "../../../../../../js/agents/plugins/memory/l3-storage/query.js";

const makeIndex = (overrides = {}) => ({
  timeline: [],
  keywords: new Map(),
  hashIndex: new Map(),
  ...overrides,
});

beforeEach(() => {
  computeContentHashMock.mockReset();
});

describe("getTimeline", () => {
  it("filters superseded entries and clones objects by default", () => {
    const timeline = [
      { id: "a", superseded: false, value: 1 },
      { id: "b", superseded: true, value: 2 },
      "raw",
      null,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      { id: "c", value: 3 },
    ];
    const index = makeIndex({ timeline });

    const result = getTimeline(index);

    expect(result).toEqual([
      { id: "a", superseded: false, value: 1 },
      "raw",
      null,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      { id: "c", value: 3 },
    ]);
    expect(result[0]).not.toBe(timeline[0]);
    expect(result[result.length - 1]).not.toBe(timeline[timeline.length - 1]);

    result[0].value = 99;
    expect(timeline[0].value).toBe(1);
  });

  it("includes superseded entries when includeSuperseded is true", () => {
    const timeline = [
      { id: "a", superseded: false },
      { id: "b", superseded: true, value: "x" },
    ];
    const index = makeIndex({ timeline });

    const result = getTimeline(index, { includeSuperseded: true });

    expect(result).toEqual([
      { id: "a", superseded: false },
      { id: "b", superseded: true, value: "x" },
    ]);
    expect(result[1]).not.toBe(timeline[1]);
  });

  it("handles missing or non-array timelines", () => {
    expect(getTimeline({})).toEqual([]);
    expect(getTimeline(makeIndex({ timeline: null }))).toEqual([]);
    expect(getTimeline(makeIndex({ timeline: undefined }))).toEqual([]);
    expect(getTimeline(makeIndex({ timeline: {} }))).toEqual([]);
    expect(getTimeline(makeIndex({ timeline: [] }))).toEqual([]);
  });

  it("supports concurrent and rapid calls without sharing references", async () => {
    const timeline = [
      { id: "a", superseded: false },
      { id: "b", superseded: true },
    ];
    const index = makeIndex({ timeline });

    const [first, second] = await Promise.all([
      Promise.resolve(getTimeline(index)),
      Promise.resolve(getTimeline(index)),
    ]);

    expect(first).toEqual([{ id: "a", superseded: false }]);
    expect(second).toEqual([{ id: "a", superseded: false }]);
    expect(first[0]).not.toBe(second[0]);

    const rapidResults = [];
    for (let i = 0; i < 3; i += 1) {
      rapidResults.push(getTimeline(index));
    }
    expect(rapidResults[0][0]).not.toBe(rapidResults[1][0]);
  });

  it("throws when index is null or undefined", () => {
    expect(() => getTimeline()).toThrow(TypeError);
    expect(() => getTimeline(null)).toThrow(TypeError);
  });
});

describe("getSupersededTimeline", () => {
  it("returns only superseded entries and clones objects", () => {
    const deep = { level1: { level2: { value: "deep" } } };
    const timeline = [
      { id: "a", superseded: true, value: 1, deep },
      { id: "b", superseded: false, value: 2 },
      { id: "c", superseded: true, value: 3 },
      "raw",
      0,
      null,
    ];

    const result = getSupersededTimeline({ timeline });

    expect(result).toEqual([
      { id: "a", superseded: true, value: 1, deep },
      { id: "c", superseded: true, value: 3 },
    ]);
    expect(result[0]).not.toBe(timeline[0]);
    expect(result[1]).not.toBe(timeline[2]);

    result[0].value = 99;
    expect(timeline[0].value).toBe(1);
  });

  it("handles missing or non-array timelines", () => {
    expect(getSupersededTimeline({})).toEqual([]);
    expect(getSupersededTimeline(makeIndex({ timeline: null }))).toEqual([]);
    expect(getSupersededTimeline(makeIndex({ timeline: undefined }))).toEqual([]);
    expect(getSupersededTimeline(makeIndex({ timeline: {} }))).toEqual([]);
    expect(getSupersededTimeline(makeIndex({ timeline: [] }))).toEqual([]);
  });

  it("throws when index is null or undefined", () => {
    expect(() => getSupersededTimeline()).toThrow(TypeError);
    expect(() => getSupersededTimeline(null)).toThrow(TypeError);
  });
});

describe("searchByKeyword", () => {
  it("returns [] for blank or non-string keywords", () => {
    const index = makeIndex({
      keywords: new Map([["alpha", new Set(["id-1"])]]),
    });
    const values = ["", "   ", null, undefined, 0, -1, {}, []];

    for (const value of values) {
      expect(searchByKeyword(index, value)).toEqual([]);
    }
  });

  it("normalizes case and trims whitespace", () => {
    const index = makeIndex({
      keywords: new Map([["alpha", new Set(["snap-1"])]]),
    });

    expect(searchByKeyword(index, "  ALpHa ")).toEqual(["snap-1"]);
  });

  it("returns [] when keyword not found", () => {
    const index = makeIndex({
      keywords: new Map([["alpha", new Set(["snap-1"])]]),
    });

    expect(searchByKeyword(index, "missing")).toEqual([]);
  });

  it("filters superseded ids by timeline when includeSuperseded is false", () => {
    const index = makeIndex({
      keywords: new Map([["alpha", new Set(["snap-1", "snap-2", "snap-3"])]]),
      timeline: [
        { id: "snap-1", superseded: true },
        { id: "snap-2", superseded: false },
        { id: 123, superseded: true },
      ],
    });

    expect(searchByKeyword(index, "alpha")).toEqual(["snap-2", "snap-3"]);
  });

  it("returns all ids when includeSuperseded is true", () => {
    const index = makeIndex({
      keywords: new Map([["alpha", new Set(["snap-1", "snap-2"])]]),
      timeline: [{ id: "snap-1", superseded: true }],
    });

    expect(searchByKeyword(index, "alpha", { includeSuperseded: true })).toEqual([
      "snap-1",
      "snap-2",
    ]);
  });

  it("treats non-array timelines as empty", () => {
    const index = makeIndex({
      keywords: new Map([["alpha", new Set(["snap-1"])]]),
      timeline: { id: "snap-1", superseded: true },
    });

    expect(searchByKeyword(index, "alpha")).toEqual(["snap-1"]);
  });

  it("supports concurrent calls with consistent results", async () => {
    const index = makeIndex({
      keywords: new Map([["alpha", new Set(["snap-1"])]]),
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve(searchByKeyword(index, "alpha")))
    );

    for (const result of results) {
      expect(result).toEqual(["snap-1"]);
    }
  });

  it("handles long keyword strings", () => {
    const longKeyword = "a".repeat(10000);
    const index = makeIndex({
      keywords: new Map([[longKeyword, new Set(["long-id"])]]),
    });

    expect(searchByKeyword(index, longKeyword)).toEqual(["long-id"]);
  });

  it("throws when keywords map is missing", () => {
    expect(() => searchByKeyword({ timeline: [] }, "alpha")).toThrow(TypeError);
  });
});

describe("isDuplicate", () => {
  it("returns duplicate true when hash exists", () => {
    computeContentHashMock.mockReturnValue("hash-1");
    const index = makeIndex({
      hashIndex: new Map([["hash-1", "id-1"]]),
    });

    expect(isDuplicate(index, { payload: "data" })).toEqual({
      duplicate: true,
      existingId: "id-1",
    });
    expect(computeContentHashMock).toHaveBeenCalledWith({ payload: "data" });
  });

  it("returns duplicate false when hash not found", () => {
    computeContentHashMock.mockReturnValue("hash-2");
    const index = makeIndex({
      hashIndex: new Map([["hash-1", "id-1"]]),
    });

    expect(isDuplicate(index, "data")).toEqual({ duplicate: false });
  });

  it("handles null, undefined, and numeric boundary values", () => {
    computeContentHashMock.mockImplementation(
      (value) => `hash-${typeof value}-${String(value)}`
    );
    const index = makeIndex({
      hashIndex: new Map([
        ["hash-object-null", "id-null"],
        ["hash-number-0", "id-0"],
      ]),
    });

    expect(isDuplicate(index, null)).toEqual({ duplicate: true, existingId: "id-null" });
    expect(isDuplicate(index, undefined)).toEqual({ duplicate: false });
    expect(isDuplicate(index, 0)).toEqual({ duplicate: true, existingId: "id-0" });
    expect(isDuplicate(index, "0")).toEqual({ duplicate: false });
    expect(isDuplicate(index, -1)).toEqual({ duplicate: false });
    expect(isDuplicate(index, Number.MAX_SAFE_INTEGER)).toEqual({ duplicate: false });
  });

  it("handles large payloads and deep nested objects", () => {
    const largeText = "x".repeat(500000);
    const deepData = { level1: { level2: { level3: { level4: "deep" } } } };

    computeContentHashMock.mockImplementation((value) => {
      if (value === largeText) return "hash-large";
      if (value === deepData) return "hash-deep";
      return "hash-other";
    });
    const index = makeIndex({
      hashIndex: new Map([["hash-large", "id-large"]]),
    });

    expect(isDuplicate(index, largeText)).toEqual({
      duplicate: true,
      existingId: "id-large",
    });
    expect(isDuplicate(index, deepData)).toEqual({ duplicate: false });
    expect(computeContentHashMock).toHaveBeenCalledWith(largeText);
    expect(computeContentHashMock).toHaveBeenCalledWith(deepData);
  });

  it("supports concurrent calls with consistent results", async () => {
    computeContentHashMock.mockImplementation((value) => `hash-${value}`);
    const index = makeIndex({
      hashIndex: new Map([
        ["hash-a", "id-a"],
        ["hash-b", "id-b"],
      ]),
    });

    const results = await Promise.all([
      Promise.resolve(isDuplicate(index, "a")),
      Promise.resolve(isDuplicate(index, "b")),
      Promise.resolve(isDuplicate(index, "c")),
    ]);

    expect(results).toEqual([
      { duplicate: true, existingId: "id-a" },
      { duplicate: true, existingId: "id-b" },
      { duplicate: false },
    ]);
  });

  it("throws when hashIndex is missing", () => {
    computeContentHashMock.mockReturnValue("hash-1");
    expect(() => isDuplicate({ timeline: [] }, "data")).toThrow(TypeError);
  });
});
