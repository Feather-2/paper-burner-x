const test = require("node:test");
const assert = require("node:assert/strict");

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadModule() {
  return import("../../../js/agents/shared/archive.js");
}

test("Archive.save: generates checkpointId {runId}:{timestamp}", async () => {
  const { Archive, MapAdapter } = await loadModule();
  const archive = new Archive(new MapAdapter());

  const before = Date.now();
  const checkpointId = await archive.save("run_123", { nodeStates: { a: 1 } });
  const after = Date.now();

  assert.match(checkpointId, /^run_123:\d+$/);
  const timestampPart = checkpointId.split(":")[1];
  assert.ok(timestampPart);
  const ts = Number(timestampPart);
  assert.ok(Number.isFinite(ts));
  assert.ok(ts >= before && ts <= after);

  const snapshot = await archive.load(checkpointId);
  assert.deepEqual(snapshot, {
    nodeStates: { a: 1 },
    timestamp: timestampPart,
    metadata: undefined,
  });

  const explicit = await archive.save("run_123", {
    nodeStates: { b: 2 },
    timestamp: "999",
    metadata: { ok: true },
  });
  assert.equal(explicit, "run_123:999");

  await assert.rejects(() => archive.save("", { nodeStates: {} }), /runId must be a non-empty string/);
  await assert.rejects(() => archive.save("run:bad", { nodeStates: {} }), /must not include ':'/);
});

test("Archive.load: missing key returns null", async () => {
  const { Archive, MapAdapter } = await loadModule();
  const archive = new Archive(new MapAdapter());

  assert.equal(await archive.load("run_missing"), null);
  assert.equal(await archive.load("run_missing:1"), null);

  await archive.save("run_present", { nodeStates: { a: 1 }, timestamp: "100" });
  await archive.save("run_present", { nodeStates: { a: 2 }, timestamp: "200" });
  const latest = await archive.load("run_present");
  assert.equal(latest?.timestamp, "200");
});

test("Archive.restore: returns full snapshot", async () => {
  const { Archive, MapAdapter } = await loadModule();
  const archive = new Archive(new MapAdapter());

  const checkpointId = await archive.save("run_restore", {
    nodeStates: { x: 1 },
    timestamp: "333",
    metadata: { source: "test" },
  });

  const restored = await archive.restore(checkpointId);
  assert.deepEqual(restored, {
    nodeStates: { x: 1 },
    timestamp: "333",
    metadata: { source: "test" },
  });

  await assert.rejects(() => archive.restore("run_restore:missing"), /Checkpoint not found/);
});

test("Archive.listCheckpoints: sorts by timestamp desc", async () => {
  const { Archive, MapAdapter } = await loadModule();
  const storage = new MapAdapter();
  const archive = new Archive(storage);

  await archive.save("run_sort", { nodeStates: { v: 1 }, timestamp: "100" });
  await archive.save("run_sort", { nodeStates: { v: 2 }, timestamp: "200" });
  await storage.set("run_sort:abc", { nodeStates: { v: 3 }, timestamp: "abc" });
  await storage.set("run_sort:zzz", { nodeStates: { v: 4 }, timestamp: "zzz" });

  const list = await archive.listCheckpoints("run_sort");
  assert.deepEqual(
    list.map((entry) => entry.checkpointId),
    ["run_sort:200", "run_sort:100", "run_sort:zzz", "run_sort:abc"],
  );
});

test("Archive.deleteOlderThan: deletes old snapshots", async () => {
  const { Archive, MapAdapter } = await loadModule();
  const storage = new MapAdapter();
  const archive = new Archive(storage);

  await assert.rejects(() => archive.deleteOlderThan(-1), /days must be a non-negative/);

  const now = Date.now();
  const oldTs = String(now - 8 * DAY_MS);
  const keepTs = String(now - 2 * DAY_MS);

  await archive.save("run_gc", { nodeStates: { old: true }, timestamp: oldTs });
  await archive.save("run_gc", { nodeStates: { keep: true }, timestamp: keepTs });
  await archive.save("run_gc", { nodeStates: { ignore: true }, timestamp: "bad_ts" });

  // Not a checkpoint id, should be ignored by deleteOlderThan
  await storage.set("misc", { ok: true });
  await storage.set("run_gc:", { nodeStates: { empty: true } });

  const deleted = await archive.deleteOlderThan(7);
  assert.equal(deleted, 1);

  assert.equal(await archive.load(`run_gc:${oldTs}`), null);
  assert.ok(await archive.load(`run_gc:${keepTs}`));
});

test("MapAdapter.keys: supports wildcard pattern", async () => {
  const { MapAdapter } = await loadModule();
  const storage = new MapAdapter();

  await storage.set("run_1:1", { ok: 1 });
  await storage.set("run_2:1", { ok: 2 });
  await storage.set("task_1:1", { ok: 3 });

  assert.deepEqual(await storage.keys("run_*"), ["run_1:1", "run_2:1"]);
  assert.deepEqual(await storage.keys(), ["run_1:1", "run_2:1", "task_1:1"]);
});

test("Archive: rejects invalid storage adapter", async () => {
  const { Archive } = await loadModule();
  assert.throws(() => new Archive({}), /must implement get\/set\/delete\/keys/);
});
