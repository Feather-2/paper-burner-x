import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => {
  let idCounter = 0;
  const resetIds = () => {
    idCounter = 0;
  };
  const logger = { warn: vi.fn(), error: vi.fn() };
  const createLogger = vi.fn(() => logger);
  const makeSecureTimestampedId = vi.fn(() => `task_${++idCounter}`);
  const registry = {
    getFactory: vi.fn(),
    getAvailableTypes: vi.fn(() => []),
  };

  class MockSourceManager {
    constructor(sources = []) {
      this.sources = Array.isArray(sources) ? sources : [];
    }

    syncSources(sources) {
      if (Array.isArray(sources)) {
        this.sources = sources;
      }
    }

    getSource(id) {
      return this.sources.find((source) => source && source.id === id);
    }
  }

  return {
    resetIds,
    logger,
    createLogger,
    makeSecureTimestampedId,
    registry,
    MockSourceManager,
  };
});

vi.mock("../../../../../../../js/agents/sdk/SubagentRegistry.js", () => ({
  globalSubagentRegistry: hoisted.registry,
}));

vi.mock("../../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: hoisted.createLogger,
    makeSecureTimestampedId: hoisted.makeSecureTimestampedId,
  };
});

vi.mock("../../../../../../../js/agents/stages/deepsearch/source-manager.js", () => ({
  default: hoisted.MockSourceManager,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/subagents.js", () => ({}));

import SourceManager from "../../../../../../../js/agents/stages/deepsearch/source-manager.js";
import taskModule, {
  definition,
  handler,
  getTaskManager,
  resetTaskManager,
  getTaskStatus,
  waitForTask,
} from "../../../../../../../js/agents/stages/deepsearch/tools/task/handler.js";

const createState = (sources = []) => ({
  L0: { sources },
});

const createContext = (overrides = {}) => ({
  state: createState(),
  emit: vi.fn(),
  stageApi: { env: {} },
  sharedContext: { store: vi.fn(), setSummary: vi.fn() },
  ...overrides,
});

const createSubagentFactory = (runImpl) => {
  const run = vi.fn(runImpl);
  const factory = vi.fn(async () => ({ run }));
  return { factory, run };
};

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const awaitTaskCompletion = async (taskId) => {
  const task = getTaskManager().get(taskId);
  if (task?.promise) {
    await task.promise;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.resetIds();
  hoisted.registry.getAvailableTypes.mockReturnValue([
    { type: "researcher" },
    { type: "analyzer" },
  ]);
  hoisted.registry.getFactory.mockReturnValue(null);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
});

afterEach(async () => {
  await resetTaskManager();
  vi.useRealTimers();
});

describe("definition", () => {
  it("exposes task metadata", () => {
    expect(definition).toMatchObject({
      name: "Task",
      description: expect.any(String),
      parameters: expect.any(Object),
      activation: expect.any(Object),
    });
    expect(definition.parameters).toEqual(
      expect.objectContaining({
        prompt: expect.any(String),
        subagent_type: expect.any(String),
        async: expect.any(String),
      })
    );
  });
});

describe("getTaskManager", () => {
  it("returns a singleton and tracks running tasks", () => {
    const mgr1 = getTaskManager();
    const mgr2 = getTaskManager();
    expect(mgr1).toBe(mgr2);

    mgr1.set("t1", { taskId: "t1", status: "running" });
    mgr1.set("t2", { taskId: "t2", status: "completed" });

    expect(mgr2.size).toBe(2);
    expect(mgr2.runningCount).toBe(1);
  });
});

describe("resetTaskManager", () => {
  it("is safe when no manager exists", async () => {
    await resetTaskManager();
    const mgr = getTaskManager();
    expect(mgr).toBeDefined();
  });

  it("creates a new manager after reset", async () => {
    const mgr1 = getTaskManager();
    mgr1.set("t1", { taskId: "t1", status: "running" });

    await resetTaskManager();
    const mgr2 = getTaskManager();
    expect(mgr2).not.toBe(mgr1);
    expect(mgr2.size).toBe(0);
  });
});

describe("handler", () => {
  it.each([null, "", "   ", "invalid"])("rejects invalid subagent_type %j", async (value) => {
    const result = await handler({ subagent_type: value, prompt: "ok" }, createContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid subagent_type");
    expect(hoisted.registry.getFactory).not.toHaveBeenCalled();
  });

  it("rejects empty args object", async () => {
    const result = await handler({}, createContext());

    expect(result.success).toBe(false);
    expect(result.error).toBe("prompt must be a non-empty string");
    expect(hoisted.registry.getFactory).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", "   ", 0, {}, []])("rejects invalid prompt %j", async (value) => {
    const result = await handler({ prompt: value }, createContext());

    expect(result.success).toBe(false);
    expect(result.error).toBe("prompt must be a non-empty string");
    expect(hoisted.registry.getFactory).not.toHaveBeenCalled();
  });

  it("rejects overly long prompts", async () => {
    const longPrompt = "a".repeat(50001);
    const result = await handler({ prompt: longPrompt }, createContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("prompt exceeds maximum length");
  });

  it.each([null, {}, "s1", 123])("rejects non-array sourceIds %j", async (value) => {
    const result = await handler({ prompt: "ok", sourceIds: value }, createContext());

    expect(result.success).toBe(false);
    expect(result.error).toBe("sourceIds must be an array of strings");
    expect(hoisted.registry.getFactory).not.toHaveBeenCalled();
  });

  it("returns error when subagent factory is missing", async () => {
    const result = await handler({ subagent_type: "researcher", prompt: "ok" }, createContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown subagent type");
  });

  it("starts async tasks, filters sources, and compacts results", async () => {
    const sources = [
      { id: "s1", text: "doc1" },
      { id: "s2", text: "doc2" },
    ];
    const sourceManager = new SourceManager(sources);
    const state = createState(sources);
    const emit = vi.fn();
    const sharedContext = { store: vi.fn(), setSummary: vi.fn() };
    const stageApi = { env: { DEEPSEARCH_TASK_RESULT_PREVIEW_CHARS: "5" } };

    const report = "R".repeat(20);
    const analysis = "A".repeat(20);
    const findings = [[[["deep"]]]];
    const resultPayload = { ok: true, summary: "All good", report, analysis, findings };

    const { factory, run } = createSubagentFactory(async () => resultPayload);
    hoisted.registry.getFactory.mockReturnValue(factory);

    const result = await handler(
      {
        subagent_type: "researcher",
        prompt: "do it",
        sourceIds: ["s1", "", "   ", 123],
        async: true,
      },
      { state, emit, stageApi, sharedContext, sourceManager }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe("running");
    expect(result.taskId).toMatch(/^task_/);

    expect(factory).toHaveBeenCalledTimes(1);
    const factoryArgs = factory.mock.calls[0][0];
    expect(factoryArgs.modelTier).toBe("fast");
    expect(factoryArgs.inheritedContext.L0.sources).toEqual([sources[0]]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toEqual({ task: "do it", L0: { sources: [sources[0]] } });

    await awaitTaskCompletion(result.taskId);

    const stored = getTaskStatus(result.taskId);
    expect(stored).toMatchObject({ status: "completed", compacted: true });
    expect(stored.result).toEqual(
      expect.objectContaining({
        ok: true,
        summary: "All good",
        reportPreview: report.slice(0, 5),
        analysisPreview: analysis.slice(0, 5),
        findingsCount: 1,
      })
    );
    expect(stored.result.findingsPreview).toBeUndefined();

    expect(emit).toHaveBeenCalledWith(
      "deepsearch:subagent.started",
      expect.objectContaining({ taskId: result.taskId, type: "researcher" })
    );
    expect(emit).toHaveBeenCalledWith(
      "deepsearch:subagent.completed",
      expect.objectContaining({ taskId: result.taskId, type: "researcher" })
    );

    expect(sharedContext.store).toHaveBeenCalledWith(
      result.taskId,
      expect.objectContaining({ status: "completed" })
    );
    expect(sharedContext.setSummary).toHaveBeenCalledWith(result.taskId, "All good");
  });

  it("waits in sync mode and falls back to state sources when sourceIds is empty", async () => {
    const sources = [
      { id: "s1", text: "doc1" },
      { id: "s2", text: "doc2" },
    ];
    const state = createState(sources);
    const stageApi = { env: { DEEPSEARCH_MAX_RUNNING_TASKS: "2" } };

    const { factory, run } = createSubagentFactory(async () => ({ ok: true, report: "hello" }));
    hoisted.registry.getFactory.mockReturnValue(factory);

    const result = await handler(
      { subagent_type: "analyzer", prompt: "check", sourceIds: [], async: false },
      { state, emit: vi.fn(), stageApi, sharedContext: { store: vi.fn(), setSummary: vi.fn() } }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("hello");

    expect(factory).toHaveBeenCalledTimes(1);
    const factoryArgs = factory.mock.calls[0][0];
    expect(factoryArgs.modelTier).toBe("normal");
    expect(run).toHaveBeenCalledWith(
      { task: "check", L0: { sources } },
      expect.objectContaining({ taskId: expect.any(String) })
    );
  });

  it("uses default preview length when env is negative", async () => {
    const bigText = "x".repeat(2100);
    const stageApi = { env: { DEEPSEARCH_TASK_RESULT_PREVIEW_CHARS: "-1" } };

    const { factory } = createSubagentFactory(async () => ({
      ok: true,
      report: bigText,
      analysis: bigText,
      findings: bigText,
    }));
    hoisted.registry.getFactory.mockReturnValue(factory);

    const result = await handler(
      { prompt: "ok", async: false },
      { state: createState(), emit: vi.fn(), stageApi, sharedContext: { store: vi.fn(), setSummary: vi.fn() } }
    );

    expect(result.success).toBe(true);

    const stored = getTaskStatus(result.taskId);
    expect(stored.result.reportPreview.length).toBe(2000);
    expect(stored.result.analysisPreview.length).toBe(2000);
    expect(stored.result.findingsPreview.length).toBe(2000);
  });

  it("returns failed status when subagent throws", async () => {
    const { factory } = createSubagentFactory(async () => {
      throw new Error("boom");
    });
    hoisted.registry.getFactory.mockReturnValue(factory);

    const emit = vi.fn();
    const sharedContext = { store: vi.fn(), setSummary: vi.fn() };
    const result = await handler(
      { prompt: "ok", async: false },
      { state: createState(), emit, stageApi: { env: {} }, sharedContext }
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Task failed. Please retry.");
    expect(hoisted.logger.error).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      "deepsearch:subagent.failed",
      expect.objectContaining({ taskId: result.taskId })
    );
    expect(sharedContext.store).toHaveBeenCalledWith(
      result.taskId,
      expect.objectContaining({ status: "failed" })
    );
  });

  it("marks task failed on timeout", async () => {
    const run = vi.fn(
      (_input, { signal }) =>
        new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason));
        })
    );
    const factory = vi.fn(async () => ({ run }));
    hoisted.registry.getFactory.mockReturnValue(factory);

    const stageApi = { env: { DEEPSEARCH_TASK_TIMEOUT_MS: "10" } };
    const handlerPromise = handler(
      { prompt: "slow", async: false },
      { state: createState(), emit: vi.fn(), stageApi, sharedContext: { store: vi.fn(), setSummary: vi.fn() } }
    );

    await vi.advanceTimersByTimeAsync(11);
    const result = await handlerPromise;

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Task timed out. Please retry.");
  });

  it("rejects concurrent tasks when maxRunningTasks is exceeded", async () => {
    const deferred = createDeferred();
    const run = vi.fn(() => deferred.promise);
    const factory = vi.fn(async () => ({ run }));
    hoisted.registry.getFactory.mockReturnValue(factory);

    const stageApi = { env: { DEEPSEARCH_MAX_RUNNING_TASKS: "1" } };
    const context = createContext({ stageApi });

    const firstPromise = handler({ prompt: "one", async: true }, context);
    const secondPromise = handler({ prompt: "two", async: true }, context);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    const successes = [first, second].filter((out) => out.success);
    const failures = [first, second].filter((out) => !out.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toContain("Too many running tasks");
    expect(run).toHaveBeenCalledTimes(1);

    deferred.resolve({ ok: true, summary: "done" });
    await awaitTaskCompletion(successes[0].taskId);
  });

  it("supports rapid consecutive async calls under the limit", async () => {
    const { factory, run } = createSubagentFactory(async () => ({ ok: true, summary: "ok" }));
    hoisted.registry.getFactory.mockReturnValue(factory);

    const context = createContext({ stageApi: { env: { DEEPSEARCH_MAX_RUNNING_TASKS: "5" } } });
    const first = await handler({ prompt: "one", async: true }, context);
    const second = await handler({ prompt: "two", async: true }, context);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.taskId).not.toBe(second.taskId);
    expect(run).toHaveBeenCalledTimes(2);

    await awaitTaskCompletion(first.taskId);
    await awaitTaskCompletion(second.taskId);
  });
});

describe("getTaskStatus", () => {
  it("returns undefined when task does not exist", () => {
    expect(getTaskStatus("missing")).toBeUndefined();
  });

  it("returns existing task records", () => {
    const now = Date.now();
    const record = {
      taskId: "task_done",
      status: "completed",
      startedAt: now - 10,
      completedAt: now,
      expiresAt: now + 1000,
    };
    getTaskManager().set(record.taskId, record);

    expect(getTaskStatus(record.taskId)).toBe(record);
  });

  it("prunes expired tasks", () => {
    const now = Date.now();
    const record = {
      taskId: "task_expired",
      status: "failed",
      startedAt: now - 20,
      completedAt: now - 10,
      expiresAt: now - 1,
    };
    getTaskManager().set(record.taskId, record);

    expect(getTaskStatus(record.taskId)).toBeUndefined();
    expect(getTaskManager().get(record.taskId)).toBeUndefined();
  });
});

describe("waitForTask", () => {
  it("returns null when task is missing", async () => {
    const result = await waitForTask("missing");
    expect(result).toBeNull();
  });

  it("returns non-running tasks immediately", async () => {
    const now = Date.now();
    const record = {
      taskId: "task_done",
      status: "completed",
      startedAt: now - 10,
      completedAt: now,
      expiresAt: now + 1000,
    };
    getTaskManager().set(record.taskId, record);

    const result = await waitForTask(record.taskId);
    expect(result).toBe(record);
  });

  it("resolves running tasks within large timeout", async () => {
    const deferred = createDeferred();
    const running = {
      taskId: "task_running",
      status: "running",
      startedAt: Date.now(),
      promise: deferred.promise,
    };
    getTaskManager().set(running.taskId, running);

    const waitPromise = waitForTask(running.taskId, Number.MAX_SAFE_INTEGER);
    deferred.resolve({ taskId: running.taskId, status: "completed" });

    const result = await waitPromise;
    expect(result.status).toBe("completed");
  });

  it("times out running tasks when timeout is 0", async () => {
    const running = {
      taskId: "task_timeout",
      status: "running",
      startedAt: Date.now(),
      promise: new Promise(() => {}),
    };
    getTaskManager().set(running.taskId, running);

    const waitPromise = waitForTask(running.taskId, 0);
    await vi.advanceTimersByTimeAsync(1);

    const result = await waitPromise;
    expect(result.status).toBe("timeout");
    expect(result.error).toBe("Task timeout");
  });
});

describe("default export", () => {
  it("exposes named exports", () => {
    expect(taskModule).toEqual(
      expect.objectContaining({
        definition,
        handler,
        getTaskStatus,
        waitForTask,
        getTaskManager,
        resetTaskManager,
      })
    );
  });
});
