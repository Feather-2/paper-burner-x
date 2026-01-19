import { describe, expect, it, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => {
  const makeTool = (name, { description = `${name} desc`, priority, handlerImpl } = {}) => {
    const handler = handlerImpl || vi.fn(async () => ({ success: true }));
    const definition = { name, description, ...(priority !== undefined ? { priority } : {}) };
    return { handler, definition };
  };

  const listDocs = makeTool("list-docs", { priority: "critical" });
  const manageTodos = makeTool("manage-todos", { handlerImpl: vi.fn(async () => ({ success: false, error: "bad" })) });
  const searchDocs = makeTool("search-docs", {
    handlerImpl: vi.fn(async () => {
      const err = new Error("boom");
      err.code = "E_BOOM";
      throw err;
    }),
  });
  const writeReport = makeTool("write-report", { priority: "optional" });

  // Remaining tools: minimal stubs.
  const readDoc = makeTool("read-doc");
  const watchdog = makeTool("watchdog");
  const evaluateGaps = makeTool("evaluate-gaps");
  const crossVerify = makeTool("cross-verify");
  const refinePlanning = makeTool("refine-planning");
  const task = makeTool("task");
  const askUser = makeTool("ask-user");
  const getTaskResult = makeTool("get-task-result");
  const adviseTask = makeTool("advise-task");
  const skill = makeTool("skill");
  const recordFinding = makeTool("record-finding");
  const getArtifact = makeTool("get-artifact");

  return {
    makeTool,
    listDocs,
    readDoc,
    manageTodos,
    searchDocs,
    writeReport,
    watchdog,
    evaluateGaps,
    crossVerify,
    refinePlanning,
    task,
    askUser,
    getTaskResult,
    adviseTask,
    skill,
    recordFinding,
    getArtifact,
  };
});

function mockToolModule(tool) {
  return {
    definition: tool.definition,
    handler: tool.handler,
    default: tool,
  };
}

