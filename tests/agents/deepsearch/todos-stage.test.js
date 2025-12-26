const test = require("node:test");
const assert = require("node:assert/strict");

test("DeepSearch todos: LLM success generates todos and emits events", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchTodosStage } = await import("../../../js/agents/stages/deepsearch/todos.js");

  const events = [];
  const bus = { emit: (name, record) => events.push({ name, record }) };
  const calls = [];

  const modelRouter = {
    call: async (...args) => {
      calls.push(args);
      return {
        content: JSON.stringify([
          { text: "Define Alpha", priority: "high", queryHints: ["alpha", "definition"], expectedEvidence: "definition source" },
          { text: "Collect Alpha metrics", priority: "medium", queryHints: ["alpha", "metrics"], expectedEvidence: "recent data" },
        ]),
        usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
        model: "test-model",
      };
    },
  };

  const state = new DeepSearchState({
    runId: "run_todos_llm",
    taskGoal: "Explain Alpha",
    L1: { scanSummary: { summaryText: "Alpha overview", keyTopics: ["Alpha"] } },
  });

  const result = await runDeepSearchTodosStage({ runId: "run_todos_llm" }, { state }, { modelRouter, eventBus: bus });

  assert.equal(calls.length, 1);
  assert.equal(result.todos.length, 2);
  assert.equal(state.todos.length, 2);
  assert.equal(state.todos[0].source, "llm");

  assert.equal(events.some((e) => e.name === "deepsearch.todos.started"), true);
  assert.equal(events.filter((e) => e.name === "deepsearch.todo.created").length, 2);
  assert.equal(events.some((e) => e.name === "deepsearch.todos.completed"), true);
});

test("DeepSearch todos: LLM unavailable falls back to heuristic todos", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchTodosStage } = await import("../../../js/agents/stages/deepsearch/todos.js");

  const state = new DeepSearchState({ runId: "run_todos_pause", taskGoal: "Explain Beta" });

  const result = await runDeepSearchTodosStage({ runId: "run_todos_pause" }, { state }, {});

  assert.equal(Array.isArray(result.todos), true);
  assert.equal(result.todos.length > 0, true);
  assert.equal(state.L2.awaitUserFeedback, false);
});

test("DeepSearch todos: invalid LLM output falls back to heuristic todos", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchTodosStage } = await import("../../../js/agents/stages/deepsearch/todos.js");

  const modelRouter = {
    call: async () => ({ content: "not-json", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
  };

  const state = new DeepSearchState({ runId: "run_todos_bad", taskGoal: "Explain Gamma" });

  const result = await runDeepSearchTodosStage({ runId: "run_todos_bad" }, { state }, { modelRouter });
  assert.equal(result.todos.length > 0, true);
  assert.equal(state.L2.awaitUserFeedback, false);
});

test("DeepSearch todos: skips LLM when user todos exist", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchTodosStage } = await import("../../../js/agents/stages/deepsearch/todos.js");
  const { createTodo } = await import("../../../js/agents/stages/deepsearch/utils/todo-utils.js");

  const events = [];
  const bus = { emit: (name, record) => events.push({ name, record }) };
  let called = false;

  const modelRouter = {
    call: async () => {
      called = true;
      throw new Error("LLM should not be called");
    },
  };

  const state = new DeepSearchState({ runId: "run_todos_user", taskGoal: "Explain Delta" });
  state.todos = [createTodo({ todoId: "t_user", text: "User todo", source: "user" })];

  const result = await runDeepSearchTodosStage({ runId: "run_todos_user" }, { state }, { modelRouter, eventBus: bus });

  assert.equal(called, false);
  assert.equal(result.todos.length, 1);
  assert.equal(events.some((e) => e.name === "deepsearch.todos.started"), true);
  assert.equal(events.some((e) => e.name === "deepsearch.todos.completed"), true);
  assert.equal(events.some((e) => e.name === "deepsearch.todo.created"), false);
});
