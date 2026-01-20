import { describe, it, expect, vi, beforeEach } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

const mockedLogger = vi.hoisted(() => {
  const loggerInstance = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    createLogger: vi.fn(() => loggerInstance),
    loggerInstance,
  };
});

vi.mock("../../../../../js/agents/shared/utils/logger.js", () => ({
  createLogger: mockedLogger.createLogger,
}));

import { Archive, IndexedDBAdapter, MapAdapter, FallbackAdapter } from "../../../../../js/agents/core/archive/archive.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const LARGE_STRING = "x".repeat(120000);

const makeDbName = () => `archive-test-${Math.random().toString(36).slice(2)}`;

const buildDeepObject = (depth) => {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.child = {};
    node = node.child;
  }
  node.leaf = "end";
  return root;
};

const createErrorDb = (mode, { txError = new Error("tx error"), requestError = new Error("request error") } = {}) => ({
  transaction: vi.fn(() => {
    const request = { error: requestError };
    const store = {
      get: vi.fn(() => request),
      put: vi.fn(() => request),
      delete: vi.fn(() => request),
      getAllKeys: vi.fn(() => request),
      clear: vi.fn(() => request),
    };
    const tx = {
      error: txError,
      objectStore: vi.fn(() => store),
    };
    queueMicrotask(() => {
      if (mode === "tx") tx.onerror?.();
      if (mode === "abort") tx.onabort?.();
      if (mode === "request") request.onerror?.();
    });
    return tx;
  }),
  close: vi.fn(),
});

beforeEach(() => {
  mockedLogger.createLogger.mockClear();
  mockedLogger.loggerInstance.warn.mockClear();
  mockedLogger.loggerInstance.info.mockClear();
  mockedLogger.loggerInstance.error.mockClear();
  mockedLogger.loggerInstance.debug.mockClear();
  globalThis.indexedDB = fakeIndexedDB;
});

