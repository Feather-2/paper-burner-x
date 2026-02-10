import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      log: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    cryptoRandomHex: vi.fn((bytes) => "a".repeat(bytes * 2)),
  };
});

vi.mock("../../../../../js/agents/core/di/global-container.js", () => {
  const services = new Map();
  const container = {
    services,
    has: vi.fn((id) => services.has(id)),
    register: vi.fn((id, factory) => {
      services.set(id, factory());
    }),
    get: vi.fn((id) => services.get(id)),
    reset: () => {
      services.clear();
      container.has.mockClear();
      container.register.mockClear();
      container.get.mockClear();
    },
  };
  return { getGlobalContainer: () => container, __container: container };
});

const telemetryPath = "../../../../../js/agents/plugins/telemetry/index.js";
const containerPath = "../../../../../js/agents/core/di/global-container.js";

let telemetry;
let container;

const makeTokenParams = (overrides = {}) => ({
  model: "gpt-4",
  provider: "openai",
  usage: "worker",
  promptTokens: 1,
  completionTokens: 2,
  latencyMs: 3,
  success: true,
  ...overrides,
});

const createEventBus = ({ runId = "run-1" } = {}) => {
  const handlers = new Set();
  const bus = {
    runId,
    on: vi.fn((name, handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    }),
  };
  const emit = (evt) => {
    handlers.forEach((handler) => handler(evt));
  };
  return { bus, emit, handlers };
};

beforeEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
  const containerModule = await import(containerPath);
  container = containerModule.__container;
  container.reset();
  telemetry = await import(telemetryPath);
});

describe("TokenTracker", () => {
  it("records usage with normalization and aggregates stats", () => {
    const { TokenTracker } = telemetry;
    const tracker = new TokenTracker({ maxRecords: 2 });

    const record = tracker.record({
      model: null,
      provider: "",
      usage: undefined,
      promptTokens: "10",
      completionTokens: -1,
      latencyMs: "5ms",
      success: 0,
      error: { message: "boom" },
    });

    expect(record.model).toBe("unknown");
    expect(record.provider).toBe("unknown");
    expect(record.usage).toBe("unknown");
    expect(record.promptTokens).toBe(10);
    expect(record.completionTokens).toBe(0);
    expect(record.totalTokens).toBe(10);
    expect(record.latencyMs).toBe(5);
    expect(record.success).toBe(false);
    expect(record.error).toBe("[object Object]");

    const summary = tracker.getSummary();
    expect(summary.totalCalls).toBe(1);
    expect(summary.failedCalls).toBe(1);
    expect(summary.totalTokens).toBe(10);
    expect(summary.successRate).toBe(0);
  });

  it("handles ring buffer limits and recent record boundaries", () => {
    const { TokenTracker } = telemetry;
    const tracker = new TokenTracker({ maxRecords: 2 });
    tracker.record(makeTokenParams({ usage: "u1" }));
    tracker.record(makeTokenParams({ usage: "u2" }));
    tracker.record(makeTokenParams({ usage: "u3" }));

    const all = tracker.getAllRecords();
    expect(all).toHaveLength(2);
    expect(all[0].usage).toBe("u2");
    expect(all[1].usage).toBe("u3");

    expect(tracker.getRecentRecords(0)).toEqual([]);
    expect(tracker.getRecentRecords("1")).toHaveLength(1);
    expect(tracker.getRecentRecords({})).toHaveLength(2);

    const disabled = new TokenTracker({ maxRecords: 0 });
    disabled.record(makeTokenParams());
    expect(disabled.getAllRecords()).toEqual([]);
  });

  it("filters records by model/usage and range boundaries", () => {
    const { TokenTracker } = telemetry;
    const tracker = new TokenTracker({ maxRecords: 5 });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    tracker.record(makeTokenParams({ model: "GPT-4", usage: "Worker" }));
    vi.setSystemTime(new Date(1000));
    tracker.record(makeTokenParams({ model: "gpt-4", usage: "planner" }));
    vi.setSystemTime(new Date(2000));
    tracker.record(makeTokenParams({ model: "claude", usage: "worker" }));

    expect(tracker.getRecordsByModel("gpt-4")).toHaveLength(2);
    expect(tracker.getRecordsByUsage("WORKER")).toHaveLength(2);
    expect(tracker.getRecordsInRange(0, Number.MAX_SAFE_INTEGER)).toHaveLength(3);
    expect(tracker.getRecordsInRange(0, 0)).toHaveLength(1);
    vi.useRealTimers();
  });

  it("exports json/csv and clears state", () => {
    const { TokenTracker } = telemetry;
    const tracker = new TokenTracker({ maxRecords: 2 });
    tracker.record(makeTokenParams({ error: "bad \"quote\"" }));

    const json = tracker.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed.records).toHaveLength(1);

    const csv = tracker.exportCsv();
    const lines = csv.split("\n");
    expect(lines[0]).toContain("id,timestamp,model,provider,usage,promptTokens,completionTokens,totalTokens,latencyMs,success,error");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("\"bad \"\"quote\"\"\"");

    tracker.clear();
    expect(tracker.getAllRecords()).toHaveLength(0);
    expect(tracker.getSummary().totalCalls).toBe(0);
  });

  it("handles concurrent records and large strings", async () => {
    const { TokenTracker } = telemetry;
    const tracker = new TokenTracker({ maxRecords: 10 });
    const longString = "x".repeat(10000);
    tracker.record(makeTokenParams({ model: longString, usage: longString }));

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        Promise.resolve().then(() => tracker.record(makeTokenParams({ promptTokens: i })))
      )
    );

    const summary = tracker.getSummary();
    expect(summary.totalCalls).toBe(6);
    expect(tracker.getRecordsByModel(longString)).toHaveLength(1);
  });
});

