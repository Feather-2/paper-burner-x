import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("DeepSearch tools: export definitions + catalog prompt", async () => {
  const { tools, getToolDefinitions, getToolCatalogPrompt } = await import("../../../../../../js/agents/stages/deepsearch/tools/index.js");

  expect(tools).toBeTypeOf("object");
  expect(tools).not.toBeNull();
  expect(typeof getToolDefinitions).toBe("function");
  expect(typeof getToolCatalogPrompt).toBe("function");

  const defs = getToolDefinitions();
  expect(defs).toBeInstanceOf(Array);
  expect(defs.length).toBeGreaterThanOrEqual(10);
  expect(defs.some(d => d?.name === "search-docs")).toBe(true);

  for (const [name, tool] of Object.entries(tools)) {
    expect(typeof name).toBe("string");
    expect(typeof tool?.handler).toBe("function");
    expect(tool?.definition).toBeTypeOf("object");
    expect(tool?.definition?.name).toBeTypeOf("string");
  }

  const prompt = getToolCatalogPrompt({ showPriority: true });
  expect(prompt).toContain("## 可用工具");
});

it("DeepSearch tool: manage-todos create/list happy path", async () => {
  const { handler } = await import("../../../../../../js/agents/stages/deepsearch/tools/manage-todos/handler.js");

  const state = { todos: [] };
  const out1 = await handler({ action: "create", text: "Do thing" }, { state, emit: () => {} });
  expect(out1.success).toBe(true);
  expect(out1.todo).toBeTypeOf("object");
  expect(out1.todo?.todoId).toBeTypeOf("string");

  const out2 = await handler({ action: "list" }, { state, emit: () => {} });
  expect(out2.success).toBe(true);
  expect(out2.todos.length).toBe(1);
  expect(out2.todos[0].text).toBe("Do thing");
});

it("DeepSearch tool: record-finding batches and formats refs", async () => {
  const { handler } = await import("../../../../../../js/agents/stages/deepsearch/tools/record-finding/handler.js");

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
  expect(out.findings[0].ref).toContain("[doc1:L10-L12]");
  expect(commits.length).toBeGreaterThanOrEqual(2);
});

it("DeepSearch tool: record-finding handles invalid items and duplicates", async () => {
  const { handler } = await import("../../../../../../js/agents/stages/deepsearch/tools/record-finding/handler.js");

  const seen = new Set(["Dup"]);
  const sharedContext = {
    hasSeen: (t) => seen.has(t),
    search: () => [],
  };

  const state = { L1: {} };
  const out = await handler(
    {
      findings: [
        null,
        { type: "claim", content: "Dup" },
        { type: "claim", content: "Valid" },
      ],
    },
    { state, emit: () => {}, sharedContext }
  );

  expect(out.success).toBe(true);
  expect(out.recorded).toBe(1);
  expect(out.skipped).toBe(2);
  expect(out.errors.map(e => e.error)).toEqual(["invalid_item", "duplicate"]);
});

it("DeepSearch tool: record-finding enforces gap budgets per call", async () => {
  const { handler } = await import("../../../../../../js/agents/stages/deepsearch/tools/record-finding/handler.js");

  const sharedContext = { search: () => [] };
  const state = { L1: {}, userConfig: { gaps: { maxNewGapsPerCall: 1 } } };

  const out = await handler(
    {
      findings: [
        { type: "gap", content: "Gap A" },
        { type: "gap", content: "Gap B" },
      ],
    },
    { state, emit: () => {}, sharedContext }
  );

  expect(out.success).toBe(true);
  expect(out.recorded).toBe(1);
  expect(out.skipped).toBe(1);
  expect(out.errors[0].error).toBe("gap_budget_exceeded");
});

it("DeepSearch tool: record-finding normalizes reversed line ranges", async () => {
  const { handler } = await import("../../../../../../js/agents/stages/deepsearch/tools/record-finding/handler.js");

  const state = { L1: {} };
  const out = await handler(
    { type: "claim", content: "Swap lines", source: "doc1", lineStart: 20, lineEnd: 10 },
    { state, emit: () => {} }
  );

  expect(out.success).toBe(true);
  expect(out.finding.lineStart).toBe(10);
  expect(out.finding.lineEnd).toBe(20);
  expect(out.finding.ref).toBe("[doc1:L10-L20]");
});
