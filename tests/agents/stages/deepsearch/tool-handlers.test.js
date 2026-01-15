import { describe, expect, it, vi } from "vitest";

import { DeepSearchState } from "../../../../js/agents/stages/deepsearch/state.js";
import { SourceManager } from "../../../../js/agents/stages/deepsearch/source-manager.js";

describe("deepsearch/tools handlers (unit)", () => {
  it("manage-todos: create/update/list/complete/cancel", async () => {
    const { handler } = await import("../../../../js/agents/stages/deepsearch/tools/manage-todos/handler.js");

    const emit = vi.fn();
    const state = { todos: [] };

    const created = await handler({ action: "create", text: "Do thing", priority: "high" }, { state, emit });
    expect(created.success).toBe(true);
    expect(created.todo?.todoId).toBeTruthy();
    expect(state.todos).toHaveLength(1);

    // Update without state.updateTodo (in-place branch)
    const todoId = created.todo.todoId;
    const updated = await handler({ action: "update", todoId, text: "Do thing (updated)", status: "in_progress" }, { state, emit });
    expect(updated.success).toBe(true);
    expect(updated.todo.text).toContain("updated");
    expect(updated.todo.status).toBe("in_progress");

    const listed = await handler({ action: "list" }, { state, emit });
    expect(listed.success).toBe(true);
    expect(listed.todos).toHaveLength(1);

    const completed = await handler({ action: "complete", todoId }, { state, emit });
    expect(completed.success).toBe(true);
    expect(completed.todo.status).toBe("completed");

    const cancelled = await handler({ action: "cancel", todoId }, { state, emit });
    expect(cancelled.success).toBe(true);
    expect(cancelled.todo.status).toBe("cancelled");
  });

  it("ask-user: errors when interactive mode missing, succeeds when waitForUserInput is available", async () => {
    const { handler } = await import("../../../../js/agents/stages/deepsearch/tools/ask-user/handler.js");
    const emit = vi.fn();

    const missing = await handler({ question: "q" }, { emit, stageApi: {} });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/Interactive mode/);

    const ok = await handler(
      { question: "q", options: ["a", "b"] },
      { emit, stageApi: { waitForUserInput: vi.fn(async () => "a") } }
    );
    expect(ok.success).toBe(true);
    expect(ok.answer).toBe("a");
  });

  it("list-docs: lists documents from SourceManager (supports injected sourceManager)", async () => {
    const { handler } = await import("../../../../js/agents/stages/deepsearch/tools/list-docs/handler.js");
    const emit = vi.fn();

    const state = {
      L0: {
        sources: [
          { sourceId: "s1", name: "Doc1", sourceText: "hello\nworld" },
          { sourceId: "s2", name: "Doc2", sourceText: "another" },
        ],
      },
    };

    const sourceManager = new SourceManager(state.L0.sources);
    const out = await handler({}, { state, emit, sourceManager });
    expect(out.success).toBe(true);
    expect(out.count).toBe(2);
    expect(out.docs.map((d) => d.sourceId)).toEqual(["s1", "s2"]);
  });

  it("read-doc: reads content and records readDocIds in state", async () => {
    const { handler } = await import("../../../../js/agents/stages/deepsearch/tools/read-doc/handler.js");
    const emit = vi.fn();

    const state = {
      L0: { sources: [{ sourceId: "s1", name: "Doc1", sourceText: "# H1\n\nBody" }] },
      L1: {},
    };

    const missing = await handler({}, { state, emit });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/sourceId is required/);

    const out = await handler({ sourceId: "s1", preview: true }, { state, emit });
    expect(out.success).toBe(true);
    expect(Array.isArray(state.L1.readDocIds)).toBe(true);
    expect(state.L1.readDocIds).toContain("s1");
  });

  it("evaluate-gaps: maps DiscoveryStatus -> GapStatus, syncs todo completion, and upserts discovery", async () => {
    const { handler } = await import("../../../../js/agents/stages/deepsearch/tools/evaluate-gaps/handler.js");
    const { DiscoveryStatus } = await import("../../../../js/agents/sdk/DiscoveryManager.js");
    const { GapStatus } = await import("../../../../js/agents/stages/deepsearch/states.js");

    const emit = vi.fn();
    const discoveryManager = {
      getEvidences: vi.fn(() => [{ id: "ev1" }]),
      upsertDiscovery: vi.fn(),
    };

    const state = new DeepSearchState({
      runId: "run_gaps",
      L1: { gaps: [{ gapId: "gap_1", status: GapStatus.OPEN }] },
      todos: [{ todoId: "todo_1", text: "fill gap", relatedGapId: "gap_1", status: "open", priority: "high" }],
    });
    state.updateTodo = vi.fn((todoId, updates) => {
      const t = state.todos.find((x) => x.todoId === todoId);
      if (!t) return null;
      Object.assign(t, updates);
      return t;
    });

    const out = await handler(
      { gapId: "gap_1", status: DiscoveryStatus.SATISFIED, analysis: "ok", hint: "next" },
      { state, emit, discoveryManager }
    );

    expect(out.success).toBe(true);
    expect(state.L1.gaps[0].status).toBe(GapStatus.FILLED);
    expect(state.updateTodo).toHaveBeenCalledWith("todo_1", { status: "completed" });
    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledWith("gap_1", expect.any(Object));
  });
});

