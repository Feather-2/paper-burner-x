/* @vitest-environment node */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MODULE_PATH = "../../../../../js/agents/stages/codesearch/test-agent-loop.js";

const hoisted = vi.hoisted(() => ({
  joinReturn: "/project/root",
  dirnameReturn: "/project/root/js/agents/stages/codesearch",
  fileURLToPathReturn: "/project/root/js/agents/stages/codesearch/test-agent-loop.js",
  executeMock: vi.fn(),
  lastExecutePromise: null,
  codeSearchStageCtor: vi.fn(),
  createLoggerMock: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:url", () => ({
  fileURLToPath: vi.fn(() => hoisted.fileURLToPathReturn),
}));

vi.mock("node:path", () => ({
  dirname: vi.fn(() => hoisted.dirnameReturn),
  join: vi.fn(() => hoisted.joinReturn),
}));

vi.mock("../../../../../js/agents/stages/codesearch/codesearch-stage.js", () => ({
  CodeSearchStage: vi.fn().mockImplementation(function (opts) {
    hoisted.codeSearchStageCtor(opts);
    this.execute = (...args) => hoisted.executeMock(...args);
  }),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: (...args) => hoisted.createLoggerMock(...args),
}));

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const hasLog = (spy, text) => spy.mock.calls.some((call) => call.some((arg) => String(arg).includes(text)));

