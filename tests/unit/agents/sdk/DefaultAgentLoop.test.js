// Unit tests for DefaultAgentLoop covering normal, boundary, and error paths.
// Focuses on public run-loop behavior, checkpoints, and action execution modes.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../js/agents/runtime/core/agent-loop.js", () => {
  const checkCancelled = vi.fn((signal) => {
    if (signal && signal.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
  });

  class BaseAgentLoop {
    constructor(options = {}) {
      this.actor = options.actor || "agent";
      this.stageName = options.stageName || this.actor;
      this.eventBus = options.eventBus || null;
      this.logger = options.logger || null;
      this.messages = [];
    }

    async resetMessages() {
      this.messages = [];
    }

    addMessage(message) {
      this.messages.push(message);
    }

    addMessages(messages) {
      this.messages.push(...messages);
    }
  }

  return { BaseAgentLoop, checkCancelled };
});

vi.mock("../../../../js/agents/shared/index.js", () => {
  const isPlainObject = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const toNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };

  const safeInt = (value) => {
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : Number.NaN;
    return Number.isFinite(numeric) ? Math.floor(numeric) : null;
  };

  const robustParseJson = vi.fn((input) => {
    if (typeof input !== "string") return null;
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  });

  return { robustParseJson, isPlainObject, safeInt, toNonEmptyString };
});

vi.mock("../../../../js/agents/runtime/core/middleware/middleware-chain.js", () => {
  const createDefaultMiddlewareChain = vi.fn(() => ({
    execute: (ctx, next) => next(ctx),
  }));
  return { createDefaultMiddlewareChain };
});

vi.mock("../../../../js/agents/plugins/checkpoints/index.js", () => {
  const AgentCheckpointStore = vi.fn().mockImplementation(function (options = {}) {
    this.options = options;
    this.runId = options.runId ?? null;
    this.saveCheckpoint = vi.fn(async (payload) => ({ checkpointId: "checkpoint-1", ...payload }));
    this.loadCheckpoint = vi.fn(async () => null);
  });
  return { AgentCheckpointStore };
});

vi.mock("../../../../js/agents/plugins/telemetry/index.js", () => {
  const stateBySignal = new WeakMap();
  const ensureRuntimeState = vi.fn((signal) => {
    if (!signal || typeof signal !== "object") return {};
    if (!stateBySignal.has(signal)) stateBySignal.set(signal, {});
    return stateBySignal.get(signal);
  });
  return { ensureRuntimeState };
});

import * as DefaultAgentLoopModule from "../../../../js/agents/sdk/DefaultAgentLoop.js";
import { createDefaultMiddlewareChain } from "../../../../js/agents/runtime/core/middleware/middleware-chain.js";
import { AgentCheckpointStore } from "../../../../js/agents/plugins/checkpoints/index.js";
import { ensureRuntimeState } from "../../../../js/agents/plugins/telemetry/index.js";
import { robustParseJson } from "../../../../js/agents/shared/index.js";

const DefaultAgentLoop = DefaultAgentLoopModule.default;
const NamedDefaultAgentLoop = DefaultAgentLoopModule.DefaultAgentLoop;

beforeEach(() => {
  vi.clearAllMocks();
});

const makeDeepObject = (depth) => {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.child = { index: i };
    node = node.child;
  }
  return root;
};

const findResultsMessage = (loop) =>
  loop.messages.find((msg) => msg.role === "user" && typeof msg.content === "string" && msg.content.startsWith("Results:"));

describe("DefaultAgentLoop exports", () => {
  it("should_export_default_as_named_class_when_importing_all_exports", () => {
    expect(DefaultAgentLoop).toBe(NamedDefaultAgentLoop);
  });

  it("should_construct_instance_when_using_default_export", () => {
    const loop = new DefaultAgentLoop();
    expect(loop).toBeInstanceOf(NamedDefaultAgentLoop);
  });
});

