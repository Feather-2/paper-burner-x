import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  getModelCaller: vi.fn(),
  loadPrompt: vi.fn(),
  renderPromptTemplate: vi.fn(),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  validateTodo: vi.fn(),
  makeStageEmitter: vi.fn(),
  checkCancelled: vi.fn(),
  extractServices: vi.fn(),
}));

vi.mock("../../../../../js/agents/stages/deepsearch/model.js", () => ({
  getModelCaller: hoisted.getModelCaller,
}));

vi.mock("../../../../../js/agents/prompts/prompt-loader.js", () => ({
  loadPrompt: hoisted.loadPrompt,
  renderPromptTemplate: hoisted.renderPromptTemplate,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/utils/stage-api.js", () => ({
  extractServices: hoisted.extractServices,
}));

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: hoisted.createLogger,
  };
});

vi.mock("../../../../../js/agents/stages/deepsearch/utils/todo-utils.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/stages/deepsearch/utils/todo-utils.js");
  return {
    ...actual,
    validateTodo: hoisted.validateTodo,
  };
});

vi.mock("../../../../../js/agents/stages/deepsearch/state.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/stages/deepsearch/state.js");
  return {
    ...actual,
    checkCancelled: hoisted.checkCancelled,
    makeStageEmitter: hoisted.makeStageEmitter,
  };
});

const todosModulePath = "../../../../../js/agents/stages/deepsearch/todos.js";
const stateModulePath = "../../../../../js/agents/stages/deepsearch/state.js";
const todoUtilsPath = "../../../../../js/agents/stages/deepsearch/utils/todo-utils.js";

const makeStageApi = (overrides = {}) => ({ emit: vi.fn(), ...overrides });

let actualTodoUtils = null;

beforeEach(async () => {
  hoisted.getModelCaller.mockReset();
  hoisted.loadPrompt.mockReset();
  hoisted.renderPromptTemplate.mockReset();
  hoisted.validateTodo.mockReset();
  hoisted.makeStageEmitter.mockReset();
  hoisted.checkCancelled.mockReset();
  hoisted.extractServices.mockReset();
  hoisted.createLogger.mockClear();

  if (!actualTodoUtils) {
    actualTodoUtils = await vi.importActual(todoUtilsPath);
  }

  hoisted.getModelCaller.mockReturnValue(null);
  hoisted.loadPrompt.mockResolvedValue("SYSTEM: {{currentDate}} {{taskGoal}}");
  hoisted.renderPromptTemplate.mockImplementation((tpl) => tpl);
  hoisted.validateTodo.mockImplementation(actualTodoUtils.validateTodo);
  hoisted.makeStageEmitter.mockImplementation((stageApi) => stageApi?.emit);
  hoisted.checkCancelled.mockImplementation(() => {});
  hoisted.extractServices.mockImplementation((api) => ({ emit: api?.emit, logger: api?.logger }));
});

