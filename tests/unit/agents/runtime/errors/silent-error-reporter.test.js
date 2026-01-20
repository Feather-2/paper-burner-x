/**
 * Unit tests for SilentErrorReporter
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

it("SilentErrorReporter: basic report and export", async () => {
  const { SilentErrorReporter, ErrorCategory } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  const err = new Error("Test error");

  reporter.report(err, { location: "TestModule.testMethod" });

  const exported = reporter.export();
  expect(exported.length).toBe(1);
  expect(exported[0].message).toBe("Test error");
  expect(exported[0].location).toBe("TestModule.testMethod");
  expect(exported[0].category).toBe(ErrorCategory.RECOVERABLE);
  expect(exported[0].ts).toBeTypeOf("number");
  expect(exported[0].ts).toBeGreaterThan(0);
  expect(exported[0].stack).toBeTypeOf("string");
  expect(exported[0].stack).toContain("Test error");
});

it("SilentErrorReporter: respects category parameter", async () => {
  const { SilentErrorReporter, ErrorCategory } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();

  reporter.report(new Error("Critical"), {
    location: "Module.method",
    category: ErrorCategory.CRITICAL,
  });
  reporter.report(new Error("Degraded"), {
    location: "Module.method2",
    category: ErrorCategory.DEGRADED,
  });

  const exported = reporter.export();
  expect(exported[0].category).toBe(ErrorCategory.CRITICAL);
  expect(exported[1].category).toBe(ErrorCategory.DEGRADED);
});

it("SilentErrorReporter: ring buffer behavior", async () => {
  const { SilentErrorReporter } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter({ maxSamples: 3 });

  reporter.report(new Error("Error 1"), { location: "loc1" });
  reporter.report(new Error("Error 2"), { location: "loc2" });
  reporter.report(new Error("Error 3"), { location: "loc3" });
  reporter.report(new Error("Error 4"), { location: "loc4" });

  const exported = reporter.export();
  expect(exported.length).toBe(3);
  expect(exported[0].message).toBe("Error 2");
  expect(exported[2].message).toBe("Error 4");
});

it("SilentErrorReporter: getStats aggregates correctly", async () => {
  const { SilentErrorReporter, ErrorCategory } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();

  reporter.report(new Error("E1"), { location: "A", category: ErrorCategory.CRITICAL });
  reporter.report(new Error("E2"), { location: "A", category: ErrorCategory.CRITICAL });
  reporter.report(new Error("E3"), { location: "B", category: ErrorCategory.RECOVERABLE });

  const stats = reporter.getStats();
  expect(stats.total).toBe(3);
  expect(stats.byLocation["A"]).toBe(2);
  expect(stats.byLocation["B"]).toBe(1);
  expect(stats.byCategory[ErrorCategory.CRITICAL]).toBe(2);
  expect(stats.byCategory[ErrorCategory.RECOVERABLE]).toBe(1);
});

it("SilentErrorReporter: onError callback", async () => {
  const { SilentErrorReporter } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const received = [];
  const reporter = new SilentErrorReporter({
    onError: (entry) => received.push(entry),
  });

  reporter.report(new Error("Test"), { location: "Callback.test" });

  expect(received.length).toBe(1);
  expect(received[0].message).toBe("Test");
  expect(received[0].location).toBe("Callback.test");
});

it("SilentErrorReporter: disabled mode", async () => {
  const { SilentErrorReporter } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter({ enabled: false });
  reporter.report(new Error("Should not be recorded"), { location: "X" });

  expect(reporter.export().length).toBe(0);

  reporter.setEnabled(true);
  reporter.report(new Error("Should be recorded"), { location: "Y" });
  expect(reporter.export().length).toBe(1);
});

it("SilentErrorReporter: getRecent returns newest first", async () => {
  const { SilentErrorReporter } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  reporter.report(new Error("First"), { location: "A" });
  reporter.report(new Error("Second"), { location: "B" });
  reporter.report(new Error("Third"), { location: "C" });

  const recent = reporter.getRecent(2);
  expect(recent.length).toBe(2);
  expect(recent[0].message).toBe("Third");
  expect(recent[1].message).toBe("Second");
});

it("SilentErrorReporter: clear removes all samples", async () => {
  const { SilentErrorReporter } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  reporter.report(new Error("E1"), { location: "X" });
  reporter.report(new Error("E2"), { location: "Y" });
  expect(reporter.size).toBe(2);

  reporter.clear();
  expect(reporter.size).toBe(0);
  expect(reporter.export().length).toBe(0);
});

it("SilentErrorReporter: handles non-Error objects", async () => {
  const { SilentErrorReporter } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  reporter.report("string error", { location: "StringTest" });
  reporter.report({ custom: "error" }, { location: "ObjectTest" });
  reporter.report(null, { location: "NullTest" });

  const exported = reporter.export();
  expect(exported.length).toBe(3);
  expect(exported[0].message).toBe("string error");
  expect(exported[1].message).toBe("[object Object]");
  expect(exported[2].message).toBe("null");
});

it("reportSilentError: convenience function", async () => {
  const { silentErrors, reportSilentError, ErrorCategory } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  silentErrors.clear();

  reportSilentError(new Error("Convenience test"), "ConvenienceModule");
  reportSilentError(new Error("With category"), "Module2", ErrorCategory.DEGRADED);

  const exported = silentErrors.export();
  expect(exported.length).toBe(2);
  expect(exported[0].location).toBe("ConvenienceModule");
  expect(exported[0].category).toBe(ErrorCategory.RECOVERABLE);
  expect(exported[1].category).toBe(ErrorCategory.DEGRADED);

  silentErrors.clear();
});

it("createScopedReporter: creates module-scoped reporter", async () => {
  const { silentErrors, createScopedReporter, ErrorCategory } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  silentErrors.clear();

  const scoped = createScopedReporter("MyModule");
  scoped.report(new Error("Scoped error"), "methodA");
  scoped.report(new Error("Critical"), "methodB", ErrorCategory.CRITICAL);

  const exported = silentErrors.export();
  expect(exported.length).toBe(2);
  expect(exported[0].location).toBe("MyModule.methodA");
  expect(exported[1].location).toBe("MyModule.methodB");
  expect(exported[1].category).toBe(ErrorCategory.CRITICAL);

  silentErrors.clear();
});

it("SilentErrorReporter: onError callback error is swallowed", async () => {
  const { SilentErrorReporter } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter({
    onError: () => {
      throw new Error("Callback throws");
    },
  });

  // Should not throw
  reporter.report(new Error("Test"), { location: "Safe" });
  expect(reporter.size).toBe(1);
});

it("SilentErrorReporter: stack trace truncation", async () => {
  const { SilentErrorReporter } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  const err = new Error("Deep stack");
  reporter.report(err, { location: "StackTest" });

  const exported = reporter.export();
  const stackLines = exported[0].stack.split("\n");
  expect(stackLines.length).toBeLessThanOrEqual(3);
});

it("ErrorCategory: enum values", async () => {
  const { ErrorCategory } = await import(
    "../../../../../js/agents/runtime/core/errors/silent-error-reporter.js"
  );

  expect(ErrorCategory.RECOVERABLE).toBe("recoverable");
  expect(ErrorCategory.DEGRADED).toBe("degraded");
  expect(ErrorCategory.CRITICAL).toBe("critical");
});
