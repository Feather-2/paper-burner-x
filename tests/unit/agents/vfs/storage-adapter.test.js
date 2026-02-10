import { afterEach, describe, expect, it, vi } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  StorageBackend,
  StorageAdapter,
  OpfsStorageAdapter,
  IndexedDbStorageAdapter,
  LocalStorageAdapter,
  MemoryStorageAdapter,
  createStorageAdapter,
  detectAvailableBackends,
} from '../../../../js/agents/vfs/storage-adapter.js';

import { createMockOpfsRoot } from "./opfs-mock.js";

function createLocalStorageMock(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [String(k), String(v)]));
  const keys = () => Array.from(store.keys());
  return {
    get length() {
      return store.size;
    },
    key(i) {
      const k = keys()[i];
      return typeof k === "string" ? k : null;
    },
    getItem(k) {
      const key = String(k);
      return store.has(key) ? store.get(key) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    },
    // test helper
    _dump() {
      return new Map(store);
    },
  };
}

async function flushFakeIndexedDbEvents(turns = 3) {
  // fake-indexeddb dispatches open() events via setImmediate, and may require
  // multiple turns (upgrade + success). Flush a few times to avoid callbacks
  // firing after globals have been unstubbed.
  for (let i = 0; i < turns; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve));
  }
}

