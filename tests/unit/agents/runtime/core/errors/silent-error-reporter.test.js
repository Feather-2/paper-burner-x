import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockedFixtures = vi.hoisted(() => ({
  getLargePayload: vi.fn(() => "X".repeat(20000)),
}));

vi.mock("virtual:silent-error-reporter-fixtures", () => mockedFixtures, { virtual: true });

import { getLargePayload } from "virtual:silent-error-reporter-fixtures";
import {
  ErrorCategory,
  SilentErrorReporter,
  silentErrors,
  reportSilentError,
  createScopedReporter,
} from "../../../../../../js/agents/runtime/core/errors/silent-error-reporter.js";

const FIXED_TIME = new Date("2024-01-01T00:00:00.000Z");

function createDeepObject(depth) {
  let node = {};
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, child: node };
  }
  return node;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TIME);
  silentErrors.clear();
  silentErrors.setEnabled(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ErrorCategory", () => {
  it("exposes expected category values", () => {
    expect(ErrorCategory).toEqual({
      RECOVERABLE: "recoverable",
      DEGRADED: "degraded",
      CRITICAL: "critical",
    });
  });
});

describe("SilentErrorReporter", () => {
  it("initializes defaults and validates maxSamples boundaries", () => {
    const reporter = new SilentErrorReporter();
    expect(reporter.isEnabled()).toBe(true);
    expect(reporter.size).toBe(0);
    expect(reporter._maxSamples).toBe(100);

    const reporterZero = new SilentErrorReporter({ maxSamples: 0 });
    expect(reporterZero._maxSamples).toBe(100);

    const reporterNegative = new SilentErrorReporter({ maxSamples: -1 });
    expect(reporterNegative._maxSamples).toBe(100);

    const reporterString = new SilentErrorReporter({ maxSamples: "5" });
    expect(reporterString._maxSamples).toBe(100);

    const reporterHuge = new SilentErrorReporter({ maxSamples: Number.MAX_SAFE_INTEGER });
    expect(reporterHuge._maxSamples).toBe(10000);

    const reporterFloat = new SilentErrorReporter({ maxSamples: 2.9 });
    expect(reporterFloat._maxSamples).toBe(2);
  });

  it("toggles enabled state", () => {
    const reporter = new SilentErrorReporter({ enabled: false });
    expect(reporter.isEnabled()).toBe(false);

    reporter.setEnabled(true);
    expect(reporter.isEnabled()).toBe(true);
  });

  it("records error details and truncates stack", () => {
    const reporter = new SilentErrorReporter();
    const error = new Error("boom");
    error.stack = ["line1", "line2", "line3", "line4"].join("\n");

    const now = Date.now();
    reporter.report(error, {
      location: "Module.method",
      category: ErrorCategory.CRITICAL,
      operation: "op",
    });

    const [entry] = reporter.export();
    expect(entry).toMatchObject({
      message: "boom",
      stack: "line1\nline2\nline3",
      location: "Module.method",
      category: ErrorCategory.CRITICAL,
      operation: "op",
      ts: now,
    });
  });

  it("normalizes context and coerces error values", () => {
    const reporter = new SilentErrorReporter();
    const arrayLike = { 0: "a", length: 1 };

    const cases = [
      { error: null, context: null, message: "null", location: "unknown" },
      { error: undefined, context: undefined, message: "undefined", location: "unknown" },
      { error: "", context: "", message: "", location: "unknown" },
      { error: [], context: [], message: "", location: "unknown" },
      { error: {}, context: {}, message: "[object Object]", location: "unknown" },
      { error: "ok", context: { location: "   " }, message: "ok", location: "   " },
      {
        error: "keep",
        context: { location: "", category: ErrorCategory.DEGRADED, operation: "op" },
        message: "keep",
        location: "unknown",
        category: ErrorCategory.DEGRADED,
        operation: "op",
      },
      { error: arrayLike, context: arrayLike, message: "[object Object]", location: "unknown" },
    ];

    cases.forEach((item) => reporter.report(item.error, item.context));

    const samples = reporter.export();
    expect(samples).toHaveLength(cases.length);
    samples.forEach((entry, index) => {
      const expected = cases[index];
      expect(entry.message).toBe(expected.message);
      expect(entry.location).toBe(expected.location);
      expect(entry.category).toBe(expected.category ?? ErrorCategory.RECOVERABLE);
      expect(entry.operation).toBe(expected.operation);
      expect(entry.ts).toBe(Date.now());
    });
    expect(samples[4].stack).toBeUndefined();
  });

  it("does nothing when disabled", () => {
    const onError = vi.fn();
    const reporter = new SilentErrorReporter({ enabled: false, onError });
    reporter.report(new Error("x"), { location: "loc" });

    expect(reporter.size).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("maintains ring buffer behavior for maxSamples", () => {
    const reporter = new SilentErrorReporter({ maxSamples: 2 });
    reporter.report(new Error("first"), { location: "loc1" });
    reporter.report(new Error("second"), { location: "loc2" });
    reporter.report(new Error("third"), { location: "loc3" });

    const messages = reporter.export().map((entry) => entry.message);
    expect(messages).toEqual(["second", "third"]);
    expect(reporter.size).toBe(2);
  });

  it("swallows callback errors when onError throws", () => {
    const callbackError = new Error("callback boom");
    const onError = vi.fn(() => {
      throw callbackError;
    });

    const reporter = new SilentErrorReporter({ onError });

    expect(() => reporter.report(new Error("primary"), { location: "loc" })).not.toThrow();

    const samples = reporter.export();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      message: "primary",
      location: "loc",
    });
  });

  it("groups stats and skips dangerous keys", () => {
    const reporter = new SilentErrorReporter();
    reporter.report(new Error("a"), { location: "loc1", category: ErrorCategory.RECOVERABLE });
    reporter.report(new Error("b"), { location: "loc1", category: ErrorCategory.CRITICAL });
    reporter.report(new Error("c"), { location: "loc2" });
    reporter.report(new Error("d"), { location: "__proto__", category: "constructor" });

    const stats = reporter.getStats();
    expect(stats.total).toBe(4);
    expect(stats.byCategory[ErrorCategory.RECOVERABLE]).toBe(2);
    expect(stats.byCategory[ErrorCategory.CRITICAL]).toBe(1);
    expect(stats.byLocation.loc1).toBe(2);
    expect(stats.byLocation.loc2).toBe(1);
    expect(Object.getPrototypeOf(stats.byCategory)).toBe(null);
    expect(Object.getPrototypeOf(stats.byLocation)).toBe(null);
    expect(Object.prototype.hasOwnProperty.call(stats.byCategory, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stats.byLocation, "constructor")).toBe(false);
  });

  it("exports a shallow copy of samples", () => {
    const reporter = new SilentErrorReporter();
    reporter.report("x", { location: "loc" });

    const exported = reporter.export();
    expect(exported).not.toBe(reporter._samples);
    expect(exported).toHaveLength(1);

    exported.push({
      message: "y",
      location: "loc",
      category: ErrorCategory.RECOVERABLE,
      ts: Date.now(),
    });

    expect(reporter.size).toBe(1);
  });

  it("returns recent entries most-recent-first", () => {
    const reporter = new SilentErrorReporter();
    reporter.report(new Error("first"), { location: "loc" });
    reporter.report(new Error("second"), { location: "loc" });
    reporter.report(new Error("third"), { location: "loc" });

    const recent = reporter.getRecent(2);
    expect(recent.map((entry) => entry.message)).toEqual(["third", "second"]);
  });

  it("clears samples and updates size", () => {
    const reporter = new SilentErrorReporter();
    reporter.report(new Error("x"), { location: "loc" });
    reporter.report(new Error("y"), { location: "loc" });
    expect(reporter.size).toBe(2);

    reporter.clear();
    expect(reporter.size).toBe(0);
    expect(reporter.export()).toEqual([]);
  });

  it("handles concurrent report calls", async () => {
    const reporter = new SilentErrorReporter();
    const tasks = Array.from({ length: 25 }, (_, index) =>
      Promise.resolve().then(() =>
        reporter.report(new Error(`err-${index}`), { location: "loc" })
      )
    );

    await Promise.all(tasks);
    expect(reporter.size).toBe(25);
  });

  it("handles rapid consecutive calls with ring buffer", () => {
    const reporter = new SilentErrorReporter({ maxSamples: 10 });
    for (let i = 0; i < 25; i += 1) {
      reporter.report(new Error(`err-${i}`), { location: "loc" });
    }

    const messages = reporter.export().map((entry) => entry.message);
    const expected = Array.from({ length: 10 }, (_, index) => `err-${15 + index}`);
    expect(messages).toEqual(expected);
    expect(reporter.size).toBe(10);
  });

  it("handles large payloads and deep nested objects", () => {
    const reporter = new SilentErrorReporter();
    const largePayload = getLargePayload();
    const longLocation = "L".repeat(2048);
    const longOperation = "op".repeat(1024);
    const deepObject = createDeepObject(50);

    reporter.report(largePayload, { location: longLocation, operation: longOperation });
    reporter.report(deepObject, { location: "deep" });

    const [largeEntry, deepEntry] = reporter.export();
    expect(getLargePayload).toHaveBeenCalledTimes(1);
    expect(largeEntry.message.length).toBe(largePayload.length);
    expect(largeEntry.location.length).toBe(longLocation.length);
    expect(largeEntry.operation.length).toBe(longOperation.length);
    expect(deepEntry.message).toBe("[object Object]");
  });
});

