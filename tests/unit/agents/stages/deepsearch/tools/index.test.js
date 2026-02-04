import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const toolMocks = vi.hoisted(() => {
  const makeTool = (name, { description, priority, parameters, handlerImpl } = {}) => {
    const definition = {
      name,
      ...(description !== undefined ? { description } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(parameters !== undefined ? { parameters } : {}),
    };
    const handler = handlerImpl || vi.fn(async () => ({ success: true }));
    return { definition, handler };
  };

  return {
    listDocs: makeTool("list-docs", {
      description: "List docs",
      priority: 0,
      parameters: { path: {}, limit: {} },
    }),
    readDoc: makeTool("read-doc"),
    manageTodos: makeTool("manage-todos", {
      description: "Manage todos",
      handlerImpl: vi.fn(async () => ({ success: false, error: "bad" })),
    }),
    searchDocs: makeTool("search-docs", {
      description: "Search docs",
      handlerImpl: vi.fn(async () => {
        const err = new Error("boom");
        err.code = "E_BOOM";
        throw err;
      }),
    }),
    writeReport: makeTool("write-report", {
      description: "Write report",
      priority: 2,
      parameters: { title: {} },
    }),
    watchdog: makeTool("watchdog", { description: "Watchdog" }),
    evaluateGaps: makeTool("evaluate-gaps", { description: "Evaluate gaps" }),
    crossVerify: makeTool("cross-verify", { description: "Cross verify" }),
    refinePlanning: makeTool("refine-planning", { description: "Refine planning" }),
    task: makeTool("task", { description: "Task tool" }),
    askUser: makeTool("ask-user", { description: "Ask user" }),
    getTaskResult: makeTool("get-task-result", { description: "Get task result" }),
    adviseTask: makeTool("advise-task", { description: "Advise task" }),
    skill: makeTool("skill", { description: "Skill tool" }),
    recordFinding: makeTool("record-finding", { description: "Record finding" }),
    getArtifact: makeTool("get-artifact", { description: "Get artifact" }),
  };
});

const runtimeMocks = vi.hoisted(() => {
  const createToolExecutor = vi.fn();

  class ToolExecutor {
    constructor(options = {}) {
      this.options = options;
    }
    execute() {}
  }

  return { createToolExecutor, ToolExecutor };
});

const mockToolModule = (tool) => ({ default: tool });

vi.mock("../../../../../../js/agents/stages/deepsearch/tools/list-docs/handler.js", () => mockToolModule(toolMocks.listDocs));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/read-doc/handler.js", () => mockToolModule(toolMocks.readDoc));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/manage-todos/handler.js", () =>
  mockToolModule(toolMocks.manageTodos)
);
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/search-docs/handler.js", () => mockToolModule(toolMocks.searchDocs));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/write-report/handler.js", () => mockToolModule(toolMocks.writeReport));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/watchdog/handler.js", () => mockToolModule(toolMocks.watchdog));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/evaluate-gaps/handler.js", () =>
  mockToolModule(toolMocks.evaluateGaps)
);
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/cross-verify/handler.js", () => mockToolModule(toolMocks.crossVerify));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/refine-planning/handler.js", () =>
  mockToolModule(toolMocks.refinePlanning)
);
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/task/handler.js", () => mockToolModule(toolMocks.task));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/ask-user/handler.js", () => mockToolModule(toolMocks.askUser));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/get-task-result/handler.js", () =>
  mockToolModule(toolMocks.getTaskResult)
);
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/advise-task/handler.js", () => mockToolModule(toolMocks.adviseTask));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/skill/handler.js", () => mockToolModule(toolMocks.skill));
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/record-finding/handler.js", () =>
  mockToolModule(toolMocks.recordFinding)
);
vi.mock("../../../../../../js/agents/stages/deepsearch/tools/get-artifact/handler.js", () => mockToolModule(toolMocks.getArtifact));

vi.mock("../../../../../../js/agents/runtime/index.js", () => runtimeMocks);

let toolIndex = null;