describe("DefaultAgentLoop constructor", () => {
  it("should_normalize_options_when_invalid_values_provided", () => {
    const loop = new DefaultAgentLoop({
      actor: "actor",
      stageName: "stage",
      maxIterations: Number.MAX_SAFE_INTEGER,
      maxToolResultChars: -1,
      maxParallelActions: 0,
      usage: "   ",
      permissionLevel: "   ",
      actionExecution: "bogus",
      capabilities: [],
    });

    expect({
      actor: loop.actor,
      stageName: loop.stageName,
      maxIterations: loop.maxIterations,
      maxToolResultChars: loop.maxToolResultChars,
      maxParallelActions: loop.maxParallelActions,
      usage: loop.usage,
      permissionLevel: loop.permissionLevel,
      actionExecution: loop.actionExecution,
      capabilities: loop.capabilities,
    }).toEqual({
      actor: "actor",
      stageName: "stage",
      maxIterations: Number.MAX_SAFE_INTEGER,
      maxToolResultChars: 1000,
      maxParallelActions: 1,
      usage: "worker",
      permissionLevel: null,
      actionExecution: "sequential",
      capabilities: null,
    });
  });

  it("should_create_default_middleware_chain_when_none_provided", () => {
    new DefaultAgentLoop();
    expect(createDefaultMiddlewareChain).toHaveBeenCalledTimes(1);
  });

  it("should_not_create_default_middleware_chain_when_custom_chain_provided", () => {
    new DefaultAgentLoop({ middlewareChain: { execute: vi.fn(async (ctx, next) => next(ctx)) } });
    expect(createDefaultMiddlewareChain).not.toHaveBeenCalled();
  });

  it("should_parse_numeric_strings_for_iteration_and_parallel_limits", () => {
    const loop = new DefaultAgentLoop({ maxIterations: "3", maxParallelActions: "2" });
    expect({ maxIterations: loop.maxIterations, maxParallelActions: loop.maxParallelActions }).toEqual({
      maxIterations: 3,
      maxParallelActions: 2,
    });
  });

  it("should_set_parallel_actionExecution_when_configured", () => {
    const loop = new DefaultAgentLoop({ actionExecution: "parallel" });
    expect(loop.actionExecution).toBe("parallel");
  });
});

describe("DefaultAgentLoop system prompt", () => {
  it("should_include_capability_names_when_capabilities_present", () => {
    const loop = new DefaultAgentLoop({
      capabilities: new Map([
        ["alpha", {}],
        ["beta", {}],
      ]),
    });

    expect(loop._buildSystemPrompt()).toContain("Available capability names: alpha, beta");
  });

  it("should_include_catalog_prompt_when_getCatalogPrompt_returns_text", () => {
    const loop = new DefaultAgentLoop({
      capabilities: new Map([["alpha", {}]]),
      getCatalogPrompt: () => "Catalog block",
    });

    expect(loop._buildSystemPrompt()).toContain("Catalog block");
  });

  it("should_render_none_when_capabilities_missing", () => {
    const loop = new DefaultAgentLoop();
    expect(loop._buildSystemPrompt()).toContain("Available capability names: (none)");
  });
});

describe("DefaultAgentLoop.run preflight", () => {
  it("should_return_idle_when_input_null", async () => {
    const loop = new DefaultAgentLoop();
    const result = await loop.run(null, {});
    expect(result.mode).toBe("idle");
  });

  it("should_return_idle_when_input_empty_string", async () => {
    const loop = new DefaultAgentLoop();
    const result = await loop.run("", {});
    expect(result.mode).toBe("idle");
  });

  it("should_return_idle_when_query_is_whitespace", async () => {
    const loop = new DefaultAgentLoop();
    const result = await loop.run({ query: "   " }, {});
    expect(result.mode).toBe("idle");
  });

  it("should_return_idle_when_input_is_empty_object", async () => {
    const loop = new DefaultAgentLoop();
    const result = await loop.run({}, {});
    expect(result.mode).toBe("idle");
  });

  it("should_return_capabilities_list_when_idle_and_capabilities_present", async () => {
    const loop = new DefaultAgentLoop({ capabilities: new Map([["alpha", {}]]) });
    const result = await loop.run("", {});
    expect(result.capabilities).toEqual(["alpha"]);
  });

  it("should_return_no_model_when_query_provided_and_no_model_caller_configured", async () => {
    const loop = new DefaultAgentLoop();
    const result = await loop.run("hello", {});
    expect(result.mode).toBe("no_model");
  });
});

