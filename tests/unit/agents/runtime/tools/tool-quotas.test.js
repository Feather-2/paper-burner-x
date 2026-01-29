import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => {
  const createLogger = vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }));

  const createSafeRegex = vi.fn((pattern, flags) => {
    if (pattern instanceof RegExp) return pattern;
    if (typeof pattern !== "string") return null;
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  });

  return { createLogger, createSafeRegex };
});

import * as toolQuotasModule from "../../../../../js/agents/runtime/tools/tool-quotas.js";
import { createLogger, createSafeRegex } from "../../../../../js/agents/shared/index.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(0));
});

function hasPrototypeMethods(fn, methodNames) {
  if (typeof fn !== "function") return false;
  if (!fn.prototype) return false;
  return methodNames.every((name) => typeof fn.prototype[name] === "function");
}

function isToolQuotaEntryClass(fn) {
  return (
    hasPrototypeMethods(fn, ["tryCall", "canCall", "getUsageRatio", "getStats", "reset"]) &&
    fn.prototype.tryCall.length === 0
  );
}

function isSlidingWindowCounterClass(fn) {
  return hasPrototypeMethods(fn, ["record", "getCount", "reset"]);
}

function isQuotaManagerClass(fn) {
  return (
    hasPrototypeMethods(fn, ["tryCall", "getStats"]) &&
    typeof fn.prototype.tryCall === "function" &&
    fn.prototype.tryCall.length >= 1
  );
}

function safeNew(Constructor, args) {
  try {
    return new Constructor(...args);
  } catch {
    return null;
  }
}

function tryInstantiateQuotaManager(QuotaManager) {
  const candidates = [
    [],
    [{}],
    [{ maxCalls: 5, windowMs: 1000 }],
    [{ quotas: {} }],
    [{ rules: [] }],
    [undefined],
  ];
  for (const args of candidates) {
    const instance = safeNew(QuotaManager, args);
    if (instance) return instance;
  }
  return null;
}

function tryCallFactory(factoryFn) {
  const candidates = [
    [],
    [{}],
    [{ maxCalls: 5, windowMs: 1000 }],
    [{ quotas: {} }],
    [{ rules: [] }],
    [undefined],
  ];
  for (const args of candidates) {
    try {
      const result = factoryFn(...args);
      if (result !== undefined) return result;
    } catch {
      // keep trying
    }
  }
  return null;
}

function findToolStats(container, toolName) {
  if (!container || typeof container.getStats !== "function") return null;

  try {
    const direct = container.getStats(toolName);
    if (direct && typeof direct === "object" && (direct.toolName === toolName || direct.toolName != null)) return direct;
  } catch {
    // ignore
  }

  try {
    const stats = container.getStats();
    if (Array.isArray(stats)) return stats.find((s) => s && s.toolName === toolName) ?? null;
    if (stats && typeof stats === "object") {
      if (stats.toolName === toolName) return stats;
      if (stats.tools && Array.isArray(stats.tools)) return stats.tools.find((s) => s && s.toolName === toolName) ?? null;
      if (stats.entries && Array.isArray(stats.entries)) return stats.entries.find((s) => s && s.toolName === toolName) ?? null;
    }
  } catch {
    // ignore
  }

  return null;
}

describe("module init", () => {
  it("creates a logger with fixed namespace", async () => {
    vi.resetModules();
    const shared = await import("../../../../../js/agents/shared/index.js");
    shared.createLogger.mockClear();

    await import("../../../../../js/agents/runtime/tools/tool-quotas.js");
    expect(shared.createLogger).toHaveBeenCalledWith("runtime/tools/tool-quotas");
  });

  it("exposes at least one exported function/class", () => {
    const callableExports = Object.values(toolQuotasModule).filter((v) => typeof v === "function");
    expect(callableExports.length).toBeGreaterThan(0);
  });

  it("mocks external deps (createLogger/createSafeRegex)", () => {
    expect(typeof createLogger).toBe("function");
    expect(typeof createSafeRegex).toBe("function");
  });
});

