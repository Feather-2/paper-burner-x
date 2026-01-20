import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const testModulePath = "../../../../../js/agents/stages/codesearch/test.js";

const createToolExecutorImpl = vi.fn();
const formatToolDefinitionsForLLMImpl = vi.fn();
const createLoggerImpl = vi.fn();
let logger;
let exitSpy;
let logSpy;
let completionTarget = 1;
let completionCount = 0;
let completionResolve;
let completionPromise;

function resetCompletion(target = 1) {
  completionTarget = target;
  completionCount = 0;
  completionPromise = new Promise((resolve) => {
    completionResolve = resolve;
  });
}

function markCompletion() {
  completionCount += 1;
  if (completionCount >= completionTarget && completionResolve) {
    completionResolve();
  }
}

vi.mock("../../../../../js/agents/stages/codesearch/code-tools.js", () => ({
  createToolExecutor: (...args) => createToolExecutorImpl(...args),
  formatToolDefinitionsForLLM: (...args) => formatToolDefinitionsForLLMImpl(...args),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: (...args) => createLoggerImpl(...args),
}));

function getOption(options, key, fallback) {
  return Object.prototype.hasOwnProperty.call(options, key) ? options[key] : fallback;
}

function buildDeepNested(depth) {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i < depth; i += 1) {
    current.child = { level: i };
    current = current.child;
  }
  return root;
}

function buildCombinedExecutor(options = {}) {
  const listDirEntries = getOption(options, "listDirEntries", [{ name: "entry" }]);
  const listDirError = getOption(options, "listDirError", undefined);
  const missingDirError = getOption(options, "missingDirError", "ENOENT");
  const treeResult = getOption(options, "treeResult", { tree: "tree", stats: { dirs: 1, files: 1 } });
  const readFileContent = getOption(options, "readFileContent", "export const value = true;");
  const traversalThrows = getOption(options, "traversalThrows", true);
  const traversalContent = getOption(options, "traversalContent", "export const traversal = true;");
  const executeResults = getOption(options, "executeResults", {});
  const executeErrorForTool = getOption(options, "executeErrorForTool", undefined);

  const list_dir = vi.fn(async ({ path }) => {
    if (path === "js/agents/stages") {
      if (listDirError) {
        return { error: listDirError };
      }
      return { entries: listDirEntries };
    }
    if (path === "no_such_dir") {
      return { error: missingDirError };
    }
    return { entries: [] };
  });

  const tree = vi.fn(async () => treeResult);

  const read_file = vi.fn(async ({ path }) => {
    if (path === "../package.json") {
      if (traversalThrows) {
        throw new Error("Path traversal blocked");
      }
      return { content: traversalContent };
    }
    if (path === "js/agents/stages/codesearch/index.js") {
      return { content: readFileContent };
    }
    return { content: "" };
  });

  const defaultExecuteResults = {
    tree: executeResults.tree ?? { tree: "root", stats: { files: 1, dirs: 1 } },
    list_dir: executeResults.list_dir ?? { entries: ["entry"] },
    read_file: executeResults.read_file ?? { totalLines: 20 },
  };

  const execute = vi.fn(async (toolName) => {
    if (executeErrorForTool && toolName === executeErrorForTool) {
      return { error: "boom" };
    }
    return defaultExecuteResults[toolName] || {};
  });

  return { list_dir, tree, read_file, execute };
}

async function runModule(suffix) {
  const specifier = suffix ? `${testModulePath}?${suffix}` : testModulePath;
  await import(specifier);
}

