import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep stage tests unit-scoped: mock tool executor + optional mechanisms.
vi.mock("../../../../js/agents/stages/codesearch/code-tools.js", () => {
  return {
    formatToolDefinitionsForLLM: vi.fn(() => "MOCK_TOOL_DEFS"),
    createToolExecutor: vi.fn(() => ({
      definitions: [],
      execute: vi.fn(async () => ({ ok: true })),
    })),
  };
});

vi.mock("../../../../js/agents/runtime/core/mechanisms.js", () => {
  return {
    loadMechanisms: vi.fn(async () => {}),
    initMechanisms: vi.fn(() => {}),
  };
});

// Avoid pulling in the real Watchdog implementation; stage behavior is tested via stubbed interface.
vi.mock("../../../../js/agents/runtime/compression/watchdog.js", () => {
  class MockWatchdog {
    constructor(_opts = {}) {
      this._opts = _opts;
    }
    tick() {}
    reset() {}
    configure() {}
    recordOutput() {}
    resetOscillation() {}
    resetToolLoop() {}
    checkHealth() {
      return { healthy: true, issues: [], stats: {} };
    }
  }
  return { Watchdog: MockWatchdog };
});

import { AgentStatus } from "../../../../js/agents/runtime/core/agent-status.js";
import { StagePausedError } from "../../../../js/agents/runtime/core/stage-errors.js";
import {
  CodeSearchStage,
  runCodeSearchStage,
  registerCodeSearchStages,
} from "../../../../js/agents/stages/codesearch/codesearch-stage.js";