describe("DefaultAgentLoop.run direct tool", () => {
  it("should_return_tool_mode_when_tool_requested", async () => {
    const toolExecutor = vi.fn(async () => ({ ok: true }));
    const loop = new DefaultAgentLoop();

    const result = await loop.run({ tool: "calc", params: { x: 1 } }, { toolExecutor });

    expect(result.mode).toBe("tool");
  });

  it("should_prefer_params_when_args_is_not_plain_object", async () => {
    const toolExecutor = vi.fn(async () => ({ ok: true }));
    const loop = new DefaultAgentLoop();

    await loop.run({ tool: "calc", args: [], params: { x: 1 } }, { toolExecutor });

    expect(toolExecutor).toHaveBeenCalledWith("calc", { x: 1 }, expect.any(Object));
  });

  it("should_execute_direct_tool_through_middleware_chain", async () => {
    const toolExecutor = vi.fn(async () => ({ ok: true }));
    const middlewareChain = { execute: vi.fn(async (ctx, next) => next(ctx)) };
    const loop = new DefaultAgentLoop();

    await loop.run({ tool: "calc", params: { x: 1 } }, { toolExecutor, middlewareChain });

    expect(middlewareChain.execute).toHaveBeenCalledTimes(1);
  });

  it("should_pass_tool_name_on_context_when_running_direct_tool", async () => {
    const toolExecutor = vi.fn(async (_name, _args, ctx) => ({ ok: true, ctxTool: ctx.tool }));
    const loop = new DefaultAgentLoop();

    const result = await loop.run({ tool: "calc", params: { x: 1 } }, { toolExecutor });

    expect(result.result.ctxTool).toBe("calc");
  });
});

describe("DefaultAgentLoop.run model parsing", () => {
  it("should_return_parsed_false_when_model_response_is_not_json", async () => {
    const callModel = vi.fn(async () => ({ text: "not json" }));
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    const result = await loop.run("hello", { callModel });

    expect(result.parsed).toBe(false);
  });

  it("should_call_robustParseJson_with_raw_model_content", async () => {
    const callModel = vi.fn(async () => ({ text: "not json" }));
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    await loop.run("hello", { callModel });

    expect(robustParseJson).toHaveBeenCalledWith("not json");
  });

  it("should_return_empty_output_when_actions_array_is_empty", async () => {
    const callModel = vi.fn(async () => ({ content: JSON.stringify({ actions: [] }) }));
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    const result = await loop.run("hello", { callModel });

    expect(result.output).toBe("");
  });

  it("should_return_final_output_when_complete_action_present_in_action_list", async () => {
    const callModel = vi.fn(async () => ({
      message: {
        content: JSON.stringify({
          actions: [
            { action: "search", args: { q: "x" } },
            { action: "complete", final: "done" },
          ],
        }),
      },
    }));
    const loop = new DefaultAgentLoop();

    const result = await loop.run("query", { callModel, toolExecutor: vi.fn() });

    expect(result.output).toBe("done");
  });

  it("should_not_execute_tools_when_complete_action_present_in_action_list", async () => {
    const callModel = vi.fn(async () => ({
      message: {
        content: JSON.stringify({
          actions: [
            { action: "search", args: { q: "x" } },
            { action: "complete", final: "done" },
          ],
        }),
      },
    }));
    const toolExecutor = vi.fn(async () => ({ ok: true }));
    const loop = new DefaultAgentLoop();

    await loop.run("query", { callModel, toolExecutor });

    expect(toolExecutor).not.toHaveBeenCalled();
  });
});

