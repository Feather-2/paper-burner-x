import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { MemoryStore } from "../../../js/agents/runtime/memory/memory-store.js";

describe("MemoryStore", () => {
  let store;

  beforeEach(() => {
    store = new MemoryStore({ runId: "test_run" });
  });

  describe("L0: Immutable", () => {
    it("should set and get system prompt", () => {
      store.setSystemPrompt("You are a helpful assistant.");
      assert.strictEqual(store.L0.systemPrompt, "You are a helpful assistant.");
    });

    it("should set and get task goal", () => {
      store.setTaskGoal("Analyze documents");
      assert.strictEqual(store.L0.taskGoal, "Analyze documents");
    });

    it("should add, update, and remove todos", () => {
      const todo = store.addTodo({ content: "Read doc A" });
      assert.ok(todo.id);
      assert.strictEqual(todo.content, "Read doc A");
      assert.strictEqual(todo.status, "pending");

      store.updateTodo(todo.id, { status: "done" });
      assert.strictEqual(store.L0.todos[0].status, "done");

      const removed = store.removeTodo(todo.id);
      assert.strictEqual(removed.id, todo.id);
      assert.strictEqual(store.L0.todos.length, 0);
    });

    it("should filter todos by status", () => {
      store.addTodo({ content: "Task 1", status: "pending" });
      store.addTodo({ content: "Task 2", status: "done" });
      store.addTodo({ content: "Task 3", status: "pending" });

      const pending = store.getTodos("pending");
      assert.strictEqual(pending.length, 2);

      const done = store.getTodos("done");
      assert.strictEqual(done.length, 1);
    });
  });

  describe("L1: Working", () => {
    it("should add and get messages", () => {
      store.addMessage({ role: "user", content: "Hello" });
      store.addMessage({ role: "assistant", content: "Hi there" });

      const messages = store.getMessages();
      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[0].content, "Hello");
    });

    it("should add and acknowledge signals", () => {
      const sig = store.addSignal({ type: "discovery", message: "Found conflict" });
      assert.ok(sig.id);
      assert.strictEqual(sig.acknowledged, false);

      store.acknowledgeSignal(sig.id);
      assert.strictEqual(store.L1.signals[0].acknowledged, true);

      const pending = store.getSignals("pending");
      assert.strictEqual(pending.length, 0);
    });

    it("should record decisions", () => {
      store.recordDecision({ action: "read-doc", reason: "Need more info" });
      store.recordDecision({ action: "search", reason: "Find Q3 data" });

      const decisions = store.getDecisions(2);
      assert.strictEqual(decisions.length, 2);
      assert.strictEqual(decisions[1].action, "search");
    });
  });

  describe("L1: SyncTable", () => {
    it("should sync discoveries across subagents", () => {
      store.syncDiscovery("gap_001", {
        status: "open",
        keywords: ["Q3", "revenue"],
        by: "subagent_A",
      });

      const discovery = store.getDiscovery("gap_001");
      assert.strictEqual(discovery.status, "open");
      assert.deepStrictEqual(discovery.keywords, ["Q3", "revenue"]);

      // Update from another subagent
      store.syncDiscovery("gap_001", {
        status: "satisfied",
        by: "subagent_B",
      });

      const updated = store.getDiscovery("gap_001");
      assert.strictEqual(updated.status, "satisfied");
      assert.strictEqual(updated.by, "subagent_B");
    });

    it("should sync subagent status", () => {
      store.syncSubagent("sub_001", { status: "running", progress: 50 });

      const sub = store.getSubagent("sub_001");
      assert.strictEqual(sub.status, "running");
      assert.strictEqual(sub.progress, 50);

      store.syncSubagent("sub_001", { status: "completed", progress: 100 });
      assert.strictEqual(store.getSubagent("sub_001").status, "completed");
    });

    it("should list all discoveries and subagents", () => {
      store.syncDiscovery("gap_001", { status: "open" });
      store.syncDiscovery("gap_002", { status: "satisfied" });
      store.syncSubagent("sub_001", { status: "running" });

      assert.strictEqual(store.getAllDiscoveries().length, 2);
      assert.strictEqual(store.getAllSubagents().length, 1);
    });
  });

  describe("L2: Condensed", () => {
    it("should set and get stage summaries", () => {
      store.setStageSummary("scan", "Found 8 documents");
      store.setStageSummary("analyze", "Q3 revenue is 120B");

      assert.strictEqual(store.getStageSummary("scan"), "Found 8 documents");

      const all = store.getAllStageSummaries();
      assert.strictEqual(Object.keys(all).length, 2);
    });

    it("should add and filter claims", () => {
      store.addClaim({ content: "Q3 revenue is 120B", source: "Report A" });
      store.addClaim({ content: "Market share increased", verified: true });

      const verified = store.getClaims(c => c.verified);
      assert.strictEqual(verified.length, 1);
    });
  });

  describe("L3: Archive", () => {
    it("should archive and recall by keywords", () => {
      store.archive("read_reportA", { content: "Q3 revenue analysis" }, ["Q3", "revenue"]);
      store.archive("read_reportB", { content: "Market share data" }, ["market", "share"]);

      const results = store.recall("Q3 revenue");
      assert.strictEqual(results.length, 1);
      assert.ok(results[0].data.content.includes("Q3"));
    });

    it("should list archives", () => {
      store.archive("stage1", { data: "test1" });
      store.archive("stage2", { data: "test2" });

      const list = store.listArchives();
      assert.strictEqual(list.length, 2);
    });
  });

  describe("Checkpoint", () => {
    it("should checkpoint and restore state", () => {
      store.setTaskGoal("Original goal");
      store.addTodo({ content: "Task 1" });
      store.addMessage({ role: "user", content: "Hello" });

      const ckptId = store.checkpoint();
      assert.ok(ckptId);

      // Modify state
      store.setTaskGoal("Modified goal");
      store.addTodo({ content: "Task 2" });
      store.addMessage({ role: "user", content: "World" });

      assert.strictEqual(store.L0.taskGoal, "Modified goal");
      assert.strictEqual(store.L0.todos.length, 2);
      assert.strictEqual(store.L1.messages.length, 2);

      // Restore
      const restored = store.restore(ckptId);
      assert.strictEqual(restored, true);
      assert.strictEqual(store.L0.taskGoal, "Original goal");
      assert.strictEqual(store.L0.todos.length, 1);
      assert.strictEqual(store.L1.messages.length, 1);
    });
  });

  describe("Compression", () => {
    it("should compress old messages", () => {
      // Add many messages
      for (let i = 0; i < 20; i++) {
        store.addMessage({ role: "user", content: `Message ${i}` });
        store.addMessage({ role: "assistant", content: `Response ${i}` });
      }

      const beforeCount = store.L1.messages.length;
      store.compress();
      const afterCount = store.L1.messages.length;

      assert.ok(afterCount < beforeCount);
      assert.ok(store.L2.historySummary.length > 0);
    });
  });

  describe("buildPromptContext", () => {
    it("should build context with all layers", () => {
      store.setTaskGoal("Analyze Q3 reports");
      store.addTodo({ content: "Read Report A", status: "done" });
      store.addTodo({ content: "Read Report B", status: "pending" });
      store.setStageSummary("scan", "Found 3 reports");
      store.syncDiscovery("gap_001", { status: "open", keywords: ["Q3"] });
      store.addSignal({ type: "conflict", message: "Data mismatch" });
      store.recordDecision({ action: "search", reason: "Find Q3 data" });

      const context = store.buildPromptContext();

      assert.ok(context.includes("目标"));
      assert.ok(context.includes("Analyze Q3 reports"));
      assert.ok(context.includes("待办"));
      assert.ok(context.includes("阶段发现"));
      assert.ok(context.includes("待验证"));
      assert.ok(context.includes("待处理信号"));
      assert.ok(context.includes("最近决策"));
    });
  });

  describe("Stats", () => {
    it("should track statistics", () => {
      store.addMessage({ role: "user", content: "Hello" });
      store.addTodo({ content: "Task" });
      store.addSignal({ type: "info" });
      store.recordDecision({ action: "test" });
      store.syncDiscovery("gap_001", {});
      store.archive("test", {});

      const stats = store.getStats();
      assert.strictEqual(stats.messageCount, 1);
      assert.strictEqual(stats.todoCount, 1);
      assert.strictEqual(stats.signalCount, 1);
      assert.strictEqual(stats.decisionCount, 1);
      assert.strictEqual(stats.discoveryCount, 1);
      assert.strictEqual(stats.archiveCount, 1);
    });
  });

  describe("Delegation", () => {
    it("should bind and expose sharedContext", () => {
      const mockSharedContext = { name: "mock" };
      store.bind({ sharedContext: mockSharedContext });
      assert.strictEqual(store.sharedContext, mockSharedContext);
    });

    it("should bind and expose discoveryManager", () => {
      const mockDiscoveryManager = { name: "mock" };
      store.bind({ discoveryManager: mockDiscoveryManager });
      assert.strictEqual(store.discoveryManager, mockDiscoveryManager);
    });

    it("should sync from sharedContext", () => {
      const mockSharedContext = {
        getSignals: () => [{ id: "sig_1", type: "test", message: "hello" }],
        getAllSummaries: () => ({ scan: "Found 5 docs" }),
        getDecisions: () => [{ id: "dec_1", action: "read-doc" }],
      };
      store.bind({ sharedContext: mockSharedContext });
      store.syncFromSharedContext();

      assert.strictEqual(store.L1.signals.length, 1);
      assert.strictEqual(store.L2.stageSummaries.get("scan"), "Found 5 docs");
      assert.strictEqual(store.L1.decisions.length, 1);
    });

    it("should sync from discoveryManager", () => {
      const mockDiscoveryManager = {
        getAllDiscoveries: () => [
          { id: "gap_1", status: "open", keywords: ["Q3"] },
          { id: "gap_2", status: "satisfied" },
        ],
      };
      store.bind({ discoveryManager: mockDiscoveryManager });
      store.syncFromDiscoveryManager();

      assert.strictEqual(store.L1.syncTable.discoveries.size, 2);
      assert.strictEqual(store.getDiscovery("gap_1").status, "open");
    });

    it("should syncAll from both components", () => {
      const mockSharedContext = {
        getSignals: () => [{ id: "sig_1", type: "info" }],
        getAllDiscoveries: () => [],
        getStageSummaries: () => ({}),
      };
      const mockDiscoveryManager = {
        getAllDiscoveries: () => [{ id: "gap_1", status: "open" }],
      };
      store.bind({ sharedContext: mockSharedContext, discoveryManager: mockDiscoveryManager });
      store.syncAll();

      assert.strictEqual(store.L1.signals.length, 1);
      assert.strictEqual(store.L1.syncTable.discoveries.size, 1);
    });
  });
});
