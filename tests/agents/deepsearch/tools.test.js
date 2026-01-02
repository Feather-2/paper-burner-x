const test = require("node:test");
const assert = require("node:assert/strict");

test("DeepSearch tools: export definitions + catalog prompt", async () => {
  const { tools, getToolDefinitions, getToolCatalogPrompt } = await import("../../../js/agents/stages/deepsearch/tools/index.js");

  assert.ok(tools && typeof tools === "object");
  assert.equal(typeof getToolDefinitions, "function");
  assert.equal(typeof getToolCatalogPrompt, "function");

  const defs = getToolDefinitions();
  assert.ok(Array.isArray(defs));
  assert.ok(defs.length >= 10);
  assert.ok(defs.some((d) => d?.name === "search-docs"));

  for (const [name, tool] of Object.entries(tools)) {
    assert.equal(typeof name, "string");
    assert.equal(typeof tool?.handler, "function");
    assert.ok(tool?.definition && typeof tool.definition.name === "string");
  }

  const prompt = getToolCatalogPrompt({ showPriority: true });
  assert.ok(prompt.includes("## 可用工具"));
});

test("DeepSearch tool: manage-todos create/list happy path", async () => {
  const { handler } = await import("../../../js/agents/stages/deepsearch/tools/manage-todos/handler.js");

  const state = { todos: [] };
  const out1 = await handler({ action: "create", text: "Do thing" }, { state, emit: () => {} });
  assert.equal(out1.success, true);
  assert.ok(out1.todo && out1.todo.todoId);

  const out2 = await handler({ action: "list" }, { state, emit: () => {} });
  assert.equal(out2.success, true);
  assert.equal(out2.todos.length, 1);
  assert.equal(out2.todos[0].text, "Do thing");
});

test("DeepSearch tool: record-finding batches and formats refs", async () => {
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

  assert.equal(out.success, true);
  assert.equal(out.recorded, 2);
  assert.ok(out.findings[0].ref.includes("[doc1:L10-L12]"));
  assert.ok(commits.length >= 2);
});
