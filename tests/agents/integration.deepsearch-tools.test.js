const test = require("node:test");
const assert = require("node:assert/strict");

test("Integration: DeepSearch ToolExecutor runs multiple tools end-to-end", async () => {
  const { createDeepSearchToolExecutor } = await import("../../js/agents/stages/deepsearch/tools/index.js");

  const executor = createDeepSearchToolExecutor({ maxRetries: 0, timeoutMs: 1000 });

  const events = [];
  const commits = [];
  const seen = new Set();
  const emit = (name, payload) => events.push({ name, payload });
  const sharedContext = {
    hasSeen: (t) => seen.has(t),
    markSeen: (t) => seen.add(t),
    commit: (kind, payload) => commits.push({ kind, payload }),
    search: () => [],
  };

  const state = { todos: [], L1: {} };

  const r1 = await executor.execute("manage-todos", { action: "create", text: "Do thing" }, { state, emit, sharedContext });
  assert.equal(r1.success, true);
  assert.ok(r1.data.todo && r1.data.todo.todoId);
  assert.equal(state.todos.length, 1);

  const r2 = await executor.execute(
    "record-finding",
    { type: "claim", content: "Finding", source: "doc1", lineStart: 1, lineEnd: 1 },
    { state, emit, sharedContext }
  );
  assert.equal(r2.success, true);
  assert.ok(Array.isArray(commits) && commits.length >= 1);

  assert.ok(events.some((e) => e.name === "deepsearch.todo.created"));
  assert.ok(events.some((e) => e.name.startsWith("deepsearch.finding.")));
});

