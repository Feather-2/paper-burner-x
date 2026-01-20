import { describe, it, expect, vi, beforeEach } from "vitest";

const agentLoopMock = vi.hoisted(() => {
  const state = { runImpl: null };
  const instances = [];

  class MockAgentLoop {
    constructor(options = {}) {
      this.options = options;
      this.run = vi.fn((input, ctx) => {
        if (typeof state.runImpl === "function") {
          return state.runImpl(input, ctx, this);
        }
        return Promise.resolve({ output: [] });
      });
      instances.push(this);
    }
  }

  return { state, instances, MockAgentLoop };
});

const agentLoopPath = "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js";
vi.mock(agentLoopPath, () => ({
  default: agentLoopMock.MockAgentLoop,
}));

const modulePath = "../../../../../js/agents/plugins/stages/deepsearch.js";
const loadPlugin = async () => {
  vi.doMock(agentLoopPath, () => ({ default: agentLoopMock.MockAgentLoop }));
  return (await import(modulePath)).default;
};

const hasOwn = Object.prototype.hasOwnProperty;

const getAtPath = (store, path) => {
  if (!path) return store;
  return path.split(".").reduce((current, key) => {
    if (current && hasOwn.call(current, key)) {
      return current[key];
    }
    return undefined;
  }, store);
};

const setAtPath = (store, path, value) => {
  if (!path) return;
  const keys = path.split(".");
  let current = store;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (i === keys.length - 1) {
      current[key] = value;
    } else {
      if (!current[key] || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key];
    }
  }
};

const createState = (initial = {}, globalState = { meta: { runId: "run-1" } }) => {
  const store = { ...initial };
  const globalStore = { ...globalState };
  return {
    store,
    get: vi.fn((path) => getAtPath(store, path)),
    set: vi.fn((path, value) => setAtPath(store, path, value)),
    getGlobal: vi.fn((path) => getAtPath(globalStore, path)),
  };
};

const createContext = ({ config = {}, state = {}, globalState, kernel } = {}) => {
  const stateApi = createState(state, globalState);
  const events = { emit: vi.fn() };
  const log = { info: vi.fn() };
  let service = null;
  const ctx = {
    config: { maxIterations: 50, mode: "auto", ...config },
    events,
    state: stateApi,
    log,
    _kernel: kernel ?? { id: "kernel" },
    registerService: vi.fn((name, svc) => {
      if (name === "deepsearchStage") {
        service = svc;
      }
    }),
  };
  return { ctx, events, state: stateApi, log, getService: () => service };
};

