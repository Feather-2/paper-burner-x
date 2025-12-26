const test = require("node:test");
const assert = require("node:assert/strict");

test("CodeSearch todos: planner generates todos and completion stats", async () => {
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

  assert.equal(result.todos.length, 1);
  assert.equal(result.todos[0].status, "completed");
  assert.deepEqual(result.todoCompletionStats, { total: 1, completed: 1, cancelled: 0 });
});

test("CodeSearch todos: LLM unavailable triggers awaitUserFeedback pause", async () => {
  const { CodeSearchStage } = await import("../../../js/agents/stages/codesearch/codesearch-stage.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const stage = new CodeSearchStage({ maxSteps: 1 });

  await assert.rejects(
    stage.execute({ runId: "run_codesearch_pause" }, { query: "Inspect repo" }, {}),
    (err) => err instanceof StagePausedError
  );

  assert.equal(stage.loopState?.awaitUserFeedback, true);
  assert.equal(stage.loopState?.pauseReason, "LLM unavailable, awaiting user input");
});

test("CodeSearch todos: transitions open -> pending -> completed", async () => {
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
  assert.ok(transitions.includes("open->pending"));
  assert.ok(transitions.includes("pending->completed"));
});
