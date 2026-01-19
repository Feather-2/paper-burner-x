import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  runSummarizingPhase,
  buildTodoCompletionStats,
} from '../../../../../../js/agents/stages/codesearch/phases/summarizing-phase.js';
import { TodoStatus } from '../../../../../../js/agents/stages/codesearch/states.js';

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

describe("codesearch/phases/summarizing-phase", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("buildTodoCompletionStats counts completed/cancelled/open", () => {
    expect(
      buildTodoCompletionStats([
        { todoId: "1", status: TodoStatus.COMPLETED },
        { todoId: "2", status: TodoStatus.CANCELLED },
        { todoId: "3", status: TodoStatus.OPEN },
      ])
    ).toEqual({ total: 3, completed: 1, cancelled: 1, open: 1 });
  });

  it("buildTodoCompletionStats tolerates null/undefined", () => {
    expect(buildTodoCompletionStats(null)).toEqual({ total: 0, completed: 0, cancelled: 0, open: 0 });
    expect(buildTodoCompletionStats(undefined)).toEqual({ total: 0, completed: 0, cancelled: 0, open: 0 });
  });

  it("runSummarizingPhase calls model, records budget usage, and sets budgetUsage from getStats()", async () => {
    const callModel = vi.fn(async () => ({
      content: "Summary ok",
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    }));
    const budgetManager = {
      recordUsage: vi.fn(),
      getStats: vi.fn(() => ({ input: 5, output: 7, total: 12 })),
    };
    const emit = vi.fn();

    const state = createState({
      todos: [{ todoId: "t1", status: TodoStatus.COMPLETED }],
      observations: ["obs1"],
      steps: [{ step: 1 }],
    });

    const res = await runSummarizingPhase({ state, callModel, budgetManager, emit, signal: null });

    expect(res.summary).toBe("Summary ok");
    expect(res.todoStats).toEqual({ total: 1, completed: 1, cancelled: 0, open: 0 });
    expect(budgetManager.recordUsage).toHaveBeenCalledWith({ input: 5, output: 7 });
    expect(state.budgetUsage).toEqual({ input: 5, output: 7, total: 12 });
    expect(res.budgetUsage).toEqual({ input: 5, output: 7, total: 12 });
    expect(emit).toHaveBeenCalledWith("codesearch.summarizing.started", { steps: 1 });
    expect(emit).toHaveBeenCalledWith("codesearch.summarizing.completed", { todoStats: res.todoStats });
  });

  it("uses taskGoal as query fallback and records usage.input/output when provided", async () => {
    const callModel = vi.fn(async () => ({
      content: "Summary ok",
      usage: { input: 1, output: 2 },
    }));
    const budgetManager = { recordUsage: vi.fn(), getStats: vi.fn(() => null) };
    const state = createState({ query: "", taskGoal: "TG", observations: ["obs"], steps: [], todos: [] });

    const res = await runSummarizingPhase({ state, callModel, budgetManager, emit: vi.fn(), signal: null });

    expect(res.summary).toBe("Summary ok");
    expect(budgetManager.recordUsage).toHaveBeenCalledWith({ input: 1, output: 2 });

    const firstCallMessages = callModel.mock.calls[0][0];
    expect(firstCallMessages[1].content).toContain("用户查询：TG");
  });

  it("runSummarizingPhase prefers response.text when content is missing", async () => {
    const callModel = vi.fn(async () => ({ text: "Text summary" }));
    const state = createState({ observations: ["obs"], steps: [], todos: [] });
    const res = await runSummarizingPhase({ state, callModel, budgetManager: { getStats: vi.fn(() => null) }, emit: vi.fn(), signal: null });
    expect(res.summary).toBe("Text summary");
  });

  it("runSummarizingPhase uses default summary when response is empty and no finalThought exists", async () => {
    const callModel = vi.fn(async () => ({}));
    const state = createState({ observations: ["obs"], steps: [], todos: [], finalThought: null });
    const res = await runSummarizingPhase({ state, callModel, budgetManager: undefined, emit: undefined, signal: null });
    expect(res.summary).toBe("分析完成");
    expect(res.budgetUsage).toBeNull();
  });

  it("runSummarizingPhase falls back to finalThought when model call fails", async () => {
    const callModel = vi.fn(async () => {
      throw new Error("nope");
    });
    const budgetManager = { getStats: vi.fn(() => null) };

    const state = createState({
      finalThought: "final fallback",
      observations: ["obs1"],
      steps: [{ step: 1 }, { step: 2 }],
      todos: [],
    });

    const res = await runSummarizingPhase({ state, callModel, budgetManager, emit: vi.fn(), signal: null });
    expect(res.summary).toBe("final fallback");
  });

  it("runSummarizingPhase falls back to step-count message when model call fails and finalThought is missing", async () => {
    const callModel = vi.fn(async () => {
      throw new Error("nope");
    });
    const state = createState({ finalThought: null, steps: [{ step: 1 }, { step: 2 }, { step: 3 }] });
    const res = await runSummarizingPhase({ state, callModel, budgetManager: undefined, emit: undefined, signal: null });
    expect(res.summary).toContain("分析完成，共 3 步");
  });
});
