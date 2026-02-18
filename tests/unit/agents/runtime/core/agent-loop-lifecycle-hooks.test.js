import { describe, it, expect, vi, beforeEach } from "vitest";

const { createPreAgentHookMock, createPostAgentHookMock } = vi.hoisted(() => ({
  createPreAgentHookMock: vi.fn(),
  createPostAgentHookMock: vi.fn(),
}));

vi.mock("../../../../../js/agents/runtime/hooks/hook-runner.js", () => ({
  createPreAgentHook: () => createPreAgentHookMock(),
  createPostAgentHook: () => createPostAgentHookMock(),
}));

import { runWithAgentLifecycleHooks } from "../../../../../js/agents/runtime/core/agent-loop-lifecycle-hooks.js";

let preHook;
let postHook;

const buildLoop = (overrides = {}) => ({
  run: vi.fn().mockResolvedValue({ ok: true }),
  stageName: "stage",
  actor: "actor",
  eventBus: { emit: vi.fn() },
  emit: undefined,
  ...overrides,
});

beforeEach(() => {
  preHook = vi.fn().mockResolvedValue(undefined);
  postHook = vi.fn().mockResolvedValue(undefined);
  createPreAgentHookMock.mockReset();
  createPostAgentHookMock.mockReset();
  createPreAgentHookMock.mockReturnValue(preHook);
  createPostAgentHookMock.mockReturnValue(postHook);
});