describe("runDeepSearchTodosStage", () => {
  it.each([
    ["null input", null],
    ["undefined input", undefined],
    ["empty object", {}],
    ["null state", { state: null }],
    ["undefined state", { state: undefined }],
  ])("throws when input.state is missing (%s)", async (_label, badInput) => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    await expect(runDeepSearchTodosStage(null, badInput, makeStageApi())).rejects.toThrow(/input\.state is required/);
  });

  it("skips LLM when existing todos are present", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const state = new DeepSearchState({ runId: "run_existing" });
    state.todos = [{ todoId: "todo_1", text: "existing todo", source: "user", status: "open", priority: "high" }];

    const stageApi = makeStageApi();
    const out = await runDeepSearchTodosStage(null, state, stageApi);

    expect(out.todos).toHaveLength(1);
    expect(out.created).toHaveLength(0);
    expect(hoisted.getModelCaller).not.toHaveBeenCalled();
    expect(hoisted.checkCancelled).toHaveBeenCalledWith(stageApi);
  });

  it("accepts input.state plain object and normalizes iteration string", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const out = await runDeepSearchTodosStage(
      null,
      { state: { runId: "run_from_json", iteration: "2", todos: [{ todoId: "t1", text: "existing", source: "user" }] } },
      makeStageApi()
    );

    expect(out.state).toBeInstanceOf(DeepSearchState);
    expect(out.state.iteration).toBe(2);
    expect(out.created).toHaveLength(0);
  });

  it("uses injected logger from stageApi when available", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const state = new DeepSearchState({ runId: "run_logger" });
    state.todos = [{ todoId: "todo_1", text: "existing todo", source: "user" }];

    const injectedLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await runDeepSearchTodosStage(null, state, makeStageApi({ logger: injectedLogger }));

    expect(hoisted.createLogger).not.toHaveBeenCalled();
  });

  it("creates todos from LLM JSON output and normalizes queryHints", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const callModel = vi.fn(async (_messages, opts) => {
      expect(opts).toEqual(expect.objectContaining({ cacheKeyInputs: expect.any(Object) }));
      return {
        content: '[{"text":"T1","priority":"high","queryHints":{"tag":"a"},"expectedEvidence":"e1"}]',
      };
    });
    hoisted.getModelCaller.mockReturnValue(callModel);

    const state = new DeepSearchState({ runId: "run_llm", taskGoal: "goal" });
    state.todos = [];

    const stageApi = makeStageApi({ getContextSummary: () => "ctx" });
    const out = await runDeepSearchTodosStage(null, state, stageApi);

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(out.created).toHaveLength(1);
    expect(out.created[0].source).toBe("llm");
    expect(Array.isArray(out.created[0].queryHints)).toBe(true);
    expect(typeof out.created[0].queryHints[0]).toBe("string");
    expect(stageApi.emit.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(["deepsearch.todos.started", "deepsearch.todo.created", "deepsearch.todos.completed"])
    );
  });

  it("supports LLM output shaped as { todos: [...] } and ignores extra fields", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    hoisted.getModelCaller.mockReturnValue(
      vi.fn(async () => ({
        content: '{"todos":[{"text":"T2","priority":"low","queryHints":["k"],"expectedEvidence":"e2","extra":"x"}]}',
      }))
    );

    const state = new DeepSearchState({ runId: "run_llm_object", taskGoal: "goal" });
    state.todos = [];

    const out = await runDeepSearchTodosStage(null, state, makeStageApi());
    const todo = out.todos.find((row) => row.text === "T2");

    expect(todo).toBeTruthy();
    expect(todo.extra).toBeUndefined();
  });

  it("falls back when LLM returns empty array", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    hoisted.getModelCaller.mockReturnValue(vi.fn(async () => ({ content: "[]" })));

    const state = new DeepSearchState({ runId: "run_empty_llm", taskGoal: "topic" });
    state.todos = [];

    const out = await runDeepSearchTodosStage(null, state, makeStageApi());
    expect(out.created.length).toBeGreaterThan(0);
    expect(out.created.some((row) => row.source === "system")).toBe(true);
  });

  it("falls back when LLM output exceeds size limit", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const hugeText = "x".repeat(13000);
    hoisted.getModelCaller.mockReturnValue(
      vi.fn(async () => ({
        content: JSON.stringify([
          { text: hugeText, priority: "high", queryHints: ["h"], expectedEvidence: "e" },
        ]),
      }))
    );

    const state = new DeepSearchState({ runId: "run_large_llm", taskGoal: "goal" });
    state.todos = [];

    const out = await runDeepSearchTodosStage(null, state, makeStageApi());
    expect(out.created.length).toBeGreaterThan(0);
  });

  it("falls back when LLM output is non-JSON text", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    hoisted.getModelCaller.mockReturnValue(
      vi.fn(async () => ({
        content: "This is plain text without any JSON",
      }))
    );

    const state = new DeepSearchState({ runId: "run_plain_text", taskGoal: "goal" });
    state.todos = [];

    const out = await runDeepSearchTodosStage(null, state, makeStageApi());
    expect(out.created.length).toBeGreaterThan(0);
  });

  it("uses default prompt when loadPrompt fails", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    hoisted.loadPrompt.mockRejectedValueOnce(new Error("missing prompt"));

    const callModel = vi.fn(async (messages) => {
      expect(messages[0]?.role).toBe("system");
      expect(String(messages[0]?.content || "")).toContain("You are a DeepSearch todo planner");
      return { content: "[]" };
    });
    hoisted.getModelCaller.mockReturnValue(callModel);

    const state = new DeepSearchState({ runId: "run_prompt_fallback", taskGoal: "goal" });
    state.todos = [];

    await runDeepSearchTodosStage(null, state, makeStageApi());
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("handles whitespace taskGoal and empty scanSummary object", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const state = new DeepSearchState({ runId: "run_whitespace" });
    state.taskGoal = "   ";
    state.todos = [];

    const out = await runDeepSearchTodosStage(null, { state, scanSummary: {} }, makeStageApi());
    expect(out.todos.length).toBeGreaterThan(0);
    expect(out.todos.every((row) => typeof row.text === "string" && row.text.trim())).toBe(true);
  });

  it("handles numeric taskGoal boundaries", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const stateZero = new DeepSearchState({ runId: "run_zero" });
    stateZero.taskGoal = 0;
    const outZero = await runDeepSearchTodosStage(null, stateZero, makeStageApi());
    expect(outZero.todos[0].text).toContain("0");

    const stateNeg = new DeepSearchState({ runId: "run_neg", taskGoal: -1 });
    const outNeg = await runDeepSearchTodosStage(null, stateNeg, makeStageApi());
    expect(outNeg.todos[0].text).toContain("-1");

    const stateMax = new DeepSearchState({ runId: "run_max", taskGoal: Number.MAX_SAFE_INTEGER });
    const outMax = await runDeepSearchTodosStage(null, stateMax, makeStageApi());
    expect(outMax.todos[0].text).toContain(String(Number.MAX_SAFE_INTEGER));
  });

  it("ensures last-resort fallback when all created todos are invalid", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    let calls = 0;
    hoisted.validateTodo.mockImplementation(() => {
      calls += 1;
      return { valid: calls > 3, issues: [] };
    });

    const state = new DeepSearchState({ runId: "run_last_resort", taskGoal: "topic" });
    state.todos = [];

    const out = await runDeepSearchTodosStage(
      null,
      { state, scanSummary: { keyTopics: ["a", "b"], summaryText: "" } },
      makeStageApi()
    );
    expect(out.created).toHaveLength(1);
    expect(out.created[0].priority).toBe("high");
    expect(hoisted.validateTodo).toHaveBeenCalledTimes(4);
  });

  it("handles object keyTopics and deep nested scanSummary", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const state = new DeepSearchState({ runId: "run_nested", taskGoal: "goal" });
    state.todos = [];

    const scanSummary = {
      keyTopics: { a: 1 },
      summaryText: "",
      nested: { a: { b: { c: { d: "deep" } } } },
    };

    const out = await runDeepSearchTodosStage(null, { state, scanSummary }, makeStageApi());
    expect(out.todos.length).toBeGreaterThan(0);
  });

  it("truncates cacheKeyInputs for long strings and accepts huge context", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const longGoal = "g".repeat(1000);
    const longSummary = "s".repeat(1000);
    const longTopics = ["k".repeat(120), "t".repeat(80)];

    const callModel = vi.fn(async (messages, opts) => {
      expect(opts.cacheKeyInputs.taskGoal.length).toBeLessThanOrEqual(200);
      expect(opts.cacheKeyInputs.summaryText.length).toBeLessThanOrEqual(320);
      expect(opts.cacheKeyInputs.keyTopics.every((t) => t.length <= 60)).toBe(true);
      expect(messages[1].content.startsWith("## Context\n")).toBe(true);
      return {
        content: '[{"text":"T3","priority":"high","queryHints":["q"],"expectedEvidence":"e"}]',
      };
    });
    hoisted.getModelCaller.mockReturnValue(callModel);

    const state = new DeepSearchState({ runId: "run_long", taskGoal: longGoal });
    state.todos = [];

    const stageApi = makeStageApi({ getContextSummary: () => "ctx".repeat(10000) });
    const out = await runDeepSearchTodosStage(null, { state, scanSummary: { summaryText: longSummary, keyTopics: longTopics } }, stageApi);

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(out.created.length).toBeGreaterThan(0);
  });

  it("supports concurrent calls without shared state", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const callModel = vi.fn(async (messages) => {
      const userContent = messages.find((row) => row.role === "user")?.content || "";
      if (userContent.includes("Goal A")) {
        return { content: '[{"text":"Todo A","priority":"high","queryHints":["a"],"expectedEvidence":"ea"}]' };
      }
      return { content: '[{"text":"Todo B","priority":"high","queryHints":["b"],"expectedEvidence":"eb"}]' };
    });
    hoisted.getModelCaller.mockReturnValue(callModel);

    const stateA = new DeepSearchState({ runId: "run_a", taskGoal: "Goal A" });
    const stateB = new DeepSearchState({ runId: "run_b", taskGoal: "Goal B" });
    stateA.todos = [];
    stateB.todos = [];

    const [outA, outB] = await Promise.all([
      runDeepSearchTodosStage(null, stateA, makeStageApi()),
      runDeepSearchTodosStage(null, stateB, makeStageApi()),
    ]);

    expect(outA.todos.some((row) => row.text === "Todo A")).toBe(true);
    expect(outB.todos.some((row) => row.text === "Todo B")).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("skips LLM on rapid repeated calls once todos exist", async () => {
    const { runDeepSearchTodosStage } = await import(todosModulePath);
    const { DeepSearchState } = await import(stateModulePath);

    const callModel = vi.fn(async () => ({
      content: '[{"text":"T4","priority":"high","queryHints":["q"],"expectedEvidence":"e"}]',
    }));
    hoisted.getModelCaller.mockReturnValue(callModel);

    const state = new DeepSearchState({ runId: "run_repeat", taskGoal: "goal" });
    state.todos = [];

    await runDeepSearchTodosStage(null, state, makeStageApi());
    await runDeepSearchTodosStage(null, state, makeStageApi());

    expect(hoisted.getModelCaller).toHaveBeenCalledTimes(1);
    expect(callModel).toHaveBeenCalledTimes(1);
  });
});
