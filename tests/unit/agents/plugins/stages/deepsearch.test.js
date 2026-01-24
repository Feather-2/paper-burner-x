import { beforeEach, describe, expect, it, vi } from "vitest";

const paths = {
  modulePath: "../../../../../js/agents/plugins/stages/deepsearch.js",
};

const pluginCoreMock = vi.hoisted(() => ({
  createPlugin: vi.fn((definition) => definition),
}));

const agentLoopImportState = vi.hoisted(() => ({
  failNextImport: false,
  importAttempts: 0,
}));

const agentLoopMock = vi.hoisted(() => {
  const instances = [];
  const state = { runImpl: null };

  class MockAgentLoop {
    constructor(options = {}) {
      this.options = options;
      this.run = vi.fn((input, ctx) => {
        if (typeof state.runImpl === "function") {
          return state.runImpl(input, ctx);
        }
        return Promise.resolve({ output: [] });
      });
      instances.push(this);
    }
  }

  return { instances, state, MockAgentLoop };
});

const hasOwn = Object.prototype.hasOwnProperty;

const getAtPath = (store, path) => {
  if (!path) return store;
  return path.split(".").reduce((current, key) => {
    if (current && hasOwn.call(current, key)) return current[key];
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
      return;
    }
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
};

const createState = (initial = {}, globalState = { meta: { runId: "run-1" } }) => {
  const localStore = { ...initial };
  const globalStore = { ...globalState };

  return {
    localStore,
    get: vi.fn((path) => {
      if (path === "") {
        return Object.keys(localStore).length === 0 ? undefined : localStore;
      }
      return getAtPath(localStore, path);
    }),
    set: vi.fn((path, value) => setAtPath(localStore, path, value)),
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
      if (name === "deepsearchStage") service = svc;
    }),
  };

  return { ctx, events, state: stateApi, log, getService: () => service };
};

const loadPluginModule = async () => {
  vi.doMock("../../../../../js/agents/core/plugin.js", () => pluginCoreMock);
  vi.doMock("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js", () => {
    agentLoopImportState.importAttempts += 1;
    if (agentLoopImportState.failNextImport) {
      agentLoopImportState.failNextImport = false;
      throw new Error("transient import failure");
    }
    return { default: agentLoopMock.MockAgentLoop };
  });

  return await import(paths.modulePath);
};

const createHarness = async (overrides = {}) => {
  const pluginModule = await loadPluginModule();
  const plugin = pluginModule.default;
  const { ctx, events, state, log, getService } = createContext(overrides);
  await plugin.install(ctx);

  return { pluginModule, plugin, ctx, events, state, log, service: getService() };
};

const createDeferred = () => {
  /** @type {(value: any) => void} */
  let resolve = () => {};
  /** @type {(reason: any) => void} */
  let reject = () => {};
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
  vi.clearAllMocks();
  vi.resetModules();

  agentLoopMock.instances.length = 0;
  agentLoopMock.state.runImpl = null;
  agentLoopImportState.failNextImport = false;
  agentLoopImportState.importAttempts = 0;
});