describe("DefaultAgentLoop.run tool execution", () => {
  const runTwoToolRoundTrip = async () => {
    const deep = makeDeepObject(60);
    const huge = "x".repeat(5000);
    const toolExecutor = vi.fn(async (name) => {
      if (name === "alpha") return { ok: true, payload: deep };
      return { ok: true, text: huge };
    });
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ actions: [{ action: "alpha" }, { action: "beta" }] }))
      .mockResolvedValueOnce(JSON.stringify({ action: "complete", final: "done" }));

    const loop = new DefaultAgentLoop({ maxToolResultChars: 1000 });
    const result = await loop.run("query", { callModel, toolExecutor });
    return { loop, result, toolExecutor };
  };

  it("should_return_final_output_after_tools_then_complete", async () => {
    const { result } = await runTwoToolRoundTrip();
    expect(result.output).toBe("done");
  });

  it("should_record_toolCalls_for_each_tool_action", async () => {
    const { result } = await runTwoToolRoundTrip();
    expect(result.toolCalls).toHaveLength(2);
  });

  it("should_call_toolExecutor_for_each_tool_action_in_order", async () => {
    const { toolExecutor } = await runTwoToolRoundTrip();
    expect(toolExecutor.mock.calls.map((call) => call[0])).toEqual(["alpha", "beta"]);
  });

  it("should_add_results_user_message_when_tools_executed", async () => {
    const { loop } = await runTwoToolRoundTrip();
    expect(findResultsMessage(loop)).toBeTruthy();
  });

  it("should_truncate_tool_results_when_results_exceed_maxToolResultChars", async () => {
    const { loop } = await runTwoToolRoundTrip();
    expect(findResultsMessage(loop)?.content).toContain("...(truncated");
  });

  it("should_return_error_when_tool_action_requested_without_toolExecutor", async () => {
    const callModel = vi.fn(async () => JSON.stringify({ action: "search", args: { q: "x" } }));
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    const result = await loop.run("query", { callModel });

    expect(result.error).toContain("No toolExecutor available for action: search");
  });

  it("should_record_failed_tool_result_when_toolExecutor_throws", async () => {
    const toolExecutor = vi.fn(async () => {
      throw new Error("tool boom");
    });
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ action: "failtool", args: { a: 1 } }))
      .mockResolvedValueOnce(JSON.stringify({ action: "complete", final: "ok" }));

    const loop = new DefaultAgentLoop();
    const result = await loop.run("query", { callModel, toolExecutor, emit: vi.fn() });

    expect(result.toolCalls[0].result).toMatchObject({ ok: false, error: "tool boom" });
  });

  it("should_emit_toolError_when_toolExecutor_throws", async () => {
    const toolExecutor = vi.fn(async () => {
      throw new Error("tool boom");
    });
    const emit = vi.fn();
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ action: "failtool", args: { a: 1 } }))
      .mockResolvedValueOnce(JSON.stringify({ action: "complete", final: "ok" }));

    const loop = new DefaultAgentLoop();
    await loop.run("query", { callModel, toolExecutor, emit });

    expect(emit).toHaveBeenCalledWith("agent:toolError", expect.objectContaining({ tool: "failtool", error: "tool boom" }));
  });

  it("should_emit_dmailProcessed_when_tool_result_contains_dmail_and_no_manager", async () => {
    const toolExecutor = vi.fn(async () => ({ ok: true, dmail: { kind: "signal" } }));
    const emit = vi.fn();
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ action: "mailtool", args: {} }))
      .mockResolvedValueOnce(JSON.stringify({ action: "complete", final: "ok" }));

    const loop = new DefaultAgentLoop();
    await loop.run("query", { callModel, toolExecutor, emit });

    expect(emit).toHaveBeenCalledWith("agent:dmailProcessed", expect.any(Object));
  });

  it("should_call_softBacktrackManager_when_tool_result_contains_dmail", async () => {
    const manager = { processDMailSignal: vi.fn(async () => ({ success: true })) };
    const toolExecutor = vi.fn(async () => ({ ok: true, dmail: { kind: "signal" } }));
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ action: "mailtool", args: {} }))
      .mockResolvedValueOnce(JSON.stringify({ action: "complete", final: "ok" }));

    const loop = new DefaultAgentLoop({ softBacktrackManager: manager });
    await loop.run("query", { callModel, toolExecutor });

    expect(manager.processDMailSignal).toHaveBeenCalledTimes(1);
  });
});

