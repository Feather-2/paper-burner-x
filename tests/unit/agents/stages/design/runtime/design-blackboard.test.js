import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-scope: mock external deps so we only test DesignBlackboard logic.
vi.mock("../../../../../../js/agents/shared/utils/value-utils.js", () => {
  return {
    toNonEmptyString: vi.fn((v) => {
      const s = String(v ?? "").trim();
      return s ? s : null;
    }),
    isPlainObject: vi.fn((v) => {
      if (!v || typeof v !== "object") return false;
      if (Array.isArray(v)) return false;
      const proto = Object.getPrototypeOf(v);
      return proto === Object.prototype || proto === null;
    }),
    deepClone: vi.fn((v) => {
      if (v === null || typeof v !== "object") return v;
      return JSON.parse(JSON.stringify(v));
    }),
  };
});

vi.mock("../../../../../../js/agents/shared/base/disposable-base.js", () => {
  class DisposableBase {
    constructor() {
      this.disposed = false;
      this._disposables = [];
    }
    _registerDisposable(cleanup) {
      if (typeof cleanup === "function") this._disposables.push(cleanup);
    }
    _ensureNotDisposed() {
      if (this.disposed) throw new Error(`${this.constructor.name} has been disposed`);
    }
    async dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (let i = this._disposables.length - 1; i >= 0; i--) {
        await this._disposables[i]();
      }
      this._disposables.length = 0;
    }
  }
  return { DisposableBase };
});

vi.mock("../../../../../../js/agents/runtime/memory/action-types.js", () => {
  return {
    L1_ADD_SIGNAL: "L1/ADD_SIGNAL",
    L1_ACKNOWLEDGE_SIGNAL: "L1/ACKNOWLEDGE_SIGNAL",
    L1_SET_DECK: "L1/SET_DECK",
    L2_ADD_SUMMARY: "L2/ADD_SUMMARY",
    L2_RECORD_DECISION: "L2/RECORD_DECISION",
  };
});

let toNonEmptyString;
let DesignBlackboard;

function createStateEngine(initial = {}) {
  const state = {
    L1: { signals: [], ...initial.L1 },
    L2: { stageSummaries: {}, decisions: [], ...initial.L2 },
  };

  /** @type {Record<string, Function[]>} */
  const subs = { L1: [], L2: [] };

  const engine = {
    getState: vi.fn(() => state),
    _getStateRef: vi.fn(() => state),
    dispatchSync: vi.fn((action) => {
      // Minimal state mutations used by DesignBlackboard read paths.
      if (action?.type === "L1/SET_DECK") {
        state.L1.deck = action.payload?.deck;
      }
      if (action?.type === "L1/ACKNOWLEDGE_SIGNAL") {
        const id = action.payload?.id;
        if (id && Array.isArray(state.L1.signals)) {
          const idx = state.L1.signals.findIndex((s) => s?.id === id);
          if (idx >= 0) state.L1.signals[idx] = { ...state.L1.signals[idx], acknowledged: true };
        }
      }
      if (action?.type === "L2/ADD_SUMMARY") {
        const stage = action.payload?.summary?.stage;
        const summary = action.payload?.summary?.summary;
        if (stage) state.L2.stageSummaries[stage] = summary;
      }
      if (action?.type === "L1/ADD_SIGNAL") {
        state.L1.signals = state.L1.signals || [];
        const signal = action.payload?.signal || action.payload?.signal?.signal;
        // Accept both {payload:{signal:{...}}} and {payload:{signal:{signal:{...}}}} (defensive).
        const s = action.payload?.signal?.signal || action.payload?.signal;
        if (s) state.L1.signals.push({ ...s, id: s.id || `sig_${state.L1.signals.length}` });
      }
      if (action?.type === "L2/RECORD_DECISION") {
        state.L2.decisions = state.L2.decisions || [];
        const d = action.payload?.decision;
        if (d) state.L2.decisions.push(d);
      }

      // Notify subscribers with the next layer snapshot.
      const layer = String(action?.type || "").startsWith("L1/") ? "L1" : String(action?.type || "").startsWith("L2/") ? "L2" : null;
      if (layer) {
        const next = state[layer];
        for (const cb of subs[layer]) cb(action, null, next);
      }
    }),
    dispatchBatchSync: vi.fn((actions) => actions.forEach((a) => engine.dispatchSync(a))),
    subscribe: vi.fn((layer, cb) => {
      subs[layer] = subs[layer] || [];
      subs[layer].push(cb);
      return () => {
        const i = subs[layer].indexOf(cb);
        if (i >= 0) subs[layer].splice(i, 1);
      };
    }),
  };

  return { engine, state };
}

