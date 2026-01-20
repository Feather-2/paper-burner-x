import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/runtime/hooks/hook-runner.js", () => ({
  createPreToolUseHook: () => async ({ params }) => ({ params }),
}));

const INDEX_PATH = "../../../../../js/agents/runtime/tools/index.js";
const loadIndex = () => import(INDEX_PATH);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ToolExecutor", () => {
  let ToolExecutor;

  beforeEach(async () => {
    ({ ToolExecutor } = await loadIndex());
  });

  it("executes tools and normalizes null results", async () => {
    const executor = new ToolExecutor({
      tools: {
        noop: { handler: async () => null },
      },
    });

    const result = await executor.execute("noop", null, {});

    expect(result.ok).toBe(true);
    expect(result.data).toBe(null);
  });

  it("returns error for unknown tool", async () => {
    const executor = new ToolExecutor({ tools: {} });

    const result = await executor.execute("missing", {}, {});

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  it("handles concurrent execute calls", async () => {
    const pending = {};
    const started = [];
    let startedResolve;
    const startedPromise = new Promise((resolve) => {
      startedResolve = resolve;
    });
    const executor = new ToolExecutor({
      tools: {
        wait: {
          handler: async ({ id }) => new Promise((resolve) => {
            started.push(id);
            if (started.length === 2) startedResolve();
            pending[id] = resolve;
          }),
        },
      },
    });

    const first = executor.execute("wait", { id: "a" }, {});
    const second = executor.execute("wait", { id: "b" }, {});

    await startedPromise;

    expect(Object.keys(pending).length).toBe(2);
    pending.a("first");
    pending.b("second");

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.data).toBe("first");
    expect(secondResult.data).toBe("second");
  });
});

describe("createToolExecutor", () => {
  let createToolExecutor;
  let ToolExecutor;

  beforeEach(async () => {
    ({ createToolExecutor, ToolExecutor } = await loadIndex());
  });

  it("creates a ToolExecutor instance", async () => {
    const executor = createToolExecutor({
      tools: { ping: { handler: async () => "pong" } },
    });

    expect(executor).toBeInstanceOf(ToolExecutor);

    const result = await executor.execute("ping", {}, {});
    expect(result.data).toBe("pong");
  });

  it("throws when options are null", () => {
    expect(() => createToolExecutor(null)).toThrow();
  });
});

