import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("DeepSearch tools: export definitions + catalog prompt", async () => {
  const { tools, getToolDefinitions, getToolCatalogPrompt } = await import("../../../js/agents/stages/deepsearch/tools/index.js");

  expect(tools && typeof tools === "object").toBeTruthy();
  expect(typeof getToolDefinitions).toBe("function");
  expect(typeof getToolCatalogPrompt).toBe("function");

  const defs = getToolDefinitions();
  expect(Array.isArray(defs)).toBeTruthy();
  expect(defs.length >= 10).toBeTruthy();
  expect(defs.some(d => d?.name === "search-docs")).toBeTruthy();

  for (const [name, tool] of Object.entries(tools)) {
    expect(typeof name).toBe("string");
    expect(typeof tool?.handler).toBe("function");
    expect(tool?.definition && typeof tool.definition.name === "string").toBeTruthy();
  }

  const prompt = getToolCatalogPrompt({ showPriority: true });
  expect(prompt.includes("## 可用工具")).toBeTruthy();
});

it("DeepSearch tool: manage-todos create/list happy path", async () => {
  const { handler } = await import("../../../js/agents/stages/deepsearch/tools/manage-todos/handler.js");

  const state = { todos: [] };
  const out1 = await handler({ action: "create", text: "Do thing" }, { state, emit: () => {} });
  expect(out1.success).toBe(true);
  expect(out1.todo && out1.todo.todoId).toBeTruthy();

  const out2 = await handler({ action: "list" }, { state, emit: () => {} });
  expect(out2.success).toBe(true);
  expect(out2.todos.length).toBe(1);
  expect(out2.todos[0].text).toBe("Do thing");
});

it("DeepSearch tool: record-finding batches and formats refs", async () => {
  const { handler } = await import("../../../js/agents/stages/deepsearch/tools/record-finding/handler.js");

  const seen = new Set();
  const commits = [];
  const sharedContext = {
    hasSeen: (t) => seen.has(t),
    markSeen: (t) => seen.add(t),
    commit: (kind, payload) => commits.push({ kind, payload }),
    search: () => [],
  };

  const state = { L1: {} };
  const out = await handler(
    {
      findings: [
        { type: "claim", content: "Q3 revenue up", source: "doc1", lineStart: 10, lineEnd: 12, confidence: 0.9 },
        { type: "gap", content: "Missing Q4 numbers" },
      ],
    },
    { state, emit: () => {}, sharedContext }
  );

  expect(out.success).toBe(true);
  expect(out.recorded).toBe(2);
  expect(out.findings[0].ref.includes("[doc1:L10-L12]")).toBeTruthy();
  expect(commits.length >= 2).toBeTruthy();
});
