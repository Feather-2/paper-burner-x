import { describe, it, expect, vi, beforeEach } from "vitest";

const FIXTURES = vi.hoisted(() => {
  const longDescription = "x".repeat(12000);
  const longParamName = `param_${"y".repeat(1024)}`;
  const deepParameters = { level1: { level2: { level3: { value: 1 } } } };
  const buildParameters = () => {
    const params = { deep: deepParameters };
    params[longParamName] = true;
    return params;
  };

  const meta = {
    listDocs: { name: "list-docs", priority: "critical", parameters: { limit: "number" } },
    readDoc: { name: "read-doc", priority: 0, parameters: { id: "string" } },
    manageTodos: { name: "manage-todos", priority: "optional", parameters: { action: "string" } },
    searchDocs: { name: "search-docs", priority: 2, parameters: { query: "string" } },
    writeReport: { name: "write-report", parameters: { format: "string" } },
    watchdog: {
      name: "watchdog",
      description: longDescription,
      parameters: buildParameters(),
    },
    evaluateGaps: { name: "evaluate-gaps", priority: -1 },
    crossVerify: { name: "cross-verify" },
    refinePlanning: { name: "refine-planning" },
    task: { name: "task" },
    askUser: { name: "ask-user" },
    getTaskResult: { name: "get-task-result" },
    adviseTask: { name: "advise-task", priority: Number.MAX_SAFE_INTEGER },
    skill: { name: "skill" },
    recordFinding: { name: "record-finding", description: "" },
    getArtifact: { name: "get-artifact" },
  };

  const buildDefinition = (item) => {
    const definition = {
      name: item.name,
      description: item.description ?? `${item.name} description`,
    };
    if (Object.prototype.hasOwnProperty.call(item, "priority")) {
      definition.priority = item.priority;
    }
    if (Object.prototype.hasOwnProperty.call(item, "parameters")) {
      definition.parameters = item.parameters;
    }
    return definition;
  };

  const createMockModule = (metaKey) => () => ({
    default: {
      definition: buildDefinition(meta[metaKey]),
      handler: vi.fn(),
    },
  });

  const runtime = {
    ToolExecutor: class {
      constructor(options) {
        this.options = options;
      }
    },
    createToolExecutor: vi.fn(),
  };

  return {
    longDescription,
    longParamName,
    deepParameters,
    meta,
    createMockModule,
    runtime,
  };
});

vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/list-docs/handler.js",
  FIXTURES.createMockModule("listDocs")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/read-doc/handler.js",
  FIXTURES.createMockModule("readDoc")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/manage-todos/handler.js",
  FIXTURES.createMockModule("manageTodos")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/search-docs/handler.js",
  FIXTURES.createMockModule("searchDocs")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/write-report/handler.js",
  FIXTURES.createMockModule("writeReport")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/watchdog/handler.js",
  FIXTURES.createMockModule("watchdog")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/evaluate-gaps/handler.js",
  FIXTURES.createMockModule("evaluateGaps")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/cross-verify/handler.js",
  FIXTURES.createMockModule("crossVerify")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/refine-planning/handler.js",
  FIXTURES.createMockModule("refinePlanning")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/task/handler.js",
  FIXTURES.createMockModule("task")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/ask-user/handler.js",
  FIXTURES.createMockModule("askUser")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/get-task-result/handler.js",
  FIXTURES.createMockModule("getTaskResult")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/advise-task/handler.js",
  FIXTURES.createMockModule("adviseTask")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/skill/handler.js",
  FIXTURES.createMockModule("skill")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/record-finding/handler.js",
  FIXTURES.createMockModule("recordFinding")
);
vi.mock(
  "../../../../../../js/agents/stages/deepsearch/tools/get-artifact/handler.js",
  FIXTURES.createMockModule("getArtifact")
);
vi.mock("../../../../../../js/agents/runtime/index.js", () => ({
  ToolExecutor: FIXTURES.runtime.ToolExecutor,
  createToolExecutor: FIXTURES.runtime.createToolExecutor,
}));

const MODULE_PATH =
  "../../../../../../js/agents/stages/deepsearch/tools/index.js";
const loadModule = async () => import(MODULE_PATH);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("tools", () => {
  it("exposes the full tool registry", async () => {
    const { tools } = await loadModule();

    const keys = Object.keys(tools);
    expect(Array.isArray(tools)).toBe(false);
    expect(keys).toHaveLength(17);
    expect(keys).toEqual(
      expect.arrayContaining([
        "list-docs",
        "read-doc",
        "manage-todos",
        "search-docs",
        "write-report",
        "watchdog",
        "evaluate-gaps",
        "cross-verify",
        "refine-planning",
        "Task",
        "task",
        "ask-user",
        "get-task-result",
        "advise-task",
        "skill",
        "record-finding",
        "get-artifact",
      ])
    );
  });

  it("maps Task and task to the same handler", async () => {
    const { tools } = await loadModule();

    expect(tools.Task).toBe(tools.task);
  });
});

