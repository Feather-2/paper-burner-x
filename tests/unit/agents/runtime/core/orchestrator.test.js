import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const createStageApi = vi.fn((args) => ({ ...args }));
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const createLogger = vi.fn(() => logger);

  class DisposableBase {
    constructor() {
      this.disposed = false;
      this._disposables = [];
    }

    _registerDisposable(cleanup) {
      if (this.disposed) return;
      if (typeof cleanup === "function") {
        this._disposables.push(cleanup);
      } else if (cleanup && typeof cleanup.dispose === "function") {
        this._disposables.push(() => cleanup.dispose());
      }
    }

    async dispose() {
      if (this.disposed) return;
      this.disposed = true;
      await this._onDispose();
      for (let i = this._disposables.length - 1; i >= 0; i -= 1) {
        await this._disposables[i]();
      }
      this._disposables.length = 0;
    }

    _onDispose() {}

    _ensureNotDisposed() {
      if (this.disposed) {
        throw new Error(`${this.constructor.name} has been disposed`);
      }
    }
  }

  const isPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const toNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };

  return {
    createStageApi,
    createLogger,
    logger,
    DisposableBase,
    isPlainObject,
    toNonEmptyString,
  };
});

const eventBusMocks = vi.hoisted(() => {
  class EventBus {
    constructor(options = {}) {
      this.runId = options.runId || null;
      this.emit = vi.fn();
      this.enableBackpressure = vi.fn();
      this.dispose = vi.fn();
    }
  }
  return { EventBus };
});

const hooksMocks = vi.hoisted(() => ({
  enhanceEventBusWithHooks: vi.fn(),
}));

const configMocks = vi.hoisted(() => ({
  CommonSchemas: {
    positiveInt: { type: "number" },
    ratio: { type: "number" },
    nonNegativeInt: { type: "number" },
  },
  validateConfig: vi.fn((config) => ({ valid: true, errors: [], config })),
}));

const defaultsMocks = vi.hoisted(() => ({
  ServiceId: { DEGRADATION_MATRIX: "degradationMatrix" },
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createStageApi: sharedMocks.createStageApi,
  createLogger: sharedMocks.createLogger,
  DisposableBase: sharedMocks.DisposableBase,
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
}));

vi.mock("../../../../../js/agents/core/event-bus.js", () => ({
  EventBus: eventBusMocks.EventBus,
}));

vi.mock("../../../../../js/agents/runtime/hooks/event-bus-hooks.js", () => ({
  enhanceEventBusWithHooks: hooksMocks.enhanceEventBusWithHooks,
}));

vi.mock("../../../../../js/agents/runtime/core/config-validator.js", () => ({
  CommonSchemas: configMocks.CommonSchemas,
  validateConfig: configMocks.validateConfig,
}));

vi.mock("../../../../../js/agents/core/di/defaults.js", () => ({
  ServiceId: defaultsMocks.ServiceId,
}));

async function loadOrchestratorModule() {
  return await import("../../../../../js/agents/runtime/core/orchestrator.js");
}

async function loadConstantsModule() {
  return await import("../../../../../js/agents/runtime/core/constants.js");
}

let AgentOrchestrator;
let SchedulingMode;
let ActorType;
let OrchestratorState;

const getEmitRecord = (bus, name) => bus.emit.mock.calls.find((call) => call[0] === name)?.[1];
const getEmitNames = (bus) => bus.emit.mock.calls.map((call) => call[0]);
const nextTick = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCondition = async (predicate, attempts = 5) => {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return true;
    await nextTick();
  }
  return predicate();
};

const buildDeepObject = (depth) => {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i++) {
    node.next = { index: i };
    node = node.next;
  }
  return root;
};

const createMatrix = (overrides = {}) => ({
  currentLevel: "normal",
  recordRequest: vi.fn(),
  getStatus: vi.fn(() => ({ level: "normal" })),
  getRecommendations: vi.fn(() => []),
  getEnabledFeatures: vi.fn(() => []),
  isFeatureEnabled: vi.fn(() => true),
  ...overrides,
});

