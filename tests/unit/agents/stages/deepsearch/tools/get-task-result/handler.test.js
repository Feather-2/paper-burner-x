import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedTaskHandler = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
  waitForTask: vi.fn(),
}));

vi.mock(
  "../../../../../../../js/agents/stages/deepsearch/tools/task/handler.js",
  () => ({
    getTaskStatus: mockedTaskHandler.getTaskStatus,
    waitForTask: mockedTaskHandler.waitForTask,
  })
);

const modulePath =
  "../../../../../../../js/agents/stages/deepsearch/tools/get-task-result/handler.js";

const makeContext = (sharedContext) => ({ sharedContext });

async function loadModule() {
  return await import(modulePath);
}

beforeEach(() => {
  vi.resetModules();
  mockedTaskHandler.getTaskStatus.mockReset();
  mockedTaskHandler.waitForTask.mockReset();
});

describe("definition", () => {
  it("exposes expected metadata", async () => {
    const { definition } = await loadModule();

    expect(definition.name).toBe("get-task-result");
    expect(definition.priority).toBe("important");
    expect(definition.layer).toBe(0);
    expect(definition.description.length).toBeGreaterThan(0);
    expect(definition.parameters).toMatchObject({
      taskId: expect.any(String),
      wait: expect.any(String),
      timeout: expect.any(String),
    });
    expect(definition.activation.keywords).toContain("task");
    expect(definition.activation.phases).toContain("researching");
  });
});