describe("design/runtime/design-blackboard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    ({ toNonEmptyString } = await import("../../../../../../js/agents/shared/utils/value-utils.js"));
    ({ DesignBlackboard } = await import(
      "../../../../../../js/agents/stages/design/internal/design-blackboard.js"
    ));
  });

  it("constructor sets runId/limits and generates a runId when missing", () => {
    const bb = new DesignBlackboard({ runId: "test_run" });
    expect(bb.runId).toBe("test_run");
    expect(bb.limits).toEqual({ summariesMax: 20, signalsMax: 50, decisionsMax: 100 });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123);
    const bb2 = new DesignBlackboard();
    expect(bb2.runId).toMatch(/^design_/);
    nowSpy.mockRestore();

    // toNonEmptyString is used for runId normalization.
    expect(toNonEmptyString).toHaveBeenCalled();
  });

  it("setSummary/getSummary/getAllSummaries work and summaries are pruned by limit (edge case)", () => {
    const bb = new DesignBlackboard({ limits: { summariesMax: 2 } });

    // Empty stage is ignored.
    bb.setSummary("", "ignored");
    expect(bb.getAllSummaries()).toEqual({});

    bb.setSummary("a", "1");
    bb.setSummary("b", "2");
    bb.setSummary("c", "3");

    // Oldest key should be pruned.
    expect(bb.getSummary("a")).toBe(null);
    expect(bb.getAllSummaries()).toEqual({ b: "2", c: "3" });
  });

  it("getSummary prefers StateEngine over MemoryStore over local (priority order)", () => {
    const memoryStore = { L2: { stageSummaries: { "design.outline": "from_memory" } } };
    const bb = new DesignBlackboard({ memoryStore });

    // Without StateEngine, MemoryStore should win over local.
    expect(bb.getSummary("outline")).toBe("from_memory");

    const { engine, state } = createStateEngine({
      L2: { stageSummaries: { "design.outline": "from_engine" } },
    });
    bb.bindStateEngine(engine);

    // With StateEngine, it should win over MemoryStore.
    expect(bb.getSummary("outline")).toBe("from_engine");

    // When StateEngine no longer has the key, fall back to MemoryStore.
    delete state.L2.stageSummaries["design.outline"];
    expect(bb.getSummary("outline")).toBe("from_memory");
  });

  it("bindMemoryStore() syncs existing summaries/signals/decisions and subsequent writes", () => {
    const bb = new DesignBlackboard({ runId: "r1" });
    bb.setSummary("outline", "10 slides");
    bb.pushSignal("style_override", { message: "Change to blue" });
    bb.logDecision("select_theme", "User preference", { metaKey: 1 });

    const memoryStore = {
      L2: { stageSummaries: {} },
      setStageSummary: vi.fn(),
      addSignal: vi.fn(),
      recordDecision: vi.fn(),
    };

    bb.bindMemoryStore(memoryStore);

    expect(memoryStore.setStageSummary).toHaveBeenCalledWith("design.outline", "10 slides");
    expect(memoryStore.addSignal).toHaveBeenCalledTimes(1);
    expect(memoryStore.recordDecision).toHaveBeenCalledTimes(1);
    expect(memoryStore.recordDecision.mock.calls[0][0].action).toBe("design.select_theme");

    // New summary after binding should sync as well.
    bb.setSummary("style", "dark theme");
    expect(memoryStore.setStageSummary).toHaveBeenCalledWith("design.style", "dark theme");
  });

  it("bindStateEngine() seeds missing Design data (summaries/deck/signals/decisions) and subscribes", () => {
    const bb = new DesignBlackboard({ runId: "r_seed" });
    bb.setSummary("outline", "local_summary");
    bb.setDeck({ deck: 1 });
    bb.pushSignal("need_attention", { reason: "because" });
    bb.logDecision("choose_layout", "reason");

    const { engine } = createStateEngine({
      // No design-prefixed summaries/signals/decisions present, so seeding should run.
      L1: { signals: [] },
      L2: { stageSummaries: {}, decisions: [] },
    });

    bb.bindStateEngine(engine);

    expect(engine.dispatchBatchSync).toHaveBeenCalled(); // summary seeding
    expect(engine.subscribe).toHaveBeenCalledTimes(2);

    const dispatchedTypes = engine.dispatchSync.mock.calls.map(([a]) => a?.type);
    expect(dispatchedTypes).toContain("L1/SET_DECK");
    expect(dispatchedTypes).toContain("L1/ADD_SIGNAL");
    expect(dispatchedTypes).toContain("L2/RECORD_DECISION");

    // After binding, values are readable through the StateEngine-backed getters.
    expect(bb.getSummary("outline")).toBe("local_summary");
    expect(bb.getDeck()).toEqual({ deck: 1 });
    expect(bb.hasSignal("need_attention")).toBe(true);
    expect(bb.getRecentDecisions(1)[0].action).toBe("choose_layout");
  });

  it("bindStateEngine() falls back to dispatchSync when dispatchBatchSync is unavailable (edge case)", () => {
    const bb = new DesignBlackboard({ runId: "r_seed2" });
    bb.setSummary("outline", "s1");
    bb.setSummary("style", "s2");

    const { engine } = createStateEngine({ L2: { stageSummaries: {}, decisions: [] } });
    // Force the fallback branch.
    delete engine.dispatchBatchSync;

    bb.bindStateEngine(engine);

    const summarySeeds = engine.dispatchSync.mock.calls
      .map(([a]) => a)
      .filter((a) => a?.type === "L2/ADD_SUMMARY");
    expect(summarySeeds.length).toBeGreaterThanOrEqual(2);
  });

  it("_syncSummaryToMemory() falls back to MemoryStore.L2.stageSummaries when setStageSummary is missing", () => {
    const memoryStore = { L2: { stageSummaries: null } };
    const bb = new DesignBlackboard({ memoryStore });
    bb.setSummary("outline", "x");
    expect(memoryStore.L2.stageSummaries["design.outline"]).toBe("x");
  });

  it("pushSignal() syncs to MemoryStore and StateEngine with message derived from payload (reason/message/empty)", () => {
    const memoryStore = { addSignal: vi.fn() };
    const { engine } = createStateEngine();
    const bb = new DesignBlackboard({ memoryStore, stateEngine: engine });

    bb.pushSignal("a", { message: "m1" });
    bb.pushSignal("b", { reason: "m2" });
    bb.pushSignal("c", "not-object");

    expect(memoryStore.addSignal).toHaveBeenCalledTimes(3);

    const addSignalCalls = engine.dispatchSync.mock.calls
      .map(([a]) => a)
      .filter((a) => a?.type === "L1/ADD_SIGNAL");
    expect(addSignalCalls.length).toBeGreaterThanOrEqual(3);

    expect(addSignalCalls[0].payload.signal.type).toBe("design.a");
    expect(addSignalCalls[0].payload.signal.message).toBe("m1");
    expect(addSignalCalls[1].payload.signal.type).toBe("design.b");
    expect(addSignalCalls[1].payload.signal.message).toBe("m2");
    // Non-plain payload -> {} and empty message.
    expect(addSignalCalls[2].payload.signal.type).toBe("design.c");
    expect(addSignalCalls[2].payload.signal.message).toBe("");
  });

  it("logDecision() syncs to MemoryStore and StateEngine, and _pruneArray enforces limits", () => {
    const memoryStore = { recordDecision: vi.fn() };
    const { engine } = createStateEngine();
    const bb = new DesignBlackboard({ memoryStore, stateEngine: engine, limits: { decisionsMax: 2 } });

    bb.logDecision("a", "1");
    bb.logDecision("b", "2");
    bb.logDecision("c", "3");

    expect(bb.getRecentDecisions(10).length).toBe(2);
    expect(memoryStore.recordDecision).toHaveBeenCalled();

    const decisionCalls = engine.dispatchSync.mock.calls
      .map(([a]) => a)
      .filter((a) => a?.type === "L2/RECORD_DECISION");
    expect(decisionCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("_syncFromStateEngine() parses design decisions even when decision entries are not plain objects (edge case)", () => {
    const nonPlain = Object.create(Date.prototype);
    nonPlain.action = "design.raw_string";
    nonPlain.reason = "r2";
    nonPlain.toString = () => "design.raw_string";

    const { engine } = createStateEngine({
      L2: {
        decisions: [
          { action: "design.ok", reason: "r1", timestamp: 1 },
          // Non-plain decision entry should be coerced via String(d) and still keep design prefix.
          nonPlain,
          { action: "other.ignored", reason: "no" },
        ],
      },
    });

    const bb = new DesignBlackboard({ stateEngine: engine, limits: { decisionsMax: 10 } });
    const recent = bb.getRecentDecisions(10);
    const actions = recent.map((d) => d.action);
    expect(actions).toContain("ok");
    expect(actions).toContain("raw_string");
    expect(actions).not.toContain("other.ignored");
  });

  it("signals are FIFO and acknowledge signals through StateEngine when id is present", () => {
    const { engine } = createStateEngine({
      L1: {
        signals: [
          { id: "s1", type: "design.notice", payload: { message: "Hi" }, acknowledged: false, ts: 1 },
          { id: "s2", type: "other.ignored", payload: {}, acknowledged: false, ts: 2 },
        ],
      },
    });

    const bb = new DesignBlackboard({ stateEngine: engine });
    expect(bb.peekSignals(5).length).toBe(1);
    expect(bb.peekSignals(1)[0].id).toBe("s1");
    expect(bb.peekSignals(1)[0].type).toBe("notice");

    const popped = bb.popSignal();
    expect(popped.id).toBe("s1");
    expect(engine.dispatchSync).toHaveBeenCalledWith({ type: "L1/ACKNOWLEDGE_SIGNAL", payload: { id: "s1" } });

    // Empty queue returns null.
    expect(bb.popSignal()).toBe(null);
  });

  it("clearSignals() can acknowledge cleared signals via dispatchBatchSync (edge case)", () => {
    const { engine } = createStateEngine({
      L1: {
        signals: [
          { id: "a", type: "design.x", payload: {}, acknowledged: false, ts: 1 },
          { id: "b", type: "design.x", payload: {}, acknowledged: false, ts: 2 },
          { id: "c", type: "design.y", payload: {}, acknowledged: false, ts: 3 },
        ],
      },
    });
    const bb = new DesignBlackboard({ stateEngine: engine });

    expect(bb.hasSignal("x")).toBe(true);
    expect(bb.hasSignal("y")).toBe(true);

    bb.clearSignals("x");
    expect(bb.hasSignal("x")).toBe(false);
    expect(bb.hasSignal("y")).toBe(true);
    expect(engine.dispatchBatchSync).toHaveBeenCalled();
  });

  it("setDeck/getDeck sync through StateEngine when bound", () => {
    const { engine } = createStateEngine({ L1: { deck: { from: "engine" } } });
    const bb = new DesignBlackboard({ stateEngine: engine });

    // getDeck prefers StateEngine value.
    expect(bb.getDeck()).toEqual({ from: "engine" });

    bb.setDeck({ from: "local" });
    expect(engine.dispatchSync).toHaveBeenCalledWith({ type: "L1/SET_DECK", payload: { deck: { from: "local" } } });
  });

  it("versions + prompt + serialization cover normal and edge cases", async () => {
    const bb = new DesignBlackboard({ runId: "r" });
    expect(bb.restoreVersion("missing")).toBe(null);
    expect(bb.restoreVersion("")).toBe(null);

    bb.saveVersion("v1", { deck: 1 });
    // Default version label when missing.
    bb.saveVersion(null, { deck: 2 });
    expect(bb.getVersion("v1").snapshot).toEqual({ deck: 1 });
    expect(bb.listVersions().length).toBe(2);
    expect(bb.restoreVersion("v1")).toEqual({ deck: 1 });

    bb.setSummary("outline", "10 slides");
    bb.pushSignal("a", { reason: "R" });
    bb.logDecision("act", "why");
    const prompt = bb.buildBlackboardPrompt({ maxSignals: 1, maxDecisions: 1 });
    expect(prompt).toContain("## 设计摘要");
    expect(prompt).toContain("## 待处理信号");
    expect(prompt).toContain("## 最近决策");

    const json = bb.toJSON();
    const restored = DesignBlackboard.fromJSON(json);
    expect(restored.runId).toBe("r");
    expect(restored.getSummary("outline")).toBe("10 slides");

    // Dispose ensures _ensureNotDisposed guard triggers.
    await bb.dispose();
    expect(() => bb.setSummary("x", "y")).toThrow(/disposed/);
  });
});