describe("MapAdapter", () => {
  it("stores and retrieves boundary values", async () => {
    const adapter = new MapAdapter();
    const entries = [
      ["null", null],
      ["undefined", undefined],
      ["empty-string", ""],
      ["empty-array", []],
      ["empty-object", {}],
      ["zero", 0],
      ["negative", -1],
      ["max", Number.MAX_SAFE_INTEGER],
      ["whitespace", "   "],
    ];

    for (const [key, value] of entries) {
      const ok = await adapter.set(key, value);
      expect(ok).toBe(true);
    }

    for (const [key, value] of entries) {
      const stored = await adapter.get(key);
      if (Array.isArray(value) || (value && typeof value === "object")) {
        expect(stored).toEqual(value);
      } else {
        expect(stored).toBe(value);
      }
    }

    const keys = await adapter.keys("*");
    expect(keys).toEqual(entries.map(([key]) => key).sort());
  });

  it("stringifies keys and matches patterns with empty/whitespace defaults", async () => {
    const adapter = new MapAdapter();
    await adapter.set(123, "numeric");
    await adapter.set("run:1", "a");
    await adapter.set("run:2", "b");
    await adapter.set("other", "c");

    expect(await adapter.get("123")).toBe("numeric");
    expect(await adapter.get(123)).toBe("numeric");
    expect(await adapter.keys("run:*")).toEqual(["run:1", "run:2"]);

    const all = await adapter.keys();
    expect(all).toEqual(["123", "other", "run:1", "run:2"]);
    expect(await adapter.keys("")).toEqual(all);
    expect(await adapter.keys("   ")).toEqual(all);
  });

  it("handles concurrent writes and reads", async () => {
    const adapter = new MapAdapter();
    const writes = Array.from({ length: 20 }, (_, i) => adapter.set(`k${i}`, i));
    await Promise.all(writes);

    const reads = await Promise.all(Array.from({ length: 20 }, (_, i) => adapter.get(`k${i}`)));
    expect(reads).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});

describe("IndexedDBAdapter", () => {
  it("rejects when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB;
    globalThis.indexedDB = undefined;
    try {
      const adapter = new IndexedDBAdapter(makeDbName(), "items");
      await expect(adapter._ensureDb()).rejects.toThrow("IndexedDB not available");
      expect(adapter._initPromise).toBe(null);
      expect(adapter._db).toBe(null);
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it("stores values and supports patterns, deletes, and clear", async () => {
    const adapter = new IndexedDBAdapter(makeDbName(), "items");

    await adapter.set("", "empty-key");
    await adapter.set(0, "zero");
    await adapter.set(-1, "neg");
    await adapter.set("max", Number.MAX_SAFE_INTEGER);
    await adapter.set("empty-array", []);
    await adapter.set("empty-object", {});
    await adapter.set("empty-string", "");
    await adapter.set("null", null);
    await adapter.set("whitespace", "   ");
    await adapter.set("run:1", "a");
    await adapter.set("run:2", "b");
    await adapter.set("special.+", "dot");
    await adapter.set("large", LARGE_STRING);

    expect(await adapter.get(0)).toBe("zero");
    expect(await adapter.get("missing")).toBe(null);
    expect(await adapter.get("empty-array")).toEqual([]);
    expect(await adapter.get("empty-object")).toEqual({});
    expect(await adapter.get("empty-string")).toBe("");
    expect(await adapter.get("null")).toBe(null);
    expect(await adapter.get("whitespace")).toBe("   ");
    expect(await adapter.get("large")).toBe(LARGE_STRING);

    expect(await adapter.keys("run:*")).toEqual(["run:1", "run:2"]);
    expect(await adapter.keys("special.+")).toEqual(["special.+"]);

    const all = await adapter.keys("   ");
    expect(await adapter.keys("")).toEqual(all);
    expect(all).toContain("");
    expect(all).toContain("special.+");
    expect(all).toContain("run:1");
    expect(all).toContain("run:2");

    await adapter.delete("null");
    expect(await adapter.keys("*")).not.toContain("null");

    await adapter.clear();
    expect(await adapter.keys("*")).toEqual([]);
  });

  it("closes the database handle", async () => {
    const adapter = new IndexedDBAdapter(makeDbName(), "items");
    await adapter.set("a", 1);
    const db = adapter._db;
    const closeSpy = vi.spyOn(db, "close");

    adapter.close();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(adapter._db).toBe(null);
    expect(adapter._initPromise).toBe(null);
  });

  it("propagates transaction errors", async () => {
    const adapter = new IndexedDBAdapter(makeDbName(), "items");
    adapter._db = createErrorDb("tx");
    await expect(adapter.get("key")).rejects.toThrow("tx error");
  });

  it("propagates request errors", async () => {
    const adapter = new IndexedDBAdapter(makeDbName(), "items");
    adapter._db = createErrorDb("request");
    await expect(adapter.set("key", "value")).rejects.toThrow("request error");
  });

  it("propagates aborted transactions", async () => {
    const adapter = new IndexedDBAdapter(makeDbName(), "items");
    adapter._db = createErrorDb("abort", { txError: null });
    await expect(adapter.delete("key")).rejects.toThrow("Transaction aborted");
  });
});

describe("Archive", () => {
  it("throws when adapter is invalid", () => {
    expect(() => new Archive(null)).toThrow(TypeError);
    expect(() => new Archive({})).toThrow(TypeError);
  });

  it("rejects invalid runId inputs", async () => {
    const archive = new Archive(new MapAdapter());
    const invalid = [null, undefined, "", "   "];
    for (const runId of invalid) {
      await expect(archive.save(runId, { nodeStates: {} })).rejects.toThrow(TypeError);
    }
    await expect(archive.save("bad:run", { nodeStates: {} })).rejects.toThrow("runId must not include ':'");
  });

  it("supports numeric runIds and boundary values", async () => {
    const adapter = new MapAdapter();
    const archive = new Archive(adapter);
    const runIds = [0, -1, Number.MAX_SAFE_INTEGER];

    for (const runId of runIds) {
      const id = await archive.save(runId, { nodeStates: { value: runId }, timestamp: `t-${runId}` });
      expect(id.startsWith(`${String(runId)}:`)).toBe(true);
      const loaded = await archive.load(runId);
      expect(loaded.nodeStates).toEqual({ value: runId });
    }
  });

  it("treats non-plain payloads as empty objects", async () => {
    const adapter = new MapAdapter();
    const archive = new Archive(adapter);
    const id = await archive.save("run", []);
    const stored = await adapter.get(id);
    expect(stored.nodeStates).toEqual({});
  });

  it("generates unique checkpoint ids for rapid consecutive saves", async () => {
    const archive = new Archive(new MapAdapter());
    const data = { timestamp: "1000", nodeStates: { a: 1 } };

    const firstId = await archive.save("run", data);
    const secondId = await archive.save("run", data);

    expect(firstId).toBe("run:1000");
    expect(secondId).toBe("run:1000-1");
  });

  it("serializes concurrent saves for the same runId", async () => {
    const archive = new Archive(new MapAdapter());
    const data = { timestamp: "2000", nodeStates: { a: 1 } };

    const ids = await Promise.all([
      archive.save("run", data),
      archive.save("run", data),
      archive.save("run", data),
    ]);

    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(expect.arrayContaining(["run:2000", "run:2000-1", "run:2000-2"]));
    expect(await archive.listCheckpoints("run")).toHaveLength(3);
  });

  it("loads latest checkpoint by runId and handles empty keys", async () => {
    const archive = new Archive(new MapAdapter());
    await archive.save("run", { timestamp: "1", nodeStates: { v: 1 } });
    await archive.save("run", { timestamp: "2", nodeStates: { v: 2 } });

    const latest = await archive.load("run");
    expect(latest.nodeStates).toEqual({ v: 2 });

    expect(await archive.load(null)).toBe(null);
    expect(await archive.load("   ")).toBe(null);
  });

  it("restore validates checkpoint ids and missing checkpoints", async () => {
    const archive = new Archive(new MapAdapter());
    await expect(archive.restore("")).rejects.toThrow(TypeError);
    await expect(archive.restore("run:missing")).rejects.toThrow("Checkpoint not found");
  });

  it("lists checkpoints sorted by timestamp and counter", async () => {
    const adapter = new MapAdapter();
    const archive = new Archive(adapter);

    await adapter.set("run:100", { nodeStates: { v: 1 }, timestamp: 100 });
    await adapter.set("run:100-2", { nodeStates: { v: 2 }, timestamp: 100 });
    await adapter.set("run:99", { nodeStates: { v: 3 }, timestamp: 99 });

    const list = await archive.listCheckpoints("run");
    expect(list.map((entry) => entry.checkpointId)).toEqual(["run:100-2", "run:100", "run:99"]);
  });

  it("deletes checkpoints older than cutoff and validates days input", async () => {
    const adapter = new MapAdapter();
    const archive = new Archive(adapter);
    const now = Date.now();
    const old = now - 2 * DAY_MS;
    const recent = now - 0.5 * DAY_MS;

    await adapter.set(`run:${old}`, { nodeStates: { v: "old" }, timestamp: old });
    await adapter.set(`run:${recent}`, { nodeStates: { v: "recent" }, timestamp: recent });

    await expect(archive.deleteOlderThan(-1)).rejects.toThrow(TypeError);
    await expect(archive.deleteOlderThan("nope")).rejects.toThrow(TypeError);

    const deleted = await archive.deleteOlderThan("1");
    expect(deleted).toBe(1);
    expect(await adapter.get(`run:${old}`)).toBe(null);
    expect(await adapter.get(`run:${recent}`)).not.toBe(null);
  });

  it("stores diff snapshots and restores them correctly", async () => {
    const adapter = new MapAdapter();
    const archive = new Archive(adapter, {
      diff: { enabled: true, minSavingsBytes: 0, fullSnapshotEvery: 100 },
    });

    const firstId = await archive.save("run", {
      timestamp: "1",
      nodeStates: { text: LARGE_STRING, count: 1 },
    });
    const secondId = await archive.save("run", {
      timestamp: "2",
      nodeStates: { text: LARGE_STRING, count: 2 },
    });

    const stored = await adapter.get(secondId);
    expect(stored.encoding).toBe("diff");
    expect(stored.base).toBe(firstId);
    expect(Array.isArray(stored.patch)).toBe(true);

    const restored = await archive.restore(secondId);
    expect(restored.nodeStates).toEqual({ text: LARGE_STRING, count: 2 });
  });

  it("falls back to full snapshot when diff build fails", async () => {
    const adapter = new MapAdapter();
    const archive = new Archive(adapter, {
      diff: { enabled: true, minSavingsBytes: 0, fullSnapshotEvery: 100 },
    });

    await archive.save("run", { timestamp: "1", nodeStates: { ok: true } });
    const unsafe = Object.create(null);
    unsafe.__proto__ = { evil: true };

    const id = await archive.save("run", { timestamp: "2", nodeStates: unsafe });
    const stored = await adapter.get(id);

    expect(stored.encoding).toBe(undefined);
    expect(stored.nodeStates).toBe(unsafe);
    expect(Object.prototype.hasOwnProperty.call(stored.nodeStates, "__proto__")).toBe(true);
  });

  it("detects circular diff references", async () => {
    const adapter = new MapAdapter();
    const archive = new Archive(adapter);
    const id = "run:1";

    await adapter.set(id, { encoding: "diff", base: id, patch: [] });

    await expect(archive.restore(id)).rejects.toThrow("Circular checkpoint reference detected");
  });

  it("restores deep nested nodeStates and empty collections", async () => {
    const archive = new Archive(new MapAdapter(), { diff: { enabled: false } });
    const deep = buildDeepObject(60);

    const id = await archive.save("deep", {
      timestamp: "1",
      nodeStates: { deep, list: [], obj: {} },
    });

    const restored = await archive.restore(id);
    expect(restored.nodeStates.deep).toEqual(deep);
    expect(restored.nodeStates.list).toEqual([]);
    expect(restored.nodeStates.obj).toEqual({});
  });
});

describe("FallbackAdapter", () => {
  it("falls back to MapAdapter when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB;
    globalThis.indexedDB = undefined;
    try {
      const adapter = new FallbackAdapter("db", "store");
      await adapter.set("key", "value");
      expect(await adapter.get("key")).toBe("value");
      expect(adapter._useFallback).toBe(true);
      expect(adapter._primary).toBe(null);
      expect(mockedLogger.loggerInstance.warn).toHaveBeenCalled();
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it("uses IndexedDBAdapter when available", async () => {
    const adapter = new FallbackAdapter(makeDbName(), "store");
    await adapter.set("key", "value");
    expect(await adapter.get("key")).toBe("value");
    expect(adapter._primary).toBeInstanceOf(IndexedDBAdapter);
    expect(adapter._useFallback).toBe(false);
  });

  it("falls back when primary initialization fails", async () => {
    const ensureSpy = vi.spyOn(IndexedDBAdapter.prototype, "_ensureDb").mockRejectedValue(new Error("boom"));
    try {
      const adapter = new FallbackAdapter(makeDbName(), "store");
      await adapter.set("key", "value");
      expect(await adapter.get("key")).toBe("value");
      expect(adapter._useFallback).toBe(true);
      expect(adapter._primary).toBeInstanceOf(IndexedDBAdapter);
      expect(mockedLogger.loggerInstance.warn).toHaveBeenCalled();
    } finally {
      ensureSpy.mockRestore();
    }
  });
});
