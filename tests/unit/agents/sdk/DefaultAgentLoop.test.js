// Unit tests for DefaultAgentLoop covering normal, boundary, and error paths.
// Focuses on run-loop behavior, checkpoints, and parallel tool execution.
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import DefaultAgentLoop, { DefaultAgentLoop as NamedDefaultAgentLoop } from "../../../../js/agents/sdk/DefaultAgentLoop.js";
import { createDefaultMiddlewareChain } from "../../../../js/agents/runtime/core/middleware/middleware-chain.js";
import { AgentCheckpointStore } from "../../../../js/agents/plugins/checkpoints/index.js";
import { ensureRuntimeState } from "../../../../js/agents/plugins/telemetry/index.js";
import { robustParseJson } from "../../../../js/agents/shared/index.js";

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

describe("DefaultAgentLoop", () => {
  it("normalizes options and uses default middleware", () => {
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

    expect(loop.actor).toBe("actor");
    expect(loop.stageName).toBe("stage");
    expect(loop.maxIterations).toBe(Number.MAX_SAFE_INTEGER);
    expect(loop.maxToolResultChars).toBe(1000);
    expect(loop.maxParallelActions).toBe(1);
    expect(loop.usage).toBe("worker");
    expect(loop.permissionLevel).toBe(null);
    expect(loop.actionExecution).toBe("sequential");
    expect(loop.capabilities).toBe(null);
    expect(createDefaultMiddlewareChain).toHaveBeenCalledTimes(1);

    const numericLoop = new DefaultAgentLoop({ maxIterations: "3", maxParallelActions: "2" });
    expect(numericLoop.maxIterations).toBe(3);
    expect(numericLoop.maxParallelActions).toBe(2);
  });

  it("builds system prompt with tool list and catalog", () => {
    const loop = new DefaultAgentLoop({
      capabilities: new Map([
        ["alpha", {}],
        ["beta", {}],
      ]),
      getCatalogPrompt: () => "Catalog block",
    });

    const prompt = loop._buildSystemPrompt();
    expect(prompt).toContain("Available capability names: alpha, beta");
    expect(prompt).toContain("Catalog block");
  });

  it("builds system prompt with (none) when no capabilities", () => {
    const loop = new DefaultAgentLoop();
    const prompt = loop._buildSystemPrompt();
    expect(prompt).toContain("Available capability names: (none)");
  });

  it("returns idle when query is missing (null, empty, whitespace, empty object)", async () => {
    const loop = new DefaultAgentLoop({ capabilities: new Map() });

    const resultNull = await loop.run(null, {});
    expect(resultNull.mode).toBe("idle");

    const resultEmpty = await loop.run("", {});
    expect(resultEmpty.mode).toBe("idle");

    const resultWhitespace = await loop.run({ query: "   " }, {});
    expect(resultWhitespace.mode).toBe("idle");
    expect(resultWhitespace.capabilities).toEqual([]);

    const resultEmptyObject = await loop.run({}, {});
    expect(resultEmptyObject.mode).toBe("idle");
  });

  it("returns no_model when query provided but no model caller", async () => {
    const loop = new DefaultAgentLoop();
    const result = await loop.run("hello", {});
    expect(result.success).toBe(false);
    expect(result.mode).toBe("no_model");
  });

  it("runs direct tools with middleware and prefers params when args is not plain", async () => {
    const toolExecutor = vi.fn(async (name, args, ctx) => ({ ok: true, name, args, ctxTool: ctx.tool }));
    const middlewareChain = {
      execute: vi.fn(async (ctx, next) => next(ctx)),
    };

    const loop = new DefaultAgentLoop();
    const result = await loop.run(
      { tool: "calc", args: [], params: { x: 1 } },
      { toolExecutor, middlewareChain }
    );

    expect(result.success).toBe(true);
    expect(result.mode).toBe("tool");
    expect(result.tool).toBe("calc");
    expect(result.result.ok).toBe(true);
    expect(toolExecutor).toHaveBeenCalledWith("calc", { x: 1 }, expect.any(Object));
    expect(middlewareChain.execute).toHaveBeenCalled();
  });

  it("returns parsed=false when model response is unparsed", async () => {
    const callModel = vi.fn(async () => ({ text: "not json" }));
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    const result = await loop.run("hello", { callModel });

    expect(result.success).toBe(true);
    expect(result.parsed).toBe(false);
    expect(result.output).toBe("not json");
    expect(robustParseJson).toHaveBeenCalledWith("not json");
  });

  it("handles empty actions array by completing with empty output", async () => {
    const callModel = vi.fn(async () => ({ content: JSON.stringify({ actions: [] }) }));
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    const result = await loop.run("hello", { callModel });

    expect(result.success).toBe(true);
    expect(result.parsed).toBe(true);
    expect(result.output).toBe("");
  });

  it("short-circuits when actions include complete before tools", async () => {
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

    const result = await loop.run("query", { callModel, toolExecutor });

    expect(result.success).toBe(true);
    expect(result.output).toBe("done");
    expect(toolExecutor).not.toHaveBeenCalled();
  });

  it("runs tool actions sequentially and truncates large results", async () => {
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

    expect(result.success).toBe(true);
    expect(result.output).toBe("done");
    expect(toolExecutor).toHaveBeenCalledTimes(2);
    expect(toolExecutor).toHaveBeenNthCalledWith(1, "alpha", {}, expect.any(Object));
    expect(toolExecutor).toHaveBeenNthCalledWith(2, "beta", {}, expect.any(Object));
    expect(result.toolCalls).toHaveLength(2);

    const resultsMessage = loop.messages.find(
      (msg) => msg.role === "user" && typeof msg.content === "string" && msg.content.startsWith("Results:")
    );
    expect(resultsMessage).toBeTruthy();
    expect(resultsMessage.content).toContain("...(truncated");
  });

  it("returns error when tool actions exist but no toolExecutor", async () => {
    const callModel = vi.fn(async () => JSON.stringify({ action: "search", args: { q: "x" } }));
    const loop = new DefaultAgentLoop({ maxIterations: 1 });

    const result = await loop.run("query", { callModel });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No toolExecutor available for action: search");
  });

  it("captures tool execution errors and emits toolError", async () => {
    const toolExecutor = vi.fn(async () => {
      throw new Error("tool boom");
    });
    const emit = vi.fn();
    const callModel = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ action: "failtool", args: { a: 1 } }))
      .mockResolvedValueOnce(JSON.stringify({ action: "complete", final: "ok" }));

    const loop = new DefaultAgentLoop();
    const result = await loop.run("query", { callModel, toolExecutor, emit });

    expect(result.success).toBe(true);
    expect(result.output).toBe("ok");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].result.ok).toBe(false);
    expect(result.toolCalls[0].result.error).toContain("tool boom");
    expect(emit).toHaveBeenCalledWith(
      "agent:toolError",
      expect.objectContaining({ tool: "failtool", error: "tool boom" })
    );
  });

  it("saves checkpoint and emits when model call fails", async () => {
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

    await expect(loop.run({ query: "hello", checkpoint: true }, { callModel, checkpointStore, emit })).rejects.toThrow(
      "model failure"
    );

    expect(checkpointStore.saveCheckpoint).toHaveBeenCalled();
    const savedPayload = checkpointStore.saveCheckpoint.mock.calls[0][0];
    expect(savedPayload.metadata.status).toBe("model_error");
    expect(emit).toHaveBeenCalledWith("agent:modelError", expect.objectContaining({ error: "model failure" }));
  });

  it("restores from checkpoint and seeds initial messages", async () => {
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
    const result = await loop.run(
      { query: "ignored", runId: "run-restore", checkpoint: { restore: 0 } },
      { callModel, checkpointStore }
    );

    expect(result.output).toBe("done");
    expect(checkpointStore.loadCheckpoint).toHaveBeenCalledWith({ runId: "run-restore", mode: "step", step: 0 });
    expect(loop.messages[0]).toEqual(seededMessages[0]);
    expect(loop.messages[1]).toEqual(seededMessages[1]);
  });

  it("persists checkpoints and updates runtime state", async () => {
    const callModel = vi.fn(async () => JSON.stringify({ action: "complete", final: "done" }));
    const emit = vi.fn();
    const controller = new AbortController();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);

    const loop = new DefaultAgentLoop();
    const result = await loop.run(
      { query: "hi", checkpoint: { enabled: true } },
      { callModel, emit, signal: controller.signal, vfs: {} }
    );

    nowSpy.mockRestore();

    expect(result.output).toBe("done");
    expect(AgentCheckpointStore).toHaveBeenCalledTimes(1);
    const store = AgentCheckpointStore.mock.instances[0];
    expect(store.runId).toBe("123456");
    expect(store.saveCheckpoint).toHaveBeenCalled();

    const runtimeState = ensureRuntimeState(controller.signal);
    expect(runtimeState.lastCheckpointId).toBe("checkpoint-1");
    expect(emit).toHaveBeenCalledWith(
      "archive:checkpointSaved",
      expect.objectContaining({ runId: "123456", checkpointId: "checkpoint-1" })
    );
  });

  it("executes tool actions in parallel batches up to maxParallelActions", async () => {
    const loop = new DefaultAgentLoop({ actionExecution: "parallel", maxParallelActions: 2 });
    const toolActions = [
      { action: "a" },
      { action: "b" },
      { action: "c" },
      { action: "d" },
      { action: "e" },
    ];
    const inFlight = { count: 0, max: 0 };
    const toolExecutor = vi.fn(async () => {
      inFlight.count += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.count);
      await Promise.resolve();
      inFlight.count -= 1;
      return { ok: true };
    });
    const runWithMiddleware = vi.fn(async (_step, handler, extra) => handler({ ...(extra || {}) }));

    const results = await loop._executeToolActions({
      toolActions,
      toolExecutor,
      runWithMiddleware,
      baseCtx: {},
      emit: null,
      iteration: 1,
    });

    expect(results).toHaveLength(5);
    expect(toolExecutor).toHaveBeenCalledTimes(5);
    expect(inFlight.max).toBe(2);
  });

  it("supports rapid consecutive runs on the same instance", async () => {
    const callModel = vi.fn(async (messages) => {
      const last = Array.isArray(messages) ? messages[messages.length - 1]?.content : "";
      return { content: JSON.stringify({ action: "complete", final: `echo:${last}` }) };
    });

    const loop = new DefaultAgentLoop();
    const first = await loop.run("first", { callModel });
    const second = await loop.run("second", { callModel });

    expect(first.output).toBe("echo:first");
    expect(second.output).toBe("echo:second");
    expect(loop.messages[1].content).toBe("second");
  });

  it("supports simultaneous runs on separate instances", async () => {
    const loopA = new DefaultAgentLoop();
    const loopB = new DefaultAgentLoop();
    const callModelA = vi.fn(async () => ({ content: JSON.stringify({ action: "complete", final: "A" }) }));
    const callModelB = vi.fn(async () => ({ content: JSON.stringify({ action: "complete", final: "B" }) }));

    const [resultA, resultB] = await Promise.all([
      loopA.run("qa", { callModel: callModelA }),
      loopB.run("qb", { callModel: callModelB }),
    ]);

    expect(resultA.output).toBe("A");
    expect(resultB.output).toBe("B");
  });
});

describe("default export", () => {
  it("exports the DefaultAgentLoop class", () => {
    expect(DefaultAgentLoop).toBe(NamedDefaultAgentLoop);
    const loop = new DefaultAgentLoop();
    expect(loop).toBeInstanceOf(NamedDefaultAgentLoop);
  });
});