describe("getGlobalTokenTracker", () => {
  it("returns a singleton and registers once", () => {
    const { getGlobalTokenTracker } = telemetry;
    const first = getGlobalTokenTracker();
    const second = getGlobalTokenTracker();
    expect(first).toBe(second);
    expect(container.register).toHaveBeenCalledTimes(1);
    expect(container.get).toHaveBeenCalledTimes(2);
  });

  it("handles concurrent access", async () => {
    const { getGlobalTokenTracker } = telemetry;
    const results = await Promise.all(
      Array.from({ length: 3 }, () => Promise.resolve().then(() => getGlobalTokenTracker()))
    );
    expect(new Set(results).size).toBe(1);
  });

  it("propagates container errors", () => {
    const { getGlobalTokenTracker } = telemetry;
    container.register.mockImplementationOnce(() => {
      throw new Error("register-failed");
    });
    expect(() => getGlobalTokenTracker()).toThrow("register-failed");
  });
});

describe("trackTokenUsage", () => {
  it("records usage via the global tracker", () => {
    const { trackTokenUsage, getTokenUsageSummary } = telemetry;
    trackTokenUsage(makeTokenParams({ promptTokens: 2, completionTokens: 3 }));
    const summary = getTokenUsageSummary();
    expect(summary.totalCalls).toBe(1);
    expect(summary.totalTokens).toBe(5);
  });

  it("handles rapid consecutive calls", async () => {
    const { trackTokenUsage, getTokenUsageSummary } = telemetry;
    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        Promise.resolve().then(() => trackTokenUsage(makeTokenParams({ promptTokens: i })))
      )
    );
    expect(getTokenUsageSummary().totalCalls).toBe(4);
  });

  it("throws when params are null", () => {
    const { trackTokenUsage } = telemetry;
    expect(() => trackTokenUsage(null)).toThrow();
  });
});