describe("createTaskTool", () => {
  let createTaskTool;
  let ContextMode;

  beforeEach(async () => {
    ({ createTaskTool, ContextMode } = await loadIndex());
  });

  it("launches a subagent and commits summary", async () => {
    const sharedContext = { commit: vi.fn(), signal: vi.fn() };
    const parentAgent = { memory: { sharedContext } };
    const run = vi.fn(async () => ({ ok: true, summary: "done", keywords: ["alpha", "beta"] }));
    const factory = vi.fn(async () => ({ run }));
    const registry = {
      getFactory: vi.fn(() => factory),
      getAvailableTypes: vi.fn(() => [{ type: "Worker" }]),
    };
    const buildHandoff = vi.fn(async () => ({ note: "handoff" }));
    const handler = createTaskTool({ registry, parentAgent, buildHandoff });

    const emit = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    const signal = new AbortController().signal;
    const state = {
      taskGoal: "goal",
      iteration: 1,
      todos: [],
      L1: { condensedMemory: { summary: "prev" } },
    };

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234567890);
    try {
      const result = await handler({
        subagent_type: "Worker",
        prompt: "do it",
        context_mode: ContextMode.HANDOFF,
        model_tier: "fast",
      }, { emit, logger, signal, state });

      expect(result.ok).toBe(true);
      expect(result.summary).toBe("done");
      expect(result.hint).toContain("task_Worker_1234567890");

      expect(buildHandoff).toHaveBeenCalledWith(state, sharedContext);
      expect(factory).toHaveBeenCalledWith(expect.objectContaining({
        prompt: "do it",
        modelTier: "fast",
        usage: "subagent_fast",
        inheritedContext: expect.objectContaining({
          sharedContext,
          handoff: { note: "handoff" },
        }),
      }));

      expect(sharedContext.commit).toHaveBeenCalledWith(
        "task_Worker_1234567890",
        expect.objectContaining({
          full: { ok: true, summary: "done", keywords: ["alpha", "beta"] },
          summary: "done",
          keywords: ["alpha", "beta"],
        })
      );
      expect(emit).toHaveBeenCalledWith("subagent:completed", { type: "Worker", resultId: "task_Worker_1234567890" });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("returns error for unknown subagent type", async () => {
    const registry = {
      getFactory: vi.fn(() => null),
      getAvailableTypes: vi.fn(() => [{ type: "Known" }]),
    };
    const handler = createTaskTool({ registry });

    const result = await handler(
      { subagent_type: "Missing", prompt: "task" },
      { emit: vi.fn(), logger: { info: vi.fn(), error: vi.fn() } }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown subagent type");
    expect(result.error).toContain("Known");
  });

  it("rejects when registry cannot be resolved", async () => {
    const handler = createTaskTool();

    await expect(handler(
      { subagent_type: "Any", prompt: "task" },
      { emit: vi.fn(), logger: { info: vi.fn(), error: vi.fn() } }
    )).rejects.toThrow("missing SubagentRegistry");
  });
});

describe("TASK_TOOL_DEFINITION", () => {
  let TASK_TOOL_DEFINITION;

  beforeEach(async () => {
    ({ TASK_TOOL_DEFINITION } = await loadIndex());
  });

  it("defines the Task tool schema", () => {
    expect(TASK_TOOL_DEFINITION.name).toBe("Task");
    expect(TASK_TOOL_DEFINITION.parameters.type).toBe("object");
    expect(TASK_TOOL_DEFINITION.parameters.required).toEqual(expect.arrayContaining(["subagent_type", "prompt"]));
    expect(TASK_TOOL_DEFINITION.parameters.properties.context_mode.enum).toEqual(
      expect.arrayContaining(["isolated", "shared", "handoff"])
    );
  });
});

describe("ContextMode", () => {
  let ContextMode;

  beforeEach(async () => {
    ({ ContextMode } = await loadIndex());
  });

  it("exposes expected mode values", () => {
    expect(ContextMode.ISOLATED).toBe("isolated");
    expect(ContextMode.SHARED).toBe("shared");
    expect(ContextMode.HANDOFF).toBe("handoff");
    expect(Object.isFrozen(ContextMode)).toBe(true);
  });
});

describe("createRecallTool", () => {
  let createRecallTool;

  beforeEach(async () => {
    ({ createRecallTool } = await loadIndex());
  });

  it("lists archives and handles empty results", async () => {
    const compressor = {
      listArchives: vi.fn(async () => []),
    };
    const handler = createRecallTool({ compressor });

    const result = await handler({}, { logger: { error: vi.fn() } });

    expect(result.ok).toBe(true);
    expect(result.data).toContain("No archived memories found");
    expect(compressor.listArchives).toHaveBeenCalledWith({ limit: 5 });
  });

  it("returns error for search without query", async () => {
    const compressor = {
      listArchives: vi.fn(async () => []),
    };
    const handler = createRecallTool({ compressor });

    const result = await handler({ action: "search", query: "" }, { logger: { error: vi.fn() } });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Query is required");
  });

  it("handles compressor failures", async () => {
    const compressor = {
      listArchives: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const logger = { error: vi.fn() };
    const handler = createRecallTool({ compressor });

    const result = await handler({ action: "list" }, { logger });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("boom");
    expect(logger.error).toHaveBeenCalled();
  });

  it("throws when compressor is missing", () => {
    expect(() => createRecallTool({ compressor: null })).toThrow("CicadaCompressor");
  });
});

describe("RECALL_TOOL_DEFINITION", () => {
  let RECALL_TOOL_DEFINITION;

  beforeEach(async () => {
    ({ RECALL_TOOL_DEFINITION } = await loadIndex());
  });

  it("defines the Recall tool schema", () => {
    expect(RECALL_TOOL_DEFINITION.name).toBe("Recall");
    expect(RECALL_TOOL_DEFINITION.parameters.required).toEqual(expect.arrayContaining(["action"]));
    expect(RECALL_TOOL_DEFINITION.parameters.properties.action.enum).toEqual(
      expect.arrayContaining(["list", "search", "get"])
    );
  });
});

describe("createBacktrackTool", () => {
  let createBacktrackTool;

  beforeEach(async () => {
    ({ createBacktrackTool } = await loadIndex());
  });

  it("returns a backtrack signal when prepared", async () => {
    const backtrackManager = {
      prepareBacktrack: vi.fn(async () => ({
        success: true,
        checkpointId: "cp1",
        state: { step: 1 },
      })),
    };
    const emit = vi.fn();
    const logger = { warn: vi.fn(), error: vi.fn() };
    const handler = createBacktrackTool({ backtrackManager });

    const result = await handler(
      { reason: "mistake", checkpoint_id: "cp0", hint: "retry" },
      { emit, logger }
    );

    expect(result.ok).toBe(true);
    expect(result.backtrack).toEqual(expect.objectContaining({
      checkpointId: "cp1",
      reason: "mistake",
      hint: "retry",
    }));
    expect(emit).toHaveBeenCalledWith("agent:backtrackRequested", expect.objectContaining({ checkpointId: "cp1" }));
  });

  it("returns error when prepareBacktrack reports failure", async () => {
    const backtrackManager = {
      prepareBacktrack: vi.fn(async () => ({
        success: false,
        reason: "no checkpoint",
      })),
    };
    const emit = vi.fn();
    const logger = { warn: vi.fn(), error: vi.fn() };
    const handler = createBacktrackTool({ backtrackManager });

    const result = await handler({ reason: "stuck" }, { emit, logger });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Backtrack failed: no checkpoint");
    expect(emit).toHaveBeenCalledWith("agent:backtrackFailed", expect.objectContaining({ reason: "no checkpoint" }));
  });

  it("throws when backtrackManager is missing", () => {
    expect(() => createBacktrackTool({ backtrackManager: null })).toThrow("BacktrackManager");
  });
});

describe("BACKTRACK_TOOL_DEFINITION", () => {
  let BACKTRACK_TOOL_DEFINITION;

  beforeEach(async () => {
    ({ BACKTRACK_TOOL_DEFINITION } = await loadIndex());
  });

  it("defines the Backtrack tool schema", () => {
    expect(BACKTRACK_TOOL_DEFINITION.name).toBe("Backtrack");
    expect(BACKTRACK_TOOL_DEFINITION.parameters.required).toEqual(expect.arrayContaining(["reason"]));
    expect(BACKTRACK_TOOL_DEFINITION.parameters.properties.checkpoint_id.type).toBe("string");
  });
});

describe("createDMailTool", () => {
  let createDMailTool;

  beforeEach(async () => {
    ({ createDMailTool } = await loadIndex());
  });

  it("builds a dmail payload with defaults", async () => {
    const now = vi.fn(() => 12345);
    const handler = createDMailTool({ now });
    const logger = { info: vi.fn() };
    const emit = vi.fn();

    const result = await handler({
      correction: "fix the bug",
      supersede_from: 1,
      supersede_to: 2,
    }, { logger, emit });

    expect(result.ok).toBe(true);
    expect(result.dmail).toEqual({
      correction: "fix the bug",
      supersedeRange: { from: 1, to: 2 },
      severity: "minor",
      timestamp: 12345,
    });
    expect(logger.info).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("agent:dmailSent", result.dmail);
  });

  it.each([
    { args: null, label: "null args" },
    { args: undefined, label: "undefined args" },
    { args: {}, label: "missing correction" },
    { args: { correction: "" }, label: "empty string" },
    { args: { correction: "   " }, label: "whitespace string" },
  ])("rejects invalid corrections ($label)", async ({ args }) => {
    const handler = createDMailTool();
    const result = await handler(args, {});

    expect(result.ok).toBe(false);
    expect(result.error).toContain("correction");
  });

  it.each([
    { args: { correction: "ok", supersede_from: -1 }, message: "supersede_from" },
    { args: { correction: "ok", supersede_to: "2" }, message: "supersede_to" },
    { args: { correction: "ok", supersede_from: 4, supersede_to: 2 }, message: "less than or equal" },
  ])("rejects invalid supersede ranges ($message)", async ({ args }) => {
    const handler = createDMailTool();
    const result = await handler(args, {});

    expect(result.ok).toBe(false);
    expect(result.error).toContain("supersede");
  });

  it("rejects invalid severity", async () => {
    const handler = createDMailTool();
    const result = await handler({ correction: "ok", severity: "urgent" }, {});

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid severity");
  });

  it("accepts extreme ranges and long corrections", async () => {
    const handler = createDMailTool();
    const longCorrection = "a".repeat(100000);

    const result = await handler({
      correction: longCorrection,
      supersede_from: 0,
      supersede_to: Number.MAX_SAFE_INTEGER,
      severity: "critical",
    }, {});

    expect(result.ok).toBe(true);
    expect(result.dmail.supersedeRange).toEqual({
      from: 0,
      to: Number.MAX_SAFE_INTEGER,
    });
    expect(result.dmail.severity).toBe("critical");
  });
});

describe("DMAIL_TOOL_DEFINITION", () => {
  let DMAIL_TOOL_DEFINITION;

  beforeEach(async () => {
    ({ DMAIL_TOOL_DEFINITION } = await loadIndex());
  });

  it("defines the DMail tool schema", () => {
    expect(DMAIL_TOOL_DEFINITION.name).toBe("DMail");
    expect(DMAIL_TOOL_DEFINITION.parameters.required).toEqual(expect.arrayContaining(["correction"]));
    expect(DMAIL_TOOL_DEFINITION.parameters.properties.severity.enum).toEqual(
      expect.arrayContaining(["minor", "major", "critical"])
    );
  });
});

describe("validateToolSchema", () => {
  let validateToolSchema;

  beforeEach(async () => {
    ({ validateToolSchema } = await loadIndex());
  });

  it.each([null, undefined, "", [], {}])("flags missing required fields for empty input", (args) => {
    const schema = {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    };

    const result = validateToolSchema(args, schema);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: id");
  });

  it("accepts boundary values 0 and MAX_SAFE_INTEGER", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "number", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
        name: { type: "string", pattern: "\\S" },
        list: { type: "array" },
      },
      required: ["count", "name", "list"],
    };

    const minResult = validateToolSchema({ count: 0, name: "ok", list: [] }, schema);
    const maxResult = validateToolSchema({ count: Number.MAX_SAFE_INTEGER, name: "ok", list: [] }, schema);

    expect(minResult.valid).toBe(true);
    expect(maxResult.valid).toBe(true);
  });

  it("reports type and pattern errors", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        count: { type: "number" },
        name: { type: "string", pattern: "\\S" },
        list: { type: "array" },
      },
      required: ["count", "name", "list"],
    };

    const result = validateToolSchema({
      count: "1",
      name: "   ",
      list: {},
      extra: "x",
    }, schema);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "count: expected number, got string",
      "name: does not match pattern \\S",
      "list: expected array, got object",
      "Unknown field: extra",
    ]));
  });

  it("handles large strings and deep nested objects", () => {
    const schema = {
      type: "object",
      properties: {
        fileContent: { type: "string", maxLength: 1024 },
        payload: { type: "object" },
      },
      required: ["fileContent", "payload"],
    };

    const deepNested = { level1: { level2: { level3: { level4: "deep" } } } };
    const longString = "x".repeat(5000);
    const result = validateToolSchema({ fileContent: longString, payload: deepNested }, schema);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("fileContent: length must be <= 1024");
    expect(result.errors.some((err) => err.includes("payload"))).toBe(false);
  });
});

