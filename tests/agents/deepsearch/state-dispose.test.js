const test = require("node:test");
const assert = require("node:assert/strict");

test("DeepSearchState.dispose: unsubscribes + disposes StateEngine and rejects further use", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

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
  assert.equal(state.disposed, false);

  await state.dispose();
  assert.equal(state.disposed, true);
  assert.equal(unsubCalls, 1);
  assert.equal(engineDisposeCalls, 1);

  assert.throws(() => {
    state.addTodo({ todoId: "t1", text: "x", status: "open" });
  }, /disposed/i);
});