describe("getTokenUsageSummary", () => {
  it("returns zeroed summary when empty", () => {
    const { getTokenUsageSummary } = telemetry;
    const summary = getTokenUsageSummary();
    expect(summary.totalCalls).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.avgLatencyMs).toBe(0);
  });

  it("returns summary after records", () => {
    const { trackTokenUsage, getTokenUsageSummary } = telemetry;
    trackTokenUsage(makeTokenParams({ promptTokens: 5, completionTokens: 0 }));
    trackTokenUsage(makeTokenParams({ success: false, promptTokens: 1, completionTokens: 7 }));
    const summary = getTokenUsageSummary();
    expect(summary.totalCalls).toBe(2);
    expect(summary.failedCalls).toBe(1);
    expect(summary.totalTokens).toBe(13);
  });

  it("propagates errors from the tracker", () => {
    const { getTokenUsageSummary } = telemetry;
    container.services.set("tokenTracker", {
      getSummary: () => {
        throw new Error("summary-failed");
      },
    });
    expect(() => getTokenUsageSummary()).toThrow("summary-failed");
  });
});

describe("exportTokenUsageJson", () => {
  it("exports JSON with summary and records", () => {
    const { trackTokenUsage, exportTokenUsageJson } = telemetry;
    trackTokenUsage(makeTokenParams({ promptTokens: 8 }));
    const json = exportTokenUsageJson();
    const parsed = JSON.parse(json);
    expect(parsed.summary.totalCalls).toBe(1);
    expect(parsed.records).toHaveLength(1);
  });

  it("exports empty JSON when no records exist", () => {
    const { exportTokenUsageJson } = telemetry;
    const json = exportTokenUsageJson();
    const parsed = JSON.parse(json);
    expect(parsed.records).toEqual([]);
  });

  it("propagates errors from the tracker", () => {
    const { exportTokenUsageJson } = telemetry;
    container.services.set("tokenTracker", {
      exportJson: () => {
        throw new Error("json-failed");
      },
    });
    expect(() => exportTokenUsageJson()).toThrow("json-failed");
  });
});

describe("exportTokenUsageCsv", () => {
  it("exports CSV with header and records", () => {
    const { trackTokenUsage, exportTokenUsageCsv } = telemetry;
    trackTokenUsage(makeTokenParams({ error: "bad \"quote\"" }));
    const csv = exportTokenUsageCsv();
    const lines = csv.split("\n");
    expect(lines[0]).toContain("id,timestamp,model,provider,usage,promptTokens,completionTokens,totalTokens,latencyMs,success,error");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("\"bad \"\"quote\"\"\"");
  });

  it("exports only headers when empty", () => {
    const { exportTokenUsageCsv } = telemetry;
    const csv = exportTokenUsageCsv();
    expect(csv.split("\n")).toHaveLength(1);
  });

  it("propagates errors from the tracker", () => {
    const { exportTokenUsageCsv } = telemetry;
    container.services.set("tokenTracker", {
      exportCsv: () => {
        throw new Error("csv-failed");
      },
    });
    expect(() => exportTokenUsageCsv()).toThrow("csv-failed");
  });
});

