import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { L3Storage } from "../../../../js/agents/runtime/memory/l3-storage.js";
import { MemoryVfs } from "../../../../js/agents/vfs/vfs.memory.js";

function getPaths(runId) {
  const basePath = `.agents/runs/${runId}/l3`;
  return {
    basePath,
    snapshotsDir: `${basePath}/snapshots`,
    checkpointsDir: `${basePath}/checkpoints`,
    indexPath: `${basePath}/index.json`,
    snapshotPath: (id) => `${basePath}/snapshots/${id}.json`,
    checkpointPath: (id) => `${basePath}/checkpoints/${id}.json`,
  };
}

function spyReadFile(vfs) {
  const calls = [];
  const original = vfs.readFile;
  vfs.readFile = async (path) => {
    calls.push(path);
    return await original.call(vfs, path);
  };
  return {
    calls,
    restore() {
      vfs.readFile = original;
    },
  };
}

describe("L3Storage", () => {
  it("validates constructor options (requires vfs and runId)", () => {
    assert.throws(() => new L3Storage(), /requires\s+\{\s*vfs\s*\}/i);
    assert.throws(() => new L3Storage({ vfs: new MemoryVfs() }), /requires\s+\{\s*runId\s*\}/i);

    assert.throws(() => new L3Storage({ vfs: {}, runId: "run_1" }), /vfs\.readFile/i);
    assert.throws(() => new L3Storage({ vfs: { readFile() {} }, runId: "run_1" }), /vfs\.writeFile/i);
    assert.throws(
      () => new L3Storage({ vfs: { readFile() {}, writeFile() {} }, runId: "run_1" }),
      /vfs\.mkdir/i
    );
  });

  it("init() creates directories and restores index", async () => {
    const runId = "run_init";
    const vfs = new MemoryVfs();
    const { snapshotsDir, checkpointsDir, indexPath } = getPaths(runId);

    const seededIndex = {
      schemaVersion: "0.1",
      runId,
      timeline: [{ id: "snap_1", ts: 123, summary: "seeded", stageKey: "stageA" }],
      keywords: [
        ["alpha", ["snap_1", "snap_2"]],
        ["beta", ["snap_2"]],
      ],
      stages: [["stageA", "snap_1"]],
      checkpointIndex: [
        { id: "ckpt_1", ts: 10, encoding: "json" },
        { id: "ckpt_2", ts: 20, baseId: "snap_1" },
      ],
    };

    await vfs.writeText(indexPath, JSON.stringify(seededIndex));

    assert.equal(await vfs.exists(snapshotsDir), false);
    assert.equal(await vfs.exists(checkpointsDir), false);

    const storage = new L3Storage({ vfs, runId });
    await storage.init();

    assert.equal(await vfs.exists(snapshotsDir), true);
    assert.equal(await vfs.exists(checkpointsDir), true);

    assert.deepEqual(storage.getTimeline(), seededIndex.timeline);
    assert.deepEqual(storage.searchByKeyword("ALPHA").sort(), ["snap_1", "snap_2"].sort());
    assert.deepEqual(await storage.listCheckpoints(), [
      { id: "ckpt_1", ts: 10, encoding: "json", baseId: null },
      { id: "ckpt_2", ts: 20, encoding: null, baseId: "snap_1" },
    ]);
  });

  it("archive() writes snapshot to VFS and updates index", async () => {
    const runId = "run_archive";
    const vfs = new MemoryVfs();
    const { indexPath, snapshotPath } = getPaths(runId);

    const storage = new L3Storage({ vfs, runId });
    const snapId = await storage.archive("stage1", { summary: "hello", value: 123 }, ["Alpha", "alpha", " Beta "]);

    assert.ok(typeof snapId === "string" && snapId.startsWith("snap_"));

    const entry = JSON.parse(await vfs.readText(snapshotPath(snapId)));
    assert.equal(entry.id, snapId);
    assert.equal(entry.runId, runId);
    assert.equal(entry.stageKey, "stage1");
    assert.deepEqual(entry.keywords, ["alpha", "beta"]);
    assert.equal(entry.summary, "hello");
    assert.deepEqual(entry.data, { summary: "hello", value: 123 });

    const index = JSON.parse(await vfs.readText(indexPath));
    assert.equal(index.runId, runId);
    assert.ok(Array.isArray(index.timeline) && index.timeline.some((e) => e?.id === snapId));

    const stages = new Map(Array.isArray(index.stages) ? index.stages : []);
    assert.equal(stages.get("stage1"), snapId);

    const keywords = new Map(Array.isArray(index.keywords) ? index.keywords : []);
    assert.deepEqual(new Set(keywords.get("alpha") || []), new Set([snapId]));
    assert.deepEqual(new Set(keywords.get("beta") || []), new Set([snapId]));
  });

  it("getSnapshot() returns from cache or VFS", async () => {
    const runId = "run_getSnapshot";
    const vfs = new MemoryVfs();
    const { snapshotPath } = getPaths(runId);

    const storage1 = new L3Storage({ vfs, runId });
    const snapId = await storage1.archive("stage1", { summary: "snap" }, ["k"]);

    const spy = spyReadFile(vfs);
    try {
      // cache-first: archive() populated the snapshot cache.
      const cached = await storage1.getSnapshot(snapId);
      assert.equal(cached?.id, snapId);
      assert.equal(spy.calls.length, 0);

      // new instance: forces VFS read, then caches.
      const storage2 = new L3Storage({ vfs, runId });
      const fromVfs = await storage2.getSnapshot(snapId);
      assert.equal(fromVfs?.id, snapId);
      assert.equal(spy.calls.filter((p) => p === snapshotPath(snapId)).length, 1);

      spy.calls.length = 0;
      const cachedAgain = await storage2.getSnapshot(snapId);
      assert.equal(cachedAgain?.id, snapId);
      assert.equal(spy.calls.length, 0);
    } finally {
      spy.restore();
    }
  });

  it("checkpoint() writes checkpoint to VFS", async () => {
    const runId = "run_checkpoint_write";
    const vfs = new MemoryVfs();
    const { indexPath, checkpointPath } = getPaths(runId);

    const storage = new L3Storage({ vfs, runId });
    const ckptId = await storage.checkpoint({
      id: "ckpt_fixed",
      ts: 123,
      encoding: "json",
      baseId: "snap_x",
      payload: { a: 1 },
    });

    assert.equal(ckptId, "ckpt_fixed");

    const checkpoint = JSON.parse(await vfs.readText(checkpointPath(ckptId)));
    assert.equal(checkpoint.id, ckptId);
    assert.equal(checkpoint.ts, 123);
    assert.equal(checkpoint.runId, runId);
    assert.equal(checkpoint.encoding, "json");
    assert.equal(checkpoint.baseId, "snap_x");
    assert.deepEqual(checkpoint.payload, { a: 1 });

    const index = JSON.parse(await vfs.readText(indexPath));
    assert.ok(Array.isArray(index.checkpointIndex));
    assert.equal(index.checkpointIndex[index.checkpointIndex.length - 1]?.id, ckptId);
  });

  it("getCheckpoint() returns from cache or VFS", async () => {
    const runId = "run_getCheckpoint";
    const vfs = new MemoryVfs();
    const { checkpointPath } = getPaths(runId);

    const storage1 = new L3Storage({ vfs, runId });
    const ckptId = await storage1.checkpoint({ id: "ckpt_1", ts: 1, payload: { ok: true } });

    const spy = spyReadFile(vfs);
    try {
      const cached = await storage1.getCheckpoint(ckptId);
      assert.equal(cached?.id, ckptId);
      assert.equal(spy.calls.length, 0);

      const storage2 = new L3Storage({ vfs, runId });
      const fromVfs = await storage2.getCheckpoint(ckptId);
      assert.equal(fromVfs?.id, ckptId);
      assert.equal(spy.calls.filter((p) => p === checkpointPath(ckptId)).length, 1);

      spy.calls.length = 0;
      const cachedAgain = await storage2.getCheckpoint(ckptId);
      assert.equal(cachedAgain?.id, ckptId);
      assert.equal(spy.calls.length, 0);
    } finally {
      spy.restore();
    }
  });

  it("getLatestCheckpoint() returns the most recent checkpoint", async () => {
    {
      const vfs = new MemoryVfs();
      const storage = new L3Storage({ vfs, runId: "run_latest_empty" });
      assert.equal(await storage.getLatestCheckpoint(), null);
    }

    const runId = "run_latest";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    await storage.checkpoint({ id: "ckpt_1", ts: 1, payload: { n: 1 } });
    await storage.checkpoint({ id: "ckpt_2", ts: 2, payload: { n: 2 } });

    const latest = await storage.getLatestCheckpoint();
    assert.equal(latest?.id, "ckpt_2");
    assert.equal(latest?.ts, 2);
    assert.deepEqual(latest?.payload, { n: 2 });
  });

  it("listCheckpoints() returns checkpoint metadata index", async () => {
    const runId = "run_listCheckpoints";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    await storage.checkpoint({ id: "ckpt_a", ts: 10, encoding: "json", baseId: "snap_1" });
    await storage.checkpoint({ id: "ckpt_b", ts: 20, encoding: "raw" });

    assert.deepEqual(await storage.listCheckpoints(), [
      { id: "ckpt_a", ts: 10, encoding: "json", baseId: "snap_1" },
      { id: "ckpt_b", ts: 20, encoding: "raw", baseId: null },
    ]);
  });

  it("getTimeline() returns timeline entries", async () => {
    const runId = "run_timeline";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const snapId1 = await storage.archive("stage1", { summary: "one" }, ["k1"]);
    const snapId2 = await storage.archive("stage2", { summary: "two" }, ["k2"]);

    const timeline1 = storage.getTimeline();
    assert.equal(timeline1.length, 2);
    assert.equal(timeline1[0]?.id, snapId1);
    assert.equal(timeline1[1]?.id, snapId2);

    timeline1[0].summary = "mutated";
    const timeline2 = storage.getTimeline();
    assert.equal(timeline2[0]?.summary, "one");
  });

  it("searchByKeyword() returns matching snapshot IDs", async () => {
    const runId = "run_keyword_search";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const snapId = await storage.archive("stage1", { summary: "hello" }, [" Alpha ", "beta", "BETA"]);

    assert.deepEqual(storage.searchByKeyword("alpha"), [snapId]);
    assert.deepEqual(storage.searchByKeyword("ALPHA"), [snapId]);
    assert.deepEqual(storage.searchByKeyword("beta"), [snapId]);
    assert.deepEqual(storage.searchByKeyword("missing"), []);
    assert.deepEqual(storage.searchByKeyword(" "), []);
  });

  it("dispose() persists index and clears caches", async () => {
    const runId = "run_dispose";
    const vfs = new MemoryVfs();
    const { indexPath } = getPaths(runId);

    const storage = new L3Storage({ vfs, runId });

    const snapId = await storage.archive("stage1", { summary: "snap" }, ["k"]);
    const ckptId = await storage.checkpoint({ id: "ckpt_1", ts: 1, payload: { ok: true } });

    assert.ok(storage._snapshotCache.size > 0);
    assert.ok(storage._checkpointCache.size > 0);

    // Add an unpersisted timeline entry to prove dispose() persists.
    storage._index.timeline.push({ id: "manual_entry", ts: 999, summary: "manual" });

    await storage.dispose();
    assert.equal(storage.disposed, true);
    assert.equal(storage._snapshotCache.size, 0);
    assert.equal(storage._checkpointCache.size, 0);

    const index = JSON.parse(await vfs.readText(indexPath));
    assert.ok(index.timeline.some((e) => e?.id === snapId));
    assert.ok(index.checkpointIndex.some((e) => e?.id === ckptId));
    assert.ok(index.timeline.some((e) => e?.id === "manual_entry"));

    await assert.rejects(async () => storage.getSnapshot(snapId), /disposed/i);
    await assert.rejects(async () => storage.getCheckpoint(ckptId), /disposed/i);
  });

  it("persistIndex() uses atomic write pattern", async () => {
    const runId = "run_atomic";
    const vfs = new MemoryVfs();
    const { indexPath } = getPaths(runId);
    const tempPath = indexPath + ".tmp";

    // Add rename support to test atomic path
    let renameCalledWith = null;
    vfs.rename = async (from, to) => {
      renameCalledWith = { from, to };
      // Use vfs.move internally (MemoryVfs has move method)
      await vfs.move(from, to);
    };

    const storage = new L3Storage({ vfs, runId });
    await storage.archive("stage1", { summary: "atomic test" }, ["k"]);

    // Verify rename was called with correct paths
    assert.ok(renameCalledWith !== null);
    assert.equal(renameCalledWith.from, tempPath);
    assert.equal(renameCalledWith.to, indexPath);

    // Verify temp file is cleaned up
    assert.equal(await vfs.exists(tempPath), false);

    // Verify index was persisted correctly
    const index = JSON.parse(await vfs.readText(indexPath));
    assert.ok(index.timeline.length > 0);
  });

  it("persistIndex() falls back when rename is not available", async () => {
    const runId = "run_fallback";
    const vfs = new MemoryVfs();
    const { indexPath } = getPaths(runId);
    const tempPath = indexPath + ".tmp";

    // MemoryVfs has unlink but not rename - use fallback path
    // Track unlink calls
    const originalUnlink = vfs.unlink.bind(vfs);
    let unlinkCalled = false;
    vfs.unlink = async (path) => {
      unlinkCalled = true;
      return originalUnlink(path);
    };

    const storage = new L3Storage({ vfs, runId });
    await storage.archive("stage1", { summary: "fallback test" }, ["k"]);

    // Verify unlink was called to clean up temp
    assert.ok(unlinkCalled);

    // Verify temp file is cleaned up
    assert.equal(await vfs.exists(tempPath), false);

    // Verify index was persisted correctly
    const index = JSON.parse(await vfs.readText(indexPath));
    assert.ok(index.timeline.length > 0);
  });

  it("restoreIndex() recovers from orphaned .tmp file", async () => {
    const runId = "run_recovery";
    const vfs = new MemoryVfs();
    const { basePath, indexPath } = getPaths(runId);
    const tempPath = indexPath + ".tmp";

    // Create directories first
    await vfs.mkdir(basePath, { recursive: true });

    // Simulate interrupted write: .tmp exists but index.json does not
    const orphanedIndex = {
      schemaVersion: "0.1",
      runId,
      updatedAt: Date.now(),
      timeline: [{ id: "snap_orphan", ts: 123, summary: "orphaned" }],
      keywords: [],
      stages: [],
      checkpointIndex: [],
    };
    await vfs.writeText(tempPath, JSON.stringify(orphanedIndex));

    // MemoryVfs already has unlink

    const storage = new L3Storage({ vfs, runId });
    await storage.init();

    // Verify recovery: timeline should have the orphaned entry
    const timeline = storage.getTimeline();
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].id, "snap_orphan");

    // Verify temp file is cleaned up after recovery
    assert.equal(await vfs.exists(tempPath), false);

    // Verify index.json now exists with recovered data
    const index = JSON.parse(await vfs.readText(indexPath));
    assert.equal(index.timeline[0].id, "snap_orphan");
  });

  it("restoreIndex() removes corrupted .tmp file", async () => {
    const runId = "run_corrupted_tmp";
    const vfs = new MemoryVfs();
    const { basePath, indexPath } = getPaths(runId);
    const tempPath = indexPath + ".tmp";

    // Create directories first
    await vfs.mkdir(basePath, { recursive: true });

    // Simulate corrupted temp file (invalid JSON)
    await vfs.writeText(tempPath, "not valid json {{{");

    // Also seed a valid index.json
    const validIndex = {
      schemaVersion: "0.1",
      runId,
      timeline: [{ id: "snap_valid", ts: 456, summary: "valid" }],
      keywords: [],
      stages: [],
      checkpointIndex: [],
    };
    await vfs.writeText(indexPath, JSON.stringify(validIndex));

    // MemoryVfs already has unlink

    const storage = new L3Storage({ vfs, runId });
    await storage.init();

    // Verify corrupted temp was removed
    assert.equal(await vfs.exists(tempPath), false);

    // Verify we loaded from the valid index.json
    const timeline = storage.getTimeline();
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].id, "snap_valid");
  });

  it("restoreIndex() recovers with rename support", async () => {
    const runId = "run_recovery_rename";
    const vfs = new MemoryVfs();
    const { basePath, indexPath } = getPaths(runId);
    const tempPath = indexPath + ".tmp";

    // Create directories first
    await vfs.mkdir(basePath, { recursive: true });

    // Simulate orphaned .tmp file
    const orphanedIndex = {
      schemaVersion: "0.1",
      runId,
      timeline: [{ id: "snap_rename", ts: 789, summary: "rename recovery" }],
      keywords: [],
      stages: [],
      checkpointIndex: [],
    };
    await vfs.writeText(tempPath, JSON.stringify(orphanedIndex));

    // Add rename support using vfs.move
    let renameCalledWith = null;
    vfs.rename = async (from, to) => {
      renameCalledWith = { from, to };
      await vfs.move(from, to);
    };

    const storage = new L3Storage({ vfs, runId });
    await storage.init();

    // Verify rename was used for recovery
    assert.ok(renameCalledWith !== null);
    assert.equal(renameCalledWith.from, tempPath);
    assert.equal(renameCalledWith.to, indexPath);

    // Verify recovery succeeded
    const timeline = storage.getTimeline();
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].id, "snap_rename");
  });

  it("archive() deduplicates identical content by default", async () => {
    const runId = "run_dedupe";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const data = { summary: "test data", value: 42 };
    const snapId1 = await storage.archive("stage1", data, ["k1"]);
    const snapId2 = await storage.archive("stage2", data, ["k2"]);

    // Should return the same ID (deduplicated)
    assert.equal(snapId1, snapId2);

    // getLastArchiveStats should indicate deduplication
    const stats = storage.getLastArchiveStats();
    assert.ok(stats !== null);
    assert.equal(stats.id, snapId1);
    assert.equal(stats.deduplicated, true);

    // Timeline should only have 1 entry (no duplicate)
    const timeline = storage.getTimeline();
    assert.equal(timeline.length, 1);
  });

  it("archive() creates new snapshot for different content", async () => {
    const runId = "run_no_dedupe";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const snapId1 = await storage.archive("stage1", { value: 1 }, ["k1"]);
    const snapId2 = await storage.archive("stage2", { value: 2 }, ["k2"]);

    // Should have different IDs
    assert.notEqual(snapId1, snapId2);

    // getLastArchiveStats should indicate no deduplication
    const stats = storage.getLastArchiveStats();
    assert.ok(stats !== null);
    assert.equal(stats.id, snapId2);
    assert.equal(stats.deduplicated, false);

    // Timeline should have 2 entries
    const timeline = storage.getTimeline();
    assert.equal(timeline.length, 2);
  });

  it("archive() with deduplicate=false forces new snapshot", async () => {
    const runId = "run_force_new";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const data = { summary: "same data" };
    const snapId1 = await storage.archive("stage1", data, ["k1"]);
    const snapId2 = await storage.archive("stage2", data, ["k2"], { deduplicate: false });

    // Should have different IDs even with same content
    assert.notEqual(snapId1, snapId2);

    // Timeline should have 2 entries
    const timeline = storage.getTimeline();
    assert.equal(timeline.length, 2);

    // Both should be retrievable
    const snap1 = await storage.getSnapshot(snapId1);
    const snap2 = await storage.getSnapshot(snapId2);
    assert.ok(snap1 !== null);
    assert.ok(snap2 !== null);
  });

  it("isDuplicate() checks without archiving", async () => {
    const runId = "run_is_duplicate";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const data = { value: "test" };

    // Before archiving, should not be duplicate
    const check1 = storage.isDuplicate(data);
    assert.equal(check1.duplicate, false);
    assert.equal(check1.existingId, undefined);

    // Archive the data
    const snapId = await storage.archive("stage1", data, []);

    // Now should be duplicate
    const check2 = storage.isDuplicate(data);
    assert.equal(check2.duplicate, true);
    assert.equal(check2.existingId, snapId);

    // Different data should not be duplicate
    const check3 = storage.isDuplicate({ value: "different" });
    assert.equal(check3.duplicate, false);
  });

  it("deduplicateByDefault=false disables deduplication globally", async () => {
    const runId = "run_no_default_dedupe";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId, deduplicateByDefault: false });

    const data = { summary: "test" };
    const snapId1 = await storage.archive("stage1", data, []);
    const snapId2 = await storage.archive("stage2", data, []);

    // Should create different snapshots (no deduplication)
    assert.notEqual(snapId1, snapId2);
    assert.equal(storage.getTimeline().length, 2);
  });

  it("hashIndex persists and restores correctly", async () => {
    const runId = "run_hash_persist";
    const vfs = new MemoryVfs();
    const { indexPath } = getPaths(runId);

    const storage1 = new L3Storage({ vfs, runId });
    const data = { value: "persist test" };
    const snapId = await storage1.archive("stage1", data, []);

    // Verify hashIndex is in persisted index
    const index = JSON.parse(await vfs.readText(indexPath));
    assert.ok(Array.isArray(index.hashIndex));
    assert.ok(index.hashIndex.length > 0);

    // Create new storage instance and verify deduplication still works
    const storage2 = new L3Storage({ vfs, runId });
    await storage2.init();
    const snapId2 = await storage2.archive("stage2", data, []);

    // Should deduplicate based on restored hashIndex
    assert.equal(snapId, snapId2);
    assert.equal(storage2.getLastArchiveStats().deduplicated, true);
  });

  it("getStorageStats() returns correct statistics", async () => {
    const runId = "run_stats";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId, maxSnapshots: 100, maxStorageBytes: 50000 });

    // Initially empty
    const stats0 = storage.getStorageStats();
    assert.equal(stats0.snapshotCount, 0);
    assert.equal(stats0.estimatedBytes, 0);
    assert.equal(stats0.maxSnapshots, 100);
    assert.equal(stats0.maxStorageBytes, 50000);

    // After archiving
    await storage.archive("stage1", { summary: "test data" }, []);
    await storage.waitForEviction();

    const stats1 = storage.getStorageStats();
    assert.equal(stats1.snapshotCount, 1);
    assert.ok(stats1.estimatedBytes > 0);
    assert.equal(stats1.maxSnapshots, 100);
  });

  it("LRU eviction triggers when maxSnapshots exceeded", async () => {
    const runId = "run_evict_count";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId, maxSnapshots: 3 });

    // Archive 5 snapshots with staggered timestamps
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const id = await storage.archive("stage" + i, { summary: "data" + i, n: i }, [], { deduplicate: false });
      ids.push(id);
      await new Promise((r) => setTimeout(r, 5)); // Stagger timestamps
    }

    // Wait for eviction to complete
    await storage.waitForEviction();

    // Should have exactly maxSnapshots entries
    const stats = storage.getStorageStats();
    assert.equal(stats.snapshotCount, 3);

    // Oldest 2 should be evicted (ids[0] and ids[1])
    const timeline = storage.getTimeline();
    const remainingIds = timeline.map((e) => e.id);
    assert.ok(!remainingIds.includes(ids[0]), "oldest should be evicted");
    assert.ok(!remainingIds.includes(ids[1]), "second oldest should be evicted");
    assert.ok(remainingIds.includes(ids[2]), "newer should remain");
    assert.ok(remainingIds.includes(ids[3]), "newer should remain");
    assert.ok(remainingIds.includes(ids[4]), "newest should remain");
  });

  it("LRU eviction respects accessedAt (recently accessed survives)", async () => {
    const runId = "run_evict_lru";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId, maxSnapshots: 2 });

    // Archive 2 snapshots with staggered timestamps
    const id1 = await storage.archive("stage1", { summary: "first", n: 1 }, [], { deduplicate: false });
    await storage.waitForEviction();
    await new Promise((r) => setTimeout(r, 20));

    const id2 = await storage.archive("stage2", { summary: "second", n: 2 }, [], { deduplicate: false });
    await storage.waitForEviction();
    await new Promise((r) => setTimeout(r, 20));

    // Access the first one to update its accessedAt (now it's newer than id2)
    await storage.getSnapshot(id1);
    await new Promise((r) => setTimeout(r, 20));

    // Archive a third snapshot - should evict id2 (older accessedAt) not id1
    const id3 = await storage.archive("stage3", { summary: "third", n: 3 }, [], { deduplicate: false });
    await storage.waitForEviction();

    const timeline = storage.getTimeline();
    const remainingIds = timeline.map((e) => e.id);

    assert.equal(timeline.length, 2, `expected 2 entries, got ${timeline.length}: ${remainingIds.join(", ")}`);
    assert.ok(remainingIds.includes(id1), `recently accessed (${id1}) should survive, remaining: ${remainingIds.join(", ")}`);
    assert.ok(remainingIds.includes(id3), `newest (${id3}) should survive, remaining: ${remainingIds.join(", ")}`);
    assert.ok(!remainingIds.includes(id2), `older accessed (${id2}) should be evicted, remaining: ${remainingIds.join(", ")}`);
  });

  it("LRU eviction triggers when maxStorageBytes exceeded", async () => {
    const runId = "run_evict_bytes";
    const vfs = new MemoryVfs();
    // Set a low byte limit (each entry is ~200 + summary_len * 2 bytes)
    const storage = new L3Storage({ vfs, runId, maxSnapshots: 1000, maxStorageBytes: 600 });

    // Archive multiple snapshots with moderate summaries
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const id = await storage.archive("stage" + i, { summary: "summary" + i }, [], { deduplicate: false });
      ids.push(id);
      await new Promise((r) => setTimeout(r, 5));
    }
    await storage.waitForEviction();

    // Should have fewer snapshots than archived due to byte limit
    const stats = storage.getStorageStats();
    assert.ok(stats.snapshotCount < 5, "some snapshots should be evicted");
    assert.ok(stats.estimatedBytes <= 600, "should be under byte limit");
  });

  it("l3:evicted event is emitted on eviction", async () => {
    const runId = "run_evict_event";
    const vfs = new MemoryVfs();

    const emittedEvents = [];
    const eventBus = {
      emit(name, data) {
        emittedEvents.push({ name, data });
      },
    };

    const storage = new L3Storage({ vfs, runId, maxSnapshots: 2, eventBus });

    // Archive 3 snapshots to trigger eviction
    await storage.archive("stage1", { summary: "a", n: 1 }, [], { deduplicate: false });
    await new Promise((r) => setTimeout(r, 5));
    await storage.archive("stage2", { summary: "b", n: 2 }, [], { deduplicate: false });
    await new Promise((r) => setTimeout(r, 5));
    await storage.archive("stage3", { summary: "c", n: 3 }, [], { deduplicate: false });
    await storage.waitForEviction();

    // Should have emitted l3:evicted event
    const evictedEvents = emittedEvents.filter((e) => e.name === "l3:evicted");
    assert.ok(evictedEvents.length > 0, "should emit l3:evicted event");

    const event = evictedEvents[evictedEvents.length - 1];
    assert.equal(event.data.runId, runId);
    assert.ok(Array.isArray(event.data.evictedIds), "should include evictedIds");
    assert.ok(event.data.evictedIds.length > 0, "should have evicted at least one");
    assert.ok(typeof event.data.count === "number", "should include count");
  });

  it("waitForEviction() awaits pending eviction", async () => {
    const runId = "run_wait_eviction";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId, maxSnapshots: 1 });

    // Archive 2 snapshots
    await storage.archive("stage1", { summary: "a" }, [], { deduplicate: false });
    await storage.archive("stage2", { summary: "b" }, [], { deduplicate: false });

    // Before waiting, eviction might not be complete
    await storage.waitForEviction();

    // After waiting, should have exactly 1 snapshot
    const stats = storage.getStorageStats();
    assert.equal(stats.snapshotCount, 1);
  });

  it("eviction removes VFS files", async () => {
    const runId = "run_evict_vfs";
    const vfs = new MemoryVfs();
    const { snapshotPath } = getPaths(runId);
    const storage = new L3Storage({ vfs, runId, maxSnapshots: 1 });

    // Archive 2 snapshots
    const id1 = await storage.archive("stage1", { summary: "first" }, [], { deduplicate: false });
    await new Promise((r) => setTimeout(r, 5));
    await storage.archive("stage2", { summary: "second" }, [], { deduplicate: false });
    await storage.waitForEviction();

    // Evicted snapshot file should be removed
    assert.equal(await vfs.exists(snapshotPath(id1)), false, "evicted file should be deleted");
  });

  it("eviction cleans up keyword and stage indexes", async () => {
    const runId = "run_evict_indexes";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId, maxSnapshots: 1 });

    // Archive with keywords
    const id1 = await storage.archive("myStage", { summary: "first" }, ["keyword1"], { deduplicate: false });
    await new Promise((r) => setTimeout(r, 5));
    await storage.archive("myStage", { summary: "second" }, ["keyword2"], { deduplicate: false });
    await storage.waitForEviction();

    // Evicted snapshot's keyword should be removed
    const keyword1Results = storage.searchByKeyword("keyword1");
    assert.ok(!keyword1Results.includes(id1), "evicted id should not appear in keyword search");
  });
});

