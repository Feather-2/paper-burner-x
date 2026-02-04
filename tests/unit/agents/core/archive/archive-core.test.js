import { describe, it, expect, vi, beforeEach } from "vitest";

const mockValueUtils = vi.hoisted(() => {
  const isPlainObjectImpl = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const toNonEmptyStringImpl = (value) => {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s ? s : null;
  };

  const toPositiveIntImpl = (value, fallback) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n <= 0) return fallback;
    return Math.floor(n);
  };

  return {
    isPlainObject: vi.fn(isPlainObjectImpl),
    toNonEmptyString: vi.fn(toNonEmptyStringImpl),
    toPositiveInt: vi.fn(toPositiveIntImpl),
  };
});

const mockSerialization = vi.hoisted(() => {
  const cloneJson = (v) => JSON.parse(JSON.stringify(v));

  const setByJsonPointer = (obj, pointer, value) => {
    if (pointer === "" || pointer === "/") return value;
    const parts = String(pointer)
      .split("/")
      .slice(1)
      .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));

    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== "object") {
        cur[key] = {};
      }
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  };

  return {
    safeJsonSize: vi.fn((value) => {
      try {
        return Buffer.byteLength(JSON.stringify(value), "utf8");
      } catch {
        return Infinity;
      }
    }),
    buildJsonPatch: vi.fn(() => []),
    applyJsonPatch: vi.fn((base, ops) => {
      if (base === null || base === undefined) return null;
      if (!Array.isArray(ops)) return null;

      let out = cloneJson(base);
      for (const op of ops) {
        if (!op || typeof op !== "object") return null;
        const kind = String(op.op || "").toLowerCase();
        const path = op.path;

        if (kind === "replace" || kind === "add") {
          out = setByJsonPointer(out, path, cloneJson(op.value));
          continue;
        }

        // Minimal support: treat remove as setting undefined (good enough for unit tests here)
        if (kind === "remove") {
          out = setByJsonPointer(out, path, undefined);
          continue;
        }

        return null;
      }
      return out;
    }),
  };
});

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => mockValueUtils);
vi.mock("../../../../../js/agents/core/archive/serialization.js", () => mockSerialization);

import { Archive } from "../../../../../js/agents/core/archive/archive-core.js";

