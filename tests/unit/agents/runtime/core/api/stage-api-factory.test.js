/**
 * @vitest-environment node
 * @vitest-pool forks
 * @vitest-no-parallel
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  STAGE_API_FACTORY_PATH,
  SHARED_INDEX_PATH,
  FS_ADAPTER_PATH,
  VFS_GLOB_PATH,
  TELEMETRY_PATH,
  RETRY_STRATEGY_PATH,
  ERROR_BOUNDARY_PATH,
  TOOL_QUOTAS_PATH,
  MESSAGE_BUS_PATH,
} = vi.hoisted(() => ({
  STAGE_API_FACTORY_PATH: `/@fs${new URL(
    "../../../../../../js/agents/runtime/core/api/stage-api-factory.js",
    import.meta.url,
  ).pathname}`,
  SHARED_INDEX_PATH: `/@fs${new URL("../../../../../../js/agents/shared/index.js", import.meta.url).pathname}`,
  FS_ADAPTER_PATH: `/@fs${new URL("../../../../../../js/agents/vfs/fs-adapter.js", import.meta.url).pathname}`,
  VFS_GLOB_PATH: `/@fs${new URL("../../../../../../js/agents/vfs/glob.js", import.meta.url).pathname}`,
  TELEMETRY_PATH: `/@fs${new URL(
    "../../../../../../js/agents/plugins/telemetry/index.js",
    import.meta.url,
  ).pathname}`,
  RETRY_STRATEGY_PATH: `/@fs${new URL(
    "../../../../../../js/agents/shared/retry-strategy.js",
    import.meta.url,
  ).pathname}`,
  ERROR_BOUNDARY_PATH: `/@fs${new URL(
    "../../../../../../js/agents/runtime/core/error-boundary.js",
    import.meta.url,
  ).pathname}`,
  TOOL_QUOTAS_PATH: `/@fs${new URL(
    "../../../../../../js/agents/runtime/tools/tool-quotas.js",
    import.meta.url,
  ).pathname}`,
  MESSAGE_BUS_PATH: `/@fs${new URL("../../../../../../js/agents/core/message-bus.js", import.meta.url).pathname}`,
}));

vi.mock(SHARED_INDEX_PATH, () => {
  const createStageApi = vi.fn();
  const createLogger = vi.fn(() => ({ debug: vi.fn(), warn: vi.fn() }));
  const isPlainObject = vi.fn(
    (value) =>
      value !== null &&
      typeof value === "object" &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null),
  );
  const toNonNegativeInt = vi.fn((value) => {
    const num = typeof value === "string" ? Number(value) : Number(value);
    if (!Number.isFinite(num)) return 0;
    const int = Math.trunc(num);
    return int < 0 ? 0 : int;
  });

  const CircuitBreakerRegistry = class {
    constructor() {}
    get = vi.fn(() => null)
  };

  return {
    createStageApi,
    createLogger,
    isPlainObject,
    toNonNegativeInt,
    CircuitBreakerRegistry,
  };
});

vi.mock(FS_ADAPTER_PATH, () => ({
  createFsAdapterFromVfs: vi.fn((vfs) => ({ __fsAdapter: true, vfs })),
}));

vi.mock(VFS_GLOB_PATH, () => ({
  createVfsGlobFn: vi.fn((vfs) => vi.fn(async () => ({ __globbed: true, vfs }))),
}));

vi.mock(TELEMETRY_PATH, () => ({
  getGlobalTokenTracker: vi.fn(() => ({ record: vi.fn() })),
  TraceContext: class {
    constructor() {}
    startSpan = vi.fn(() => ({}))
    endSpan = vi.fn()
    withSpan = vi.fn((_name, fn) => fn())
    getTraceparent = vi.fn(() => "")
    static mockClear = vi.fn()
    static parseTraceparent = vi.fn(() => null)
  },
}));

vi.mock(RETRY_STRATEGY_PATH, () => ({
  withRetry: vi.fn((...args) => args.find((a) => typeof a === "function")),
}));

vi.mock(ERROR_BOUNDARY_PATH, () => ({
  getErrorBoundary: vi.fn(() => ({ wrap: (fn) => fn })),
}));

vi.mock(TOOL_QUOTAS_PATH, () => ({
  ToolQuotaManager: class {
    constructor() {}
    tryCall = vi.fn(async (_toolName, fn) => fn())
  },
}));

vi.mock(MESSAGE_BUS_PATH, () => ({
  MessageBus: vi.fn(() => ({
    request: vi.fn(async () => ({})),
    handle: vi.fn(),
  })),
}));

const ENTRY_PATTERNS = [
  { id: "stage_services", call: (fn, stage, services) => fn(stage, services) },
  { id: "services_stage", call: (fn, stage, services) => fn(services, stage) },
  {
    id: "options_stageName",
    call: (fn, stage, services) =>
      fn(Object.assign({}, services, { stageName: stage })),
  },
  {
    id: "options_type",
    call: (fn, stage, services) => fn(Object.assign({}, services, { type: stage })),
  },
  {
    id: "options_stage",
    call: (fn, stage, services) => fn(Object.assign({}, services, { stage })),
  },
  {
    id: "services_only",
    call: (fn, stage, services) =>
      fn(Object.assign({}, services, { stageName: stage, type: stage, stage })),
  },
  { id: "no_args", call: (fn) => fn() },
];

const SECOND_PATTERNS = [
  { id: "stage_only", call: (fn, stage) => fn(stage) },
  { id: "stage_services", call: (fn, stage, services) => fn(stage, services) },
  { id: "services_stage", call: (fn, stage, services) => fn(services, stage) },
  {
    id: "options_stageName",
    call: (fn, stage, services) =>
      fn(Object.assign({}, services, { stageName: stage })),
  },
  {
    id: "services_only",
    call: (fn, stage, services) =>
      fn(Object.assign({}, services, { stageName: stage, type: stage, stage })),
  },
];

const OBJECT_METHOD_CANDIDATES = [
  "createStageApi",
  "create",
  "forStage",
  "get",
  "build",
  "make",
];

function deepNestedObject(depth) {
  let root = {};
  let current = root;
  for (let i = 0; i < depth; i += 1) {
    current.next = {};
    current = current.next;
  }
  current.value = "leaf";
  return root;
}

function makeEventBus(overrides = {}) {
  const eventBus = {
    emit: vi.fn(),
    enableBackpressure: vi.fn(),
    _backpressure: {},
    ...overrides,
  };
  return eventBus;
}

function makeAiApiService(overrides = {}) {
  return {
    chat: vi.fn(async () => ({})),
    circuitBreakerRegistry: { get: vi.fn(() => null) },
    ...overrides,
  };
}

function makeServices(overrides = {}) {
  const controller = new AbortController();
  const eventBus = makeEventBus();
  return {
    signal: controller.signal,
    eventBus,
    emit: vi.fn(),
    aiApiService: makeAiApiService(),
    container: {
      get: vi.fn(),
      tryGet: vi.fn(),
    },
    retryStrategy: {
      execute: vi.fn(async (fn) => fn()),
    },
    errorBoundary: {
      wrap: (fn) => fn,
    },
    toolQuotaManager: {
      tryCall: vi.fn(async (_tool, fn) => fn()),
    },
    messageBus: {
      request: vi.fn(async () => ({})),
      handle: vi.fn(),
    },
    vfs: { files: Object.create(null) },
    traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    ...overrides,
  };
}

async function toSettled(promiseOrValue) {
  try {
    const value = await promiseOrValue;
    return { status: "fulfilled", value };
  } catch (err) {
    return { status: "rejected", reason: err };
  }
}

function pickMainFactoryExportName(functionExportNames) {
  if (functionExportNames.includes("createStageApiFactory")) return "createStageApiFactory";
  const byName = functionExportNames.find((name) =>
    /stage.*api.*factory/i.test(name),
  );
  if (byName) return byName;
  const byCreate = functionExportNames.find((name) => /create.*stage.*api/i.test(name));
  if (byCreate) return byCreate;
  return functionExportNames[0] ?? null;
}

async function inferInvoker(factoryFn, createStageApiMock) {
  const stageName = "deepsearch";
  const baseServices = makeServices({
    emit: undefined,
    eventBusBackpressure: undefined,
    backpressure: undefined,
  });

  const errors = [];

  for (const entry of ENTRY_PATTERNS) {
    createStageApiMock.mockClear();

    const first = await toSettled(entry.call(factoryFn, stageName, baseServices));
    if (createStageApiMock.mock.calls.length > 0) {
      return {
        kind: "direct",
        entry: entry.id,
        invoke: (stage, services) => entry.call(factoryFn, stage, services),
      };
    }

    if (first.status === "rejected") {
      errors.push({ phase: "entry", pattern: entry.id, error: String(first.reason) });
      continue;
    }

    const intermediate = first.value;

    if (typeof intermediate === "function") {
      for (const second of SECOND_PATTERNS) {
        createStageApiMock.mockClear();
        const secondResult = await toSettled(
          second.call(intermediate, stageName, baseServices),
        );
        if (createStageApiMock.mock.calls.length > 0) {
          return {
            kind: "two_step_fn",
            entry: entry.id,
            second: second.id,
            invoke: (stage, services) => {
              const next = entry.call(factoryFn, stage, services);
              return Promise.resolve(next).then((val) => second.call(val, stage, services));
            },
          };
        }
        if (secondResult.status === "rejected") {
          errors.push({
            phase: "second_fn",
            entry: entry.id,
            second: second.id,
            error: String(secondResult.reason),
          });
        }
      }
    }

    if (intermediate && typeof intermediate === "object") {
      const methods = OBJECT_METHOD_CANDIDATES.filter(
        (name) => typeof intermediate[name] === "function",
      );

      for (const methodName of methods) {
        for (const second of SECOND_PATTERNS) {
          createStageApiMock.mockClear();
          const secondResult = await toSettled(
            second.call(intermediate[methodName].bind(intermediate), stageName, baseServices),
          );
          if (createStageApiMock.mock.calls.length > 0) {
            return {
              kind: "two_step_obj_method",
              entry: entry.id,
              method: methodName,
              second: second.id,
              invoke: (stage, services) => {
                const objOrPromise = entry.call(factoryFn, stage, services);
                return Promise.resolve(objOrPromise).then((obj) => {
                  const bound = obj[methodName].bind(obj);
                  return second.call(bound, stage, services);
                });
              },
            };
          }
          if (secondResult.status === "rejected") {
            errors.push({
              phase: "second_obj",
              entry: entry.id,
              method: methodName,
              second: second.id,
              error: String(secondResult.reason),
            });
          }
        }
      }
    }
  }

  const err = new Error(
    "Unable to infer how to invoke the StageApi factory export with mocked dependencies.",
  );
  err.cause = errors;
  throw err;
}

async function loadFactory(exportName) {
  vi.resetModules();

  const [mod, shared, fsAdapterMod, vfsGlobMod, telemetryMod, retryMod, errorBoundaryMod] =
    await Promise.all([
      import(STAGE_API_FACTORY_PATH),
      import(SHARED_INDEX_PATH),
      import(FS_ADAPTER_PATH),
      import(VFS_GLOB_PATH),
      import(TELEMETRY_PATH),
      import(RETRY_STRATEGY_PATH),
      import(ERROR_BOUNDARY_PATH),
    ]);

  const factory = mod[exportName];
  if (typeof factory !== "function") {
    throw new Error(`Expected export "${exportName}" to be a function.`);
  }

  shared.createStageApi.mockImplementation((opts) => ({ __stageApi: true, ...opts }));

  const invokerInfo = await inferInvoker(factory, shared.createStageApi);

  shared.createStageApi.mockClear();
  fsAdapterMod.createFsAdapterFromVfs.mockClear();
  vfsGlobMod.createVfsGlobFn.mockClear();
  telemetryMod.getGlobalTokenTracker.mockClear();
  telemetryMod.TraceContext.mockClear();
  retryMod.withRetry.mockClear();
  errorBoundaryMod.getErrorBoundary.mockClear();

  return {
    mod,
    shared,
    fsAdapterMod,
    vfsGlobMod,
    telemetryMod,
    retryMod,
    errorBoundaryMod,
    factory,
    invokerInfo,
    invoke: (stageName, services) => invokerInfo.invoke(stageName, services),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const discovered = await import(STAGE_API_FACTORY_PATH);
const functionExportNames = Object.entries(discovered)
  .filter(([, value]) => typeof value === "function")
  .map(([name]) => name);

const mainFactoryExportName = pickMainFactoryExportName(functionExportNames);

if (!mainFactoryExportName) {
  describe("stage-api-factory module", () => {
    it("exports at least one function", () => {
      expect(functionExportNames.length).toBeGreaterThan(0);
    });
  });
} else {
  for (const exportName of functionExportNames) {
    if (exportName !== mainFactoryExportName) {
      describe(exportName, () => {
        it("exports a callable function", async () => {
          vi.resetModules();
          const mod = await import(STAGE_API_FACTORY_PATH);
          expect(typeof mod[exportName]).toBe("function");
        });
      });
      continue;
    }

    describe(exportName, () => {
      it("initializes module logger on import", async () => {
        const { shared } = await loadFactory(exportName);
        expect(shared.createLogger).toHaveBeenCalledTimes(1);
        expect(shared.createLogger).toHaveBeenCalledWith("runtime/api/stage-api-factory");
      });

      it("creates a stage api (happy path) and wires emit/backpressure/vfs adapters", async () => {
        const { invoke, shared, fsAdapterMod, vfsGlobMod } = await loadFactory(exportName);

        const eventBus = makeEventBus({ _backpressure: { enabled: false } });
        const vfs = { files: { "big.txt": "x".repeat(500_000) } };

        const stageApi = await invoke(
          "deepsearch",
          makeServices({
            eventBus,
            emit: undefined,
            vfs,
            eventBusBackpressure: undefined,
          }),
        );

        expect(stageApi).toEqual(expect.objectContaining({ __stageApi: true }));
        expect(shared.createStageApi).toHaveBeenCalledTimes(1);

        const firstArg = shared.createStageApi.mock.calls[0]?.[0];
        expect(firstArg).toEqual(expect.any(Object));
        expect(typeof firstArg.emit).toBe("function");

        firstArg.emit("foo.progress", { step: 1 });
        expect(eventBus.emit).toHaveBeenCalledWith("foo.progress", { step: 1 });

        expect(eventBus.enableBackpressure).toHaveBeenCalledTimes(1);
        const [bpConfig] = eventBus.enableBackpressure.mock.calls[0];
        expect(bpConfig).toEqual(expect.any(Object));
        expect(bpConfig.maxQueueSize).toBe(10000);
        expect(bpConfig.deferNonCoalesced).toBe(false);
        expect(bpConfig.coalescePattern).toBeInstanceOf(RegExp);
        expect(bpConfig.coalescePattern.test("x.progress")).toBe(true);
        expect(bpConfig.coalescePattern.test("x.other")).toBe(false);

        expect(fsAdapterMod.createFsAdapterFromVfs).toHaveBeenCalledTimes(1);
        expect(fsAdapterMod.createFsAdapterFromVfs).toHaveBeenCalledWith(vfs);

        expect(vfsGlobMod.createVfsGlobFn).toHaveBeenCalledTimes(1);
        expect(vfsGlobMod.createVfsGlobFn).toHaveBeenCalledWith(vfs);
      });

      it("prefers explicit emit over eventBus.emit", async () => {
        const { invoke, shared } = await loadFactory(exportName);

        const eventBus = makeEventBus();
        const explicitEmit = vi.fn();

        await invoke(
          "deepsearch",
          makeServices({
            eventBus,
            emit: explicitEmit,
          }),
        );

        const firstArg = shared.createStageApi.mock.calls[0]?.[0];
        expect(firstArg).toEqual(expect.any(Object));
        expect(typeof firstArg.emit).toBe("function");

        firstArg.emit("evt", { ok: true });
        expect(explicitEmit).toHaveBeenCalledWith("evt", { ok: true });
        expect(eventBus.emit).not.toHaveBeenCalled();
      });

      it("accepts signal = null (explicit) but rejects missing signal", async () => {
        const { invoke } = await loadFactory(exportName);

        await expect(
          Promise.resolve().then(() =>
            invoke(
              "deepsearch",
              makeServices({
                signal: null,
              }),
            ),
          ),
        ).resolves.toBeDefined();

        const servicesMissingSignal = makeServices();
        delete servicesMissingSignal.signal;

        await expect(
          Promise.resolve().then(() => invoke("deepsearch", servicesMissingSignal)),
        ).rejects.toThrow();
      });

      it("enforces required fields: missing emit+eventBus rejects", async () => {
        const { invoke } = await loadFactory(exportName);

        const services = makeServices({
          emit: undefined,
          eventBus: undefined,
        });

        await expect(
          Promise.resolve().then(() => invoke("deepsearch", services)),
        ).rejects.toThrow();
      });

      it("enforces deepsearch/design requiring aiApiService, but can source from container", async () => {
        const { invoke } = await loadFactory(exportName);

        const servicesMissingAi = makeServices({ aiApiService: undefined });
        servicesMissingAi.container.tryGet.mockReturnValue(undefined);

        await expect(
          Promise.resolve().then(() => invoke("deepsearch", servicesMissingAi)),
        ).rejects.toThrow();

        const servicesFromContainer = makeServices({ aiApiService: undefined });
        const aiApiFromContainer = makeAiApiService();
        servicesFromContainer.container.tryGet.mockImplementation((key) => {
          if (key === "aiApiService") return aiApiFromContainer;
          return undefined;
        });

        await expect(
          Promise.resolve().then(() => invoke("deepsearch", servicesFromContainer)),
        ).resolves.toBeDefined();

        await expect(
          Promise.resolve().then(() => invoke("design", servicesFromContainer)),
        ).resolves.toBeDefined();
      });

      it("supports backpressure alias and can disable backpressure (false)", async () => {
        const { invoke } = await loadFactory(exportName);

        const eventBus1 = makeEventBus({ _backpressure: { enabled: false } });
        await invoke(
          "deepsearch",
          makeServices({
            eventBus: eventBus1,
            eventBusBackpressure: false,
          }),
        );
        expect(eventBus1.enableBackpressure).not.toHaveBeenCalled();

        const eventBus2 = makeEventBus({ _backpressure: { enabled: false } });
        await invoke(
          "deepsearch",
          makeServices({
            eventBus: eventBus2,
            backpressure: false,
          }),
        );
        expect(eventBus2.enableBackpressure).not.toHaveBeenCalled();
      });

      it("handles type boundaries for backpressure config (array) and numeric coercion", async () => {
        const { invoke, shared } = await loadFactory(exportName);

        const eventBus = makeEventBus({ _backpressure: { enabled: false } });

        shared.isPlainObject.mockReturnValueOnce(false);
        await invoke(
          "deepsearch",
          makeServices({
            eventBus,
            eventBusBackpressure: [],
          }),
        );

        expect(shared.isPlainObject).toHaveBeenCalled();
        expect(eventBus.enableBackpressure).toHaveBeenCalledTimes(1);

        eventBus.enableBackpressure.mockClear();
        shared.toNonNegativeInt.mockClear();

        const eventBus2 = makeEventBus({ _backpressure: { enabled: false } });
        shared.toNonNegativeInt.mockReturnValueOnce(0);

        await invoke(
          "deepsearch",
          makeServices({
            eventBus: eventBus2,
            eventBusBackpressure: { maxQueueSize: "-1" },
          }),
        );

        expect(shared.toNonNegativeInt).toHaveBeenCalledWith("-1");
        const [cfg] = eventBus2.enableBackpressure.mock.calls[0];
        expect(cfg.maxQueueSize).toBe(0);

        eventBus2.enableBackpressure.mockClear();
        shared.toNonNegativeInt.mockClear();

        const eventBus3 = makeEventBus({ _backpressure: { enabled: false } });
        shared.toNonNegativeInt.mockReturnValueOnce(Number.MAX_SAFE_INTEGER);

        await invoke(
          "deepsearch",
          makeServices({
            eventBus: eventBus3,
            eventBusBackpressure: { maxQueueSize: Number.MAX_SAFE_INTEGER },
          }),
        );

        expect(shared.toNonNegativeInt).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
        const [cfg3] = eventBus3.enableBackpressure.mock.calls[0];
        expect(cfg3.maxQueueSize).toBe(Number.MAX_SAFE_INTEGER);
      });

      it("propagates createStageApi errors", async () => {
        const { invoke, shared } = await loadFactory(exportName);

        shared.createStageApi.mockImplementationOnce(() => {
          throw new Error("boom");
        });

        await expect(
          Promise.resolve().then(() => invoke("deepsearch", makeServices())),
        ).rejects.toThrow("boom");
      });

      it("handles empty/whitespace stage name without relying on order", async () => {
        const { invoke, shared } = await loadFactory(exportName);

        await expect(
          Promise.resolve().then(() => invoke("", makeServices())),
        ).resolves.toBeDefined();
        await expect(
          Promise.resolve().then(() => invoke("   ", makeServices())),
        ).resolves.toBeDefined();

        expect(shared.createStageApi).toHaveBeenCalled();
      });

      it("supports concurrent and rapid successive creation (no shared-state coupling)", async () => {
        const { invoke, shared } = await loadFactory(exportName);

        const eventBusA = makeEventBus({ _backpressure: { enabled: false } });
        const eventBusB = makeEventBus({ _backpressure: { enabled: false } });

        const [a, b] = await Promise.all([
          invoke(
            "deepsearch",
            makeServices({
              eventBus: eventBusA,
              emit: undefined,
            }),
          ),
          invoke(
            "deepsearch",
            makeServices({
              eventBus: eventBusB,
              emit: undefined,
            }),
          ),
        ]);

        expect(a).toBeDefined();
        expect(b).toBeDefined();
        expect(shared.createStageApi).toHaveBeenCalledTimes(2);

        const rapid = [];
        for (let i = 0; i < 5; i += 1) {
          rapid.push(
            invoke(
              "deepsearch",
              makeServices({
                eventBus: makeEventBus({ _backpressure: { enabled: false } }),
                emit: undefined,
              }),
            ),
          );
        }
        await Promise.all(rapid);
        expect(shared.createStageApi.mock.calls.length).toBe(2 + 5);
      });

      it("accepts large strings and deep nested objects (resource boundaries)", async () => {
        const { invoke, shared } = await loadFactory(exportName);

        const longTrace = "t".repeat(100_000);
        const nested = deepNestedObject(200);

        await expect(
          Promise.resolve().then(() =>
            invoke(
              "deepsearch",
              makeServices({
                traceparent: longTrace,
                policy: nested,
                runtimeScheduler: nested,
              }),
            ),
          ),
        ).resolves.toBeDefined();

        expect(shared.createStageApi).toHaveBeenCalledTimes(1);
      });
    });
  }
}
