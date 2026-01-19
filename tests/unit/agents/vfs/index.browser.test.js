import { afterEach, describe, expect, it, vi } from "vitest";

import { createVfs, MemoryVfs, OpfsVfs, StorageVfs } from '../../../../js/agents/vfs/index.browser.js';

import { createMockOpfsRoot } from "./opfs-mock.js";

function createAdapter() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      return store.delete(key);
    },
    async keys() {
      return Array.from(store.keys());
    },
    async clear() {
      store.clear();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agents/vfs/index.browser", () => {
  it("returns MemoryVfs for kind=memory/mem", async () => {
    const v1 = await createVfs({ kind: "memory" });
    expect(v1).toBeInstanceOf(MemoryVfs);

    const v2 = await createVfs({ kind: "mem" });
    expect(v2).toBeInstanceOf(MemoryVfs);
  });

  it("returns OpfsVfs for kind=opfs when OPFS is available and attaches storageAdapter", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });

    const providedAdapter = createAdapter();
    const vfs = await createVfs({ kind: "opfs", rootDirName: "r", storageAdapter: providedAdapter });

    expect(vfs).toBeInstanceOf(OpfsVfs);
    expect(/** @type {any} */ (vfs).storageAdapter).toBe(providedAdapter);
  });

  it("falls back to StorageVfs when OPFS creation fails", async () => {
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => {
      throw new Error("no opfs");
    } } });

    const providedAdapter = createAdapter();
    const vfs = await createVfs({ kind: "opfs", storageAdapter: providedAdapter, keyPrefix: "k:" });

    expect(vfs).toBeInstanceOf(StorageVfs);

    // Smoke: StorageVfs uses the provided adapter.
    await vfs.writeText("a.txt", "x");
    await expect(vfs.readText("a.txt")).resolves.toBe("x");
  });
});