describe("getToolDefinitions", () => {
  it("returns definitions for all tools", async () => {
    const { tools, getToolDefinitions } = await loadModule();

    const definitions = getToolDefinitions();

    expect(definitions).toHaveLength(Object.keys(tools).length);
    expect(definitions).toContain(tools["list-docs"].definition);
    expect(definitions.filter((def) => def?.name === "task")).toHaveLength(2);
  });

  it("supports concurrent calls", async () => {
    const { getToolDefinitions } = await loadModule();

    const expected = getToolDefinitions();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve().then(() => getToolDefinitions())
      )
    );

    results.forEach((result) => {
      expect(result).toEqual(expected);
    });
  });
});

describe("ToolPriority", () => {
  it("exposes the expected labels", async () => {
    const { ToolPriority } = await loadModule();

    expect(ToolPriority).toEqual({
      CRITICAL: "critical",
      IMPORTANT: "important",
      OPTIONAL: "optional",
    });
    expect(new Set(Object.values(ToolPriority)).size).toBe(3);
  });
});

describe("getToolCatalogPrompt", () => {
  it("renders grouped catalog output", async () => {
    const { getToolCatalogPrompt } = await loadModule();

    const output = getToolCatalogPrompt();

    expect(output.startsWith("## 可用工具")).toBe(true);

    const criticalIndex = output.indexOf("### 🔴 核心工具");
    const importantIndex = output.indexOf("### 🟡 标准工具");
    const optionalIndex = output.indexOf("### ⚪ 辅助工具");

    expect(criticalIndex).toBeGreaterThan(-1);
    expect(importantIndex).toBeGreaterThan(criticalIndex);
    expect(optionalIndex).toBeGreaterThan(importantIndex);

    const listDocsIndex = output.indexOf("**list-docs**");
    const readDocIndex = output.indexOf("**read-doc**");
    const manageTodosIndex = output.indexOf("**manage-todos**");
    const searchDocsIndex = output.indexOf("**search-docs**");
    const evaluateGapsIndex = output.indexOf("**evaluate-gaps**");
    const adviseTaskIndex = output.indexOf("**advise-task**");

    expect(listDocsIndex).toBeGreaterThan(criticalIndex);
    expect(listDocsIndex).toBeLessThan(importantIndex);
    expect(readDocIndex).toBeGreaterThan(criticalIndex);
    expect(readDocIndex).toBeLessThan(importantIndex);
    expect(manageTodosIndex).toBeGreaterThan(optionalIndex);
    expect(searchDocsIndex).toBeGreaterThan(optionalIndex);
    expect(evaluateGapsIndex).toBeGreaterThan(importantIndex);
    expect(evaluateGapsIndex).toBeLessThan(optionalIndex);
    expect(adviseTaskIndex).toBeGreaterThan(importantIndex);
    expect(adviseTaskIndex).toBeLessThan(optionalIndex);
    expect(output).toContain("**list-docs** (参数: limit)");
  });

  it("uses fallback description for empty strings", async () => {
    const { getToolCatalogPrompt } = await loadModule();

    const output = getToolCatalogPrompt();

    expect(output).toContain("**record-finding**");
    expect(output).toContain("  无描述");
  });

  it.each([
    ["false", false],
    ["empty string", ""],
  ])("omits priority headers when showPriority is %s", async (_label, value) => {
    const { getToolCatalogPrompt } = await loadModule();

    const output = getToolCatalogPrompt({ showPriority: value });

    expect(output).not.toContain("### 🔴 核心工具");
    expect(output).not.toContain("### 🟡 标准工具");
    expect(output).not.toContain("### ⚪ 辅助工具");
    expect(output).toContain("**list-docs**");
  });

  it.each([
    ["undefined", undefined],
    ["empty object", {}],
    ["empty array", []],
    ["empty string", ""],
    ["whitespace string", "   "],
    ["0", 0],
    ["-1", -1],
    ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["string number", "123"],
    ["array-like object", { 0: "first", length: 1 }],
    ["string showPriority", { showPriority: "0" }],
  ])("handles boundary options for %s", async (_label, options) => {
    const { getToolCatalogPrompt } = await loadModule();

    const output = getToolCatalogPrompt(options);

    expect(output).toContain("## 可用工具");
    expect(output).toBeTypeOf("string");
  });

  it("throws when options is null", async () => {
    const { getToolCatalogPrompt } = await loadModule();

    expect(() => getToolCatalogPrompt(null)).toThrow(TypeError);
  });

  it("handles long strings and deep nested parameters", async () => {
    const { getToolCatalogPrompt } = await loadModule();

    const output = getToolCatalogPrompt();

    expect(output).toContain(FIXTURES.longDescription);
    expect(output).toContain(FIXTURES.longParamName);
    expect(output).toContain("deep");
    expect(output.length).toBeGreaterThan(FIXTURES.longDescription.length);
  });

  it("supports rapid consecutive calls", async () => {
    const { getToolCatalogPrompt } = await loadModule();

    const results = [];
    for (let i = 0; i < 12; i += 1) {
      results.push(getToolCatalogPrompt());
    }

    results.forEach((result) => {
      expect(result).toEqual(results[0]);
    });
  });
});