beforeAll(async () => {
  toolIndex = await import("../../../../../../js/agents/stages/deepsearch/tools/index.js");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deepsearch/tools/index public API", () => {
  it("should_export_expected_tool_keys_when_imported", () => {
    // Arrange
    const expected = [
      "Task",
      "advise-task",
      "ask-user",
      "cross-verify",
      "evaluate-gaps",
      "get-artifact",
      "get-task-result",
      "list-docs",
      "manage-todos",
      "read-doc",
      "record-finding",
      "refine-planning",
      "search-docs",
      "skill",
      "task",
      "watchdog",
      "write-report",
    ];

    // Act
    const keys = Object.keys(toolIndex.tools).sort();

    // Assert
    expect(keys).toEqual(expected.sort());
  });

  it("should_export_task_alias_when_Task_and_task_are_accessed", () => {
    // Arrange
    const { tools } = toolIndex;

    // Act
    const aliased = tools.Task;

    // Assert
    expect(aliased).toBe(tools.task);
  });

  it("should_export_default_tools_when_default_export_is_used", () => {
    // Arrange
    const { tools } = toolIndex;

    // Act
    const defaultExport = toolIndex.default;

    // Assert
    expect(defaultExport).toBe(tools);
  });

  it("should_reexport_createToolExecutor_when_runtime_provides_it", () => {
    // Arrange
    const expected = runtimeMocks.createToolExecutor;

    // Act
    const actual = toolIndex.createToolExecutor;

    // Assert
    expect(actual).toBe(expected);
  });

  it("should_reexport_ToolExecutor_when_runtime_provides_it", () => {
    // Arrange
    const expected = runtimeMocks.ToolExecutor;

    // Act
    const actual = toolIndex.ToolExecutor;

    // Assert
    expect(actual).toBe(expected);
  });

  it("should_return_ToolExecutor_instance_when_createDeepSearchToolExecutor_called", () => {
    // Arrange
    const { createDeepSearchToolExecutor, ToolExecutor } = toolIndex;

    // Act
    const exec = createDeepSearchToolExecutor();

    // Assert
    expect(exec).toBeInstanceOf(ToolExecutor);
  });

  it("should_pass_tools_into_executor_options_when_createDeepSearchToolExecutor_called", () => {
    // Arrange
    const { createDeepSearchToolExecutor, tools } = toolIndex;

    // Act
    const exec = createDeepSearchToolExecutor({ any: "value" });

    // Assert
    expect(exec.options.tools).toBe(tools);
  });

  it("should_allow_options_tools_to_override_default_tools_when_createDeepSearchToolExecutor_called", () => {
    // Arrange
    const customTools = { custom: true };

    // Act
    const exec = toolIndex.createDeepSearchToolExecutor({ tools: customTools });

    // Assert
    expect(exec.options.tools).toBe(customTools);
  });

  it("should_return_all_tool_definitions_when_getToolDefinitions_called", () => {
    // Arrange
    const expected = [
      toolMocks.listDocs.definition,
      toolMocks.readDoc.definition,
      toolMocks.manageTodos.definition,
      toolMocks.searchDocs.definition,
      toolMocks.writeReport.definition,
      toolMocks.watchdog.definition,
      toolMocks.evaluateGaps.definition,
      toolMocks.crossVerify.definition,
      toolMocks.refinePlanning.definition,
      toolMocks.task.definition,
      toolMocks.task.definition,
      toolMocks.askUser.definition,
      toolMocks.getTaskResult.definition,
      toolMocks.adviseTask.definition,
      toolMocks.skill.definition,
      toolMocks.recordFinding.definition,
      toolMocks.getArtifact.definition,
    ];

    // Act
    const defs = toolIndex.getToolDefinitions();

    // Assert
    expect(defs).toEqual(expected);
  });

  it("should_export_ToolPriority_constants_when_imported", () => {
    // Arrange
    const expected = { CRITICAL: "critical", IMPORTANT: "important", OPTIONAL: "optional" };

    // Act
    const actual = toolIndex.ToolPriority;

    // Assert
    expect(actual).toEqual(expected);
  });
});