const createHarness = async (overrides = {}) => {
  const plugin = await loadPlugin();
  const { ctx, events, state, log, getService } = createContext(overrides);
  await plugin.install(ctx);
  return { ctx, events, state, log, service: getService() };
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

const buildLargeString = (size) => "x".repeat(size);

const buildDeepNested = (depth) => {
  const root = {};
  let current = root;
  for (let i = 0; i < depth; i += 1) {
    current.child = {};
    current = current.child;
  }
  return root;
};

beforeEach(() => {
  agentLoopMock.instances.length = 0;
  agentLoopMock.state.runImpl = null;
  vi.clearAllMocks();
  vi.resetModules();
});

describe("default", () => {
  it("exposes plugin metadata and defaults", async () => {
    const plugin = await loadPlugin();

    expect(plugin.name).toBe("stage/deepsearch");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.description).toContain("DeepSearch");
    expect(plugin.defaultConfig).toEqual({
      maxIterations: 50,
      mode: "auto",
    });
  });

  it("registers the deepsearchStage service and logs install", async () => {
    const plugin = await loadPlugin();
    const { ctx, log, getService } = createContext();
    await plugin.install(ctx);

    expect(ctx.registerService).toHaveBeenCalledWith("deepsearchStage", expect.any(Object));
    const service = getService();
    expect(service).toBeTruthy();
    expect(service.run).toBeTypeOf("function");
    expect(service.getStatus).toBeTypeOf("function");
    expect(log.info).toHaveBeenCalledWith("DeepSearch stage plugin installed");
  });

  describe("deepsearchStage.run", () => {
    it("uses config defaults, emits events, and updates state on success", async () => {
      agentLoopMock.state.runImpl = vi.fn(async () => ({ output: ["a", "b"] }));

      const { service, ctx, events, state } = await createHarness({
        config: { mode: "standard", maxIterations: 12 },
      });

      const input = { query: "test" };
      const result = await service.run(input);

      expect(agentLoopMock.instances).toHaveLength(1);
      expect(agentLoopMock.instances[0].options).toEqual({
        eventBus: ctx.events,
        mode: "standard",
        maxIterations: 12,
      });

      const runArgs = agentLoopMock.instances[0].run.mock.calls[0][1];
      expect(runArgs).toEqual({
        stageApi: { eventBus: ctx.events },
        runContext: { runId: "run-1", kernel: ctx._kernel },
      });

      expect(state.store.status).toBe("completed");
      expect(state.store.startedAt).toEqual(expect.any(Number));
      expect(state.store.completedAt).toEqual(expect.any(Number));
      expect(state.store.result).toEqual({ success: true, outputCount: 2 });

      expect(events.emit).toHaveBeenCalledWith("deepsearch:start", { input });
      expect(events.emit).toHaveBeenCalledWith("deepsearch:complete", { result });
      expect(result).toEqual({ output: ["a", "b"] });
    });

    it("merges runContext and stageApi overrides", async () => {
      agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

      const { service } = await createHarness();
      const overrideBus = { emit: vi.fn() };
      const overrideKernel = { id: "override" };

      await service.run("input", {
        runContext: { runId: "override-run", kernel: overrideKernel, extra: "value" },
        stageApi: { eventBus: overrideBus, helper: true },
      });

      const runArgs = agentLoopMock.instances[0].run.mock.calls[0][1];
      expect(runArgs.runContext).toEqual({
        runId: "override-run",
        kernel: overrideKernel,
        extra: "value",
      });
      expect(runArgs.stageApi).toEqual({ eventBus: overrideBus, helper: true });
    });

    it.each([
      ["null", () => null],
      ["undefined", () => undefined],
      ["empty string", () => ""],
      ["whitespace string", () => "   "],
      ["empty array", () => []],
      ["empty object", () => ({})],
      ["zero", () => 0],
      ["negative", () => -1],
      ["max safe", () => Number.MAX_SAFE_INTEGER],
      ["array-like object", () => ({ 0: "a", length: 1 })],
      ["long string", () => buildLargeString(100000)],
      ["large file", () => ({ name: "big.txt", content: buildLargeString(200000) })],
      ["deep nested", () => buildDeepNested(32)],
    ])("handles boundary input: %s", async (_label, buildInput) => {
      agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));
      const { service, state } = await createHarness();

      const input = buildInput();
      const result = await service.run(input);

      expect(agentLoopMock.instances).toHaveLength(1);
      expect(agentLoopMock.instances[0].run).toHaveBeenCalledWith(input, expect.any(Object));
      expect(state.store.result).toEqual({ success: true, outputCount: 0 });
      expect(result).toEqual({ output: [] });
    });

    it.each([
      {
        name: "falls back on empty mode",
        options: { mode: "" },
        expectedMode: "config-mode",
        expectedIterations: 5,
      },
      {
        name: "accepts whitespace mode",
        options: { mode: "   " },
        expectedMode: "   ",
        expectedIterations: 5,
      },
      {
        name: "falls back on maxIterations 0",
        options: { maxIterations: 0 },
        expectedMode: "config-mode",
        expectedIterations: 5,
      },
      {
        name: "accepts -1 maxIterations",
        options: { maxIterations: -1 },
        expectedMode: "config-mode",
        expectedIterations: -1,
      },
      {
        name: "accepts MAX_SAFE_INTEGER maxIterations",
        options: { maxIterations: Number.MAX_SAFE_INTEGER },
        expectedMode: "config-mode",
        expectedIterations: Number.MAX_SAFE_INTEGER,
      },
      {
        name: "accepts numeric string maxIterations",
        options: { maxIterations: "7" },
        expectedMode: "config-mode",
        expectedIterations: "7",
      },
    ])("respects option boundaries: $name", async ({ options, expectedMode, expectedIterations }) => {
      agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));
      const { service, ctx } = await createHarness({
        config: { mode: "config-mode", maxIterations: 5 },
      });

      await service.run("input", options);

      expect(agentLoopMock.instances[0].options).toEqual({
        eventBus: ctx.events,
        mode: expectedMode,
        maxIterations: expectedIterations,
      });
    });

    it("emits error and updates state on failure", async () => {
      const error = new Error("boom");
      agentLoopMock.state.runImpl = vi.fn(() => Promise.reject(error));

      const { service, events, state } = await createHarness();

      await expect(service.run("input")).rejects.toThrow("boom");

      expect(state.store.status).toBe("failed");
      expect(state.store.error).toBe("boom");
      expect(events.emit).toHaveBeenCalledWith("deepsearch:error", { error });
    });

    it("supports concurrent runs", async () => {
      const first = createDeferred();
      const second = createDeferred();
      const queue = [first, second];
      agentLoopMock.state.runImpl = vi.fn(() => queue.shift().promise);

      const { service, events } = await createHarness();

      const runOne = service.run("alpha");
      const runTwo = service.run("beta");

      const resultOne = { output: ["x"] };
      const resultTwo = { output: [] };
      first.resolve(resultOne);
      second.resolve(resultTwo);

      const [outOne, outTwo] = await Promise.all([runOne, runTwo]);
      expect(outOne).toEqual(resultOne);
      expect(outTwo).toEqual(resultTwo);
      expect(agentLoopMock.instances).toHaveLength(2);
      expect(agentLoopMock.state.runImpl).toHaveBeenCalledTimes(2);
      expect(events.emit).toHaveBeenCalledWith("deepsearch:start", { input: "alpha" });
      expect(events.emit).toHaveBeenCalledWith("deepsearch:start", { input: "beta" });
      expect(events.emit).toHaveBeenCalledWith("deepsearch:complete", { result: resultOne });
      expect(events.emit).toHaveBeenCalledWith("deepsearch:complete", { result: resultTwo });
    });

    it("handles rapid consecutive runs", async () => {
      agentLoopMock.state.runImpl = vi.fn(async (input) => ({ output: [input] }));
      const { service, events, state } = await createHarness();

      const first = await service.run("one");
      const second = await service.run("two");

      expect(agentLoopMock.instances).toHaveLength(2);
      expect(first).toEqual({ output: ["one"] });
      expect(second).toEqual({ output: ["two"] });
      expect(events.emit).toHaveBeenCalledWith("deepsearch:complete", { result: first });
      expect(events.emit).toHaveBeenCalledWith("deepsearch:complete", { result: second });
      expect(state.store.status).toBe("completed");
    });
  });

  describe("deepsearchStage.getStatus", () => {
    it("returns stored state", async () => {
      const { service } = await createHarness({ state: { status: "running" } });

      expect(service.getStatus()).toEqual({ status: "running" });
    });

    it("returns idle when state is missing", async () => {
      const plugin = await loadPlugin();
      let service = null;
      const ctx = {
        config: { mode: "auto", maxIterations: 50 },
        events: { emit: vi.fn() },
        log: { info: vi.fn() },
        _kernel: {},
        state: {
          get: vi.fn(() => undefined),
          set: vi.fn(),
          getGlobal: vi.fn(),
        },
        registerService: vi.fn((name, svc) => {
          if (name === "deepsearchStage") {
            service = svc;
          }
        }),
      };

      await plugin.install(ctx);

      expect(service.getStatus()).toEqual({ status: "idle" });
    });
  });
});
