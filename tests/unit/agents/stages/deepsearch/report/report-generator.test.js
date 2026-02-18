import { describe, it, expect, vi, beforeEach } from 'vitest';

const toNonEmptyStringMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: toNonEmptyStringMock,
  isPlainObject: vi.fn(),
  safeJsonParse: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/state.js", () => ({
  checkCancelled: vi.fn(),
  extractJsonCandidate: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/model.js", () => ({
  getModelCaller: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/report/citations.js", () => ({
  finalizeCitationsInMarkdown: vi.fn((markdown) => ({ markdown, citations: [] })),
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/report/write-utils.js", () => ({
  clampInt: vi.fn((value) => value),
  mapConcurrent: vi.fn(),
  normalizeStringArray: vi.fn((value) => (Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [])),
  resolveMaxParallelSections: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/utils/todo-utils.js", () => ({
  createTodoId: vi.fn(() => "todo_secure"),
}));

import { generatePlaceholderReport } from "../../../../../../js/agents/stages/deepsearch/report/report-generator.js";

beforeEach(() => {
  vi.clearAllMocks();
  toNonEmptyStringMock.mockImplementation((value) => {
    if (value === undefined || value === null) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
  });
});

describe("generatePlaceholderReport", () => {
  it("returns placeholder report with provided values and todo stats", () => {
    const todos = [
      { status: "completed" },
      { status: "cancelled" },
      { status: "completed" },
      { status: "open" },
      { status: "" },
      {},
    ];

    const result = generatePlaceholderReport({
      taskGoal: "Market research",
      completionReason: "Scope done",
      todos,
    });

    expect(result).toEqual(expect.objectContaining({
      title: "Market research",
      completionReason: "Scope done",
      isPlaceholder: true,
      sections: [],
      citations: [],
    }));
    expect(result.todoCompletionStats).toEqual({ total: 6, completed: 2, cancelled: 1 });
    expect(result.draftMarkdown).toBe(result.markdown);
    expect(result.draftMarkdown).toContain("# Market research");
    expect(result.draftMarkdown).toContain("Reason: Scope done");
    expect(result.draftMarkdown).toContain("Todo completion: total 6, completed 2, cancelled 1.");
  });

  it("falls back to defaults for empty inputs and nullish fields", () => {
    const cases = [
      {},
      { taskGoal: undefined, completionReason: undefined, todos: [] },
      { taskGoal: null, completionReason: null, todos: null },
      { taskGoal: "", completionReason: "   ", todos: [] },
      { taskGoal: "   ", completionReason: "", todos: [] },
    ];

    cases.forEach((input) => {
      const result = generatePlaceholderReport(input);
      expect(result.title).toBe("Research Report");
      expect(result.completionReason).toBe("All todos completed.");
      expect(result.todoCompletionStats).toEqual({ total: 0, completed: 0, cancelled: 0 });
    });
  });

  it("handles numeric boundaries and type mismatches", () => {
    const result = generatePlaceholderReport({
      taskGoal: 0,
      completionReason: -1,
      todos: {},
    });

    expect(result.title).toBe("0");
    expect(result.completionReason).toBe("-1");
    expect(result.todoCompletionStats).toEqual({ total: 0, completed: 0, cancelled: 0 });

    const stringNumber = generatePlaceholderReport({
      taskGoal: "123",
      completionReason: "456",
      todos: [{ status: 0 }, { status: -1 }, { status: "completed" }],
    });

    expect(stringNumber.title).toBe("123");
    expect(stringNumber.completionReason).toBe("456");
    expect(stringNumber.todoCompletionStats).toEqual({ total: 3, completed: 1, cancelled: 0 });

    const maxSafe = generatePlaceholderReport({
      taskGoal: Number.MAX_SAFE_INTEGER,
      completionReason: "ok",
      todos: [],
    });

    expect(maxSafe.title).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(maxSafe.todoCompletionStats).toEqual({ total: 0, completed: 0, cancelled: 0 });
  });

  it("handles large strings, deep nesting, and large todo lists", () => {
    const hugeTitle = "T".repeat(120000);
    const hugeReason = "line\n".repeat(5000).trim();

    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 200; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const baseTodos = Array.from({ length: 3000 }, (_, idx) => {
      const mod = idx % 3;
      return { status: mod === 0 ? "completed" : mod === 1 ? "cancelled" : "open" };
    });

    const todos = [...baseTodos, { status: deep }];
    const result = generatePlaceholderReport({
      taskGoal: hugeTitle,
      completionReason: hugeReason,
      todos,
    });

    expect(result.title).toBe(hugeTitle);
    expect(result.completionReason).toBe(hugeReason);
    expect(result.todoCompletionStats).toEqual({ total: 3001, completed: 1000, cancelled: 1000 });
    expect(result.draftMarkdown.startsWith(`# ${hugeTitle}`)).toBe(true);
  });

  it("supports concurrent calls without shared state", async () => {
    const inputs = [
      { taskGoal: "A", completionReason: "R1", todos: [{ status: "completed" }] },
      { taskGoal: "B", completionReason: "R2", todos: [{ status: "cancelled" }, { status: "completed" }] },
      { taskGoal: "C", completionReason: "R3", todos: [] },
    ];

    const results = await Promise.all(inputs.map((input) => Promise.resolve(generatePlaceholderReport(input))));

    expect(results).toHaveLength(3);
    expect(results[0].title).toBe("A");
    expect(results[0].todoCompletionStats).toEqual({ total: 1, completed: 1, cancelled: 0 });
    expect(results[1].title).toBe("B");
    expect(results[1].todoCompletionStats).toEqual({ total: 2, completed: 1, cancelled: 1 });
    expect(results[2].title).toBe("C");
    expect(results[2].todoCompletionStats).toEqual({ total: 0, completed: 0, cancelled: 0 });
    expect(results[0].sections).not.toBe(results[1].sections);
    expect(results[0].citations).not.toBe(results[1].citations);
  });

  it("supports rapid consecutive calls", () => {
    for (let i = 0; i < 200; i += 1) {
      const result = generatePlaceholderReport();
      expect(result.title).toBe("Research Report");
      expect(result.todoCompletionStats.total).toBe(0);
    }
  });

  it("throws on null args", () => {
    expect(() => generatePlaceholderReport(null)).toThrow();
  });
});