describe("TraceContext", () => {
  it("creates spans with parent relationships and builds a tree", () => {
    const { TraceContext, SpanKind } = telemetry;
    const ctx = new TraceContext();
    const root = ctx.startSpan("root");
    const child = ctx.startSpan("child", { kind: SpanKind.CLIENT });
    ctx.endSpan(child);
    ctx.endSpan(root);

    const tree = ctx.getSpanTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("root");
    expect(tree[0].children[0].name).toBe("child");
    expect(ctx.currentSpan).toBeNull();
  });

  it("trims old ended spans when maxSpans is exceeded", () => {
    const { TraceContext } = telemetry;
    const ctx = new TraceContext({ maxSpans: 5 });
    for (let i = 0; i < 5; i += 1) {
      const span = ctx.startSpan(`s${i}`);
      ctx.endSpan(span);
    }
    const extra = ctx.startSpan("s5");
    ctx.endSpan(extra);
    expect(ctx.getSpans().length).toBeLessThanOrEqual(5);
  });

  it("withSpan captures errors and records exceptions", async () => {
    const { TraceContext, SpanStatus } = telemetry;
    const onSpanEnd = vi.fn();
    const ctx = new TraceContext({ onSpanEnd });
    await expect(
      ctx.withSpan("boom", async () => {
        throw new Error("fail");
      })
    ).rejects.toThrow("fail");
    expect(onSpanEnd).toHaveBeenCalledTimes(1);
    const span = onSpanEnd.mock.calls[0][0];
    expect(span.status).toBe(SpanStatus.ERROR);
    expect(span.events[0].name).toBe("exception");
  });

  it("returns a valid traceparent when no current span exists", () => {
    const { TraceContext } = telemetry;
    const ctx = new TraceContext();
    const traceparent = ctx.getTraceparent();
    expect(traceparent.split("-")).toHaveLength(4);
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});

describe("Span", () => {
  it("filters unsafe attribute keys and supports nested attributes", () => {
    const { Span } = telemetry;
    const span = new Span({
      name: "span",
      traceId: "a".repeat(32),
      attributes: { ok: 1, "__proto__": "bad" },
    });
    span.setAttribute("constructor", "no");
    span.setAttribute("good", "yes");
    span.setAttributes({ nested: { level: { deep: true } } });

    expect(Object.prototype.hasOwnProperty.call(span.attributes, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(span.attributes, "constructor")).toBe(false);
    expect(span.attributes.ok).toBe(1);
    expect(span.attributes.good).toBe("yes");
    expect(span.attributes.nested.level.deep).toBe(true);
  });

  it("records exceptions and sets error status", () => {
    const { Span, SpanStatus } = telemetry;
    const span = new Span({ name: "span", traceId: "b".repeat(32) });
    span.recordException(new Error("boom"));
    expect(span.status).toBe(SpanStatus.ERROR);
    expect(span.events).toHaveLength(1);
    expect(span.events[0].name).toBe("exception");
  });

  it("ends spans and prevents further updates", () => {
    const { Span, SpanStatus } = telemetry;
    const span = new Span({ name: "span", traceId: "c".repeat(32) });
    span.addEvent("start");
    span.end();
    const eventCount = span.events.length;
    span.addEvent("after");
    span.setAttribute("ignored", true);
    expect(span.events).toHaveLength(eventCount);
    expect(span.attributes.ignored).toBeUndefined();
    expect(span.status).toBe(SpanStatus.OK);
    expect(span.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});

describe("SpanStatus", () => {
  it("exposes stable values and is frozen", () => {
    const { SpanStatus } = telemetry;
    expect(SpanStatus.OK).toBe("ok");
    expect(SpanStatus.ERROR).toBe("error");
    expect(SpanStatus.UNSET).toBe("unset");
    expect(Object.isFrozen(SpanStatus)).toBe(true);
    expect(() => {
      SpanStatus.OK = "nope";
    }).toThrow();
  });
});

describe("SpanKind", () => {
  it("exposes stable values and is frozen", () => {
    const { SpanKind } = telemetry;
    expect(SpanKind.INTERNAL).toBe("internal");
    expect(SpanKind.CLIENT).toBe("client");
    expect(SpanKind.SERVER).toBe("server");
    expect(Object.isFrozen(SpanKind)).toBe(true);
    expect(() => {
      SpanKind.CLIENT = "nope";
    }).toThrow();
  });
});

describe("parseTraceparent", () => {
  it("parses a valid traceparent header", () => {
    const { parseTraceparent } = telemetry;
    const traceId = "a".repeat(32);
    const spanId = "b".repeat(16);
    const parsed = parseTraceparent(`00-${traceId}-${spanId}-01`);
    expect(parsed).toEqual({
      version: "00",
      traceId,
      spanId,
      sampled: true,
    });
  });

  it("returns null for invalid inputs", () => {
    const { parseTraceparent } = telemetry;
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent("")).toBeNull();
    expect(parseTraceparent("   ")).toBeNull();
    expect(parseTraceparent(123)).toBeNull();
    expect(parseTraceparent("01-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01")).toBeNull();
    expect(parseTraceparent("00-" + "a".repeat(31) + "-" + "b".repeat(16) + "-01")).toBeNull();
    expect(parseTraceparent("00-" + "a".repeat(32) + "-" + "b".repeat(15) + "-01")).toBeNull();
  });
});

describe("LoopRuntimeState", () => {
  it("normalizes inputs and transitions between valid states", () => {
    const { LoopRuntimeState, LoopRuntimeStatuses } = telemetry;
    const state = new LoopRuntimeState({ status: "running", cursor: [1], pausedReason: "x" });
    expect(state.status).toBe(LoopRuntimeStatuses.RUNNING);
    expect(state.cursor).toEqual([1]);

    const next = state.transitionTo("paused", { timestamp: 0 });
    expect(next).toBe(LoopRuntimeStatuses.PAUSED);
    expect(state.statusHistory).toHaveLength(1);
    expect(state.statusHistory[0].timestamp).toBe("1970-01-01T00:00:00.000Z");
  });

  it("handles boundary values and cursor cloning", () => {
    const { LoopRuntimeState, LoopRuntimeStatuses } = telemetry;
    const deepCursor = { level1: { level2: { level3: "x" } } };
    const state = new LoopRuntimeState({
      status: "   ",
      cursor: deepCursor,
      pausedReason: "",
      lastCheckpointId: undefined,
      statusHistory: [{ from: 1, to: null, timestamp: "   " }, null],
    });
    expect(state.status).toBe(LoopRuntimeStatuses.IDLE);
    expect(state.cursor).not.toBe(deepCursor);
    expect(state.cursor.level1.level2.level3).toBe("x");
    expect(state.pausedReason).toBeNull();
    expect(state.lastCheckpointId).toBeNull();
    expect(typeof state.statusHistory[1].timestamp).toBe("string");

    const arrayState = new LoopRuntimeState({ cursor: [] });
    expect(arrayState.cursor).toEqual([]);
  });

  it("throws on invalid transitions", () => {
    const { LoopRuntimeState } = telemetry;
    const state = new LoopRuntimeState({ status: "idle" });
    expect(() => state.transitionTo("completed")).toThrow();
  });

  it("creates defaults from null JSON payloads", () => {
    const { LoopRuntimeState, LoopRuntimeStatuses } = telemetry;
    const state = LoopRuntimeState.fromJSON(null);
    expect(state.status).toBe(LoopRuntimeStatuses.IDLE);
  });
});

describe("LoopRuntimeStatuses", () => {
  it("exposes stable values and is frozen", () => {
    const { LoopRuntimeStatuses } = telemetry;
    expect(LoopRuntimeStatuses.IDLE).toBe("idle");
    expect(LoopRuntimeStatuses.RUNNING).toBe("running");
    expect(Object.isFrozen(LoopRuntimeStatuses)).toBe(true);
    expect(() => {
      LoopRuntimeStatuses.IDLE = "nope";
    }).toThrow();
  });
});

describe("LOOP_RUNTIME_TRANSITIONS", () => {
  it("defines valid transitions and is frozen", () => {
    const { LOOP_RUNTIME_TRANSITIONS, LoopRuntimeStatuses } = telemetry;
    expect(LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.IDLE]).toContain(LoopRuntimeStatuses.RUNNING);
    expect(LOOP_RUNTIME_TRANSITIONS[LoopRuntimeStatuses.COMPLETED]).toEqual([]);
    expect(Object.isFrozen(LOOP_RUNTIME_TRANSITIONS)).toBe(true);
    expect(() => {
      LOOP_RUNTIME_TRANSITIONS.NEW = [];
    }).toThrow();
  });
});

describe("getRuntimeState", () => {
  it("returns null for invalid signals and reads valid state", () => {
    const { getRuntimeState, setRuntimeState } = telemetry;
    expect(getRuntimeState(null)).toBeNull();
    expect(getRuntimeState(undefined)).toBeNull();
    expect(getRuntimeState("signal")).toBeNull();
    const signal = {};
    const state = setRuntimeState(signal, { status: "running" });
    expect(getRuntimeState(signal)).toBe(state);
  });
});

describe("setRuntimeState", () => {
  it("stores runtime state for valid signals", () => {
    const { setRuntimeState, getRuntimeState, LoopRuntimeState } = telemetry;
    const signal = {};
    const state = setRuntimeState(signal, { status: "running", cursor: "step" });
    expect(state).toBeInstanceOf(LoopRuntimeState);
    expect(getRuntimeState(signal)).toBe(state);
  });

  it("accepts LoopRuntimeState instances", () => {
    const { setRuntimeState, LoopRuntimeState } = telemetry;
    const signal = {};
    const instance = new LoopRuntimeState({ status: "paused" });
    const stored = setRuntimeState(signal, instance);
    expect(stored).toBe(instance);
  });

  it("throws when signal is invalid", () => {
    const { setRuntimeState } = telemetry;
    expect(() => setRuntimeState(null, {})).toThrow(TypeError);
  });
});

describe("ensureRuntimeState", () => {
  it("returns existing state or creates one", () => {
    const { ensureRuntimeState } = telemetry;
    const signal = {};
    const first = ensureRuntimeState(signal, { status: "running" });
    const second = ensureRuntimeState(signal, { status: "paused" });
    expect(second).toBe(first);
  });

  it("handles concurrent access", async () => {
    const { ensureRuntimeState } = telemetry;
    const signal = {};
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        Promise.resolve().then(() => ensureRuntimeState(signal, { status: "running" }))
      )
    );
    expect(new Set(results).size).toBe(1);
  });
});

describe("clearRuntimeState", () => {
  it("clears state and ignores invalid signals", () => {
    const { clearRuntimeState, setRuntimeState, getRuntimeState } = telemetry;
    const signal = {};
    setRuntimeState(signal, { status: "running" });
    clearRuntimeState(signal);
    expect(getRuntimeState(signal)).toBeNull();
    expect(() => clearRuntimeState(null)).not.toThrow();
  });
});

describe("RunReplayController", () => {
  it("validates constructor arguments", () => {
    const { RunReplayController } = telemetry;
    expect(() => new RunReplayController()).toThrow();
    expect(
      () => new RunReplayController({ runStore: { getEvents: () => [] }, eventBus: {} })
    ).toThrow();
  });

  it("orders events by sequence when present", async () => {
    const { RunReplayController } = telemetry;
    const events = [
      { name: "b", seq: 2, ts: 200 },
      { name: "a", seq: 1, ts: 100 },
    ];
    const runStore = { getEvents: vi.fn(async () => events) };
    const dispatch = vi.fn();
    const controller = new RunReplayController({ runStore, eventBus: { _dispatch: dispatch } });
    await controller.load("run-1");
    controller.step();
    controller.step();
    expect(dispatch.mock.calls[0][0].name).toBe("a");
    expect(dispatch.mock.calls[1][0].name).toBe("b");
  });

  it("falls back to timestamp ordering when seq is missing", async () => {
    const { RunReplayController } = telemetry;
    const events = [
      { name: "late", ts: 200 },
      { name: "early", ts: 100 },
    ];
    const runStore = { getEvents: vi.fn(async () => events) };
    const dispatch = vi.fn();
    const controller = new RunReplayController({ runStore, eventBus: { _dispatch: dispatch } });
    await controller.load("run-1");
    controller.step();
    controller.step();
    expect(dispatch.mock.calls[0][0].name).toBe("early");
    expect(dispatch.mock.calls[1][0].name).toBe("late");
  });

  it("plays events with normalized speed and completes once", async () => {
    const { RunReplayController } = telemetry;
    const events = [
      { name: "one", ts: 0 },
      { name: "two", ts: 1000 },
    ];
    const runStore = { getEvents: vi.fn(async () => events) };
    const dispatch = vi.fn();
    const controller = new RunReplayController({
      runStore,
      eventBus: { _dispatch: dispatch },
      speed: 0,
      maxDelayMs: -1,
    });
    await controller.load("run-1");
    vi.useFakeTimers();
    controller.play();
    controller.play();
    vi.runAllTimers();
    expect(controller.state.status).toBe("completed");
    expect(controller.speed).toBe(1);
    expect(controller.maxDelayMs).toBe(0);
    expect(dispatch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("supports seek boundaries and offset jumps", async () => {
    const { RunReplayController } = telemetry;
    const events = [
      { name: "a", ts: 0 },
      { name: "b", ts: 10 },
    ];
    const runStore = { getEvents: vi.fn(async () => events) };
    const dispatch = vi.fn();
    const controller = new RunReplayController({ runStore, eventBus: { _dispatch: dispatch } });
    await controller.load("run-1");
    controller.seek({ index: -1 });
    expect(controller.state.cursor).toBe(0);
    controller.seek({ index: 99 });
    expect(controller.state.cursor).toBe(1);
    controller.seek({ offsetMs: 999 });
    expect(controller.state.cursor).toBe(2);
  });

  it("emits replay records with meta and ignores invalid names", async () => {
    const { RunReplayController } = telemetry;
    const largePayload = "x".repeat(50000);
    const events = [
      { name: "", ts: 0 },
      { name: "evt", ts: 1, payload: largePayload, meta: { deep: { level: 1 } } },
    ];
    const runStore = { getEvents: vi.fn(async () => events) };
    const emit = vi.fn();
    const controller = new RunReplayController({ runStore, eventBus: { emit } });
    await controller.load("run-1");
    controller.step();
    controller.step();
    expect(emit).toHaveBeenCalledTimes(1);
    const [, replayRecord] = emit.mock.calls[0];
    expect(replayRecord.meta.replay).toBe(true);
    expect(events[1].meta.replay).toBeUndefined();
    expect(replayRecord.payload.length).toBe(largePayload.length);
  });

  it("throws on invalid runId inputs", async () => {
    const { RunReplayController } = telemetry;
    const runStore = { getEvents: vi.fn(async () => []) };
    const controller = new RunReplayController({ runStore, eventBus: { _dispatch: vi.fn() } });
    await expect(controller.load(null)).rejects.toThrow();
  });

  it("uses runStore when events param is not an array", async () => {
    const { RunReplayController } = telemetry;
    const runStore = { getEvents: vi.fn(async () => [{ name: "evt", ts: 0 }]) };
    const controller = new RunReplayController({ runStore, eventBus: { _dispatch: vi.fn() } });
    await controller.load("run-1", { events: { not: "array" } });
    expect(runStore.getEvents).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeTelemetry", () => {
  it("records timeline entries, todos, and persists events", async () => {
    const { subscribeTelemetry } = telemetry;
    const { bus, emit } = createEventBus();
    const runStore = { appendEvent: vi.fn(() => Promise.resolve()) };
    const largePayload = "x".repeat(20000);

    const sub = subscribeTelemetry(bus, runStore, { maxTimelineEntries: 2000 });
    emit({
      name: "todo.created",
      runId: "run-1",
      ts: 1,
      payload: { todoId: "t1", text: "draft", status: "open", blob: largePayload },
    });
    emit({
      name: "agent:todo.updated",
      runId: "run-1",
      ts: 2,
      payload: { todoId: "t1", status: "done", relatedGapId: "g1", deep: { level: { v: 1 } } },
    });
    emit({
      name: "agent.step",
      runId: "run-1",
      ts: 3,
      status: "ok",
      payload: { data: [1, 2, 3] },
    });

    await sub.flush();
    expect(runStore.appendEvent).toHaveBeenCalledTimes(3);
    expect(sub.timeline).toHaveLength(3);
    expect(sub.todos).toHaveLength(1);
    expect(sub.todos[0].status).toBe("done");
    expect(sub.todos[0].text).toBe("draft");
  });

  it("trims timeline with maxTimelineEntries and returns snapshots", () => {
    const { subscribeTelemetry } = telemetry;
    const { bus, emit } = createEventBus();
    const runStore = { appendEvent: vi.fn(() => Promise.resolve()) };
    const sub = subscribeTelemetry(bus, runStore, { maxTimelineEntries: 2 });

    emit({ name: "a", runId: "run-1", ts: 1 });
    emit({ name: "b", runId: "run-1", ts: 2 });
    emit({ name: "c", runId: "run-1", ts: 3 });

    expect(sub.timeline).toHaveLength(2);
    const snapshot = sub.snapshot();
    expect(snapshot.timeline).toHaveLength(2);
    expect(snapshot.timeline[0].name).toBe("b");
  });

  it("disables timeline limits when maxTimelineEntries <= 0", () => {
    const { subscribeTelemetry } = telemetry;
    const { bus, emit } = createEventBus();
    const runStore = { appendEvent: vi.fn(() => Promise.resolve()) };
    const sub = subscribeTelemetry(bus, runStore, { maxTimelineEntries: 0 });

    emit({ name: "a", runId: "run-1", ts: 1 });
    emit({ name: "b", runId: "run-1", ts: 2 });
    emit({ name: "c", runId: "run-1", ts: 3 });

    expect(sub.timeline).toHaveLength(3);
  });

  it("ignores replay events and handles missing runId", async () => {
    const { subscribeTelemetry } = telemetry;
    const { bus, emit } = createEventBus({ runId: null });
    const runStore = { appendEvent: vi.fn(() => Promise.resolve()) };
    const sub = subscribeTelemetry(bus, runStore);

    emit({ name: "agent.step", ts: 1, meta: { replay: true } });
    emit({ name: "agent.step", ts: 2 });

    await sub.flush();
    expect(sub.timeline).toHaveLength(1);
    expect(runStore.appendEvent).not.toHaveBeenCalled();
  });

  it("flushes pending writes and surfaces append errors", async () => {
    const { subscribeTelemetry } = telemetry;
    const { bus, emit } = createEventBus();
    const runStore = {
      appendEvent: vi
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error("append-failed")))
        .mockImplementation(() => Promise.resolve()),
    };
    const sub = subscribeTelemetry(bus, runStore);

    emit({ name: "agent.step", runId: "run-1", ts: 1 });

    await expect(sub.flush()).rejects.toThrow("append-failed");
    await expect(sub.flush()).resolves.toBeUndefined();
  });

  it("unsubscribes from the event bus", () => {
    const { subscribeTelemetry } = telemetry;
    const { bus, emit, handlers } = createEventBus();
    const runStore = { appendEvent: vi.fn(() => Promise.resolve()) };
    const sub = subscribeTelemetry(bus, runStore);

    sub.unsubscribe();
    expect(handlers.size).toBe(0);
    emit({ name: "agent.step", runId: "run-1", ts: 1 });
    expect(sub.timeline).toHaveLength(0);
  });

  it("throws when eventBus or runStore are invalid", () => {
    const { subscribeTelemetry } = telemetry;
    expect(() => subscribeTelemetry(null, {})).toThrow();
    expect(() => subscribeTelemetry({ on: () => {} }, null)).toThrow();
  });
});
