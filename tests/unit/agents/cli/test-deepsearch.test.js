import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";

const modulePath = "../../../../js/agents/cli/test-deepsearch.js";
const defaultTask = "分析该项目的整体结构，包括：1) 核心模块划分 2) Agent 架构设计 3) 关键数据流 4) 扩展点和接口";

const mocks = vi.hoisted(() => {
  const fs = {
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };

  const readline = {
    responses: [],
    prompts: [],
    close: vi.fn(),
    instance: null,
    createInterface: vi.fn(),
  };

  const eventBus = {
    subscribe: vi.fn(),
    emit: vi.fn(),
    subscriber: null,
    instance: null,
  };

  const deepsearch = {
    run: vi.fn(),
    lastArgs: null,
    runContext: null,
    input: null,
    stageApi: null,
  };

  const chunk = {
    smartChunk: vi.fn(),
    detectChunkStrategy: vi.fn(),
  };

  const modelClient = {
    getClient: vi.fn(),
    availableModels: ["mock-model"],
    instances: [],
  };

  const createAiApiServiceAdapter = vi.fn();

  class EventBus {
    constructor() {
      eventBus.instance = this;
    }

    subscribe(pattern, handler) {
      eventBus.subscribe(pattern, handler);
      eventBus.subscriber = handler;
    }

    emit(name, payload) {
      eventBus.emit(name, payload);
    }
  }

  class CliModelRouter {
    constructor() {
      modelClient.instances.push(this);
    }

    getAvailableModels() {
      return modelClient.availableModels;
    }

    getClient(usage) {
      return modelClient.getClient(usage);
    }
  }

  return {
    fs,
    readline,
    eventBus,
    deepsearch,
    chunk,
    modelClient,
    createAiApiServiceAdapter,
    EventBus,
    CliModelRouter,
  };
});

vi.mock("../../../../js/agents/stages/deepsearch/index.js", () => ({
  runDeepSearchAgent: (...args) => mocks.deepsearch.run(...args),
  DeepSearchState: {},
}));

vi.mock("../../../../js/agents/core/event-bus.js", () => ({
  EventBus: mocks.EventBus,
}));

vi.mock("../../../../js/agents/cli/model-client.js", () => ({
  CliModelRouter: mocks.CliModelRouter,
  createAiApiServiceAdapter: mocks.createAiApiServiceAdapter,
}));

vi.mock("../../../../js/agents/stages/textprep/chunk.js", () => ({
  smartChunk: mocks.chunk.smartChunk,
  detectChunkStrategy: mocks.chunk.detectChunkStrategy,
}));

vi.mock("readline", () => ({
  createInterface: mocks.readline.createInterface,
}));

vi.mock("fs", () => mocks.fs);

const originalEnv = { ...process.env };
const originalArgv = process.argv.slice();

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

const restoreProcess = () => {
  process.argv = originalArgv.slice();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
  process.exitCode = undefined;
};

const resetMockState = () => {
  mocks.fs.readFileSync.mockReset();
  mocks.fs.readdirSync.mockReset();
  mocks.fs.statSync.mockReset();
  mocks.fs.writeFileSync.mockReset();
  mocks.fs.mkdirSync.mockReset();

  mocks.chunk.smartChunk.mockReset();
  mocks.chunk.detectChunkStrategy.mockReset();

  mocks.eventBus.subscribe.mockReset();
  mocks.eventBus.emit.mockReset();
  mocks.eventBus.subscriber = null;
  mocks.eventBus.instance = null;

  mocks.deepsearch.run.mockReset();
  mocks.deepsearch.lastArgs = null;
  mocks.deepsearch.runContext = null;
  mocks.deepsearch.input = null;
  mocks.deepsearch.stageApi = null;

  mocks.modelClient.getClient.mockReset();
  mocks.modelClient.availableModels = ["mock-model"];
  mocks.modelClient.instances.length = 0;

  mocks.createAiApiServiceAdapter.mockReset();
  mocks.createAiApiServiceAdapter.mockReturnValue({ adapter: true });

  mocks.readline.responses = [];
  mocks.readline.prompts = [];
  mocks.readline.close = vi.fn();
  mocks.readline.instance = null;
  mocks.readline.createInterface.mockReset();
  mocks.readline.createInterface.mockImplementation(() => {
    const rl = {
      question: vi.fn((prompt, cb) => {
        mocks.readline.prompts.push(prompt);
        const response = mocks.readline.responses.length > 0
          ? mocks.readline.responses.shift()
          : "";
        cb(response);
      }),
      close: mocks.readline.close,
    };
    mocks.readline.instance = rl;
    return rl;
  });
};