describe("DefaultAgentLoop checkpoints", () => {
  it("should_throw_when_model_call_fails", async () => {
    const checkpointStore = {
      runId: null,
      saveCheckpoint: vi.fn(async (payload) => ({ checkpointId: "cp-err", ...payload })),
      loadCheckpoint: vi.fn(async () => null),
    };
    const callModel = vi.fn(async () => {
      throw new Error("model failure");
    });
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    await expect(
      loop.run({ query: "hello", runId: "run-err", checkpoint: true }, { callModel, checkpointStore, emit: vi.fn() })
    ).rejects.toThrow("model failure");
  });

  it("should_save_checkpoint_with_model_error_status_when_model_call_fails", async () => {
    const checkpointStore = {
      runId: null,
      saveCheckpoint: vi.fn(async (payload) => ({ checkpointId: "cp-err", ...payload })),
      loadCheckpoint: vi.fn(async () => null),
    };
    const callModel = vi.fn(async () => {
      throw new Error("model failure");
    });
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    try {
      await loop.run({ query: "hello", runId: "run-err", checkpoint: true }, { callModel, checkpointStore, emit: vi.fn() });
    } catch {
      // expected
    }

    expect(checkpointStore.saveCheckpoint.mock.calls[0][0].metadata.status).toBe("model_error");
  });

  it("should_emit_modelError_when_model_call_fails", async () => {
    const checkpointStore = {
      runId: null,
      saveCheckpoint: vi.fn(async (payload) => ({ checkpointId: "cp-err", ...payload })),
      loadCheckpoint: vi.fn(async () => null),
    };
    const emit = vi.fn();
    const callModel = vi.fn(async () => {
      throw new Error("model failure");
    });
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    try {
      await loop.run({ query: "hello", runId: "run-err", checkpoint: true }, { callModel, checkpointStore, emit });
    } catch {
      // expected
    }

    expect(emit).toHaveBeenCalledWith("agent:modelError", expect.objectContaining({ error: "model failure" }));
  });

  it("should_call_loadCheckpoint_with_step_restore_when_restore_is_number", async () => {
    const seededMessages = [
      { role: "system", content: "seed system" },
      { role: "user", content: "seed user" },
    ];
    const checkpointStore = {
      runId: "run-restore",
      saveCheckpoint: vi.fn(async (payload) => ({ checkpointId: "cp-restore", ...payload })),
      loadCheckpoint: vi.fn(async () => ({
        messages: seededMessages,
        toolCalls: [],
        results: [],
        iteration: 0,
        runId: "run-restore",
      })),
    };
    const callModel = vi.fn(async () => JSON.stringify({ action: "complete", final: "done" }));

    const loop = new DefaultAgentLoop();
    await loop.run({ query: "ignored", runId: "run-restore", checkpoint: { restore: 0 } }, { callModel, checkpointStore });

    expect(checkpointStore.loadCheckpoint).toHaveBeenCalledWith({ runId: "run-restore", mode: "step", step: 0 });
  });

  it("should_seed_messages_from_checkpoint_when_checkpoint_restored", async () => {
    const seededMessages = [
      { role: "system", content: "seed system" },
      { role: "user", content: "seed user" },
    ];
    const checkpointStore = {
      runId: "run-restore",
      saveCheckpoint: vi.fn(async (payload) => ({ checkpointId: "cp-restore", ...payload })),
      loadCheckpoint: vi.fn(async () => ({
        messages: seededMessages,
        toolCalls: [],
        results: [],
        iteration: 0,
        runId: "run-restore",
      })),
    };
    const callModel = vi.fn(async () => JSON.stringify({ action: "complete", final: "done" }));

    const loop = new DefaultAgentLoop();
    await loop.run({ query: "ignored", runId: "run-restore", checkpoint: { restore: 0 } }, { callModel, checkpointStore });

    expect(loop.messages.slice(0, seededMessages.length)).toEqual(seededMessages);
  });

  it("should_create_AgentCheckpointStore_when_vfs_provided_and_checkpoint_enabled", async () => {
    const callModel = vi.fn(async () => JSON.stringify({ action: "complete", final: "done" }));
    const loop = new DefaultAgentLoop();

    await loop.run(
      { query: "hi", checkpoint: { enabled: true } },
      { callModel, emit: vi.fn(), signal: new AbortController().signal, vfs: {} }
    );

    expect(AgentCheckpointStore).toHaveBeenCalledTimes(1);
  });

  it("should_generate_runId_when_persist_enabled_and_runId_missing", async () => {
    const callModel = vi.fn(async () => JSON.stringify({ action: "complete", final: "done" }));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);

    const loop = new DefaultAgentLoop();
    await loop.run(
      { query: "hi", checkpoint: { enabled: true } },
      { callModel, emit: vi.fn(), signal: new AbortController().signal, vfs: {} }
    );

    nowSpy.mockRestore();

    expect(AgentCheckpointStore.mock.instances[0].runId).toBe("123456");
  });

  it("should_update_runtime_state_lastCheckpointId_when_checkpoint_saved", async () => {
    const callModel = vi.fn(async () => JSON.stringify({ action: "complete", final: "done" }));
    const controller = new AbortController();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);

    const loop = new DefaultAgentLoop();
    await loop.run(
      { query: "hi", checkpoint: { enabled: true } },
      { callModel, emit: vi.fn(), signal: controller.signal, vfs: {} }
    );

    nowSpy.mockRestore();

    expect(ensureRuntimeState(controller.signal).lastCheckpointId).toBe("checkpoint-1");
  });

  it("should_emit_archive_checkpointSaved_when_checkpoint_saved", async () => {
    const callModel = vi.fn(async () => JSON.stringify({ action: "complete", final: "done" }));
    const emit = vi.fn();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);

    const loop = new DefaultAgentLoop();
    await loop.run(
      { query: "hi", checkpoint: { enabled: true } },
      { callModel, emit, signal: new AbortController().signal, vfs: {} }
    );

    nowSpy.mockRestore();

    expect(emit).toHaveBeenCalledWith(
      "archive:checkpointSaved",
      expect.objectContaining({ runId: "123456", checkpointId: "checkpoint-1" })
    );
  });
});

