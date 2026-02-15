import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  const toText = (value) => {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  return {
    ...actual,
    estimateTokensCached: vi.fn((text, tokenCounter) => {
      const raw = toText(text);
      if (tokenCounter && typeof tokenCounter.count === "function") {
        return tokenCounter.count(raw);
      }
      return Math.ceil(raw.length / 4);
    }),
    getGlobalTokenCounter: vi.fn(() => ({
      count: (input) => Math.ceil(String(input ?? "").length / 4),
    })),
    createLogger: vi.fn(() => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
    createStageApi: vi.fn((options = {}) => ({
      ...options,
      emit: options.emit,
      eventBus: options.eventBus,
      signal: options.signal,
      checkCancelled: options.checkCancelled || (() => {}),
    })),
    checkCancelled: vi.fn(),
  };
});

vi.mock("../../../../../js/agents/plugins/compression/index.js", () => ({
  CompressionCoordinator: class {
    constructor(options) {
      this.options = options;
      this.shouldCompress = vi.fn(() => false);
      this.maybeCompress = vi.fn(async (messages) => ({ messages }));
    }
  },
}));

vi.mock("../../../../../js/agents/runtime/core/loop-runtime-state.js", async () => {
  const actual = await vi.importActual(
    "../../../../../js/agents/runtime/core/loop-runtime-state.js",
  );
  return {
    ...actual,
    getRuntimeState: vi.fn(() => null),
  };
});

vi.mock("../../../../../js/agents/runtime/hooks/hook-runner.js", () => ({
  createPreToolUseHook: vi.fn(() => async () => null),
  createPreAgentHook: vi.fn(() => async () => null),
  createPostAgentHook: vi.fn(() => async () => null),
}));

vi.mock("../../../../../js/agents/runtime/tools/schema-validator.js", () => ({
  validateArgs: vi.fn(() => ({ valid: true, errors: [] })),
  validateToolSchema: vi.fn(() => ({ valid: true, errors: [] })),
}));

let MessageManager;
let ToolRegistry;
let StatusController;
let DEFAULT_CONTEXT_CONFIG;
let mergeContextConfig;
let AgentStatus;
let StagePausedError;
let persistedOutput;
let validateArgs;
let createPreToolUseHook;
let getRuntimeState;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  ({
    MessageManager,
    ToolRegistry,
    StatusController,
    DEFAULT_CONTEXT_CONFIG,
    mergeContextConfig,
  } = await import("../../../../../js/agents/runtime/core/agent-loop.js"));
  ({ AgentStatus } = await import("../../../../../js/agents/runtime/core/agent-status.js"));
  ({ StagePausedError } = await import("../../../../../js/agents/runtime/core/stage-errors.js"));
  persistedOutput = await import("../../../../../js/agents/runtime/core/persisted-output.js");
  ({ validateArgs } = await import("../../../../../js/agents/runtime/tools/schema-validator.js"));
  ({ createPreToolUseHook } = await import("../../../../../js/agents/runtime/hooks/hook-runner.js"));
  ({ getRuntimeState } = await import("../../../../../js/agents/runtime/core/loop-runtime-state.js"));
});

describe("DEFAULT_CONTEXT_CONFIG", () => {
  it("is frozen with expected defaults", () => {
    expect(Object.isFrozen(DEFAULT_CONTEXT_CONFIG)).toBe(true);
    expect(DEFAULT_CONTEXT_CONFIG.contextWindow).toBe(128000);
    expect(DEFAULT_CONTEXT_CONFIG.maxOutputTokens).toBe(4096);
    expect(DEFAULT_CONTEXT_CONFIG.compressThreshold).toBe(0.9);
  });

  it("does not allow mutation", () => {
    const original = DEFAULT_CONTEXT_CONFIG.contextWindow;
    try {
      DEFAULT_CONTEXT_CONFIG.contextWindow = 1;
    } catch {
      // ignore
    }
    expect(DEFAULT_CONTEXT_CONFIG.contextWindow).toBe(original);
  });
});

