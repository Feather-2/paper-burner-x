import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const debugSpy = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() => vi.fn(() => ({ debug: debugSpy })));
const toNonEmptyStringImpl = vi.hoisted(
  () => (v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  },
);
const isPlainObjectImpl = vi.hoisted(
  () => (v) => {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  },
);
const DisposableBaseMock = vi.hoisted(
  () =>
    class DisposableBase {
      constructor() {
        this.disposed = false;
        this._disposables = [];
      }

      _registerDisposable(cleanup) {
        if (this.disposed) return;
        if (typeof cleanup === "function") this._disposables.push(cleanup);
      }

      async dispose() {
        if (this.disposed) return;
        this.disposed = true;
        for (let i = this._disposables.length - 1; i >= 0; i -= 1) {
          await this._disposables[i]();
        }
        this._disposables.length = 0;
      }

      _ensureNotDisposed() {
        if (this.disposed) throw new Error(`${this.constructor.name} has been disposed`);
      }
    },
);

const MEMORY_CONSTANTS = vi.hoisted(() => ({
  L1_ADD_SIGNAL: "L1_ADD_SIGNAL",
  L1_ACKNOWLEDGE_SIGNAL: "L1_ACKNOWLEDGE_SIGNAL",
  L1_SET_DECK: "L1_SET_DECK",
  L2_ADD_SUMMARY: "L2_ADD_SUMMARY",
  L2_RECORD_DECISION: "L2_RECORD_DECISION",
}));

const deepCloneImpl = vi.hoisted(
  () => (v) => {
    if (v === null || typeof v !== "object") return v;
    try {
      return JSON.parse(JSON.stringify(v));
    } catch {
      return v;
    }
  },
);

vi.mock("../../../../../../js/agents/shared/utils/value-utils.js", () => ({
  deepClone: deepCloneImpl,
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: toNonEmptyStringImpl,
  isPlainObject: isPlainObjectImpl,
  createLogger: createLoggerMock,
  DisposableBase: DisposableBaseMock,
}));

vi.mock("../../../../../../js/agents/plugins/memory/index.js", () => MEMORY_CONSTANTS);

import { DesignBlackboard } from "../../../../../../js/agents/stages/design/internal/design-blackboard.js";

const { L1_ADD_SIGNAL, L1_ACKNOWLEDGE_SIGNAL, L1_SET_DECK, L2_ADD_SUMMARY, L2_RECORD_DECISION } = MEMORY_CONSTANTS;

function makeMemoryStore() {
  const store = {
    L1: { signals: [] },
    L2: { stageSummaries: {} },
    setStageSummary: vi.fn(function setStageSummary(stage, summary) {
      this.L2.stageSummaries[stage] = summary;
    }),
    addSignal: vi.fn(),
    recordDecision: vi.fn(),
  };
  return store;
}

function makeArchive() {
  return {
    save: vi.fn(async () => "design:checkpoint-1"),
    load: vi.fn(async () => null),
    restore: vi.fn(async () => null),
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
  };
}

