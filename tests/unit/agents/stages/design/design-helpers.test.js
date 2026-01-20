import { describe, it, expect, vi, beforeEach } from "vitest";

const telemetryMocks = vi.hoisted(() => {
  const parseTraceparent = vi.fn();

  class TraceContext {
    constructor(options = {}) {
      this.options = options;
    }
  }

  TraceContext.parseTraceparent = parseTraceparent;

  return { TraceContext, parseTraceparent };
});

const runtimeMocks = vi.hoisted(() => ({
  getErrorBoundary: vi.fn(() => ({ wrap: vi.fn() })),
}));

const sharedMocks = vi.hoisted(() => ({
  safeJsonParse: vi.fn((value) => value),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../../../../js/agents/plugins/telemetry/index.js", () => ({
  TraceContext: telemetryMocks.TraceContext,
}));

vi.mock("../../../../../js/agents/runtime/index.js", () => runtimeMocks);

vi.mock("../../../../../js/agents/shared/index.js", () => sharedMocks);

import {
  DESIGN_LOOP_DEFAULTS,
  resolveWatchdogSettings,
  safeJsonStringify,
  resolveStageTraceContext,
  resolveErrorBoundary,
} from "../../../../../js/agents/stages/design/design-helpers.js";

const DEFAULT_WATCHDOG = {
  maxRecentOutputs: 8,
  similarityThreshold: 0.8,
  maxConsecutiveSimilar: 3,
  stuckThresholdMs: 5 * 60_000,
  maxTimeMs: 30 * 60_000,
};

function makeDeepObject(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  telemetryMocks.parseTraceparent.mockReset();
  runtimeMocks.getErrorBoundary.mockReturnValue({ wrap: vi.fn() });
});

describe("DESIGN_LOOP_DEFAULTS", () => {
  it("exposes expected default values", () => {
    expect(DESIGN_LOOP_DEFAULTS).toEqual({
      batchSize: 4,
      batchConcurrency: 2,
      imageConcurrency: 4,
      maxIterations: 10,
      maxBacktrackAttempts: 3,
      signatureLength: 64,
    });
  });
});

describe("resolveWatchdogSettings", () => {
  it("returns defaults for empty or invalid inputs", () => {
    const cases = [null, undefined, "", [], {}, { watchdog: null }, { watchdog: "" }, { watchdog: [] }, { watchdog: {} }];

    for (const input of cases) {
      expect(resolveWatchdogSettings(input)).toEqual(DEFAULT_WATCHDOG);
    }
  });

  it("clamps numeric values, floors them, and enforces minimums", () => {
    const result = resolveWatchdogSettings({
      watchdog: {
        maxRecentOutputs: 1.9,
        similarityThreshold: 1.5,
        maxConsecutiveSimilar: 1.1,
        stuckThresholdMs: 9_999.9,
        maxTimeMs: 29_999.9,
      },
    });

    expect(result).toEqual({
      maxRecentOutputs: 2,
      similarityThreshold: 1,
      maxConsecutiveSimilar: 2,
      stuckThresholdMs: 10_000,
      maxTimeMs: 30_000,
    });
  });

  it("handles boundary values and ignores numeric strings", () => {
    const result = resolveWatchdogSettings({
      watchdog: {
        maxRecentOutputs: 0,
        similarityThreshold: -1,
        maxConsecutiveSimilar: -1,
        stuckThresholdMs: -1,
        maxTimeMs: Number.MAX_SAFE_INTEGER,
      },
    });

    expect(result).toEqual({
      maxRecentOutputs: 2,
      similarityThreshold: 0,
      maxConsecutiveSimilar: 2,
      stuckThresholdMs: 10_000,
      maxTimeMs: Number.MAX_SAFE_INTEGER,
    });

    const stringValues = resolveWatchdogSettings({
      watchdog: {
        maxRecentOutputs: "5",
        similarityThreshold: "0.5",
        maxConsecutiveSimilar: "2",
        stuckThresholdMs: "10000",
        maxTimeMs: "30000",
      },
    });

    expect(stringValues).toEqual(DEFAULT_WATCHDOG);
  });

  it("supports concurrent calls without shared state", async () => {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => resolveWatchdogSettings({ watchdog: { maxRecentOutputs: 6 } })),
      Promise.resolve().then(() => resolveWatchdogSettings({ watchdog: { similarityThreshold: 0 } })),
    ]);

    expect(first.maxRecentOutputs).toBe(6);
    expect(first.similarityThreshold).toBe(DEFAULT_WATCHDOG.similarityThreshold);
    expect(second.maxRecentOutputs).toBe(DEFAULT_WATCHDOG.maxRecentOutputs);
    expect(second.similarityThreshold).toBe(0);
  });
});