describe("mergeContextConfig", () => {
  it("returns defaults for nullish or non-object inputs", () => {
    expect(mergeContextConfig(null)).toBe(DEFAULT_CONTEXT_CONFIG);
    expect(mergeContextConfig(undefined)).toBe(DEFAULT_CONTEXT_CONFIG);
    expect(mergeContextConfig("")).toBe(DEFAULT_CONTEXT_CONFIG);
    expect(mergeContextConfig("   ")).toBe(DEFAULT_CONTEXT_CONFIG);
  });

  it("merges overrides and freezes result", () => {
    const cfg = mergeContextConfig({
      contextWindow: 0,
      compressCooldownMs: -1,
      keepLastTurns: Number.MAX_SAFE_INTEGER,
    });
    expect(cfg.contextWindow).toBe(0);
    expect(cfg.compressCooldownMs).toBe(-1);
    expect(cfg.keepLastTurns).toBe(Number.MAX_SAFE_INTEGER);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("accepts string overrides and empty object", () => {
    const cfg = mergeContextConfig({ contextWindow: "1024", userMessageBuffer: "0" });
    expect(cfg.contextWindow).toBe("1024");
    expect(cfg.userMessageBuffer).toBe("0");
    const empty = mergeContextConfig({});
    expect(empty).not.toBe(DEFAULT_CONTEXT_CONFIG);
    expect(empty.contextWindow).toBe(DEFAULT_CONTEXT_CONFIG.contextWindow);
  });
});

describe("StatusController", () => {
  it("transitions and emits status changes", () => {
    const emit = vi.fn();
    const controller = new StatusController({
      status: AgentStatus.IDLE,
      emit,
      stageName: "stage",
      actor: "actor",
    });
    const entry = controller.transition(AgentStatus.RUNNING);
    expect(entry.from).toBe(AgentStatus.IDLE);
    expect(entry.to).toBe(AgentStatus.RUNNING);
    expect(typeof entry.timestamp).toBe("number");
    expect(controller.status).toBe(AgentStatus.RUNNING);
    expect(controller.statusHistory.length).toBe(1);
    expect(emit).toHaveBeenCalledWith(
      "stage.agent.status.changed",
      expect.objectContaining({
        actor: "actor",
        status: "info",
        payload: expect.objectContaining({ from: AgentStatus.IDLE, to: AgentStatus.RUNNING }),
      })
    );
  });

  it("throws on invalid transitions when strict", () => {
    const controller = new StatusController({ status: AgentStatus.IDLE, strict: true, stageName: "stage" });
    expect(() => controller.transition(AgentStatus.PAUSED)).toThrow(/transition rejected/);
  });

  it("records invalid transitions when strict is false", () => {
    const logger = { warn: vi.fn() };
    const controller = new StatusController({
      status: AgentStatus.IDLE,
      strict: false,
      logger,
      stageName: "stage",
    });
    const entry = controller.transition(AgentStatus.PAUSED);
    expect(entry.invalid).toBe(true);
    expect(controller.status).toBe(AgentStatus.PAUSED);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("pause and resume update flags", () => {
    const controller = new StatusController();
    controller.pause("reason");
    expect(controller.isPaused).toBe(true);
    expect(controller.pauseReason).toBe("reason");
    controller.resume();
    expect(controller.isPaused).toBe(false);
    expect(controller.pauseReason).toBe(null);
  });

  it("checkPaused throws when runtime state is paused", () => {
    getRuntimeState.mockReturnValue({
      status: "paused",
      lastCheckpointId: "cp_1",
      pausedReason: "manual",
    });
    const controller = new StatusController();
    let caught;
    try {
      controller.checkPaused(null);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StagePausedError);
    expect(caught.checkpointId).toBe("cp_1");
    expect(caught.reason).toBe("manual");
  });

  it("createPauseError uses runtime state and runId", () => {
    getRuntimeState.mockReturnValue({
      status: "paused",
      lastCheckpointId: "cp_2",
      pausedReason: "hold",
    });
    const controller = new StatusController();
    const err = controller.createPauseError({ runId: "run_1" });
    expect(err).toBeInstanceOf(StagePausedError);
    expect(err.checkpointId).toBe("cp_2");
    expect(err.reason).toBe("hold");
    expect(err.runId).toBe("run_1");
  });

  it("shouldPauseFromError respects abort and pause signals", () => {
    const controller = new StatusController();
    const abortController = new AbortController();
    abortController.abort("stop");
    controller.pause("user");
    expect(controller.shouldPauseFromError(new Error("aborted"), abortController.signal)).toBe(true);

    const controller2 = new StatusController();
    expect(controller2.shouldPauseFromError(new Error("aborted"), abortController.signal)).toBe(false);
  });

  it("allows empty string transitions in non-strict mode", () => {
    const controller = new StatusController({ status: AgentStatus.IDLE, strict: false });
    const entry = controller.transition("");
    expect(entry.to).toBe("");
    expect(controller.status).toBe("");
  });
});

describe("ToolRegistry", () => {
  it("validates tool registration inputs", () => {
    const registry = new ToolRegistry();
    expect(() => registry.registerTool("", () => {})).toThrow(TypeError);
    expect(() => registry.registerTool("__proto__", () => {})).toThrow(Error);
    expect(() => registry.registerTool("ok", null)).toThrow(TypeError);
  });

  it("registers tools from object, array, and map", () => {
    const registry = new ToolRegistry();
    const toolA = vi.fn();
    const toolB = vi.fn();
    const toolC = vi.fn();
    registry.registerTools({ a: toolA });
    registry.registerTools([["b", toolB]]);
    registry.registerTools(new Map([["c", toolC]]));
    expect(registry.hasTool("a")).toBe(true);
    expect(registry.getTool("b")).toBe(toolB);
    expect(registry.getToolNames()).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("installs the pre-tool hook on construction", () => {
    const registry = new ToolRegistry();
    expect(createPreToolUseHook).toHaveBeenCalledTimes(1);
    expect(registry).toBeTruthy();
  });

  it("runs before/after hooks and executes tool", async () => {
    const registry = new ToolRegistry({
      tools: {
        sum: ({ a, b }) => a + b,
      },
    });
    const before = vi.fn(({ params }) => ({ params: { a: params.a + 1, b: params.b + 1 } }));
    const after = vi.fn(({ result }) => ({ ok: true, data: result.data * 2 }));
    registry.useHook("before", before);
    registry.useHook("after", after);

    const result = await registry.callTool("sum", { a: 1, b: 2 }, {});
    expect(result.ok).toBe(true);
    expect(result.data).toBe(10);
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("uses executor when provided and handles unknown tools", async () => {
    const registry = new ToolRegistry();
    const executor = vi.fn(async (name, params) => ({ ok: true, data: { name, params } }));
    const result = await registry.callTool("any", { foo: "bar" }, { toolExecutor: executor });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ name: "any", params: { foo: "bar" } });

    const missing = await registry.callTool("missing", {}, {});
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("Unknown tool");
  });

  it("returns validation errors for non-object params and schema failures", async () => {
    const registry = new ToolRegistry({ tools: { t: () => "ok" } });
    registry.registerTool("t", () => "ok", { type: "object" });
    const emit = vi.fn();

    const arrayResult = await registry.callTool("t", [], { emit });
    expect(arrayResult.ok).toBe(false);
    expect(arrayResult.validationErrors).toEqual(["params: expected object"]);
    expect(emit).toHaveBeenCalledWith(
      "tool:call:error",
      expect.objectContaining({
        tool: "t",
        errors: ["params: expected object"],
        reason: "validation_failed",
      })
    );

    validateArgs.mockReturnValueOnce({ valid: false, errors: ["bad"] });
    const invalidResult = await registry.callTool("t", { x: 1 }, { emit });
    expect(invalidResult.ok).toBe(false);
    expect(invalidResult.validationErrors).toEqual(["bad"]);
  });

  it("enforces quota policies in block and warn modes", async () => {
    const registry = new ToolRegistry({ tools: { t: () => "ok" } });
    const emit = vi.fn();
    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "quota" })),
      getToolStats: vi.fn(() => ({ limit: 1 })),
      recordCall: vi.fn(),
    };
    const after = vi.fn();
    registry.useHook("after", after);

    const blocked = await registry.callTool("t", { x: 1 }, {
      toolQuotaManager: quotaManager,
      toolQuotaConfig: { mode: "block" },
      emit,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("quota");
    expect(emit).toHaveBeenCalledWith(
      "tool:quota:exceeded",
      expect.objectContaining({ tool: "t", reason: "quota" })
    );
    expect(after).toHaveBeenCalled();

    const warnRegistry = new ToolRegistry({ tools: { t: () => "ok" } });
    const warnQuotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "quota" })),
      recordCall: vi.fn(),
    };
    const warned = await warnRegistry.callTool("t", { x: 1 }, {
      toolQuotaManager: warnQuotaManager,
      toolQuotaConfig: { mode: "warn" },
    });
    expect(warned.ok).toBe(true);
    expect(warnQuotaManager.recordCall).toHaveBeenCalledWith("t");
  });

  it("handles tool errors and concurrent calls", async () => {
    const registry = new ToolRegistry({
      tools: {
        boom: () => {
          throw new Error("fail");
        },
        echo: async ({ value }) => {
          await Promise.resolve();
          return value;
        },
      },
    });

    const failed = await registry.callTool("boom", {}, {});
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe("fail");

    const [first, second] = await Promise.all([
      registry.callTool("echo", { value: 1 }, {}),
      registry.callTool("echo", { value: 2 }, {}),
    ]);
    expect(first.data).toBe(1);
    expect(second.data).toBe(2);
  });
});

