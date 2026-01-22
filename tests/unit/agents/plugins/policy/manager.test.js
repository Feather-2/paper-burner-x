import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const state = { idCounter: 0 };

  const defaultToNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };

  const mockLogger = { warn: vi.fn() };
  const createLogger = vi.fn(() => mockLogger);
  const toNonEmptyString = vi.fn(defaultToNonEmptyString);
  const isNodeLike = vi.fn(() => false);
  const makeSecureTimestampedId = vi.fn((prefix = "id") => `${prefix}_${++state.idCounter}`);

  return {
    state,
    mockLogger,
    createLogger,
    toNonEmptyString,
    isNodeLike,
    makeSecureTimestampedId,
    defaultToNonEmptyString,
  };
});

const artifactMocks = vi.hoisted(() => ({
  computeSha256: vi.fn(),
}));

const policyMocks = vi.hoisted(() => {
  const engineInstances = [];
  const storeInstances = [];

  class PolicyEngine {
    constructor(options) {
      this.options = options;
      this.setRules = vi.fn();
      this.getRules = vi.fn(() => []);
      this.evaluate = vi.fn(() => ({
        allowed: true,
        requiresApproval: false,
        reason: "default",
      }));
      engineInstances.push(this);
    }
  }

  class PolicyRuleStore {
    constructor() {
      this.load = vi.fn(() => []);
      this.save = vi.fn(() => true);
      this.clear = vi.fn(() => true);
      storeInstances.push(this);
    }
  }

  return { PolicyEngine, PolicyRuleStore, engineInstances, storeInstances };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: sharedMocks.createLogger,
  makeSecureTimestampedId: sharedMocks.makeSecureTimestampedId,
  isNodeLike: sharedMocks.isNodeLike,
  toNonEmptyString: sharedMocks.toNonEmptyString,
}));

vi.mock("../../../../../js/agents/storage/artifact-manager.js", () => ({
  computeSha256: artifactMocks.computeSha256,
}));

vi.mock("../../../../../js/agents/plugins/policy/engine.js", () => ({
  PolicyEngine: policyMocks.PolicyEngine,
}));

vi.mock("../../../../../js/agents/plugins/policy/store.js", () => ({
  PolicyRuleStore: policyMocks.PolicyRuleStore,
}));

import PolicyManager, {
  PolicyManager as NamedPolicyManager,
} from "../../../../../js/agents/plugins/policy/manager.js";

