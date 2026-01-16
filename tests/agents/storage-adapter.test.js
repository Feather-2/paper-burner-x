import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  StorageBackend,
  StorageAdapter,
  MemoryStorageAdapter,
} from "../../js/agents/vfs/storage-adapter.js";

describe("vfs/storage-adapter", () => {
  describe("StorageBackend", () => {
    it("exports frozen constants", () => {
      assert.ok(Object.isFrozen(StorageBackend));
    });

    it("has OPFS backend", () => {
      assert.equal(StorageBackend.OPFS, "opfs");
    });

    it("has INDEXEDDB backend", () => {
      assert.equal(StorageBackend.INDEXEDDB, "indexeddb");
    });

    it("has LOCALSTORAGE backend", () => {
      assert.equal(StorageBackend.LOCALSTORAGE, "localstorage");
    });

    it("has MEMORY backend", () => {
      assert.equal(StorageBackend.MEMORY, "memory");
    });
  });

  describe("StorageAdapter", () => {
    it("is abstract base class", () => {
      const adapter = new StorageAdapter("test");
      assert.equal(adapter.backend, "test");
    });

    it("get throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await assert.rejects(
        () => adapter.get("key"),
        /Not implemented/
      );
    });

    it("set throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await assert.rejects(
        () => adapter.set("key", "value"),
        /Not implemented/
      );
    });

    it("delete throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await assert.rejects(
        () => adapter.delete("key"),
        /Not implemented/
      );
    });

    it("has throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await assert.rejects(
        () => adapter.has("key"),
        /Not implemented/
      );
    });

    it("keys throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await assert.rejects(
        () => adapter.keys(),
        /Not implemented/
      );
    });

    it("clear throws not implemented", async () => {
      const adapter = new StorageAdapter("test");
      await assert.rejects(
        () => adapter.clear(),
        /Not implemented/
      );
    });

    it("getUsage returns zeros", async () => {
      const adapter = new StorageAdapter("test");
      const usage = await adapter.getUsage();
      assert.deepEqual(usage, { used: 0, quota: 0 });
    });
  });

  describe("MemoryStorageAdapter", () => {
    /** @type {MemoryStorageAdapter} */
    let adapter;

    beforeEach(() => {
      adapter = new MemoryStorageAdapter();
    });

    it("has memory backend", () => {
      assert.equal(adapter.backend, StorageBackend.MEMORY);
    });

    describe("get/set", () => {
      it("stores and retrieves value", async () => {
        await adapter.set("key1", { data: "value" });
        const result = await adapter.get("key1");
        assert.deepEqual(result, { data: "value" });
      });

      it("returns undefined for missing key", async () => {
        const result = await adapter.get("missing");
        assert.equal(result, undefined);
      });

      it("overwrites existing key", async () => {
        await adapter.set("key1", "first");
        await adapter.set("key1", "second");
        const result = await adapter.get("key1");
        assert.equal(result, "second");
      });
    });

    describe("has", () => {
      it("returns true for existing key", async () => {
        await adapter.set("key1", "value");
        assert.ok(await adapter.has("key1"));
      });

      it("returns false for missing key", async () => {
        assert.equal(await adapter.has("missing"), false);
      });
    });

    describe("delete", () => {
      it("removes existing key", async () => {
        await adapter.set("key1", "value");
        const result = await adapter.delete("key1");
        assert.ok(result);
        assert.equal(await adapter.has("key1"), false);
      });

      it("returns false for missing key", async () => {
        const result = await adapter.delete("missing");
        assert.equal(result, false);
      });
    });

    describe("keys", () => {
      it("returns all keys", async () => {
        await adapter.set("a", 1);
        await adapter.set("b", 2);
        await adapter.set("c", 3);
        const keys = await adapter.keys();
        assert.deepEqual(keys.sort(), ["a", "b", "c"]);
      });

      it("returns empty array when empty", async () => {
        const keys = await adapter.keys();
        assert.deepEqual(keys, []);
      });
    });

    describe("clear", () => {
      it("removes all entries", async () => {
        await adapter.set("a", 1);
        await adapter.set("b", 2);
        await adapter.clear();
        const keys = await adapter.keys();
        assert.deepEqual(keys, []);
      });
    });
  });
});