describe("runWithAgentLifecycleHooks", () => {
  it("runs loop and post hook on success with empty string input and empty object context", async () => {
    const loop = buildLoop({ run: vi.fn().mockResolvedValue({ ok: true, id: "result" }) });
    const stageApi = { checkCancelled: null };
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1500);

    const result = await runWithAgentLifecycleHooks({
      loop,
      runId: "run-1",
      sessionId: "sess-1",
      input: "",
      context: {},
      stageApi,
      startTime: 1000,
    });

    expect(result).toEqual({ ok: true, id: "result" });
    expect(createPreAgentHookMock).toHaveBeenCalledTimes(1);
    expect(preHook).toHaveBeenCalledWith({
      sessionId: "sess-1",
      runId: "run-1",
      input: "",
      context: { eventBus: loop.eventBus, stageApi, signal: undefined },
    });
    expect(loop.run).toHaveBeenCalledWith("", {});
    expect(createPostAgentHookMock).toHaveBeenCalledTimes(1);
    expect(postHook).toHaveBeenCalledWith({
      sessionId: "sess-1",
      runId: "run-1",
      input: "",
      result: { ok: true, id: "result" },
      error: null,
      duration: 500,
      context: { eventBus: loop.eventBus, stageApi },
    });

    dateSpy.mockRestore();
  });

  it("skips run, emits skipped event, and returns hook value for null input with whitespace runId", async () => {
    preHook.mockResolvedValue({ skip: true, reason: "policy", value: { ok: true, skipped: true } });
    const loop = buildLoop({ stageName: "alpha", actor: "unit", emit: vi.fn() });
    const stageApi = { emit: vi.fn() };
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(10);

    const result = await runWithAgentLifecycleHooks({
      loop,
      runId: "   ",
      sessionId: null,
      input: null,
      context: { signal: "sig" },
      stageApi,
      startTime: 0,
    });

    expect(result).toEqual({ ok: true, skipped: true });
    expect(loop.run).not.toHaveBeenCalled();
    expect(loop.emit).toHaveBeenCalledWith("alpha.agent.skipped", {
      actor: "unit",
      status: "skipped",
      payload: { runId: "   ", reason: "policy", duration: 10 },
    });
    expect(loop.eventBus.emit).not.toHaveBeenCalled();
    expect(preHook).toHaveBeenCalledWith({
      sessionId: null,
      runId: "   ",
      input: null,
      context: { eventBus: loop.eventBus, stageApi, signal: "sig" },
    });
    expect(createPostAgentHookMock).not.toHaveBeenCalled();

    dateSpy.mockRestore();
  });

  it("returns default error payload when skipped without emitter or value", async () => {
    preHook.mockResolvedValue({ skip: true, reason: "no emitter" });
    const loop = buildLoop({ eventBus: null, emit: undefined });

    const result = await runWithAgentLifecycleHooks({
      loop,
      runId: "run-2",
      sessionId: "sess-2",
      input: undefined,
      context: null,
      stageApi: null,
    });

    expect(result).toEqual({ ok: false, error: "no emitter" });
    expect(loop.run).not.toHaveBeenCalled();
    expect(preHook).toHaveBeenCalledWith({
      sessionId: "sess-2",
      runId: "run-2",
      input: undefined,
      context: { eventBus: null, stageApi: null, signal: undefined },
    });
    expect(createPostAgentHookMock).not.toHaveBeenCalled();
  });

  it("calls post hook on error and rethrows for empty array input", async () => {
    const error = new Error("boom");
    const loop = buildLoop({ run: vi.fn().mockRejectedValue(error) });
    const stageApi = { checkCancelled: null };
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(9);

    await expect(
      runWithAgentLifecycleHooks({
        loop,
        runId: "run-err",
        sessionId: "sess-err",
        input: [],
        context: { signal: "sig" },
        stageApi,
        startTime: -1,
      }),
    ).rejects.toBe(error);

    expect(preHook).toHaveBeenCalledWith({
      sessionId: "sess-err",
      runId: "run-err",
      input: [],
      context: { eventBus: loop.eventBus, stageApi, signal: "sig" },
    });
    expect(createPostAgentHookMock).toHaveBeenCalledTimes(1);
    expect(postHook).toHaveBeenCalledWith({
      sessionId: "sess-err",
      runId: "run-err",
      input: [],
      result: null,
      error,
      duration: 10,
      context: { eventBus: loop.eventBus, stageApi },
    });

    dateSpy.mockRestore();
  });

  it("handles type boundaries with string input and array-like context", async () => {
    const loop = buildLoop({ run: vi.fn().mockResolvedValue("done") });
    const stageApi = { emit: null };

    const result = await runWithAgentLifecycleHooks({
      loop,
      runId: "run-types",
      sessionId: "sess-types",
      input: "123",
      context: { 0: "a", length: 1 },
      stageApi,
    });

    expect(result).toBe("done");
    expect(loop.run).toHaveBeenCalledWith("123", { 0: "a", length: 1 });
    expect(preHook).toHaveBeenCalledWith({
      sessionId: "sess-types",
      runId: "run-types",
      input: "123",
      context: { eventBus: loop.eventBus, stageApi, signal: undefined },
    });
    expect(postHook).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-types",
        result: "done",
        error: null,
      }),
    );
  });

  it("handles concurrent calls without shared state", async () => {
    const loopA = buildLoop({ run: vi.fn().mockResolvedValue({ id: "A" }), stageName: "sA" });
    const loopB = buildLoop({ run: vi.fn().mockResolvedValue({ id: "B" }), stageName: "sB" });

    const [resultA, resultB] = await Promise.all([
      runWithAgentLifecycleHooks({
        loop: loopA,
        runId: "run-a",
        sessionId: "sess-a",
        input: "A",
        context: {},
        stageApi: {},
      }),
      runWithAgentLifecycleHooks({
        loop: loopB,
        runId: "run-b",
        sessionId: "sess-b",
        input: "B",
        context: {},
        stageApi: {},
      }),
    ]);

    expect(resultA).toEqual({ id: "A" });
    expect(resultB).toEqual({ id: "B" });
    expect(createPreAgentHookMock).toHaveBeenCalledTimes(2);
    expect(createPostAgentHookMock).toHaveBeenCalledTimes(2);
    expect(preHook).toHaveBeenCalledTimes(2);
    expect(postHook).toHaveBeenCalledTimes(2);
    expect(loopA.run).toHaveBeenCalledWith("A", {});
    expect(loopB.run).toHaveBeenCalledWith("B", {});
    const results = postHook.mock.calls.map((call) => call[0].result);
    expect(results).toEqual(expect.arrayContaining([{ id: "A" }, { id: "B" }]));
  });

  it("handles quick consecutive calls with independent results", async () => {
    const loop = buildLoop({
      run: vi.fn().mockResolvedValueOnce({ seq: 1 }).mockResolvedValueOnce({ seq: 2 }),
    });

    const first = await runWithAgentLifecycleHooks({
      loop,
      runId: "run-1",
      sessionId: "sess-1",
      input: "first",
      context: {},
      stageApi: {},
    });
    const second = await runWithAgentLifecycleHooks({
      loop,
      runId: "run-2",
      sessionId: "sess-2",
      input: "second",
      context: {},
      stageApi: {},
    });

    expect(first).toEqual({ seq: 1 });
    expect(second).toEqual({ seq: 2 });
    expect(loop.run).toHaveBeenCalledTimes(2);
    expect(loop.run).toHaveBeenNthCalledWith(1, "first", {});
    expect(loop.run).toHaveBeenNthCalledWith(2, "second", {});
    expect(preHook).toHaveBeenCalledTimes(2);
    expect(postHook).toHaveBeenCalledTimes(2);
  });

  it("passes through large inputs, long strings, and deep nested context with MAX_SAFE_INTEGER startTime", async () => {
    const loop = buildLoop({ run: vi.fn().mockResolvedValue({ ok: true }) });
    const longString = "x".repeat(100000);
    const input = {
      file: { name: "big.bin", size: Number.MAX_SAFE_INTEGER, content: "x" },
      note: longString,
    };
    const context = {
      meta: { level1: { level2: { level3: { level4: { level5: "deep" } } } } },
    };
    const stageApi = { checkCancelled: null };
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);

    const result = await runWithAgentLifecycleHooks({
      loop,
      runId: "run-big",
      sessionId: "sess-big",
      input,
      context,
      stageApi,
      startTime: Number.MAX_SAFE_INTEGER,
    });

    expect(result).toEqual({ ok: true });
    expect(loop.run).toHaveBeenCalledWith(input, context);
    expect(postHook).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-big",
        duration: 0,
      }),
    );

    dateSpy.mockRestore();
  });

  it("isolates pre-hook errors by default and continues main run", async () => {
    const preErr = new Error("pre hook failed");
    preHook.mockRejectedValue(preErr);
    const loop = buildLoop({ emit: vi.fn(), run: vi.fn().mockResolvedValue({ ok: true }) });

    const result = await runWithAgentLifecycleHooks({
      loop,
      runId: "run-pre-err",
      sessionId: "sess-pre-err",
      input: "x",
      context: {},
      stageApi: {},
    });

    expect(result).toEqual({ ok: true });
    expect(loop.run).toHaveBeenCalledTimes(1);
    expect(loop.emit).toHaveBeenCalledWith("stage.hook.error", expect.objectContaining({
      actor: "actor",
      status: "warning",
      payload: expect.objectContaining({ runId: "run-pre-err", phase: "pre", error: "pre hook failed" }),
    }));
  });

  it("throws pre-hook errors when strictHookErrors is enabled", async () => {
    const preErr = new Error("strict pre fail");
    preHook.mockRejectedValue(preErr);
    const loop = buildLoop({ strictHookErrors: true });

    await expect(
      runWithAgentLifecycleHooks({
        loop,
        runId: "run-pre-strict",
        sessionId: "sess",
        input: "x",
        context: {},
        stageApi: {},
      }),
    ).rejects.toBe(preErr);
    expect(loop.run).not.toHaveBeenCalled();
  });

  it("isolates post-hook errors by default and preserves run result", async () => {
    postHook.mockRejectedValue(new Error("post hook failed"));
    const loop = buildLoop({ emit: vi.fn(), run: vi.fn().mockResolvedValue({ ok: true, id: 1 }) });

    const result = await runWithAgentLifecycleHooks({
      loop,
      runId: "run-post-err",
      sessionId: "sess-post-err",
      input: "x",
      context: {},
      stageApi: {},
    });

    expect(result).toEqual({ ok: true, id: 1 });
    expect(loop.emit).toHaveBeenCalledWith("stage.hook.error", expect.objectContaining({
      payload: expect.objectContaining({ phase: "post", error: "post hook failed" }),
    }));
  });
});