describe("js/agents/plugins/stages/deepsearch.js", () => {
  it("should_export_default_plugin_when_imported", async () => {
    const pluginModule = await loadPluginModule();

    expect(pluginModule.default).toBeTypeOf("object");
  });

  it("should_call_createPlugin_when_imported", async () => {
    await loadPluginModule();

    expect(pluginCoreMock.createPlugin).toHaveBeenCalledTimes(1);
  });

  it("should_expose_expected_metadata_when_imported", async () => {
    const pluginModule = await loadPluginModule();

    expect(pluginModule.default).toEqual(
      expect.objectContaining({
        name: "stage/deepsearch",
        version: "1.0.0",
        description: "DeepSearch 研究阶段",
        defaultConfig: { maxIterations: 50, mode: "auto" },
        install: expect.any(Function),
      })
    );
  });

  it("should_register_deepsearchStage_service_when_install_called", async () => {
    const pluginModule = await loadPluginModule();
    const plugin = pluginModule.default;
    const { ctx } = createContext();

    await plugin.install(ctx);

    expect(ctx.registerService).toHaveBeenCalledWith("deepsearchStage", expect.any(Object));
  });

  it("should_log_install_message_when_install_called", async () => {
    const pluginModule = await loadPluginModule();
    const plugin = pluginModule.default;
    const { ctx, log } = createContext();

    await plugin.install(ctx);

    expect(log.info).toHaveBeenCalledWith("DeepSearch stage plugin installed");
  });

  it("should_expose_run_function_when_install_called", async () => {
    const pluginModule = await loadPluginModule();
    const plugin = pluginModule.default;
    const { ctx, getService } = createContext();

    await plugin.install(ctx);

    expect(getService()?.run).toBeTypeOf("function");
  });

  it("should_expose_getStatus_function_when_install_called", async () => {
    const pluginModule = await loadPluginModule();
    const plugin = pluginModule.default;
    const { ctx, getService } = createContext();

    await plugin.install(ctx);

    expect(getService()?.getStatus).toBeTypeOf("function");
  });

  it("should_return_idle_when_getStatus_called_with_empty_state", async () => {
    const { service } = await createHarness();

    expect(service.getStatus()).toEqual({ status: "idle" });
  });

  it("should_return_state_when_getStatus_called_with_existing_state", async () => {
    const { service } = await createHarness({ state: { status: "running" } });

    expect(service.getStatus()).toEqual({ status: "running" });
  });

  it("should_create_agent_loop_with_ctx_config_when_run_called_without_overrides", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, ctx } = await createHarness({
      config: { mode: "standard", maxIterations: 12 },
    });

    await service.run({ query: "q" });

    expect(agentLoopMock.instances[0].options).toEqual({
      eventBus: ctx.events,
      mode: "standard",
      maxIterations: 12,
    });
  });

  it("should_create_agent_loop_with_overrides_when_run_called_with_overrides", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, ctx } = await createHarness({
      config: { mode: "cfg-mode", maxIterations: 9 },
    });

    await service.run("input", { mode: "override-mode", maxIterations: 3 });

    expect(agentLoopMock.instances[0].options).toEqual({
      eventBus: ctx.events,
      mode: "override-mode",
      maxIterations: 3,
    });
  });

  it("should_emit_deepsearch_start_when_run_succeeds", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, events } = await createHarness();
    const input = { query: "test" };

    await service.run(input);

    expect(events.emit).toHaveBeenCalledWith("deepsearch:start", { input });
  });

  it("should_emit_deepsearch_start_when_agent_run_throws", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => {
      throw new Error("boom");
    });

    const { service, events } = await createHarness();
    const input = { query: "test" };

    await service.run(input).catch(() => {});

    expect(events.emit).toHaveBeenCalledWith("deepsearch:start", { input });
  });

  it("should_pass_stageApi_and_runContext_when_run_called_without_overrides", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, ctx } = await createHarness({
      globalState: { meta: { runId: "run-123" } },
      kernel: { id: "k1" },
    });

    await service.run("input");

    expect(agentLoopMock.instances[0].run).toHaveBeenCalledWith("input", {
      stageApi: { eventBus: ctx.events },
      runContext: { runId: "run-123", kernel: ctx._kernel },
    });
  });

  it("should_merge_runContext_overrides_when_run_called_with_runContext", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, ctx } = await createHarness({
      globalState: { meta: { runId: "run-default" } },
      kernel: { id: "k-default" },
    });

    const overrideKernel = { id: "k-override" };
    await service.run("input", {
      runContext: { runId: "run-override", kernel: overrideKernel, extra: 1 },
    });

    expect(agentLoopMock.instances[0].run).toHaveBeenCalledWith("input", {
      stageApi: { eventBus: ctx.events },
      runContext: { runId: "run-override", kernel: overrideKernel, extra: 1 },
    });
  });

  it("should_merge_stageApi_overrides_when_run_called_with_stageApi", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service } = await createHarness({
      globalState: { meta: { runId: "run-1" } },
      kernel: { id: "k1" },
    });

    const overrideBus = { emit: vi.fn() };
    await service.run("input", {
      stageApi: { eventBus: overrideBus, helper: true },
    });

    expect(agentLoopMock.instances[0].run).toHaveBeenCalledWith("input", {
      stageApi: { eventBus: overrideBus, helper: true },
      runContext: { runId: "run-1", kernel: { id: "k1" } },
    });
  });

  it("should_ignore_null_runContext_and_stageApi_when_run_called_with_null_overrides", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, ctx } = await createHarness({
      globalState: { meta: { runId: "run-123" } },
      kernel: { id: "k1" },
    });

    await service.run("input", { runContext: null, stageApi: null });

    expect(agentLoopMock.instances[0].run).toHaveBeenCalledWith("input", {
      stageApi: { eventBus: ctx.events },
      runContext: { runId: "run-123", kernel: ctx._kernel },
    });
  });

  it("should_set_status_running_when_agent_run_pending", async () => {
    const deferred = createDeferred();
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, state } = await createHarness();
    // Warm up: ensure AgentLoop is loaded/cached so this test only observes run-state transitions.
    await service.run("warmup");

    agentLoopMock.state.runImpl = vi.fn(() => deferred.promise);

    const promise = service.run("input");
    await Promise.resolve();

    expect(state.localStore.status).toBe("running");

    deferred.resolve({ output: [] });
    await promise;
  });

  it("should_set_status_completed_when_run_succeeds", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, state } = await createHarness();

    await service.run("input");

    expect(state.localStore.status).toBe("completed");
  });

  it("should_set_startedAt_when_run_succeeds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(111);
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, state } = await createHarness();

    await service.run("input");

    expect(state.localStore.startedAt).toBe(111);
  });

  it("should_set_completedAt_when_run_succeeds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(222);
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, state } = await createHarness();

    await service.run("input");

    expect(state.localStore.completedAt).toBe(222);
  });

  it("should_store_outputCount_when_run_returns_output_array", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: ["a", "b"] }));

    const { service, state } = await createHarness();

    await service.run("input");

    expect(state.localStore.result).toEqual({ success: true, outputCount: 2 });
  });

  it("should_store_outputCount_zero_when_run_returns_missing_output", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ missing: true }));

    const { service, state } = await createHarness();

    await service.run("input");

    expect(state.localStore.result).toEqual({ success: true, outputCount: 0 });
  });

  it("should_emit_deepsearch_complete_when_run_succeeds", async () => {
    const result = { output: ["x"] };
    agentLoopMock.state.runImpl = vi.fn(async () => result);

    const { service, events } = await createHarness();

    await service.run("input");

    expect(events.emit).toHaveBeenCalledWith("deepsearch:complete", { result });
  });

  it("should_return_result_when_run_succeeds", async () => {
    const result = { output: ["x"] };
    agentLoopMock.state.runImpl = vi.fn(async () => result);

    const { service } = await createHarness();

    const out = await service.run("input");

    expect(out).toEqual(result);
  });

  it("should_throw_when_agent_run_throws", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => {
      throw new Error("boom");
    });

    const { service } = await createHarness();

    await expect(service.run("input")).rejects.toThrow("boom");
  });

  it("should_set_status_failed_when_agent_run_throws", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => {
      throw new Error("boom");
    });

    const { service, state } = await createHarness();

    await service.run("input").catch(() => {});

    expect(state.localStore.status).toBe("failed");
  });

  it("should_set_error_message_when_agent_run_throws", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => {
      throw new Error("boom");
    });

    const { service, state } = await createHarness();

    await service.run("input").catch(() => {});

    expect(state.localStore.error).toBe("boom");
  });

  it("should_emit_deepsearch_error_when_agent_run_throws", async () => {
    const error = new Error("boom");
    agentLoopMock.state.runImpl = vi.fn(async () => {
      throw error;
    });

    const { service, events } = await createHarness();

    await service.run("input").catch(() => {});

    expect(events.emit).toHaveBeenCalledWith("deepsearch:error", { error });
  });

  it("should_throw_when_agent_loop_import_fails", async () => {
    agentLoopImportState.failNextImport = true;

    const { service } = await createHarness();

    await expect(service.run("input")).rejects.toThrow();
  });

  it("should_allow_retry_when_agent_loop_import_fails_once", async () => {
    agentLoopImportState.failNextImport = true;
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service } = await createHarness();

    await service.run("first").catch(() => {});
    await service.run("second");

    expect(agentLoopImportState.importAttempts).toBe(2);
  });

  it("should_cache_agent_loop_when_run_called_twice", async () => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service } = await createHarness();

    await service.run("first");
    await service.run("second");

    expect(agentLoopImportState.importAttempts).toBe(1);
  });

  it.each([
    { testName: "should_fallback_to_ctx_mode_when_options_mode_empty_string", options: { mode: "" } },
    { testName: "should_use_whitespace_mode_when_options_mode_whitespace", options: { mode: "   " } },
    { testName: "should_fallback_to_ctx_maxIterations_when_options_maxIterations_zero", options: { maxIterations: 0 } },
    { testName: "should_use_negative_maxIterations_when_options_maxIterations_negative", options: { maxIterations: -1 } },
    {
      testName: "should_use_MAX_SAFE_INTEGER_when_options_maxIterations_MAX_SAFE_INTEGER",
      options: { maxIterations: Number.MAX_SAFE_INTEGER },
    },
    { testName: "should_accept_string_when_options_maxIterations_string", options: { maxIterations: "7" } },
  ])("$testName", async ({ options }) => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service, ctx } = await createHarness({
      config: { mode: "config-mode", maxIterations: 5 },
    });

    await service.run("input", options);

    expect(agentLoopMock.instances[0].options).toEqual({
      eventBus: ctx.events,
      mode: options.mode || "config-mode",
      maxIterations: options.maxIterations || 5,
    });
  });

  it.each([
    { testName: "should_accept_null_input_when_run_called_with_null", input: null },
    { testName: "should_accept_undefined_input_when_run_called_with_undefined", input: undefined },
    { testName: "should_accept_empty_string_input_when_run_called_with_empty_string", input: "" },
    { testName: "should_accept_empty_array_input_when_run_called_with_empty_array", input: [] },
    { testName: "should_accept_empty_object_input_when_run_called_with_empty_object", input: {} },
    { testName: "should_accept_large_string_input_when_run_called_with_large_string", input: buildLargeString(100000) },
    { testName: "should_accept_deep_nested_input_when_run_called_with_deep_nested_object", input: buildDeepNested(32) },
  ])("$testName", async ({ input }) => {
    agentLoopMock.state.runImpl = vi.fn(async () => ({ output: [] }));

    const { service } = await createHarness();

    await service.run(input);

    expect(agentLoopMock.instances[0].run.mock.calls[0][0]).toBe(input);
  });

  it("should_create_two_agents_when_run_called_concurrently", async () => {
    const first = createDeferred();
    const second = createDeferred();
    const queue = [first, second];
    agentLoopMock.state.runImpl = vi.fn(() => queue.shift().promise);

    const { service } = await createHarness();

    const p1 = service.run("alpha");
    const p2 = service.run("beta");

    first.resolve({ output: [] });
    second.resolve({ output: [] });
    await Promise.all([p1, p2]);

    expect(agentLoopMock.instances).toHaveLength(2);
  });
});