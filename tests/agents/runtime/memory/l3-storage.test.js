
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
    expect(() => new L3Storage()).toThrow(/requires\s+\{\s*vfs\s*\}/i);
    expect(() => new L3Storage({ vfs: new MemoryVfs().toThrow() }), /requires\s+\{\s*runId\s*\}/i);

    expect(() => new L3Storage({ vfs: {}, runId: "run_1" })).toThrow(/vfs\.readFile/i);
    expect(() => new L3Storage({ vfs: { readFile().toThrow() {} }, runId: "run_1" }), /vfs\.writeFile/i);
    expect(() => new L3Storage({ vfs: { readFile().toThrow() {}, writeFile() {} }, runId: "run_1" }),
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

    expect(await vfs.exists(snapshotsDir)).toBe(false);
    expect(await vfs.exists(checkpointsDir)).toBe(false);

    const storage = new L3Storage({ vfs, runId });
    await storage.init();

    expect(await vfs.exists(snapshotsDir)).toBe(true);
    expect(await vfs.exists(checkpointsDir)).toBe(true);

    expect(storage.getTimeline()).toEqual(seededIndex.timeline);
    expect(storage.searchByKeyword("ALPHA").sort()).toEqual(["snap_1", "snap_2"].sort());
    expect(await storage.listCheckpoints()).toEqual([
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

    expect(typeof snapId === "string" && snapId.startsWith("snap_")).toBeTruthy();

    const entry = JSON.parse(await vfs.readText(snapshotPath(snapId)));
    expect(entry.id).toBe(snapId);
    expect(entry.runId).toBe(runId);
    expect(entry.stageKey).toBe("stage1");
    expect(entry.keywords).toEqual(["alpha", "beta"]);
    expect(entry.summary).toBe("hello");
    expect(entry.data).toEqual({ summary: "hello", value: 123 });

    const index = JSON.parse(await vfs.readText(indexPath));
    expect(index.runId).toBe(runId);
    expect(Array.isArray(index.timeline).toBeTruthy() && index.timeline.some((e) => e?.id === snapId));

    const stages = new Map(Array.isArray(index.stages) ? index.stages : []);
    expect(stages.get("stage1")).toBe(snapId);

    const keywords = new Map(Array.isArray(index.keywords) ? index.keywords : []);
    expect(new Set(keywords.get("alpha") || [])).toEqual(new Set([snapId]));
    expect(new Set(keywords.get("beta") || [])).toEqual(new Set([snapId]));
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
      expect(cached?.id).toBe(snapId);
      expect(spy.calls.length).toBe(0);

      // new instance: forces VFS read, then caches.
      const storage2 = new L3Storage({ vfs, runId });
      const fromVfs = await storage2.getSnapshot(snapId);
      expect(fromVfs?.id).toBe(snapId);
      expect(spy.calls.filter((p) => p === snapshotPath(snapId)).length).toBe(1);

      spy.calls.length = 0;
      const cachedAgain = await storage2.getSnapshot(snapId);
      expect(cachedAgain?.id).toBe(snapId);
      expect(spy.calls.length).toBe(0);
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

    expect(ckptId).toBe("ckpt_fixed");

    const checkpoint = JSON.parse(await vfs.readText(checkpointPath(ckptId)));
    expect(checkpoint.id).toBe(ckptId);
    expect(checkpoint.ts).toBe(123);
    expect(checkpoint.runId).toBe(runId);
    expect(checkpoint.encoding).toBe("json");
    expect(checkpoint.baseId).toBe("snap_x");
    expect(checkpoint.payload).toEqual({ a: 1 });

    const index = JSON.parse(await vfs.readText(indexPath));
    expect(Array.isArray(index.checkpointIndex)).toBeTruthy();
    expect(index.checkpointIndex[index.checkpointIndex.length - 1]?.id).toBe(ckptId);
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
      expect(cached?.id).toBe(ckptId);
      expect(spy.calls.length).toBe(0);

      const storage2 = new L3Storage({ vfs, runId });
      const fromVfs = await storage2.getCheckpoint(ckptId);
      expect(fromVfs?.id).toBe(ckptId);
      expect(spy.calls.filter((p) => p === checkpointPath(ckptId)).length).toBe(1);

      spy.calls.length = 0;
      const cachedAgain = await storage2.getCheckpoint(ckptId);
      expect(cachedAgain?.id).toBe(ckptId);
      expect(spy.calls.length).toBe(0);
    } finally {
      spy.restore();
    }
  });

  it("getLatestCheckpoint() returns the most recent checkpoint", async () => {
    {
      const vfs = new MemoryVfs();
      const storage = new L3Storage({ vfs, runId: "run_latest_empty" });
      expect(await storage.getLatestCheckpoint()).toBe(null);
    }

    const runId = "run_latest";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    await storage.checkpoint({ id: "ckpt_1", ts: 1, payload: { n: 1 } });
    await storage.checkpoint({ id: "ckpt_2", ts: 2, payload: { n: 2 } });

    const latest = await storage.getLatestCheckpoint();
    expect(latest?.id).toBe("ckpt_2");
    expect(latest?.ts).toBe(2);
    expect(latest?.payload).toEqual({ n: 2 });
  });

  it("listCheckpoints() returns checkpoint metadata index", async () => {
    const runId = "run_listCheckpoints";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    await storage.checkpoint({ id: "ckpt_a", ts: 10, encoding: "json", baseId: "snap_1" });
    await storage.checkpoint({ id: "ckpt_b", ts: 20, encoding: "raw" });

    expect(await storage.listCheckpoints()).toEqual([
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
    expect(timeline1.length).toBe(2);
    expect(timeline1[0]?.id).toBe(snapId1);
    expect(timeline1[1]?.id).toBe(snapId2);

    timeline1[0].summary = "mutated";
    const timeline2 = storage.getTimeline();
    expect(timeline2[0]?.summary).toBe("one");
  });

  it("searchByKeyword() returns matching snapshot IDs", async () => {
    const runId = "run_keyword_search";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const snapId = await storage.archive("stage1", { summary: "hello" }, [" Alpha ", "beta", "BETA"]);

    expect(storage.searchByKeyword("alpha")).toEqual([snapId]);
    expect(storage.searchByKeyword("ALPHA")).toEqual([snapId]);
    expect(storage.searchByKeyword("beta")).toEqual([snapId]);
    expect(storage.searchByKeyword("missing")).toEqual([]);
    expect(storage.searchByKeyword(" ")).toEqual([]);
  });

  it("dispose() persists index and clears caches", async () => {
    const runId = "run_dispose";
    const vfs = new MemoryVfs();
    const { indexPath } = getPaths(runId);

    const storage = new L3Storage({ vfs, runId });

    const snapId = await storage.archive("stage1", { summary: "snap" }, ["k"]);
    const ckptId = await storage.checkpoint({ id: "ckpt_1", ts: 1, payload: { ok: true } });

    expect(storage._snapshotCache.size > 0).toBeTruthy();
    expect(storage._checkpointCache.size > 0).toBeTruthy();

    // Add an unpersisted timeline entry to prove dispose() persists.
    storage._index.timeline.push({ id: "manual_entry", ts: 999, summary: "manual" });

    await storage.dispose();
    expect(storage.disposed).toBe(true);
    expect(storage._snapshotCache.size).toBe(0);
    expect(storage._checkpointCache.size).toBe(0);

    const index = JSON.parse(await vfs.readText(indexPath));
    expect(index.timeline.some(e => e?.id === snapId)).toBeTruthy();
    expect(index.checkpointIndex.some(e => e?.id === ckptId)).toBeTruthy();
    expect(index.timeline.some(e => e?.id === "manual_entry")).toBeTruthy();

    await expect(async () => storage.getSnapshot(snapId), /disposed/i);
    await expect(async () => storage.getCheckpoint(ckptId), /disposed/i);
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
    expect(renameCalledWith !== null).toBeTruthy();
    expect(renameCalledWith.from).toBe(tempPath);
    expect(renameCalledWith.to).toBe(indexPath);

    // Verify temp file is cleaned up
    expect(await vfs.exists(tempPath)).toBe(false);

    // Verify index was persisted correctly
    const index = JSON.parse(await vfs.readText(indexPath));
    expect(index.timeline.length > 0).toBeTruthy();
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
    expect(unlinkCalled).toBeTruthy();

    // Verify temp file is cleaned up
    expect(await vfs.exists(tempPath)).toBe(false);

    // Verify index was persisted correctly
    const index = JSON.parse(await vfs.readText(indexPath));
    expect(index.timeline.length > 0).toBeTruthy();
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
    expect(timeline.length).toBe(1);
    expect(timeline[0].id).toBe("snap_orphan");

    // Verify temp file is cleaned up after recovery
    expect(await vfs.exists(tempPath)).toBe(false);

    // Verify index.json now exists with recovered data
    const index = JSON.parse(await vfs.readText(indexPath));
    expect(index.timeline[0].id).toBe("snap_orphan");
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
    expect(await vfs.exists(tempPath)).toBe(false);

    // Verify we loaded from the valid index.json
    const timeline = storage.getTimeline();
    expect(timeline.length).toBe(1);
    expect(timeline[0].id).toBe("snap_valid");
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
    expect(renameCalledWith !== null).toBeTruthy();
    expect(renameCalledWith.from).toBe(tempPath);
    expect(renameCalledWith.to).toBe(indexPath);

    // Verify recovery succeeded
    const timeline = storage.getTimeline();
    expect(timeline.length).toBe(1);
    expect(timeline[0].id).toBe("snap_rename");
  });

  it("archive() deduplicates identical content by default", async () => {
    const runId = "run_dedupe";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const data = { summary: "test data", value: 42 };
    const snapId1 = await storage.archive("stage1", data, ["k1"]);
    const snapId2 = await storage.archive("stage2", data, ["k2"]);

    // Should return the same ID (deduplicated)
    expect(snapId1).toBe(snapId2);

    // getLastArchiveStats should indicate deduplication
    const stats = storage.getLastArchiveStats();
    expect(stats !== null).toBeTruthy();
    expect(stats.id).toBe(snapId1);
    expect(stats.deduplicated).toBe(true);

    // Timeline should only have 1 entry (no duplicate)
    const timeline = storage.getTimeline();
    expect(timeline.length).toBe(1);
  });

  it("archive() creates new snapshot for different content", async () => {
    const runId = "run_no_dedupe";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const snapId1 = await storage.archive("stage1", { value: 1 }, ["k1"]);
    const snapId2 = await storage.archive("stage2", { value: 2 }, ["k2"]);

    // Should have different IDs
    expect(snapId1).not.toBe(snapId2);

    // getLastArchiveStats should indicate no deduplication
    const stats = storage.getLastArchiveStats();
    expect(stats !== null).toBeTruthy();
    expect(stats.id).toBe(snapId2);
    expect(stats.deduplicated).toBe(false);

    // Timeline should have 2 entries
    const timeline = storage.getTimeline();
    expect(timeline.length).toBe(2);
  });

  it("archive() with deduplicate=false forces new snapshot", async () => {
    const runId = "run_force_new";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const data = { summary: "same data" };
    const snapId1 = await storage.archive("stage1", data, ["k1"]);
    const snapId2 = await storage.archive("stage2", data, ["k2"], { deduplicate: false });

    // Should have different IDs even with same content
    expect(snapId1).not.toBe(snapId2);

    // Timeline should have 2 entries
    const timeline = storage.getTimeline();
    expect(timeline.length).toBe(2);

    // Both should be retrievable
    const snap1 = await storage.getSnapshot(snapId1);
    const snap2 = await storage.getSnapshot(snapId2);
    expect(snap1 !== null).toBeTruthy();
    expect(snap2 !== null).toBeTruthy();
  });

  it("isDuplicate() checks without archiving", async () => {
    const runId = "run_is_duplicate";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId });

    const data = { value: "test" };

    // Before archiving, should not be duplicate
    const check1 = storage.isDuplicate(data);
    expect(check1.duplicate).toBe(false);
    expect(check1.existingId).toBe(undefined);

    // Archive the data
    const snapId = await storage.archive("stage1", data, []);

    // Now should be duplicate
    const check2 = storage.isDuplicate(data);
    expect(check2.duplicate).toBe(true);
    expect(check2.existingId).toBe(snapId);

    // Different data should not be duplicate
    const check3 = storage.isDuplicate({ value: "different" });
    expect(check3.duplicate).toBe(false);
  });

  it("deduplicateByDefault=false disables deduplication globally", async () => {
    const runId = "run_no_default_dedupe";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId, deduplicateByDefault: false });

    const data = { summary: "test" };
    const snapId1 = await storage.archive("stage1", data, []);
    const snapId2 = await storage.archive("stage2", data, []);

    // Should create different snapshots (no deduplication)
    expect(snapId1).not.toBe(snapId2);
    expect(storage.getTimeline().length).toBe(2);
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
    expect(Array.isArray(index.hashIndex)).toBeTruthy();
    expect(index.hashIndex.length > 0).toBeTruthy();

    // Create new storage instance and verify deduplication still works
    const storage2 = new L3Storage({ vfs, runId });
    await storage2.init();
    const snapId2 = await storage2.archive("stage2", data, []);

    // Should deduplicate based on restored hashIndex
    expect(snapId).toBe(snapId2);
    expect(storage2.getLastArchiveStats().deduplicated).toBe(true);
  });

  it("getStorageStats() returns correct statistics", async () => {
    const runId = "run_stats";
    const vfs = new MemoryVfs();
    const storage = new L3Storage({ vfs, runId, maxSnapshots: 100, maxStorageBytes: 50000 });

    // Initially empty
    const stats0 = storage.getStorageStats();
    expect(stats0.snapshotCount).toBe(0);
    expect(stats0.estimatedBytes).toBe(0);
    expect(stats0.maxSnapshots).toBe(100);
    expect(stats0.maxStorageBytes).toBe(50000);

    // After archiving
    await storage.archive("stage1", { summary: "test data" }, []);
    await storage.waitForEviction();

    const stats1 = storage.getStorageStats();
    expect(stats1.snapshotCount).toBe(1);
    expect(stats1.estimatedBytes > 0).toBeTruthy();
    expect(stats1.maxSnapshots).toBe(100);
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
    expect(stats.snapshotCount).toBe(3);

    // Oldest 2 should be evicted (ids[0] and ids[1])
    const timeline = storage.getTimeline();
    const remainingIds = timeline.map((e) => e.id);
    expect(!remainingIds.includes(ids[0])).toBeTruthy();
    expect(!remainingIds.includes(ids[1])).toBeTruthy();
    expect(remainingIds.includes(ids[2])).toBeTruthy();
    expect(remainingIds.includes(ids[3])).toBeTruthy();
    expect(remainingIds.includes(ids[4])).toBeTruthy();
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

    expect(timeline.length).toBe(2, `expected 2 entries, got ${timeline.length}: ${remainingIds.join(", ")}`);
    expect(remainingIds.includes(id1).toBeTruthy(), `recently accessed (${id1}) should survive, remaining: ${remainingIds.join(", ")}`);
    expect(remainingIds.includes(id3).toBeTruthy(), `newest (${id3}) should survive, remaining: ${remainingIds.join(", ")}`);
    expect(!remainingIds.includes(id2)).toBeTruthy(); // `older accessed (${id2}) should be evicted, remaining: ${remainingIds.join(", ")}`);
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
    expect(stats.snapshotCount < 5, "some snapshots should be evicted").toBeTruthy();
    expect(stats.estimatedBytes <= 600, "should be under byte limit").toBeTruthy();
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
    expect(evictedEvents.length > 0, "should emit l3:evicted event").toBeTruthy();

    const event = evictedEvents[evictedEvents.length - 1];
    expect(event.data.runId).toBe(runId);
    expect(Array.isArray(event.data.evictedIds).toBeTruthy(), "should include evictedIds");
    expect(event.data.evictedIds.length > 0, "should have evicted at least one").toBeTruthy();
    expect(typeof event.data.count === "number", "should include count").toBeTruthy();
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
    expect(stats.snapshotCount).toBe(1);
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
    expect(await vfs.exists(snapshotPath(id1))).toBe(false, "evicted file should be deleted");
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
    expect(!keyword1Results.includes(id1)).toBeTruthy();
  });
});