const setupModule = async ({
  env = {},
  argv,
  responses = [],
  fsSetup = {},
  smartChunkResult,
  runResult,
  now,
  getClientImpl,
  availableModels,
} = {}) => {
  vi.resetModules();
  resetMockState();
  restoreProcess();

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  process.argv = argv ? argv.slice() : ["node", "script", "file.md"];

  if (availableModels) {
    mocks.modelClient.availableModels = availableModels;
  }

  if (getClientImpl) {
    mocks.modelClient.getClient.mockImplementation(getClientImpl);
  } else {
    const chat = vi.fn(async payload => ({ ok: true, payload }));
    mocks.modelClient.getClient.mockReturnValue({ chat });
  }

  mocks.chunk.smartChunk.mockReturnValue(smartChunkResult || {
    strategy: "fixed",
    meta: {},
    chunks: [],
  });

  mocks.fs.readFileSync.mockImplementation(fsSetup.readFileSync || (() => ""));
  mocks.fs.readdirSync.mockImplementation(fsSetup.readdirSync || (() => []));
  mocks.fs.statSync.mockImplementation(fsSetup.statSync || (() => ({ isDirectory: () => false })));
  mocks.fs.writeFileSync.mockImplementation(fsSetup.writeFileSync || (() => {}));
  mocks.fs.mkdirSync.mockImplementation(fsSetup.mkdirSync || (() => {}));

  mocks.readline.responses = responses.slice();

  mocks.deepsearch.run.mockImplementation(async (runContext, input, stageApi) => {
    mocks.deepsearch.lastArgs = [runContext, input, stageApi];
    mocks.deepsearch.runContext = runContext;
    mocks.deepsearch.input = input;
    mocks.deepsearch.stageApi = stageApi;
    return runResult || { status: "ok", iteration: 1 };
  });

  if (now !== undefined) {
    vi.spyOn(Date, "now").mockReturnValue(now);
  }

  await import(modulePath);
  await flushPromises();

  return {
    runContext: mocks.deepsearch.runContext,
    input: mocks.deepsearch.input,
    stageApi: mocks.deepsearch.stageApi,
  };
};

beforeEach(() => {
  vi.restoreAllMocks();
  resetMockState();
  restoreProcess();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreProcess();
});

describe("main", () => {
  it("uses env task/mode, handles large inputs, and saves report", async () => {
    const cwd = process.cwd();
    const docsDir = join(cwd, "docs/agents");
    const outputDir = join(cwd, "output");
    const mdPath = join(docsDir, "doc.md");
    const longTask = "x".repeat(10000);
    const hugeContent = "a".repeat(120000);
    const chunkResult = { strategy: "markdown", meta: { size: 120000 }, chunks: ["c1"] };

    await setupModule({
      env: { DEEPSEARCH_TASK: longTask, DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script"],
      fsSetup: {
        readdirSync: (dir) => {
          if (dir === docsDir) {
            return ["doc.md"];
          }
          if (dir === outputDir) {
            const err = new Error("missing");
            err.code = "ENOENT";
            throw err;
          }
          return [];
        },
        statSync: (path) => ({ isDirectory: () => path === docsDir }),
        readFileSync: (path) => {
          if (path === mdPath) {
            return hugeContent;
          }
          throw new Error("not found");
        },
      },
      smartChunkResult: chunkResult,
      runResult: {
        status: "ok",
        iteration: 2,
        report: "report-content",
        _messages: ["m1"],
        _tokenUsage: { total: 3 },
      },
      now: 12345,
    });

    expect(mocks.deepsearch.input.taskGoal).toBe(longTask);
    expect(mocks.deepsearch.input.mode).toBe("quick");
    expect(mocks.deepsearch.input.L0.sources).toHaveLength(1);
    expect(mocks.deepsearch.input.L0.sources[0]).toMatchObject({
      sourceId: "doc.md",
      name: "doc.md",
      sourceText: hugeContent,
      chunkStrategy: "markdown",
      chunkMeta: chunkResult.meta,
      chunks: chunkResult.chunks,
    });

    expect(mocks.chunk.smartChunk).toHaveBeenCalledWith(hugeContent, { maxSize: 2000 });
    expect(mocks.fs.mkdirSync).toHaveBeenCalledWith(outputDir, { recursive: true });
    expect(mocks.fs.writeFileSync).toHaveBeenCalledWith(
      join(outputDir, "deepsearch-report-12345.md"),
      "report-content",
      "utf-8",
    );
    expect(mocks.readline.instance.question).not.toHaveBeenCalled();
  });

  it("defaults task and mode on blank input and handles empty content", async () => {
    await setupModule({
      env: { DEEPSEARCH_TASK: undefined, DEEPSEARCH_MODE: undefined },
      argv: ["node", "script", "note.md"],
      responses: ["   ", "-1"],
      fsSetup: {
        readFileSync: () => "",
      },
      smartChunkResult: { strategy: "fixed", meta: { size: 0 }, chunks: [] },
      runResult: { status: "ok", iteration: 0, _messages: [], _tokenUsage: {} },
    });

    expect(mocks.deepsearch.input.taskGoal).toBe(defaultTask);
    expect(mocks.deepsearch.input.mode).toBe("wider");
    expect(mocks.chunk.smartChunk).toHaveBeenCalledWith("", { maxSize: 2000 });
    expect(mocks.readline.instance.question).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("没有生成报告"));
  });

  it("sets exitCode when argv includes a non-string entry", async () => {
    await setupModule({
      argv: ["node", "script", { bad: true }],
    });

    expect(process.exitCode).toBe(1);
  });

  it("logs save failure when writeFileSync throws", async () => {
    await setupModule({
      env: { DEEPSEARCH_TASK: "task", DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script", "report.md"],
      fsSetup: {
        readFileSync: () => "content",
        writeFileSync: () => {
          throw new Error("disk full");
        },
      },
      smartChunkResult: { strategy: "fixed", meta: {}, chunks: ["c1"] },
      runResult: { status: "ok", iteration: 1, report: "data" },
    });

    const saveErrors = console.error.mock.calls
      .map(call => String(call[0]))
      .filter(message => message.includes("保存报告失败"));
    expect(saveErrors).not.toHaveLength(0);
  });

  it("exits when no md files are found and warns on permission error", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    const docsDir = join(process.cwd(), "docs/agents");

    await setupModule({
      env: { DEEPSEARCH_TASK: undefined, DEEPSEARCH_MODE: undefined },
      argv: ["node", "script"],
      fsSetup: {
        readdirSync: (dir) => {
          if (dir === docsDir) {
            const err = new Error("denied");
            err.code = "EACCES";
            throw err;
          }
          return [];
        },
      },
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mocks.deepsearch.run).not.toHaveBeenCalled();
    expect(mocks.readline.instance.close).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("无法读取目录"));
  });
});