describe("DefaultAgentLoop action execution modes", () => {
  it("should_limit_parallel_tool_concurrency_to_maxParallelActions", async () => {
    const loop = new DefaultAgentLoop({ actionExecution: "parallel", maxParallelActions: 2 });
    const toolActions = [{ action: "a" }, { action: "b" }, { action: "c" }, { action: "d" }, { action: "e" }];

    const inFlight = { count: 0, max: 0 };
    const toolExecutor = vi.fn(async () => {
      inFlight.count += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.count);
      await Promise.resolve();
      inFlight.count -= 1;
      return { ok: true };
    });
    const runWithMiddleware = vi.fn(async (_step, handler, extra) => handler({ ...(extra || {}) }));

    await loop._executeToolActions({ toolActions, toolExecutor, runWithMiddleware, baseCtx: {}, emit: null, iteration: 1 });

    expect({ calls: toolExecutor.mock.calls.length, max: inFlight.max }).toEqual({ calls: 5, max: 2 });
  });
});

describe("DefaultAgentLoop concurrency boundaries", () => {
  it("should_support_rapid_consecutive_runs_on_the_same_instance", async () => {
    const callModel = vi.fn(async (messages) => {
      const last = Array.isArray(messages) ? messages[messages.length - 1]?.content : "";
      return { content: JSON.stringify({ action: "complete", final: `echo:${last}` }) };
    });

    const loop = new DefaultAgentLoop();
    const first = await loop.run("first", { callModel });
    const second = await loop.run("second", { callModel });

    expect({ first: first.output, second: second.output }).toEqual({ first: "echo:first", second: "echo:second" });
  });

  it("should_reset_messages_between_consecutive_runs", async () => {
    const callModel = vi.fn(async (messages) => {
      const last = Array.isArray(messages) ? messages[messages.length - 1]?.content : "";
      return { content: JSON.stringify({ action: "complete", final: `echo:${last}` }) };
    });

    const loop = new DefaultAgentLoop();
    await loop.run("first", { callModel });
    await loop.run("second", { callModel });

    expect(loop.messages[1]?.content).toBe("second");
  });

  it("should_support_simultaneous_runs_on_separate_instances", async () => {
    const loopA = new DefaultAgentLoop();
    const loopB = new DefaultAgentLoop();
    const callModelA = vi.fn(async () => ({ content: JSON.stringify({ action: "complete", final: "A" }) }));
    const callModelB = vi.fn(async () => ({ content: JSON.stringify({ action: "complete", final: "B" }) }));

    const [resultA, resultB] = await Promise.all([
      loopA.run("qa", { callModel: callModelA }),
      loopB.run("qb", { callModel: callModelB }),
    ]);

    expect({ A: resultA.output, B: resultB.output }).toEqual({ A: "A", B: "B" });
  });
});