vi.mock("../../../../js/agents/stages/deepsearch/tools/list-docs/handler.js", () => mockToolModule(hoisted.listDocs));
vi.mock("../../../../js/agents/stages/deepsearch/tools/read-doc/handler.js", () => mockToolModule(hoisted.readDoc));
vi.mock("../../../../js/agents/stages/deepsearch/tools/manage-todos/handler.js", () => mockToolModule(hoisted.manageTodos));
vi.mock("../../../../js/agents/stages/deepsearch/tools/search-docs/handler.js", () => mockToolModule(hoisted.searchDocs));
vi.mock("../../../../js/agents/stages/deepsearch/tools/write-report/handler.js", () => mockToolModule(hoisted.writeReport));
vi.mock("../../../../js/agents/stages/deepsearch/tools/watchdog/handler.js", () => mockToolModule(hoisted.watchdog));
vi.mock("../../../../js/agents/stages/deepsearch/tools/evaluate-gaps/handler.js", () => mockToolModule(hoisted.evaluateGaps));
vi.mock("../../../../js/agents/stages/deepsearch/tools/cross-verify/handler.js", () => mockToolModule(hoisted.crossVerify));
vi.mock("../../../../js/agents/stages/deepsearch/tools/refine-planning/handler.js", () => mockToolModule(hoisted.refinePlanning));
vi.mock("../../../../js/agents/stages/deepsearch/tools/task/handler.js", () => mockToolModule(hoisted.task));
vi.mock("../../../../js/agents/stages/deepsearch/tools/ask-user/handler.js", () => mockToolModule(hoisted.askUser));
vi.mock("../../../../js/agents/stages/deepsearch/tools/get-task-result/handler.js", () => mockToolModule(hoisted.getTaskResult));
vi.mock("../../../../js/agents/stages/deepsearch/tools/advise-task/handler.js", () => mockToolModule(hoisted.adviseTask));
vi.mock("../../../../js/agents/stages/deepsearch/tools/skill/handler.js", () => mockToolModule(hoisted.skill));
vi.mock("../../../../js/agents/stages/deepsearch/tools/record-finding/handler.js", () => mockToolModule(hoisted.recordFinding));
vi.mock("../../../../js/agents/stages/deepsearch/tools/get-artifact/handler.js", () => mockToolModule(hoisted.getArtifact));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deepsearch/tools index", () => {
  it("exports tool definitions and renders catalog grouped by priority", async () => {
    const { tools, getToolDefinitions, getToolCatalogPrompt } = await import(
      "../../../../js/agents/stages/deepsearch/tools/index.js"
    );

    expect(Object.keys(tools).length).toBeGreaterThan(5);
    const defs = getToolDefinitions();
    expect(defs.some((d) => d?.name === "list-docs")).toBe(true);

    const prompt = getToolCatalogPrompt({ showPriority: true });
    expect(prompt).toContain("## 可用工具");
    expect(prompt).toContain("核心工具");
    expect(prompt).toContain("辅助工具");
  });

  it("getToolCatalogPrompt({showPriority:false}) omits priority group headings", async () => {
    const { getToolCatalogPrompt } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");
    const prompt = getToolCatalogPrompt({ showPriority: false });
    expect(prompt).toContain("## 可用工具");
    expect(prompt).not.toContain("### 🔴");
  });

  it("executeTool(): returns unknown-tool error", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");
    const out = await executeTool("missing-tool", {}, {});
    expect(out.success).toBe(false);
    expect(out.error).toContain("Unknown tool");
  });

  it("executeTool(): runs tool without traceContext/quota manager", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");
    const out = await executeTool("list-docs", {}, {});
    expect(out.success).toBe(true);
    expect(hoisted.listDocs.handler).toHaveBeenCalledTimes(1);
  });

  it("executeTool(): sets span status when tool returns success:false", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");
    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };

    const out = await executeTool("manage-todos", { action: "list" }, { traceContext });
    expect(out.success).toBe(false);
    expect(span.setStatus).toHaveBeenCalledWith("error", "bad");
    expect(hoisted.manageTodos.handler).toHaveBeenCalledTimes(1);
  });

  it("executeTool(): resolves quota manager via container and respects disabled quotas", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "should-not-run" })),
    };
    const container = {
      tryGet: vi.fn((key) => (key === "toolQuotaManager" ? quotaManager : null)),
    };

    const out = await executeTool("list-docs", {}, { container, toolQuotaConfig: { enabled: false } });
    expect(out.success).toBe(true);
    expect(container.tryGet).toHaveBeenCalledWith("toolQuotaManager");
    expect(quotaManager.tryCall).not.toHaveBeenCalled();
  });

  it("executeTool(): resolves quota manager from context.stageApi and honors mode=off/disabled", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const quotaManager = { tryCall: vi.fn(() => ({ allowed: false, reason: "should-not-run" })) };
    const stageApi = { toolQuotaManager: quotaManager };

    const out = await executeTool("list-docs", {}, { stageApi, toolQuotaConfig: { mode: "disabled" } });
    expect(out.success).toBe(true);
    expect(quotaManager.tryCall).not.toHaveBeenCalled();
  });

  it("executeTool(): supports quota enforce=true (block mode) and swallows recordCall errors in warn mode", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "nope" })),
      recordCall: vi.fn(() => {
        throw new Error("ignore");
      }),
    };

    const blocked = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { enforce: true } });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain("nope");

    // warnOnly => should run tool even if disallowed, and recordCall errors must not escape.
    const warned = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { warnOnly: true } });
    expect(warned.success).toBe(true);
  });

  it("createDeepSearchToolExecutor(): constructs a ToolExecutor instance", async () => {
    const { createDeepSearchToolExecutor, ToolExecutor } = await import(
      "../../../../js/agents/stages/deepsearch/tools/index.js"
    );
    const exec = createDeepSearchToolExecutor();
    expect(exec).toBeInstanceOf(ToolExecutor);
    expect(typeof exec.execute).toBe("function");
  });

  it("executeTool(): wraps handler with traceContext span, sets error status on success:false, and handles quota blocking", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = {
      withSpan: vi.fn(async (_name, fn) => await fn(span)),
    };

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "too many" })),
      getToolStats: vi.fn(() => ({ used: 2, limit: 1 })),
      recordCall: vi.fn(),
    };

    const emit = vi.fn();
    const out = await executeTool(
      "manage-todos",
      { action: "list" },
      { emit, traceContext, toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "block" }, state: { runId: "r1" } }
    );

    expect(out.success).toBe(false);
    expect(out.error).toContain("too many");
    expect(emit).toHaveBeenCalledWith("tool.quota.exceeded", expect.any(Object));
    expect(traceContext.withSpan).toHaveBeenCalledTimes(1);
    expect(span.setStatus).toHaveBeenCalled();
    expect(hoisted.manageTodos.handler).not.toHaveBeenCalled();
  });

  it("executeTool(): warn-mode quota continues execution and surfaces thrown tool errors", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "warn only" })),
      getToolStats: vi.fn(() => ({ used: 2, limit: 1 })),
      recordCall: vi.fn(),
    };

    const out = await executeTool("search-docs", { query: "x" }, { traceContext, toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "warn" } });

    expect(out.success).toBe(false);
    expect(out.error).toBe("boom");
    expect(out.errorCode).toBe("E_BOOM");
    expect(out.errorName).toBe("Error");
    expect(quotaManager.recordCall).toHaveBeenCalledTimes(1);
    expect(span.recordException).toHaveBeenCalledTimes(1);
  });
});
