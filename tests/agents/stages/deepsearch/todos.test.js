import { describe, expect, it, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => {
  return {
    getModelCaller: vi.fn(),
    loadPrompt: vi.fn(async () => "SYSTEM: {{currentDate}} {{taskGoal}}"),
    renderPromptTemplate: vi.fn((tpl) => tpl),
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  };
});

vi.mock("../../../../js/agents/stages/deepsearch/model.js", () => ({
  getModelCaller: hoisted.getModelCaller,
}));

vi.mock("../../../../js/agents/prompts/prompt-loader.js", () => ({
  loadPrompt: hoisted.loadPrompt,
  renderPromptTemplate: hoisted.renderPromptTemplate,
}));

vi.mock("../../../../js/agents/stages/deepsearch/runtime/logger.js", () => ({
  createLogger: hoisted.createLogger,
}));

beforeEach(() => {
  // Clear one-off mockReturnValueOnce queues between tests.
  vi.clearAllMocks();
  hoisted.getModelCaller.mockReset();
  hoisted.loadPrompt.mockReset();
  hoisted.getModelCaller.mockReturnValue(null);
  hoisted.loadPrompt.mockResolvedValue("SYSTEM: {{currentDate}} {{taskGoal}}");
});

describe("deepsearch/todos stage", () => {
  it("throws when input.state is missing", async () => {
    const stageApi = { emit: vi.fn() };
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");

    await expect(runDeepSearchTodosStage(null, {}, stageApi)).rejects.toThrow(/input\.state is required/);
  });

  it("accepts input.state plain object (DeepSearchState.fromJSON)", async () => {
    const stageApi = { emit: vi.fn() };
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");

    const out = await runDeepSearchTodosStage(
      null,
      { state: { runId: "run_from_json", todos: [{ todoId: "t1", text: "existing", source: "user" }] } },
      stageApi
    );
    expect(out.state).toBeInstanceOf(DeepSearchState);
    expect(out.todos).toHaveLength(1);
    expect(out.created).toHaveLength(0);
  });

  it("returns existing todos and skips LLM", async () => {
    const stageApi = { emit: vi.fn() };
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");

    const state = new DeepSearchState({ runId: "run_existing" });
    state.todos = [{ todoId: "todo_1", text: "existing todo", source: "user", status: "open", priority: "high" }];

    const out = await runDeepSearchTodosStage(null, state, stageApi);
    expect(out.todos).toHaveLength(1);
    expect(out.created).toHaveLength(0);
    expect(hoisted.getModelCaller).not.toHaveBeenCalled();
  });

  it("uses injected logger from stageApi when available", async () => {
    const injectedLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const stageApi = { emit: vi.fn(), logger: injectedLogger };
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");

    const state = new DeepSearchState({ runId: "run_logger" });
    state.todos = [{ todoId: "todo_1", text: "existing todo", source: "user", status: "open", priority: "high" }];

    await runDeepSearchTodosStage(null, state, stageApi);
    expect(hoisted.createLogger).not.toHaveBeenCalled();
  });

  it("creates todos from LLM JSON output", async () => {
    const stageApi = { emit: vi.fn(), getContextSummary: () => "ctx" };
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");

    const callModel = vi.fn(async (_messages, opts) => {
      // ensure cacheKeyInputs are passed through
      expect(opts).toEqual(expect.objectContaining({ cacheKeyInputs: expect.any(Object) }));
      return { content: '[{"text":"T1","priority":"high","queryHints":["a"],"expectedEvidence":"e1"}]' };
    });
    hoisted.getModelCaller.mockReturnValue(callModel);

    const state = new DeepSearchState({ runId: "run_llm", taskGoal: "goal" });
    state.todos = [];

    const out = await runDeepSearchTodosStage(null, state, stageApi);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(out.created.length).toBeGreaterThan(0);
    expect(out.todos.some((t) => t.text === "T1")).toBe(true);
    expect(stageApi.emit).toHaveBeenCalledWith("deepsearch.todos.started", expect.any(Object));
    expect(stageApi.emit).toHaveBeenCalledWith("deepsearch.todo.created", expect.any(Object));
    expect(stageApi.emit).toHaveBeenCalledWith("deepsearch.todos.completed", expect.any(Object));
  });

  it("supports LLM output shaped as { todos: [...] }", async () => {
    const stageApi = { emit: vi.fn() };
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");

    hoisted.getModelCaller.mockReturnValue(
      vi.fn(async () => ({
        content: '{"todos":[{"text":"T2","priority":"low","queryHints":["k"],"expectedEvidence":"e2"}]}',
      }))
    );

    const state = new DeepSearchState({ runId: "run_llm_object", taskGoal: "goal" });
    state.todos = [];

    const out = await runDeepSearchTodosStage(null, state, stageApi);
    expect(out.todos.some((t) => t.text === "T2")).toBe(true);
  });

  it("falls back to heuristic todos when LLM is unavailable / invalid", async () => {
    const stageApi = { emit: vi.fn() };
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");

    hoisted.getModelCaller.mockReturnValue(null);

    const state = new DeepSearchState({ runId: "run_fallback", taskGoal: "research topic" });
    state.todos = [];

    const out = await runDeepSearchTodosStage(null, { state, scanSummary: { keyTopics: ["a", "b"], summaryText: "sum" } }, stageApi);
    expect(out.created.length).toBeGreaterThan(0);
    expect(out.todos.length).toBeGreaterThan(0);
  });

  it("falls back when callModel throws (tryLLMTodos catch)", async () => {
    const stageApi = { emit: vi.fn() };
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");

    hoisted.getModelCaller.mockReturnValue(
      vi.fn(async () => {
        throw new Error("llm down");
      })
    );

    const state = new DeepSearchState({ runId: "run_llm_throw", taskGoal: "topic" });
    state.todos = [];
    const out = await runDeepSearchTodosStage(null, state, stageApi);
    expect(out.todos.length).toBeGreaterThan(0);
  });

  it("falls back to DEFAULT_PROMPT when prompt load fails", async () => {
    const stageApi = { emit: vi.fn() };
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");

    hoisted.loadPrompt.mockRejectedValueOnce(new Error("missing prompt"));

    const callModel = vi.fn(async (messages) => {
      expect(messages[0]?.role).toBe("system");
      expect(String(messages[0]?.content || "")).toContain("You are a DeepSearch todo planner");
      return { content: "[]" };
    });
    hoisted.getModelCaller.mockReturnValueOnce(callModel);

    const state = new DeepSearchState({ runId: "run_prompt_fallback", taskGoal: "goal" });
    state.todos = [];

    await runDeepSearchTodosStage(null, state, stageApi);
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("ensures at least one todo via last-resort fallback when all created todos are invalid", async () => {
    const stageApi = { emit: vi.fn() };
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const { runDeepSearchTodosStage } = await import("../../../../js/agents/stages/deepsearch/todos.js");

    hoisted.getModelCaller.mockReturnValue(null);

    const state = new DeepSearchState({ runId: "run_last_resort", taskGoal: "topic" });
    state.todos = [];

    const originalAddTodo = state.addTodo.bind(state);
    let calls = 0;
    state.addTodo = vi.fn((params) => {
      calls += 1;
      // Make the heuristic fallback todos invalid so the stage reaches last-resort fallback.
      if (calls <= 3) {
        const invalid = {
          todoId: `bad_${calls}`,
          text: "",
          priority: "medium",
          status: "open",
          queryHints: [],
          expectedEvidence: "",
          source: "system",
          history: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.todos.push(invalid);
        return invalid;
      }
      return originalAddTodo(params);
    });

    const out = await runDeepSearchTodosStage(null, { state, scanSummary: { keyTopics: ["a", "b"], summaryText: "" } }, stageApi);
    expect(out.todos.length).toBeGreaterThan(0);
    expect(out.todos.some((t) => String(t.text || "").includes("结构化研究摘要"))).toBe(true);
  });
});