describe("codesearch/codesearch-stage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("_resolveDependency prefers context, then container, then fallback", async () => {
    const container = { get: vi.fn(async (id) => ({ id })) };
    const stage = new CodeSearchStage({ container });

    const fromContext = await stage._resolveDependency("memoryStore", { memoryStore: 123 }, "fb");
    expect(fromContext).toBe(123);
    expect(container.get).not.toHaveBeenCalled();

    const fromContainer = await stage._resolveDependency("stateEngine", {}, "fb");
    expect(fromContainer).toEqual({ id: "stateEngine" });
    expect(container.get).toHaveBeenCalledWith("stateEngine");

    container.get.mockRejectedValueOnce(new Error("nope"));
    const fromFallback = await stage._resolveDependency("eventBus", {}, "fb");
    expect(fromFallback).toBe("fb");
  });

  it("enables eventBus backpressure (best-effort) before pausing for missing LLM", async () => {
    const enableBackpressure = vi.fn(() => {
      throw new Error("ignore");
    });
    const eventBus = { enableBackpressure };

    const stage = new CodeSearchStage();
    await expect(
      stage.run({ query: "Q" }, { runContext: { runId: "run1" }, eventBus, eventBusBackpressure: { maxQueueSize: 1 } })
    ).rejects.toBeInstanceOf(StagePausedError);

    expect(enableBackpressure).toHaveBeenCalledTimes(1);
    const arg = enableBackpressure.mock.calls[0][0];
    expect(arg.maxQueueSize).toBe(1);
    expect(String(arg.coalescePattern)).toContain("\\.progress$");
  });

  it("pauses when LLM is unavailable and sets awaitUserFeedback flags", async () => {
    const stage = new CodeSearchStage({ maxSteps: 1 });

    await expect(stage.run({ query: "Inspect repo" }, { runContext: { runId: "run_pause" } })).rejects.toBeInstanceOf(
      StagePausedError
    );

    expect(stage.loopState?.awaitUserFeedback).toBe(true);
    expect(stage.loopState?.pauseReason).toBe("LLM unavailable, awaiting user input");
  });

  it("runs planning->execution->summarizing and completes", async () => {
    const responses = [
      {
        content: JSON.stringify([
          { text: "List root", priority: "high", queryHints: ["tree"], expectedEvidence: "layout" },
        ]),
      },
      { content: JSON.stringify({ done: true, completeTodo: true, thought: "ok" }) },
      { content: "Summary ok." },
    ];
    let idx = 0;
    const modelRouter = {
      call: vi.fn(async () => responses[Math.min(idx++, responses.length - 1)]),
    };

    const stage = new CodeSearchStage({ maxSteps: 3 });
    const result = await stage.run({ query: "Inspect repo", basePath: "." }, { runContext: { runId: "run2" }, modelRouter });

    expect(result.summary).toBe("Summary ok.");
    expect(result.todos).toHaveLength(1);
    expect(result.todoCompletionStats.completed).toBe(1);
    expect(stage.loopStatus).toBe(AgentStatus.COMPLETED);
  });

  it("stage.execute delegates to BaseAgentLoop.execute and returns result", async () => {
    const responses = [
      { content: JSON.stringify([{ text: "List root", priority: "high" }]) },
      { content: JSON.stringify({ done: true, completeTodo: true, thought: "ok" }) },
      { content: "Summary ok." },
    ];
    let idx = 0;
    const modelRouter = { call: vi.fn(async () => responses[Math.min(idx++, responses.length - 1)]) };

    const stage = new CodeSearchStage({ maxSteps: 2 });
    const result = await stage.execute(
      { runId: "run_execute" },
      { query: "Inspect repo", basePath: "." },
      { modelRouter }
    );

    expect(result.summary).toBe("Summary ok.");
  });

  it("runCodeSearchStage constructs a stage and calls execute()", async () => {
    const spy = vi.spyOn(CodeSearchStage.prototype, "execute").mockResolvedValue({ ok: true });
    const out = await runCodeSearchStage({ runId: "run_wrap" }, { query: "Q", options: { maxSteps: 1 } }, {});
    expect(out).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
  });

  it("_getDefaultFs returns node:fs/promises adapters when available", async () => {
    const stage = new CodeSearchStage();
    const fs = await stage._getDefaultFs();
    expect(fs).toBeTruthy();
    expect(typeof fs.readFile).toBe("function");
    expect(typeof fs.readdir).toBe("function");
    expect(typeof fs.stat).toBe("function");
  });

  it("pauses when planning phase cannot produce todos (planResult.success=false)", async () => {
    const modelRouter = {
      call: vi.fn(async () => ({ content: "not json" })),
    };
    const stage = new CodeSearchStage({ maxSteps: 1 });

    await expect(stage.run({ query: "Q" }, { runContext: { runId: "run_plan_fail" }, modelRouter })).rejects.toBeInstanceOf(
      StagePausedError
    );
    expect(stage.loopState?.awaitUserFeedback).toBe(true);
  });

  it("pauses mid-execution when _shouldPauseFromError() treats an error as pause-like", async () => {
    let idx = 0;
    const modelRouter = {
      call: vi.fn(async () => {
        idx += 1;
        if (idx === 1) return { content: JSON.stringify([{ text: "List root", priority: "high" }]) };
        throw new Error("pause me");
      }),
    };

    const stage = new CodeSearchStage({ maxSteps: 2 });
    stage._shouldPauseFromError = vi.fn(() => true);

    await expect(stage.run({ query: "Q" }, { runContext: { runId: "run_pause_like" }, modelRouter })).rejects.toBeInstanceOf(
      StagePausedError
    );
    expect(stage.loopStatus).toBe(AgentStatus.PAUSED);
  });

  it("pauses when budget manager signals STOP (budget exceeded)", async () => {
    const responses = [{ content: JSON.stringify([{ text: "List root", priority: "high" }]) }];
    const modelRouter = { call: vi.fn(async () => responses[0]) };

    // Trigger stop immediately once stage assigns the callback.
    const budgetManager = {};
    Object.defineProperty(budgetManager, "onThresholdReached", {
      set(fn) {
        if (typeof fn === "function") fn({ action: "stop" });
      },
    });

    const stage = new CodeSearchStage({ maxSteps: 1 });
    await expect(stage.run({ query: "Q" }, { runContext: { runId: "run_budget_stop" }, modelRouter, budgetManager })).rejects.toBeInstanceOf(
      StagePausedError
    );
  });

  it("emits watchdog intervention and stops early with completionReason", async () => {
    const responses = [
      { content: JSON.stringify([{ text: "Do something", priority: "high" }]) },
      { content: JSON.stringify({ action: "tree", args: { path: "." } }) },
      { content: "Summary after stop." },
    ];
    let idx = 0;
    const modelRouter = {
      call: vi.fn(async () => responses[Math.min(idx++, responses.length - 1)]),
    };

    const emit = vi.fn();
    const watchdog = {
      reset: vi.fn(),
      configure: vi.fn(),
      tick: vi.fn(),
      recordOutput: vi.fn(),
      resetOscillation: vi.fn(),
      resetToolLoop: vi.fn(),
      checkHealth: vi.fn(() => ({
        healthy: false,
        issues: [{ type: "timeout" }, { type: "tool_loop", suggestion: "change params" }],
        stats: { recent: 3 },
      })),
    };

    const stage = new CodeSearchStage({ maxSteps: 3, timeoutMs: 10_000 });
    const result = await stage.run(
      { query: "Inspect repo", userConfig: { watchdog: { maxRecentOutputs: 1, similarityThreshold: 2, maxConsecutiveSimilar: 1 } } },
      { runContext: { runId: "run3" }, modelRouter, emit, watchdog }
    );

    expect(watchdog.configure).toHaveBeenCalledWith({ maxRecentOutputs: 2, oscillationThreshold: 1 });
    expect(watchdog.checkHealth).toHaveBeenCalledWith(expect.objectContaining({ oscillationConsecutiveThreshold: 2 }));
    expect(emit).toHaveBeenCalledWith(
      "codesearch.watchdog.intervention",
      expect.objectContaining({
        actor: "codesearch",
        payload: expect.objectContaining({ step: 1, advice: expect.any(String) }),
      })
    );
    expect(result.completionReason).toBe("watchdog_timeout");
    expect(stage.loopState?.observations.some((t) => String(t).includes("[Watchdog]"))).toBe(true);
  });

  it("uses fallback watchdog advice when issue types are unknown", async () => {
    const responses = [
      { content: JSON.stringify([{ text: "Do something", priority: "high" }]) },
      { content: JSON.stringify({ done: true, thought: "ok" }) },
      { content: "Summary." },
    ];
    let idx = 0;
    const modelRouter = { call: vi.fn(async () => responses[Math.min(idx++, responses.length - 1)]) };

    const watchdog = {
      tick: vi.fn(),
      recordOutput: vi.fn(),
      resetOscillation: vi.fn(),
      checkHealth: vi.fn(() => ({ healthy: false, issues: [{ type: "mystery" }], stats: {} })),
    };

    const stage = new CodeSearchStage({ maxSteps: 2 });
    const result = await stage.run({ query: "Q" }, { runContext: { runId: "run_watchdog_default" }, modelRouter, watchdog });

    expect(result.summary).toBe("Summary.");
    expect(stage.loopState?.observations.join("\n")).toContain("检测到潜在卡死；改变策略或参数");
  });

  it("stops on oscillation after repeated watchdog interventions", async () => {
    const responses = [
      { content: JSON.stringify([{ text: "Do something", priority: "high" }]) },
      { content: JSON.stringify({ action: "list_dir", args: { path: "." } }) },
      { content: JSON.stringify({ action: "list_dir", args: { path: "." } }) },
      { content: "Summary." },
    ];
    let idx = 0;
    const modelRouter = { call: vi.fn(async () => responses[Math.min(idx++, responses.length - 1)]) };

    const watchdog = {
      tick: vi.fn(),
      recordOutput: vi.fn(),
      resetOscillation: vi.fn(),
      checkHealth: vi
        .fn()
        .mockReturnValue({ healthy: false, issues: [{ type: "oscillation" }], stats: { recent: 2 } }),
    };

    const stage = new CodeSearchStage({ maxSteps: 3, timeoutMs: 60_000 });
    const result = await stage.run({ query: "Q" }, { runContext: { runId: "run_watchdog_osc" }, modelRouter, watchdog });

    expect(result.completionReason).toBe("watchdog_oscillation");
    expect(stage.loopState?.observations.join("\n")).toContain("重复调用同一工具");
  });

  it("marks loop as FAILED when execution step throws (non-pause error)", async () => {
    let idx = 0;
    const modelRouter = {
      call: vi.fn(async () => {
        idx += 1;
        if (idx === 1) {
          return { content: JSON.stringify([{ text: "List root", priority: "high" }]) };
        }
        if (idx === 2) {
          throw new Error("boom");
        }
        return { content: "Summary after failure." };
      }),
    };

    const stage = new CodeSearchStage({ maxSteps: 2 });
    const result = await stage.run({ query: "Inspect repo" }, { runContext: { runId: "run4" }, modelRouter });

    expect(result.summary).toBe("Summary after failure.");
    expect(stage.loopStatus).toBe(AgentStatus.FAILED);
  });

  it("registerCodeSearchStages registers the pipeline stage", () => {
    const orchestrator = { registerStage: vi.fn() };
    registerCodeSearchStages(orchestrator, { timeoutMs: 123 });

    expect(orchestrator.registerStage).toHaveBeenCalledWith(
      "codesearch.pipeline",
      runCodeSearchStage,
      expect.objectContaining({ actor: "codesearch", timeoutMs: 123 })
    );
  });
});
