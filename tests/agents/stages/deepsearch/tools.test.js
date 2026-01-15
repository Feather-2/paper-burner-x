import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const makeTool = (name, { description = `${name} desc`, handlerImpl } = {}) => {
    const handler = handlerImpl || vi.fn(async () => ({ success: true }));
    const definition = { name, description };
    return { handler, definition };
  };

  const listDocs = makeTool("list-docs");
  const readDoc = makeTool("read-doc");
  const manageTodos = makeTool("manage-todos");
  const searchDocs = makeTool("search-docs", {
    handlerImpl: vi.fn(async () => {
      // Boundary case: non-Error throws should be normalized by executeTool().
      throw undefined;
    }),
  });
  const writeReport = makeTool("write-report");
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

describe("deepsearch/tools (branch coverage)", () => {
  it("registers Task and task aliases to the same tool", async () => {
    const { tools } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    expect(tools.Task).toBeTruthy();
    expect(tools.task).toBeTruthy();
    expect(tools.Task).toBe(tools.task);
  });

  it("executeTool(): tolerates null context (no quota manager resolution)", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const out = await executeTool("list-docs", {}, null);

    expect(out.success).toBe(true);
    expect(hoisted.listDocs.handler).toHaveBeenCalledWith({}, null);
  });

  it("executeTool(): ignores invalid quota manager from container.tryGet", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const container = {
      tryGet: vi.fn(() => ({})),
    };

    const out = await executeTool("list-docs", {}, { container });

    expect(container.tryGet).toHaveBeenCalledWith("toolQuotaManager");
    expect(hoisted.listDocs.handler).toHaveBeenCalledTimes(1);
    expect(out.success).toBe(true);
  });

  it("getToolCatalogPrompt(): renders params, falls back on missing description/definition, and omits empty groups", async () => {
    const { tools, getToolCatalogPrompt } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const originalEntries = Object.entries(tools);
    try {
      // Narrow the catalog so some groups are empty (covers renderGroup early-return branch).
      for (const key of Object.keys(tools)) delete tools[key];

      tools["param-tool"] = {
        definition: { name: "param-tool", description: "", parameters: { q: { type: "string" } } },
        handler: vi.fn(async () => ({ success: true })),
      };
      tools["raw-tool"] = {
        // Tool object without a `definition` should still render without throwing.
        handler: vi.fn(async () => ({ success: true })),
      };

      const prompt = getToolCatalogPrompt({ showPriority: true });

      expect(prompt).toContain("## 可用工具");
      expect(prompt).toContain("标准工具");
      expect(prompt).not.toContain("核心工具");
      expect(prompt).not.toContain("辅助工具");
      expect(prompt).toContain("**param-tool** (参数: q)");
      expect(prompt).toContain("无描述");
    } finally {
      for (const key of Object.keys(tools)) delete tools[key];
      for (const [key, value] of originalEntries) tools[key] = value;
    }
  });

  it("executeTool(): resolves quota manager via container.get and defaults quota mode to warn", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "over quota" })),
      recordCall: vi.fn(),
    };
    const container = {
      get: vi.fn((key) => (key === "toolQuotaManager" ? quotaManager : null)),
    };

    const out = await executeTool("list-docs", {}, { container });

    expect(container.get).toHaveBeenCalledWith("toolQuotaManager");
    expect(quotaManager.tryCall).toHaveBeenCalledWith("list-docs");
    expect(quotaManager.recordCall).toHaveBeenCalledWith("list-docs");
    expect(hoisted.listDocs.handler).toHaveBeenCalledTimes(1);
    expect(out.success).toBe(true);
  });

  it("executeTool(): when quota allows, skips quota exceeded handling", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: true })),
      recordCall: vi.fn(),
    };

    const out = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager });

    expect(quotaManager.tryCall).toHaveBeenCalledWith("list-docs");
    expect(quotaManager.recordCall).not.toHaveBeenCalled();
    expect(hoisted.listDocs.handler).toHaveBeenCalledTimes(1);
    expect(out.success).toBe(true);
  });

  it("executeTool(): block-mode quota uses fallback error and span status when reason is non-string", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: null })),
    };
    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };

    const out = await executeTool("list-docs", {}, { traceContext, toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "block" } });

    expect(out.success).toBe(false);
    expect(out.error).toContain("Quota exceeded for list-docs");
    expect(out.quota).toBeUndefined();
    expect(span.setStatus).toHaveBeenCalledWith("error", "tool quota exceeded");
    expect(hoisted.listDocs.handler).not.toHaveBeenCalled();
  });

  it("executeTool(): warn-mode quota continues execution when recordCall is missing", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "nope" })),
      // Intentionally no recordCall()
    };

    const out = await executeTool("list-docs", {}, { toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "warn" } });

    expect(out.success).toBe(true);
    expect(hoisted.listDocs.handler).toHaveBeenCalledTimes(1);
  });

  it("executeTool(): ignores container.get failures and continues without quotas", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const container = {
      get: vi.fn(() => {
        throw new Error("missing toolQuotaManager");
      }),
    };

    const out = await executeTool("list-docs", {}, { container });

    expect(container.get).toHaveBeenCalledWith("toolQuotaManager");
    expect(hoisted.listDocs.handler).toHaveBeenCalledTimes(1);
    expect(out.success).toBe(true);
  });

  it("executeTool(): sets span status fallback when tool returns success:false without a string error", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    hoisted.manageTodos.handler.mockResolvedValueOnce({ success: false, error: { message: "nope" } });

    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };

    const out = await executeTool("manage-todos", { action: "list" }, { traceContext });

    expect(out.success).toBe(false);
    expect(span.setStatus).toHaveBeenCalledWith("error", "tool returned success:false");
  });

  it("executeTool(): normalizes non-Error throws", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const out = await executeTool("search-docs", { query: "x" }, {});

    expect(out.success).toBe(false);
    expect(out.error).toBe("Unknown error");
    expect(out.errorName).toBe("Error");
    expect(out.errorCode).toBeUndefined();
  });

  it("executeTool(): includes numeric errorCode when err.code is a number", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    hoisted.searchDocs.handler.mockImplementationOnce(async () => {
      const err = new Error("boom-num");
      err.code = 42;
      throw err;
    });

    const out = await executeTool("search-docs", { query: "x" }, {});

    expect(out.success).toBe(false);
    expect(out.error).toBe("boom-num");
    expect(out.errorCode).toBe(42);
    expect(typeof out.stack).toBe("string");
  });

  it("executeTool(): prefers runId from stageApi.runContext and sets argKeys=0 for non-object args", async () => {
    const { executeTool } = await import("../../../../js/agents/stages/deepsearch/tools/index.js");

    const span = { setAttributes: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() };
    const traceContext = { withSpan: vi.fn(async (_name, fn) => await fn(span)) };

    await executeTool("list-docs", null, { traceContext, stageApi: { runContext: { runId: "run_ctx" } } });

    expect(span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "list-docs",
        runId: "run_ctx",
        argKeys: 0,
      })
    );
  });
});