describe("DefaultAgentLoop cancellation", () => {
  it("should_throw_AbortError_when_signal_is_aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const loop = new DefaultAgentLoop({ maxIterations: 1 });
    await expect(loop.run("hello", { callModel: vi.fn(), signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("DefaultAgentLoop model caller resolution", () => {
  it("should_use_stageApi_callModel_when_callModel_is_provided", async () => {
    const controller = new AbortController();
    const callModel = vi.fn(async () => ({ content: JSON.stringify({ action: "complete", final: "done" }) }));

    const loop = new DefaultAgentLoop();
    await loop.run("hello", { callModel, signal: controller.signal });

    expect(callModel.mock.calls[0][1]).toMatchObject({ usage: "worker", signal: controller.signal });
  });

  it("should_use_modelRouter_legacy_signature_when_call_arity_is_ge_2", async () => {
    const controller = new AbortController();
    let captured = null;
    const modelRouter = {
      call: function (messages, opts) {
        captured = { messages, opts };
        return { content: JSON.stringify({ action: "complete", final: "done" }) };
      },
    };

    const loop = new DefaultAgentLoop();
    await loop.run("hello", { modelRouter, signal: controller.signal });

    expect(captured?.opts).toMatchObject({ usage: "worker", signal: controller.signal });
  });

  it("should_use_modelRouter_new_signature_when_call_arity_is_lt_2", async () => {
    const controller = new AbortController();
    let captured = null;
    const modelRouter = {
      call: function (payload) {
        captured = payload;
        return { content: JSON.stringify({ action: "complete", final: "done" }) };
      },
    };

    const loop = new DefaultAgentLoop();
    await loop.run("hello", { modelRouter, signal: controller.signal });

    expect(captured).toMatchObject({ usage: "worker", signal: controller.signal });
  });

  it("should_use_aiApiService_chat_when_aiApiService_provided", async () => {
    const controller = new AbortController();
    let captured = null;
    const aiApiService = {
      chat: function (payload) {
        captured = payload;
        return { content: JSON.stringify({ action: "complete", final: "done" }) };
      },
    };

    const loop = new DefaultAgentLoop();
    await loop.run("hello", { aiApiService, signal: controller.signal });

    expect(captured).toMatchObject({ usage: "worker", signal: controller.signal });
  });
});