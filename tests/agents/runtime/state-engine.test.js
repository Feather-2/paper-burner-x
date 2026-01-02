/**
 * StateEngine Tests
 *
 * P1.1: 测试状态引擎的并发安全性和正确性
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";

import { StateEngine, createInitialState, rootReducer } from "../../../js/agents/runtime/memory/state-engine.js";
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
} from "../../../js/agents/runtime/memory/action-types.js";

describe("StateEngine", () => {
  let engine;

  beforeEach(() => {
    engine = new StateEngine();
  });

  describe("createInitialState", () => {
    it("should create valid initial state structure", () => {
      const state = createInitialState();
      assert.ok(state.runId);
      assert.strictEqual(state.schemaVersion, "1.0");
      assert.ok(state.L0);
      assert.ok(state.L1);
      assert.ok(state.L2);
      assert.ok(state.L3);
      assert.deepStrictEqual(state.L0.todos, []);
      assert.deepStrictEqual(state.L1.messages, []);
    });

    it("should accept custom runId", () => {
      const state = createInitialState({ runId: "custom_run" });
      assert.strictEqual(state.runId, "custom_run");
    });
  });

  describe("dispatch", () => {
    it("should update state on dispatch", async () => {
      const action = await engine.dispatch(setTaskGoal("Test goal"));

      const state = engine.getState();
      assert.strictEqual(state.L0.taskGoal, "Test goal");
      assert.ok(action.meta.seq > 0);
      assert.ok(action.meta.ts);
    });

    it("should throw on invalid action", async () => {
      await assert.rejects(
        async () => engine.dispatch(null),
        /action must have a type/
      );

      await assert.rejects(
        async () => engine.dispatch({}),
        /action must have a type/
      );
    });
  });

  describe("dispatchSync", () => {
    it("should update state synchronously", () => {
      const action = engine.dispatchSync(setTaskGoal("Sync goal"));

      const state = engine.getState();
      assert.strictEqual(state.L0.taskGoal, "Sync goal");
      assert.ok(action.meta.seq > 0);
    });
  });

  describe("L0 Actions", () => {
    it("should handle setTaskGoal", () => {
      engine.dispatchSync(setTaskGoal("My task"));
      assert.strictEqual(engine.getState().L0.taskGoal, "My task");
    });

    it("should handle addTodo", () => {
      engine.dispatchSync(addTodo({ text: "Todo 1", status: "pending" }));
      engine.dispatchSync(addTodo({ text: "Todo 2", status: "in_progress" }));

      const todos = engine.getState().L0.todos;
      assert.strictEqual(todos.length, 2);
      assert.strictEqual(todos[0].text, "Todo 1");
      assert.strictEqual(todos[0].status, "pending");
      assert.strictEqual(todos[1].status, "in_progress");
    });

    it("should handle addTodo with existing id (update)", () => {
      engine.dispatchSync(addTodo({ id: "todo_1", text: "Original" }));
      engine.dispatchSync(addTodo({ id: "todo_1", text: "Updated" }));

      const todos = engine.getState().L0.todos;
      assert.strictEqual(todos.length, 1);
      assert.strictEqual(todos[0].text, "Updated");
    });

    it("should handle updateTodo", () => {
      engine.dispatchSync(addTodo({ id: "todo_1", text: "Original", status: "pending" }));
      engine.dispatchSync(updateTodo("todo_1", { status: "completed" }));

      const todos = engine.getState().L0.todos;
      assert.strictEqual(todos[0].status, "completed");
    });

    it("should handle removeTodo", () => {
      engine.dispatchSync(addTodo({ id: "todo_1", text: "Todo 1" }));
      engine.dispatchSync(addTodo({ id: "todo_2", text: "Todo 2" }));
      engine.dispatchSync(removeTodo("todo_1"));

      const todos = engine.getState().L0.todos;
      assert.strictEqual(todos.length, 1);
      assert.strictEqual(todos[0].id, "todo_2");
    });
  });

  describe("L1 Actions", () => {
    it("should handle addMessage", () => {
      engine.dispatchSync(addMessage({ role: "user", content: "Hello" }));
      engine.dispatchSync(addMessage({ role: "assistant", content: "Hi there" }));

      const messages = engine.getState().L1.messages;
      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[0].content, "Hello");
    });

    it("should handle addMessages batch", () => {
      engine.dispatchSync(addMessages([
        { role: "user", content: "Msg 1" },
        { role: "assistant", content: "Msg 2" },
      ]));

      const messages = engine.getState().L1.messages;
      assert.strictEqual(messages.length, 2);
    });

    it("should handle addSignal and acknowledgeSignal", () => {
      engine.dispatchSync(addSignal({ type: "warning", message: "Low memory" }));

      let signals = engine.getState().L1.signals;
      assert.strictEqual(signals.length, 1);
      assert.strictEqual(signals[0].acknowledged, false);

      const signalId = signals[0].id;
      engine.dispatchSync(acknowledgeSignal(signalId));

      signals = engine.getState().L1.signals;
      assert.strictEqual(signals[0].acknowledged, true);
    });

    it("should handle recordDecision", () => {
      engine.dispatchSync(recordDecision({ action: "search", reason: "Need more info" }));

      const decisions = engine.getState().L1.decisions;
      assert.strictEqual(decisions.length, 1);
      assert.strictEqual(decisions[0].action, "search");
    });

    it("should handle setScratchpad", () => {
      engine.dispatchSync(setScratchpad("key1", "value1"));
      engine.dispatchSync(setScratchpad({ key2: "value2", key3: "value3" }));

      const scratchpad = engine.getState().L1.scratchpad;
      assert.strictEqual(scratchpad.key1, "value1");
      assert.strictEqual(scratchpad.key2, "value2");
    });

    it("should handle setFlag", () => {
      engine.dispatchSync(setFlag("awaitUserFeedback", true));

      const flags = engine.getState().L1.flags;
      assert.strictEqual(flags.awaitUserFeedback, true);
    });

    it("should handle syncDiscovery", () => {
      engine.dispatchSync(syncDiscovery("disc_1", { status: "open", keywords: ["test"] }));

      const discoveries = engine.getState().L1.syncTable.discoveries;
      assert.ok(discoveries.disc_1);
      assert.strictEqual(discoveries.disc_1.status, "open");
    });

    it("should handle syncSubagent", () => {
      engine.dispatchSync(syncSubagent("agent_1", { status: "running", progress: 50 }));

      const subagents = engine.getState().L1.syncTable.subagents;
      assert.ok(subagents.agent_1);
      assert.strictEqual(subagents.agent_1.progress, 50);
    });
  });

  describe("L2 Actions", () => {
    it("should handle setStageSummary", () => {
      engine.dispatchSync(setStageSummary("retrieve", "Found 10 documents"));

      const summaries = engine.getState().L2.stageSummaries;
      assert.strictEqual(summaries.retrieve, "Found 10 documents");
    });

    it("should handle addClaim", () => {
      engine.dispatchSync(addClaim({ content: "The sky is blue", confidence: 0.9 }));

      const claims = engine.getState().L2.claims;
      assert.strictEqual(claims.length, 1);
      assert.strictEqual(claims[0].confidence, 0.9);
    });
  });

  describe("L3 Actions", () => {
    it("should handle archive", () => {
      engine.dispatchSync(archive("retrieve", { documents: [1, 2, 3] }, ["search", "docs"]));

      const state = engine.getState();
      const snapshotIds = Object.keys(state.L3.snapshots);
      assert.strictEqual(snapshotIds.length, 1);
      assert.ok(state.L3.index.keywords.search);
      assert.ok(state.L3.index.keywords.docs);
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
      assert.strictEqual(state.L0.taskGoal, "Batch goal");
      assert.strictEqual(state.L0.todos.length, 2);
      assert.strictEqual(state.L1.messages.length, 1);
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

      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].prevGoal, "");
      assert.strictEqual(calls[0].nextGoal, "Goal 1");
      assert.strictEqual(calls[1].prevGoal, "Goal 1");
      assert.strictEqual(calls[1].nextGoal, "Goal 2");

      unsubscribe();
      engine.dispatchSync(setTaskGoal("Goal 3"));
      assert.strictEqual(calls.length, 2); // No new calls after unsubscribe
    });

    it("should not notify on no-op dispatch", () => {
      engine.dispatchSync(setTaskGoal("Same goal"));

      const calls = [];
      engine.subscribe((action) => calls.push(action.type));

      engine.dispatchSync(setTaskGoal("Same goal")); // No change
      assert.strictEqual(calls.length, 0);
    });
  });

  describe("Action History", () => {
    it("should record action history", () => {
      engine.dispatchSync(setTaskGoal("Goal 1"));
      engine.dispatchSync(addTodo({ text: "Todo 1" }));

      const history = engine.getActionHistory();
      assert.strictEqual(history.length, 2);
      assert.strictEqual(history[0].type, L0_SET_TASK_GOAL);
      assert.strictEqual(history[1].type, L0_ADD_TODO);
    });

    it("should limit action history size", () => {
      const smallEngine = new StateEngine({ maxActionHistory: 3 });

      for (let i = 0; i < 10; i++) {
        smallEngine.dispatchSync(setTaskGoal(`Goal ${i}`));
      }

      const history = smallEngine.getActionHistory();
      assert.strictEqual(history.length, 3);
    });

    it("should support replay", () => {
      engine.dispatchSync(setTaskGoal("Goal"));
      engine.dispatchSync(addTodo({ text: "Todo 1" }));
      engine.dispatchSync(addTodo({ text: "Todo 2" }));

      const history = engine.getActionHistory();
      const replayed = engine.replay(history);

      assert.strictEqual(replayed.L0.taskGoal, "Goal");
      assert.strictEqual(replayed.L0.todos.length, 2);
    });
  });

  describe("Lamport Clock", () => {
    it("should increment seq on each dispatch", () => {
      const action1 = engine.dispatchSync(setTaskGoal("Goal 1"));
      const action2 = engine.dispatchSync(setTaskGoal("Goal 2"));
      const action3 = engine.dispatchSync(addTodo({ text: "Todo" }));

      assert.ok(action2.meta.seq > action1.meta.seq);
      assert.ok(action3.meta.seq > action2.meta.seq);
    });

    it("should handle clock receive", () => {
      const initialClock = engine.getClockValue();
      engine.receiveClockValue(100);
      const afterReceive = engine.getClockValue();

      assert.ok(afterReceive >= 100);
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
      assert.strictEqual(todos.length, 100);

      // Verify seq numbers are monotonically increasing
      const history = engine.getActionHistory();
      for (let i = 1; i < history.length; i++) {
        assert.ok(
          history[i].meta.seq > history[i - 1].meta.seq,
          `seq ${history[i].meta.seq} should be > ${history[i - 1].meta.seq}`
        );
      }
    });
  });

  describe("Snapshot", () => {
    it("should create and restore snapshots", () => {
      engine.dispatchSync(setTaskGoal("Goal"));
      engine.dispatchSync(addTodo({ text: "Todo" }));

      const snapshot = engine.createSnapshot();

      engine.reset();
      assert.strictEqual(engine.getState().L0.taskGoal, "");

      engine.restoreSnapshot(snapshot);
      assert.strictEqual(engine.getState().L0.taskGoal, "Goal");
      assert.strictEqual(engine.getState().L0.todos.length, 1);
    });
  });

  describe("Reset", () => {
    it("should reset to initial state", () => {
      engine.dispatchSync(setTaskGoal("Goal"));
      engine.dispatchSync(addTodo({ text: "Todo" }));

      engine.reset();

      const state = engine.getState();
      assert.strictEqual(state.L0.taskGoal, "");
      assert.strictEqual(state.L0.todos.length, 0);
      assert.strictEqual(engine.getActionHistory().length, 0);
    });

    it("should notify subscribers on reset", () => {
      engine.dispatchSync(setTaskGoal("Goal"));

      let resetCalled = false;
      engine.subscribe((action) => {
        if (action.type === "@@RESET") resetCalled = true;
      });

      engine.reset();
      assert.ok(resetCalled);
    });
  });

  describe("Immutability", () => {
    it("should return immutable state from getState", () => {
      engine.dispatchSync(addTodo({ text: "Todo 1" }));

      const state1 = engine.getState();
      state1.L0.todos.push({ text: "Mutated" });

      const state2 = engine.getState();
      assert.strictEqual(state2.L0.todos.length, 1);
    });

    it("should not mutate state on reducer", () => {
      engine.dispatchSync(addTodo({ text: "Todo 1" }));
      const beforeState = engine.getState();

      engine.dispatchSync(addTodo({ text: "Todo 2" }));
      const afterState = engine.getState();

      // Original state should be unchanged
      assert.strictEqual(beforeState.L0.todos.length, 1);
      assert.strictEqual(afterState.L0.todos.length, 2);
    });
  });
});

describe("rootReducer", () => {
  it("should handle unknown action types gracefully", () => {
    const state = createInitialState();
    const result = rootReducer(state, { type: "UNKNOWN_ACTION", payload: {} });
    assert.strictEqual(result, state); // Should return same state reference
  });
});
