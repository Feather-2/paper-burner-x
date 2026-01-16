import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("CodeSearch todos: planner generates todos and completion stats", async () => {
  const { CodeSearchStage } = await import("../../../js/agents/stages/codesearch/codesearch-stage.js");
  const { readFile, readdir, stat } = await import("node:fs/promises");

  const responses = [
    {
      content: JSON.stringify([
        {
          text: "Inspect project structure",
          priority: "high",
          queryHints: ["tree", "layout"],
          expectedEvidence: "directory layout",
        },
      ]),
    },
    {
      content: JSON.stringify({
        thought: "List root directory",
        todoIndex: 1,
        action: "list_dir",
        args: { path: "." },
        todoStatus: "completed",
      }),
    },
    { content: "Summary ok." },
  ];

  let callIndex = 0;
  const modelRouter = {
    call: async () => {
      const response = responses[Math.min(callIndex, responses.length - 1)];
      callIndex += 1;
      return response;
    },
  };

  const stage = new CodeSearchStage({ maxSteps: 3 });
  const result = await stage.execute(
    { runId: "run_codesearch_todos" },
    { query: "Inspect repo", basePath: "." },
    { modelRouter, fs: { readFile, readdir, stat } }
  );

  expect(result.todos.length).toBe(1);
  expect(result.todos[0].status).toBe("completed");
  expect(result.todoCompletionStats).toEqual({ total: 1, completed: 1, cancelled: 0, open: 0 });
});

it("CodeSearch todos: LLM unavailable triggers awaitUserFeedback pause", async () => {
  const { CodeSearchStage } = await import("../../../js/agents/stages/codesearch/codesearch-stage.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const stage = new CodeSearchStage({ maxSteps: 1 });

  await expect(stage.execute({ runId: "run_codesearch_pause" }).rejects.toThrow({ query: "Inspect repo" }, {}),
    (err) => err instanceof StagePausedError
  );

  expect(stage.loopState?.awaitUserFeedback).toBe(true);
  expect(stage.loopState?.pauseReason).toBe("LLM unavailable, awaiting user input");
});

it("CodeSearch todos: transitions open -> pending -> completed", async () => {
  const { CodeSearchStage } = await import("../../../js/agents/stages/codesearch/codesearch-stage.js");
  const { readFile, readdir, stat } = await import("node:fs/promises");

  const responses = [
    {
      content: JSON.stringify([
        { text: "Find entry point", priority: "medium", queryHints: ["entry", "index"], expectedEvidence: "entry file" },
      ]),
    },
    {
      content: JSON.stringify({
        thought: "Check root",
        todoIndex: 1,
        action: "list_dir",
        args: { path: "." },
        todoStatus: "completed",
      }),
    },
    { content: "Summary ok." },
  ];

  let callIndex = 0;
  const modelRouter = {
    call: async () => {
      const response = responses[Math.min(callIndex, responses.length - 1)];
      callIndex += 1;
      return response;
    },
  };

  const stage = new CodeSearchStage({ maxSteps: 2 });
  const result = await stage.execute(
    { runId: "run_codesearch_transition" },
    { query: "Inspect repo", basePath: "." },
    { modelRouter, fs: { readFile, readdir, stat } }
  );

  const todo = result.todos[0];
  const transitions = todo.history.map((row) => `${row.from}->${row.to}`);
  expect(transitions.includes("open->pending")).toBeTruthy();
  expect(transitions.includes("pending->completed")).toBeTruthy();
});