function defineToolQuotaEntryTests(exportName, ToolQuotaEntry) {
  describe(exportName, () => {
    it("allows calls up to maxCalls then blocks (tracks stats)", () => {
      vi.setSystemTime(new Date(0));
      const entry = new ToolQuotaEntry("search", { maxCalls: 2, windowMs: 1000 });

      const r1 = entry.tryCall();
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(1);

      const r2 = entry.tryCall();
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(0);

      vi.setSystemTime(new Date(500));
      const r3 = entry.tryCall();
      expect(r3.allowed).toBe(false);
      expect(r3.remaining).toBe(0);
      expect(typeof r3.reason).toBe("string");
      expect(r3.reason).toContain("Quota exceeded");

      const stats = entry.getStats();
      expect(stats.toolName).toBe("search");
      expect(stats.current).toBe(2);
      expect(stats.maxCalls).toBe(2);
      expect(stats.windowMs).toBe(1000);
      expect(stats.remaining).toBe(0);
      expect(stats.totalCalls).toBe(2);
      expect(stats.blockedCount).toBe(1);
      expect(stats.lastBlocked).toBe(500);
    });

    it("treats the exact cutoff as inside the window", () => {
      const entry = new ToolQuotaEntry("t", { maxCalls: 1, windowMs: 1000 });

      vi.setSystemTime(new Date(0));
      expect(entry.tryCall().allowed).toBe(true);

      vi.setSystemTime(new Date(1000));
      expect(entry.canCall()).toBe(false);

      vi.setSystemTime(new Date(1001));
      expect(entry.canCall()).toBe(true);
      expect(entry.tryCall().allowed).toBe(true);
    });

    it("canCall() does not consume quota", () => {
      const entry = new ToolQuotaEntry("t", { maxCalls: 1, windowMs: 1000 });

      expect(entry.canCall()).toBe(true);
      expect(entry.canCall()).toBe(true);

      const before = entry.getStats();
      expect(before.current).toBe(0);
      expect(before.totalCalls).toBe(0);

      const res = entry.tryCall();
      expect(res.allowed).toBe(true);

      const after = entry.getStats();
      expect(after.current).toBe(1);
      expect(after.totalCalls).toBe(1);
    });

    it("reset() clears counters and lastBlocked", () => {
      const entry = new ToolQuotaEntry("t", { maxCalls: 1, windowMs: 1000 });

      vi.setSystemTime(new Date(0));
      expect(entry.tryCall().allowed).toBe(true);
      expect(entry.tryCall().allowed).toBe(false);

      const mid = entry.getStats();
      expect(mid.totalCalls).toBe(1);
      expect(mid.blockedCount).toBe(1);
      expect(mid.lastBlocked).toBe(0);

      entry.reset();

      const stats = entry.getStats();
      expect(stats.current).toBe(0);
      expect(stats.totalCalls).toBe(0);
      expect(stats.blockedCount).toBe(0);
      expect(stats.lastBlocked).toBeNull();
      expect(entry.canCall()).toBe(true);
    });

    it("handles edge inputs: toolName null/undefined/empty/whitespace/long string", () => {
      const longName = "x".repeat(50_000);
      const toolNames = ["", "   ", null, undefined, longName];

      for (const toolName of toolNames) {
        const entry = new ToolQuotaEntry(toolName, { maxCalls: 0, windowMs: 1000 });
        const res = entry.tryCall();
        expect(res.allowed).toBe(false);
        expect(res.remaining).toBe(0);
        expect(typeof res.reason).toBe("string");
        expect(entry.getStats().toolName).toBe(toolName);
      }
    });

    it("handles boundary/type values for maxCalls/windowMs (0, -1, MAX_SAFE_INTEGER, numeric strings)", async () => {
      const maxSafe = Number.MAX_SAFE_INTEGER;

      const entry0 = new ToolQuotaEntry("t0", { maxCalls: 0, windowMs: 1000 });
      expect(entry0.tryCall().allowed).toBe(false);

      const entryNeg = new ToolQuotaEntry("tNeg", { maxCalls: -1, windowMs: 1000 });
      expect(entryNeg.tryCall().allowed).toBe(false);

      const entryHuge = new ToolQuotaEntry("tHuge", { maxCalls: maxSafe, windowMs: 1000 });
      const hugeRes = entryHuge.tryCall();
      expect(hugeRes.allowed).toBe(true);
      expect(hugeRes.remaining).toBe(maxSafe - 1);

      const entryStr = new ToolQuotaEntry("tStr", { maxCalls: "2", windowMs: "1000" });
      const results = await Promise.all([
        Promise.resolve().then(() => entryStr.tryCall()),
        Promise.resolve().then(() => entryStr.tryCall()),
      ]);
      expect(results[0].allowed).toBe(true);
      expect(results[1].allowed).toBe(true);

      const third = entryStr.tryCall();
      expect(third.allowed).toBe(false);
      expect(third.remaining).toBe(0);
    });

    it("throws when options is null (error handling) and accepts undefined/empty array/object", () => {
      expect(() => new ToolQuotaEntry("t", null)).toThrow(TypeError);

      expect(() => new ToolQuotaEntry("t", undefined)).not.toThrow();
      expect(() => new ToolQuotaEntry("t", {})).not.toThrow();
      expect(() => new ToolQuotaEntry("t", [])).not.toThrow();

      const entryArr = new ToolQuotaEntry("tArr", []);
      const stats = entryArr.getStats();
      expect(typeof stats.maxCalls).toBe("number");
      expect(stats.maxCalls).toBeGreaterThan(0);
    });
  });
}

