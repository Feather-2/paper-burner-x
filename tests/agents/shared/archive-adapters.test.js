const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

require("fake-indexeddb/auto");

function makeDbName(label) {
  return `ArchiveAdapterDB_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function deleteDatabase(dbName) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB deleteDatabase failed"));
    request.onblocked = () => resolve();
  });
}

async function loadAdapters() {
  return import("../../../js/agents/shared/archive-adapters.js");
}

async function loadArchive() {
  return import("../../../js/agents/shared/archive.js");
}

async function withTempDir(prefix, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function createMockRedisClient() {
  const store = new Map();
  const match = (pattern, key) => {
    const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
    return regex.test(String(key));
  };

  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async keys(pattern) {
      const matches = [];
      for (const key of store.keys()) {
        if (match(pattern, key)) matches.push(key);
      }
      matches.sort();
      return matches;
    },
  };
}

test("IndexedDBAdapter: basic CRUD", async () => {
  const { IndexedDBAdapter } = await loadAdapters();
  const dbName = makeDbName("crud");
  const storeName = "checkpoints";
  const adapter = new IndexedDBAdapter(dbName, storeName);

  assert.equal(await adapter.get("missing"), null);

  const value = { a: 1, b: { c: 2 } };
  assert.equal(await adapter.set("k1", value), true);
  assert.deepEqual(await adapter.get("k1"), value);

  assert.deepEqual(await adapter.keys(), ["k1"]);
  assert.equal(await adapter.delete("k1"), true);
  assert.equal(await adapter.get("k1"), null);
  assert.equal(await adapter.delete("k1"), false);

  const db = await adapter._getDb();
  db.close();
  await deleteDatabase(dbName);
});

test("IndexedDBAdapter: creates missing store via version upgrade", async () => {
  const { IndexedDBAdapter } = await loadAdapters();
  const dbName = makeDbName("upgrade");

  const a = new IndexedDBAdapter(dbName, "store_a");
  await a.set("a1", { ok: true });
  const dbA = await a._getDb();
  dbA.close();

  const b = new IndexedDBAdapter(dbName, "store_b");
  await b.set("b1", { ok: true });
  assert.deepEqual(await b.keys("b*"), ["b1"]);
  const dbB = await b._getDb();
  dbB.close();

  const a2 = new IndexedDBAdapter(dbName, "store_a");
  assert.deepEqual(await a2.get("a1"), { ok: true });

  const dbA2 = await a2._getDb();
  dbA2.close();
  await deleteDatabase(dbName);
});

test("RedisAdapter: basic CRUD", async () => {
  const { RedisAdapter } = await loadAdapters();
  const adapter = new RedisAdapter({ store: new Map() });

  assert.equal(await adapter.get("missing"), null);
  assert.equal(await adapter.set("k1", { a: 1 }), true);
  assert.deepEqual(await adapter.get("k1"), { a: 1 });
  assert.deepEqual(await adapter.keys(), ["k1"]);

  assert.equal(await adapter.delete("k1"), true);
  assert.equal(await adapter.get("k1"), null);
  assert.equal(await adapter.delete("k1"), false);
});

test("FileAdapter: basic CRUD", async () => {
  const { FileAdapter } = await loadAdapters();

  await withTempDir("ArchiveFileAdapter_crud_", async (dir) => {
    const adapter = new FileAdapter(dir);

    assert.equal(await adapter.get("missing"), null);
    assert.equal(await adapter.delete("missing"), false);
    assert.deepEqual(await adapter.keys("*"), []);

    const value = { a: 1, b: { c: 2 } };
    assert.equal(await adapter.set("k1", value), true);
    assert.deepEqual(await adapter.get("k1"), value);

    assert.equal(await adapter.set("run_1:ckpt_1", { ok: true }), true);
    assert.deepEqual(await adapter.keys("k*"), ["k1"]);
    assert.deepEqual(await adapter.keys("run_*"), ["run_1:ckpt_1"]);

    assert.equal(await adapter.delete("k1"), true);
    assert.equal(await adapter.get("k1"), null);
    assert.equal(await adapter.delete("k1"), false);
  });
});

test("FileAdapter: handles missing basePath and invalid JSON", async () => {
  const { FileAdapter } = await loadAdapters();

  await withTempDir("ArchiveFileAdapter_errors_", async (root) => {
    const missingDir = path.join(root, "missing");
    const adapter = new FileAdapter(missingDir);

    assert.deepEqual(await adapter.keys("*"), []);
    assert.equal(await adapter.get("missing"), null);
    assert.equal(await adapter.delete("missing"), false);

    await adapter.set("bad", { ok: true });
    await fs.writeFile(path.join(missingDir, "bad.json"), "{not-json", "utf8");

    await assert.rejects(adapter.get("bad"), (err) => {
      assert.match(err?.message, /Failed to parse JSON/);
      return true;
    });
  });
});

test("RedisAdapter: supports injected client", async () => {
  const { RedisAdapter } = await loadAdapters();
  const client = createMockRedisClient();
  const adapter = new RedisAdapter({ client, prefix: "pb:" });

  assert.equal(await adapter.get("missing"), null);
  assert.equal(await adapter.set("k1", { a: 1 }), true);
  assert.deepEqual(await adapter.get("k1"), { a: 1 });
  assert.deepEqual(await adapter.keys("k*"), ["k1"]);

  assert.equal(await adapter.delete("k1"), true);
  assert.equal(await adapter.get("k1"), null);
});

test("RedisAdapter injected client: invalid JSON", async () => {
  const { RedisAdapter } = await loadAdapters();
  const client = createMockRedisClient();
  const adapter = new RedisAdapter({ client, prefix: "pb:" });

  await client.set("pb:bad", "{broken");
  await assert.rejects(adapter.get("bad"), (err) => {
    assert.match(err?.message, /Failed to parse Redis JSON/);
    return true;
  });
});

test("keys(): supports wildcard matching", async () => {
  const { IndexedDBAdapter, RedisAdapter } = await loadAdapters();

  const dbName = makeDbName("keys");
  const idb = new IndexedDBAdapter(dbName, "checkpoints");
  const redis = new RedisAdapter({ store: new Map() });

  const keys = ["run_1:1", "run_2:1", "run_2:2", "task_1:1"];
  for (const key of keys) {
    await idb.set(key, { key });
    await redis.set(key, { key });
  }

  assert.deepEqual(await idb.keys("run_*"), ["run_1:1", "run_2:1", "run_2:2"]);
  assert.deepEqual(await redis.keys("run_*"), ["run_1:1", "run_2:1", "run_2:2"]);

  assert.deepEqual(await idb.keys("run_*:1"), ["run_1:1", "run_2:1"]);
  assert.deepEqual(await redis.keys("run_*:1"), ["run_1:1", "run_2:1"]);

  assert.deepEqual(await idb.keys("run_2:*"), ["run_2:1", "run_2:2"]);
  assert.deepEqual(await redis.keys("run_2:*"), ["run_2:1", "run_2:2"]);

  assert.deepEqual(await idb.keys("missing_*"), []);
  assert.deepEqual(await redis.keys("missing_*"), []);

  const db = await idb._getDb();
  db.close();
  await deleteDatabase(dbName);
});

test("Archive integrates with IndexedDBAdapter and RedisAdapter", async () => {
  const [{ Archive }, { IndexedDBAdapter, RedisAdapter, FileAdapter }] = await Promise.all([loadArchive(), loadAdapters()]);

  const dbName = makeDbName("archive");
  const archiveIdb = new Archive(new IndexedDBAdapter(dbName, "checkpoints"));

  const base = Date.now();
  const ts1 = String(base - 1000);
  const ts2 = String(base - 500);

  await archiveIdb.save("run_archive", { nodeStates: { a: 1 }, timestamp: ts1 });
  await archiveIdb.save("run_archive", { nodeStates: { a: 2 }, timestamp: ts2 });

  assert.equal((await archiveIdb.load("run_archive"))?.timestamp, ts2);
  assert.deepEqual(await archiveIdb.restore(`run_archive:${ts1}`), {
    nodeStates: { a: 1 },
    timestamp: ts1,
    metadata: undefined,
  });

  const listIdb = await archiveIdb.listCheckpoints("run_archive");
  assert.deepEqual(
    listIdb.map((entry) => entry.checkpointId),
    [`run_archive:${ts2}`, `run_archive:${ts1}`],
  );

  const now = Date.now();
  const oldTs = String(now - 8 * 24 * 60 * 60 * 1000);
  const keepTs = String(now - 2 * 24 * 60 * 60 * 1000);
  await archiveIdb.save("run_gc", { nodeStates: { old: true }, timestamp: oldTs });
  await archiveIdb.save("run_gc", { nodeStates: { keep: true }, timestamp: keepTs });
  assert.equal(await archiveIdb.deleteOlderThan(7), 1);
  assert.equal(await archiveIdb.load(`run_gc:${oldTs}`), null);
  assert.ok(await archiveIdb.load(`run_gc:${keepTs}`));

  const db = await archiveIdb.storage._getDb();
  db.close();
  await deleteDatabase(dbName);

  const archiveRedis = new Archive(new RedisAdapter({ store: new Map() }));

  await archiveRedis.save("run_archive", { nodeStates: { a: 1 }, timestamp: ts1 });
  await archiveRedis.save("run_archive", { nodeStates: { a: 2 }, timestamp: ts2 });

  assert.equal((await archiveRedis.load("run_archive"))?.timestamp, ts2);
  assert.deepEqual(await archiveRedis.restore(`run_archive:${ts1}`), {
    nodeStates: { a: 1 },
    timestamp: ts1,
    metadata: undefined,
  });

  const listRedis = await archiveRedis.listCheckpoints("run_archive");
  assert.deepEqual(
    listRedis.map((entry) => entry.checkpointId),
    [`run_archive:${ts2}`, `run_archive:${ts1}`],
  );

  await withTempDir("ArchiveFileAdapter_archive_", async (dir) => {
    const archiveFile = new Archive(new FileAdapter(dir));

    await archiveFile.save("run_archive", { nodeStates: { a: 1 }, timestamp: ts1 });
    await archiveFile.save("run_archive", { nodeStates: { a: 2 }, timestamp: ts2 });

    assert.equal((await archiveFile.load("run_archive"))?.timestamp, ts2);
    const list = await archiveFile.listCheckpoints("run_archive");
    assert.deepEqual(
      list.map((entry) => entry.checkpointId),
      [`run_archive:${ts2}`, `run_archive:${ts1}`],
    );
  });
});