afterEach(async () => {
  await flushFakeIndexedDbEvents();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agents/vfs/storage-adapter", () => {
  it("StorageAdapter base class throws for unimplemented methods", async () => {
    const base = new StorageAdapter("test-backend");
    await expect(base.get("k")).rejects.toThrow(/not implemented/i);
    await expect(base.set("k", 1)).rejects.toThrow(/not implemented/i);
    await expect(base.delete("k")).rejects.toThrow(/not implemented/i);
    await expect(base.has("k")).rejects.toThrow(/not implemented/i);
    await expect(base.keys()).rejects.toThrow(/not implemented/i);
    await expect(base.clear()).rejects.toThrow(/not implemented/i);

    await expect(base.getUsage()).resolves.toEqual({ used: 0, quota: 0 });
  });

  it("MemoryStorageAdapter supports basic Map-like operations", async () => {
    const mem = new MemoryStorageAdapter();
    expect(mem.backend).toBe(StorageBackend.MEMORY);

    await expect(mem.has("k")).resolves.toBe(false);
    await expect(mem.get("k")).resolves.toBe(undefined);

    await expect(mem.set("k", { ok: true })).resolves.toBe(undefined);
    await expect(mem.has("k")).resolves.toBe(true);
    await expect(mem.get("k")).resolves.toEqual({ ok: true });

    await expect(mem.keys()).resolves.toEqual(["k"]);
    await expect(mem.delete("k")).resolves.toBe(true);
    await expect(mem.delete("k")).resolves.toBe(false);

    await mem.set("a", 1);
    await mem.set("b", 2);
    await expect(mem.keys()).resolves.toEqual(["a", "b"]);
    await expect(mem.clear()).resolves.toBe(undefined);
    await expect(mem.keys()).resolves.toEqual([]);
  });

  it("LocalStorageAdapter stores JSON values and lists only prefixed keys", async () => {
    const localStorage = createLocalStorageMock({ other: "skip" });
    vi.stubGlobal("localStorage", localStorage);

    const adapter = new LocalStorageAdapter({ prefix: "pb_" });
    expect(adapter.backend).toBe(StorageBackend.LOCALSTORAGE);

    await adapter.set("a", { x: 1 });
    await adapter.set("b", "text");
    expect(localStorage.getItem("pb_a")).toBe(JSON.stringify({ x: 1 }));

    await expect(adapter.get("a")).resolves.toEqual({ x: 1 });
    await expect(adapter.get("b")).resolves.toBe("text");
    await expect(adapter.get("missing")).resolves.toBe(undefined);

    // When stored content isn't JSON, get() falls back to raw string.
    localStorage.setItem("pb_raw", "not-json");
    await expect(adapter.get("raw")).resolves.toBe("not-json");

    await expect(adapter.has("a")).resolves.toBe(true);
    await expect(adapter.has("missing")).resolves.toBe(false);

    const keys = await adapter.keys();
    expect(keys.sort()).toEqual(["a", "b", "raw"]);

    await expect(adapter.delete("missing")).resolves.toBe(false);
    await expect(adapter.delete("a")).resolves.toBe(true);
    await expect(adapter.has("a")).resolves.toBe(false);

    const usage = await adapter.getUsage();
    expect(usage.used).toBeGreaterThan(0);
    expect(usage.quota).toBe(5 * 1024 * 1024);

    await adapter.clear();
    await expect(adapter.keys()).resolves.toEqual([]);
  });

  it("LocalStorageAdapter.getUsage returns zero usage for empty storage", async () => {
    vi.stubGlobal("localStorage", createLocalStorageMock());

    const adapter = new LocalStorageAdapter({ prefix: "pb_" });
    await expect(adapter.getUsage()).resolves.toEqual({ used: 0, quota: 5 * 1024 * 1024 });
  });

  it("IndexedDbStorageAdapter supports CRUD + keys + clear + close (fake-indexeddb)", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB);

    const adapter = new IndexedDbStorageAdapter({ dbName: "pb_test_db", storeName: "kv" });
    expect(adapter.backend).toBe(StorageBackend.INDEXEDDB);

    await expect(adapter.get("missing")).resolves.toBe(undefined);
    await adapter.set("k1", { a: 1 });
    await adapter.set("k2", "v2");

    await expect(adapter.get("k1")).resolves.toEqual({ a: 1 });
    await expect(adapter.has("k1")).resolves.toBe(true);
    await expect(adapter.has("missing")).resolves.toBe(false);

    const keys = await adapter.keys();
    expect(keys.sort()).toEqual(["k1", "k2"]);

    await expect(adapter.delete("k2")).resolves.toBe(true);
    await expect(adapter.get("k2")).resolves.toBe(undefined);

    await adapter.clear();
    await expect(adapter.keys()).resolves.toEqual([]);

    vi.stubGlobal("navigator", { storage: { estimate: vi.fn(async () => ({ usage: 1, quota: 2 })) } });
    await expect(adapter.getUsage()).resolves.toEqual({ used: 1, quota: 2 });

    // close() should reset cached handle and allow reopening.
    adapter.close();
    await adapter.set("k3", 3);
    await expect(adapter.get("k3")).resolves.toBe(3);
  });

  it("IndexedDbStorageAdapter rejects when indexedDB.open errors", async () => {
    const openError = new Error("open failed");

    vi.stubGlobal("indexedDB", {
      open: () => {
        const request = {
          error: openError,
          onerror: null,
          onsuccess: null,
          onupgradeneeded: null,
        };
        setImmediate(() => request.onerror?.());
        return request;
      },
    });

    const adapter = new IndexedDbStorageAdapter({ dbName: "pb_fail_db", storeName: "kv" });
    await expect(adapter.get("k")).rejects.toBe(openError);
  });

  it("OpfsStorageAdapter round-trips values and supports keys/clear/usage", async () => {
    const root = createMockOpfsRoot();
    const estimate = vi.fn(async () => ({ usage: 12, quota: 34 }));
    const getDirectory = vi.fn(async () => root);

    vi.stubGlobal("navigator", {
      storage: {
        getDirectory,
        estimate,
      },
    });

    const adapter = new OpfsStorageAdapter({ rootDirName: "unit_test_root" });
    expect(adapter.backend).toBe(StorageBackend.OPFS);

    await expect(adapter.get("missing")).resolves.toBe(undefined);
    await expect(adapter.has("missing")).resolves.toBe(false);
    await expect(adapter.delete("missing")).resolves.toBe(false);

    const key1 = "a/b c%";
    await adapter.set(key1, { ok: true });
    await adapter.set("simple", [1, 2, 3]);

    // Root directory should be cached after the first operation.
    expect(getDirectory).toHaveBeenCalledTimes(1);

    await expect(adapter.get(key1)).resolves.toEqual({ ok: true });
    await expect(adapter.get("simple")).resolves.toEqual([1, 2, 3]);

    await expect(adapter.has(key1)).resolves.toBe(true);
    await expect(adapter.delete(key1)).resolves.toBe(true);
    await expect(adapter.has(key1)).resolves.toBe(false);

    const keys = await adapter.keys();
    expect(keys).toEqual(["simple"]);

    const usage = await adapter.getUsage();
    expect(usage).toEqual({ used: 12, quota: 34 });

    await adapter.clear();
    await expect(adapter.keys()).resolves.toEqual([]);
  });

  it("OpfsStorageAdapter encodes special characters in keys and decodes them back", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: vi.fn(async () => root) } });

    const adapter = new OpfsStorageAdapter({ rootDirName: "encode_test" });
    const key = "a/b c%";

    expect(adapter._keyToPath(key)).toBe("a_2Fb_20c_25");

    await adapter.set(key, "value");
    await expect(adapter.keys()).resolves.toEqual([key]);
  });

  it("OpfsStorageAdapter.getUsage returns zeros when navigator.storage.estimate is unavailable", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });

    const adapter = new OpfsStorageAdapter({ rootDirName: "no_estimate" });
    await expect(adapter.getUsage()).resolves.toEqual({ used: 0, quota: 0 });
  });

  it("createStorageAdapter selects OPFS when supported (and can skip it via preferOpfs=false)", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: vi.fn(async () => root) } });

    vi.stubGlobal("indexedDB", fakeIndexedDB);
    vi.stubGlobal("localStorage", createLocalStorageMock());

    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const a1 = await createStorageAdapter({ preferOpfs: true, silent: false });
    expect(a1).toBeInstanceOf(OpfsStorageAdapter);
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    const a2 = await createStorageAdapter({ preferOpfs: false, silent: true });
    expect(a2).toBeInstanceOf(IndexedDbStorageAdapter);

    await flushFakeIndexedDbEvents();
  });

  it("createStorageAdapter falls back to IndexedDB -> localStorage -> memory", async () => {
    // OPFS unavailable.
    vi.stubGlobal("navigator", { storage: {} });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // IndexedDB available.
    vi.stubGlobal("indexedDB", fakeIndexedDB);
    const a1 = await createStorageAdapter({ preferOpfs: true, silent: false });
    expect(a1).toBeInstanceOf(IndexedDbStorageAdapter);
    expect(warnSpy).toHaveBeenCalled();
    await flushFakeIndexedDbEvents();

    // IndexedDB unavailable -> localStorage
    vi.stubGlobal("indexedDB", { open: () => {
      throw new Error("no idb");
    } });
    vi.stubGlobal("localStorage", createLocalStorageMock());
    const a2 = await createStorageAdapter({ preferOpfs: true, silent: true });
    expect(a2).toBeInstanceOf(LocalStorageAdapter);

    // Neither available -> memory
    vi.stubGlobal("indexedDB", { open: () => {
      throw new Error("no idb");
    }, deleteDatabase: () => {} });
    vi.stubGlobal("localStorage", undefined);
    const a3 = await createStorageAdapter({ preferOpfs: true, silent: true });
    expect(a3).toBeInstanceOf(MemoryStorageAdapter);
  });

  it("createStorageAdapter emits warnings for localStorage and memory fallbacks when silent=false", async () => {
    // OPFS detection failure should be swallowed.
    vi.stubGlobal("navigator", { storage: { getDirectory: vi.fn(async () => {
      throw new Error("no opfs");
    }) } });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // IndexedDB unavailable -> localStorage (warn).
    vi.stubGlobal("indexedDB", { open: () => {
      throw new Error("no idb");
    }, deleteDatabase: () => {} });
    vi.stubGlobal("localStorage", createLocalStorageMock());

    const a1 = await createStorageAdapter({ preferOpfs: true, silent: false });
    expect(a1).toBeInstanceOf(LocalStorageAdapter);

    // localStorage unavailable -> memory (warn).
    vi.stubGlobal("localStorage", { setItem: () => {
      throw new Error("no ls");
    }, removeItem: () => {} });

    const a2 = await createStorageAdapter({ preferOpfs: true, silent: false });
    expect(a2).toBeInstanceOf(MemoryStorageAdapter);

    expect(warnSpy).toHaveBeenCalled();
  });

  it("createStorageAdapter stays silent when silent=true across fallback paths", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    vi.stubGlobal("navigator", { storage: { getDirectory: vi.fn(async () => {
      throw new Error("no opfs");
    }) } });
    vi.stubGlobal("indexedDB", fakeIndexedDB);
    vi.stubGlobal("localStorage", createLocalStorageMock());

    const a1 = await createStorageAdapter({ preferOpfs: true, silent: true });
    expect(a1).toBeInstanceOf(IndexedDbStorageAdapter);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    await flushFakeIndexedDbEvents();

    warnSpy.mockClear();
    infoSpy.mockClear();

    vi.stubGlobal("indexedDB", { open: () => {
      throw new Error("no idb");
    }, deleteDatabase: () => {} });
    vi.stubGlobal("localStorage", createLocalStorageMock());

    const a2 = await createStorageAdapter({ preferOpfs: true, silent: true });
    expect(a2).toBeInstanceOf(LocalStorageAdapter);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();

    vi.stubGlobal("localStorage", { setItem: () => {
      throw new Error("no ls");
    }, removeItem: () => {} });

    const a3 = await createStorageAdapter({ preferOpfs: true, silent: true });
    expect(a3).toBeInstanceOf(MemoryStorageAdapter);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("detectAvailableBackends returns OPFS/IndexedDB/localStorage when present (and always includes memory)", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: vi.fn(async () => root) } });
    vi.stubGlobal("indexedDB", fakeIndexedDB);
    vi.stubGlobal("localStorage", createLocalStorageMock());

    const backends = await detectAvailableBackends();
    expect(backends).toEqual([
      StorageBackend.OPFS,
      StorageBackend.INDEXEDDB,
      StorageBackend.LOCALSTORAGE,
      StorageBackend.MEMORY,
    ]);

    await flushFakeIndexedDbEvents();
  });

  it("detectAvailableBackends skips OPFS when detection throws", async () => {
    vi.stubGlobal("navigator", { storage: { getDirectory: vi.fn(async () => {
      throw new Error("no opfs");
    }) } });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);

    const backends = await detectAvailableBackends();
    expect(backends).toEqual([StorageBackend.MEMORY]);
  });
});
