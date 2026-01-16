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
  expect(r1.data.todo && r1.data.todo.todoId).toBeTruthy();
  expect(state.todos.length).toBe(1);

  const r2 = await executor.execute(
    "record-finding",
    { type: "claim", content: "Finding", source: "doc1", lineStart: 1, lineEnd: 1 },
    { state, emit, sharedContext }
  );
  expect(r2.success).toBe(true);
  expect(Array.isArray(commits ) && commits.length >= 1).toBeTruthy();

  expect(events.some(e => e.name === "deepsearch.todo.created")).toBeTruthy();
  expect(events.some(e => e.name.startsWith("deepsearch.finding."))).toBeTruthy();
});

