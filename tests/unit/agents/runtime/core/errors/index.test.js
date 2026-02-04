import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/runtime/core/errors/silent-error-reporter.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };
});

import {
  SilentErrorReporter,
  ErrorCategory,
  silentErrors,
  reportSilentError,
  createScopedReporter,
} from "../../../../../../js/agents/runtime/core/errors/index.js";

beforeEach(() => {
  vi.restoreAllMocks();
  silentErrors.clear();
  silentErrors.setEnabled(true);
});

describe("SilentErrorReporter", () => {
  it("records errors with valid context and truncates stack", () => {
    const reporter = new SilentErrorReporter();
    const err = new Error("boom");
    err.stack = "line1\nline2\nline3\nline4";
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);

    reporter.report(err, {
      location: "Module.method",
      category: ErrorCategory.CRITICAL,
      operation: "op",
    });

    const exported = reporter.export();
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      message: "boom",
      location: "Module.method",
      category: ErrorCategory.CRITICAL,
      operation: "op",
      ts: 123456,
    });
    expect(exported[0].stack).toBe("line1\nline2\nline3");
    nowSpy.mockRestore();
  });

  it("handles invalid contexts and edge-case error values", () => {
    const reporter = new SilentErrorReporter();
    const cases = [
      { error: null, context: null, expectedMessage: "null", expectedLocation: "unknown" },
      { error: undefined, context: undefined, expectedMessage: "undefined", expectedLocation: "unknown" },
      { error: "", context: { location: "" }, expectedMessage: "", expectedLocation: "unknown" },
      { error: [], context: [], expectedMessage: "", expectedLocation: "unknown" },
      { error: {}, context: {}, expectedMessage: "[object Object]", expectedLocation: "unknown" },
      { error: "space", context: { location: "   " }, expectedMessage: "space", expectedLocation: "   " },
      {
        error: "cat",
        context: { location: "", category: ErrorCategory.DEGRADED, operation: "op" },
        expectedMessage: "cat",
        expectedLocation: "unknown",
        expectedCategory: ErrorCategory.DEGRADED,
        expectedOperation: "op",
      },
    ];

    for (const testCase of cases) {
      reporter.report(testCase.error, testCase.context);
    }

    const exported = reporter.export();
    expect(exported).toHaveLength(cases.length);
    exported.forEach((entry, index) => {
      const expected = cases[index];
      expect(entry.message).toBe(expected.expectedMessage);
      expect(entry.location).toBe(expected.expectedLocation);
      if (expected.expectedCategory) {
        expect(entry.category).toBe(expected.expectedCategory);
      } else {
        expect(entry.category).toBe(ErrorCategory.RECOVERABLE);
      }
      if (Object.prototype.hasOwnProperty.call(expected, "expectedOperation")) {
        expect(entry.operation).toBe(expected.expectedOperation);
      }
    });
  });

  it("validates maxSamples boundaries and maintains ring buffer", () => {
    const reporterZero = new SilentErrorReporter({ maxSamples: 0 });
    for (let i = 0; i < 101; i += 1) {
      reporterZero.report(new Error(`e${i}`), { location: "zero" });
    }
    expect(reporterZero.size).toBe(100);

    const reporterNegative = new SilentErrorReporter({ maxSamples: -1 });
    for (let i = 0; i < 101; i += 1) {
      reporterNegative.report(new Error(`n${i}`), { location: "negative" });
    }
    expect(reporterNegative.size).toBe(100);

    const reporterString = new SilentErrorReporter({ maxSamples: "5" });
    for (let i = 0; i < 101; i += 1) {
      reporterString.report(new Error(`s${i}`), { location: "string" });
    }
    expect(reporterString.size).toBe(100);

    const reporterMax = new SilentErrorReporter({ maxSamples: Number.MAX_SAFE_INTEGER });
    for (let i = 0; i < 10005; i += 1) {
      reporterMax.report(new Error(`m${i}`), { location: "max" });
    }
    expect(reporterMax.size).toBe(10000);
    const maxExported = reporterMax.export();
    expect(maxExported[0].message).toBe("m5");

    const ring = new SilentErrorReporter({ maxSamples: 2 });
    ring.report(new Error("old"), { location: "ring" });
    ring.report(new Error("mid"), { location: "ring" });
    ring.report(new Error("new"), { location: "ring" });
    const ringExport = ring.export();
    expect(ringExport).toHaveLength(2);
    expect(ringExport[0].message).toBe("mid");
    expect(ringExport[1].message).toBe("new");
  });

  it("supports concurrent and rapid reports with flexible getRecent limits", async () => {
    const reporter = new SilentErrorReporter();

    await Promise.all([
      Promise.resolve().then(() => reporter.report(new Error("A"), { location: "A" })),
      Promise.resolve().then(() => reporter.report(new Error("B"), { location: "B" })),
    ]);

    for (let i = 0; i < 5; i += 1) {
      reporter.report(new Error(`fast-${i}`), { location: "rapid" });
    }

    expect(reporter.size).toBe(7);

    const recent = reporter.getRecent({});
    const messages = recent.map((entry) => entry.message);
    expect(messages[0]).toBe("fast-4");
    expect(messages).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("does not throw when onError callback fails", () => {
    const onError = vi.fn(() => {
      throw new Error("callback failed");
    });

    const reporter = new SilentErrorReporter({ onError });

    expect(() => reporter.report(new Error("primary"), { location: "Callback.test" })).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);

    const exported = reporter.export();
    expect(exported).toHaveLength(1);
    expect(exported[0].message).toBe("primary");
    expect(exported[0].location).toBe("Callback.test");
  });

  it("handles resource-heavy inputs and deep nesting", () => {
    const reporter = new SilentErrorReporter();
    const hugeString = "x".repeat(200000);
    const longLocation = "loc-".repeat(5000);
    const deepOperation = { level: { next: { depth: { value: 42 } } } };

    reporter.report(new Error(hugeString), {
      location: longLocation,
      operation: deepOperation,
    });

    const exported = reporter.export();
    expect(exported).toHaveLength(1);
    expect(exported[0].message.length).toBe(hugeString.length);
    expect(exported[0].location).toBe(longLocation);
    expect(exported[0].operation).toBe(deepOperation);
  });

  it("skips dangerous keys when aggregating stats", () => {
    const reporter = new SilentErrorReporter();
    reporter.report(new Error("danger"), { location: "__proto__", category: "__proto__" });
    reporter.report(new Error("safe"), { location: "safe", category: ErrorCategory.RECOVERABLE });

    const stats = reporter.getStats();
    expect(stats.total).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(stats.byCategory, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stats.byLocation, "__proto__")).toBe(false);
    expect(stats.byCategory[ErrorCategory.RECOVERABLE]).toBe(1);
    expect(stats.byLocation.safe).toBe(1);
  });
});

