import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { indexedDB as fdb, IDBKeyRange as FDBKeyRange } from "fake-indexeddb";

import { CodeSearchIndexStore } from "../../../../js/agents/stages/codesearch/indexing/index-store.js";

describe("codesearch/indexing/index-store", () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalIDBKeyRange = globalThis.IDBKeyRange;

  beforeEach(() => {
    // Default to "no indexedDB" for memory-path tests.
    // Individual tests can opt-in to fake-indexeddb.
    // @ts-ignore
    delete globalThis.indexedDB;
    // @ts-ignore
    delete globalThis.IDBKeyRange;
  });

  afterEach(() => {
    globalThis.indexedDB = originalIndexedDB;
    globalThis.IDBKeyRange = originalIDBKeyRange;
  });

  it("falls back to in-memory storage when indexedDB is unavailable", async () => {
    const store = new CodeSearchIndexStore();

    expect(await store.open()).toBeNull();

    const key = await store.putSymbolRecord(null, "src/a.js", {
      sha256: "sha",
      symbols: [{ name: "foo" }],
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(key).toBe("default::src/a.js");

    const rec = await store.getSymbolRecord("default", "src/a.js");
    expect(rec).toMatchObject({
      key: "default::src/a.js",
      workspaceId: "default",
      path: "src/a.js",
      sha256: "sha",
    });
    expect(rec?.symbols).toEqual([{ name: "foo" }]);

    expect(await store.listSymbolRecords("default")).toHaveLength(1);
    expect(await store.listSymbolRecords("other")).toHaveLength(0);

    // close() should be a no-op in memory mode (no db handle).
    await store.close();
    expect(await store.open()).toBeNull();
  });

  it("throws when putSymbolRecord is called without a valid path", async () => {
    const store = new CodeSearchIndexStore();
    await expect(store.putSymbolRecord("ws", "", {})).rejects.toThrow("putSymbolRecord: path is required");
  });

  it("uses indexedDB when available (via fake-indexeddb)", async () => {
    globalThis.indexedDB = fdb;
    globalThis.IDBKeyRange = FDBKeyRange;

    const store = new CodeSearchIndexStore({ dbName: `CodeSearchIndexDB_test_${Date.now()}_${Math.random()}` });

    const db1 = await store.open();
    const db2 = await store.open();
    expect(db1).toEqual(expect.objectContaining({ name: store.dbName, version: store.dbVersion }));
    expect(db1).toBe(db2); // cached promise

    await store.putSymbolRecord("ws1", "a.js", { sha256: "1", symbols: [{ name: "A" }] });
    await store.putSymbolRecord("ws2", "b.js", { sha256: "2", symbols: [{ name: "B" }] });

    const rec = await store.getSymbolRecord("ws1", "a.js");
    expect(rec?.workspaceId).toBe("ws1");
    expect(rec?.path).toBe("a.js");

    const missing = await store.getSymbolRecord("ws1", "missing.js");
    expect(missing).toBeNull();

    const ws1Rows = await store.listSymbolRecords("ws1");
    expect(ws1Rows).toHaveLength(1);
    expect(ws1Rows[0].key).toBe("ws1::a.js");

    // Non-string sha256 and non-array symbols should normalize to null/[].
    const key = await store.putSymbolRecord("ws1", "c.js", { sha256: 123, symbols: "nope" });
    const normalized = await store.getSymbolRecord("ws1", "c.js");
    expect(key).toBe("ws1::c.js");
    expect(normalized?.sha256).toBeNull();
    expect(normalized?.symbols).toEqual([]);

    await store.close();

    // After close(), open() should create a new connection/promise.
    const db3 = await store.open();
    expect(db3).toEqual(expect.objectContaining({ name: store.dbName, version: store.dbVersion }));
  });
});