describe("findMdFiles", () => {
  it("recurses deep directories and collects markdown files", async () => {
    const cwd = process.cwd();
    const docsDir = join(cwd, "docs/agents");
    const level1 = join(docsDir, "level1");
    const level2 = join(level1, "level2");
    const level3 = join(level2, "level3");
    const level4 = join(level3, "level4");
    const deepFile = join(level4, "deep.md");
    const rootFile = join(docsDir, "root.md");

    const directories = new Map([
      [docsDir, ["level1", "root.md"]],
      [level1, ["level2"]],
      [level2, ["level3"]],
      [level3, ["level4"]],
      [level4, ["deep.md", "note.txt"]],
    ]);

    await setupModule({
      env: { DEEPSEARCH_TASK: "task", DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script"],
      fsSetup: {
        readdirSync: (dir) => directories.get(dir) || [],
        statSync: (path) => ({ isDirectory: () => directories.has(path) }),
        readFileSync: (path) => {
          if (path === rootFile) {
            return "root";
          }
          if (path === deepFile) {
            return "deep";
          }
          throw new Error("missing");
        },
      },
      smartChunkResult: { strategy: "markdown", meta: {}, chunks: ["c1"] },
      runResult: { status: "ok", iteration: 1 },
    });

    const sourceNames = mocks.deepsearch.input.L0.sources.map(source => source.name);
    expect(sourceNames).toEqual(expect.arrayContaining(["root.md", "deep.md"]));
    expect(mocks.deepsearch.input.L0.sources).toHaveLength(2);
  });
});

describe("loadSource", () => {
  it("skips files that fail to load", async () => {
    await setupModule({
      env: { DEEPSEARCH_TASK: "task", DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script", "good.md", "bad.md"],
      fsSetup: {
        readFileSync: (path) => {
          if (String(path).endsWith("good.md")) {
            return "ok";
          }
          throw new Error("boom");
        },
      },
      smartChunkResult: { strategy: "fixed", meta: {}, chunks: ["c1"] },
      runResult: { status: "ok", iteration: 1 },
    });

    expect(mocks.deepsearch.input.L0.sources).toHaveLength(1);
    expect(mocks.deepsearch.input.L0.sources[0].name).toBe("good.md");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("无法读取"));
  });
});

describe("waitForUserInput", () => {
  it("returns selected option or custom input", async () => {
    const { stageApi } = await setupModule({
      env: { DEEPSEARCH_TASK: "task", DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script", "doc.md"],
    });

    mocks.readline.responses = ["2", "0", "custom"];

    const picked = await stageApi.waitForUserInput({
      question: "Pick",
      options: ["alpha", "beta"],
    });

    const custom = await stageApi.waitForUserInput({
      question: "Custom",
      options: ["x", "y"],
    });

    expect(picked).toBe("beta");
    expect(custom).toBe("custom");
  });

  it("handles invalid numeric inputs and MAX_SAFE_INTEGER", async () => {
    const { stageApi } = await setupModule({
      env: { DEEPSEARCH_TASK: "task", DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script", "doc.md"],
    });

    mocks.readline.responses = ["-1", String(Number.MAX_SAFE_INTEGER)];

    const negative = await stageApi.waitForUserInput({
      question: "Pick",
      options: ["only"],
    });

    const maxSafe = await stageApi.waitForUserInput({
      question: "Pick",
      options: ["only"],
    });

    expect(negative).toBe("-1");
    expect(maxSafe).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it("handles empty options, null question, whitespace input, and concurrent calls", async () => {
    const { stageApi } = await setupModule({
      env: { DEEPSEARCH_TASK: "task", DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script", "doc.md"],
    });

    mocks.readline.responses = ["   ", "answer", "  spaced  ", "1", "2"];

    const emptyAnswer = await stageApi.waitForUserInput({ question: null, options: undefined });
    const emptyOptions = await stageApi.waitForUserInput({ question: "", options: [] });
    const objectOptions = await stageApi.waitForUserInput({ question: "Q", options: {} });

    const [first, second] = await Promise.all([
      stageApi.waitForUserInput({ question: "Q1", options: ["a"] }),
      stageApi.waitForUserInput({ question: "Q2", options: ["x", "y"] }),
    ]);

    expect(emptyAnswer).toBe("");
    expect(emptyOptions).toBe("answer");
    expect(objectOptions).toBe("spaced");
    expect(first).toBe("a");
    expect(second).toBe("y");
  });
});

describe("stageApi.modelRouter.call", () => {
  it("forwards calls to the routed client", async () => {
    const chat = vi.fn(async payload => ({ ok: true, payload }));
    const { stageApi } = await setupModule({
      env: { DEEPSEARCH_TASK: "task", DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script", "doc.md"],
      getClientImpl: () => ({ chat }),
    });

    const signal = new AbortController().signal;
    const result = await stageApi.modelRouter.call({
      usage: "agent",
      messages: [{ role: "user", content: "hi" }],
      signal,
      temperature: 0.2,
    });

    expect(chat).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "hi" }],
      signal,
      temperature: 0.2,
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        messages: [{ role: "user", content: "hi" }],
        signal,
        temperature: 0.2,
      },
    });
  });

  it("throws when no client matches usage", async () => {
    const { stageApi } = await setupModule({
      env: { DEEPSEARCH_TASK: "task", DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script", "doc.md"],
      getClientImpl: () => null,
    });

    await expect(stageApi.modelRouter.call({ usage: 0, messages: [] }))
      .rejects.toThrow("No client for usage: 0");
  });
});

describe("eventBus subscription", () => {
  it("logs key event categories", async () => {
    await setupModule({
      env: { DEEPSEARCH_TASK: "task", DEEPSEARCH_MODE: "quick" },
      argv: ["node", "script", "doc.md"],
    });

    const subscriber = mocks.eventBus.subscriber;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T12:34:56Z"));

    subscriber({ iteration: 0 }, { name: "deepsearch.iteration" });
    subscriber({ usage: { total: 10 } }, { name: "model.responded" });
    subscriber({ payload: { task: "x" } }, { name: "todo.add" });
    subscriber({ payload: { status: "ok" } }, { name: "watchdog.tick" });
    subscriber({}, { name: "report.final" });
    subscriber({ content: "claim" }, { name: "finding.claim" });
    subscriber({ content: "gap" }, { name: "finding.gap" });
    subscriber({ content: "conflict" }, { name: "finding.conflict" });
    subscriber({ payload: { id: 1 } }, { name: "claim.created" });
    subscriber({}, { name: "deepsearch.started" });
    subscriber({}, { name: "deepsearch.completed" });
    subscriber({}, { name: "user.input.required" });

    const logs = console.log.mock.calls.map(call => String(call[0]));

    expect(logs).toEqual(expect.arrayContaining([
      expect.stringContaining("迭代 ?"),
      expect.stringContaining("模型响应: 10 tokens"),
      expect.stringContaining("Todo: add"),
      expect.stringContaining("Watchdog"),
      expect.stringContaining("Report: report.final"),
      expect.stringContaining("CLAIM: claim"),
      expect.stringContaining("GAP: gap"),
      expect.stringContaining("CONFLICT: conflict"),
      expect.stringContaining("created"),
      expect.stringContaining("deepsearch.started"),
      expect.stringContaining("deepsearch.completed"),
    ]));
    expect(logs.some(entry => entry.includes("user.input.required"))).toBe(false);
  });
});
