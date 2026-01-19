/**
 * StateEngine Tests
 *
 * P1.1: 测试状态引擎的并发安全性和正确性
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { StateEngine, createInitialState, rootReducer } from '../../../../../js/agents/runtime/memory/state-engine.js';
import {
  setTaskGoal,
  addTodo,
  updateTodo,
  removeTodo,
  addMessage,
  addMessages,
  addSignal,
  acknowledgeSignal,
  recordDecision,
  setScratchpad,
  setFlag,
  syncDiscovery,
  syncSubagent,
  setStageSummary,
  addClaim,
  archive,
  batch,
  L0_SET_TASK_GOAL,
  L0_ADD_TODO,
} from '../../../../../js/agents/runtime/memory/action-types.js';

describe("StateEngine", () => {
  let engine;

  beforeEach(() => {
    engine = new StateEngine();
  });

  describe("createInitialState", () => {
    it("should create valid initial state structure", () => {
      const state = createInitialState();
      expect(state.runId).toEqual(expect.any(String));
      expect(state.runId.length).toBeGreaterThan(0);
      expect(state.schemaVersion).toBe("1.0");
      expect(state.L0).toEqual(expect.objectContaining({
        systemPrompt: "",
        taskGoal: "",
        todos: expect.any(Array),
      }));
      expect(state.L1).toEqual(expect.objectContaining({
        messages: expect.any(Array),
        signals: expect.any(Array),
        decisions: expect.any(Array),
        deck: null,
        syncTable: expect.any(Object),
        scratchpad: expect.any(Object),
        flags: expect.any(Object),
      }));
      expect(state.L2).toEqual(expect.objectContaining({
        historySummary: "",
        stageSummaries: expect.any(Object),
        decisions: expect.any(Array),
        claims: expect.any(Array),
      }));
      expect(state.L3).toEqual(expect.objectContaining({
        snapshots: expect.any(Object),
        index: expect.any(Object),
        checkpoints: expect.any(Array),
      }));
      expect(state.L0.todos).toEqual([]);
      expect(state.L1.messages).toEqual([]);
    });

    it("should accept custom runId", () => {
      const state = createInitialState({ runId: "custom_run" });
      expect(state.runId).toBe("custom_run");
    });
  });

  describe("dispatch", () => {
    it("should update state on dispatch", async () => {
      const action = await engine.dispatch(setTaskGoal("Test goal"));

      const state = engine.getState();
      expect(state.L0.taskGoal).toBe("Test goal");
      expect(action.meta.seq).toBeGreaterThan(0);
      expect(action.meta.ts).toBeTypeOf("number");
      expect(action.meta.ts).toBeGreaterThan(0);
    });

    it("should throw on invalid action", async () => {
      await expect(async () => engine.dispatch(null),
        /action must have a type/
      );

      await expect(async () => engine.dispatch({}),
        /action must have a type/
      );
    });
  });

  describe("dispatchSync", () => {
    it("should update state synchronously", () => {
      const action = engine.dispatchSync(setTaskGoal("Sync goal"));

      const state = engine.getState();
      expect(state.L0.taskGoal).toBe("Sync goal");
      expect(action.meta.seq).toBeGreaterThan(0);
    });
  });

  describe("L0 Actions", () => {
    it("should handle setTaskGoal", () => {
      engine.dispatchSync(setTaskGoal("My task"));
      expect(engine.getState().L0.taskGoal).toBe("My task");
    });

    it("should handle addTodo", () => {
      engine.dispatchSync(addTodo({ text: "Todo 1", status: "pending" }));
      engine.dispatchSync(addTodo({ text: "Todo 2", status: "in_progress" }));

      const todos = engine.getState().L0.todos;
      expect(todos.length).toBe(2);
      expect(todos[0].text).toBe("Todo 1");
      expect(todos[0].status).toBe("pending");
      expect(todos[1].status).toBe("in_progress");
    });

    it("should handle addTodo with existing id (update)", () => {
      engine.dispatchSync(addTodo({ id: "todo_1", text: "Original" }));
      engine.dispatchSync(addTodo({ id: "todo_1", text: "Updated" }));

      const todos = engine.getState().L0.todos;
      expect(todos.length).toBe(1);
      expect(todos[0].text).toBe("Updated");
    });

    it("should handle updateTodo", () => {
      engine.dispatchSync(addTodo({ id: "todo_1", text: "Original", status: "pending" }));
      engine.dispatchSync(updateTodo("todo_1", { status: "completed" }));

      const todos = engine.getState().L0.todos;
      expect(todos[0].status).toBe("completed");
    });

    it("should handle removeTodo", () => {
      engine.dispatchSync(addTodo({ id: "todo_1", text: "Todo 1" }));
      engine.dispatchSync(addTodo({ id: "todo_2", text: "Todo 2" }));
      engine.dispatchSync(removeTodo("todo_1"));

      const todos = engine.getState().L0.todos;
      expect(todos.length).toBe(1);
      expect(todos[0].id).toBe("todo_2");
    });
  });

  describe("L1 Actions", () => {
    it("should handle addMessage", () => {
      engine.dispatchSync(addMessage({ role: "user", content: "Hello" }));
      engine.dispatchSync(addMessage({ role: "assistant", content: "Hi there" }));

      const messages = engine.getState().L1.messages;
      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe("Hello");
    });

    it("should handle addMessages batch", () => {
      engine.dispatchSync(addMessages([
        { role: "user", content: "Msg 1" },
        { role: "assistant", content: "Msg 2" },
      ]));

      const messages = engine.getState().L1.messages;
      expect(messages.length).toBe(2);
    });

    it("should handle addSignal and acknowledgeSignal", () => {
      engine.dispatchSync(addSignal({ type: "warning", message: "Low memory" }));

      let signals = engine.getState().L1.signals;
      expect(signals.length).toBe(1);
      expect(signals[0].acknowledged).toBe(false);

      const signalId = signals[0].id;
      engine.dispatchSync(acknowledgeSignal(signalId));

      signals = engine.getState().L1.signals;
      expect(signals[0].acknowledged).toBe(true);
    });

    it("should handle recordDecision", () => {
      engine.dispatchSync(recordDecision({ action: "search", reason: "Need more info" }));

      const decisions = engine.getState().L1.decisions;
      expect(decisions.length).toBe(1);
      expect(decisions[0].action).toBe("search");
    });

    it("should handle setScratchpad", () => {
      engine.dispatchSync(setScratchpad("key1", "value1"));
      engine.dispatchSync(setScratchpad({ key2: "value2", key3: "value3" }));

      const scratchpad = engine.getState().L1.scratchpad;
      expect(scratchpad.key1).toBe("value1");
      expect(scratchpad.key2).toBe("value2");
    });

    it("should handle setFlag", () => {
      engine.dispatchSync(setFlag("awaitUserFeedback", true));

      const flags = engine.getState().L1.flags;
      expect(flags.awaitUserFeedback).toBe(true);
    });

    it("should handle syncDiscovery", () => {
      engine.dispatchSync(syncDiscovery("disc_1", { status: "open", keywords: ["test"] }));

      const discoveries = engine.getState().L1.syncTable.discoveries;
      expect(discoveries.disc_1).toMatchObject({
        id: "disc_1",
        status: "open",
        keywords: ["test"],
      });
      expect(discoveries.disc_1.status).toBe("open");
    });

    it("should handle syncSubagent", () => {
      engine.dispatchSync(syncSubagent("agent_1", { status: "running", progress: 50 }));

      const subagents = engine.getState().L1.syncTable.subagents;
      expect(subagents.agent_1).toMatchObject({
        id: "agent_1",
        status: "running",
        progress: 50,
      });
      expect(subagents.agent_1.progress).toBe(50);
    });
  });

  describe("L2 Actions", () => {
    it("should handle setStageSummary", () => {
      engine.dispatchSync(setStageSummary("retrieve", "Found 10 documents"));

      const summaries = engine.getState().L2.stageSummaries;
      expect(summaries.retrieve).toBe("Found 10 documents");
    });

    it("should handle addClaim", () => {
      engine.dispatchSync(addClaim({ content: "The sky is blue", confidence: 0.9 }));

      const claims = engine.getState().L2.claims;
      expect(claims.length).toBe(1);
      expect(claims[0].confidence).toBe(0.9);
    });
  });

  describe("L3 Actions", () => {
    it("should handle archive", () => {
      engine.dispatchSync(archive("retrieve", { documents: [1, 2, 3] }, ["search", "docs"]));

      const state = engine.getState();
      const snapshotIds = Object.keys(state.L3.snapshots);
      expect(snapshotIds.length).toBe(1);
      expect(state.L3.index.keywords.search).toEqual(snapshotIds);
      expect(state.L3.index.keywords.docs).toEqual(snapshotIds);
    });
  });

  describe("Batch Actions", () => {
    it("should handle batch dispatch atomically", () => {
      engine.dispatchSync(batch([
        setTaskGoal("Batch goal"),
        addTodo({ text: "Todo 1" }),
        addTodo({ text: "Todo 2" }),
        addMessage({ role: "user", content: "Hello" }),
      ]));

      const state = engine.getState();
      expect(state.L0.taskGoal).toBe("Batch goal");
      expect(state.L0.todos.length).toBe(2);
      expect(state.L1.messages.length).toBe(1);
    });
  });

  describe("Subscribe", () => {
    it("should notify subscribers on state change", () => {
      const calls = [];
      const unsubscribe = engine.subscribe((action, prev, next) => {
        calls.push({ type: action.type, prevGoal: prev.L0.taskGoal, nextGoal: next.L0.taskGoal });
      });

      engine.dispatchSync(setTaskGoal("Goal 1"));
      engine.dispatchSync(setTaskGoal("Goal 2"));

      expect(calls.length).toBe(2);
      expect(calls[0].prevGoal).toBe("");
      expect(calls[0].nextGoal).toBe("Goal 1");
      expect(calls[1].prevGoal).toBe("Goal 1");
      expect(calls[1].nextGoal).toBe("Goal 2");

      unsubscribe();
      engine.dispatchSync(setTaskGoal("Goal 3"));
      expect(calls.length).toBe(2); // No new calls after unsubscribe
    });

    it("should not notify on no-op dispatch", () => {
      engine.dispatchSync(setTaskGoal("Same goal"));

      const calls = [];
      engine.subscribe((action) => calls.push(action.type));

      engine.dispatchSync(setTaskGoal("Same goal")); // No change
      expect(calls.length).toBe(0);
    });
  });

  describe("Action History", () => {
    it("should record action history", () => {
      engine.dispatchSync(setTaskGoal("Goal 1"));
      engine.dispatchSync(addTodo({ text: "Todo 1" }));

      const history = engine.getActionHistory();
      expect(history.length).toBe(2);
      expect(history[0].type).toBe(L0_SET_TASK_GOAL);
      expect(history[1].type).toBe(L0_ADD_TODO);
    });

    it("should limit action history size", () => {
      const smallEngine = new StateEngine({ maxActionHistory: 3 });

      for (let i = 0; i < 10; i++) {
        smallEngine.dispatchSync(setTaskGoal(`Goal ${i}`));
      }

      const history = smallEngine.getActionHistory();
      expect(history.length).toBe(3);
    });

    it("should support replay", () => {
      engine.dispatchSync(setTaskGoal("Goal"));
      engine.dispatchSync(addTodo({ text: "Todo 1" }));
      engine.dispatchSync(addTodo({ text: "Todo 2" }));

      const history = engine.getActionHistory();
      const replayed = engine.replay(history);

      expect(replayed.L0.taskGoal).toBe("Goal");
      expect(replayed.L0.todos.length).toBe(2);
    });
  });

  describe("Lamport Clock", () => {
    it("should increment seq on each dispatch", () => {
      const action1 = engine.dispatchSync(setTaskGoal("Goal 1"));
      const action2 = engine.dispatchSync(setTaskGoal("Goal 2"));
      const action3 = engine.dispatchSync(addTodo({ text: "Todo" }));

      expect(action2.meta.seq).toBeGreaterThan(action1.meta.seq);
      expect(action3.meta.seq).toBeGreaterThan(action2.meta.seq);
    });

    it("should handle clock receive", () => {
      const initialClock = engine.getClockValue();
      engine.receiveClockValue(100);
      const afterReceive = engine.getClockValue();

      expect(afterReceive).toBeGreaterThanOrEqual(100);
    });
  });

  describe("Concurrent Dispatch", () => {
    it("should serialize concurrent dispatches", async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(engine.dispatch(addTodo({ text: `Todo ${i}` })));
      }

      await Promise.all(promises);

      const todos = engine.getState().L0.todos;
      expect(todos.length).toBe(100);

      // Verify seq numbers are monotonically increasing
      const history = engine.getActionHistory();
      for (let i = 1; i < history.length; i++) {
        expect(history[i].meta.seq,
          `seq ${history[i].meta.seq} should be > ${history[i - 1].meta.seq}`
        ).toBeGreaterThan(history[i - 1].meta.seq);
      }
    });
  });

  describe("Snapshot", () => {
    it("should create and restore snapshots", () => {
      engine.dispatchSync(setTaskGoal("Goal"));
      engine.dispatchSync(addTodo({ text: "Todo" }));

      const snapshot = engine.createSnapshot();

      engine.reset();
      expect(engine.getState().L0.taskGoal).toBe("");

      engine.restoreSnapshot(snapshot);
      expect(engine.getState().L0.taskGoal).toBe("Goal");
      expect(engine.getState().L0.todos.length).toBe(1);
    });
  });

  describe("Reset", () => {
    it("should reset to initial state", () => {
      engine.dispatchSync(setTaskGoal("Goal"));
      engine.dispatchSync(addTodo({ text: "Todo" }));

      engine.reset();

      const state = engine.getState();
      expect(state.L0.taskGoal).toBe("");
      expect(state.L0.todos.length).toBe(0);
      expect(engine.getActionHistory().length).toBe(0);
    });

    it("should notify subscribers on reset", () => {
      engine.dispatchSync(setTaskGoal("Goal"));

      let resetCalled = false;
      engine.subscribe((action) => {
        if (action.type === "@@RESET") resetCalled = true;
      });

      engine.reset();
      expect(resetCalled).toBe(true);
    });
  });

  describe("Immutability", () => {
    it("should return immutable state from getState", () => {
      engine.dispatchSync(addTodo({ text: "Todo 1" }));

      const state1 = engine.getState();
      state1.L0.todos.push({ text: "Mutated" });

      const state2 = engine.getState();
      expect(state2.L0.todos.length).toBe(1);
    });

    it("should not mutate state on reducer", () => {
      engine.dispatchSync(addTodo({ text: "Todo 1" }));
      const beforeState = engine.getState();

      engine.dispatchSync(addTodo({ text: "Todo 2" }));
      const afterState = engine.getState();

      // Original state should be unchanged
      expect(beforeState.L0.todos.length).toBe(1);
      expect(afterState.L0.todos.length).toBe(2);
    });
  });
});

describe("rootReducer", () => {
  it("should handle unknown action types gracefully", () => {
    const state = createInitialState();
    const result = rootReducer(state, { type: "UNKNOWN_ACTION", payload: {} });
    expect(result).toBe(state); // Should return same state reference
  });
});

describe("Queue Backpressure", () => {
  it("should track dropped count in metrics via _enqueue directly", () => {
    const engine = new StateEngine({ maxQueueSize: 3 });

    // Directly test _enqueue backpressure by simulating queued items
    // First fill the queue
    for (let i = 0; i < 5; i++) {
      engine._enqueue({ action: { type: "TEST", payload: i }, resolve: () => {} });
    }

    const metrics = engine.getQueueMetrics();
    expect(metrics.queueSize).toBe(3, "Queue should be at maxQueueSize");
    expect(metrics.totalDropped).toBe(2, "Should have dropped 2 oldest actions");
  });

  it("should emit overflow event when dropping", () => {
    const events = [];
    const mockEventBus = {
      emit: (name, data) => events.push({ name, data }),
    };

    const engine = new StateEngine({ maxQueueSize: 2, eventBus: mockEventBus });

    // Directly fill the queue to trigger overflow
    for (let i = 0; i < 5; i++) {
      engine._enqueue({ action: { type: "TEST", payload: i }, resolve: () => {} });
    }

    const overflowEvents = events.filter(e => e.name === "stateEngine:queueOverflow");
    expect(overflowEvents.length).toBe(3, "Should have emitted 3 overflow events");
    expect(overflowEvents[0].data.dropped).toBe(1);
    expect(overflowEvents[0].data.totalDropped).toBeGreaterThan(0);
  });

  it("should call resolve with dropped info for overflow items", () => {
    const resolutions = [];
    const engine = new StateEngine({ maxQueueSize: 2 });

    // Queue items with tracked resolvers
    for (let i = 0; i < 5; i++) {
      engine._enqueue({
        action: { type: "TEST", payload: i },
        resolve: (result) => resolutions.push({ i, result }),
      });
    }

    // First 3 should have been dropped (items 0, 1, 2)
    const dropped = resolutions.filter(r => r.result?.dropped === true);
    expect(dropped.length).toBe(3, "Should have 3 dropped resolutions");
  });

  it("should return queue metrics", () => {
    const engine = new StateEngine({ maxQueueSize: 100 });

    const metrics = engine.getQueueMetrics();
    expect(metrics.queueSize).toBe(0);
    expect(metrics.maxQueueSize).toBe(100);
    expect(metrics.isDispatching).toBe(false);
    expect(metrics.totalDropped).toBe(0);
    expect(metrics.utilizationPercent).toBe(0);
  });

  it("should use custom maxQueueSize from options", () => {
    const engine = new StateEngine({ maxQueueSize: 500 });
    const metrics = engine.getQueueMetrics();
    expect(metrics.maxQueueSize).toBe(500);
  });

  it("should default maxQueueSize to 1000", () => {
    const engine = new StateEngine();
    const metrics = engine.getQueueMetrics();
    expect(metrics.maxQueueSize).toBe(1000);
  });
});
