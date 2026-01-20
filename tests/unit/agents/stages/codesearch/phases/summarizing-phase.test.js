import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockLoggerInfo,
  mockLoggerError,
  mockCreateLogger,
  mockCheckCancelled,
} = vi.hoisted(() => {
  const mockLoggerInfo = vi.fn();
  const mockLoggerError = vi.fn();
  const mockCreateLogger = vi.fn(() => ({
    info: mockLoggerInfo,
    error: mockLoggerError,
  }));
  const mockCheckCancelled = vi.fn();

  return {
    mockLoggerInfo,
    mockLoggerError,
    mockCreateLogger,
    mockCheckCancelled,
  };
});

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  createLogger: mockCreateLogger,
  checkCancelled: mockCheckCancelled,
}));

vi.mock("../../../../../../js/agents/stages/codesearch/prompts.js", () => ({
  CODESEARCH_SUMMARIZE_PROMPT: "Query:{QUERY}\nObservations:{OBSERVATIONS}",
}));

vi.mock("../../../../../../js/agents/stages/codesearch/states.js", () => ({
  TodoStatus: {
    COMPLETED: "completed",
    CANCELLED: "cancelled",
    OPEN: "open",
  },
}));

import {
  runSummarizingPhase,
  buildTodoCompletionStats,
} from "../../../../../../js/agents/stages/codesearch/phases/summarizing-phase.js";
import { TodoStatus } from "../../../../../../js/agents/stages/codesearch/states.js";

function createState({
  query = "Inspect repo",
  taskGoal = "Inspect repo",
  todos = [],
  observations = [],
  steps = [],
  finalThought = null,
} = {}) {
  return {
    query,
    taskGoal,
    observations,
    steps,
    todos,
    finalThought,
    budgetUsage: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildTodoCompletionStats", () => {
  it("counts completed/cancelled and treats other statuses as open", () => {
    const todos = [
      { todoId: "1", status: TodoStatus.COMPLETED },
      { todoId: "2", status: TodoStatus.CANCELLED },
      { todoId: "3", status: TodoStatus.OPEN },
      { todoId: "4", status: 0 },
      { todoId: "5", status: -1 },
      { todoId: "6", status: Number.MAX_SAFE_INTEGER },
      { todoId: "7", status: "" },
      { todoId: "8", status: " " },
      { todoId: "9", status: "1" },
      { todoId: "10", status: null },
      { todoId: "11" },
    ];

    expect(buildTodoCompletionStats(todos)).toEqual({
      total: 11,
      completed: 1,
      cancelled: 1,
      open: 9,
    });
  });

  it("returns zeros for null/undefined/empty inputs and non-arrays", () => {
    const empty = { total: 0, completed: 0, cancelled: 0, open: 0 };

    expect(buildTodoCompletionStats(null)).toEqual(empty);
    expect(buildTodoCompletionStats(undefined)).toEqual(empty);
    expect(buildTodoCompletionStats([])).toEqual(empty);
    expect(buildTodoCompletionStats({})).toEqual(empty);
    expect(buildTodoCompletionStats({ length: 1 })).toEqual(empty);
    expect(buildTodoCompletionStats("")).toEqual(empty);
  });
});