describe("handler", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["empty array", []],
    ["empty object", {}],
    ["zero", 0],
    ["negative", -1],
    ["max safe integer", Number.MAX_SAFE_INTEGER],
  ])("returns error for %s taskId", async (_label, taskId) => {
    const { handler } = await loadModule();

    const result = await handler({ taskId }, makeContext());

    expect(result).toEqual({ success: false, error: "taskId is required" });
    expect(mockedTaskHandler.getTaskStatus).not.toHaveBeenCalled();
  });

  it("treats whitespace-only taskId as a string and returns not found", async () => {
    const { handler } = await loadModule();
    const taskId = "   ";

    mockedTaskHandler.getTaskStatus.mockReturnValue(undefined);

    const sharedContext = { getStoreKeys: vi.fn(() => []) };
    const result = await handler({ taskId }, makeContext(sharedContext));

    expect(mockedTaskHandler.getTaskStatus).toHaveBeenCalledWith(taskId);
    expect(result.success).toBe(false);
    expect(result.error).toBe(`Task not found: ${taskId}`);
    expect(result.available).toBeUndefined();
  });

  it("accepts numeric string taskId", async () => {
    const { handler } = await loadModule();
    const taskId = "123";

    mockedTaskHandler.getTaskStatus.mockReturnValue({
      status: "completed",
      summary: "ok",
      result: { value: 1 },
    });

    const result = await handler({ taskId }, makeContext());

    expect(mockedTaskHandler.getTaskStatus).toHaveBeenCalledWith(taskId);
    expect(result).toMatchObject({
      success: true,
      taskId,
      status: "completed",
      summary: "ok",
      result: { value: 1 },
    });
  });

  it.each([
    ["timeout 0", 0],
    ["timeout -1", -1],
    ["timeout MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["timeout as string", "60000"],
    ["timeout null (does not default)", null],
  ])("waits for running tasks when wait is true (%s)", async (_label, timeout) => {
    const { handler } = await loadModule();
    const taskId = "task_wait";

    mockedTaskHandler.getTaskStatus.mockReturnValue({ status: "running" });
    mockedTaskHandler.waitForTask.mockResolvedValue({
      status: "completed",
      summary: "done",
    });

    const result = await handler({ taskId, wait: true, timeout }, makeContext());

    expect(mockedTaskHandler.waitForTask).toHaveBeenCalledWith(taskId, timeout);
    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("done");
  });

  it("uses default timeout when timeout is omitted", async () => {
    const { handler } = await loadModule();
    const taskId = "task_wait_default_timeout";

    mockedTaskHandler.getTaskStatus.mockReturnValue({ status: "running" });
    mockedTaskHandler.waitForTask.mockResolvedValue({ status: "completed" });

    await handler({ taskId, wait: true }, makeContext());

    expect(mockedTaskHandler.waitForTask).toHaveBeenCalledWith(taskId, 60000);
  });

  it("treats truthy non-boolean wait as enabled", async () => {
    const { handler } = await loadModule();
    const taskId = "task_wait_truthy";

    mockedTaskHandler.getTaskStatus.mockReturnValue({ status: "running" });
    mockedTaskHandler.waitForTask.mockResolvedValue({ status: "completed" });

    const result = await handler(
      { taskId, wait: "true", timeout: 0 },
      makeContext()
    );

    expect(mockedTaskHandler.waitForTask).toHaveBeenCalledWith(taskId, 0);
    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("propagates waitForTask errors (error handling)", async () => {
    const { handler } = await loadModule();
    const taskId = "task_wait_error";

    mockedTaskHandler.getTaskStatus.mockReturnValue({ status: "running" });
    mockedTaskHandler.waitForTask.mockRejectedValue(new Error("boom"));

    await expect(handler({ taskId, wait: true }, makeContext())).rejects.toThrow(
      "boom"
    );
    expect(mockedTaskHandler.waitForTask).toHaveBeenCalledTimes(1);
  });

  it("does not wait when task is not running", async () => {
    const { handler } = await loadModule();
    const taskId = "task_done";

    mockedTaskHandler.getTaskStatus.mockReturnValue({
      status: "completed",
      summary: "done",
    });

    const result = await handler({ taskId, wait: true }, makeContext());

    expect(mockedTaskHandler.waitForTask).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("does not wait when task registry has no entry", async () => {
    const { handler } = await loadModule();
    const taskId = "task_missing_wait";

    mockedTaskHandler.getTaskStatus.mockReturnValue(undefined);

    const result = await handler({ taskId, wait: true }, makeContext());

    expect(mockedTaskHandler.waitForTask).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe(`Task not found: ${taskId}`);
  });

  it("does not wait when wait is false even if task is running", async () => {
    const { handler } = await loadModule();
    const taskId = "task_running";

    mockedTaskHandler.getTaskStatus.mockReturnValue({
      status: "running",
      summary: "partial",
    });

    const result = await handler({ taskId, wait: false }, makeContext());

    expect(mockedTaskHandler.waitForTask).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.status).toBe("running");
    expect(result.summary).toBe("partial");
  });

  it("merges sharedContext detail into task result when available", async () => {
    const { handler } = await loadModule();
    const taskId = "task_merge";

    mockedTaskHandler.getTaskStatus.mockReturnValue({
      status: "running",
      summary: "short",
      result: { value: "base" },
      startedAt: 10,
    });

    const sharedContext = {
      getDetail: vi.fn(() => ({
        status: "completed",
        summary: "full",
        result: { value: "detail" },
        completedAt: 20,
        error: null,
      })),
    };

    const result = await handler({ taskId }, makeContext(sharedContext));

    expect(sharedContext.getDetail).toHaveBeenCalledWith(taskId);
    expect(result).toMatchObject({
      success: true,
      taskId,
      status: "completed",
      summary: "full",
      result: { value: "detail" },
      startedAt: 10,
      completedAt: 20,
    });
  });

  it("ignores non-object sharedContext detail when merging", async () => {
    const { handler } = await loadModule();
    const taskId = "task_merge_non_object";

    mockedTaskHandler.getTaskStatus.mockReturnValue({
      status: "completed",
      summary: "base",
      result: { value: "base" },
    });

    const sharedContext = { getDetail: vi.fn(() => "not-an-object") };

    const result = await handler({ taskId }, makeContext(sharedContext));

    expect(sharedContext.getDetail).toHaveBeenCalledWith(taskId);
    expect(result).toMatchObject({
      success: true,
      taskId,
      status: "completed",
      summary: "base",
      result: { value: "base" },
    });
  });

  it("returns sharedContext detail when task registry has no entry", async () => {
    const { handler } = await loadModule();
    const taskId = "task_cached";
    const detail = {
      status: "completed",
      summary: "cached",
      result: { value: 5 },
    };

    mockedTaskHandler.getTaskStatus.mockReturnValue(undefined);

    const sharedContext = { getDetail: vi.fn(() => detail) };
    const result = await handler({ taskId }, makeContext(sharedContext));

    expect(result).toMatchObject({
      success: true,
      taskId,
      status: "completed",
      summary: "cached",
      result: { value: 5 },
      data: detail,
    });
  });

  it("handles empty detail objects with default status", async () => {
    const { handler } = await loadModule();
    const taskId = "task_empty_detail";

    mockedTaskHandler.getTaskStatus.mockReturnValue(undefined);

    const sharedContext = { getDetail: vi.fn(() => ({})) };
    const result = await handler({ taskId }, makeContext(sharedContext));

    expect(result.success).toBe(false);
    expect(result.status).toBe("completed");
    expect(result.data).toEqual({});
  });

  it("lists available task ids from sharedContext store keys", async () => {
    const { handler } = await loadModule();
    const taskId = "missing_task";

    mockedTaskHandler.getTaskStatus.mockReturnValue(undefined);

    const sharedContext = {
      getStoreKeys: vi.fn(() => ["task_1", "other", "task_2", 123, null]),
    };
    const result = await handler({ taskId }, makeContext(sharedContext));

    expect(result.success).toBe(false);
    expect(result.error).toBe(`Task not found: ${taskId}`);
    expect(result.available).toEqual(["task_1", "task_2"]);
  });

  it("ignores non-array store keys (object as array boundary)", async () => {
    const { handler } = await loadModule();

    mockedTaskHandler.getTaskStatus.mockReturnValue(undefined);

    const sharedContext = {
      getStoreKeys: vi.fn(() => ({ task_1: true })),
    };
    const result = await handler({ taskId: "task_missing" }, makeContext(sharedContext));

    expect(result.available).toBeUndefined();
  });

  it("supports concurrent calls with independent results", async () => {
    const { handler } = await loadModule();

    mockedTaskHandler.getTaskStatus.mockImplementation((taskId) => ({
      status: "completed",
      summary: `summary-${taskId}`,
      result: { id: taskId },
    }));

    const [first, second] = await Promise.all([
      handler({ taskId: "task_a" }, makeContext()),
      handler({ taskId: "task_b" }, makeContext()),
    ]);

    expect(first.summary).toBe("summary-task_a");
    expect(second.summary).toBe("summary-task_b");
    expect(mockedTaskHandler.getTaskStatus).toHaveBeenCalledTimes(2);
  });

  it("handles rapid consecutive calls without leaking state", async () => {
    const { handler } = await loadModule();
    const taskId = "task_seq";

    mockedTaskHandler.getTaskStatus
      .mockReturnValueOnce({ status: "running" })
      .mockReturnValueOnce({ status: "completed", summary: "done" });

    const first = await handler({ taskId }, makeContext());
    const second = await handler({ taskId }, makeContext());

    expect(first.status).toBe("running");
    expect(first.success).toBe(false);
    expect(second.status).toBe("completed");
    expect(second.success).toBe(true);
  });

  it("passes through large payloads and deep nested results", async () => {
    const { handler } = await loadModule();
    const taskId = "task_large";

    const largeString = "x".repeat(100000);
    const longSummary = "s".repeat(10000);
    const deepNested = {
      level1: { level2: { level3: { level4: { value: "deep" } } } },
    };
    const payload = { file: largeString, nested: deepNested };

    mockedTaskHandler.getTaskStatus.mockReturnValue({
      status: "completed",
      summary: longSummary,
      result: payload,
    });

    const result = await handler({ taskId }, makeContext());

    expect(result.success).toBe(true);
    expect(result.summary.length).toBe(longSummary.length);
    expect(result.result).toEqual(payload);
  });
});

describe("default export", () => {
  it("bundles definition and handler", async () => {
    const mod = await loadModule();

    expect(mod.default.definition).toBe(mod.definition);
    expect(mod.default.handler).toBe(mod.handler);
  });
});
