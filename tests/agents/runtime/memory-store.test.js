import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { MemoryStore } from "../../../js/agents/runtime/memory/memory-store.js";

describe("MemoryStore", () => {
  let store;

  beforeEach(() => {
    store = new MemoryStore({ runId: "test_run" });
  });

  describe("L0: Immutable", () => {
    it("should set and get system prompt", () => {
      store.setSystemPrompt("You are a helpful assistant.");
      expect(store.L0.systemPrompt).toBe("You are a helpful assistant.");
    });

    it("should set and get task goal", () => {
      store.setTaskGoal("Analyze documents");
      expect(store.L0.taskGoal).toBe("Analyze documents");
    });

    it("should add, update, and remove todos", () => {
      const todo = store.addTodo({ content: "Read doc A" });
      expect(todo.id).toBeTruthy();
      expect(todo.content).toBe("Read doc A");
      expect(todo.status).toBe("pending");

      store.updateTodo(todo.id, { status: "done" });
      expect(store.L0.todos[0].status).toBe("completed");

      const removed = store.removeTodo(todo.id);
      expect(removed.id).toBe(todo.id);
      expect(store.L0.todos.length).toBe(0);
    });

    it("should filter todos by status", () => {
      store.addTodo({ content: "Task 1", status: "pending" });
      store.addTodo({ content: "Task 2", status: "done" });
      store.addTodo({ content: "Task 3", status: "pending" });

      const pending = store.getTodos("pending");
      expect(pending.length).toBe(2);

      const done = store.getTodos("done");
      expect(done.length).toBe(1);
    });
  });

  describe("L1: Working", () => {
    it("should add and get messages", () => {
      store.addMessage({ role: "user", content: "Hello" });
      store.addMessage({ role: "assistant", content: "Hi there" });

      const messages = store.getMessages();
      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe("Hello");
    });

    it("should add and acknowledge signals", () => {
      const sig = store.addSignal({ type: "discovery", message: "Found conflict" });
      expect(sig.id).toBeTruthy();
      expect(sig.acknowledged).toBe(false);

      store.acknowledgeSignal(sig.id);
      expect(store.L1.signals[0].acknowledged).toBe(true);

      const pending = store.getSignals("pending");
      expect(pending.length).toBe(0);
    });

    it("should record decisions", () => {
      store.recordDecision({ action: "read-doc", reason: "Need more info" });
      store.recordDecision({ action: "search", reason: "Find Q3 data" });

      const decisions = store.getDecisions(2);
      expect(decisions.length).toBe(2);
      expect(decisions[1].action).toBe("search");
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
      expect(discovery.status).toBe("open");
      expect(discovery.keywords).toEqual(["Q3", "revenue"]);

      // Update from another subagent
      store.syncDiscovery("gap_001", {
        status: "satisfied",
        by: "subagent_B",
      });

      const updated = store.getDiscovery("gap_001");
      expect(updated.status).toBe("satisfied");
      expect(updated.by).toBe("subagent_B");
    });

    it("should sync subagent status", () => {
      store.syncSubagent("sub_001", { status: "running", progress: 50 });

      const sub = store.getSubagent("sub_001");
      expect(sub.status).toBe("running");
      expect(sub.progress).toBe(50);

      store.syncSubagent("sub_001", { status: "completed", progress: 100 });
      expect(store.getSubagent("sub_001").status).toBe("completed");
    });

    it("should list all discoveries and subagents", () => {
      store.syncDiscovery("gap_001", { status: "open" });
      store.syncDiscovery("gap_002", { status: "satisfied" });
      store.syncSubagent("sub_001", { status: "running" });

      expect(store.getAllDiscoveries().length).toBe(2);
      expect(store.getAllSubagents().length).toBe(1);
    });
  });

  describe("L2: Condensed", () => {
    it("should set and get stage summaries", () => {
      store.setStageSummary("scan", "Found 8 documents");
      store.setStageSummary("analyze", "Q3 revenue is 120B");

      expect(store.getStageSummary("scan")).toBe("Found 8 documents");

      const all = store.getAllStageSummaries();
      expect(Object.keys(all).length).toBe(2);
    });

    it("should add and filter claims", () => {
      store.addClaim({ content: "Q3 revenue is 120B", source: "Report A" });
      store.addClaim({ content: "Market share increased", verified: true });

      const verified = store.getClaims(c => c.verified);
      expect(verified.length).toBe(1);
    });
  });

  describe("L3: Archive", () => {
    it("should archive and recall by keywords", async () => {
      await store.archive("read_reportA", { content: "Q3 revenue analysis" }, ["Q3", "revenue"]);
      await store.archive("read_reportB", { content: "Market share data" }, ["market", "share"]);

      const results = store.recall("Q3 revenue");
      expect(results.length).toBe(1);
      expect(results[0].data.content.includes("Q3")).toBeTruthy();
    });

    it("should list archives", async () => {
      await store.archive("stage1", { data: "test1" });
      await store.archive("stage2", { data: "test2" });

      const list = store.listArchives();
      expect(list.length).toBe(2);
    });
  });

	  describe("Checkpoint", () => {
	    it("should checkpoint and restore state", async () => {
	      store.setTaskGoal("Original goal");
	      store.addTodo({ content: "Task 1" });
	      store.addMessage({ role: "user", content: "Hello" });
	
	      const ckptId = await store.checkpoint();
	      expect(ckptId).toBeTruthy();
	      const snapshot = store.L3.checkpoints.find((c) => c.id === ckptId);
	      expect(snapshot).toBeTruthy();
	      expect(snapshot.L0.taskGoal).toBe("Original goal");
	      expect(snapshot.L0.todos.length).toBe(1);
	      expect(snapshot.L1.messages.length).toBe(1);
	
	      // Modify state
	      store.setTaskGoal("Modified goal");
	      store.addTodo({ content: "Task 2" });
	      store.addMessage({ role: "user", content: "World" });
	      // Snapshot stays immutable.
	      expect(snapshot.L0.taskGoal).toBe("Original goal");
	      expect(snapshot.L0.todos.length).toBe(1);
	      expect(snapshot.L1.messages.length).toBe(1);
	
	      expect(store.L0.taskGoal).toBe("Modified goal");
	      expect(store.L0.todos.length).toBe(2);
	      expect(store.L1.messages.length).toBe(2);

      // Restore
      const restored = await store.restore(ckptId);
      expect(restored).toBe(true);
      expect(store.L0.taskGoal).toBe("Original goal");
      expect(store.L0.todos.length).toBe(1);
      expect(store.L1.messages.length).toBe(1);
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

      expect(afterCount < beforeCount).toBeTruthy();
      expect(store.L2.historySummary.length > 0).toBeTruthy();
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

      expect(context.includes("目标")).toBeTruthy();
      expect(context.includes("Analyze Q3 reports")).toBeTruthy();
      expect(context.includes("待办")).toBeTruthy();
      expect(context.includes("阶段发现")).toBeTruthy();
      expect(context.includes("待验证")).toBeTruthy();
      expect(context.includes("待处理信号")).toBeTruthy();
      expect(context.includes("最近决策")).toBeTruthy();
    });
  });

  describe("Stats", () => {
    it("should track statistics", async () => {
      store.addMessage({ role: "user", content: "Hello" });
      store.addTodo({ content: "Task" });
      store.addSignal({ type: "info" });
      store.recordDecision({ action: "test" });
      store.syncDiscovery("gap_001", {});
      await store.archive("test", {});

      const stats = store.getStats();
      expect(stats.messageCount).toBe(1);
      expect(stats.todoCount).toBe(1);
      expect(stats.signalCount).toBe(1);
      expect(stats.decisionCount).toBe(1);
      expect(stats.discoveryCount).toBe(1);
      expect(stats.archiveCount).toBe(1);
    });
  });

  describe("Delegation", () => {
    it("should bind and expose sharedContext", () => {
      const mockSharedContext = { name: "mock" };
      store.bind({ sharedContext: mockSharedContext });
      expect(store.sharedContext).toBe(mockSharedContext);
    });

    it("should bind and expose discoveryManager", () => {
      const mockDiscoveryManager = { name: "mock" };
      store.bind({ discoveryManager: mockDiscoveryManager });
      expect(store.discoveryManager).toBe(mockDiscoveryManager);
    });

    it("should sync from sharedContext", () => {
      const mockSharedContext = {
        getSignals: () => [{ id: "sig_1", type: "test", message: "hello" }],
        getAllSummaries: () => ({ scan: "Found 5 docs" }),
        getDecisions: () => [{ id: "dec_1", action: "read-doc" }],
      };
      store.bind({ sharedContext: mockSharedContext });
      store.syncFromSharedContext();

      expect(store.L1.signals.length).toBe(1);
      expect(store.L2.stageSummaries.get("scan")).toBe("Found 5 docs");
      expect(store.L1.decisions.length).toBe(1);
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

      expect(store.L1.syncTable.discoveries.size).toBe(2);
      expect(store.getDiscovery("gap_1").status).toBe("open");
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

      expect(store.L1.signals.length).toBe(1);
      expect(store.L1.syncTable.discoveries.size).toBe(1);
    });
  });
});