describe("ToolQuotaManager", () => {
  let ToolQuotaManager;

  beforeEach(async () => {
    ({ ToolQuotaManager } = await loadIndex());
  });

  it("tracks usage and fires warning/exceeded callbacks", () => {
    const onWarning = vi.fn();
    const onExceeded = vi.fn();
    const manager = new ToolQuotaManager({
      defaultMaxCalls: 2,
      onQuotaWarning: onWarning,
      onQuotaExceeded: onExceeded,
    });

    const first = manager.tryCall("tool");
    const second = manager.tryCall("tool");
    const third = manager.tryCall("tool");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onExceeded).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1])("blocks when maxCalls is %s", (maxCalls) => {
    const manager = new ToolQuotaManager({ defaultMaxCalls: maxCalls });
    const result = manager.tryCall("tool");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("handles rapid sequential recordCall updates", () => {
    const manager = new ToolQuotaManager({ defaultMaxCalls: 10 });
    for (let i = 0; i < 5; i += 1) {
      manager.recordCall("tool");
    }

    const stats = manager.getToolStats("tool");
    expect(stats.totalCalls).toBe(5);
  });
});

describe("createPlatformTools", () => {
  let createPlatformTools;

  beforeEach(async () => {
    ({ createPlatformTools } = await loadIndex());
  });

  it("re-exports createPlatformTools from the platform module", async () => {
    const platformModule = await import("../../../../../js/agents/runtime/tools/platform/index.js");

    expect(createPlatformTools).toBe(platformModule.createPlatformTools);
  });
});

describe("getPlatformType", () => {
  let getPlatformType;

  beforeEach(async () => {
    ({ getPlatformType } = await loadIndex());
  });

  it("returns the current platform runtime", async () => {
    const { Platform } = await import("../../../../../js/agents/shared/platform.js");

    expect(getPlatformType()).toBe(Platform.runtime);
  });
});

describe("hasCapability", () => {
  let hasCapability;

  beforeEach(async () => {
    ({ hasCapability } = await loadIndex());
  });

  it("reports known capability flags", () => {
    const expectedBash = Boolean(process?.versions?.node);

    expect(hasCapability("bash")).toBe(expectedBash);
    expect(hasCapability("python")).toBe(true);
    expect(hasCapability("js_sandbox")).toBe(true);
  });

  it("returns false for unknown capabilities", () => {
    expect(hasCapability("")).toBe(false);
    expect(hasCapability("   ")).toBe(false);
    expect(hasCapability("unknown")).toBe(false);
  });
});
