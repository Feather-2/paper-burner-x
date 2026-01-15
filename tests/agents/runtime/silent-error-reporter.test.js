/**
 * Unit tests for SilentErrorReporter
 */
import test from "node:test";
import assert from "node:assert/strict";

test("SilentErrorReporter: basic report and export", async () => {
  const { SilentErrorReporter, ErrorCategory } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  const err = new Error("Test error");

  reporter.report(err, { location: "TestModule.testMethod" });

  const exported = reporter.export();
  assert.equal(exported.length, 1);
  assert.equal(exported[0].message, "Test error");
  assert.equal(exported[0].location, "TestModule.testMethod");
  assert.equal(exported[0].category, ErrorCategory.RECOVERABLE);
  assert.ok(exported[0].ts > 0);
  assert.ok(exported[0].stack);
});

test("SilentErrorReporter: respects category parameter", async () => {
  const { SilentErrorReporter, ErrorCategory } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
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
  assert.equal(exported[0].category, ErrorCategory.CRITICAL);
  assert.equal(exported[1].category, ErrorCategory.DEGRADED);
});

test("SilentErrorReporter: ring buffer behavior", async () => {
  const { SilentErrorReporter } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter({ maxSamples: 3 });

  reporter.report(new Error("Error 1"), { location: "loc1" });
  reporter.report(new Error("Error 2"), { location: "loc2" });
  reporter.report(new Error("Error 3"), { location: "loc3" });
  reporter.report(new Error("Error 4"), { location: "loc4" });

  const exported = reporter.export();
  assert.equal(exported.length, 3);
  assert.equal(exported[0].message, "Error 2");
  assert.equal(exported[2].message, "Error 4");
});

test("SilentErrorReporter: getStats aggregates correctly", async () => {
  const { SilentErrorReporter, ErrorCategory } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();

  reporter.report(new Error("E1"), { location: "A", category: ErrorCategory.CRITICAL });
  reporter.report(new Error("E2"), { location: "A", category: ErrorCategory.CRITICAL });
  reporter.report(new Error("E3"), { location: "B", category: ErrorCategory.RECOVERABLE });

  const stats = reporter.getStats();
  assert.equal(stats.total, 3);
  assert.equal(stats.byLocation["A"], 2);
  assert.equal(stats.byLocation["B"], 1);
  assert.equal(stats.byCategory[ErrorCategory.CRITICAL], 2);
  assert.equal(stats.byCategory[ErrorCategory.RECOVERABLE], 1);
});

test("SilentErrorReporter: onError callback", async () => {
  const { SilentErrorReporter } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const received = [];
  const reporter = new SilentErrorReporter({
    onError: (entry) => received.push(entry),
  });

  reporter.report(new Error("Test"), { location: "Callback.test" });

  assert.equal(received.length, 1);
  assert.equal(received[0].message, "Test");
  assert.equal(received[0].location, "Callback.test");
});

test("SilentErrorReporter: disabled mode", async () => {
  const { SilentErrorReporter } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter({ enabled: false });
  reporter.report(new Error("Should not be recorded"), { location: "X" });

  assert.equal(reporter.export().length, 0);

  reporter.setEnabled(true);
  reporter.report(new Error("Should be recorded"), { location: "Y" });
  assert.equal(reporter.export().length, 1);
});

test("SilentErrorReporter: getRecent returns newest first", async () => {
  const { SilentErrorReporter } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  reporter.report(new Error("First"), { location: "A" });
  reporter.report(new Error("Second"), { location: "B" });
  reporter.report(new Error("Third"), { location: "C" });

  const recent = reporter.getRecent(2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].message, "Third");
  assert.equal(recent[1].message, "Second");
});

test("SilentErrorReporter: clear removes all samples", async () => {
  const { SilentErrorReporter } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  reporter.report(new Error("E1"), { location: "X" });
  reporter.report(new Error("E2"), { location: "Y" });
  assert.equal(reporter.size, 2);

  reporter.clear();
  assert.equal(reporter.size, 0);
  assert.equal(reporter.export().length, 0);
});

test("SilentErrorReporter: handles non-Error objects", async () => {
  const { SilentErrorReporter } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  reporter.report("string error", { location: "StringTest" });
  reporter.report({ custom: "error" }, { location: "ObjectTest" });
  reporter.report(null, { location: "NullTest" });

  const exported = reporter.export();
  assert.equal(exported.length, 3);
  assert.equal(exported[0].message, "string error");
  assert.equal(exported[1].message, "[object Object]");
  assert.equal(exported[2].message, "null");
});

test("reportSilentError: convenience function", async () => {
  const { silentErrors, reportSilentError, ErrorCategory } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  silentErrors.clear();

  reportSilentError(new Error("Convenience test"), "ConvenienceModule");
  reportSilentError(new Error("With category"), "Module2", ErrorCategory.DEGRADED);

  const exported = silentErrors.export();
  assert.equal(exported.length, 2);
  assert.equal(exported[0].location, "ConvenienceModule");
  assert.equal(exported[0].category, ErrorCategory.RECOVERABLE);
  assert.equal(exported[1].category, ErrorCategory.DEGRADED);

  silentErrors.clear();
});

test("createScopedReporter: creates module-scoped reporter", async () => {
  const { silentErrors, createScopedReporter, ErrorCategory } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  silentErrors.clear();

  const scoped = createScopedReporter("MyModule");
  scoped.report(new Error("Scoped error"), "methodA");
  scoped.report(new Error("Critical"), "methodB", ErrorCategory.CRITICAL);

  const exported = silentErrors.export();
  assert.equal(exported.length, 2);
  assert.equal(exported[0].location, "MyModule.methodA");
  assert.equal(exported[1].location, "MyModule.methodB");
  assert.equal(exported[1].category, ErrorCategory.CRITICAL);

  silentErrors.clear();
});

test("SilentErrorReporter: onError callback error is swallowed", async () => {
  const { SilentErrorReporter } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter({
    onError: () => {
      throw new Error("Callback throws");
    },
  });

  // Should not throw
  reporter.report(new Error("Test"), { location: "Safe" });
  assert.equal(reporter.size, 1);
});

test("SilentErrorReporter: stack trace truncation", async () => {
  const { SilentErrorReporter } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  const reporter = new SilentErrorReporter();
  const err = new Error("Deep stack");
  reporter.report(err, { location: "StackTest" });

  const exported = reporter.export();
  const stackLines = exported[0].stack.split("\n");
  assert.ok(stackLines.length <= 3, "Stack should be truncated to 3 lines");
});

test("ErrorCategory: enum values", async () => {
  const { ErrorCategory } = await import(
    "../../../js/agents/runtime/errors/silent-error-reporter.js"
  );

  assert.equal(ErrorCategory.RECOVERABLE, "recoverable");
  assert.equal(ErrorCategory.DEGRADED, "degraded");
  assert.equal(ErrorCategory.CRITICAL, "critical");
});
