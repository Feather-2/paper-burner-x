import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

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
      assert.equal(ErrorCategory.RECOVERABLE, "recoverable");
    });

    it("has DEGRADED category", () => {
      assert.equal(ErrorCategory.DEGRADED, "degraded");
    });

    it("has CRITICAL category", () => {
      assert.equal(ErrorCategory.CRITICAL, "critical");
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
        assert.ok(reporter.isEnabled());
        assert.equal(reporter.size, 0);
      });

      it("respects enabled option", () => {
        const disabled = new SilentErrorReporter({ enabled: false });
        assert.ok(!disabled.isEnabled());
      });

      it("respects maxSamples option", () => {
        const small = new SilentErrorReporter({ maxSamples: 5 });
        for (let i = 0; i < 10; i++) {
          small.report(new Error(`Error ${i}`), { location: "test" });
        }
        assert.equal(small.size, 5);
      });

      it("calls onError callback", () => {
        let called = false;
        const withCallback = new SilentErrorReporter({
          onError: () => { called = true; },
        });
        withCallback.report(new Error("test"), { location: "test" });
        assert.ok(called);
      });

      it("ignores callback errors", () => {
        const withBadCallback = new SilentErrorReporter({
          onError: () => { throw new Error("callback error"); },
        });
        // Should not throw
        withBadCallback.report(new Error("test"), { location: "test" });
        assert.equal(withBadCallback.size, 1);
      });
    });

    describe("setEnabled/isEnabled", () => {
      it("enables and disables reporting", () => {
        reporter.setEnabled(false);
        assert.ok(!reporter.isEnabled());
        reporter.setEnabled(true);
        assert.ok(reporter.isEnabled());
      });

      it("does not collect when disabled", () => {
        reporter.setEnabled(false);
        reporter.report(new Error("test"), { location: "test" });
        assert.equal(reporter.size, 0);
      });
    });

    describe("report", () => {
      it("reports Error object", () => {
        const error = new Error("Test error");
        reporter.report(error, { location: "TestModule.method" });
        assert.equal(reporter.size, 1);
        const samples = reporter.export();
        assert.equal(samples[0].message, "Test error");
        assert.equal(samples[0].location, "TestModule.method");
      });

      it("reports non-Error value", () => {
        reporter.report("string error", { location: "test" });
        const samples = reporter.export();
        assert.equal(samples[0].message, "string error");
      });

      it("uses default category", () => {
        reporter.report(new Error("test"), { location: "test" });
        const samples = reporter.export();
        assert.equal(samples[0].category, ErrorCategory.RECOVERABLE);
      });

      it("respects custom category", () => {
        reporter.report(new Error("test"), {
          location: "test",
          category: ErrorCategory.CRITICAL,
        });
        const samples = reporter.export();
        assert.equal(samples[0].category, ErrorCategory.CRITICAL);
      });

      it("includes operation", () => {
        reporter.report(new Error("test"), {
          location: "test",
          operation: "readFile",
        });
        const samples = reporter.export();
        assert.equal(samples[0].operation, "readFile");
      });

      it("includes timestamp", () => {
        const before = Date.now();
        reporter.report(new Error("test"), { location: "test" });
        const after = Date.now();
        const samples = reporter.export();
        assert.ok(samples[0].ts >= before);
        assert.ok(samples[0].ts <= after);
      });

      it("truncates stack to 3 lines", () => {
        const error = new Error("test");
        reporter.report(error, { location: "test" });
        const samples = reporter.export();
        if (samples[0].stack) {
          const lines = samples[0].stack.split("\n");
          assert.ok(lines.length <= 3);
        }
      });

      it("implements ring buffer", () => {
        const small = new SilentErrorReporter({ maxSamples: 3 });
        small.report(new Error("1"), { location: "test" });
        small.report(new Error("2"), { location: "test" });
        small.report(new Error("3"), { location: "test" });
        small.report(new Error("4"), { location: "test" });
        const samples = small.export();
        assert.equal(samples.length, 3);
        assert.equal(samples[0].message, "2");
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
        assert.equal(stats.total, 3);
      });

      it("groups by category", () => {
        const stats = reporter.getStats();
        assert.equal(stats.byCategory[ErrorCategory.RECOVERABLE], 2);
        assert.equal(stats.byCategory[ErrorCategory.CRITICAL], 1);
      });

      it("groups by location", () => {
        const stats = reporter.getStats();
        assert.equal(stats.byLocation["ModuleA.methodA"], 1);
        assert.equal(stats.byLocation["ModuleA.methodB"], 1);
        assert.equal(stats.byLocation["ModuleB.methodA"], 1);
      });
    });

    describe("export", () => {
      it("returns copy of samples", () => {
        reporter.report(new Error("test"), { location: "test" });
        const samples = reporter.export();
        samples.push({ message: "fake" });
        assert.equal(reporter.size, 1);
      });

      it("returns empty array when no samples", () => {
        const samples = reporter.export();
        assert.deepEqual(samples, []);
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
        assert.equal(recent.length, 5);
        assert.equal(recent[0].message, "Error 14");
        assert.equal(recent[4].message, "Error 10");
      });

      it("uses default limit of 10", () => {
        const recent = reporter.getRecent();
        assert.equal(recent.length, 10);
      });

      it("returns all if fewer than limit", () => {
        const small = new SilentErrorReporter();
        small.report(new Error("a"), { location: "test" });
        small.report(new Error("b"), { location: "test" });
        const recent = small.getRecent(10);
        assert.equal(recent.length, 2);
      });
    });

    describe("clear", () => {
      it("removes all samples", () => {
        reporter.report(new Error("test"), { location: "test" });
        reporter.clear();
        assert.equal(reporter.size, 0);
      });
    });

    describe("size", () => {
      it("returns sample count", () => {
        assert.equal(reporter.size, 0);
        reporter.report(new Error("test"), { location: "test" });
        assert.equal(reporter.size, 1);
      });
    });
  });

  describe("silentErrors singleton", () => {
    it("is a SilentErrorReporter instance", () => {
      assert.ok(silentErrors instanceof SilentErrorReporter);
    });
  });

  describe("reportSilentError", () => {
    beforeEach(() => {
      silentErrors.clear();
    });

    it("reports error to singleton", () => {
      reportSilentError(new Error("test"), "MyModule.method");
      assert.ok(silentErrors.size > 0);
    });

    it("uses default category", () => {
      reportSilentError(new Error("test"), "test");
      const samples = silentErrors.export();
      assert.equal(samples[samples.length - 1].category, ErrorCategory.RECOVERABLE);
    });

    it("accepts custom category", () => {
      reportSilentError(new Error("test"), "test", ErrorCategory.CRITICAL);
      const samples = silentErrors.export();
      assert.equal(samples[samples.length - 1].category, ErrorCategory.CRITICAL);
    });
  });

  describe("createScopedReporter", () => {
    beforeEach(() => {
      silentErrors.clear();
    });

    it("creates scoped reporter", () => {
      const scoped = createScopedReporter("MyModule");
      assert.ok(scoped);
      assert.equal(typeof scoped.report, "function");
    });

    it("prefixes location with module name", () => {
      const scoped = createScopedReporter("MyModule");
      scoped.report(new Error("test"), "doSomething");
      const samples = silentErrors.export();
      assert.ok(samples[samples.length - 1].location.includes("MyModule.doSomething"));
    });

    it("accepts category parameter", () => {
      const scoped = createScopedReporter("MyModule");
      scoped.report(new Error("test"), "method", ErrorCategory.DEGRADED);
      const samples = silentErrors.export();
      assert.equal(samples[samples.length - 1].category, ErrorCategory.DEGRADED);
    });
  });
});
