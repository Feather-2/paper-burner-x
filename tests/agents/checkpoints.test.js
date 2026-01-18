
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
      expect(s).toBeInstanceOf(AgentCheckpointStore);
    });

    it("accepts runId option", () => {
      const s = new AgentCheckpointStore({ vfs, runId: "my-run" });
      expect(s.runId).toBe("my-run");
    });

    it("handles missing runId", () => {
      const s = new AgentCheckpointStore({ vfs });
      expect(s.runId).toBe(null);
    });

    it("runId setter works", () => {
      store.runId = "new-run";
      expect(store.runId).toBe("new-run");
    });

    it("runId setter handles empty string", () => {
      store.runId = "";
      expect(store.runId).toBe(null);
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

      expect(result.checkpointId).toMatch(/^ckpt_[0-9a-z]+_[0-9a-f]{8,16}$/);
      expect(result.checkpointId.split("_")).toHaveLength(3);
      expect(result.checkpoint).toEqual(
        expect.objectContaining({ checkpointId: result.checkpointId })
      );
      expect(result.checkpoint.runId).toBe(runId);
    });

    it("throws without runId", async () => {
      const s = new AgentCheckpointStore({ vfs });
      await expect(() => s.saveCheckpoint({ messages: [] })).rejects.toThrow(/runId is required/
      );
    });

    it("accepts runId in options", async () => {
      const s = new AgentCheckpointStore({ vfs });
      const result = await s.saveCheckpoint({
        runId: "override-run",
        messages: [],
      });
      expect(result.checkpoint.runId).toBe("override-run");
    });

    it("stores messages array", async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const result = await store.saveCheckpoint({ messages });
      expect(result.checkpoint.messages).toEqual(messages);
    });

    it("stores toolCalls and results", async () => {
      const toolCalls = [{ id: "call1", name: "test" }];
      const results = [{ id: "call1", output: "done" }];
      const result = await store.saveCheckpoint({
        messages: [],
        toolCalls,
        results,
      });
      expect(result.checkpoint.toolCalls).toEqual(toolCalls);
      expect(result.checkpoint.results).toEqual(results);
    });

    it("stores step and iteration", async () => {
      const result = await store.saveCheckpoint({
        messages: [],
        step: 5,
        iteration: 10,
      });
      expect(result.checkpoint.step).toBe(5);
      expect(result.checkpoint.iteration).toBe(10);
    });

    it("handles missing arrays gracefully", async () => {
      const result = await store.saveCheckpoint({});
      expect(result.checkpoint.messages).toEqual([]);
      expect(result.checkpoint.toolCalls).toEqual([]);
      expect(result.checkpoint.results).toEqual([]);
    });
  });

  describe("listCheckpoints", () => {
    it("returns empty array initially", async () => {
      const list = await store.listCheckpoints();
      expect(list).toEqual([]);
    });

    it("returns saved checkpoints", async () => {
      await store.saveCheckpoint({ messages: [], step: 1 });
      await store.saveCheckpoint({ messages: [], step: 2 });

      const list = await store.listCheckpoints();
      expect(list.length).toBe(2);
    });

    it("includes checkpoint metadata", async () => {
      await store.saveCheckpoint({
        messages: [],
        step: 1,
        metadata: { label: "test" },
      });

      const list = await store.listCheckpoints();
      expect(list[0].step).toBe(1);
      expect(list[0].checkpointId).toMatch(/^ckpt_[0-9a-z]+_[0-9a-f]{8,16}$/);
      expect(list[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("accepts runId in options", async () => {
      await store.saveCheckpoint({ runId: "other-run", messages: [] });

      const list = await store.listCheckpoints({ runId: "other-run" });
      expect(list.length).toBe(1);
    });

    it("returns empty for unknown runId", async () => {
      const list = await store.listCheckpoints({ runId: "unknown" });
      expect(list).toEqual([]);
    });
  });

  describe("loadCheckpoint", () => {
    it("loads latest checkpoint by default", async () => {
      await store.saveCheckpoint({ messages: [{ content: "first" }], step: 1 });
      await store.saveCheckpoint({ messages: [{ content: "second" }], step: 2 });

      const loaded = await store.loadCheckpoint();
      expect(loaded.step).toBe(2);
      expect(loaded.messages[0].content).toBe("second");
    });

    it("loads checkpoint by id", async () => {
      const { checkpointId } = await store.saveCheckpoint({
        messages: [{ content: "target" }],
        step: 1,
      });
      await store.saveCheckpoint({ messages: [{ content: "other" }], step: 2 });

      const loaded = await store.loadCheckpoint({ checkpointId });
      expect(loaded.messages[0].content).toBe("target");
    });

    it("loads checkpoint by step", async () => {
      await store.saveCheckpoint({ messages: [{ content: "step1" }], step: 1 });
      await store.saveCheckpoint({ messages: [{ content: "step2" }], step: 2 });
      await store.saveCheckpoint({ messages: [{ content: "step3" }], step: 3 });

      const loaded = await store.loadCheckpoint({ step: 2, mode: "step" });
      expect(loaded.step).toBe(2);
      expect(loaded.messages[0].content).toBe("step2");
    });

    it("returns null for missing checkpoint", async () => {
      const loaded = await store.loadCheckpoint({ checkpointId: "nonexistent" });
      expect(loaded).toBe(null);
    });

    it("returns null for missing runId", async () => {
      const s = new AgentCheckpointStore({ vfs });
      const loaded = await s.loadCheckpoint();
      expect(loaded).toBe(null);
    });

    it("returns null for empty index", async () => {
      const loaded = await store.loadCheckpoint();
      expect(loaded).toBe(null);
    });

    it("handles mode=last", async () => {
      await store.saveCheckpoint({ messages: [{ content: "first" }] });
      await store.saveCheckpoint({ messages: [{ content: "last" }] });

      const loaded = await store.loadCheckpoint({ mode: "last" });
      expect(loaded.messages[0].content).toBe("last");
    });

    it("handles mode=latest", async () => {
      await store.saveCheckpoint({ messages: [{ content: "first" }] });
      await store.saveCheckpoint({ messages: [{ content: "latest" }] });

      const loaded = await store.loadCheckpoint({ mode: "latest" });
      expect(loaded.messages[0].content).toBe("latest");
    });
  });

  describe("concurrent operations", () => {
    it("handles concurrent saveCheckpoint calls", async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        store.saveCheckpoint({ messages: [], step: i })
      );

      const results = await Promise.all(promises);

      expect(results.length).toBe(5);
      const ids = results.map((r) => r.checkpointId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(5);

      const list = await store.listCheckpoints();
      expect(list.length).toBe(5);
    });
  });

  describe("error handling", () => {
    it("throws without vfs", async () => {
      const s = new AgentCheckpointStore({ runId: "test" });
      await expect(() => s.saveCheckpoint({ messages: [] })).rejects.toThrow(/requires vfs/
      );
    });

    it("handles corrupted index gracefully", async () => {
      // Write invalid JSON to index
      const indexPath = ".agents/runs/test-run-123/checkpoints/index.json";
      await vfs.mkdir(".agents/runs/test-run-123/checkpoints", { recursive: true });
      await vfs.writeText(indexPath, "not valid json {{{");

      const list = await store.listCheckpoints();
      expect(list).toEqual([]);
    });
  });
});