function createStateEngine(initialState = {}) {
  const state = {
    L1: { ...(initialState.L1 || {}) },
    L2: { ...(initialState.L2 || {}) },
  };

  const engine = {
    _subs: [],
    getState: vi.fn(() => state),
    _getStateRef: vi.fn(() => state),
    dispatchSync: vi.fn((action) => {
      switch (action?.type) {
        case L1_SET_DECK:
          state.L1.deck = action.payload?.deck;
          break;
        case L1_ADD_SIGNAL:
          if (!Array.isArray(state.L1.signals)) state.L1.signals = [];
          state.L1.signals.push(action.payload?.signal || {});
          break;
        case L1_ACKNOWLEDGE_SIGNAL:
          if (Array.isArray(state.L1.signals)) {
            state.L1.signals = state.L1.signals.map((s) =>
              s?.id === action.payload?.id ? { ...s, acknowledged: true } : s,
            );
          }
          break;
        case L2_ADD_SUMMARY: {
          const summary = action.payload?.summary;
          if (!isPlainObjectImpl(state.L2.stageSummaries)) state.L2.stageSummaries = {};
          if (summary?.stage) state.L2.stageSummaries[summary.stage] = summary.summary;
          break;
        }
        case L2_RECORD_DECISION:
          if (!Array.isArray(state.L2.decisions)) state.L2.decisions = [];
          state.L2.decisions.push(action.payload?.decision || {});
          break;
        default:
          break;
      }
    }),
    dispatchBatchSync: vi.fn((actions) => {
      actions.forEach((action) => engine.dispatchSync(action));
    }),
    subscribe: vi.fn((slice, cb) => {
      const unsub = vi.fn();
      engine._subs.push({ slice, cb, unsub });
      return unsub;
    }),
  };

  engine.emit = (slice, next) => {
    engine._subs
      .filter((entry) => entry.slice === slice)
      .forEach((entry) => entry.cb({}, null, next));
  };

  return engine;
}

function makeDeepObject(depth) {
  let obj = { value: "leaf" };
  for (let i = 0; i < depth; i += 1) {
    obj = { nested: obj };
  }
  return obj;
}

function getDispatchedTypes(dispatchMock) {
  return dispatchMock.mock.calls.map((call) => call[0]?.type).filter(Boolean);
}

