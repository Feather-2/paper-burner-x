
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  StorageBackend,
  StorageAdapter,
  MemoryStorageAdapter,
} from "../../js/agents/vfs/storage-adapter.js";

describe("vfs/storage-adapter", () => {
  describe("StorageBackend", () => {
    it("exports frozen constants", () => {
      expect(Object.isFrozen(StorageBackend)).toBe(true);
    });

    it("has OPFS backend", () => {
      expect(StorageBackend.OPFS).toBe("opfs");
    });

    it("has INDEXEDDB backend", () => {
      expect(StorageBackend.INDEXEDDB).toBe("indexeddb");
    });

    it("has LOCALSTORAGE backend", () => {
      expect(StorageBackend.LOCALSTORAGE).toBe("localstorage");
    });

    it("has MEMORY backend", () => {
      expect(StorageBackend.MEMORY).toBe("memory");
    });
  });

  describe("StorageAdapter", () => {
    it("is abstract base class", () => {
      const adapter = new StorageAdapter("test");
      expect(adapter.backend).toBe("test");
    });

    it("get throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await expect(() => adapter.get("key")).rejects.toThrow(/Not implemented/
      );
    });

    it("set throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await expect(() => adapter.set("key", "value"),
        /Not implemented/
      );
    });

    it("delete throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await expect(() => adapter.delete("key")).rejects.toThrow(/Not implemented/
      );
    });

    it("has throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await expect(() => adapter.has("key")).rejects.toThrow(/Not implemented/
      );
    });

    it("keys throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await expect(() => adapter.keys()).rejects.toThrow(/Not implemented/
      );
    });

    it("clear throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await expect(() => adapter.clear()).rejects.toThrow(/Not implemented/
      );
    });

    it("getUsage returns zeros", async () => {
      const adapter = new StorageAdapter("test");
      const usage = await adapter.getUsage();
      expect(usage).toEqual({ used: 0, quota: 0 });
    });
  });

  describe("MemoryStorageAdapter", () => {
    /** @type {MemoryStorageAdapter} */
    let adapter;

    beforeEach(() => {
      adapter = new MemoryStorageAdapter();
    });

    it("has memory backend", () => {
      expect(adapter.backend).toBe(StorageBackend.MEMORY);
    });

    describe("get/set", () => {
      it("stores and retrieves value", async () => {
        await adapter.set("key1", { data: "value" });
        const result = await adapter.get("key1");
        expect(result).toEqual({ data: "value" });
      });

      it("returns undefined for missing key", async () => {
        const result = await adapter.get("missing");
        expect(result).toBe(undefined);
      });

      it("overwrites existing key", async () => {
        await adapter.set("key1", "first");
        await adapter.set("key1", "second");
        const result = await adapter.get("key1");
        expect(result).toBe("second");
      });
    });

    describe("has", () => {
      it("returns true for existing key", async () => {
        await adapter.set("key1", "value");
        expect(await adapter.has("key1")).toBe(true);
      });

      it("returns false for missing key", async () => {
        expect(await adapter.has("missing")).toBe(false);
      });
    });

    describe("delete", () => {
      it("removes existing key", async () => {
        await adapter.set("key1", "value");
        const result = await adapter.delete("key1");
        expect(result).toBe(true);
        expect(await adapter.has("key1")).toBe(false);
      });

      it("returns false for missing key", async () => {
        const result = await adapter.delete("missing");
        expect(result).toBe(false);
      });
    });

    describe("keys", () => {
      it("returns all keys", async () => {
        await adapter.set("a", 1);
        await adapter.set("b", 2);
        await adapter.set("c", 3);
        const keys = await adapter.keys();
        expect(keys.sort()).toEqual(["a", "b", "c"]);
      });

      it("returns empty array when empty", async () => {
        const keys = await adapter.keys();
        expect(keys).toEqual([]);
      });
    });

    describe("clear", () => {
      it("removes all entries", async () => {
        await adapter.set("a", 1);
        await adapter.set("b", 2);
        await adapter.clear();
        const keys = await adapter.keys();
        expect(keys).toEqual([]);
      });
    });
  });
});