describe("codesearch/test.js module side effects", () => {
  beforeEach(() => {
    vi.resetModules();
    resetCompletion();
    createToolExecutorImpl.mockReset();
    formatToolDefinitionsForLLMImpl.mockReset();
    createLoggerImpl.mockReset();
    logger = {
      error: vi.fn((...args) => {
        markCompletion();
        return args;
      }),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    createLoggerImpl.mockImplementation(() => logger);
    formatToolDefinitionsForLLMImpl.mockImplementation(() => "read_file");
    createToolExecutorImpl.mockImplementation(() => {
      throw new Error("createToolExecutor not configured");
    });
    const exitMock = vi.fn();
    const processProxy = new Proxy(process, {
      get(target, prop) {
        if (prop === "exit") return exitMock;
        return Reflect.get(target, prop);
      },
    });
    vi.stubGlobal("process", processProxy);
    exitSpy = exitMock;
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      if (args.some((arg) => typeof arg === "string" && arg.includes("=== Mock Agent Loop Test Passed ==="))) {
        markCompletion();
      }
      return args;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs with large content, whitespace tree, and deep nesting", async () => {
    const deepNested = buildDeepNested(12);
    const hugeContent = `${"x".repeat(120000)}export const ok = true;`;
    const longDefs = `read_file${"y".repeat(15000)}`;

    const executor = buildCombinedExecutor({
      listDirEntries: [{ name: "codesearch", meta: deepNested }],
      treeResult: { tree: "   ", stats: { dirs: 0, files: 2 } },
      readFileContent: hugeContent,
      executeResults: {
        tree: { tree: "root", stats: { files: 2, dirs: 1 } },
        list_dir: { entries: ["stage"] },
        read_file: { totalLines: 20 },
      },
    });

    createToolExecutorImpl.mockImplementation(() => executor);
    formatToolDefinitionsForLLMImpl.mockImplementation(() => longDefs);

    await runModule();
    await completionPromise;

    expect(createLoggerImpl).toHaveBeenCalledWith("stages/codesearch/test");
    expect(createToolExecutorImpl).toHaveBeenCalledTimes(2);
    expect(formatToolDefinitionsForLLMImpl).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(executor.list_dir).toHaveBeenCalledWith({ path: "js/agents/stages" });
    expect(executor.tree).toHaveBeenCalledWith({ path: "js/agents/stages/codesearch", depth: 2 });
    expect(executor.read_file).toHaveBeenCalledWith({
      path: "js/agents/stages/codesearch/index.js",
      startLine: 1,
      endLine: 10,
    });
    expect(executor.read_file).toHaveBeenCalledWith({ path: "../package.json" });
  });

  it.each([
    { label: "empty array", value: [], expectedError: "list_dir should return at least one entry" },
    { label: "empty object", value: {}, expectedError: "list_dir should return entries array" },
  ])("handles list_dir boundary: $label", async ({ value, expectedError }) => {
    const executor = buildCombinedExecutor({ listDirEntries: value });
    createToolExecutorImpl.mockImplementation(() => executor);

    await runModule();
    await completionPromise;

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]?.error).toBe(expectedError);
    expect(executor.tree).not.toHaveBeenCalled();
    expect(executor.read_file).not.toHaveBeenCalled();
  });

  it.each([
    { label: "empty string", value: "" },
    { label: "null", value: null },
    { label: "undefined", value: undefined },
  ])("handles read_file boundary: $label", async ({ value }) => {
    const executor = buildCombinedExecutor({ readFileContent: value });
    createToolExecutorImpl.mockImplementation(() => executor);

    await runModule();
    await completionPromise;

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(executor.list_dir).toHaveBeenCalledWith({ path: "js/agents/stages" });
    expect(executor.tree).toHaveBeenCalledWith({ path: "js/agents/stages/codesearch", depth: 2 });
    expect(executor.read_file).toHaveBeenCalledWith({
      path: "js/agents/stages/codesearch/index.js",
      startLine: 1,
      endLine: 10,
    });
  });

  it("handles negative dirs in tree stats", async () => {
    const executor = buildCombinedExecutor({
      treeResult: { tree: "ok", stats: { dirs: -1, files: 1 } },
    });
    createToolExecutorImpl.mockImplementation(() => executor);

    await runModule();
    await completionPromise;

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]?.error).toBe("tree should return stats");
    expect(executor.read_file).not.toHaveBeenCalled();
  });

  it("accepts string dirs and MAX_SAFE_INTEGER stats without error", async () => {
    const executor = buildCombinedExecutor({
      treeResult: { tree: "ok", stats: { dirs: "1", files: 2 } },
      executeResults: {
        tree: { tree: "root", stats: { files: Number.MAX_SAFE_INTEGER, dirs: Number.MAX_SAFE_INTEGER } },
        list_dir: { entries: ["stage"] },
        read_file: { totalLines: "20" },
      },
    });
    createToolExecutorImpl.mockImplementation(() => executor);

    await runModule();
    await completionPromise;

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledWith("tree", { depth: 2 });
    expect(executor.execute).toHaveBeenCalledWith("list_dir", { path: "js/agents/stages" });
    expect(executor.execute).toHaveBeenCalledWith("read_file", { path: "package.json", startLine: 1, endLine: 20 });
  });

  it("supports concurrent and rapid successive imports", async () => {
    resetCompletion(4);
    createToolExecutorImpl.mockImplementation(() => buildCombinedExecutor());

    await Promise.all([runModule("concurrent-1"), runModule("concurrent-2")]);
    await runModule("sequential-1");
    await runModule("sequential-2");
    await completionPromise;

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(createToolExecutorImpl).toHaveBeenCalledTimes(8);
  });
});