function defineSlidingWindowCounterTests(exportName, SlidingWindowCounter) {
  describe(exportName, () => {
    it("counts records within window and expires outside window", () => {
      const counter = new SlidingWindowCounter(1000);

      vi.setSystemTime(new Date(0));
      counter.record();
      expect(counter.getCount()).toBe(1);

      vi.setSystemTime(new Date(500));
      counter.record();
      expect(counter.getCount()).toBe(2);

      vi.setSystemTime(new Date(1001));
      expect(counter.getCount()).toBe(1);

      vi.setSystemTime(new Date(1501));
      expect(counter.getCount()).toBe(0);
    });

    it("treats the exact cutoff as inside the window", () => {
      const counter = new SlidingWindowCounter(1000);

      vi.setSystemTime(new Date(0));
      counter.record();

      vi.setSystemTime(new Date(1000));
      expect(counter.getCount()).toBe(1);

      vi.setSystemTime(new Date(1001));
      expect(counter.getCount()).toBe(0);
    });

    it("handles windowMs boundary values (0 and negative)", () => {
      const zero = new SlidingWindowCounter(0);

      vi.setSystemTime(new Date(0));
      zero.record();
      expect(zero.getCount()).toBe(1);

      vi.setSystemTime(new Date(1));
      expect(zero.getCount()).toBe(0);

      const negative = new SlidingWindowCounter(-1);

      vi.setSystemTime(new Date(0));
      negative.record();
      expect(negative.getCount()).toBe(0);
    });

    it("reset() clears all timestamps", () => {
      const counter = new SlidingWindowCounter(1000);

      vi.setSystemTime(new Date(0));
      for (let i = 0; i < 2000; i++) counter.record();
      expect(counter.getCount()).toBe(2000);

      counter.reset();
      expect(counter.getCount()).toBe(0);
    });

    it("accepts string windowMs and handles rapid consecutive record()", () => {
      const counter = new SlidingWindowCounter("1000");

      vi.setSystemTime(new Date(0));
      counter.record();
      counter.record();
      counter.record();
      expect(counter.getCount()).toBe(3);

      vi.setSystemTime(new Date(2000));
      expect(counter.getCount()).toBe(0);
    });
  });
}