describe("runSummarizingPhase", () => {
  it("builds prompt, emits events, records usage, and returns summary", async () => {
    const callModel = vi.fn(async () => ({
      content: "Summary ok",
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    }));
    const budgetManager = {
      recordUsage: vi.fn(),
      getStats: vi.fn(() => ({ input: 2, output: 3 })),
    };
    const emit = vi.fn();
    const signal = new AbortController().signal;

    const state = createState({
      query: "Find",
      observations: ["obs1", "obs2"],
      steps: [{ step: 1 }],
      todos: [
        { todoId: "t1", status: TodoStatus.COMPLETED },
        { todoId: "t2", status: TodoStatus.CANCELLED },
      ],
    });

    const result = await runSummarizingPhase({
      state,
      callModel,
      budgetManager,
      emit,
      signal,
    });

    expect(mockCheckCancelled).toHaveBeenCalledWith(signal);
    expect(callModel).toHaveBeenCalledTimes(1);

    const [messages, options] = callModel.mock.calls[0];
    expect(messages[1].content).toBe(
      "Query:Find\nObservations:obs1\n\n---\n\nobs2"
    );
    expect(options).toEqual(
      expect.objectContaining({
        model: "auto",
        temperature: 0.3,
        maxTokens: 2000,
        signal,
      })
    );

    expect(budgetManager.recordUsage).toHaveBeenCalledWith({
      input: 2,
      output: 3,
    });
    expect(state.budgetUsage).toEqual({ input: 2, output: 3 });
    expect(result).toEqual({
      summary: "Summary ok",
      todoStats: { total: 2, completed: 1, cancelled: 1, open: 0 },
      budgetUsage: { input: 2, output: 3 },
    });
    expect(emit).toHaveBeenCalledWith("codesearch:summarizing_started", {
      steps: 1,
    });
    expect(emit).toHaveBeenCalledWith("codesearch:summarizing_completed", {
      todoStats: result.todoStats,
    });
    expect(mockLoggerInfo).toHaveBeenCalledWith("Starting summarizing phase");
    expect(mockLoggerInfo).toHaveBeenCalledWith("Summarizing phase completed", {
      todoStats: result.todoStats,
    });
  });

  it("uses taskGoal when query is empty and preserves whitespace query on rapid calls", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ content: "First" })
      .mockResolvedValueOnce({ content: "Second" });

    const firstState = createState({
      query: "",
      taskGoal: "Goal",
      observations: [],
      steps: [],
      todos: [],
    });
    const secondState = createState({
      query: "   ",
      taskGoal: "Ignored",
      observations: [],
      steps: [],
      todos: [],
    });

    const first = await runSummarizingPhase({
      state: firstState,
      callModel,
      emit: vi.fn(),
      signal: null,
    });
    const second = await runSummarizingPhase({
      state: secondState,
      callModel,
      emit: vi.fn(),
      signal: null,
    });

    expect(first.summary).toBe("First");
    expect(second.summary).toBe("Second");

    const firstPrompt = callModel.mock.calls[0][0][1].content;
    const secondPrompt = callModel.mock.calls[1][0][1].content;
    expect(firstPrompt).toContain("Query:Goal");
    expect(secondPrompt).toContain("Query:   ");
  });

  it("records usage when input/output are provided as strings", async () => {
    const callModel = vi.fn(async () => ({
      content: "Summary",
      usage: { input: "5", output: "7" },
    }));
    const budgetManager = {
      recordUsage: vi.fn(),
      getStats: vi.fn(() => null),
    };
    const state = createState({ observations: [], steps: [], todos: [] });

    await runSummarizingPhase({
      state,
      callModel,
      budgetManager,
      emit: vi.fn(),
      signal: null,
    });

    expect(budgetManager.recordUsage).toHaveBeenCalledWith({
      input: "5",
      output: "7",
    });
  });

  it("prefers response.text when content is missing", async () => {
    const callModel = vi.fn(async () => ({ text: "Text summary" }));
    const state = createState({ observations: ["obs"], steps: [], todos: [] });

    const result = await runSummarizingPhase({
      state,
      callModel,
      budgetManager: { getStats: vi.fn(() => null) },
      emit: vi.fn(),
      signal: null,
    });

    expect(result.summary).toBe("Text summary");
  });

  it("uses finalThought when response is empty", async () => {
    const callModel = vi.fn(async () => ({}));
    const state = createState({
      observations: [],
      steps: [],
      todos: [],
      finalThought: "final fallback",
    });

    const result = await runSummarizingPhase({
      state,
      callModel,
      budgetManager: { getStats: vi.fn(() => null) },
      emit: vi.fn(),
      signal: null,
    });

    expect(result.summary).toBe("final fallback");
    expect(result.budgetUsage).toBeNull();
  });

  it("uses default summary when response is empty and finalThought is missing", async () => {
    const callModel = vi.fn(async () => ({}));
    const state = createState({ observations: [], steps: [], todos: [] });

    const result = await runSummarizingPhase({
      state,
      callModel,
      budgetManager: undefined,
      emit: undefined,
      signal: null,
    });

    expect(result.summary).toBe("分析完成");
    expect(result.budgetUsage).toBeNull();
  });

  it("logs errors and falls back to finalThought on model failure", async () => {
    const callModel = vi.fn(async () => {
      throw "boom";
    });
    const state = createState({
      observations: ["obs"],
      steps: [{ step: 1 }],
      todos: [],
      finalThought: "fallback",
    });

    const result = await runSummarizingPhase({
      state,
      callModel,
      budgetManager: { getStats: vi.fn(() => null) },
      emit: vi.fn(),
      signal: null,
    });

    expect(result.summary).toBe("fallback");
    expect(mockLoggerError).toHaveBeenCalledWith("Summary generation failed", {
      error: "boom",
    });
  });

  it("falls back to step-count message on model failure without finalThought", async () => {
    const callModel = vi.fn(async () => {
      throw new Error("nope");
    });
    const state = createState({
      observations: [],
      steps: [{ step: 1 }, { step: 2 }, { step: 3 }],
      todos: [],
      finalThought: null,
    });

    const result = await runSummarizingPhase({
      state,
      callModel,
      budgetManager: undefined,
      emit: undefined,
      signal: null,
    });

    expect(result.summary).toBe("分析完成，共 3 步");
  });

  it("handles long strings and deep nested steps", async () => {
    const callModel = vi.fn(async () => ({ content: "ok" }));
    const longQuery = "q".repeat(5000);
    const hugeObservation = "x".repeat(12000);
    const deepSteps = [
      { level: { next: { inner: { value: { leaf: true } } } } },
    ];

    const state = createState({
      query: longQuery,
      observations: [hugeObservation],
      steps: deepSteps,
      todos: [],
    });

    const result = await runSummarizingPhase({
      state,
      callModel,
      budgetManager: undefined,
      emit: undefined,
      signal: null,
    });

    expect(result.summary).toBe("ok");
    const prompt = callModel.mock.calls[0][0][1].content;
    expect(prompt).toContain(longQuery);
    expect(prompt).toContain(hugeObservation);
  });

  it("supports concurrent invocations without leaking state", async () => {
    const callModel = vi.fn(async (messages) => {
      const prompt = messages[1].content;
      return { content: prompt.includes("Q1") ? "S1" : "S2" };
    });

    const firstState = createState({
      query: "Q1",
      observations: ["obs1"],
      steps: [],
      todos: [{ todoId: "1", status: TodoStatus.COMPLETED }],
    });
    const secondState = createState({
      query: "Q2",
      observations: ["obs2"],
      steps: [],
      todos: [{ todoId: "2", status: TodoStatus.CANCELLED }],
    });

    const [first, second] = await Promise.all([
      runSummarizingPhase({
        state: firstState,
        callModel,
        budgetManager: undefined,
        emit: vi.fn(),
        signal: null,
      }),
      runSummarizingPhase({
        state: secondState,
        callModel,
        budgetManager: undefined,
        emit: vi.fn(),
        signal: null,
      }),
    ]);

    expect(first.summary).toBe("S1");
    expect(second.summary).toBe("S2");
    expect(first.todoStats).toEqual({
      total: 1,
      completed: 1,
      cancelled: 0,
      open: 0,
    });
    expect(second.todoStats).toEqual({
      total: 1,
      completed: 0,
      cancelled: 1,
      open: 0,
    });
  });

  it("throws when cancelled before starting and does not call the model", async () => {
    const callModel = vi.fn();
    mockCheckCancelled.mockImplementationOnce(() => {
      throw new Error("cancelled");
    });

    const state = createState({ observations: [], steps: [], todos: [] });

    await expect(
      runSummarizingPhase({
        state,
        callModel,
        budgetManager: undefined,
        emit: vi.fn(),
        signal: null,
      })
    ).rejects.toThrow("cancelled");

    expect(callModel).not.toHaveBeenCalled();
  });
});
