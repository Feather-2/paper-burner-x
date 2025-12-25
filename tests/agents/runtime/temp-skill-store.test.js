import { describe, it, test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Mock IndexedDB for Node.js environment
const mockStore = new Map();
let mockDB = null;

function createMockIndexedDB() {
  const mockIndex = {
    getAll: (range) => ({
      result: [],
      onsuccess: null,
      onerror: null,
    }),
  };

  const mockObjectStore = {
    put: (record) => {
      mockStore.set(record.name, record);
      return { onsuccess: null, onerror: null };
    },
    get: (name) => {
      const req = { result: mockStore.get(name), onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
    getAll: () => {
      const req = { result: Array.from(mockStore.values()), onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
    delete: (name) => {
      mockStore.delete(name);
      return { onsuccess: null, onerror: null };
    },
    index: () => mockIndex,
  };

  const mockTransaction = {
    objectStore: () => mockObjectStore,
    oncomplete: null,
    onerror: null,
  };

  mockDB = {
    transaction: () => {
      const tx = { ...mockTransaction };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({ createIndex: () => {} }),
  };

  return {
    open: () => {
      const req = {
        result: mockDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };
}

// Setup global mock
globalThis.indexedDB = createMockIndexedDB();

// Import after mock setup
const { TempSkillStore } = await import("../../../js/agents/runtime/temp-skill-store.js");

beforeEach(() => {
  mockStore.clear();
});

test("TempSkillStore constructor sets default TTL", () => {
  const store = new TempSkillStore();
  assert.equal(store.defaultTTL, 24 * 60 * 60 * 1000);
});

test("TempSkillStore constructor accepts custom TTL", () => {
  const store = new TempSkillStore({ defaultTTL: 3600000 });
  assert.equal(store.defaultTTL, 3600000);
});

test("TempSkillStore.register throws without name", async () => {
  const store = new TempSkillStore();
  await assert.rejects(() => store.register({}), /must have a name/);
  await assert.rejects(() => store.register(null), /must have a name/);
});

test("TempSkillStore.register stores skill and returns name", async () => {
  const store = new TempSkillStore();
  const definition = { name: "test-skill", description: "Test" };

  const id = await store.register(definition);

  assert.equal(id, "test-skill");
  assert.ok(store.hasCapability("test-skill"));
});

test("TempSkillStore.register stores handler code", async () => {
  const store = new TempSkillStore();
  const definition = { name: "handler-skill", description: "With handler" };
  const handler = (ctx) => ctx.value * 2;

  await store.register(definition, handler);

  const record = mockStore.get("handler-skill");
  assert.equal(record.handlerType, "inline");
  assert.ok(record.handlerCode.includes("ctx.value * 2"));
});

test("TempSkillStore.register uses custom TTL", async () => {
  const store = new TempSkillStore({ defaultTTL: 1000 });
  const definition = { name: "custom-ttl", description: "Custom TTL" };

  const before = Date.now();
  await store.register(definition, null, { ttl: 5000 });
  const after = Date.now();

  const record = mockStore.get("custom-ttl");
  assert.equal(record.ttl, 5000);
  assert.ok(record.expiresAt >= before + 5000);
  assert.ok(record.expiresAt <= after + 5000);
});

test("TempSkillStore.get returns null for non-existent skill", async () => {
  const store = new TempSkillStore();
  const result = await store.get("non-existent");
  assert.equal(result, null);
});

test("TempSkillStore.get returns skill with definition and handler", async () => {
  const store = new TempSkillStore();
  const definition = { name: "get-test", description: "Get test" };
  const handler = () => "result";

  await store.register(definition, handler);
  const result = await store.get("get-test");

  assert.ok(result);
  assert.equal(result.definition.name, "get-test");
  assert.equal(typeof result.handler, "function");
});

test("TempSkillStore.get returns null for expired skill", async () => {
  const store = new TempSkillStore();

  // Manually insert expired record
  mockStore.set("expired-skill", {
    name: "expired-skill",
    definition: { name: "expired-skill" },
    handlerCode: null,
    handlerType: "none",
    createdAt: Date.now() - 10000,
    ttl: 1000,
    expiresAt: Date.now() - 5000, // Already expired
    exportedToNexus: false,
  });

  const result = await store.get("expired-skill");
  assert.equal(result, null);
});

test("TempSkillStore.list returns all valid skills", async () => {
  const store = new TempSkillStore();

  await store.register({ name: "skill-1", description: "First" });
  await store.register({ name: "skill-2", description: "Second" });

  const list = await store.list();

  assert.equal(list.length, 2);
  assert.ok(list.some((s) => s.name === "skill-1"));
  assert.ok(list.some((s) => s.name === "skill-2"));
});

test("TempSkillStore.list updates cache", async () => {
  const store = new TempSkillStore();

  await store.register({ name: "cache-test", description: "Cache" });
  store._cache.clear(); // Clear cache manually

  assert.equal(store.hasCapability("cache-test"), false);

  await store.list();

  assert.equal(store.hasCapability("cache-test"), true);
});

test("TempSkillStore.remove deletes skill", async () => {
  const store = new TempSkillStore();

  await store.register({ name: "to-remove", description: "Remove me" });
  assert.ok(store.hasCapability("to-remove"));

  const result = await store.remove("to-remove");

  assert.equal(result, true);
  assert.equal(store.hasCapability("to-remove"), false);
});

test("TempSkillStore.hasCapability uses memory cache", () => {
  const store = new TempSkillStore();

  store._cache.add("cached-skill");
  assert.equal(store.hasCapability("cached-skill"), true);
  assert.equal(store.hasCapability("not-cached"), false);
});

test("TempSkillStore.refreshCache calls list", async () => {
  const store = new TempSkillStore();

  await store.register({ name: "refresh-test", description: "Refresh" });
  store._cache.clear();

  await store.refreshCache();

  assert.ok(store._cacheReady);
  assert.ok(store.hasCapability("refresh-test"));
});

test("TempSkillStore.exportForNexus returns null for non-existent", async () => {
  const store = new TempSkillStore();
  const result = await store.exportForNexus("non-existent");
  assert.equal(result, null);
});

test("TempSkillStore.exportForNexus returns nexus-compatible format", async () => {
  const store = new TempSkillStore();
  await store.register({ name: "export-test", description: "Export me", priority: 5 });

  const exported = await store.exportForNexus("export-test");

  assert.ok(exported);
  assert.equal(exported.definition.name, "export-test");
  assert.equal(exported.definition.priority, 5);
  assert.equal(exported.definition.metadata.source, "nexus");
  assert.equal(exported.definition.metadata.originalSource, "temp");
  assert.ok(exported.definition.metadata.exportedAt);
});

test("TempSkillStore.markExported updates record", async () => {
  const store = new TempSkillStore();
  await store.register({ name: "mark-test", description: "Mark me" });

  const result = await store.markExported("mark-test");

  assert.equal(result, true);
  const record = mockStore.get("mark-test");
  assert.equal(record.exportedToNexus, true);
  assert.ok(record.exportedAt);
});

test("TempSkillStore.markExported returns false for non-existent", async () => {
  const store = new TempSkillStore();
  const result = await store.markExported("non-existent");
  assert.equal(result, false);
});

test("handler serialization handles non-function gracefully", async () => {
  const store = new TempSkillStore();
  await store.register({ name: "no-handler", description: "No handler" }, "not-a-function");

  const record = mockStore.get("no-handler");
  assert.equal(record.handlerType, "none");
  assert.equal(record.handlerCode, null);
});

test("definition metadata includes source and createdAt", async () => {
  const store = new TempSkillStore();
  await store.register({ name: "meta-test", description: "Metadata" });

  const record = mockStore.get("meta-test");
  assert.equal(record.definition.metadata.source, "temp");
  assert.ok(record.definition.metadata.createdAt);
});
