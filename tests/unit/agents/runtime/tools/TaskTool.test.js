import { describe, it, expect, vi, beforeEach } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  ServiceId: { SUBAGENT_REGISTRY: "SUBAGENT_REGISTRY" },
}));

vi.mock("../../../../../js/agents/core/di/index.js", () => ({
  ServiceId: serviceMocks.ServiceId,
}));

import { ContextMode, createTaskTool } from "../../../../../js/agents/runtime/tools/TaskTool.js";

function makeSharedContext(overrides = {}) {
  return {
    commit: vi.fn(),
    signal: vi.fn(),
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  return {
    emit: vi.fn(),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    signal: {},
    state: {},
    ...overrides,
  };
}

function makeRegistry(factory, availableTypes = [{ type: "Worker" }]) {
  return {
    getFactory: vi.fn(() => factory),
    getAvailableTypes: vi.fn(() => availableTypes),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ContextMode", () => {
  it("exposes frozen context modes", () => {
    expect(ContextMode).toEqual({
      ISOLATED: "isolated",
      SHARED: "shared",
      HANDOFF: "handoff",
    });
    expect(Object.isFrozen(ContextMode)).toBe(true);
  });
});

describe("createTaskTool", () => {
  it("launches a subagent and commits summary/keywords with default isolated context", async () => {
    const sharedContext = makeSharedContext();
    const parentAgent = { memory: { sharedContext } };
    const runMock = vi.fn().mockResolvedValue({
      ok: true,
      summary: "done",
      keywords: ["alpha", "beta"],
    });
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory, [{ type: "Worker" }]);
    const handler = createTaskTool({ registry, parentAgent });
    const context = makeContext();

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123);

    const result = await handler({
      subagent_type: "Worker",
      prompt: "ship it",
    }, context);

    expect(context.logger.info).toHaveBeenCalledWith("Launching subagent: Worker", {
      prompt: "ship it",
      model_tier: "fast",
      context_mode: "isolated",
    });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "ship it",
      modelTier: "fast",
      usage: "subagent_fast",
      parent: parentAgent,
      inheritedContext: { sharedContext },
    }));
    expect(runMock).toHaveBeenCalledWith({ task: "ship it" }, { signal: context.signal });
    expect(context.emit).toHaveBeenCalledWith("subagent:started", {
      type: "Worker",
      prompt: "ship it",
      context_mode: "isolated",
    });
    expect(sharedContext.commit).toHaveBeenCalledWith("task_Worker_123", {
      full: { ok: true, summary: "done", keywords: ["alpha", "beta"] },
      summary: "done",
      keywords: ["alpha", "beta"],
    });
    expect(sharedContext.signal).toHaveBeenCalledWith("subagent.completed", {
      type: "Worker",
      resultId: "task_Worker_123",
      ok: true,
    });
    expect(context.emit).toHaveBeenCalledWith("subagent:completed", {
      type: "Worker",
      resultId: "task_Worker_123",
    });
    expect(result).toEqual({
      ok: true,
      resultId: "task_Worker_123",
      summary: "done",
      hint: "Use sharedContext.getDetail(\"task_Worker_123\") for full result",
    });

    nowSpy.mockRestore();
  });

  it("uses buildHandoff when context_mode is handoff", async () => {
    const sharedContext = makeSharedContext();
    const parentAgent = { memory: { sharedContext } };
    const buildHandoff = vi.fn().mockResolvedValue({ note: "handoff" });
    const runMock = vi.fn().mockResolvedValue({ ok: true, message: "done" });
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry, parentAgent, buildHandoff });
    const context = makeContext({ state: { step: 1 } });

    await handler({
      subagent_type: "Worker",
      prompt: "handoff task",
      context_mode: ContextMode.HANDOFF,
      model_tier: "advanced",
    }, context);

    expect(buildHandoff).toHaveBeenCalledWith(context.state, sharedContext);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "handoff task",
      modelTier: "advanced",
      usage: "subagent_advanced",
      inheritedContext: {
        handoff: { note: "handoff" },
        sharedContext,
      },
    }));
  });

  it("builds the fallback handoff from state when buildHandoff is missing", async () => {
    const sharedContext = makeSharedContext();
    const runMock = vi.fn().mockResolvedValue({ ok: true, summary: "ok" });
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry });
    const context = makeContext({
      state: {
        taskGoal: "goal",
        iteration: "1",
        todos: [
          { id: 1, status: "pending" },
          { id: 2, status: "completed" },
        ],
        L1: { condensedMemory: { summary: "condensed" } },
        sharedContext,
      },
    });

    await handler({
      subagent_type: "Worker",
      prompt: "handoff fallback",
      context_mode: ContextMode.HANDOFF,
    }, context);

    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      inheritedContext: {
        handoff: {
          taskGoal: "goal",
          iteration: "1",
          pendingTodos: [{ id: 1, status: "pending" }],
          summary: "condensed",
        },
        sharedContext,
      },
    }));
  });

  it("resolves registry from container.tryGet when explicit registry is missing", async () => {
    const sharedContext = makeSharedContext();
    const runMock = vi.fn().mockResolvedValue({ ok: true, summary: "ok" });
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const container = {
      get: vi.fn(() => { throw new Error("get should not be used"); }),
      tryGet: vi.fn(() => Promise.resolve(registry)),
    };
    const handler = createTaskTool({ container });
    const context = makeContext({ state: { sharedContext } });

    await handler({ subagent_type: "Worker", prompt: "from container" }, context);

    expect(container.tryGet).toHaveBeenCalledWith(serviceMocks.ServiceId.SUBAGENT_REGISTRY);
    expect(container.get).not.toHaveBeenCalled();
    expect(registry.getFactory).toHaveBeenCalledWith("Worker");
  });

  it("falls back through context containers when earlier candidates fail", async () => {
    const sharedContext = makeSharedContext();
    const runMock = vi.fn().mockResolvedValue({ ok: true, summary: "ok" });
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const container = {
      get: vi.fn(() => { throw new Error("primary container fail"); }),
    };
    const contextContainer = {
      get: vi.fn(() => { throw new Error("context container fail"); }),
    };
    const servicesContainer = {
      get: vi.fn(() => registry),
    };
    const handler = createTaskTool({ container });
    const context = makeContext({
      state: { sharedContext },
      container: contextContainer,
      services: { container: servicesContainer },
    });

    await handler({ subagent_type: "Worker", prompt: "fallback" }, context);

    expect(container.get).toHaveBeenCalledWith(serviceMocks.ServiceId.SUBAGENT_REGISTRY);
    expect(contextContainer.get).toHaveBeenCalledWith(serviceMocks.ServiceId.SUBAGENT_REGISTRY);
    expect(servicesContainer.get).toHaveBeenCalledWith(serviceMocks.ServiceId.SUBAGENT_REGISTRY);
    expect(registry.getFactory).toHaveBeenCalledWith("Worker");
  });

  it("throws when registry cannot be resolved", async () => {
    const handler = createTaskTool();
    const context = makeContext();

    await expect(handler({ subagent_type: "Worker", prompt: "missing" }, context))
      .rejects.toThrow("TaskTool: missing SubagentRegistry");
  });

  it("returns an error when the subagent type is unknown", async () => {
    const registry = {
      getFactory: vi.fn(() => null),
      getAvailableTypes: vi.fn(() => [{ type: "A" }, { type: "B" }]),
    };
    const handler = createTaskTool({ registry });
    const context = makeContext();

    const result = await handler({ subagent_type: "Unknown", prompt: "task" }, context);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown subagent type: Unknown");
    expect(result.error).toContain("Available: A, B");
    expect(context.emit).not.toHaveBeenCalled();
  });

  it("returns ok false and emits failure when factory returns invalid subagent", async () => {
    const factory = vi.fn().mockResolvedValue({});
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry });
    const context = makeContext();

    const result = await handler({ subagent_type: "Worker", prompt: "task" }, context);

    expect(result).toEqual({
      ok: false,
      error: "Factory for \"Worker\" did not return a valid AgentInstance",
    });
    expect(context.logger.error).toHaveBeenCalledWith(
      "Subagent \"Worker\" failed: Factory for \"Worker\" did not return a valid AgentInstance",
    );
    expect(context.emit).toHaveBeenCalledWith("subagent:failed", {
      type: "Worker",
      error: "Factory for \"Worker\" did not return a valid AgentInstance",
    });
  });

  it("stringifies non-Error failures from subagent.run", async () => {
    const runMock = vi.fn().mockRejectedValue("boom");
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry });
    const context = makeContext();

    const result = await handler({ subagent_type: "Worker", prompt: "task" }, context);

    expect(result).toEqual({ ok: false, error: "boom" });
    expect(context.logger.error).toHaveBeenCalledWith("Subagent \"Worker\" failed: boom");
    expect(context.emit).toHaveBeenCalledWith("subagent:failed", {
      type: "Worker",
      error: "boom",
    });
  });

  it("handles null results without sharedContext", async () => {
    const runMock = vi.fn().mockResolvedValue(null);
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry });
    const context = makeContext();

    const result = await handler({ subagent_type: "Worker", prompt: "task" }, context);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Worker: no result");
    expect(result.hint).toBeNull();
  });

  it("extracts keywords from tags and truncates long summaries for large results", async () => {
    const sharedContext = makeSharedContext();
    const hugeContent = "x".repeat(1024 * 1024);
    const tags = Array.from({ length: 12 }, (_, index) => `tag-${index}`);
    const resultPayload = {
      ok: true,
      tags,
      file: { name: "huge.bin", content: hugeContent },
      deep: { level0: { level1: { level2: { level3: { level4: "deep" } } } } },
    };
    const runMock = vi.fn().mockResolvedValue(resultPayload);
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry, parentAgent: { memory: { sharedContext } } });
    const context = makeContext();

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(999);

    const result = await handler({ subagent_type: "Worker", prompt: "task" }, context);

    expect(result.summary.length).toBe(200);
    expect(result.summary.endsWith("...")).toBe(true);
    expect(sharedContext.commit).toHaveBeenCalledWith("task_Worker_999", {
      full: resultPayload,
      summary: result.summary,
      keywords: tags.slice(0, 10),
    });
    expect(sharedContext.commit.mock.calls[0][1].full.deep.level0.level1.level2.level3.level4)
      .toBe("deep");

    nowSpy.mockRestore();
  });

  it("accepts boundary subagent_type values and forwards them to the registry", async () => {
    const sharedContext = makeSharedContext();
    const runMock = vi.fn().mockResolvedValue({ ok: true, summary: "ok" });
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry, parentAgent: { memory: { sharedContext } } });
    const context = makeContext();

    const values = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
    ];

    for (const value of values) {
      await handler({ subagent_type: value, prompt: "task" }, context);
    }

    expect(registry.getFactory).toHaveBeenCalledTimes(values.length);
    values.forEach((value, index) => {
      expect(registry.getFactory.mock.calls[index][0]).toBe(value);
    });
  });

  it("accepts boundary prompt values and forwards them to subagent.run", async () => {
    const runMock = vi.fn().mockResolvedValue({ ok: true, summary: "ok" });
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry });
    const context = makeContext();

    const values = [
      "",
      "   ",
      null,
      undefined,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      [],
      {},
      { 0: "array", length: 1 },
      "x".repeat(1024),
    ];

    for (const value of values) {
      await handler({ subagent_type: "Worker", prompt: value }, context);
    }

    values.forEach((value, index) => {
      expect(runMock.mock.calls[index][0]).toEqual({ task: value });
    });
  });

  it("handles rapid consecutive calls without shared state", async () => {
    const sharedContext = makeSharedContext();
    const runMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, summary: "first" })
      .mockResolvedValueOnce({ ok: false, error: "bad" });
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry, parentAgent: { memory: { sharedContext } } });
    const context = makeContext();

    const nowSpy = vi.spyOn(Date, "now")
      .mockImplementationOnce(() => 1)
      .mockImplementationOnce(() => 2);

    const first = await handler({ subagent_type: "Worker", prompt: "first" }, context);
    const second = await handler({ subagent_type: "Worker", prompt: "second" }, context);

    expect(first).toEqual({
      ok: true,
      resultId: "task_Worker_1",
      summary: "first",
      hint: "Use sharedContext.getDetail(\"task_Worker_1\") for full result",
    });
    expect(second.ok).toBe(false);
    expect(second.summary).toBe("Worker failed: bad");
    expect(second.resultId).toBe("task_Worker_2");
    expect(runMock).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it("handles concurrent calls independently", async () => {
    const sharedContext = makeSharedContext();
    const runMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, summary: "first" })
      .mockResolvedValueOnce({ ok: true, summary: "second" });
    const subagent = { run: runMock };
    const factory = vi.fn().mockResolvedValue(subagent);
    const registry = makeRegistry(factory);
    const handler = createTaskTool({ registry, parentAgent: { memory: { sharedContext } } });
    const context = makeContext();

    const firstCall = handler({ subagent_type: "Worker", prompt: "first" }, context);
    const secondCall = handler({ subagent_type: "Worker", prompt: "second" }, context);

    const [first, second] = await Promise.all([firstCall, secondCall]);

    expect(first.summary).toBe("first");
    expect(second.summary).toBe("second");
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(context.emit).toHaveBeenCalledWith("subagent:started", {
      type: "Worker",
      prompt: "first",
      context_mode: "isolated",
    });
    expect(context.emit).toHaveBeenCalledWith("subagent:started", {
      type: "Worker",
      prompt: "second",
      context_mode: "isolated",
    });
  });
});