function defineQuotaManagerTests(exportName, QuotaManager) {
  describe(exportName, () => {
    it("enforces per-tool quotas and isolates tools (fast consecutive calls)", () => {
      const manager = tryInstantiateQuotaManager(QuotaManager);
      expect(manager).not.toBeNull();
      expect(typeof manager.tryCall).toBe("function");

      const toolA = "alpha";
      let blocked = null;
      for (let i = 0; i < 150; i++) {
        const res = manager.tryCall(toolA);
        expect(res && typeof res.allowed).toBe("boolean");
        expect(typeof res.remaining).toBe("number");
        if (res.allowed === false) {
          blocked = { res, i };
          break;
        }
      }

      expect(blocked).not.toBeNull();
      expect(blocked.res.remaining).toBe(0);
      expect(typeof blocked.res.reason).toBe("string");

      const toolB = "beta";
      const resB = manager.tryCall(toolB);
      expect(resB.allowed).toBe(true);
    });

    it("handles toolName edge inputs (null/undefined/empty/whitespace/long string)", () => {
      const manager = tryInstantiateQuotaManager(QuotaManager);
      expect(manager).not.toBeNull();
      expect(typeof manager.tryCall).toBe("function");

      const longName = "y".repeat(50_000);
      const toolNames = [null, undefined, "", "   ", longName];

      for (const toolName of toolNames) {
        expect(() => manager.tryCall(toolName)).not.toThrow();
        const res = manager.tryCall(toolName);
        expect(res && typeof res.allowed).toBe("boolean");
        expect(typeof res.remaining).toBe("number");
      }
    });

    it("reset() clears quota state when available (error handling)", () => {
      const manager = tryInstantiateQuotaManager(QuotaManager);
      expect(manager).not.toBeNull();
      expect(typeof manager.tryCall).toBe("function");

      const tool = "resettable";
      for (let i = 0; i < 150; i++) manager.tryCall(tool);

      const afterExhaust = manager.tryCall(tool);
      expect(afterExhaust && typeof afterExhaust.allowed).toBe("boolean");

      if (typeof manager.reset !== "function") {
        expect(typeof manager.reset).toBe("function");
        return;
      }

      let resetWorked = false;
      try {
        manager.reset(tool);
        resetWorked = true;
      } catch {
        // ignore
      }
      if (!resetWorked) {
        try {
          manager.reset();
          resetWorked = true;
        } catch {
          // ignore
        }
      }
      expect(resetWorked).toBe(true);

      const post = manager.tryCall(tool);
      expect(post.allowed).toBe(true);

      const stats = findToolStats(manager, tool);
      if (stats) {
        expect(stats.toolName).toBe(tool);
        expect(stats.remaining).toBeGreaterThanOrEqual(0);
      }
    });
  });
}

function defineQuotaFactoryTests(exportName, factoryFn) {
  describe(exportName, () => {
    it("creates a quota manager with tryCall() interface", () => {
      const manager = tryCallFactory(factoryFn);
      expect(manager).not.toBeNull();
      expect(typeof manager.tryCall).toBe("function");

      const res = manager.tryCall("factory-tool");
      expect(res && typeof res.allowed).toBe("boolean");
      expect(typeof res.remaining).toBe("number");
    });

    it("handles invalid/edge config inputs (null/undefined/empty)", () => {
      expect(() => factoryFn(null)).not.toThrow();
      expect(() => factoryFn(undefined)).not.toThrow();
      expect(() => factoryFn({})).not.toThrow();
      expect(() => factoryFn([])).not.toThrow();
      expect(() => factoryFn({ rules: [], quotas: {}, nested: { a: { b: { c: {} } } } })).not.toThrow();
    });
  });
}

function defineGenericCallableTests(exportName, fn) {
  describe(exportName, () => {
    it("is an exported callable (function/class)", () => {
      expect(typeof fn).toBe("function");
      expect(typeof fn.length).toBe("number");
      expect(typeof fn.toString()).toBe("string");
    });
  });
}

const exportedCallableEntries = Object.entries(toolQuotasModule).filter(([, value]) => typeof value === "function");

for (const [exportName, exportedValue] of exportedCallableEntries) {
  if (isToolQuotaEntryClass(exportedValue)) {
    defineToolQuotaEntryTests(exportName, exportedValue);
    continue;
  }
  if (isSlidingWindowCounterClass(exportedValue)) {
    defineSlidingWindowCounterTests(exportName, exportedValue);
    continue;
  }
  if (isQuotaManagerClass(exportedValue)) {
    defineQuotaManagerTests(exportName, exportedValue);
    continue;
  }
  if (/^(create|make|init)/i.test(exportName)) {
    defineQuotaFactoryTests(exportName, exportedValue);
    continue;
  }

  defineGenericCallableTests(exportName, exportedValue);
}