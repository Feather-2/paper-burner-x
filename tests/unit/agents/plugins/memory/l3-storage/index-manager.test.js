/**
 * @file tests/unit/agents/plugins/memory/l3-storage/index-manager.test.js
 * @description Unit tests for index-manager state helpers.
 * Covers serialization/restore and snapshot indexing edge cases to validate boundary handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/plugins/memory/l3-storage/constants.js", () => ({
  BYTES_PER_CHAR: 3,
  ENTRY_OVERHEAD_BYTES: 111,
}));

vi.mock("../../../../../../js/agents/plugins/memory/l3-storage/utils.js", () => ({
  toNonEmptyString: vi.fn(),
}));

import {
  createIndexState,
  serializeIndexState,
  restoreIndexState,
  addSnapshotToIndex,
  updateSnapshotAccess,
  removeSnapshotFromIndex,
  CURRENT_SCHEMA_VERSION,
  migrateIndex,
} from "../../../../../../js/agents/plugins/memory/l3-storage/index-manager.js";
import { toNonEmptyString } from "../../../../../../js/agents/plugins/memory/l3-storage/utils.js";

const defaultToNonEmptyString = (value) => {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
};

beforeEach(() => {
  toNonEmptyString.mockClear();
  toNonEmptyString.mockImplementation(defaultToNonEmptyString);
});

describe("createIndexState", () => {
  it("returns empty containers", () => {
    const state = createIndexState();

    expect(Array.isArray(state.timeline)).toBe(true);
    expect(state.timeline).toHaveLength(0);
    expect(state.keywords).toBeInstanceOf(Map);
    expect(state.keywords.size).toBe(0);
    expect(state.stages).toBeInstanceOf(Map);
    expect(state.stages.size).toBe(0);
    expect(state.hashIndex).toBeInstanceOf(Map);
    expect(state.hashIndex.size).toBe(0);
  });

  it("creates independent containers on rapid calls", () => {
    const states = Array.from({ length: 3 }, () => createIndexState());

    states[0].timeline.push({ id: "a" });
    states[0].keywords.set("k", new Set(["a"]));

    expect(states[1].timeline).toHaveLength(0);
    expect(states[1].keywords.size).toBe(0);
    expect(states[0].timeline).not.toBe(states[1].timeline);
    expect(states[0].keywords).not.toBe(states[1].keywords);
  });
});

describe("serializeIndexState", () => {
  it("serializes index with maps and checkpoints", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12345);
    const index = createIndexState();
    index.timeline = [{ id: "a", ts: 0, accessedAt: 0, summary: "sum" }];
    index.keywords.set("alpha", new Set(["a", "b"]));
    index.keywords.set("empty", null);
    index.stages.set("stage1", "a");
    index.hashIndex.set("hash1", "a");

    const result = serializeIndexState(index, ["c1", "c2"], "run-1");

    expect(result.schemaVersion).toBe("0.2");
    expect(result.runId).toBe("run-1");
    expect(result.updatedAt).toBe(12345);
    expect(result.timeline).toEqual([{ id: "a", ts: 0, accessedAt: 0, summary: "sum" }]);
    expect(result.keywords).toEqual([
      ["alpha", ["a", "b"]],
      ["empty", []],
    ]);
    expect(result.stages).toEqual([["stage1", "a"]]);
    expect(result.hashIndex).toEqual([["hash1", "a"]]);
    expect(result.checkpointIndex).toEqual(["c1", "c2"]);
    nowSpy.mockRestore();
  });

  it("uses safe defaults for non-array inputs", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1);
    const index = createIndexState();
    index.timeline = { not: "array" };
    index.keywords.set("alpha", new Set(["a"]));

    const result = serializeIndexState(index, { not: "array" }, "");

    expect(result.timeline).toEqual([]);
    expect(result.checkpointIndex).toEqual([]);
    expect(result.keywords).toEqual([["alpha", ["a"]]]);
    expect(result.runId).toBe("");
    nowSpy.mockRestore();
  });
});

describe("restoreIndexState", () => {
  it("returns null for non-object inputs", () => {
    const invalidInputs = [null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER, "text"];

    for (const value of invalidInputs) {
      expect(restoreIndexState(value)).toBeNull();
    }
  });

  it("restores index with filtering and checkpoint fallback", () => {
    const deep = { level1: { level2: { level3: { value: "x" } } } };
    const raw = {
      timeline: [
        { id: "a", ts: 0, accessedAt: 0, meta: deep },
        { id: "b", ts: -1, accessedAt: 1 },
        { id: "c", ts: Number.MAX_SAFE_INTEGER, accessedAt: 2 },
      ],
      keywords: [
        ["alpha", ["a", "b", 123, null]],
        ["beta", "not-array"],
        [99, ["c"]],
      ],
      stages: [
        ["stage1", "a"],
        ["stage2", 2],
        [null, "b"],
      ],
      hashIndex: [
        ["hash1", "a"],
        ["hash2", 2],
      ],
      checkpoints: ["cp1", "cp2"],
    };

    const result = restoreIndexState(raw);

    expect(result).not.toBeNull();
    const { index, checkpointIndex } = result;
    expect(checkpointIndex).toEqual(["cp1", "cp2"]);
    expect(index.timeline).toBe(raw.timeline);
    expect(index.timeline.map((entry) => entry.ts)).toEqual([0, -1, Number.MAX_SAFE_INTEGER]);
    expect(index.timeline[0].meta).toBe(deep);
    expect(Array.from(index.keywords.keys())).toEqual(["alpha", "beta"]);
    expect([...index.keywords.get("alpha")]).toEqual(["a", "b"]);
    expect(index.keywords.get("beta").size).toBe(0);
    expect(Array.from(index.stages.entries())).toEqual([["stage1", "a"]]);
    expect(Array.from(index.hashIndex.entries())).toEqual([["hash1", "a"]]);
  });

  it("handles empty object and non-array fields", () => {
    const raw = {
      timeline: {},
      keywords: {},
      stages: "bad",
      hashIndex: null,
      checkpointIndex: "bad",
    };

    const result = restoreIndexState(raw);

    expect(result).not.toBeNull();
    const { index, checkpointIndex } = result;
    expect(index.timeline).toEqual([]);
    expect(index.keywords).toBeInstanceOf(Map);
    expect(index.keywords.size).toBe(0);
    expect(index.stages).toBeInstanceOf(Map);
    expect(index.stages.size).toBe(0);
    expect(index.hashIndex).toBeInstanceOf(Map);
    expect(index.hashIndex.size).toBe(0);
    expect(checkpointIndex).toEqual([]);
  });

  it("returns independent maps on repeated restores", () => {
    const raw = {
      timeline: [],
      keywords: [["k", ["id"]]],
      stages: [],
      hashIndex: [],
      checkpointIndex: [],
    };

    const first = restoreIndexState(raw);
    const second = restoreIndexState(raw);

    first.index.keywords.get("k").add("extra");
    expect(second.index.keywords.get("k").has("extra")).toBe(false);
  });
});

describe("addSnapshotToIndex", () => {
  it("adds snapshot metadata", () => {
    const index = createIndexState();
    const entry = {
      id: "snap1",
      keywords: ["alpha", "beta"],
      stageKey: "stage1",
      ts: 42,
      summary: "hello",
      contentHash: "hash1",
    };

    addSnapshotToIndex(index, entry);

    expect([...index.keywords.get("alpha")]).toEqual(["snap1"]);
    expect([...index.keywords.get("beta")]).toEqual(["snap1"]);
    expect(index.stages.get("stage1")).toBe("snap1");
    expect(index.hashIndex.get("hash1")).toBe("snap1");
    expect(index.timeline).toHaveLength(1);
    expect(index.timeline[0]).toEqual({
      id: "snap1",
      ts: 42,
      accessedAt: 42,
      summary: "hello",
      stageKey: "stage1",
    });
  });

  it("uses defaults for invalid fields and empty keywords", () => {
    const index = createIndexState();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(999);
    const entry = {
      id: "snap2",
      keywords: [],
      stageKey: "   ",
      ts: "123",
      summary: 123,
      contentHash: undefined,
    };

    addSnapshotToIndex(index, entry);

    expect(index.keywords.size).toBe(0);
    expect(index.stages.size).toBe(0);
    expect(index.hashIndex.size).toBe(0);
    expect(index.timeline).toHaveLength(1);
    expect(index.timeline[0]).toEqual({
      id: "snap2",
      ts: 999,
      accessedAt: 999,
      summary: undefined,
      stageKey: undefined,
    });
    nowSpy.mockRestore();
  });

  it("ignores empty ids and empty objects", () => {
    const index = createIndexState();

    addSnapshotToIndex(index, null);
    addSnapshotToIndex(index, {});
    addSnapshotToIndex(index, { id: "" });
    addSnapshotToIndex(index, { id: "   " });

    expect(index.timeline).toHaveLength(0);
    expect(index.keywords.size).toBe(0);
    expect(index.stages.size).toBe(0);
    expect(index.hashIndex.size).toBe(0);
  });

  it("handles concurrent additions with large summary", async () => {
    const index = createIndexState();
    const longSummary = "a".repeat(100000);
    const entries = [
      { id: "bulk-0", keywords: ["bulk"], ts: 1, summary: longSummary },
      { id: "bulk-1", keywords: ["bulk"], ts: 2, summary: "b" },
      { id: "bulk-2", keywords: ["bulk"], ts: 3, summary: "c" },
      { id: "bulk-3", keywords: ["bulk"], ts: 4, summary: "d" },
    ];

    await Promise.all(
      entries.map((entry) => Promise.resolve().then(() => addSnapshotToIndex(index, entry)))
    );

    expect(index.timeline).toHaveLength(entries.length);
    expect(index.keywords.get("bulk").size).toBe(entries.length);
    const stored = index.timeline.find((item) => item.id === "bulk-0");
    expect(stored.summary.length).toBe(longSummary.length);
  });
});

describe("updateSnapshotAccess", () => {
  it("updates access time for existing entry", () => {
    const index = createIndexState();
    index.timeline.push({ id: "snap1", accessedAt: 1 });

    const entry = updateSnapshotAccess(index, "snap1", 42);

    expect(entry).toBe(index.timeline[0]);
    expect(entry.accessedAt).toBe(42);
  });

  it("returns null for invalid ids or missing entry and handles non-array timeline", () => {
    const index = createIndexState();
    index.timeline.push({ id: "snap1", accessedAt: 1 });

    const invalidIds = [null, undefined, "", "   ", {}, []];
    for (const value of invalidIds) {
      expect(updateSnapshotAccess(index, value, 5)).toBeNull();
    }
    expect(updateSnapshotAccess(index, "missing", 5)).toBeNull();
    expect(index.timeline[0].accessedAt).toBe(1);

    const badIndex = { timeline: { id: "snap1" } };
    expect(updateSnapshotAccess(badIndex, "snap1", 5)).toBeNull();
    expect(badIndex.timeline).toEqual({ id: "snap1" });
  });

  it("uses Date.now when accessedAt omitted and supports rapid updates", () => {
    const index = createIndexState();
    index.timeline.push({ id: "snap2", accessedAt: 0 });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(500);
    updateSnapshotAccess(index, "snap2");
    expect(index.timeline[0].accessedAt).toBe(500);
    nowSpy.mockRestore();

    updateSnapshotAccess(index, "snap2", "123");
    expect(index.timeline[0].accessedAt).toBe("123");

    updateSnapshotAccess(index, "snap2", 0);
    updateSnapshotAccess(index, "snap2", -1);
    updateSnapshotAccess(index, "snap2", Number.MAX_SAFE_INTEGER);
    expect(index.timeline[0].accessedAt).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("removeSnapshotFromIndex", () => {
  it("removes snapshot from all indexes", () => {
    const index = createIndexState();
    index.timeline = [
      { id: "a", accessedAt: 1 },
      { id: "b", accessedAt: 2 },
    ];
    index.keywords.set("alpha", new Set(["a", "b"]));
    index.keywords.set("beta", new Set(["a"]));
    index.stages.set("stage1", "a");
    index.stages.set("stage2", "b");
    index.hashIndex.set("hash1", "a");
    index.hashIndex.set("hash2", "b");

    removeSnapshotFromIndex(index, "a");

    expect(index.timeline.map((entry) => entry.id)).toEqual(["b"]);
    expect(index.keywords.get("alpha").has("a")).toBe(false);
    expect(index.keywords.get("alpha").has("b")).toBe(true);
    expect(index.keywords.get("beta").size).toBe(0);
    expect(index.stages.has("stage1")).toBe(false);
    expect(index.stages.get("stage2")).toBe("b");
    expect(index.hashIndex.has("hash1")).toBe(false);
    expect(index.hashIndex.get("hash2")).toBe("b");
  });

  it("no-ops for invalid ids and handles non-array timeline", () => {
    const index = createIndexState();
    index.timeline = [{ id: "a" }];
    index.keywords.set("alpha", new Set(["a"]));
    index.stages.set("stage1", "a");
    index.hashIndex.set("hash1", "a");
    const originalTimeline = index.timeline;

    const invalidIds = [null, undefined, "", "   ", {}, []];
    for (const value of invalidIds) {
      removeSnapshotFromIndex(index, value);
    }

    expect(index.timeline).toBe(originalTimeline);
    expect(index.timeline).toHaveLength(1);
    expect(index.keywords.get("alpha").has("a")).toBe(true);

    const badIndex = createIndexState();
    badIndex.timeline = { id: "a" };
    removeSnapshotFromIndex(badIndex, "a");
    expect(badIndex.timeline).toEqual([]);
  });

  it("idempotent removal and large keyword sets", () => {
    const index = createIndexState();
    const ids = Array.from({ length: 1000 }, (_, i) => `id${i}`);
    index.keywords.set("bulk", new Set(ids));
    index.timeline = ids.map((id) => ({ id }));

    removeSnapshotFromIndex(index, "id500");
    expect(index.keywords.get("bulk").has("id500")).toBe(false);
    expect(index.timeline.some((entry) => entry.id === "id500")).toBe(false);

    const sizeAfter = index.keywords.get("bulk").size;
    removeSnapshotFromIndex(index, "id500");
    expect(index.keywords.get("bulk").size).toBe(sizeAfter);
  });
});

describe("L3 Schema migration", () => {
  it("CURRENT_SCHEMA_VERSION is 0.2", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe("0.2");
  });

  it("migrateIndex from 0.1 adds accessCount: 0 to timeline entries", () => {
    const raw = {
      schemaVersion: "0.1",
      timeline: [
        { id: "a", ts: 100, accessedAt: 100 },
        { id: "b", ts: 200, accessedAt: 200 },
      ],
      keywords: [],
      stages: [],
      hashIndex: [],
    };

    const migrated = migrateIndex(raw);

    expect(migrated.schemaVersion).toBe("0.2");
    expect(migrated.timeline[0].accessCount).toBe(0);
    expect(migrated.timeline[1].accessCount).toBe(0);
  });

  it("migrateIndex on current version data is a no-op", () => {
    const raw = {
      schemaVersion: "0.2",
      timeline: [{ id: "a", ts: 100, accessedAt: 100, accessCount: 5 }],
      keywords: [],
      stages: [],
      hashIndex: [],
    };

    const migrated = migrateIndex(raw);

    expect(migrated.schemaVersion).toBe("0.2");
    expect(migrated.timeline[0].accessCount).toBe(5);
  });

  it("restoreIndexState auto-migrates 0.1 data", () => {
    const raw = {
      schemaVersion: "0.1",
      timeline: [
        { id: "snap1", ts: 100, accessedAt: 100 },
        { id: "snap2", ts: 200, accessedAt: 200 },
      ],
      keywords: [["alpha", ["snap1"]]],
      stages: [["stage1", "snap1"]],
      hashIndex: [["hash1", "snap1"]],
      checkpointIndex: ["cp1"],
    };

    const result = restoreIndexState(raw);

    expect(result).not.toBeNull();
    expect(result.index.timeline[0].accessCount).toBe(0);
    expect(result.index.timeline[1].accessCount).toBe(0);
  });

  it("updateSnapshotAccess increments accessCount", () => {
    const index = createIndexState();
    index.timeline.push({ id: "snap1", ts: 100, accessedAt: 100, accessCount: 0 });

    updateSnapshotAccess(index, "snap1", 150);
    expect(index.timeline[0].accessCount).toBe(1);
    expect(index.timeline[0].accessedAt).toBe(150);

    updateSnapshotAccess(index, "snap1", 200);
    expect(index.timeline[0].accessCount).toBe(2);
    expect(index.timeline[0].accessedAt).toBe(200);
  });
});
