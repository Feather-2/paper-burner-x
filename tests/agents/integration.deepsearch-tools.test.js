import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");

it("Integration: DeepSearch ToolExecutor runs multiple tools end-to-end", async () => {
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
  expect(r1.success).toBe(true);
  expect(r1.data.todo).toEqual(
    expect.objectContaining({
      todoId: expect.stringMatching(/^todo_/),
      text: "Do thing",
      status: "open",
    })
  );
  expect(state.todos.length).toBe(1);

  const r2 = await executor.execute(
    "record-finding",
    { type: "claim", content: "Finding", source: "doc1", lineStart: 1, lineEnd: 1 },
    { state, emit, sharedContext }
  );
  expect(r2.success).toBe(true);
  expect(r2.data.finding).toEqual(
    expect.objectContaining({
      id: expect.stringMatching(/^claim_[0-9a-z]+_[0-9a-f]{16}$/),
      type: "claim",
      content: "Finding",
      source: "doc1",
      lineStart: 1,
      lineEnd: 1,
      ref: "[doc1:L1]",
    })
  );
  expect(commits).toHaveLength(1);
  expect(commits[0]).toEqual({
    kind: "finding_claim",
    payload: expect.objectContaining({
      full: r2.data.finding,
    }),
  });

  expect(events).toHaveLength(2);
  expect(events[0]).toEqual({
    name: "deepsearch.todo.created",
    payload: {
      todoId: r1.data.todo.todoId,
      text: "Do thing",
    },
  });
  expect(events[1]).toEqual({
    name: "deepsearch.finding.claim",
    payload: expect.objectContaining({
      id: r2.data.finding.id,
      content: "Finding",
    }),
  });
});
