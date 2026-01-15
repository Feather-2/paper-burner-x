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
});

