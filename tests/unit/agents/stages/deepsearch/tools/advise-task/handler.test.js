import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../../js/agents/stages/deepsearch/tools/task/handler.js", () => ({
  getTaskStatus: vi.fn(),
}));

import { definition, handler, default as defaultExport } from "../../../../../../../js/agents/stages/deepsearch/tools/advise-task/handler.js";
import { getTaskStatus } from "../../../../../../../js/agents/stages/deepsearch/tools/task/handler.js";

const mockedGetTaskStatus = vi.mocked(getTaskStatus);

const makeSharedContext = () => {
  let counter = 0;
  return {
    signal: vi.fn((kind, payload) => {
      counter += 1;
      return { id: `signal-${counter}`, kind, payload };
    }),
  };
};

const makeContext = (overrides = {}) => ({
  sharedContext: makeSharedContext(),
  emit: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  mockedGetTaskStatus.mockReset();
});

describe("definition", () => {
  it("exposes expected metadata", () => {
    expect(definition).toMatchObject({
      name: "advise-task",
      description: expect.any(String),
      priority: "important",
      layer: 0,
    });
    expect(definition.parameters).toMatchObject({
      taskId: expect.any(String),
      advice: expect.any(String),
      priority: expect.any(String),
      type: expect.any(String),
    });
    expect(definition.activation).toMatchObject({
      keywords: expect.any(Array),
      phases: expect.any(Array),
    });
  });
});