const setExecuteMock = (impl) => {
  hoisted.executeMock = vi.fn((...args) => {
    const promise = Promise.resolve().then(() => impl(...args));
    hoisted.lastExecutePromise = promise;
    return promise;
  });
};

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const importModule = async (suffix = "") => {
  hoisted.lastExecutePromise = null;
  await import(`${MODULE_PATH}${suffix}`);
  for (let i = 0; i < 3 && !hoisted.lastExecutePromise; i += 1) {
    await flushPromises();
  }
  if (hoisted.lastExecutePromise) {
    await hoisted.lastExecutePromise.catch(() => {});
  }
  await flushPromises();
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  hoisted.joinReturn = "/project/root";
  hoisted.dirnameReturn = "/project/root/js/agents/stages/codesearch";
  hoisted.fileURLToPathReturn = "/project/root/js/agents/stages/codesearch/test-agent-loop.js";
  hoisted.lastExecutePromise = null;

  hoisted.loggerErrorSpy = vi.fn();
  hoisted.createLoggerMock = vi.fn(() => ({
    error: (...args) => hoisted.loggerErrorSpy(...args),
  }));

  setExecuteMock(() => ({
    query: "analysis codesearch module",
    totalSteps: 2,
    steps: [
      { step: 1, tool: "tree" },
      { step: 2, tool: "read_file" },
    ],
    summary: "summary ok",
  }));

  hoisted.codeSearchStageCtor = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("test-agent-loop module", () => {
  it("runs the agent loop with expected inputs and logs success", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    await importModule();

    expect(hoisted.createLoggerMock).toHaveBeenCalledWith("stages/codesearch/test-agent-loop");
    expect(hoisted.codeSearchStageCtor).toHaveBeenCalledWith({ maxSteps: 10 });
    expect(hoisted.executeMock).toHaveBeenCalledTimes(1);

    const [runContext, input, stageApi] = hoisted.executeMock.mock.calls[0];
    expect(runContext).toEqual({ runId: "test-001" });
    expect(input.query).toEqual(expect.any(String));
    expect(input.query.includes("codesearch")).toBe(true);
    expect(input.basePath).toBe(hoisted.joinReturn);
    expect(stageApi).toEqual(
      expect.objectContaining({
        modelRouter: expect.any(Object),
        fs: expect.any(Object),
        emit: expect.any(Function),
        signal: null,
      })
    );
    expect(typeof stageApi.modelRouter.call).toBe("function");

    expect(hasLog(logSpy, "Agent Loop Test Passed!")).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace string", value: "   " },
    { label: "empty object", value: {} },
    { label: "empty array", value: [] },
  ])("passes basePath boundary: $label", async ({ value }) => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    hoisted.joinReturn = value;

    await importModule();

    expect(hoisted.executeMock).toHaveBeenCalledTimes(1);
    expect(hoisted.executeMock.mock.calls[0][1].basePath).toBe(value);
    expect(hoisted.loggerErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(hasLog(logSpy, "Agent Loop Test Passed!")).toBe(true);
  });

  it("handles empty summary, empty steps, and zero totals", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    setExecuteMock(() => ({
      query: "",
      totalSteps: 0,
      steps: [],
      summary: "",
    }));

    await importModule();

    expect(hoisted.executeMock).toHaveBeenCalledTimes(1);
    expect(hoisted.loggerErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(hasLog(logSpy, "Summary preview:")).toBe(true);
  });

  it("handles whitespace summary and string totalSteps", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    setExecuteMock(() => ({
      query: "   ",
      totalSteps: "42",
      steps: [{ step: 1, tool: "tree" }],
      summary: "   ",
    }));

    await importModule();

    expect(hoisted.executeMock).toHaveBeenCalledTimes(1);
    expect(hoisted.loggerErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(hasLog(logSpy, "Total Steps:")).toBe(true);
  });

  it.each([
    { label: "negative", value: -1 },
    { label: "max safe integer", value: Number.MAX_SAFE_INTEGER },
  ])("handles totalSteps boundary: $label", async ({ value }) => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    setExecuteMock(() => ({
      query: "analysis codesearch module",
      totalSteps: value,
      steps: [{ step: 1, tool: "tree" }],
      summary: "ok",
    }));

    await importModule();

    expect(hoisted.executeMock).toHaveBeenCalledTimes(1);
    expect(hoisted.loggerErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(hasLog(logSpy, "Total Steps:")).toBe(true);
  });

  it("logs error and exits when execute rejects", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    setExecuteMock(() => {
      throw new Error("boom");
    });

    await importModule();

    expect(hoisted.executeMock).toHaveBeenCalledTimes(1);
    expect(hoisted.loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
  ])("logs error and exits when summary is $label", async ({ value }) => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    setExecuteMock(() => ({
      query: "analysis codesearch module",
      totalSteps: 1,
      steps: [{ step: 1, tool: "tree" }],
      summary: value,
    }));

    await importModule();

    expect(hoisted.loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs error and exits when steps is an object", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    setExecuteMock(() => ({
      query: "analysis codesearch module",
      totalSteps: 1,
      steps: {},
      summary: "ok",
    }));

    await importModule();

    expect(hoisted.loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("handles deep nested emit and large summary output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    const { readFile } = await import("node:fs/promises");
    const readFileMock = vi.mocked(readFile);
    const largeContent = "x".repeat(100000);

    readFileMock.mockResolvedValue(largeContent);

    setExecuteMock(async (runContext, input, api) => {
      const content = await api.fs.readFile("bigfile.txt", "utf8");
      api.emit("deep", {
        a: { b: { c: { d: { e: { f: "nested" } } } } },
        size: content.length,
      });
      return {
        query: input.query,
        totalSteps: 1,
        steps: [{ step: 1, tool: "read_file" }],
        summary: content,
      };
    });

    await importModule();

    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(hasLog(logSpy, "[Event] deep")).toBe(true);
    expect(hoisted.loggerErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("supports concurrent imports", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    const pending = [createDeferred(), createDeferred()];
    const queue = pending.slice();

    hoisted.executeMock = vi.fn(() => {
      const deferred = queue.shift();
      hoisted.lastExecutePromise = deferred?.promise ?? null;
      return deferred?.promise;
    });

    const importOne = import(`${MODULE_PATH}?run=1`);
    const importTwo = import(`${MODULE_PATH}?run=2`);

    await Promise.all([importOne, importTwo]);
    for (let i = 0; i < 3 && hoisted.executeMock.mock.calls.length < 2; i += 1) {
      await flushPromises();
    }

    expect(hoisted.executeMock).toHaveBeenCalledTimes(2);

    pending.forEach((deferred) => {
      deferred.resolve({
        query: "analysis codesearch module",
        totalSteps: 1,
        steps: [{ step: 1, tool: "tree" }],
        summary: "ok",
      });
    });

    await Promise.all(pending.map((deferred) => deferred.promise));
    await flushPromises();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("supports rapid sequential imports", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);

    await importModule("?seq=1");
    await importModule("?seq=2");

    expect(hoisted.executeMock).toHaveBeenCalledTimes(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
