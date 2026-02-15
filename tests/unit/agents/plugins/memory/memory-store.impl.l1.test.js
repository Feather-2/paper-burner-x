import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedShared = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));

const mockedValueUtils = vi.hoisted(() => ({
  deepClone: vi.fn(),
}));

const mockedUtils = vi.hoisted(() => ({
  defineAccessor: vi.fn(),
  defineGetter: vi.fn(),
  defineMethod: vi.fn(),
  estimateTokens: vi.fn(),
  genId: vi.fn(),
  isFiniteNumber: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => mockedShared);
vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => mockedValueUtils);
vi.mock("../../../../../js/agents/plugins/memory/memory-store.impl.utils.js", () => mockedUtils);

import { defineL1Layer } from "../../../../../js/agents/plugins/memory/memory-store.impl.l1.js";

const tokenEstimator = (text) => {
  if (text === null || text === undefined) return 0;
  if (typeof text === "string") return Math.ceil(text.length / 4);
  return 1;
};

function makeStore(overrides = {}) {
  const store = {
    _L1: {
      messages: [],
      signals: [],
      decisions: [],
      syncTable: {
        discoveries: new Map(),
        subagents: new Map(),
      },
      scratchpad: {},
      flags: {
        awaitUserFeedback: false,
        taskImpossible: false,
      },
    },
    _stats: {
      l1Tokens: 0,
      tokenUsage: 0,
    },
    _tokenCounter: {},
    config: {
      maxSignals: 3,
      maxDecisions: 3,
    },
    _markDirty: vi.fn(),
    _persistL1Async: vi.fn(),
    _emit: vi.fn(),
    _emitUpdate: vi.fn(),
    _checkCompress: vi.fn(),
    _pruneArray: vi.fn((arr, max) => {
      while (arr.length > max) {
        arr.shift();
      }
    }),
  };

  Object.assign(store, overrides);
  Object.defineProperties(store, defineL1Layer());
  return store;
}

describe("defineL1Layer", () => {
  let store;
  let idCounter;

  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;

    mockedUtils.defineMethod.mockImplementation((fn) => ({
      value: fn,
      writable: true,
      configurable: true,
    }));
    mockedUtils.defineGetter.mockImplementation((fn) => ({
      get: fn,
      configurable: true,
    }));
    mockedUtils.defineAccessor.mockImplementation((get, set) => ({
      get,
      set,
      configurable: true,
    }));
    mockedUtils.genId.mockImplementation((prefix = "id") => `${prefix}_${++idCounter}`);
    mockedUtils.estimateTokens.mockImplementation(tokenEstimator);
    mockedUtils.isFiniteNumber.mockImplementation((value) => typeof value === "number" && Number.isFinite(value));

    mockedValueUtils.deepClone.mockImplementation((value) => JSON.parse(JSON.stringify(value)));
    mockedShared.isPlainObject.mockImplementation((value) => {
      if (value === null || typeof value !== "object") return false;
      return !Array.isArray(value);
    });
    mockedShared.toNonEmptyString.mockImplementation((value) => {
      if (value === null || value === undefined) return "";
      const text = String(value).trim();
      return text ? text : "";
    });

    store = makeStore();
  });

  it("returns a frozen snapshot for L1", () => {
    store._L1.messages.push({ role: "user", content: "hi" });
    store._L1.signals.push({ id: "sig_1" });
    store._L1.decisions.push({ id: "dec_1" });
    store._L1.scratchpad.note = "value";
    store._L1.flags.awaitUserFeedback = true;

    const l1 = store.L1;

    expect(Object.isFrozen(l1)).toBe(true);
    expect(Object.isFrozen(l1.messages)).toBe(true);
    expect(Object.isFrozen(l1.signals)).toBe(true);
    expect(Object.isFrozen(l1.decisions)).toBe(true);
    expect(Object.isFrozen(l1.scratchpad)).toBe(true);
    expect(Object.isFrozen(l1.flags)).toBe(true);
    expect(Object.isFrozen(l1.syncTable)).toBe(true);
    expect(l1.messages).not.toBe(store._L1.messages);
    expect(l1.signals).not.toBe(store._L1.signals);
    expect(l1.decisions).not.toBe(store._L1.decisions);
    expect(l1.scratchpad).not.toBe(store._L1.scratchpad);
    expect(l1.flags).not.toBe(store._L1.flags);
    expect(l1.syncTable.discoveries).toBe(store._L1.syncTable.discoveries);

    const before = store._L1.messages.length;
    try {
      l1.messages.push({ role: "user", content: "mutate" });
    } catch {
      // ignore
    }
    expect(store._L1.messages.length).toBe(before);
  });

  it("cloneL1 delegates to deepClone", () => {
    const sentinel = { ok: true };
    mockedValueUtils.deepClone.mockReturnValueOnce(sentinel);

    const result = store.cloneL1();

    expect(result).toBe(sentinel);
    expect(mockedValueUtils.deepClone).toHaveBeenCalledWith(store._L1);
  });

  it("addMessage adds plain objects and updates stats", () => {
    mockedUtils.estimateTokens.mockReturnValueOnce(2);
    const message = { role: "assistant", content: "hello" };

    const result = store.addMessage(message);

    expect(result).toBe(message);
    expect(store._L1.messages).toHaveLength(1);
    expect(store._stats.l1Tokens).toBe(2);
    expect(store._stats.tokenUsage).toBe(2);
    expect(store._markDirty).toHaveBeenCalledWith("L1");
    expect(store._emit).toHaveBeenCalledWith("memory:l1:add", {
      type: "message",
      role: "assistant",
      tokenEstimate: 2,
    });
    expect(store._checkCompress).toHaveBeenCalledTimes(1);
    expect(mockedUtils.estimateTokens).toHaveBeenCalledWith("hello", store._tokenCounter);
  });

  it("addMessage coerces boundary inputs", () => {
    const inputs = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER];
    const results = inputs.map((value) => store.addMessage(value));

    results.forEach((message, index) => {
      expect(message.role).toBe("user");
      expect(message.content).toBe(String(inputs[index]));
    });

    const expectedTokens = inputs.reduce((sum, value) => sum + tokenEstimator(String(value)), 0);
    expect(store._stats.l1Tokens).toBe(expectedTokens);
    expect(store._L1.messages).toHaveLength(inputs.length);
  });

  it("addMessage handles rapid consecutive calls", async () => {
    const inputs = Array.from({ length: 5 }, (_, i) => `msg-${i}`);
    await Promise.all(inputs.map((msg) => Promise.resolve().then(() => store.addMessage(msg))));

    expect(store._L1.messages).toHaveLength(5);
    expect(store._checkCompress).toHaveBeenCalledTimes(5);
    expect(store._markDirty).toHaveBeenCalledTimes(5);
  });

  it("addMessage accepts a very long string payload", () => {
    const hugeText = "a".repeat(10000);
    mockedUtils.estimateTokens.mockReturnValueOnce(999);

    const message = store.addMessage(hugeText);

    expect(message.content).toBe(hugeText);
    expect(store._stats.l1Tokens).toBe(999);
  });

  it("addMessages returns empty for non-array input and empty array", () => {
    const resultObject = store.addMessages({ not: "array" });
    const resultEmpty = store.addMessages([]);

    expect(resultObject).toEqual([]);
    expect(resultEmpty).toEqual([]);
    expect(store._L1.messages).toHaveLength(0);
    expect(store._markDirty).not.toHaveBeenCalled();
    expect(store._checkCompress).not.toHaveBeenCalled();
  });

  it("addMessages batches mixed inputs and updates stats once", () => {
    mockedUtils.estimateTokens.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);

    const list = [{ role: "user", content: "a" }, "b", { role: "assistant", content: "ccc" }];
    const result = store.addMessages(list);

    expect(result).toHaveLength(3);
    expect(store._L1.messages).toHaveLength(3);
    expect(store._stats.l1Tokens).toBe(6);
    expect(store._stats.tokenUsage).toBe(6);
    expect(store._markDirty).toHaveBeenCalledTimes(1);
    expect(store._checkCompress).toHaveBeenCalledTimes(1);
  });

  it("getMessages returns a copy", () => {
    store._L1.messages.push({ role: "user", content: "hi" });

    const messages = store.getMessages();
    messages.push({ role: "assistant", content: "mutate" });

    expect(messages).toHaveLength(2);
    expect(store._L1.messages).toHaveLength(1);
  });

  it("addSignal creates entry, prunes, and emits", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    store.config.maxSignals = 2;

    store.addSignal({ type: "warn", message: "a" });
    const entry = store.addSignal({ message: "b", payload: { deep: { value: 1 } } });
    store.addSignal({ type: "info", message: "c" });

    expect(entry).toMatchObject({
      id: "sig_2",
      type: "info",
      message: "b",
      payload: { deep: { value: 1 } },
      acknowledged: false,
      ts: 1234,
    });
    expect(store._L1.signals).toHaveLength(2);
    expect(store._pruneArray).toHaveBeenCalledWith(store._L1.signals, 2);
    expect(store._emit).toHaveBeenCalledWith("memory:l1:add", {
      type: "signal",
      signalType: "info",
      id: "sig_2",
    });
    nowSpy.mockRestore();
  });

  it("addSignal throws for nullish input", () => {
    expect(() => store.addSignal(null)).toThrow(TypeError);
    expect(() => store.addSignal(undefined)).toThrow(TypeError);
  });

  it("acknowledgeSignal updates matching signal", () => {
    const entry = store.addSignal({ type: "info", message: "m" });

    const result = store.acknowledgeSignal(entry.id);

    expect(result.acknowledged).toBe(true);
    expect(store._markDirty).toHaveBeenCalledWith("L1");
  });

  it("acknowledgeSignal returns undefined for missing id", () => {
    const result = store.acknowledgeSignal("missing");

    expect(result).toBeUndefined();
    expect(store._markDirty).not.toHaveBeenCalled();
  });

  it("getSignals supports filters and pending", () => {
    const first = store.addSignal({ type: "info", message: "a" });
    const second = store.addSignal({ type: "error", message: "b" });
    store.acknowledgeSignal(first.id);

    const pending = store.getSignals("pending");
    const filtered = store.getSignals((signal) => signal.type === "error");
    const all = store.getSignals();

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(second.id);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("error");
    expect(all).toHaveLength(2);
  });

  it("recordDecision stores entry and prunes", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(999);
    store.config.maxDecisions = 2;

    store.recordDecision({ action: "run", reason: "first" });
    const entry = store.recordDecision({ type: "fallback", result: { ok: true } });
    store.recordDecision({});

    expect(entry).toMatchObject({
      id: "dec_2",
      action: "fallback",
      reason: "",
      result: { ok: true },
      ts: 999,
    });
    expect(store._L1.decisions).toHaveLength(2);
    expect(store._emit).toHaveBeenCalledWith("memory:l1:add", {
      type: "decision",
      action: "fallback",
      id: "dec_2",
    });
    nowSpy.mockRestore();
  });

  it("getDecisions respects boundary limits and types", () => {
    store._L1.decisions = [{ id: "a" }, { id: "b" }, { id: "c" }];

    expect(store.getDecisions("2").map((d) => d.id)).toEqual(["b", "c"]);
    expect(store.getDecisions(0).map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(store.getDecisions(-1).map((d) => d.id)).toEqual(["b", "c"]);
    expect(store.getDecisions(Number.MAX_SAFE_INTEGER).map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("getScratchpad returns copy or key value", () => {
    store._L1.scratchpad = { note: "x", deep: { nested: true }, null: "value" };

    const all = store.getScratchpad();
    all.note = "changed";

    expect(store._L1.scratchpad.note).toBe("x");
    expect(store.getScratchpad(null)).toBe("value");
  });

  it("setScratchpad merges object keys and ignores unsafe keys", () => {
    const payload = Object.create(null);
    payload.safe = 1;
    payload["__proto__"] = "bad";
    payload.constructor = 2;
    payload.prototype = 3;

    store.setScratchpad(payload);

    expect(store._L1.scratchpad).toEqual({ safe: 1 });
    expect(store._markDirty).toHaveBeenCalledWith("L1");
    expect(store._emitUpdate).toHaveBeenCalledWith("scratchpad", { key: payload, value: undefined });
  });

  it("setScratchpad ignores empty or unsafe inputs", () => {
    store.setScratchpad({});
    store.setScratchpad("   ", "value");
    store.setScratchpad("__proto__", "value");

    expect(store._L1.scratchpad).toEqual({});
    expect(store._markDirty).not.toHaveBeenCalled();
    expect(store._emitUpdate).not.toHaveBeenCalled();
  });

  it("setScratchpad accepts numeric keys and deep values", () => {
    const deepValue = { level: { count: 1 } };

    store.setScratchpad(0, deepValue);

    expect(store._L1.scratchpad["0"]).toEqual(deepValue);
    expect(store._markDirty).toHaveBeenCalledWith("L1");
  });

  it("clearScratchpad resets and emits", () => {
    store._L1.scratchpad = { note: "x" };

    store.clearScratchpad();

    expect(store._L1.scratchpad).toEqual({});
    expect(store._markDirty).toHaveBeenCalledWith("L1");
    expect(store._emitUpdate).toHaveBeenCalledWith("scratchpad", { cleared: true });
  });

  it("getFlags returns a copy", () => {
    store._L1.flags.awaitUserFeedback = true;

    const flags = store.getFlags();
    flags.awaitUserFeedback = false;

    expect(store._L1.flags.awaitUserFeedback).toBe(true);
  });

  it("setFlag updates existing flag and ignores unknown", () => {
    store.setFlag("awaitUserFeedback", "yes");
    store.setFlag("missing", true);

    expect(store._L1.flags.awaitUserFeedback).toBe(true);
    expect(store._markDirty).toHaveBeenCalledWith("L1");
    expect(store._emitUpdate).toHaveBeenCalledWith("flags", { awaitUserFeedback: "yes" });
    expect(store._emitUpdate).toHaveBeenCalledTimes(1);
  });

  it("accessors map to flags", () => {
    store.awaitUserFeedback = 1;
    store.taskImpossible = 0;

    expect(store.awaitUserFeedback).toBe(true);
    expect(store.taskImpossible).toBe(false);
  });

  it("syncDiscovery merges payload with defaults and existing data", () => {
    store._L1.syncTable.discoveries.set("d1", {
      id: "d1",
      status: "closed",
      keywords: ["a"],
      by: "tester",
      extra: "keep",
    });

    const entry = store.syncDiscovery("d1", { status: "   ", reason: "update", deep: { nest: true } });

    expect(entry.status).toBe("closed");
    expect(entry.keywords).toEqual(["a"]);
    expect(entry.by).toBe("tester");
    expect(entry.reason).toBe("update");
    expect(entry.deep).toEqual({ nest: true });
    expect(store._markDirty).toHaveBeenCalledWith("L1");
  });

  it("syncDiscovery handles non-object payload and defaults", () => {
    const entry = store.syncDiscovery("d2", "invalid");

    expect(entry.status).toBe("open");
    expect(entry.keywords).toEqual([]);
    expect(entry.by).toBeNull();
    expect(store.getDiscovery("d2")).toMatchObject({ id: "d2" });
  });

  it("getDiscovery returns null for missing ids", () => {
    expect(store.getDiscovery("missing")).toBeNull();
  });

  it("getAllDiscoveries returns values", () => {
    store.syncDiscovery("d1", { status: "open" });
    store.syncDiscovery("d2", { status: "closed" });

    const all = store.getAllDiscoveries();

    expect(all).toHaveLength(2);
    expect(all.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });

  it("syncSubagent merges payload and respects numeric boundaries", () => {
    store._L1.syncTable.subagents.set("s1", {
      id: "s1",
      status: "done",
      progress: 5,
      result: { ok: true },
    });

    const entry = store.syncSubagent("s1", { progress: "50", status: "", extra: "keep" });

    expect(entry.status).toBe("done");
    expect(entry.progress).toBe(5);
    expect(entry.result).toEqual({ ok: true });
    expect(entry.extra).toBe("keep");
  });

  it("syncSubagent defaults progress and status for new entries", () => {
    const entry = store.syncSubagent("s2", { progress: -1, result: null });

    expect(entry.status).toBe("pending");
    expect(entry.progress).toBe(-1);
    expect(entry.result).toBeNull();

    const entryMax = store.syncSubagent("s3", { progress: Number.MAX_SAFE_INTEGER });
    expect(entryMax.progress).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("getSubagent and getAllSubagents behave as expected", () => {
    store.syncSubagent("s1", { status: "pending" });
    store.syncSubagent("s2", { status: "running" });

    expect(store.getSubagent("missing")).toBeNull();
    expect(store.getSubagent("s1")).toMatchObject({ id: "s1" });

    const all = store.getAllSubagents();

    expect(all).toHaveLength(2);
    expect(all.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });
});