describe("handler", () => {
  it("returns error when taskId is missing (undefined/null/empty/0)", async () => {
    const context = makeContext();
    const cases = [undefined, null, "", 0];

    for (const taskId of cases) {
      const result = await handler({ taskId, advice: "ok" }, context);
      expect(result).toEqual({ success: false, error: "taskId is required" });
    }

    expect(mockedGetTaskStatus).not.toHaveBeenCalled();
    expect(context.sharedContext.signal).not.toHaveBeenCalled();
    expect(context.emit).not.toHaveBeenCalled();
  });

  it("returns error when advice is missing (undefined/null/empty)", async () => {
    const context = makeContext();
    const cases = [undefined, null, ""];

    for (const advice of cases) {
      const result = await handler({ taskId: "task-1", advice }, context);
      expect(result).toEqual({ success: false, error: "advice is required" });
    }

    expect(mockedGetTaskStatus).not.toHaveBeenCalled();
    expect(context.sharedContext.signal).not.toHaveBeenCalled();
  });

  it("returns error when task is not found", async () => {
    mockedGetTaskStatus.mockReturnValue(null);
    const context = makeContext();

    const result = await handler({ taskId: "missing-task", advice: "ok" }, context);

    expect(result).toMatchObject({
      success: false,
      error: "Task not found: missing-task",
    });
    expect(result.hint).toBeTypeOf("string");
    expect(context.sharedContext.signal).not.toHaveBeenCalled();
  });

  it("returns error when task is not running", async () => {
    mockedGetTaskStatus.mockReturnValue({ status: "completed" });
    const context = makeContext();

    const result = await handler({ taskId: "task-2", advice: "ok" }, context);

    expect(result).toMatchObject({
      success: false,
      error: "Task task-2 is not running (status: completed)",
    });
    expect(result.hint).toBeTypeOf("string");
    expect(context.sharedContext.signal).not.toHaveBeenCalled();
  });

  it("returns error when sharedContext is missing", async () => {
    mockedGetTaskStatus.mockReturnValue({ status: "running" });
    const context = makeContext({ sharedContext: null });

    const result = await handler({ taskId: "task-3", advice: "ok" }, context);

    expect(result).toEqual({ success: false, error: "sharedContext not available" });
    expect(context.emit).not.toHaveBeenCalled();
  });

  it("sends advice and emits event for running task", async () => {
    mockedGetTaskStatus.mockReturnValue({ status: "running" });
    const context = makeContext();

    const result = await handler(
      { taskId: "task-4", advice: "do it", priority: "high", type: "redirect" },
      context
    );

    expect(context.sharedContext.signal).toHaveBeenCalledTimes(1);
    expect(context.sharedContext.signal).toHaveBeenCalledWith(
      "advice",
      expect.objectContaining({
        type: "advice",
        targetTaskId: "task-4",
        adviceType: "redirect",
        priority: "high",
        message: "do it",
        from: "main_agent",
        ts: expect.any(Number),
      })
    );
    expect(context.emit).toHaveBeenCalledWith("deepsearch:advice_sent", {
      taskId: "task-4",
      advice: "do it",
      priority: "high",
      type: "redirect",
    });
    expect(result).toMatchObject({
      success: true,
      taskId: "task-4",
      signalId: "signal-1",
      adviceType: "redirect",
      priority: "high",
    });
    expect(result.message).toContain("task-4");
    expect(result.hint).toBeTypeOf("string");
  });

  it("accepts whitespace strings for taskId and advice", async () => {
    mockedGetTaskStatus.mockReturnValue({ status: "running" });
    const context = makeContext();
    const taskId = "   ";
    const advice = " \t ";

    const result = await handler({ taskId, advice }, context);

    expect(result.success).toBe(true);
    const payload = context.sharedContext.signal.mock.calls[0][1];
    expect(payload.targetTaskId).toBe(taskId);
    expect(payload.message).toBe(advice);
    expect(payload.priority).toBe("normal");
    expect(payload.adviceType).toBe("hint");
  });

  it("accepts empty array and empty object advice values", async () => {
    mockedGetTaskStatus.mockImplementation(() => ({ status: "running" }));
    const context = makeContext();
    const adviceCases = [[], {}];
    const results = [];

    for (const advice of adviceCases) {
      results.push(await handler({ taskId: "task-empty", advice }, context));
    }

    expect(context.sharedContext.signal).toHaveBeenCalledTimes(2);
    expect(context.sharedContext.signal.mock.calls[0][1].message).toBe(adviceCases[0]);
    expect(context.sharedContext.signal.mock.calls[1][1].message).toBe(adviceCases[1]);
    for (const result of results) {
      expect(result.success).toBe(true);
    }
  });

  it("accepts boundary taskId values (-1, MAX_SAFE_INTEGER, numeric-string)", async () => {
    mockedGetTaskStatus.mockImplementation(() => ({ status: "running" }));
    const context = makeContext();
    const cases = [-1, Number.MAX_SAFE_INTEGER, "123"];
    const results = [];

    for (const taskId of cases) {
      results.push(await handler({ taskId, advice: "ok" }, context));
    }

    expect(mockedGetTaskStatus.mock.calls.map((call) => call[0])).toEqual(cases);
    expect(results.every((result) => result.success)).toBe(true);
  });

  it("passes through array-like object priority", async () => {
    mockedGetTaskStatus.mockReturnValue({ status: "running" });
    const context = makeContext();
    const arrayLikePriority = { 0: "high", length: 1 };

    const result = await handler(
      { taskId: "task-array-like", advice: "ok", priority: arrayLikePriority },
      context
    );

    const payload = context.sharedContext.signal.mock.calls[0][1];
    expect(payload.priority).toBe(arrayLikePriority);
    expect(result.priority).toBe(arrayLikePriority);
  });

  it("handles concurrent calls", async () => {
    mockedGetTaskStatus.mockImplementation(() => ({ status: "running" }));
    const sharedContext = makeSharedContext();
    const emit = vi.fn();
    const context = { sharedContext, emit };

    const [resultA, resultB] = await Promise.all([
      handler({ taskId: "task-a", advice: "a" }, context),
      handler({ taskId: "task-b", advice: "b" }, context),
    ]);

    expect(sharedContext.signal).toHaveBeenCalledTimes(2);
    expect(new Set([resultA.signalId, resultB.signalId]).size).toBe(2);
    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
  });

  it("handles rapid sequential calls", async () => {
    mockedGetTaskStatus.mockImplementation(() => ({ status: "running" }));
    const context = makeContext();
    const results = [];

    for (let i = 0; i < 3; i += 1) {
      results.push(await handler({ taskId: `task-${i}`, advice: `msg-${i}` }, context));
    }

    expect(context.sharedContext.signal).toHaveBeenCalledTimes(3);
    expect(context.emit).toHaveBeenCalledTimes(3);
    expect(results.every((result) => result.success)).toBe(true);
  });

  it("handles large advice payloads (long string / large file boundary)", async () => {
    mockedGetTaskStatus.mockReturnValue({ status: "running" });
    const largeAdvice = "x".repeat(100000);
    const sharedContext = makeSharedContext();
    const context = { sharedContext };

    const result = await handler({ taskId: "task-large", advice: largeAdvice }, context);

    expect(result.success).toBe(true);
    const payload = sharedContext.signal.mock.calls[0][1];
    expect(payload.message).toBe(largeAdvice);
    expect(payload.message.length).toBe(largeAdvice.length);
    expect(payload.priority).toBe("normal");
    expect(payload.adviceType).toBe("hint");
  });

  it("handles deeply nested advice payloads", async () => {
    mockedGetTaskStatus.mockReturnValue({ status: "running" });
    const nestedAdvice = {
      level1: { level2: { level3: { level4: { level5: { value: "x" } } } } },
    };
    const context = makeContext();

    const result = await handler({ taskId: "task-nested", advice: nestedAdvice }, context);

    expect(result.success).toBe(true);
    expect(context.sharedContext.signal.mock.calls[0][1].message).toBe(nestedAdvice);
  });
});

describe("default", () => {
  it("exports definition and handler", () => {
    expect(defaultExport).toMatchObject({ definition, handler });
  });
});