describe("deepsearch/tools/index getToolCatalogPrompt()", () => {
  it("should_include_priority_headers_when_showPriority_true", () => {
    // Arrange
    const { getToolCatalogPrompt } = toolIndex;

    // Act
    const prompt = getToolCatalogPrompt({ showPriority: true });

    // Assert
    expect(prompt.includes("### 🔴 核心工具")).toBe(true);
  });

  it("should_omit_priority_headers_when_showPriority_false", () => {
    // Arrange
    const { getToolCatalogPrompt } = toolIndex;

    // Act
    const prompt = getToolCatalogPrompt({ showPriority: false });

    // Assert
    expect(prompt.includes("### 🔴 核心工具")).toBe(false);
  });

  it("should_list_critical_group_before_optional_group_when_rendering_prompt", () => {
    // Arrange
    const { getToolCatalogPrompt } = toolIndex;

    // Act
    const prompt = getToolCatalogPrompt({ showPriority: true });

    // Assert
    expect(prompt.indexOf("### 🔴 核心工具")).toBeLessThan(prompt.indexOf("### ⚪ 辅助工具"));
  });

  it("should_render_parameters_when_definition_has_parameters", () => {
    // Arrange
    const { getToolCatalogPrompt } = toolIndex;

    // Act
    const prompt = getToolCatalogPrompt({ showPriority: false });

    // Assert
    expect(prompt.includes("**list-docs** (参数: path, limit)")).toBe(true);
  });

  it("should_fallback_to_default_description_when_definition_missing_description", () => {
    // Arrange
    const { getToolCatalogPrompt } = toolIndex;

    // Act
    const prompt = getToolCatalogPrompt({ showPriority: false });

    // Assert
    expect(prompt.includes("**read-doc**\\n  无描述")).toBe(true);
  });
});

