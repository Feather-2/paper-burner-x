import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js", () => {
  let lastCtorOptions = null;
  let lastRunArgs = null;
  let runImpl = null;

  class MockDeepSearchAgentLoop {
    constructor(opts) {
      lastCtorOptions = opts;
    }

    async run(input, ctx) {
      lastRunArgs = { input, ctx };
      if (runImpl) return await runImpl(input, ctx);
      return { ok: true };
    }
  }

  return {
    default: MockDeepSearchAgentLoop,
    AgentStatus: { COMPLETED: "completed" },
    __setRunImpl: (fn) => {
      runImpl = fn;
    },
    __getLastCtorOptions: () => lastCtorOptions,
    __getLastRunArgs: () => lastRunArgs,
    __reset: () => {
      lastCtorOptions = null;
      lastRunArgs = null;
      runImpl = null;
    },
  };
});

vi.mock("../../../../../js/agents/stages/deepsearch/tools/index.js", () => ({
  tools: {},
  executeTool: vi.fn(),
  getToolCatalogPrompt: vi.fn(() => "tools"),
}));

import { DeepSearchState } from '../../../../../js/agents/stages/deepsearch/state.js';
import { ensureState, runDeepSearchStage } from '../../../../../js/agents/stages/deepsearch/index.js';
import * as mockModule from '../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js';

const { __getLastCtorOptions, __getLastRunArgs, __reset, __setRunImpl } = mockModule;

describe("deepsearch/deepsearch-stage", () => {
  beforeEach(() => {
    __reset();
    vi.clearAllMocks();
  });

  it("ensureState returns input when already a DeepSearchState", () => {
    const state = new DeepSearchState({ runId: "run_in" });
    const resolved = ensureState({ runId: "run_ctx" }, state);
    expect(resolved).toBe(state);
  });

  it("ensureState returns nested state when input.state is a DeepSearchState", () => {
    const state = new DeepSearchState({ runId: "run_nested" });
    const resolved = ensureState({ runId: "run_ctx" }, { state });
    expect(resolved).toBe(state);
  });

  it("ensureState uses DeepSearchState.fromJSON for plain state objects", () => {
    const spy = vi.spyOn(DeepSearchState, "fromJSON");
    const resolved = ensureState({ runId: "run_ctx" }, { state: { runId: "run_json", taskGoal: "goal" } });

    expect(spy).toHaveBeenCalledWith({ runId: "run_json", taskGoal: "goal" });
    expect(resolved).toBeInstanceOf(DeepSearchState);
    expect(resolved.runId).toBe("run_json");

    spy.mockRestore();
  });

  it("ensureState normalizes invalid input shapes and uses runContext runId", () => {
    const resolved = ensureState(
      { runId: "run_edge" },
      { sources: "nope", assets: { nope: true }, taskGoal: 123, userConfig: "bad" },
    );

    expect(resolved.runId).toBe("run_edge");
    expect(resolved.taskGoal).toBe("");
    expect(resolved.userConfig).toEqual({});
    expect(resolved.L0.sources).toEqual([]);
    expect(resolved.L0.assets).toEqual([]);
  });

  it("runDeepSearchStage forwards config and surfaces run errors", async () => {
    const runError = new Error("boom");
    const stageApi = { eventBus: { emit: vi.fn() } };

    __setRunImpl(() => {
      throw runError;
    });

    await expect(
      runDeepSearchStage({ runId: "run1" }, { mode: "fast", userConfig: { maxIterations: 7 } }, stageApi),
    ).rejects.toThrow("boom");

    expect(__getLastCtorOptions()).toEqual({ eventBus: stageApi.eventBus, mode: "fast", maxIterations: 7 });
    const { input, ctx } = __getLastRunArgs();
    expect(input).toEqual({ mode: "fast", userConfig: { maxIterations: 7 } });
    expect(ctx.stageApi).toBe(stageApi);
    expect(ctx.runContext).toEqual({ runId: "run1" });
  });
});
