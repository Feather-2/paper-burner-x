import { describe, it, expect, vi, beforeEach } from "vitest";

import { indexedDB as fdb, IDBKeyRange as FDBKeyRange } from "fake-indexeddb";

vi.mock("../../../../../../js/agents/shared/index.js", () => {
  const isPlainObject = vi.fn((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  const toNonEmptyString = vi.fn((value) => {
    if (value === undefined || value === null) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
  });

  return {
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    isPlainObject,
    toNonEmptyString,
  };
});

import { CodeSearchIndexStore } from "../../../../../../js/agents/stages/codesearch/indexing/index-store.js";

describe("CodeSearchIndexStore", () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalIDBKeyRange = globalThis.IDBKeyRange;
  let dbCounter = 0;

  const nextDbName = () => `CodeSearchIndexDB_test_${dbCounter++}`;

  beforeEach(() => {
    vi.clearAllMocks();

    if (typeof originalIndexedDB === "undefined") {
      // @ts-ignore
      delete globalThis.indexedDB;
    } else {
      globalThis.indexedDB = originalIndexedDB;
    }

    if (typeof originalIDBKeyRange === "undefined") {
      // @ts-ignore
      delete globalThis.IDBKeyRange;
    } else {
      globalThis.IDBKeyRange = originalIDBKeyRange;
    }

    // Default to no indexedDB for memory-path tests.
    // @ts-ignore
    delete globalThis.indexedDB;
    // @ts-ignore
    delete globalThis.IDBKeyRange;
  });

  it("falls back to memory when indexedDB is unavailable and supports basic flows", async () => {
    const store = new CodeSearchIndexStore();

    expect(await store.open()).toBeNull();

    const key1 = await store.putSymbolRecord(null, "src/a.js", {
      sha256: "sha",
      symbols: [],
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(key1).toBe("default::src/a.js");

    const key2 = await store.putSymbolRecord("ws1", "b.js", {
      sha256: "sha2",
      symbols: [{ name: "B" }],
      updatedAt: "2020-01-02T00:00:00.000Z",
    });
    expect(key2).toBe("ws1::b.js");

    const key3 = await store.putSymbolRecord("src/c.js", { sha256: "sha3" });
    expect(key3).toBe("default::src/c.js");

    const recDefault = await store.getSymbolRecord("src/c.js");
    expect(recDefault?.workspaceId).toBe("default");
    expect(recDefault?.path).toBe("src/c.js");

    const recWs1 = await store.getSymbolRecord("ws1", "b.js");
    expect(recWs1?.symbols).toEqual([{ name: "B" }]);

    const missing = await store.getSymbolRecord("ws1", "missing.js");
    expect(missing).toBeNull();

    expect(await store.listSymbolRecords()).toHaveLength(2);
    expect(await store.listSymbolRecords("ws1")).toHaveLength(1);

    await store.close();
    expect(await store.open()).toBeNull();
  });

  it("normalizes inputs, handles edge values, and uses hash alias/updatedAt defaults", async () => {
    const store = new CodeSearchIndexStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2021-02-03T04:05:06.000Z"));

    try {
      const key = await store.putSymbolRecord("  file.js  ", {
        hash: "hash-value",
        symbols: { not: "array" },
        updatedAt: null,
      });

      expect(key).toBe("default::file.js");
      const rec = await store.getSymbolRecord("default", "file.js");
      expect(rec).toMatchObject({
        workspaceId: "default",
        path: "file.js",
        sha256: "hash-value",
        symbols: [],
        updatedAt: "2021-02-03T04:05:06.000Z",
      });

      const key2 = await store.putSymbolRecord(0, "-1", {
        sha256: "zero",
        symbols: [],
        updatedAt: "2021-02-03T04:05:07.000Z",
      });
      expect(key2).toBe("0::-1");
      const rec2 = await store.getSymbolRecord("0", "-1");
      expect(rec2?.workspaceId).toBe("0");
      expect(rec2?.path).toBe("-1");
      expect(rec2?.symbols).toEqual([]);

      const keyNeg = await store.putSymbolRecord(-1, { sha256: "neg" });
      expect(keyNeg).toBe("default::-1");
      const recNeg = await store.getSymbolRecord("default", "-1");
      expect(recNeg?.workspaceId).toBe("default");

      const key3 = await store.putSymbolRecord(Number.MAX_SAFE_INTEGER, "  spaced.js  ", {});
      expect(key3).toBe(`${Number.MAX_SAFE_INTEGER}::spaced.js`);
      const rec3 = await store.getSymbolRecord(String(Number.MAX_SAFE_INTEGER), "spaced.js");
      expect(rec3?.sha256).toBeNull();
      expect(rec3?.symbols).toEqual([]);
      expect(rec3?.updatedAt).toBe("2021-02-03T04:05:06.000Z");

      const key4 = await store.putSymbolRecord("ws", "non-string-sha.js", {
        sha256: 123,
        symbols: "nope",
      });
      expect(key4).toBe("ws::non-string-sha.js");
      const rec4 = await store.getSymbolRecord("ws", "non-string-sha.js");
      expect(rec4?.sha256).toBeNull();
      expect(rec4?.symbols).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when path is missing or blank", async () => {
    const store = new CodeSearchIndexStore();

    await expect(store.putSymbolRecord("ws", "", {})).rejects.toThrow("putSymbolRecord: path is required");
    await expect(store.putSymbolRecord("ws", "   ", {})).rejects.toThrow("putSymbolRecord: path is required");
    await expect(store.putSymbolRecord(undefined, undefined)).rejects.toThrow("putSymbolRecord: path is required");
    await expect(store.putSymbolRecord(null, null)).rejects.toThrow("putSymbolRecord: path is required");
  });

  it("handles large inputs and deep nested symbols", async () => {
    const store = new CodeSearchIndexStore();
    const longPath = `dir/${"a".repeat(10000)}/file.js`;
    const hugeText = "x".repeat(20000);
    const deepSymbols = [];
    let current = { level: 0, payload: hugeText };
    for (let i = 1; i < 20; i += 1) {
      current = { level: i, child: current };
    }
    deepSymbols.push({ root: current });

    const key = await store.putSymbolRecord("ws", longPath, {
      sha256: "big",
      symbols: deepSymbols,
      updatedAt: "2022-01-01T00:00:00.000Z",
    });

    expect(key).toBe(`ws::${longPath}`);
    const rec = await store.getSymbolRecord("ws", longPath);
    expect(rec?.symbols).toEqual(deepSymbols);
    expect(rec?.path).toBe(longPath);
  });

  it("supports concurrent puts and rapid reads", async () => {
    const store = new CodeSearchIndexStore();

    const keys = await Promise.all([
      store.putSymbolRecord("ws", "a.js", { sha256: "1", symbols: [] }),
      store.putSymbolRecord("ws", "b.js", { sha256: "2", symbols: [] }),
      store.putSymbolRecord("ws", "c.js", { sha256: "3", symbols: [] }),
    ]);

    expect(keys).toEqual(["ws::a.js", "ws::b.js", "ws::c.js"]);

    const [recA, recB] = await Promise.all([
      store.getSymbolRecord("ws", "a.js"),
      store.getSymbolRecord("ws", "a.js"),
    ]);
    expect(recA).toEqual(recB);

    const rows = await store.listSymbolRecords("ws");
    expect(rows).toHaveLength(3);
  });

  it("uses indexedDB when available and caches open()", async () => {
    globalThis.indexedDB = fdb;
    globalThis.IDBKeyRange = FDBKeyRange;

    const store = new CodeSearchIndexStore({ dbName: nextDbName() });

    const [db1, db2] = await Promise.all([store.open(), store.open()]);
    expect(db1).toEqual(expect.objectContaining({ name: store.dbName, version: store.dbVersion }));
    expect(db1).toBe(db2);

    await store.putSymbolRecord("ws1", "a.js", { sha256: "1", symbols: [{ name: "A" }] });
    await store.putSymbolRecord("ws2", "b.js", { sha256: "2", symbols: [{ name: "B" }] });

    const rec = await store.getSymbolRecord("ws1", "a.js");
    expect(rec?.workspaceId).toBe("ws1");
    expect(rec?.path).toBe("a.js");

    const ws1Rows = await store.listSymbolRecords("ws1");
    expect(ws1Rows).toHaveLength(1);
    expect(ws1Rows[0].key).toBe("ws1::a.js");

    await store.close();
    const db3 = await store.open();
    expect(db3).toEqual(expect.objectContaining({ name: store.dbName, version: store.dbVersion }));
  });

  it("returns null on indexedDB open failures and retries on subsequent calls", async () => {
    globalThis.indexedDB = {
      open: vi.fn((name, version) => {
        const req = { error: new Error("fail") };
        Promise.resolve().then(() => {
          if (typeof req.onerror === "function") req.onerror();
        });
        return req;
      }),
    };

    const store = new CodeSearchIndexStore({ dbName: "bad", dbVersion: "2" });
    expect(await store.open()).toBeNull();
    expect(await store.open()).toBeNull();
    expect(globalThis.indexedDB.open).toHaveBeenCalledTimes(2);
    expect(globalThis.indexedDB.open).toHaveBeenCalledWith("bad", "2");
  });
});
