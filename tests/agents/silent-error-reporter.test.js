
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  ErrorCategory,
  SilentErrorReporter,
  silentErrors,
  reportSilentError,
  createScopedReporter,
} from "../../js/agents/runtime/errors/silent-error-reporter.js";

describe("runtime/errors/silent-error-reporter", () => {
  describe("ErrorCategory", () => {
    it("has RECOVERABLE category", () => {
      expect(ErrorCategory.RECOVERABLE).toBe("recoverable");
    });

    it("has DEGRADED category", () => {
      expect(ErrorCategory.DEGRADED).toBe("degraded");
    });

    it("has CRITICAL category", () => {
      expect(ErrorCategory.CRITICAL).toBe("critical");
    });
  });

  describe("SilentErrorReporter", () => {
    /** @type {SilentErrorReporter} */
    let reporter;

    beforeEach(() => {
      reporter = new SilentErrorReporter();
    });

    describe("constructor", () => {
      it("creates with default options", () => {
        expect(reporter.isEnabled()).toBe(true);
        expect(reporter.size).toBe(0);
      });

      it("respects enabled option", () => {
        const disabled = new SilentErrorReporter({ enabled: false });
        expect(disabled.isEnabled()).toBe(false);
      });

      it("respects maxSamples option", () => {
        const small = new SilentErrorReporter({ maxSamples: 5 });
        for (let i = 0; i < 10; i++) {
          small.report(new Error(`Error ${i}`), { location: "test" });
        }
        expect(small.size).toBe(5);
      });

      it("calls onError callback", () => {
        let called = false;
        const withCallback = new SilentErrorReporter({
          onError: () => { called = true; },
        });
        withCallback.report(new Error("test"), { location: "test" });
        expect(called).toBe(true);
      });

      it("ignores callback errors", () => {
        const withBadCallback = new SilentErrorReporter({
          onError: () => { throw new Error("callback error"); },
        });
        // Should not throw
        withBadCallback.report(new Error("test"), { location: "test" });
        expect(withBadCallback.size).toBe(1);
      });
    });

    describe("setEnabled/isEnabled", () => {
      it("enables and disables reporting", () => {
        reporter.setEnabled(false);
        expect(reporter.isEnabled()).toBe(false);
        reporter.setEnabled(true);
        expect(reporter.isEnabled()).toBe(true);
      });

      it("does not collect when disabled", () => {
        reporter.setEnabled(false);
        reporter.report(new Error("test"), { location: "test" });
        expect(reporter.size).toBe(0);
      });
    });

    describe("report", () => {
      it("reports Error object", () => {
        const error = new Error("Test error");
        reporter.report(error, { location: "TestModule.method" });
        expect(reporter.size).toBe(1);
        const samples = reporter.export();
        expect(samples[0].message).toBe("Test error");
        expect(samples[0].location).toBe("TestModule.method");
      });

      it("reports non-Error value", () => {
        reporter.report("string error", { location: "test" });
        const samples = reporter.export();
        expect(samples[0].message).toBe("string error");
      });

      it("uses default category", () => {
        reporter.report(new Error("test"), { location: "test" });
        const samples = reporter.export();
        expect(samples[0].category).toBe(ErrorCategory.RECOVERABLE);
      });

      it("respects custom category", () => {
        reporter.report(new Error("test"), {
          location: "test",
          category: ErrorCategory.CRITICAL,
        });
        const samples = reporter.export();
        expect(samples[0].category).toBe(ErrorCategory.CRITICAL);
      });

      it("includes operation", () => {
        reporter.report(new Error("test"), {
          location: "test",
          operation: "readFile",
        });
        const samples = reporter.export();
        expect(samples[0].operation).toBe("readFile");
      });

      it("includes timestamp", () => {
        const before = Date.now();
        reporter.report(new Error("test"), { location: "test" });
        const after = Date.now();
        const samples = reporter.export();
        expect(samples[0].ts).toBeGreaterThanOrEqual(before);
        expect(samples[0].ts).toBeLessThanOrEqual(after);
      });

      it("truncates stack to 3 lines", () => {
        const error = new Error("test");
        reporter.report(error, { location: "test" });
        const samples = reporter.export();
        if (samples[0].stack) {
          const lines = samples[0].stack.split("\n");
          expect(lines.length).toBeLessThanOrEqual(3);
        }
      });

      it("implements ring buffer", () => {
        const small = new SilentErrorReporter({ maxSamples: 3 });
        small.report(new Error("1"), { location: "test" });
        small.report(new Error("2"), { location: "test" });
        small.report(new Error("3"), { location: "test" });
        small.report(new Error("4"), { location: "test" });
        const samples = small.export();
        expect(samples.length).toBe(3);
        expect(samples[0].message).toBe("2");
      });
    });

    describe("getStats", () => {
      beforeEach(() => {
        reporter.report(new Error("a"), {
          location: "ModuleA.methodA",
          category: ErrorCategory.RECOVERABLE,
        });
        reporter.report(new Error("b"), {
          location: "ModuleA.methodB",
          category: ErrorCategory.RECOVERABLE,
        });
        reporter.report(new Error("c"), {
          location: "ModuleB.methodA",
          category: ErrorCategory.CRITICAL,
        });
      });

      it("returns total count", () => {
        const stats = reporter.getStats();
        expect(stats.total).toBe(3);
      });

      it("groups by category", () => {
        const stats = reporter.getStats();
        expect(stats.byCategory[ErrorCategory.RECOVERABLE]).toBe(2);
        expect(stats.byCategory[ErrorCategory.CRITICAL]).toBe(1);
      });

      it("groups by location", () => {
        const stats = reporter.getStats();
        expect(stats.byLocation["ModuleA.methodA"]).toBe(1);
        expect(stats.byLocation["ModuleA.methodB"]).toBe(1);
        expect(stats.byLocation["ModuleB.methodA"]).toBe(1);
      });
    });

    describe("export", () => {
      it("returns copy of samples", () => {
        reporter.report(new Error("test"), { location: "test" });
        const samples = reporter.export();
        samples.push({ message: "fake" });
        expect(reporter.size).toBe(1);
      });

      it("returns empty array when no samples", () => {
        const samples = reporter.export();
        expect(samples).toEqual([]);
      });
    });

    describe("getRecent", () => {
      beforeEach(() => {
        for (let i = 0; i < 15; i++) {
          reporter.report(new Error(`Error ${i}`), { location: "test" });
        }
      });

      it("returns most recent errors first", () => {
        const recent = reporter.getRecent(5);
        expect(recent.length).toBe(5);
        expect(recent[0].message).toBe("Error 14");
        expect(recent[4].message).toBe("Error 10");
      });

      it("uses default limit of 10", () => {
        const recent = reporter.getRecent();
        expect(recent.length).toBe(10);
      });

      it("returns all if fewer than limit", () => {
        const small = new SilentErrorReporter();
        small.report(new Error("a"), { location: "test" });
        small.report(new Error("b"), { location: "test" });
        const recent = small.getRecent(10);
        expect(recent.length).toBe(2);
      });
    });

    describe("clear", () => {
      it("removes all samples", () => {
        reporter.report(new Error("test"), { location: "test" });
        reporter.clear();
        expect(reporter.size).toBe(0);
      });
    });

    describe("size", () => {
      it("returns sample count", () => {
        expect(reporter.size).toBe(0);
        reporter.report(new Error("test"), { location: "test" });
        expect(reporter.size).toBe(1);
      });
    });
  });

  describe("silentErrors singleton", () => {
    it("is a SilentErrorReporter instance", () => {
      expect(silentErrors).toBeInstanceOf(SilentErrorReporter);
    });
  });

  describe("reportSilentError", () => {
    beforeEach(() => {
      silentErrors.clear();
    });

    it("reports error to singleton", () => {
      reportSilentError(new Error("test"), "MyModule.method");
      expect(silentErrors.size).toBeGreaterThan(0);
    });

    it("uses default category", () => {
      reportSilentError(new Error("test"), "test");
      const samples = silentErrors.export();
      expect(samples[samples.length - 1].category).toBe(ErrorCategory.RECOVERABLE);
    });

    it("accepts custom category", () => {
      reportSilentError(new Error("test"), "test", ErrorCategory.CRITICAL);
      const samples = silentErrors.export();
      expect(samples[samples.length - 1].category).toBe(ErrorCategory.CRITICAL);
    });
  });

  describe("createScopedReporter", () => {
    beforeEach(() => {
      silentErrors.clear();
    });

    it("creates scoped reporter", () => {
      const scoped = createScopedReporter("MyModule");
      expect(scoped).toBeTypeOf("object");
      expect(typeof scoped.report).toBe("function");
    });

    it("prefixes location with module name", () => {
      const scoped = createScopedReporter("MyModule");
      scoped.report(new Error("test"), "doSomething");
      const samples = silentErrors.export();
      expect(samples[samples.length - 1].location).toContain("MyModule.doSomething");
    });

    it("accepts category parameter", () => {
      const scoped = createScopedReporter("MyModule");
      scoped.report(new Error("test"), "method", ErrorCategory.DEGRADED);
      const samples = silentErrors.export();
      expect(samples[samples.length - 1].category).toBe(ErrorCategory.DEGRADED);
    });
  });
});