describe("MessageManager", () => {
  it("adds messages, counts tokens, and tracks superseded", () => {
    const tokenCounter = { count: vi.fn((text) => String(text).length) };
    const manager = new MessageManager({ tokenCounter, asyncSummaryEnabled: false });
    manager.addMessage({ role: "user", content: "hi" });
    manager.addMessage({ role: "assistant", content: "ok", _superseded: true });

    expect(manager.messages.length).toBe(2);
    expect(manager.supersededCount).toBe(1);
    expect(manager.tokenUsage).toEqual({ input: 4, output: 0, total: 4 });
  });

  it("handles nullish and empty content with empty batches", () => {
    const tokenCounter = { count: vi.fn((text) => String(text).length) };
    const manager = new MessageManager({ tokenCounter, asyncSummaryEnabled: false });
    manager.addMessage({ role: "user", content: null });
    manager.addMessage({ role: "user", content: undefined });
    manager.addMessage({ role: "user", content: "" });
    manager.addMessages([]);

    expect(manager.messages.length).toBe(3);
    expect(manager.tokenUsage.total).toBe(0);
    expect(tokenCounter.count).toHaveBeenCalledTimes(1);
  });

  it("marks superseded ranges with boundary handling", () => {
    const logger = { warn: vi.fn() };
    const manager = new MessageManager({ logger, asyncSummaryEnabled: false });
    manager.addMessages([{ content: "a" }, { content: "b" }, { content: "c" }]);

    const emptyCorrection = manager.markAsSuperseded(0, 1, "   ");
    expect(emptyCorrection).toBe(0);
    expect(logger.warn).toHaveBeenCalled();

    const stringIndex = manager.markAsSuperseded("1", "2", "fix");
    expect(stringIndex).toBe(0);

    const marked = manager.markAsSuperseded(-1, Number.MAX_SAFE_INTEGER, "fix");
    expect(marked).toBe(3);
    expect(manager.supersededCount).toBe(3);
  });

  it("filters active messages by superseded flag", () => {
    const manager = new MessageManager({ asyncSummaryEnabled: false });
    manager.addMessages([{ content: "a" }, { content: "b" }, { content: "c" }]);
    manager.markAsSuperseded(1, 1, "fix");

    const active = manager.getActiveMessages();
    expect(active.map((msg) => msg.content)).toEqual(["a", "c"]);
    const all = manager.getActiveMessages({ includeSuperseded: true });
    expect(all.length).toBe(3);
  });

  it("resets state and clears token usage", async () => {
    const manager = new MessageManager({ asyncSummaryEnabled: false });
    manager.addMessages([{ content: "a" }, { content: "b" }]);
    await manager.reset();

    expect(manager.messages.length).toBe(0);
    expect(manager.supersededCount).toBe(0);
    expect(manager.tokenUsage.total).toBe(0);
  });

  it("wraps large output and cleans old persisted outputs", () => {
    const manager = new MessageManager({ asyncSummaryEnabled: false });
    const large = "a".repeat(persistedOutput.OUTPUT_THRESHOLD + 10);
    const wrapped = manager.wrapToolOutput(large);
    expect(wrapped).toContain(persistedOutput.PERSISTED_OUTPUT_START);

    manager.addMessages([
      { role: "assistant", content: wrapped },
      { role: "assistant", content: wrapped },
      { role: "assistant", content: wrapped },
    ]);
    manager.cleanOldOutputs(1);
    expect(manager.messages[0].content).toBe("[Old large output cleared to save context space]");
    expect(manager.messages[2].content).toContain(persistedOutput.PERSISTED_OUTPUT_START);
  });

  it("handles deep nested content and rapid successive calls", () => {
    const tokenCounter = { count: vi.fn((text) => String(text).length) };
    const manager = new MessageManager({ tokenCounter, asyncSummaryEnabled: false });

    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 30; i += 1) {
      cursor.next = { index: i };
      cursor = cursor.next;
    }

    manager.addMessage({ role: "user", content: deep });
    for (let i = 0; i < 5; i += 1) {
      manager.addMessage({ role: "user", content: "x" });
    }

    expect(manager.messages.length).toBe(6);
    expect(manager.tokenUsage.total).toBeGreaterThan(0);
  });
});
