import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { UnifiedAgentContext } from "../../../js/agents/runtime/context/unified-agent-context.js";

describe("UnifiedAgentContext", () => {
  describe("constructor", () => {
    it("should create with default runId", () => {
      const ctx = new UnifiedAgentContext();
      assert.ok(ctx.runId.startsWith("ctx_"));
    });

    it("should accept custom runId", () => {
      const ctx = new UnifiedAgentContext({ runId: "test_123" });
      assert.equal(ctx.runId, "test_123");
    });
  });

  describe("bind", () => {
    it("should bind state, memory, and sharedContext", () => {
      const ctx = new UnifiedAgentContext();
      const mockState = { taskGoal: "test" };
      const mockMemory = { L0: { taskGoal: "memory" } };
      const mockShared = { signal: () => {} };

      ctx.bind({ state: mockState, memory: mockMemory, sharedContext: mockShared });

      assert.equal(ctx._state, mockState);
      assert.equal(ctx._memory, mockMemory);
      assert.equal(ctx._sharedContext, mockShared);
    });
  });

  describe("taskGoal", () => {
    it("should get from state first", () => {
      const ctx = new UnifiedAgentContext();
      ctx._state = { taskGoal: "from state" };
      ctx._memory = { L0: { taskGoal: "from memory" } };

      assert.equal(ctx.taskGoal, "from state");
    });

    it("should fallback to memory", () => {
      const ctx = new UnifiedAgentContext();
      ctx._memory = { L0: { taskGoal: "from memory" } };

      assert.equal(ctx.taskGoal, "from memory");
    });

    it("should set to both state and memory", () => {
      const ctx = new UnifiedAgentContext();
      ctx._state = { taskGoal: "" };
      ctx._memory = { setTaskGoal: (g) => { ctx._memory.L0 = { taskGoal: g }; }, L0: {} };

      ctx.setTaskGoal("new goal");

      assert.equal(ctx._state.taskGoal, "new goal");
      assert.equal(ctx._memory.L0.taskGoal, "new goal");
    });
  });

  describe("todos", () => {
    it("should get from state", () => {
      const ctx = new UnifiedAgentContext();
      ctx._state = { todos: [{ id: 1 }] };

      assert.deepEqual(ctx.todos, [{ id: 1 }]);
    });

    it("should add to both state and memory", () => {
      const ctx = new UnifiedAgentContext();
      const stateTodos = [];
      const memoryTodos = [];

      ctx._state = { addTodo: (t) => stateTodos.push(t) };
      ctx._memory = { addTodo: (t) => memoryTodos.push(t) };

      ctx.addTodo({ id: 1, text: "test" });

      assert.equal(stateTodos.length, 1);
      assert.equal(memoryTodos.length, 1);
    });
  });

  describe("claims", () => {
    it("should get from state L1", () => {
      const ctx = new UnifiedAgentContext();
      ctx._state = { L1: { claims: [{ text: "claim1" }] } };

      assert.deepEqual(ctx.claims, [{ text: "claim1" }]);
    });

    it("should add to state and sharedContext", () => {
      const ctx = new UnifiedAgentContext();
      let stateClaim = null;
      let sharedFinding = null;

      ctx._state = { addClaim: (c) => { stateClaim = c; } };
      ctx._sharedContext = { addFinding: (f) => { sharedFinding = f; } };

      ctx.addClaim({ text: "test claim", source: "doc1" });

      assert.ok(stateClaim);
      assert.ok(sharedFinding);
      assert.equal(sharedFinding.type, "claim");
    });
  });

  describe("signals", () => {
    it("should delegate to sharedContext", () => {
      const ctx = new UnifiedAgentContext();
      let signaled = null;

      ctx._sharedContext = {
        signal: (type, payload) => { signaled = { type, payload }; },
        getSignals: () => [{ type: "test" }],
      };

      ctx.signal("test_signal", { data: 1 });

      assert.deepEqual(signaled, { type: "test_signal", payload: { data: 1 } });
      assert.deepEqual(ctx.getSignals(), [{ type: "test" }]);
    });
  });

  describe("iteration", () => {
    it("should get and set iteration", () => {
      const ctx = new UnifiedAgentContext();
      ctx._state = { iteration: 5 };

      assert.equal(ctx.iteration, 5);

      ctx.iteration = 10;
      assert.equal(ctx._state.iteration, 10);
    });
  });

  describe("report", () => {
    it("should get from state L1", () => {
      const ctx = new UnifiedAgentContext();
      ctx._state = { L1: { report: { markdown: "# Report" } } };

      assert.deepEqual(ctx.report, { markdown: "# Report" });
    });

    it("should set to state L1", () => {
      const ctx = new UnifiedAgentContext();
      ctx._state = {};

      ctx.setReport({ markdown: "# New Report" });

      assert.deepEqual(ctx._state.L1.report, { markdown: "# New Report" });
    });
  });

  describe("checkpoint", () => {
    it("should save checkpoint with all components", async () => {
      const ctx = new UnifiedAgentContext({ runId: "test_run" });
      ctx._state = { toSnapshot: () => ({ iteration: 5 }) };
      ctx._memory = {
        L0: { taskGoal: "test" },
        L1: { messages: [{ role: "user" }], decisions: [] },
        L2: { historySummary: "summary", claims: [] },
      };
      ctx._sharedContext = { serialize: () => ({ signals: [] }) };

      const checkpoint = await ctx.saveCheckpoint();

      assert.equal(checkpoint.runId, "test_run");
      assert.ok(checkpoint.timestamp);
      assert.deepEqual(checkpoint.state, { iteration: 5 });
      assert.equal(checkpoint.memory.L0.taskGoal, "test");
      assert.deepEqual(checkpoint.sharedContext, { signals: [] });
    });

    it("should restore checkpoint", async () => {
      const ctx = new UnifiedAgentContext();
      let restoredState = null;
      let restoredShared = null;

      ctx._state = { fromSnapshot: (s) => { restoredState = s; } };
      ctx._memory = { L0: {}, L1: { messages: [], decisions: [] }, L2: { historySummary: "", claims: [] } };
      ctx._sharedContext = { deserialize: (s) => { restoredShared = s; } };

      const checkpoint = {
        state: { iteration: 10 },
        memory: {
          L0: { taskGoal: "restored" },
          L1: { messages: [{ role: "assistant" }], decisions: [] },
          L2: { historySummary: "restored summary", claims: [] },
        },
        sharedContext: { signals: [{ type: "test" }] },
      };

      const result = await ctx.restoreCheckpoint(checkpoint);

      assert.equal(result, true);
      assert.deepEqual(restoredState, { iteration: 10 });
      assert.equal(ctx._memory.L0.taskGoal, "restored");
      assert.deepEqual(restoredShared, { signals: [{ type: "test" }] });
    });
  });

  describe("getContextStatus", () => {
    it("should return combined status", () => {
      const ctx = new UnifiedAgentContext({ runId: "status_test" });
      ctx._state = { iteration: 3, todos: [1, 2], L1: { claims: [1] } };
      ctx._memory = {
        L1: { messages: [1, 2, 3] },
        getContextStatus: () => ({ tokenUsage: { total: 1000 } }),
      };

      const status = ctx.getContextStatus();

      assert.equal(status.runId, "status_test");
      assert.equal(status.iteration, 3);
      assert.equal(status.todoCount, 2);
      assert.equal(status.claimCount, 1);
      assert.equal(status.messageCount, 3);
      assert.equal(status.tokenUsage.total, 1000);
    });
  });

  describe("serialize", () => {
    it("should serialize key fields", () => {
      const ctx = new UnifiedAgentContext({ runId: "ser_test" });
      ctx._state = {
        taskGoal: "test goal",
        iteration: 5,
        todos: [{ id: 1 }],
        L1: { claims: [{ text: "claim" }], report: { markdown: "# Report" } },
      };

      const serialized = ctx.serialize();

      assert.equal(serialized.runId, "ser_test");
      assert.equal(serialized.taskGoal, "test goal");
      assert.equal(serialized.iteration, 5);
      assert.deepEqual(serialized.todos, [{ id: 1 }]);
      assert.deepEqual(serialized.claims, [{ text: "claim" }]);
      assert.deepEqual(serialized.report, { markdown: "# Report" });
    });
  });
});