describe("reportSilentError", () => {
  it("forwards to silentErrors.report with default category", () => {
    const spy = vi.spyOn(silentErrors, "report").mockImplementation(() => {});

    reportSilentError("oops", "Module.method");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("oops", {
      location: "Module.method",
      category: ErrorCategory.RECOVERABLE,
    });
  });

  it("forwards provided category", () => {
    const spy = vi.spyOn(silentErrors, "report").mockImplementation(() => {});

    reportSilentError("oops", "Module.method", ErrorCategory.CRITICAL);

    expect(spy).toHaveBeenCalledWith("oops", {
      location: "Module.method",
      category: ErrorCategory.CRITICAL,
    });
  });
});

describe("createScopedReporter", () => {
  it("prefixes module name for locations", () => {
    const spy = vi.spyOn(silentErrors, "report").mockImplementation(() => {});
    const scoped = createScopedReporter("MyModule");

    scoped.report("oops", "doWork");

    expect(spy).toHaveBeenCalledWith("oops", {
      location: "MyModule.doWork",
      category: ErrorCategory.RECOVERABLE,
    });
  });

  it("forwards provided category", () => {
    const spy = vi.spyOn(silentErrors, "report").mockImplementation(() => {});
    const scoped = createScopedReporter("MyModule");

    scoped.report("oops", "doWork", ErrorCategory.DEGRADED);

    expect(spy).toHaveBeenCalledWith("oops", {
      location: "MyModule.doWork",
      category: ErrorCategory.DEGRADED,
    });
  });
});
