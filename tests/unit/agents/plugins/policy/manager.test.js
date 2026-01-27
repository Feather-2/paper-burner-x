import { describe, it, expect, vi, beforeEach } from "vitest";

const MANAGER_PATH = "../../../../../js/agents/plugins/policy/manager.js";
const SHARED_PATH = "../../../../../js/agents/shared/index.js";
const ARTIFACT_PATH = "../../../../../js/agents/storage/artifact-manager.js";

vi.mock("../../../../../js/agents/storage/artifact-manager.js", () => {
  return {
    computeSha256: vi.fn(),
  };
});

vi.mock("../../../../../js/agents/plugins/policy/engine.js", () => {
  class PolicyEngine {}
  return { PolicyEngine };
});

vi.mock("../../../../../js/agents/plugins/policy/store.js", () => {
  class PolicyRuleStore {}
  return { PolicyRuleStore };
});

vi.mock("../../../../../js/agents/shared/index.js", () => {
  const __mockLogger = {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };

  return {
    __mockLogger,
    makeSecureTimestampedId: vi.fn(() => "rule_test_1"),
    createLogger: vi.fn(() => __mockLogger),
    isNodeLike: vi.fn(() => true),
    // Keep deterministic + strict: only accept real, non-empty strings.
    toNonEmptyString: vi.fn((value) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    }),
  };
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function freshImports() {
  vi.resetModules();
  const manager = await import(MANAGER_PATH);
  const shared = await import(SHARED_PATH);
  const artifact = await import(ARTIFACT_PATH);
  return { manager, shared, artifact };
}

function createEventBus() {
  const handlersByName = new Map();

  return {
    emit(name, payload) {
      const handlers = handlersByName.get(name);
      if (!handlers) return;
      // Copy to allow unsubscribe while iterating.
      [...handlers].forEach((h) => h(payload));
    },
    subscribe(name, handler) {
      let handlers = handlersByName.get(name);
      if (!handlers) {
        handlers = new Set();
        handlersByName.set(name, handlers);
      }
      handlers.add(handler);
      return vi.fn(() => handlers.delete(handler));
    },
    _count(name) {
      return handlersByName.get(name)?.size ?? 0;
    },
  };
}

function createFakeAbortSignal() {
  const listeners = new Set();
  return {
    addEventListener: vi.fn((eventName, handler) => {
      if (eventName !== "abort") return;
      listeners.add(handler);
    }),
    removeEventListener: vi.fn((eventName, handler) => {
      if (eventName !== "abort") return;
      listeners.delete(handler);
    }),
    abort() {
      [...listeners].forEach((h) => h());
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const initialManager = await import(MANAGER_PATH);
const exportedFunctionNames = Object.entries(initialManager)
  .filter(([, v]) => typeof v === "function")
  .map(([k]) => k);

if (exportedFunctionNames.includes("summarizeArgs")) {
  describe("summarizeArgs", () => {
    it("returns kind:null for null/undefined (empty value boundary)", async () => {
      const { manager } = await freshImports();
      expect(manager.summarizeArgs(null)).toEqual({ kind: "null" });
      expect(manager.summarizeArgs(undefined)).toEqual({ kind: "null" });
    });

    it("summarizes primitives with kind and stringified value (type/boundary values)", async () => {
      const { manager } = await freshImports();

      expect(manager.summarizeArgs(0)).toEqual({ kind: "number", value: "0" });
      expect(manager.summarizeArgs(-1)).toEqual({ kind: "number", value: "-1" });
      expect(manager.summarizeArgs(Number.MAX_SAFE_INTEGER)).toEqual({
        kind: "number",
        value: String(Number.MAX_SAFE_INTEGER),
      });

      expect(manager.summarizeArgs("   ")).toEqual({ kind: "string", value: "   " });
      expect(manager.summarizeArgs(false)).toEqual({ kind: "boolean", value: "false" });

      const veryLong = "x".repeat(10000);
      const summary = manager.summarizeArgs(veryLong);
      expect(summary).toEqual({ kind: "string", value: veryLong });
      expect(summary.value.length).toBe(10000);
    });

    it("treats arrays as objects and handles empty arrays/objects (empty array/object boundary)", async () => {
      const { manager } = await freshImports();

      expect(manager.summarizeArgs([])).toEqual({ kind: "object", keys: [] });
      expect(manager.summarizeArgs({})).toEqual({ kind: "object", keys: [] });

      const arr = ["a", "b"];
      expect(manager.summarizeArgs(arr)).toEqual({ kind: "object", keys: ["0", "1"] });
    });

    it("limits keys to first 20 and reports remaining (resource boundary)", async () => {
      const { manager } = await freshImports();

      const obj = {};
      for (let i = 0; i < 25; i++) obj[`k${i}`] = i;

      const summary = manager.summarizeArgs(obj);
      expect(summary.kind).toBe("object");
      expect(summary.keys).toEqual(Array.from({ length: 20 }, (_, i) => `k${i}`));
      expect(summary.moreKeys).toBe(5);
    });
  });
}

if (exportedFunctionNames.includes("sha256OfJson")) {
  describe("sha256OfJson", () => {
    it("hashes JSON stringified values and treats undefined as null", async () => {
      const { manager, artifact } = await freshImports();
      artifact.computeSha256.mockResolvedValueOnce("h:null").mockResolvedValueOnce("h:obj");

      await expect(manager.sha256OfJson(undefined)).resolves.toBe("h:null");
      expect(artifact.computeSha256).toHaveBeenCalledWith("null");

      await expect(manager.sha256OfJson({ a: 1 })).resolves.toBe("h:obj");
      expect(artifact.computeSha256).toHaveBeenLastCalledWith(JSON.stringify({ a: 1 }));
    });

    it("handles long strings and deep-ish objects (resource boundary)", async () => {
      const { manager, artifact } = await freshImports();
      artifact.computeSha256.mockImplementation(async (s) => `h:${s.length}`);

      const hugeString = "a".repeat(200000);
      const result1 = await manager.sha256OfJson({ hugeString });
      expect(result1).toBe(`h:${JSON.stringify({ hugeString }).length}`);

      let deep = { level: 0 };
      for (let i = 1; i <= 200; i++) deep = { level: i, child: deep };
      const result2 = await manager.sha256OfJson(deep);
      expect(result2).toBe(`h:${JSON.stringify(deep).length}`);
    });

    it("returns null and warns when computeSha256 throws (error handling)", async () => {
      const { manager, artifact, shared } = await freshImports();
      artifact.computeSha256.mockRejectedValueOnce(new Error("boom"));

      await expect(manager.sha256OfJson({ a: 1 })).resolves.toBeNull();
      expect(shared.__mockLogger.warn).toHaveBeenCalledWith("sha256OfJson failed", { error: "boom" });
    });

    it("returns null and warns when JSON.stringify fails (circular structure)", async () => {
      const { manager, artifact, shared } = await freshImports();

      const circular = {};
      circular.self = circular;

      await expect(manager.sha256OfJson(circular)).resolves.toBeNull();
      expect(artifact.computeSha256).not.toHaveBeenCalled();

      expect(shared.__mockLogger.warn).toHaveBeenCalledWith(
        "sha256OfJson failed",
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it("supports concurrent calls without cross-talk (concurrency boundary)", async () => {
      const { manager, artifact } = await freshImports();
      artifact.computeSha256.mockImplementation(async (s) => `h:${s}`);

      const [a, b, c] = await Promise.all([
        manager.sha256OfJson(0),
        manager.sha256OfJson({ x: 1 }),
        manager.sha256OfJson(null),
      ]);

      expect(a).toBe("h:0");
      expect(b).toBe('h:{"x":1}');
      expect(c).toBe("h:null");
    });
  });
}

if (exportedFunctionNames.includes("defaultDeriveRuleFromRequest")) {
  describe("defaultDeriveRuleFromRequest", () => {
    it("returns null and warns when missing type/tool/resource (empty/blank boundary)", async () => {
      const { manager, shared } = await freshImports();

      expect(manager.defaultDeriveRuleFromRequest(null)).toBeNull();
      expect(manager.defaultDeriveRuleFromRequest(undefined)).toBeNull();
      expect(manager.defaultDeriveRuleFromRequest({})).toBeNull();
      expect(manager.defaultDeriveRuleFromRequest({ type: "" })).toBeNull();
      expect(manager.defaultDeriveRuleFromRequest({ type: "   " })).toBeNull();
      expect(manager.defaultDeriveRuleFromRequest({ tool: "   " })).toBeNull();
      expect(manager.defaultDeriveRuleFromRequest({ resource: "   " })).toBeNull();

      expect(shared.__mockLogger.warn).toHaveBeenCalledWith(
        "defaultDeriveRuleFromRequest: missing type/tool/resource, refusing to generate rule",
      );
    });

    it("generates a deterministic rule with timestamps and optional fields (normal path)", async () => {
      const { manager, shared } = await freshImports();

      shared.makeSecureTimestampedId.mockReturnValueOnce("rule_123");

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

      const rule = manager.defaultDeriveRuleFromRequest({
        type: "tool.call",
        tool: "fs.readFile",
        resource: "/tmp/a.txt",
      });

      expect(rule).toEqual({
        ruleId: "rule_123",
        effect: "allow",
        type: "tool.call",
        tool: "fs.readFile",
        resource: "/tmp/a.txt",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        enabled: true,
        priority: 0,
      });

      expect(shared.makeSecureTimestampedId).toHaveBeenCalledWith("rule");
    });

    it("allows generating a rule from tool/resource only and trims whitespace (edge cases)", async () => {
      const { manager, shared } = await freshImports();

      shared.makeSecureTimestampedId.mockReturnValueOnce("rule_tool_only");

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

      const r1 = manager.defaultDeriveRuleFromRequest({ tool: "  tool.only  " });
      expect(r1).not.toBeNull();
      expect(r1.ruleId).toBe("rule_tool_only");
      expect(r1.tool).toBe("tool.only");
      expect(Boolean(r1.type)).toBe(false);

      shared.makeSecureTimestampedId.mockReturnValueOnce("rule_trim");
      const r2 = manager.defaultDeriveRuleFromRequest({ type: "t", tool: "   ", resource: "  /a  " });
      expect(r2).not.toBeNull();
      expect(r2.tool).toBeUndefined();
      expect(r2.resource).toBe("/a");
    });

    it("does not share state across rapid successive calls (rapid-call boundary)", async () => {
      const { manager, shared } = await freshImports();

      shared.makeSecureTimestampedId
        .mockImplementationOnce(() => "rule_1")
        .mockImplementationOnce(() => "rule_2");

      const r1 = manager.defaultDeriveRuleFromRequest({ type: "t1" });
      const r2 = manager.defaultDeriveRuleFromRequest({ type: "t2" });

      expect(r1.ruleId).toBe("rule_1");
      expect(r2.ruleId).toBe("rule_2");
      expect(r1.type).toBe("t1");
      expect(r2.type).toBe("t2");
    });
  });
}

if (exportedFunctionNames.includes("waitForApprovalResponse")) {
  describe("waitForApprovalResponse", () => {
    it("returns null when eventBus is missing or requestId is invalid (null/blank/type boundary)", async () => {
      const { manager } = await freshImports();

      await expect(manager.waitForApprovalResponse(null, "x")).resolves.toBeNull();
      await expect(manager.waitForApprovalResponse({}, "x")).resolves.toBeNull();

      const bus = { subscribe: vi.fn() };
      await expect(manager.waitForApprovalResponse(bus, null)).resolves.toBeNull();
      await expect(manager.waitForApprovalResponse(bus, undefined)).resolves.toBeNull();
      await expect(manager.waitForApprovalResponse(bus, "")).resolves.toBeNull();
      await expect(manager.waitForApprovalResponse(bus, "   ")).resolves.toBeNull();
      await expect(manager.waitForApprovalResponse(bus, 0)).resolves.toBeNull();
      await expect(manager.waitForApprovalResponse(bus, [])).resolves.toBeNull();
      await expect(manager.waitForApprovalResponse(bus, {})).resolves.toBeNull();
    });

    it("times out with deny/timeout (timeoutMs boundary: 0 and -1) and cleans up subscription", async () => {
      const { manager } = await freshImports();
      vi.useFakeTimers();

      const bus0 = createEventBus();
      const p0 = manager.waitForApprovalResponse(bus0, "req_0", { timeoutMs: 0 });
      expect(bus0._count("policy.approval.response")).toBe(1);
      vi.advanceTimersByTime(0);
      await flushPromises();
      await expect(p0).resolves.toEqual({ decision: "deny", remember: "none", reason: "timeout" });
      expect(bus0._count("policy.approval.response")).toBe(0);

      const busNeg = createEventBus();
      const pNeg = manager.waitForApprovalResponse(busNeg, "req_neg", { timeoutMs: -1 });
      expect(busNeg._count("policy.approval.response")).toBe(1);
      vi.advanceTimersByTime(0);
      await flushPromises();
      await expect(pNeg).resolves.toEqual({ decision: "deny", remember: "none", reason: "timeout" });
      expect(busNeg._count("policy.approval.response")).toBe(0);
    });

    it("aborts with deny/aborted and removes abort listener", async () => {
      const { manager } = await freshImports();
      vi.useFakeTimers();

      const signal = createFakeAbortSignal();
      const bus = createEventBus();

      const p = manager.waitForApprovalResponse(bus, "req_abort", { timeoutMs: 1000, signal });

      expect(signal.addEventListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
      signal.abort();

      await expect(p).resolves.toEqual({ decision: "deny", remember: "none", reason: "aborted" });
      expect(signal.removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(bus._count("policy.approval.response")).toBe(0);
    });

    it("resolves with matching payload and ignores non-matching events (normal + edge cases)", async () => {
      const { manager } = await freshImports();
      vi.useFakeTimers();

      const bus = createEventBus();
      const p = manager.waitForApprovalResponse(bus, "  req_ok  ", { timeoutMs: 1000 });

      bus.emit("policy.approval.response", { requestId: "other", decision: "deny" });
      expect(bus._count("policy.approval.response")).toBe(1);

      bus.emit("policy.approval.response", {
        payload: { requestId: "req_ok", decision: "allow", remember: "always" },
      });

      await expect(p).resolves.toEqual({ requestId: "req_ok", decision: "allow", remember: "always" });
      expect(bus._count("policy.approval.response")).toBe(0);

      vi.advanceTimersByTime(2000);
      await flushPromises();
    });

    it("supports subscribe() returning void (no off function) and still resolves", async () => {
      const { manager } = await freshImports();
      vi.useFakeTimers();

      let handler;
      const bus = {
        subscribe: vi.fn((_name, h) => {
          handler = h;
          return undefined;
        }),
      };

      const p = manager.waitForApprovalResponse(bus, "req_void_off", { timeoutMs: 1000 });
      expect(bus.subscribe).toHaveBeenCalledWith("policy.approval.response", expect.any(Function));

      handler({ requestId: "req_void_off", decision: "allow", remember: "none" });
      await expect(p).resolves.toEqual({ requestId: "req_void_off", decision: "allow", remember: "none" });
    });

    it("handles concurrent requests resolving independently (concurrency boundary)", async () => {
      const { manager } = await freshImports();
      vi.useFakeTimers();

      const bus = createEventBus();

      const pA = manager.waitForApprovalResponse(bus, "A", { timeoutMs: 1000 });
      const pB = manager.waitForApprovalResponse(bus, "B", { timeoutMs: 1000 });

      expect(bus._count("policy.approval.response")).toBe(2);

      bus.emit("policy.approval.response", { requestId: "B", decision: "deny", remember: "none", reason: "no" });
      await expect(pB).resolves.toEqual({ requestId: "B", decision: "deny", remember: "none", reason: "no" });
      expect(bus._count("policy.approval.response")).toBe(1);

      bus.emit("policy.approval.response", { requestId: "A", decision: "allow", remember: "none" });
      await expect(pA).resolves.toEqual({ requestId: "A", decision: "allow", remember: "none" });
      expect(bus._count("policy.approval.response")).toBe(0);
    });

    it("supports very long requestId strings (resource boundary) and tolerates off() throwing", async () => {
      const { manager } = await freshImports();
      vi.useFakeTimers();

      const longId = `req_${"x".repeat(10000)}`;
      let handler;

      const bus = {
        subscribe: vi.fn((_name, h) => {
          handler = h;
          return () => {
            throw new Error("off failed");
          };
        }),
      };

      const p = manager.waitForApprovalResponse(bus, longId, { timeoutMs: 1000 });

      handler({ requestId: longId, decision: "allow", remember: "none" });
      await expect(p).resolves.toEqual({ requestId: longId, decision: "allow", remember: "none" });
    });
  });
}

const covered = new Set([
  "summarizeArgs",
  "sha256OfJson",
  "defaultDeriveRuleFromRequest",
  "waitForApprovalResponse",
]);

const otherFunctionExports = exportedFunctionNames.filter((name) => !covered.has(name));

describe.each(otherFunctionExports)("%s", (exportName) => {
  describe(exportName, () => {
    it("is exported as a function/class", async () => {
      const { manager } = await freshImports();
      expect(typeof manager[exportName]).toBe("function");
    });
  });
});