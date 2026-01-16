import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("DeepSearch todos: LLM success generates todos and emits events", async () => {
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

  expect(calls.length).toBe(1);
  expect(result.todos.length).toBe(2);
  expect(state.todos.length).toBe(2);
  expect(state.todos[0].source).toBe("llm");

  expect(events.some((e) => e.name === "deepsearch.todos.started")).toBe(true);
  expect(events.filter((e) => e.name === "deepsearch.todo.created").length).toBe(2);
  expect(events.some((e) => e.name === "deepsearch.todos.completed")).toBe(true);
});

it("DeepSearch todos: LLM unavailable falls back to heuristic todos", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchTodosStage } = await import("../../../js/agents/stages/deepsearch/todos.js");

  const state = new DeepSearchState({ runId: "run_todos_pause", taskGoal: "Explain Beta" });

  const result = await runDeepSearchTodosStage({ runId: "run_todos_pause" }, { state }, {});

  expect(Array.isArray(result.todos)).toBe(true);
  expect(result.todos.length > 0).toBe(true);
  expect(state.L2.awaitUserFeedback).toBe(false);
});

it("DeepSearch todos: invalid LLM output falls back to heuristic todos", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchTodosStage } = await import("../../../js/agents/stages/deepsearch/todos.js");

  const modelRouter = {
    call: async () => ({ content: "not-json", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
  };

  const state = new DeepSearchState({ runId: "run_todos_bad", taskGoal: "Explain Gamma" });

  const result = await runDeepSearchTodosStage({ runId: "run_todos_bad" }, { state }, { modelRouter });
  expect(result.todos.length > 0).toBe(true);
  expect(state.L2.awaitUserFeedback).toBe(false);
});

it("DeepSearch todos: skips LLM when user todos exist", async () => {
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

  expect(called).toBe(false);
  expect(result.todos.length).toBe(1);
  expect(events.some((e) => e.name === "deepsearch.todos.started")).toBe(true);
  expect(events.some((e) => e.name === "deepsearch.todos.completed")).toBe(true);
  expect(events.some((e) => e.name === "deepsearch.todo.created")).toBe(false);
});
