import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("DeepSearchState.dispose: unsubscribes + disposes StateEngine and rejects further use", async () => {
  const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");

  let unsubCalls = 0;
  let engineDisposeCalls = 0;
  const engineState = { L0: { taskGoal: "", todos: [] } };

  const engine = {
    _getStateRef: () => engineState,
    dispatchSync: () => {},
    subscribe: () => () => {
      unsubCalls += 1;
    },
    dispose: async () => {
      engineDisposeCalls += 1;
    },
  };

  const state = new DeepSearchState({ runId: "run_dispose", taskGoal: "g", stateEngine: engine });
  expect(state.disposed).toBe(false);

  await state.dispose();
  expect(state.disposed).toBe(true);
  expect(unsubCalls).toBe(1);
  expect(engineDisposeCalls).toBe(1);

  expect(() => {
    state.addTodo({ todoId: "t1", text: "x", status: "open" }).toThrow();
  }, /disposed/i);
});