describe("safeJsonStringify", () => {
  it("stringifies normal and empty values", () => {
    const values = [null, "", "   ", [], {}];

    for (const value of values) {
      expect(safeJsonStringify(value)).toBe(JSON.stringify(value));
    }
  });

  it("returns an empty string for undefined or non-stringifiable values", () => {
    expect(safeJsonStringify(undefined)).toBe("");
    expect(safeJsonStringify(() => {})).toBe("");
  });

  it("truncates long JSON output and appends an ellipsis", () => {
    const value = "a".repeat(1000);
    const raw = JSON.stringify(value);
    const expected = `${raw.slice(0, 10)}\u2026`;

    expect(safeJsonStringify(value, 10)).toBe(expected);
  });

  it("falls back to String on JSON errors and truncates", () => {
    const circular = {};
    circular.self = circular;
    circular.toString = () => "x".repeat(20);

    expect(safeJsonStringify(circular, 5)).toBe(`xxxxx\u2026`);
  });

  it("handles large payloads and deep nesting safely", () => {
    const large = "z".repeat(10_000);
    const largeResult = safeJsonStringify(large, 120);
    expect(largeResult.endsWith("\u2026")).toBe(true);
    expect(largeResult.length).toBe(121);

    const deep = makeDeepObject(60);
    const deepResult = safeJsonStringify(deep);
    expect(deepResult.startsWith("{")).toBe(true);
    expect(deepResult.length).toBeGreaterThan(2);
  });

  it("handles rapid consecutive calls", () => {
    const results = [];
    for (let i = 0; i < 25; i += 1) {
      results.push(safeJsonStringify({ index: i }));
    }

    expect(results[0]).toBe(JSON.stringify({ index: 0 }));
    expect(results[24]).toBe(JSON.stringify({ index: 24 }));
  });
});

describe("resolveStageTraceContext", () => {
  it("returns the provided traceContext when valid", () => {
    const candidate = {
      startSpan: vi.fn(),
      endSpan: vi.fn(),
      withSpan: vi.fn(),
    };

    const result = resolveStageTraceContext({ traceContext: candidate });
    expect(result).toBe(candidate);
  });

  it("parses traceparent and creates a TraceContext with parent span", () => {
    telemetryMocks.parseTraceparent.mockReturnValue({ traceId: "trace-1", spanId: "span-1" });

    const result = resolveStageTraceContext({ traceparent: " 00-abc " });

    expect(telemetryMocks.parseTraceparent).toHaveBeenCalledWith("00-abc");
    expect(result).toBeInstanceOf(telemetryMocks.TraceContext);
    expect(result.options).toEqual({ traceId: "trace-1", parentSpanId: "span-1" });
  });

  it("falls back to a new TraceContext when traceparent is missing or invalid", () => {
    telemetryMocks.parseTraceparent.mockReturnValue({ traceId: "trace-only" });

    const result = resolveStageTraceContext({ traceparent: "00-no-span" });
    expect(result).toBeInstanceOf(telemetryMocks.TraceContext);
    expect(result.options).toEqual({});

    const whitespaceResult = resolveStageTraceContext({ traceparent: "   " });
    expect(telemetryMocks.parseTraceparent).toHaveBeenCalledTimes(1);
    expect(whitespaceResult).toBeInstanceOf(telemetryMocks.TraceContext);
  });

  it("ignores non-string traceparent and array traceContext", () => {
    const result = resolveStageTraceContext({ traceContext: [], traceparent: 123 });

    expect(telemetryMocks.parseTraceparent).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(telemetryMocks.TraceContext);
  });
});

describe("resolveErrorBoundary", () => {
  it("returns the direct errorBoundary when provided", () => {
    const boundary = { wrap: vi.fn() };
    const result = resolveErrorBoundary({ errorBoundary: boundary });

    expect(result).toBe(boundary);
    expect(runtimeMocks.getErrorBoundary).not.toHaveBeenCalled();
  });

  it("resolves errorBoundary from container.tryGet", () => {
    const boundary = { wrap: vi.fn() };
    const container = { tryGet: vi.fn().mockReturnValue(boundary) };

    const result = resolveErrorBoundary({}, container);

    expect(container.tryGet).toHaveBeenCalledWith("errorBoundary");
    expect(result).toBe(boundary);
    expect(runtimeMocks.getErrorBoundary).not.toHaveBeenCalled();
  });

  it("uses container.get when tryGet is missing or invalid", () => {
    const boundary = { wrap: vi.fn() };
    const container = {
      tryGet: vi.fn().mockReturnValue({}),
      get: vi.fn().mockReturnValue(boundary),
    };

    const result = resolveErrorBoundary({}, container);

    expect(container.get).toHaveBeenCalledWith("errorBoundary");
    expect(result).toBe(boundary);
  });

  it("falls back to default errorBoundary when container throws", () => {
    const fallback = { wrap: vi.fn() };
    runtimeMocks.getErrorBoundary.mockReturnValue(fallback);

    const container = {
      get: vi.fn(() => {
        throw new Error("missing");
      }),
    };

    const result = resolveErrorBoundary({ container });

    expect(result).toBe(fallback);
    expect(runtimeMocks.getErrorBoundary).toHaveBeenCalledTimes(1);
  });

  it("falls back when inputs are empty or invalid", () => {
    const fallback = { wrap: vi.fn() };
    runtimeMocks.getErrorBoundary.mockReturnValue(fallback);

    const result = resolveErrorBoundary({ errorBoundary: "" }, null);

    expect(result).toBe(fallback);
    expect(runtimeMocks.getErrorBoundary).toHaveBeenCalledTimes(1);
  });
});