describe("deepsearch/tools/index executeTool()", () => {
  it("should_return_error_when_executeTool_called_with_unknown_tool", async () => {
    // Arrange
    const { executeTool } = toolIndex;

    // Act
    const out = await executeTool("unknown-tool", {}, {});

    // Assert
    expect(out).toEqual({ success: false, error: "Unknown tool: unknown-tool" });
  });

  it("should_return_handler_result_when_executeTool_called_without_quota_manager", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    toolMocks.listDocs.handler.mockResolvedValueOnce({ success: true, value: 123 });

    // Act
    const out = await executeTool("list-docs", { any: "arg" }, { any: "ctx" });

    // Assert
    expect(out).toEqual({ success: true, value: 123 });
  });

  it("should_pass_args_and_context_to_handler_when_executeTool_called", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const args = { a: 1 };
    const ctx = { b: 2 };

    // Act
    await executeTool("list-docs", args, ctx);

    // Assert
    expect(toolMocks.listDocs.handler).toHaveBeenCalledWith(args, ctx);
  });

  it("should_accept_null_context_when_executeTool_called", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    toolMocks.listDocs.handler.mockResolvedValueOnce({ success: true });

    // Act
    const out = await executeTool("list-docs", {}, null);

    // Assert
    expect(out).toEqual({ success: true });
  });

  it("should_pass_null_args_to_handler_when_executeTool_called_with_null_args", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const ctx = { ok: true };

    // Act
    await executeTool("list-docs", null, ctx);

    // Assert
    expect(toolMocks.listDocs.handler).toHaveBeenCalledWith(null, ctx);
  });

  it("should_use_traceContext_withSpan_when_traceContext_provided", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };

    // Act
    await executeTool("list-docs", {}, { traceContext });

    // Assert
    expect(traceContext.withSpan).toHaveBeenCalled();
  });

  it("should_set_span_attributes_with_runId_when_traceContext_is_used", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };

    // Act
    await executeTool("list-docs", { a: 1, b: 2 }, { traceContext, state: { runId: "r1" } });

    // Assert
    expect(span.setAttributes).toHaveBeenCalledWith(expect.objectContaining({ tool: "list-docs", runId: "r1" }));
  });

  it("should_set_span_status_when_handler_returns_success_false", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };

    // Act
    await executeTool("manage-todos", { action: "list" }, { traceContext });

    // Assert
    expect(span.setStatus).toHaveBeenCalledWith("error", "bad");
  });

  it("should_return_structured_error_when_handler_throws_error_with_code", async () => {
    // Arrange
    const { executeTool } = toolIndex;

    // Act
    const out = await executeTool("search-docs", { query: "x" }, {});

    // Assert
    expect(out).toEqual({ success: false, error: "boom", errorName: "Error", errorCode: "E_BOOM" });
  });

  it("should_return_structured_error_when_handler_throws_non_error_value", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    toolMocks.askUser.handler.mockImplementationOnce(() => {
      throw "oops";
    });

    // Act
    const out = await executeTool("ask-user", {}, {});

    // Assert
    expect(out).toEqual({ success: false, error: "oops", errorName: "Error" });
  });

  it("should_record_exception_on_span_when_handler_throws", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };

    // Act
    await executeTool("search-docs", { query: "x" }, { traceContext });

    // Assert
    expect(span.recordException).toHaveBeenCalled();
  });

  it("should_not_invoke_quota_manager_when_quota_disabled_by_enabled_false", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "nope" })) };

    // Act
    await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { enabled: false } });

    // Assert
    expect(quotaManager.tryCall).not.toHaveBeenCalled();
  });

  it("should_block_execution_when_quota_mode_block_and_disallowed", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "too many" })) };

    // Act
    const out = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "block" } });

    // Assert
    expect(out).toEqual({ success: false, error: "too many" });
  });

  it("should_not_invoke_handler_when_quota_mode_block_and_disallowed", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "too many" })) };

    // Act
    await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "block" } });

    // Assert
    expect(toolMocks.listDocs.handler).not.toHaveBeenCalled();
  });

  it("should_emit_quota_exceeded_event_when_quota_is_exceeded", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const emit = vi.fn();
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "too many" })) };

    // Act
    await executeTool("list-docs", {}, { emit, toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "block" } });

    // Assert
    expect(emit).toHaveBeenCalledWith(
      "tool.quota.exceeded",
      expect.objectContaining({ tool: "list-docs", reason: "too many", mode: "block" })
    );
  });

  it("should_include_quota_stats_when_quota_manager_provides_stats", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "too many" })),
      getToolStats: vi.fn(() => ({ used: 2, limit: 1 })),
    };

    // Act
    const out = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "block" } });

    // Assert
    expect(out).toEqual({ success: false, error: "too many", quota: { used: 2, limit: 1 } });
  });

  it("should_set_span_status_when_quota_exceeded_in_block_mode", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "too many" })) };

    // Act
    await executeTool("list-docs", {}, { traceContext, toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "block" } });

    // Assert
    expect(span.setStatus).toHaveBeenCalledWith("error", "too many");
  });

  it("should_continue_execution_when_quota_mode_warnOnly_and_disallowed", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "warn only" })) };

    // Act
    const out = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { warnOnly: true } });

    // Assert
    expect(out.success).toBe(true);
  });

  it("should_call_recordCall_when_quota_disallowed_in_warn_mode", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "warn only" })),
      recordCall: vi.fn(),
    };

    // Act
    await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "warn" } });

    // Assert
    expect(quotaManager.recordCall).toHaveBeenCalled();
  });

  it("should_ignore_recordCall_errors_when_quota_disallowed_in_warn_mode", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "warn only" })),
      recordCall: vi.fn(() => {
        throw new Error("ignore");
      }),
    };

    // Act
    const out = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "warn" } });

    // Assert
    expect(out.success).toBe(true);
  });

  it("should_resolve_quota_manager_from_stageApi_when_provided", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "too many" })) };
    const stageApi = { toolQuotaManager: quotaManager };

    // Act
    await executeTool("list-docs", {}, { stageApi, toolQuotaConfig: { mode: "block" } });

    // Assert
    expect(quotaManager.tryCall).toHaveBeenCalled();
  });

  it("should_resolve_quota_manager_from_container_tryGet_when_available", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "too many" })) };
    const container = { tryGet: vi.fn((key) => (key === "toolQuotaManager" ? quotaManager : null)) };

    // Act
    await executeTool("list-docs", {}, { container, toolQuotaConfig: { mode: "block" } });

    // Assert
    expect(quotaManager.tryCall).toHaveBeenCalled();
  });

  it("should_ignore_container_get_errors_when_resolving_quota_manager", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const container = {
      get: vi.fn(() => {
        throw new Error("nope");
      }),
    };

    // Act
    const out = await executeTool("list-docs", {}, { container, toolQuotaConfig: { mode: "block" } });

    // Assert
    expect(out.success).toBe(true);
  });

  it("should_read_quota_config_from_stageApi_when_toolQuotaConfig_missing", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "too many" })) };

    // Act
    const out = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, stageApi: { toolQuotas: { mode: "block" } } });

    // Assert
    expect(out.success).toBe(false);
  });

  it("should_default_to_warn_quota_mode_when_config_missing", async () => {
    // Arrange
    const { executeTool } = toolIndex;
    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "warn by default" })) };

    // Act
    const out = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager });

    // Assert
    expect(out.success).toBe(true);
  });
});