describe("ErrorCategory", () => {
  it("exposes expected category values", () => {
    expect(ErrorCategory.RECOVERABLE).toBe("recoverable");
    expect(ErrorCategory.DEGRADED).toBe("degraded");
    expect(ErrorCategory.CRITICAL).toBe("critical");

    const values = Object.values(ErrorCategory);
    expect(values).toHaveLength(3);
    values.forEach((value) => expect(value).toMatch(/^[a-z]+$/));
  });
});

describe("silentErrors", () => {
  it("is a shared reporter instance that can record and clear", () => {
    expect(silentErrors).toBeInstanceOf(SilentErrorReporter);

    silentErrors.report(new Error("singleton"), { location: "SilentErrors.test" });
    expect(silentErrors.size).toBe(1);

    const exported = silentErrors.export();
    expect(exported).toHaveLength(1);
    expect(exported[0].location).toBe("SilentErrors.test");

    silentErrors.clear();
    expect(silentErrors.size).toBe(0);
  });

  it("respects enabled flag on the singleton", () => {
    silentErrors.setEnabled(false);
    silentErrors.report(new Error("blocked"), { location: "SilentErrors.blocked" });
    expect(silentErrors.size).toBe(0);

    silentErrors.setEnabled(true);
    silentErrors.report(new Error("allowed"), { location: "SilentErrors.allowed" });
    expect(silentErrors.size).toBe(1);
  });
});

describe("reportSilentError", () => {
  it("reports via silentErrors with default category", () => {
    const err = new Error("default category");
    const spy = vi.spyOn(silentErrors, "report");

    reportSilentError(err, "Report.default");

    expect(spy).toHaveBeenCalledWith(err, {
      location: "Report.default",
      category: ErrorCategory.RECOVERABLE,
    });

    const entry = silentErrors.getRecent(1)[0];
    expect(entry.location).toBe("Report.default");
    expect(entry.category).toBe(ErrorCategory.RECOVERABLE);
    spy.mockRestore();
  });

  it("handles invalid locations and disabled singleton", () => {
    silentErrors.setEnabled(false);
    reportSilentError(new Error("ignored"), "Disabled");
    expect(silentErrors.size).toBe(0);

    silentErrors.setEnabled(true);
    reportSilentError(new Error("null location"), null);
    const entry = silentErrors.getRecent(1)[0];
    expect(entry.location).toBe("unknown");
  });
});

describe("createScopedReporter", () => {
  it("prefixes module name and applies default category", () => {
    const scoped = createScopedReporter("ToolExecutor");
    scoped.report(new Error("scoped"), "run");

    const entry = silentErrors.getRecent(1)[0];
    expect(entry.location).toBe("ToolExecutor.run");
    expect(entry.category).toBe(ErrorCategory.RECOVERABLE);
  });

  it("handles edge module/method values with concurrent reports", async () => {
    const longName = "M".repeat(10000);
    const scopedLong = createScopedReporter(longName);
    const scopedEmpty = createScopedReporter("");
    const objectMethod = { toString: () => "obj" };

    await Promise.all([
      Promise.resolve().then(() => scopedLong.report(new Error("empty"), "")),
      Promise.resolve().then(() => scopedLong.report(new Error("array"), ["array"], ErrorCategory.DEGRADED)),
      Promise.resolve().then(() => scopedEmpty.report(new Error("object"), objectMethod, ErrorCategory.CRITICAL)),
    ]);

    const exported = silentErrors.export();
    expect(exported).toHaveLength(3);

    const byLocation = new Map(exported.map((entry) => [entry.location, entry.category]));
    expect(byLocation.get(`${longName}.`)).toBe(ErrorCategory.RECOVERABLE);
    expect(byLocation.get(`${longName}.array`)).toBe(ErrorCategory.DEGRADED);
    expect(byLocation.get(`.obj`)).toBe(ErrorCategory.CRITICAL);
  });
});