const createEventBus = () => {
  const handlers = new Map();
  const events = [];

  const emit = vi.fn((name, payload) => {
    events.push({ name, payload });
    const list = handlers.get(name);
    if (list) {
      list.slice().forEach((handler) => handler({ payload }));
    }
  });

  const subscribe = vi.fn((name, handler) => {
    const list = handlers.get(name) || [];
    list.push(handler);
    handlers.set(name, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  });

  return { emit, subscribe, events };
};

const createDeepObject = (depth) => {
  let obj = { value: "leaf" };
  for (let i = 0; i < depth; i += 1) {
    obj = { level: i, child: obj };
  }
  return obj;
};

const makeArgs = (extraKeys = 0) => {
  const args = {
    zero: 0,
    negative: -1,
    max: Number.MAX_SAFE_INTEGER,
    long: "x".repeat(50000),
    nested: createDeepObject(20),
    arrayLike: { 0: "a", 1: "b", length: 2 },
    emptyArr: [],
    emptyObj: {},
  };
  for (let i = 0; i < extraKeys; i += 1) {
    args[`k${i}`] = `v${i}`;
  }
  return args;
};

beforeEach(() => {
  sharedMocks.state.idCounter = 0;

  sharedMocks.createLogger.mockClear();
  sharedMocks.mockLogger.warn.mockClear();

  sharedMocks.toNonEmptyString.mockReset();
  sharedMocks.toNonEmptyString.mockImplementation(sharedMocks.defaultToNonEmptyString);

  sharedMocks.isNodeLike.mockReset();
  sharedMocks.isNodeLike.mockImplementation(() => false);

  sharedMocks.makeSecureTimestampedId.mockClear();
  sharedMocks.makeSecureTimestampedId.mockImplementation(
    (prefix = "id") => `${prefix}_${++sharedMocks.state.idCounter}`,
  );

  artifactMocks.computeSha256.mockReset();
  artifactMocks.computeSha256.mockImplementation(async (value) => `hash:${value}`);

  policyMocks.engineInstances.length = 0;
  policyMocks.storeInstances.length = 0;
});

describe("PolicyManager", () => {
  it("accepts injected ruleStore/engine without instantiating defaults", () => {
    const ruleStore = { load: vi.fn(() => []), save: vi.fn(() => true) };
    const engine = {
      setRules: vi.fn(),
      getRules: vi.fn(() => []),
      evaluate: vi.fn(() => ({ allowed: true, requiresApproval: false, reason: "ok" })),
    };

    const manager = new PolicyManager({ ruleStore, engine });

    expect(manager.ruleStore).toBe(ruleStore);
    expect(manager.engine).toBe(engine);
    expect(policyMocks.engineInstances).toHaveLength(0);
    expect(policyMocks.storeInstances).toHaveLength(0);
  });

  it("uses runtime defaults and clamps approvalTimeoutMs", () => {
    sharedMocks.isNodeLike.mockImplementation(() => true);
    const nodeManager = new PolicyManager({
      approvalTimeoutMs: 0,
      onMissingApprovalProvider: "   ",
    });
    expect(nodeManager.interactive).toBe(false);
    expect(nodeManager.onMissingApprovalProvider).toBe("allow");
    expect(nodeManager.approvalTimeoutMs).toBe(1000);

    sharedMocks.isNodeLike.mockImplementation(() => false);
    const browserManager = new PolicyManager({ approvalTimeoutMs: -1 });
    expect(browserManager.interactive).toBe(true);
    expect(browserManager.onMissingApprovalProvider).toBe("deny");
    expect(browserManager.approvalTimeoutMs).toBe(1000);

    const stringTimeoutManager = new PolicyManager({ approvalTimeoutMs: "2000" });
    expect(stringTimeoutManager.approvalTimeoutMs).toBe(300000);
  });

  it("passes defaultEffect and accepts large timeout values", () => {
    const manager = new PolicyManager({
      defaultEffect: "deny",
      approvalTimeoutMs: Number.MAX_SAFE_INTEGER,
    });
    const engine = policyMocks.engineInstances[0];
    expect(engine.options).toMatchObject({ defaultEffect: "deny" });
    expect(manager.approvalTimeoutMs).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("setRunContext updates context only when values are provided", () => {
    const manager = new PolicyManager({ runId: "run_0" });
    const eventBus = createEventBus();
    const runStore = { get: vi.fn(), set: vi.fn() };

    manager.setRunContext({ eventBus, runStore, runId: "run_1" });
    expect(manager.eventBus).toBe(eventBus);
    expect(manager.runStore).toBe(runStore);
    expect(manager.runId).toBe("run_1");

    manager.setRunContext({ eventBus: null, runStore: null, runId: "" });
    expect(manager.eventBus).toBe(eventBus);
    expect(manager.runStore).toBe(runStore);
    expect(manager.runId).toBe("run_1");
  });

  it("load/getRules hydrate rules once and return engine rules", () => {
    const manager = new PolicyManager();
    const store = policyMocks.storeInstances[0];
    const engine = policyMocks.engineInstances[0];
    const rules = [{ ruleId: "r1" }];
    store.load.mockReturnValue(rules);
    engine.getRules.mockReturnValue(rules);

    expect(manager.getRules()).toEqual(rules);
    expect(manager.getRules()).toEqual(rules);
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(engine.setRules).toHaveBeenCalledWith(rules);
    expect(engine.getRules).toHaveBeenCalledTimes(2);
  });

  it("saveRules coerces invalid inputs and addRule appends to existing rules", () => {
    const manager = new PolicyManager();
    const store = policyMocks.storeInstances[0];
    const engine = policyMocks.engineInstances[0];

    manager.saveRules(null);
    manager.saveRules({});
    expect(store.save).toHaveBeenCalledWith([]);
    expect(engine.setRules).toHaveBeenCalledWith([]);

    engine.getRules.mockReturnValue([{ ruleId: "base" }]);
    const rule = { ruleId: "next" };
    manager.addRule(rule);
    const lastSaved = store.save.mock.calls[store.save.mock.calls.length - 1][0];
    expect(lastSaved).toEqual([{ ruleId: "base" }, rule]);
  });

  it("authorize keeps caller-provided requestId/ts (trimmed) and does not mutate the input request object", async () => {
    const manager = new PolicyManager();
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: true, requiresApproval: false, reason: "ok" });

    const input = { type: "run", requestId: "  req_custom  ", ts: "  2020-01-01T00:00:00.000Z  " };
    const result = await manager.authorize(input);

    expect(result.request.requestId).toBe("req_custom");
    expect(result.request.ts).toBe("2020-01-01T00:00:00.000Z");
    expect(sharedMocks.makeSecureTimestampedId).not.toHaveBeenCalled();

    expect(input).toEqual({ type: "run", requestId: "  req_custom  ", ts: "  2020-01-01T00:00:00.000Z  " });
  });

  it("authorize enriches request, hashes args, and emits decision", async () => {
    const eventBus = createEventBus();
    const manager = new PolicyManager({ eventBus, runId: "run_1" });
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: true, requiresApproval: false, reason: "ok" });

    const args = makeArgs(25);
    const result = await manager.authorize({
      type: "  deploy ",
      tool: "   ",
      resource: "",
      args,
    });

    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.reason).toBe("ok");
    expect(result.request.schemaVersion).toBe("0.1");
    expect(result.request.requestId).toBe("polreq_1");
    expect(result.request.ts).toEqual(expect.any(String));
    expect(result.request.type).toBe("deploy");
    expect(result.request.tool).toBeUndefined();
    expect(result.request.resource).toBeUndefined();
    expect(result.request.runId).toBe("run_1");
    expect(result.request.argsHash).toBe(`hash:${JSON.stringify(args)}`);
    expect(result.request.argsSummary).toMatchObject({ kind: "object" });
    expect(result.request.argsSummary.keys).toHaveLength(20);
    expect(result.request.argsSummary.moreKeys).toBeGreaterThan(0);

    expect(artifactMocks.computeSha256).toHaveBeenCalledWith(JSON.stringify(args));
    expect(eventBus.events.map((evt) => evt.name)).toEqual(
      expect.arrayContaining(["policy.requested", "policy.decided"]),
    );
  });

  it("authorize summarizes empty arrays/objects and array-like payloads", async () => {
    const manager = new PolicyManager();
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: true, requiresApproval: false, reason: "ok" });

    const arrayResult = await manager.authorize({ type: "run", args: [] });
    const objectResult = await manager.authorize({ type: "run", args: {} });
    const arrayLike = { 0: "a", length: 1 };
    const arrayLikeResult = await manager.authorize({ type: "run", args: arrayLike });

    expect(arrayResult.request.argsSummary).toEqual({ kind: "object", keys: [] });
    expect(objectResult.request.argsSummary).toEqual({ kind: "object", keys: [] });
    expect(arrayLikeResult.request.argsSummary.keys).toEqual(["0", "length"]);

    expect(artifactMocks.computeSha256).toHaveBeenCalledWith("[]");
    expect(artifactMocks.computeSha256).toHaveBeenCalledWith("{}");
    expect(artifactMocks.computeSha256).toHaveBeenCalledWith(JSON.stringify(arrayLike));
  });

  it("authorize hashes/summarizes primitive args (including boundary values)", async () => {
    const manager = new PolicyManager();
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: true, requiresApproval: false, reason: "ok" });

    const negativeResult = await manager.authorize({ type: "run", args: -1 });
    const maxResult = await manager.authorize({ type: "run", args: Number.MAX_SAFE_INTEGER });
    const whitespaceStringResult = await manager.authorize({ type: "run", args: "   " });

    expect(negativeResult.request.argsHash).toBe("hash:-1");
    expect(negativeResult.request.argsSummary).toEqual({ kind: "number", value: "-1" });

    expect(maxResult.request.argsHash).toBe(`hash:${String(Number.MAX_SAFE_INTEGER)}`);
    expect(maxResult.request.argsSummary).toEqual({ kind: "number", value: String(Number.MAX_SAFE_INTEGER) });

    expect(whitespaceStringResult.request.argsHash).toBe("hash:\"   \"");
    expect(whitespaceStringResult.request.argsSummary).toEqual({ kind: "string", value: "   " });
  });

  it("authorize uses precomputed argsHash/argsSummary and skips hashing", async () => {
    const manager = new PolicyManager();
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: true, requiresApproval: false, reason: "ok" });

    const argsSummary = { kind: "precomputed", keys: ["a"] };
    const result = await manager.authorize({
      type: "run",
      args: { a: 1 },
      argsHash: "prehash",
      argsSummary,
    });

    expect(result.request.argsHash).toBe("prehash");
    expect(result.request.argsSummary).toBe(argsSummary);
    expect(artifactMocks.computeSha256).not.toHaveBeenCalled();
  });

  it("authorize omits argsHash when computeSha256 returns undefined and does not emit argsHash in policy.requested", async () => {
    const eventBus = createEventBus();
    const manager = new PolicyManager({ eventBus });
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: true, requiresApproval: false, reason: "ok" });

    artifactMocks.computeSha256.mockResolvedValue(undefined);

    const result = await manager.authorize({ type: "run", args: { a: 1 } });
    expect(result.request.argsHash).toBeUndefined();

    const requested = eventBus.events.find((evt) => evt.name === "policy.requested");
    expect(requested).toBeTruthy();
    expect(requested.payload).not.toHaveProperty("argsHash");
  });

  it("authorize skips hashing for falsy args and undefined requests", async () => {
    const manager = new PolicyManager();
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: true, requiresApproval: false, reason: "ok" });

    const undefinedResult = await manager.authorize(undefined);
    const nullResult = await manager.authorize({ type: "run", args: null });
    const zeroResult = await manager.authorize({ type: "run", args: 0, argsHash: "", argsSummary: "" });
    const emptyStringResult = await manager.authorize({ type: "run", args: "" });

    expect(undefinedResult.request.argsHash).toBeUndefined();
    expect(undefinedResult.request.argsSummary).toBeUndefined();
    expect(nullResult.request.argsHash).toBeUndefined();
    expect(nullResult.request.argsSummary).toBeUndefined();
    expect(zeroResult.request.argsHash).toBe("");
    expect(zeroResult.request.argsSummary).toBe("");
    expect(emptyStringResult.request.argsHash).toBeUndefined();
    expect(emptyStringResult.request.argsSummary).toBeUndefined();
    expect(artifactMocks.computeSha256).not.toHaveBeenCalled();
  });

  it("authorize logs hashing errors and continues", async () => {
    const manager = new PolicyManager();
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: true, requiresApproval: false, reason: "ok" });

    artifactMocks.computeSha256.mockImplementation(async () => {
      throw new Error("boom");
    });

    const result = await manager.authorize({ type: "run", args: { value: 1 } });
    expect(result.request.argsHash).toBeUndefined();
    expect(sharedMocks.mockLogger.warn).toHaveBeenCalledWith(
      "sha256OfJson failed",
      expect.objectContaining({ error: expect.stringContaining("boom") }),
    );
  });

  it("authorize falls back when approvals are required but non-interactive", async () => {
    sharedMocks.isNodeLike.mockImplementation(() => true);
    const allowManager = new PolicyManager({ onMissingApprovalProvider: "allow" });
    const allowEngine = policyMocks.engineInstances[0];
    allowEngine.evaluate.mockReturnValue({
      allowed: false,
      requiresApproval: true,
      reason: "needs approval",
    });

    const allowResult = await allowManager.authorize({ type: "run", tool: "tool" });
    expect(allowResult.allowed).toBe(true);
    expect(allowResult.reason).toBe("non_interactive_allow");

    const denyManager = new PolicyManager({ onMissingApprovalProvider: "deny" });
    const denyEngine = policyMocks.engineInstances[1];
    denyEngine.evaluate.mockReturnValue({
      allowed: false,
      requiresApproval: true,
      reason: "needs approval",
    });

    const denyResult = await denyManager.authorize({ type: "run", tool: "tool" });
    expect(denyResult.allowed).toBe(false);
    expect(denyResult.reason).toBe("non_interactive_deny");
  });

  it("authorize throws when interactive approvals are required but no approval provider exists", async () => {
    const eventBus = { emit: vi.fn() };
    const manager = new PolicyManager({ eventBus, interactive: true });
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: false, requiresApproval: true, reason: "approval_needed" });

    await expect(manager.authorize({ type: "run", requestId: "req_missing_provider" })).rejects.toThrow(TypeError);

    const emittedNames = eventBus.emit.mock.calls.map(([name]) => name);
    expect(emittedNames).toEqual(expect.arrayContaining(["policy.requested", "policy.approval.requested"]));
    expect(emittedNames).not.toEqual(expect.arrayContaining(["policy.approval.responded", "policy.decided"]));
  });

  it("authorize handles approval flow and stores remember=always rules", async () => {
    const eventBus = createEventBus();
    const manager = new PolicyManager({ eventBus, interactive: true });
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({
      allowed: false,
      requiresApproval: true,
      reason: "approval_needed",
    });

    const deriveRule = vi.fn((req, response) => ({
      ruleId: "rule_1",
      effect: "allow",
      type: req.type,
      tool: req.tool,
      createdAt: "now",
      updatedAt: "now",
      enabled: true,
      priority: 0,
      reason: response?.reason,
    }));

    const authorizePromise = manager.authorize(
      { type: "deploy", tool: "tool", requestId: "req_1" },
      { deriveRule },
    );

    eventBus.emit("policy.approval.response", {
      requestId: "req_1",
      decision: "ALLOW",
      remember: "always",
      reason: "ok",
    });

    const result = await authorizePromise;
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("approved");
    expect(deriveRule).toHaveBeenCalled();

    const store = policyMocks.storeInstances[0];
    const lastSaved = store.save.mock.calls[store.save.mock.calls.length - 1][0];
    expect(lastSaved).toEqual([expect.objectContaining({ ruleId: "rule_1" })]);
    expect(eventBus.events.map((evt) => evt.name)).toEqual(
      expect.arrayContaining([
        "policy.approval.requested",
        "policy.approval.responded",
        "policy.rule.added",
        "policy.decided",
      ]),
    );
  });

  it("authorize derives and stores rules via the default deriveRule implementation", async () => {
    vi.useFakeTimers();
    try {
      const eventBus = createEventBus();
      const manager = new PolicyManager({ eventBus, interactive: true });
      const engine = policyMocks.engineInstances[0];
      engine.evaluate.mockReturnValue({ allowed: false, requiresApproval: true, reason: "approval_needed" });

      vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

      const authorizePromise = manager.authorize({
        type: "deploy",
        tool: "tool",
        resource: "res",
        requestId: "req_default_rule",
      });

      eventBus.emit("policy.approval.response", { requestId: "req_default_rule", decision: "allow", remember: "always" });

      const result = await authorizePromise;
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("approved");

      const store = policyMocks.storeInstances[0];
      expect(store.save).toHaveBeenCalledTimes(1);
      const savedRules = store.save.mock.calls[0][0];
      expect(savedRules).toHaveLength(1);
      expect(savedRules[0]).toMatchObject({
        effect: "allow",
        type: "deploy",
        tool: "tool",
        resource: "res",
        enabled: true,
        priority: 0,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      });
      expect(savedRules[0].ruleId).toMatch(/^rule_/);

      const ruleAdded = eventBus.events.find((evt) => evt.name === "policy.rule.added");
      expect(ruleAdded).toBeTruthy();
      expect(ruleAdded.payload).toMatchObject({ requestId: "req_default_rule", ruleId: savedRules[0].ruleId });
    } finally {
      vi.useRealTimers();
    }
  });

  it("authorize does not persist a rule when default deriveRule refuses overly-broad rules", async () => {
    const eventBus = createEventBus();
    const manager = new PolicyManager({ eventBus, interactive: true });
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({ allowed: false, requiresApproval: true, reason: "approval_needed" });

    const authorizePromise = manager.authorize({ type: "   ", tool: "", resource: undefined, requestId: "req_no_rule" });

    eventBus.emit("policy.approval.response", { requestId: "req_no_rule", decision: "allow", remember: "always" });
    const result = await authorizePromise;

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("approved");
    expect(sharedMocks.mockLogger.warn).toHaveBeenCalledWith(
      "defaultDeriveRuleFromRequest: missing type/tool/resource, refusing to generate rule",
    );

    const store = policyMocks.storeInstances[0];
    expect(store.save).not.toHaveBeenCalled();
    expect(eventBus.events.map((evt) => evt.name)).not.toEqual(expect.arrayContaining(["policy.rule.added"]));
  });

  it("authorize times out when approval responses never arrive", async () => {
    vi.useFakeTimers();
    try {
      const eventBus = createEventBus();
      const manager = new PolicyManager({
        eventBus,
        interactive: true,
        approvalTimeoutMs: 1000,
      });
      const engine = policyMocks.engineInstances[0];
      engine.evaluate.mockReturnValue({
        allowed: false,
        requiresApproval: true,
        reason: "approval_needed",
      });

      const authorizePromise = manager.authorize({ type: "run", requestId: "req_timeout" });
      await vi.advanceTimersByTimeAsync(1000);

      const result = await authorizePromise;
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("rejected");
      expect(eventBus.events.map((evt) => evt.name)).toEqual(
        expect.arrayContaining(["policy.approval.responded", "policy.decided"]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("authorize respects abort signals during approval waits", async () => {
    const eventBus = createEventBus();
    const manager = new PolicyManager({ eventBus, interactive: true });
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({
      allowed: false,
      requiresApproval: true,
      reason: "approval_needed",
    });

    const controller = new AbortController();
    const authorizePromise = manager.authorize(
      { type: "run", requestId: "req_abort" },
      { signal: controller.signal },
    );

    controller.abort();
    const result = await authorizePromise;
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("rejected");
    expect(eventBus.events.map((evt) => evt.name)).toEqual(
      expect.arrayContaining(["policy.approval.responded", "policy.decided"]),
    );
  });

  it("authorize supports concurrent approvals without cross-talk", async () => {
    const eventBus = createEventBus();
    const manager = new PolicyManager({ eventBus, interactive: true });
    const engine = policyMocks.engineInstances[0];
    engine.evaluate.mockReturnValue({
      allowed: false,
      requiresApproval: true,
      reason: "approval_needed",
    });

    const p1 = manager.authorize({ type: "run", tool: "a", requestId: "req_1" });
    const p2 = manager.authorize({ type: "run", tool: "b", requestId: "req_2" });

    eventBus.emit("policy.approval.response", {
      requestId: "req_2",
      decision: "allow",
      remember: "none",
    });
    eventBus.emit("policy.approval.response", {
      requestId: "req_1",
      decision: "deny",
      remember: "none",
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.request.requestId).toBe("req_1");
    expect(r1.allowed).toBe(false);
    expect(r2.request.requestId).toBe("req_2");
    expect(r2.allowed).toBe(true);
  });

  it("authorize handles rapid sequential calls without shared state", async () => {
    const manager = new PolicyManager();
    const engine = policyMocks.engineInstances[0];
    const store = policyMocks.storeInstances[0];
    engine.evaluate.mockReturnValue({ allowed: true, requiresApproval: false, reason: "ok" });

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await manager.authorize({ type: "run", requestId: `req_${i}` }));
    }

    expect(results.map((res) => res.request.requestId)).toEqual([
      "req_0",
      "req_1",
      "req_2",
      "req_3",
      "req_4",
    ]);
    expect(store.load).toHaveBeenCalledTimes(1);
  });
});

describe("default export", () => {
  it("exposes the PolicyManager class", () => {
    expect(PolicyManager).toBe(NamedPolicyManager);
  });
});