const deferred = () => {
  /** @type {(v?: any) => void} */
  let resolve;
  /** @type {(e?: any) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createMemoryStorage = (seedEntries = []) => {
  const map = new Map(seedEntries);
  return {
    map,
    get: vi.fn(async (k) => (map.has(k) ? map.get(k) : null)),
    set: vi.fn(async (k, v) => {
      map.set(k, v);
    }),
    delete: vi.fn(async (k) => {
      map.delete(k);
    }),
    keys: vi.fn(async () => [...map.keys()]),
  };
};

const makeDeepObject = (depth) => {
  let cur = {};
  const root = cur;
  for (let i = 0; i < depth; i++) {
    cur.next = {};
    cur = cur.next;
  }
  return root;
};

describe("Archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws TypeError when storage adapter is missing required methods", () => {
    const badAdapters = [
      null,
      undefined,
      0,
      "x",
      [],
      {},
      { get() {} },
      { get() {}, set() {} },
      { get() {}, set() {}, delete() {} },
      { get() {}, set() {}, delete() {}, keys: null },
    ];

    for (const bad of badAdapters) {
      expect(() => new Archive(bad)).toThrow(TypeError);
      expect(() => new Archive(bad)).toThrow(/must implement/i);
    }
  });

  it("accepts a valid storage adapter and initializes defaults", () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage);

    expect(archive.storage).toBe(storage);
    expect(archive._saveCounter).toBe(0);
    expect(archive._restoreCache).toBeInstanceOf(Map);
    expect(archive._restoreCacheMax).toBe(200);
    expect(archive._diff).toEqual(
      expect.objectContaining({
        enabled: true,
        fullSnapshotEvery: 10,
        minSavingsBytes: 1024,
        maxOps: 5000,
        maxDepth: 12,
      }),
    );
  });

  it("normalizes restoreCacheMax edge cases (null/undefined/Infinity/strings/negatives)", () => {
    const storage = createMemoryStorage();

    expect(new Archive(storage, {}). _restoreCacheMax).toBe(200);
    expect(new Archive(storage, { restoreCacheMax: null })._restoreCacheMax).toBe(200);
    expect(new Archive(storage, { restoreCacheMax: undefined })._restoreCacheMax).toBe(200);

    expect(new Archive(storage, { restoreCacheMax: Infinity })._restoreCacheMax).toBe(Infinity);
    expect(new Archive(storage, { restoreCacheMax: 0 })._restoreCacheMax).toBe(0);
    expect(new Archive(storage, { restoreCacheMax: -1 })._restoreCacheMax).toBe(0);

    expect(new Archive(storage, { restoreCacheMax: "3.9" })._restoreCacheMax).toBe(3);
    expect(new Archive(storage, { restoreCacheMax: "  2  " })._restoreCacheMax).toBe(2);
    expect(new Archive(storage, { restoreCacheMax: "not-a-number" })._restoreCacheMax).toBe(200);

    expect(new Archive(storage, { restoreCacheMax: Number.MAX_SAFE_INTEGER })._restoreCacheMax).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("normalizes diff config edge cases (enabled coercion, positive ints, fallbacks)", () => {
    const storage = createMemoryStorage();

    const archiveA = new Archive(storage, { diff: null });
    expect(archiveA._diff).toEqual(
      expect.objectContaining({
        enabled: true,
        fullSnapshotEvery: 10,
        minSavingsBytes: 1024,
        maxOps: 5000,
        maxDepth: 12,
      }),
    );

    const archiveB = new Archive(storage, {
      diff: {
        enabled: 0,
        fullSnapshotEvery: "5",
        minSavingsBytes: -1,
        maxOps: "2",
        maxDepth: " 3 ",
      },
    });

    expect(archiveB._diff).toEqual(
      expect.objectContaining({
        enabled: false,
        fullSnapshotEvery: 5,
        minSavingsBytes: 1024, // fallback because -1
        maxOps: 2,
        maxDepth: 3,
      }),
    );
  });

  it("_pruneRestoreCache clears cache when restoreCacheMax <= 0", () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage, { restoreCacheMax: 0 });

    archive._restoreCache.set("a", { nodeStates: { a: 1 } });
    archive._restoreCache.set("b", { nodeStates: { b: 2 } });

    archive._pruneRestoreCache();

    expect(archive._restoreCache.size).toBe(0);
  });

  it("_pruneRestoreCache evicts oldest entries when over limit", () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage, { restoreCacheMax: 2 });

    archive._restoreCache.set("a", { nodeStates: { a: 1 } });
    archive._restoreCache.set("b", { nodeStates: { b: 2 } });
    archive._restoreCache.set("c", { nodeStates: { c: 3 } });

    archive._pruneRestoreCache();

    expect([...archive._restoreCache.keys()]).toEqual(["b", "c"]);
    expect(archive._restoreCache.size).toBe(2);
  });

  it("_pruneRestoreCache does nothing when restoreCacheMax is Infinity", () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage, { restoreCacheMax: Infinity });

    archive._restoreCache.set("a", { nodeStates: { a: 1 } });
    archive._restoreCache.set("b", { nodeStates: { b: 2 } });
    archive._restoreCache.set("c", { nodeStates: { c: 3 } });

    archive._pruneRestoreCache();

    expect([...archive._restoreCache.keys()]).toEqual(["a", "b", "c"]);
    expect(archive._restoreCache.size).toBe(3);
  });

  it("_cacheRestoredCheckpoint ignores empty/null/whitespace checkpointId", () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage, { restoreCacheMax: 10 });

    archive._cacheRestoredCheckpoint(null, { nodeStates: { a: 1 } });
    archive._cacheRestoredCheckpoint(undefined, { nodeStates: { a: 1 } });
    archive._cacheRestoredCheckpoint("", { nodeStates: { a: 1 } });
    archive._cacheRestoredCheckpoint("   ", { nodeStates: { a: 1 } });

    expect(archive._restoreCache.size).toBe(0);
  });

  it("_cacheRestoredCheckpoint is disabled when restoreCacheMax is 0", () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage, { restoreCacheMax: 0 });

    archive._cacheRestoredCheckpoint("run:1", { nodeStates: { a: 1 } });
    expect(archive._restoreCache.size).toBe(0);
  });

  it("_cacheRestoredCheckpoint trims checkpointId and prunes to limit", () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage, { restoreCacheMax: 1 });

    archive._cacheRestoredCheckpoint("  a  ", { nodeStates: { a: 1 } });
    expect([...archive._restoreCache.keys()]).toEqual(["a"]);

    archive._cacheRestoredCheckpoint("b", { nodeStates: { b: 2 } });
    expect([...archive._restoreCache.keys()]).toEqual(["b"]);
    expect(archive._restoreCache.size).toBe(1);
  });

  it("_touchRestoreCache promotes an entry (LRU) when caching is enabled", () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage, { restoreCacheMax: 2 });

    archive._cacheRestoredCheckpoint("a", { nodeStates: { a: 1 } });
    archive._cacheRestoredCheckpoint("b", { nodeStates: { b: 2 } });
    expect([...archive._restoreCache.keys()]).toEqual(["a", "b"]);

    archive._touchRestoreCache("a");
    expect([...archive._restoreCache.keys()]).toEqual(["b", "a"]);

    archive._cacheRestoredCheckpoint("c", { nodeStates: { c: 3 } });
    expect([...archive._restoreCache.keys()]).toEqual(["a", "c"]);
  });

  it("_touchRestoreCache is a no-op when restoreCacheMax is Infinity", () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage, { restoreCacheMax: Infinity });

    archive._cacheRestoredCheckpoint("a", { nodeStates: { a: 1 } });
    archive._cacheRestoredCheckpoint("b", { nodeStates: { b: 2 } });

    archive._touchRestoreCache("a");
    expect([...archive._restoreCache.keys()]).toEqual(["a", "b"]);
  });

  it("_restoreCheckpointInternal returns null for invalid checkpointId inputs", async () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage);

    await expect(archive._restoreCheckpointInternal(null)).resolves.toBeNull();
    await expect(archive._restoreCheckpointInternal(undefined)).resolves.toBeNull();
    await expect(archive._restoreCheckpointInternal("")).resolves.toBeNull();
    await expect(archive._restoreCheckpointInternal("   ")).resolves.toBeNull();
  });

  it("_restoreCheckpointInternal returns cached value without calling storage.get", async () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage);

    const restored = { nodeStates: { a: 1 }, timestamp: 1, metadata: { ok: true } };
    archive._restoreCache.set("run:1", restored);

    const out = await archive._restoreCheckpointInternal("run:1");
    expect(out).toBe(restored);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("_restoreCheckpointInternal returns null when storage has no checkpoint", async () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage);

    await expect(archive._restoreCheckpointInternal("run:missing")).resolves.toBeNull();
    expect(storage.get).toHaveBeenCalledTimes(1);
  });

  it("_restoreCheckpointInternal best-effort restores even when stored entry is not a plain object", async () => {
    const storage = createMemoryStorage([
      ["run:arr", []],
      ["run:str", "not-an-object"],
    ]);
    const archive = new Archive(storage);

    const outArr = await archive._restoreCheckpointInternal("run:arr");
    expect(outArr).not.toBeNull();
    expect(outArr).toEqual(expect.objectContaining({ nodeStates: {}, timestamp: "arr" }));

    const outStr = await archive._restoreCheckpointInternal("run:str");
    expect(outStr).not.toBeNull();
    expect(outStr).toEqual(expect.objectContaining({ nodeStates: {}, timestamp: "str" }));
  });

  it("_restoreCheckpointInternal restores a full snapshot and caches it", async () => {
    const base = {
      schemaVersion: 1,
      nodeStates: { a: 1, nested: { x: "y" } },
      timestamp: 0,
      metadata: {},
    };
    const storage = createMemoryStorage([["run:1", base]]);
    const archive = new Archive(storage, { restoreCacheMax: 10 });

    const r1 = await archive._restoreCheckpointInternal("run:1");
    expect(r1).not.toBeNull();
    expect(r1).toEqual(expect.objectContaining({ nodeStates: base.nodeStates, timestamp: 0, metadata: {} }));
    expect(storage.get).toHaveBeenCalledTimes(1);

    const callsBefore = storage.get.mock.calls.length;
    const r2 = await archive._restoreCheckpointInternal("run:1");
    expect(r2).toEqual(expect.objectContaining({ nodeStates: base.nodeStates }));
    expect(storage.get).toHaveBeenCalledTimes(callsBefore);

    expect(archive._restoreCache.has("run:1")).toBe(true);
  });

  it("_restoreCheckpointInternal restores a diff checkpoint by applying JSON patch over base snapshot", async () => {
    const baseId = "run:base";
    const diffId = "run:diff";

    const base = {
      schemaVersion: 1,
      nodeStates: { a: 1, nested: { x: "y" } },
      timestamp: 1000,
      metadata: { label: "base" },
    };

    const ops = [
      { op: "replace", path: "/a", value: 2 },
      { op: "add", path: "/b", value: "new" },
    ];

    const diff = {
      encoding: "diff",
      schemaVersion: 1,
      timestamp: 2000,
      metadata: { label: "diff" },
      // Provide multiple possible shapes to satisfy implementation details.
      base: baseId,
      from: baseId,
      prev: baseId,
      baseCheckpointId: baseId,
      ops,
      patch: ops,
      diffOps: ops,
      diff: { base: baseId, from: baseId, ops, patch: ops },
    };

    const storage = createMemoryStorage([
      [baseId, base],
      [diffId, diff],
    ]);
    const archive = new Archive(storage, { restoreCacheMax: 10 });

    const restored = await archive._restoreCheckpointInternal(diffId);
    expect(restored).not.toBeNull();
    expect(restored.nodeStates).toEqual({ a: 2, nested: { x: "y" }, b: "new" });
    expect(mockSerialization.applyJsonPatch).toHaveBeenCalled();

    const callsBefore = storage.get.mock.calls.length;
    const restoredAgain = await archive._restoreCheckpointInternal(diffId);
    expect(restoredAgain.nodeStates).toEqual({ a: 2, nested: { x: "y" }, b: "new" });
    expect(storage.get.mock.calls.length).toBe(callsBefore);
  });

  it("_restoreCheckpointInternal detects cycles and throws (no infinite recursion)", async () => {
    const id = "run:cycle";
    const ops = [{ op: "replace", path: "/a", value: 1 }];
    const cyc = {
      encoding: "diff",
      timestamp: 1,
      metadata: { label: "cycle" },
      base: id,
      patch: ops,
    };

    const storage = createMemoryStorage([[id, cyc]]);
    const archive = new Archive(storage);

    await expect(archive._restoreCheckpointInternal(id)).rejects.toThrow(/circular checkpoint reference/i);
  });

  it("_restoreCheckpointInternal guards against excessive depth (deep diff chains)", async () => {
    const storage = createMemoryStorage();
    const archive = new Archive(storage);

    const baseId = "run:0";
    storage.map.set(baseId, {
      schemaVersion: 1,
      nodeStates: { a: 0 },
      timestamp: 0,
      metadata: {},
    });

    const chainLen = 80; // > DEFAULT_RESTORE_MAX_DEPTH (50)
    for (let i = 1; i <= chainLen; i++) {
      const id = `run:${i}`;
      const prev = `run:${i - 1}`;
      storage.map.set(id, {
        encoding: "diff",
        timestamp: i,
        metadata: { i },
        base: prev,
        patch: [{ op: "replace", path: "/a", value: i }],
      });
    }

    await expect(archive._restoreCheckpointInternal(`run:${chainLen}`)).rejects.toThrow(/max depth exceeded/i);
  });

  it("_restoreCheckpointInternal handles concurrent restores without corrupting cache", async () => {
    const id = "run:concurrent";
    const entry = { schemaVersion: 1, nodeStates: { a: 1 }, timestamp: 1, metadata: {} };

    const gate = deferred();
    const storage = createMemoryStorage([[id, entry]]);
    storage.get.mockImplementation(async (k) => {
      await gate.promise;
      return storage.map.get(k) ?? null;
    });

    const archive = new Archive(storage, { restoreCacheMax: 10 });

    const p1 = archive._restoreCheckpointInternal(id);
    const p2 = archive._restoreCheckpointInternal(id);

    gate.resolve();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1).toEqual(expect.objectContaining({ nodeStates: { a: 1 } }));
    expect(r2).toEqual(expect.objectContaining({ nodeStates: { a: 1 } }));
    expect(storage.get.mock.calls.length === 1 || storage.get.mock.calls.length === 2).toBe(true);

    const callsBefore = storage.get.mock.calls.length;
    const r3 = await archive._restoreCheckpointInternal(id);
    expect(r3).toEqual(expect.objectContaining({ nodeStates: { a: 1 } }));
    expect(storage.get.mock.calls.length).toBe(callsBefore);
  });

  it("_restoreCheckpointInternal supports large payloads (long strings, deep nesting) without relying on time/external state", async () => {
    const id = "run:big";
    const bigString = "x".repeat(200_000);
    const deep = makeDeepObject(30);

    const entry = {
      schemaVersion: 1,
      nodeStates: { text: bigString, deep, arr: Array.from({ length: 2000 }, (_, i) => i) },
      timestamp: Number.MAX_SAFE_INTEGER,
      metadata: { note: "big" },
    };

    const storage = createMemoryStorage([[id, entry]]);
    const archive = new Archive(storage);

    const restored = await archive._restoreCheckpointInternal(id);
    expect(restored).not.toBeNull();
    expect(restored.timestamp).toBe(Number.MAX_SAFE_INTEGER);
    expect(restored.nodeStates.text.length).toBe(200_000);
    expect(restored.nodeStates.arr.length).toBe(2000);
    expect(restored.nodeStates.deep).toEqual(deep);
  });
});
