import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { AgentCheckpointStore } from "../../js/agents/runtime/checkpoints/agent-checkpoint-store.js";
import { MemoryVfs } from "../../js/agents/vfs/vfs.memory.js";

describe("runtime/checkpoints/agent-checkpoint-store", () => {
  /** @type {MemoryVfs} */
  let vfs;
  /** @type {AgentCheckpointStore} */
  let store;
  const runId = "test-run-123";

  beforeEach(() => {
    vfs = new MemoryVfs();
    store = new AgentCheckpointStore({ vfs, runId });
  });

  describe("constructor", () => {
    it("accepts vfs option", () => {
      const s = new AgentCheckpointStore({ vfs });
      assert.ok(s);
    });

    it("accepts runId option", () => {
      const s = new AgentCheckpointStore({ vfs, runId: "my-run" });
      assert.equal(s.runId, "my-run");
    });

    it("handles missing runId", () => {
      const s = new AgentCheckpointStore({ vfs });
      assert.equal(s.runId, null);
    });

    it("runId setter works", () => {
      store.runId = "new-run";
      assert.equal(store.runId, "new-run");
    });

    it("runId setter handles empty string", () => {
      store.runId = "";
      assert.equal(store.runId, null);
    });
  });

  describe("saveCheckpoint", () => {
    it("saves checkpoint and returns id", async () => {
      const result = await store.saveCheckpoint({
        messages: [{ role: "user", content: "Hello" }],
        toolCalls: [],
        results: [],
        metadata: { task: "test" },
        step: 1,
      });

      assert.ok(result.checkpointId);
      assert.ok(result.checkpointId.startsWith("ckpt"));
      assert.ok(result.checkpoint);
      assert.equal(result.checkpoint.runId, runId);
    });

    it("throws without runId", async () => {
      const s = new AgentCheckpointStore({ vfs });
      await assert.rejects(
        () => s.saveCheckpoint({ messages: [] }),
        /runId is required/
      );
    });

    it("accepts runId in options", async () => {
      const s = new AgentCheckpointStore({ vfs });
      const result = await s.saveCheckpoint({
        runId: "override-run",
        messages: [],
      });
      assert.equal(result.checkpoint.runId, "override-run");
    });

    it("stores messages array", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const result = await store.saveCheckpoint({ messages });
      assert.deepEqual(result.checkpoint.messages, messages);
    });

    it("stores toolCalls and results", async () => {
      const toolCalls = [{ id: "call1", name: "test" }];
      const results = [{ id: "call1", output: "done" }];
      const result = await store.saveCheckpoint({
        messages: [],
        toolCalls,
        results,
      });
      assert.deepEqual(result.checkpoint.toolCalls, toolCalls);
      assert.deepEqual(result.checkpoint.results, results);
    });

    it("stores step and iteration", async () => {
      const result = await store.saveCheckpoint({
        messages: [],
        step: 5,
        iteration: 10,
      });
      assert.equal(result.checkpoint.step, 5);
      assert.equal(result.checkpoint.iteration, 10);
    });

    it("handles missing arrays gracefully", async () => {
      const result = await store.saveCheckpoint({});
      assert.ok(Array.isArray(result.checkpoint.messages));
      assert.ok(Array.isArray(result.checkpoint.toolCalls));
      assert.ok(Array.isArray(result.checkpoint.results));
    });
  });

  describe("listCheckpoints", () => {
    it("returns empty array initially", async () => {
      const list = await store.listCheckpoints();
      assert.deepEqual(list, []);
    });

    it("returns saved checkpoints", async () => {
      await store.saveCheckpoint({ messages: [], step: 1 });
      await store.saveCheckpoint({ messages: [], step: 2 });

      const list = await store.listCheckpoints();
      assert.equal(list.length, 2);
    });

    it("includes checkpoint metadata", async () => {
      await store.saveCheckpoint({
        messages: [],
        step: 1,
        metadata: { label: "test" },
      });

      const list = await store.listCheckpoints();
      assert.equal(list[0].step, 1);
      assert.ok(list[0].checkpointId);
      assert.ok(list[0].ts);
    });

    it("accepts runId in options", async () => {
      await store.saveCheckpoint({ runId: "other-run", messages: [] });

      const list = await store.listCheckpoints({ runId: "other-run" });
      assert.equal(list.length, 1);
    });

    it("returns empty for unknown runId", async () => {
      const list = await store.listCheckpoints({ runId: "unknown" });
      assert.deepEqual(list, []);
    });
  });

  describe("loadCheckpoint", () => {
    it("loads latest checkpoint by default", async () => {
      await store.saveCheckpoint({ messages: [{ content: "first" }], step: 1 });
      await store.saveCheckpoint({ messages: [{ content: "second" }], step: 2 });

      const loaded = await store.loadCheckpoint();
      assert.equal(loaded.step, 2);
      assert.equal(loaded.messages[0].content, "second");
    });

    it("loads checkpoint by id", async () => {
      const { checkpointId } = await store.saveCheckpoint({
        messages: [{ content: "target" }],
        step: 1,
      });
      await store.saveCheckpoint({ messages: [{ content: "other" }], step: 2 });

      const loaded = await store.loadCheckpoint({ checkpointId });
      assert.equal(loaded.messages[0].content, "target");
    });

    it("loads checkpoint by step", async () => {
      await store.saveCheckpoint({ messages: [{ content: "step1" }], step: 1 });
      await store.saveCheckpoint({ messages: [{ content: "step2" }], step: 2 });
      await store.saveCheckpoint({ messages: [{ content: "step3" }], step: 3 });

      const loaded = await store.loadCheckpoint({ step: 2, mode: "step" });
      assert.equal(loaded.step, 2);
      assert.equal(loaded.messages[0].content, "step2");
    });

    it("returns null for missing checkpoint", async () => {
      const loaded = await store.loadCheckpoint({ checkpointId: "nonexistent" });
      assert.equal(loaded, null);
    });

    it("returns null for missing runId", async () => {
      const s = new AgentCheckpointStore({ vfs });
      const loaded = await s.loadCheckpoint();
      assert.equal(loaded, null);
    });

    it("returns null for empty index", async () => {
      const loaded = await store.loadCheckpoint();
      assert.equal(loaded, null);
    });

    it("handles mode=last", async () => {
      await store.saveCheckpoint({ messages: [{ content: "first" }] });
      await store.saveCheckpoint({ messages: [{ content: "last" }] });

      const loaded = await store.loadCheckpoint({ mode: "last" });
      assert.equal(loaded.messages[0].content, "last");
    });

    it("handles mode=latest", async () => {
      await store.saveCheckpoint({ messages: [{ content: "first" }] });
      await store.saveCheckpoint({ messages: [{ content: "latest" }] });

      const loaded = await store.loadCheckpoint({ mode: "latest" });
      assert.equal(loaded.messages[0].content, "latest");
    });
  });

  describe("concurrent operations", () => {
    it("handles concurrent saveCheckpoint calls", async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        store.saveCheckpoint({ messages: [], step: i })
      );

      const results = await Promise.all(promises);

      assert.equal(results.length, 5);
      const ids = results.map((r) => r.checkpointId);
      const uniqueIds = new Set(ids);
      assert.equal(uniqueIds.size, 5);

      const list = await store.listCheckpoints();
      assert.equal(list.length, 5);
    });
  });

  describe("error handling", () => {
    it("throws without vfs", async () => {
      const s = new AgentCheckpointStore({ runId: "test" });
      await assert.rejects(
        () => s.saveCheckpoint({ messages: [] }),
        /requires vfs/
      );
    });

    it("handles corrupted index gracefully", async () => {
      // Write invalid JSON to index
      const indexPath = ".agents/runs/test-run-123/checkpoints/index.json";
      await vfs.mkdir(".agents/runs/test-run-123/checkpoints", { recursive: true });
      await vfs.writeText(indexPath, "not valid json {{{");

      const list = await store.listCheckpoints();
      assert.deepEqual(list, []);
    });
  });
});