beforeEach(async () => {
  vi.clearAllMocks();
  ({ AgentOrchestrator, SchedulingMode } = await loadOrchestratorModule());
  ({ ActorType, OrchestratorState } = await loadConstantsModule());
  configMocks.validateConfig.mockImplementation((config) => ({ valid: true, errors: [], config }));
});

describe("SchedulingMode", () => {
  it("exposes sequential and parallel values", () => {
    expect(SchedulingMode.SEQUENTIAL).toBe("sequential");
    expect(SchedulingMode.PARALLEL).toBe("parallel");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(SchedulingMode)).toBe(true);
  });
});

describe("AgentOrchestrator", () => {
  let orchestrator = null;

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.dispose();
    }
    orchestrator = null;
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("builds defaults and initializes event bus", () => {
      orchestrator = new AgentOrchestrator({
        runId: "   ",
        mode: "",
        scenario: null,
        constraints: undefined,
        services: { eventBusBackpressure: { maxQueueSize: 1 } },
      });

      expect(orchestrator.runId).toMatch(/^run_/);
      expect(orchestrator.runContext.mode).toBe("deepsearch");
      expect(orchestrator.runContext.scenario).toBe("business");
      expect(orchestrator.runContext.constraints).toEqual({});
      expect(orchestrator.eventBus).toBeInstanceOf(eventBusMocks.EventBus);
      expect(hooksMocks.enhanceEventBusWithHooks).toHaveBeenCalledWith(orchestrator.eventBus);
      expect(orchestrator.eventBus.enableBackpressure).toHaveBeenCalledWith(
        expect.objectContaining({ maxQueueSize: 1, deferNonCoalesced: false })
      );
    });

    it("skips backpressure when disabled", () => {
      orchestrator = new AgentOrchestrator({
        services: { eventBusBackpressure: false },
      });
      expect(orchestrator.eventBus.enableBackpressure).not.toHaveBeenCalled();
    });

    it("normalizes scheduling maxConcurrency boundaries", async () => {
      const orchZero = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: 0 },
      });
      const orchNeg = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: -1 },
      });
      const orchStr = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: "4" },
      });
      const orchMax = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: Number.MAX_SAFE_INTEGER },
      });

      expect(orchZero._maxConcurrency).toBe(3);
      expect(orchNeg._maxConcurrency).toBe(3);
      expect(orchStr._maxConcurrency).toBe(4);
      expect(orchMax._maxConcurrency).toBe(Number.MAX_SAFE_INTEGER);

      await Promise.all([orchZero.dispose(), orchNeg.dispose(), orchStr.dispose(), orchMax.dispose()]);
    });
  });

  describe("registerStage", () => {
    it("rejects invalid names and handlers", () => {
      orchestrator = new AgentOrchestrator();
      const badNames = [null, undefined, "", "   "];
      for (const name of badNames) {
        expect(() => orchestrator.registerStage(name, () => {})).toThrow(/name must be a non-empty string/);
      }
      expect(() => orchestrator.registerStage("ok", "not-a-function")).toThrow(/handler must be a function/);
    });

    it("stores normalized options and actor validation", () => {
      orchestrator = new AgentOrchestrator();
      orchestrator.registerStage("design.step", () => "ok", {
        actor: "design",
        timeoutMs: "25.9",
        configSchema: { foo: { type: "string" } },
        configValidation: { strict: true },
      });
      orchestrator.registerStage("unknown.step", () => "ok", { actor: "invalid", timeoutMs: -1 });

      const entry = orchestrator._stages.get("design.step");
      const invalidEntry = orchestrator._stages.get("unknown.step");

      expect(entry.options.actor).toBe("design");
      expect(entry.options.timeoutMs).toBe(25);
      expect(entry.options.configSchema).toEqual({ foo: { type: "string" } });
      expect(entry.options.configValidation).toEqual({ strict: true });
      expect(invalidEntry.options.actor).toBeUndefined();
      expect(invalidEntry.options.timeoutMs).toBeNull();
    });
  });

  describe("runStage", () => {
    it("runs a stage, emits events, and passes progress", async () => {
      orchestrator = new AgentOrchestrator();
      const handler = vi.fn((ctx, input, api) => {
        api.progress({ step: 1 });
        return { ctx, input, signal: api.signal };
      });
      orchestrator.registerStage("design.step", handler);

      const result = await orchestrator.runStage("design.step", { value: 42 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result.ctx.runId).toBe(orchestrator.runId);
      expect(result.input).toEqual({ value: 42 });
      expect(sharedMocks.createStageApi).toHaveBeenCalled();

      const names = getEmitNames(orchestrator.eventBus);
      expect(names).toContain("run.started");
      expect(names).toContain("design.step.started");
      expect(names).toContain("design.step.progress");
      expect(names).toContain("design.step.completed");

      const progress = getEmitRecord(orchestrator.eventBus, "design.step.progress");
      expect(progress.actor).toBe(ActorType.DESIGN);
    });

    it("rejects invalid or unknown stage names", async () => {
      orchestrator = new AgentOrchestrator();
      const badNames = [null, undefined, "", "   "];
      for (const name of badNames) {
        await expect(orchestrator.runStage(name)).rejects.toThrow(/stageName must be a non-empty string/);
      }
      await expect(orchestrator.runStage("missing.stage")).rejects.toThrow(/Stage not registered: missing\.stage/);
    });

    it("marks run as failed when a stage throws", async () => {
      orchestrator = new AgentOrchestrator();
      orchestrator.registerStage("boom", () => {
        throw new Error("boom");
      });

      await expect(orchestrator.runStage("boom")).rejects.toThrow(/boom/);
      expect(orchestrator.state).toBe(OrchestratorState.FAILED);
      expect(getEmitNames(orchestrator.eventBus)).toContain("run.failed");
      expect(getEmitNames(orchestrator.eventBus)).toContain("run.ended");
    });

    it("runs sequentially with rapid consecutive calls", async () => {
      orchestrator = new AgentOrchestrator();
      const order = [];

      orchestrator.registerStage("a", async () => {
        order.push("a");
        await delay(10);
      });
      orchestrator.registerStage("b", async () => {
        order.push("b");
      });

      const p1 = orchestrator.runStage("a");
      const p2 = orchestrator.runStage("b");
      await Promise.all([p1, p2]);
      expect(order).toEqual(["a", "b"]);
    });

    it("respects parallel concurrency limits", async () => {
      orchestrator = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: 2 },
      });
      let inFlight = 0;
      let maxInFlight = 0;

      orchestrator.registerStage("task", async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(10);
        inFlight -= 1;
      });

      const p1 = orchestrator.runStage("task");
      const p2 = orchestrator.runStage("task");
      const p3 = orchestrator.runStage("task");
      await Promise.all([p1, p2, p3]);
      expect(maxInFlight).toBe(2);
    });
  });

  describe("runStagesParallel", () => {
    it("returns empty map for non-array or empty input", async () => {
      orchestrator = new AgentOrchestrator();
      const cases = [null, undefined, {}, []];
      for (const input of cases) {
        const result = await orchestrator.runStagesParallel(input);
        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
      }
    });

    it("collects success and failure results", async () => {
      orchestrator = new AgentOrchestrator();
      orchestrator.registerStage("ok", () => "ok");
      orchestrator.registerStage("fail", () => {
        throw new Error("boom");
      });

      const results = await orchestrator.runStagesParallel([{ name: "ok" }, { name: "fail" }]);
      expect(results.get("ok")).toEqual({ success: true, result: "ok" });
      expect(results.get("fail").success).toBe(false);
      expect(results.get("fail").error).toContain("boom");
    });

    it("limits parallelism when degradation matrix disables parallelRequests", async () => {
      const matrix = createMatrix({ isFeatureEnabled: vi.fn(() => false) });
      orchestrator = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: 5 },
        degradationMatrix: matrix,
      });

      let inFlight = 0;
      let maxInFlight = 0;
      const resolvers = [];
      const handler = async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => resolvers.push(resolve));
        inFlight -= 1;
      };

      orchestrator.registerStage("t1", handler);
      orchestrator.registerStage("t2", handler);
      orchestrator.registerStage("t3", handler);

      const resultPromise = orchestrator.runStagesParallel([{ name: "t1" }, { name: "t2" }, { name: "t3" }]);
      await waitForCondition(() => maxInFlight > 0);

      expect(maxInFlight).toBe(1);

      resolvers.shift()();
      await waitForCondition(() => resolvers.length > 0);
      resolvers.shift()();
      await waitForCondition(() => resolvers.length > 0);
      resolvers.shift()();

      const results = await resultPromise;
      expect(results.size).toBe(3);
    });
  });

  describe("runStagesGraph", () => {
    it("skips dependent stages when dependencies fail with continueOnError", async () => {
      orchestrator = new AgentOrchestrator();
      orchestrator.registerStage("a", () => {
        throw new Error("boom");
      });
      orchestrator.registerStage("b", () => "ok");

      const results = await orchestrator.runStagesGraph(
        [
          { name: "a" },
          { name: "b", dependsOn: ["a"] },
        ],
        { continueOnError: true }
      );

      expect(results.get("a").success).toBe(false);
      expect(results.get("b").skipped).toBe(true);
      expect(results.get("b").error).toContain("dependency_failed:a");
    });

    it("throws when a stage fails and continueOnError is false", async () => {
      orchestrator = new AgentOrchestrator();
      orchestrator.registerStage("fail", () => {
        throw new Error("nope");
      });

      await expect(orchestrator.runStagesGraph([{ name: "fail" }])).rejects.toThrow(/Stage failed: fail/);
    });
  });

  describe("config validation", () => {
    it("emits config.invalid and continues in non-strict mode", async () => {
      orchestrator = new AgentOrchestrator({ configValidation: { coerce: true } });
      configMocks.validateConfig.mockReturnValueOnce({
        valid: false,
        errors: [{ path: "userConfig.mode", message: "bad" }],
        config: { mode: "fixed" },
      });

      const handler = vi.fn((ctx, input) => input.userConfig.mode);
      orchestrator.registerStage("design.cfg", handler);

      const result = await orchestrator.runStage("design.cfg", { userConfig: { mode: "bad" } });
      expect(result).toBe("fixed");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(configMocks.validateConfig).toHaveBeenCalledWith(
        { mode: "bad" },
        expect.any(Object),
        { strict: false, coerce: true }
      );

      const invalidEvent = getEmitRecord(orchestrator.eventBus, "design.cfg.config.invalid");
      expect(invalidEvent.payload.errors).toHaveLength(1);
      expect(sharedMocks.createStageApi).toHaveBeenCalledWith(
        expect.objectContaining({
          configValidation: { userConfig: { valid: false, errors: expect.any(Array) } },
        })
      );
    });

    it("throws ConfigValidationError in strict mode", async () => {
      orchestrator = new AgentOrchestrator();
      configMocks.validateConfig.mockReturnValueOnce({
        valid: false,
        errors: [{ path: "root", message: "bad" }],
        config: {},
      });

      const handler = vi.fn();
      orchestrator.registerStage("design.strict", handler);

      await expect(
        orchestrator.runStage("design.strict", { userConfig: { strictValidation: true } })
      ).rejects.toMatchObject({ name: "ConfigValidationError" });

      expect(handler).not.toHaveBeenCalled();
      expect(getEmitRecord(orchestrator.eventBus, "design.strict.config.invalid")).toBeTruthy();
    });
  });

  describe("lifecycle", () => {
    it("handles stop and end transitions", async () => {
      const orchCancel = new AgentOrchestrator();
      orchCancel.registerStage("test", () => "ok");
      orchCancel.start();
      orchCancel.stop("   ");

      expect(orchCancel.state).toBe(OrchestratorState.CANCELLED);
      expect(getEmitRecord(orchCancel.eventBus, "run.cancelled").payload.reason).toBe("cancelled");
      await expect(orchCancel.runStage("test")).rejects.toThrow(/Run cancelled/);

      const orchFail = new AgentOrchestrator();
      orchFail.start();
      orchFail.stop("stage_failed");
      expect(orchFail.state).toBe(OrchestratorState.FAILED);
      expect(getEmitRecord(orchFail.eventBus, "run.failed").payload.error).toBe("stage_failed");

      const orchIdleEnd = new AgentOrchestrator();
      orchIdleEnd.end("done");
      expect(orchIdleEnd.state).toBe(OrchestratorState.ENDED);
      expect(getEmitNames(orchIdleEnd.eventBus).length).toBe(0);

      const orchRunEnd = new AgentOrchestrator();
      orchRunEnd.start();
      orchRunEnd.end("done");
      const names = getEmitNames(orchRunEnd.eventBus);
      expect(names).toContain("run.completed");
      expect(names).toContain("run.ended");

      await Promise.all([orchCancel.dispose(), orchFail.dispose(), orchIdleEnd.dispose(), orchRunEnd.dispose()]);
    });
  });

  describe("agents and disposal", () => {
    it("registers child agents and disposes them", async () => {
      const agent1 = { dispose: vi.fn() };
      const agent2 = { dispose: vi.fn() };
      const agentInvalid = {};

      const orch = new AgentOrchestrator({
        services: { agents: new Map([["a", agent1], ["b", agent2], ["c", agentInvalid]]) },
      });

      expect(orch._childAgents.has(agent1)).toBe(true);
      expect(orch._childAgents.has(agent2)).toBe(true);
      expect(orch._childAgents.size).toBe(2);

      orch.registerAgent(agentInvalid);
      expect(orch._childAgents.size).toBe(2);

      await orch.dispose();
      expect(agent1.dispose).toHaveBeenCalledTimes(1);
      expect(agent2.dispose).toHaveBeenCalledTimes(1);
    });

    it("rejects waiting parallel calls on dispose", async () => {
      orchestrator = new AgentOrchestrator({
        scheduling: { mode: SchedulingMode.PARALLEL, maxConcurrency: 1 },
      });

      let release = null;
      orchestrator.registerStage("block", async () => {
        await new Promise((resolve) => {
          release = resolve;
        });
      });

      const p1 = orchestrator.runStage("block");
      const p2 = orchestrator.runStage("block");
      await waitForCondition(() => release !== null);

      await orchestrator.dispose();
      if (release) release();
      const [p1Result, p2Result] = await Promise.allSettled([p1, p2]);
      expect(p2Result.status).toBe("rejected");
      expect(String(p2Result.reason)).toMatch(/disposed|cancelled/);
      expect(["fulfilled", "rejected"]).toContain(p1Result.status);
    });
  });

  describe("services and resources", () => {
    it("resolves degradation matrix from container", async () => {
      const matrix = createMatrix();
      const container = { get: vi.fn(), tryGet: vi.fn(() => matrix) };
      orchestrator = new AgentOrchestrator({ services: { container } });

      orchestrator.registerStage("design.container", () => "ok");
      await orchestrator.runStage("design.container", {});

      expect(container.tryGet).toHaveBeenCalledWith(defaultsMocks.ServiceId.DEGRADATION_MATRIX);
    });

    it("handles large inputs and deep nesting", async () => {
      orchestrator = new AgentOrchestrator();
      const bigText = "x".repeat(100000);
      const deep = buildDeepObject(50);

      orchestrator.registerStage("design.large", (ctx, input) => ({
        size: input.file.length,
        nested: input.nested,
        list: input.list,
      }));

      const result = await orchestrator.runStage("design.large", { file: bigText, nested: deep, list: [] });
      expect(result.size).toBe(bigText.length);
      expect(result.nested).toBe(deep);
      expect(result.list).toEqual([]);
    });
  });
});