describe("DesignBlackboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    debugSpy.mockClear();
  });

  it("initializes runId, createdAt, and limits", () => {
    const bb = new DesignBlackboard({ runId: "run-123", limits: { signalsMax: 1 } });

    expect(bb.runId).toBe("run-123");
    expect(typeof bb.createdAt).toBe("string");
    expect(bb.limits.summariesMax).toBe(20);
    expect(bb.limits.signalsMax).toBe(1);
    expect(bb.limits.decisionsMax).toBe(100);

    const fallback = new DesignBlackboard({ runId: null });
    expect(fallback.runId.startsWith("design_")).toBe(true);
  });

  it("ignores empty stage names and supports numeric stage keys", () => {
    const bb = new DesignBlackboard();

    bb.setSummary(null, "x");
    bb.setSummary(undefined, "y");
    bb.setSummary("", "z");
    bb.setSummary("   ", "w");

    expect(Object.keys(bb.getAllSummaries()).length).toBe(0);

    bb.setSummary(0, "zero");
    bb.setSummary(-1, "neg");
    bb.setSummary(Number.MAX_SAFE_INTEGER, "max");

    expect(bb.getSummary("0")).toBe("zero");
    expect(bb.getSummary("-1")).toBe("neg");
    expect(bb.getSummary(String(Number.MAX_SAFE_INTEGER))).toBe("max");
  });

  it("throws after dispose on mutating operations", async () => {
    const bb = new DesignBlackboard();
    await bb.dispose();

    expect(() => bb.setSummary("stage", "summary")).toThrow("disposed");
  });

  it("prefers stateEngine summaries then memoryStore then local, and logs errors", () => {
    const memoryStore = makeMemoryStore();
    memoryStore.L2.stageSummaries["design.foo"] = "memory";

    const stateEngine = createStateEngine({
      L2: { stageSummaries: { "design.foo": "engine" } },
    });

    const bb = new DesignBlackboard({ memoryStore, stateEngine });
    bb._summaries.set("foo", "local");

    expect(bb.getSummary("foo")).toBe("engine");

    const badEngine = {
      getState: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const bb2 = new DesignBlackboard({ memoryStore, stateEngine: badEngine });
    bb2._summaries.set("foo", "local");

    expect(bb2.getSummary("foo")).toBe("memory");
    expect(debugSpy).toHaveBeenCalled();
  });

  it("merges summaries across sources and ignores dangerous keys", () => {
    const stateEngine = createStateEngine({
      L2: {
        stageSummaries: {
          "design.stage1": "engine",
          "design.__proto__": "poison",
          "other.stage": "skip",
        },
      },
    });
    const memoryStore = makeMemoryStore();
    memoryStore.L2.stageSummaries["design.stage1"] = "memory";
    memoryStore.L2.stageSummaries["design.stage2"] = "memory2";
    memoryStore.L2.stageSummaries["design.constructor"] = "poison";

    const bb = new DesignBlackboard({ memoryStore, stateEngine });
    bb._summaries.set("stage3", "local");

    const summaries = bb.getAllSummaries();

    expect(summaries).toMatchObject({
      stage1: "engine",
      stage2: "memory2",
      stage3: "local",
    });
    expect(Object.prototype.hasOwnProperty.call(summaries, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(summaries)).toBe(null);
  });

  it("bindMemoryStore syncs existing data and tolerates failures", () => {
    const bb = new DesignBlackboard();
    bb.setSummary("stage", "summary");
    bb.pushSignal("notice", { message: "hello" });
    bb.logDecision("choose", "because", { extra: true });

    const memoryStore = makeMemoryStore();
    bb.bindMemoryStore(memoryStore);

    expect(memoryStore.setStageSummary).toHaveBeenCalledWith("design.stage", "summary");
    expect(memoryStore.addSignal).toHaveBeenCalledTimes(1);
    expect(memoryStore.recordDecision).toHaveBeenCalledTimes(1);

    const failingStore = makeMemoryStore();
    failingStore.setStageSummary.mockImplementation(() => {
      throw new Error("fail");
    });
    const bb2 = new DesignBlackboard({ memoryStore: failingStore });

    expect(() => bb2.setSummary("stage", "summary")).not.toThrow();
    expect(debugSpy).toHaveBeenCalled();
  });

  it("bindStateEngine seeds missing design data and unsubscribes previous listeners", () => {
    const bb = new DesignBlackboard();
    bb.setSummary("stage", "summary");
    bb.setDeck({ id: 1 });
    bb.pushSignal("ping", { message: "hi" });
    bb.logDecision("act", "why");

    const engine1 = createStateEngine({ L1: { signals: [] }, L2: { stageSummaries: {}, decisions: [] } });
    bb.bindStateEngine(engine1);

    const types = getDispatchedTypes(engine1.dispatchSync);
    expect(types).toContain(L1_SET_DECK);
    expect(types).toContain(L1_ADD_SIGNAL);
    expect(types).toContain(L2_RECORD_DECISION);
    expect(engine1.dispatchBatchSync).toHaveBeenCalled();
    expect(engine1.subscribe).toHaveBeenCalledTimes(2);

    const unsubs = engine1._subs.map((entry) => entry.unsub);

    const engine2 = createStateEngine();
    bb.bindStateEngine(engine2);

    unsubs.forEach((unsub) => expect(unsub).toHaveBeenCalled());
  });

  it("syncs from state engine and prunes by limits", () => {
    const engine = createStateEngine({
      L1: {
        deck: { name: "deck" },
        signals: [
          { id: "1", type: "design.alert", payload: { message: "one" }, ts: 1 },
          { id: "2", type: "design.", payload: { reason: "two" }, ts: 2 },
          { id: "3", type: "other.notice", payload: { message: "skip" }, ts: 3 },
          { id: "4", type: "design.skip", acknowledged: true, payload: { message: "skip" }, ts: 4 },
        ],
      },
      L2: {
        stageSummaries: {
          "design.stage1": "summary1",
          "design.stage2": "summary2",
        },
        decisions: [
          { action: "design.choice", reason: "r1" },
          { action: "design.other", reason: "r2" },
          { action: "other", reason: "skip" },
        ],
      },
    });

    const bb = new DesignBlackboard({
      stateEngine: engine,
      limits: { signalsMax: 1, decisionsMax: 1, summariesMax: 1 },
    });

    expect(bb.getDeck()).toEqual({ name: "deck" });

    const signals = bb.peekSignals(5);
    expect(signals.length).toBe(1);
    expect(signals[0].id).toBe("2");
    expect(signals[0].type).toBe("unknown");

    expect(bb.getSummary("stage2")).toBe("summary2");

    const decisions = bb.getRecentDecisions(5);
    expect(decisions.length).toBe(1);
    expect(decisions[0].action).toBe("other");
  });

  it("ignores non-array signals/decisions from state engine", () => {
    const engine = createStateEngine({
      L1: { signals: {} },
      L2: { stageSummaries: {}, decisions: {} },
    });

    const bb = new DesignBlackboard({ stateEngine: engine });

    expect(bb.peekSignals(5).length).toBe(0);
    expect(bb.getRecentDecisions(5).length).toBe(0);
  });

  it("handles deck sync errors and state engine read failures", () => {
    const engine = {
      dispatchSync: vi.fn(() => {
        throw new Error("dispatch fail");
      }),
    };
    const bb = new DesignBlackboard({ stateEngine: engine });

    expect(() => bb.setDeck({ data: "x" })).not.toThrow();
    expect(debugSpy).toHaveBeenCalled();

    const bb2 = new DesignBlackboard();
    bb2._stateEngine = {
      getState: vi.fn(() => {
        throw new Error("read fail");
      }),
    };
    bb2.setDeck("local");

    expect(bb2.getDeck()).toBe("local");
    expect(debugSpy).toHaveBeenCalled();
  });

  it("manages signals with limits, acknowledgements, and concurrency", async () => {
    const memoryStore = makeMemoryStore();
    const engine = createStateEngine({ L1: { signals: [] }, L2: {} });

    const bb = new DesignBlackboard({ memoryStore, stateEngine: engine, limits: { signalsMax: 2 } });

    const deepPayload = makeDeepObject(8);
    const signal = bb.pushSignal("notice", deepPayload);

    expect(signal.payload).toBe(deepPayload);
    expect(memoryStore.addSignal).toHaveBeenCalledTimes(1);
    expect(engine.dispatchSync).toHaveBeenCalledWith(
      expect.objectContaining({
        type: L1_ADD_SIGNAL,
        payload: expect.objectContaining({
          signal: expect.objectContaining({ type: "design.notice", message: "" }),
        }),
      }),
    );

    await Promise.all(
      Array.from({ length: 4 }, (_, i) => Promise.resolve().then(() => bb.pushSignal("fast", { message: `m${i}` }))),
    );

    expect(bb.peekSignals(10).length).toBe(2);
    expect(bb.hasSignal("fast")).toBe(true);

    const peeked = bb.peekSignals("1");
    expect(peeked.length).toBe(1);

    bb._signals.unshift({ id: "a", type: "alert", payload: {}, timestamp: 1 });
    const popped = bb.popSignal();
    expect(popped.id).toBe("a");
    expect(engine.dispatchSync).toHaveBeenCalledWith({ type: L1_ACKNOWLEDGE_SIGNAL, payload: { id: "a" } });

    bb._signals = [
      { id: "b", type: "alpha", payload: {}, timestamp: 1 },
      { id: "c", type: "beta", payload: {}, timestamp: 2 },
      { id: null, type: "beta", payload: {}, timestamp: 3 },
    ];

    bb.clearSignals("beta");
    expect(engine.dispatchBatchSync).toHaveBeenCalledWith([
      { type: L1_ACKNOWLEDGE_SIGNAL, payload: { id: "c" } },
    ]);
    expect(bb.hasSignal("beta")).toBe(false);
  });

  it("clears all signals with dispatchSync fallback", () => {
    const engine = createStateEngine({ L1: { signals: [] } });
    engine.dispatchBatchSync = undefined;

    const bb = new DesignBlackboard({ stateEngine: engine });
    bb._signals = [
      { id: "x", type: "t", payload: {}, timestamp: 1 },
      { id: "y", type: "t", payload: {}, timestamp: 2 },
    ];

    bb.clearSignals();

    expect(engine.dispatchSync).toHaveBeenCalledTimes(2);
    expect(bb.peekSignals(5).length).toBe(0);
  });

  it("logs decisions with defaults, syncs, and slices recent decisions", () => {
    const memoryStore = makeMemoryStore();
    const engine = createStateEngine({ L2: { decisions: [] } });
    const bb = new DesignBlackboard({ memoryStore, stateEngine: engine, limits: { decisionsMax: 1 } });

    const decision = bb.logDecision(null, "   ", { extra: 1 });
    expect(decision.action).toBe("unknown");
    expect(decision.reason).toBe("");
    expect(decision.extra).toBe(1);
    expect(typeof decision.timestamp).toBe("number");

    expect(memoryStore.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "design.unknown",
        reason: "",
        meta: expect.objectContaining({ action: "unknown" }),
      }),
    );

    bb.logDecision("next", "reason");

    const recent = bb.getRecentDecisions("1");
    expect(recent.length).toBe(1);
    expect(recent[0].action).toBe("next");
  });

  it("handles version save/get/list/restore with boundary labels", () => {
    const bb = new DesignBlackboard();

    const v1 = bb.saveVersion("", { data: 1 });
    const v2 = bb.saveVersion("   ", { data: 2 });
    const v3 = bb.saveVersion("custom", { data: 3 });

    expect(v1.label).toBe("v1");
    expect(v2.label).toBe("v2");
    expect(bb.getVersion("custom")).toEqual(v3);

    const list = bb.listVersions();
    expect(list).toEqual([
      { label: "v1", timestamp: v1.timestamp },
      { label: "v2", timestamp: v2.timestamp },
      { label: "custom", timestamp: v3.timestamp },
    ]);

    expect(bb.restoreVersion(0)).toBe(null);
    expect(bb.restoreVersion("missing")).toBe(null);
    expect(bb.restoreVersion("custom")).toEqual({ data: 3 });
  });

  it("builds prompt sections and respects max limits", () => {
    const bb = new DesignBlackboard();

    bb.setSummary("stage", "summary");
    bb.pushSignal("info", { message: "hello" });
    bb.pushSignal("warn", { reason: "because" });
    bb.logDecision("decide", "why");
    bb.logDecision("later", "next");

    const output = bb.buildBlackboardPrompt({ maxSignals: "1", maxDecisions: 1 });

    expect(output).toContain("## 设计摘要");
    expect(output).toContain("[stage] summary");
    expect(output).toContain("## 待处理信号");
    expect(output).toContain("- [info] hello");
    expect(output).toContain("## 最近决策");
    expect(output).toContain("- later: next");

    const empty = new DesignBlackboard().buildBlackboardPrompt();
    expect(empty).toBe("");
  });

  it("serializes and restores from JSON", () => {
    const memoryStore = makeMemoryStore();
    const bb = new DesignBlackboard({ runId: "run-1" });
    bb.setSummary("stage", "summary");
    bb.pushSignal("info", { message: "hello" });
    bb.logDecision("decide", "why");
    const version = bb.saveVersion("v1", { snapshot: true });

    const json = bb.toJSON();
    expect(json.runId).toBe("run-1");
    expect(json.summaries).toMatchObject({ stage: "summary" });
    expect(json.signals.length).toBe(1);
    expect(json.decisions.length).toBe(1);
    expect(json.versions).toEqual([{ label: "v1", timestamp: version.timestamp }]);

    const restored = DesignBlackboard.fromJSON(
      {
        runId: "run-2",
        summaries: { a: "b" },
        signals: [{ type: "sig", payload: {}, timestamp: 1 }],
        decisions: [{ action: "act", reason: "" }],
      },
      { memoryStore },
    );

    expect(restored.getSummary("a")).toBe("b");
    expect(restored.peekSignals(1)[0].type).toBe("sig");
    expect(restored.getRecentDecisions(1)[0].action).toBe("act");

    restored.setSummary("new", "value");
    expect(memoryStore.setStageSummary).toHaveBeenCalledWith("design.new", "value");
  });

  it("checkpoint() persists to archive and tolerates archive errors", async () => {
    const archive = makeArchive();
    const bb = new DesignBlackboard({ runId: "run-archive", archive });

    bb.setSummary("stage", "summary");
    bb.pushSignal("notice", { message: "hi" });
    bb.logDecision("act", "reason");
    bb.setDeck({ id: "deck-1" });

    const checkpointId = await bb.checkpoint();

    expect(checkpointId).toBe("design:checkpoint-1");
    expect(archive.save).toHaveBeenCalledWith(
      "run-archive",
      expect.objectContaining({
        nodeStates: expect.objectContaining({
          runId: "run-archive",
          summaries: expect.objectContaining({ stage: "summary" }),
          deck: { id: "deck-1" },
        }),
      }),
    );

    const failingArchive = makeArchive();
    failingArchive.save.mockRejectedValueOnce(new Error("archive-fail"));
    const bbFail = new DesignBlackboard({ runId: "run-fail", archive: failingArchive });
    await expect(bbFail.checkpoint()).resolves.toBeNull();
    expect(debugSpy).toHaveBeenCalled();
  });

  it("init() restores blackboard state from archive snapshot", async () => {
    const archive = makeArchive();
    archive.load.mockResolvedValueOnce({
      nodeStates: {
        runId: "run-restore",
        summaries: { outline: "ready" },
        signals: [{ id: "s1", type: "notice", payload: { message: "m1" }, timestamp: 1 }],
        decisions: [{ action: "choose", reason: "why", timestamp: 2 }],
        versions: [{ label: "v1", snapshot: { deck: 1 }, timestamp: 3 }],
        deck: { restored: true },
      },
    });

    const bb = new DesignBlackboard({ runId: "run-restore", archive });
    const ok = await bb.init();

    expect(ok).toBe(true);
    expect(bb.getSummary("outline")).toBe("ready");
    expect(bb.peekSignals(1)[0]).toEqual(expect.objectContaining({ id: "s1", type: "notice" }));
    expect(bb.getRecentDecisions(1)[0]).toEqual(expect.objectContaining({ action: "choose" }));
    expect(bb.getDeck()).toEqual({ restored: true });
    expect(bb.getVersion("v1")).toEqual(expect.objectContaining({ label: "v1" }));
  });

  it("init() falls back to archive.get and remains tolerant on load failures", async () => {
    const archive = makeArchive();
    archive.load.mockRejectedValueOnce(new Error("load-fail"));
    archive.get.mockResolvedValueOnce({
      summaries: { fallback: "ok" },
      signals: [],
      decisions: [],
    });

    const bb = new DesignBlackboard({ runId: "run-fallback", archive });
    const ok = await bb.init();

    expect(ok).toBe(true);
    expect(archive.get).toHaveBeenCalled();
    expect(bb.getSummary("fallback")).toBe("ok");
    expect(debugSpy).toHaveBeenCalled();
  });

  it("handles cloning fallbacks when structuredClone and JSON fail", () => {
    const engine = createStateEngine();
    const bb = new DesignBlackboard({ stateEngine: engine });

    const originalStructuredClone = globalThis.structuredClone;
    globalThis.structuredClone = () => {
      throw new Error("no clone");
    };

    const circular = {};
    circular.self = circular;

    try {
      bb.setDeck(circular);
      const [action] = engine.dispatchSync.mock.calls.find((call) => call[0]?.type === L1_SET_DECK) || [];
      expect(action.payload.deck).toBe(circular);
    } finally {
      globalThis.structuredClone = originalStructuredClone;
    }
  });

  it("handles large strings and empty values without crashing", () => {
    const bb = new DesignBlackboard({ limits: { signalsMax: -1 } });
    const huge = "x".repeat(100000);

    bb.setSummary("huge", huge);
    expect(bb.getSummary("huge")).toBe(huge);

    bb.pushSignal(undefined, null);
    expect(bb.peekSignals(5).length).toBe(0);
  });
});
