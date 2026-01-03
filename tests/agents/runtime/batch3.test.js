const test = require("node:test");
const assert = require("node:assert/strict");

test("DeltaSync: hash and manifest", async (t) => {
  const {
    computeHash,
    buildManifest,
    computeDelta,
    detectConflicts,
    resolveConflicts,
    ConflictStrategy,
    DeltaSyncSession,
  } = await import("../../../js/agents/vfs/delta-sync.js");

  await t.test("computeHash produces consistent hash", async () => {
    const h1 = await computeHash("hello world");
    const h2 = await computeHash("hello world");
    assert.equal(h1, h2);

    const h3 = await computeHash("different");
    assert.notEqual(h1, h3);
  });

  await t.test("computeHash handles various input types", async () => {
    const text = "test data";
    const bytes = new TextEncoder().encode(text);
    const buffer = bytes.buffer;

    const h1 = await computeHash(text);
    const h2 = await computeHash(bytes);
    const h3 = await computeHash(buffer);

    assert.equal(h1, h2);
    assert.equal(h2, h3);
  });

  await t.test("computeHash rejects invalid input", async () => {
    await assert.rejects(computeHash(123), /must be string/);
  });

  await t.test("buildManifest creates correct structure", async () => {
    const files = [
      { path: "/a.txt", content: "content a" },
      { path: "/b.txt", content: "content b", mtime: 1000 },
    ];

    const manifest = await buildManifest(files);

    assert.ok(manifest.id.startsWith("manifest_"));
    assert.ok(manifest.ts > 0);
    assert.equal(manifest.files.size, 2);

    const aEntry = manifest.files.get("/a.txt");
    assert.ok(aEntry);
    assert.equal(aEntry.path, "/a.txt");
    assert.ok(aEntry.hash);
    assert.ok(aEntry.size > 0);

    const bEntry = manifest.files.get("/b.txt");
    assert.equal(bEntry.mtime, 1000);
  });

  await t.test("computeDelta detects changes", async () => {
    const base = await buildManifest([
      { path: "/a.txt", content: "a" },
      { path: "/b.txt", content: "b" },
      { path: "/c.txt", content: "c" },
    ]);

    const target = await buildManifest([
      { path: "/a.txt", content: "a modified" },
      { path: "/b.txt", content: "b" },
      { path: "/d.txt", content: "d" },
    ]);

    const delta = computeDelta(base, target);

    const modified = delta.find((d) => d.path === "/a.txt");
    assert.ok(modified);
    assert.equal(modified.type, "modify");

    const added = delta.find((d) => d.path === "/d.txt");
    assert.ok(added);
    assert.equal(added.type, "add");

    const deleted = delta.find((d) => d.path === "/c.txt");
    assert.ok(deleted);
    assert.equal(deleted.type, "delete");

    // /b.txt should not be in delta
    const unchanged = delta.find((d) => d.path === "/b.txt");
    assert.equal(unchanged, undefined);
  });

  await t.test("detectConflicts finds conflicts", () => {
    const localDelta = [
      { path: "/a.txt", type: "modify", hash: "local_hash" },
      { path: "/b.txt", type: "delete" },
    ];

    const remoteDelta = [
      { path: "/a.txt", type: "modify", hash: "remote_hash" },
      { path: "/b.txt", type: "modify", hash: "remote_b" },
    ];

    const conflicts = detectConflicts(localDelta, remoteDelta);

    assert.equal(conflicts.length, 2);
    assert.ok(conflicts.some((c) => c.path === "/a.txt"));
    assert.ok(conflicts.some((c) => c.path === "/b.txt"));
  });

  await t.test("resolveConflicts applies strategy", async () => {
    const conflicts = [{ path: "/a.txt", local: { type: "modify" }, remote: { type: "modify" } }];

    const localManifest = await buildManifest([{ path: "/a.txt", content: "local", mtime: 2000 }]);
    const remoteManifest = await buildManifest([{ path: "/a.txt", content: "remote", mtime: 1000 }]);

    const resolved1 = resolveConflicts(conflicts, ConflictStrategy.LOCAL_WINS, localManifest, remoteManifest);
    assert.equal(resolved1[0].resolution, "local");

    const resolved2 = resolveConflicts(conflicts, ConflictStrategy.REMOTE_WINS, localManifest, remoteManifest);
    assert.equal(resolved2[0].resolution, "remote");

    const resolved3 = resolveConflicts(conflicts, ConflictStrategy.NEWER_WINS, localManifest, remoteManifest);
    assert.equal(resolved3[0].resolution, "local"); // local has newer mtime
  });

  await t.test("DeltaSyncSession computes sync plan", async () => {
    const session = new DeltaSyncSession();

    const baseManifest = await buildManifest([
      { path: "/a.txt", content: "a" },
    ]);

    const localManifest = await buildManifest([
      { path: "/a.txt", content: "a modified locally" },
      { path: "/local.txt", content: "local only" },
    ]);

    const remoteManifest = await buildManifest([
      { path: "/a.txt", content: "a" },
      { path: "/remote.txt", content: "remote only" },
    ]);

    session.setBaseManifest(baseManifest);
    session.setLocalManifest(localManifest);
    session.setRemoteManifest(remoteManifest);

    const plan = session.computeSyncPlan();

    assert.ok(plan.toUpload.length > 0); // local.txt and modified a.txt
    assert.ok(plan.toDownload.length > 0); // remote.txt
  });

  await t.test("ConflictStrategy constants", () => {
    assert.equal(ConflictStrategy.LOCAL_WINS, "local_wins");
    assert.equal(ConflictStrategy.REMOTE_WINS, "remote_wins");
    assert.equal(ConflictStrategy.NEWER_WINS, "newer_wins");
    assert.equal(ConflictStrategy.MANUAL, "manual");
  });
});

test("ConfigValidator: schema validation", async (t) => {
  const { ConfigValidator, validateConfig, CommonSchemas } = await import("../../../js/agents/runtime/core/config-validator.js");

  await t.test("validates required fields", () => {
    const validator = new ConfigValidator({
      name: { type: "string", required: true },
    });

    const result = validator.validate({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("Required")));
  });

  await t.test("fills default values", () => {
    const validator = new ConfigValidator({
      timeout: { type: "number", default: 5000 },
      enabled: { type: "boolean", default: true },
    });

    const result = validator.validate({});
    assert.equal(result.valid, true);
    assert.equal(result.config.timeout, 5000);
    assert.equal(result.config.enabled, true);
  });

  await t.test("validates types", () => {
    const validator = new ConfigValidator({
      count: { type: "number" },
      name: { type: "string" },
      active: { type: "boolean" },
      items: { type: "array" },
      meta: { type: "object" },
    });

    const valid = validator.validate({
      count: 42,
      name: "test",
      active: true,
      items: [1, 2],
      meta: { key: "value" },
    });
    assert.equal(valid.valid, true);

    const invalid = validator.validate({
      count: "not a number",
    });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.some((e) => e.path === "count"));
  });

  await t.test("validates enum values", () => {
    const validator = new ConfigValidator({
      level: { type: "string", enum: ["low", "medium", "high"] },
    });

    const valid = validator.validate({ level: "medium" });
    assert.equal(valid.valid, true);

    const invalid = validator.validate({ level: "invalid" });
    assert.equal(invalid.valid, false);
  });

  await t.test("validates number constraints", () => {
    const validator = new ConfigValidator({
      port: { type: "number", min: 1, max: 65535 },
    });

    const valid = validator.validate({ port: 8080 });
    assert.equal(valid.valid, true);

    const tooLow = validator.validate({ port: 0 });
    assert.equal(tooLow.valid, false);

    const tooHigh = validator.validate({ port: 70000 });
    assert.equal(tooHigh.valid, false);
  });

  await t.test("validates string constraints", () => {
    const validator = new ConfigValidator({
      name: { type: "string", minLength: 2, maxLength: 10 },
      email: { type: "string", pattern: "^[^@]+@[^@]+$" },
    });

    const valid = validator.validate({ name: "hello", email: "test@example.com" });
    assert.equal(valid.valid, true);

    const tooShort = validator.validate({ name: "a" });
    assert.equal(tooShort.valid, false);

    const badPattern = validator.validate({ email: "invalid" });
    assert.equal(badPattern.valid, false);
  });

  await t.test("validates nested objects", () => {
    const validator = new ConfigValidator({
      server: {
        type: "object",
        properties: {
          host: { type: "string", required: true },
          port: { type: "number", default: 80 },
        },
      },
    });

    const result = validator.validate({ server: { host: "localhost" } });
    assert.equal(result.valid, true);
    assert.equal(result.config.server.host, "localhost");
    assert.equal(result.config.server.port, 80);
  });

  await t.test("validates array items", () => {
    const validator = new ConfigValidator({
      ports: {
        type: "array",
        items: { type: "number", min: 1 },
      },
    });

    const valid = validator.validate({ ports: [80, 443, 8080] });
    assert.equal(valid.valid, true);

    const invalid = validator.validate({ ports: [80, "invalid"] });
    assert.equal(invalid.valid, false);
  });

  await t.test("custom validator function", () => {
    const validator = new ConfigValidator({
      value: {
        type: "number",
        validate: (v) => (v % 2 === 0 ? true : "Must be even"),
      },
    });

    const valid = validator.validate({ value: 4 });
    assert.equal(valid.valid, true);

    const invalid = validator.validate({ value: 3 });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors[0].message.includes("even"));
  });

  await t.test("strict mode rejects unknown fields", () => {
    const validator = new ConfigValidator({ known: { type: "string" } }, { strict: true });

    const result = validator.validate({ known: "ok", unknown: "bad" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes("Unknown")));
  });

  await t.test("coerce mode converts types", () => {
    const validator = new ConfigValidator({ count: { type: "number" } }, { coerce: true });

    const result = validator.validate({ count: "42" });
    assert.equal(result.valid, true);
    assert.equal(result.config.count, 42);
  });

  await t.test("validateConfig convenience function", () => {
    const result = validateConfig({ name: "test" }, { name: { type: "string" } });
    assert.equal(result.valid, true);
  });

  await t.test("CommonSchemas are defined", () => {
    assert.ok(CommonSchemas.positiveNumber);
    assert.ok(CommonSchemas.nonEmptyString);
    assert.ok(CommonSchemas.url);
    assert.ok(CommonSchemas.email);
  });
});

test("ErrorBoundary: error handling", async (t) => {
  const {
    ErrorBoundary,
    ErrorCategory,
    categorizeError,
    createErrorInfo,
    getErrorBoundary,
    withErrorBoundary,
  } = await import("../../../js/agents/runtime/core/error-boundary.js");

  await t.test("categorizeError identifies categories", () => {
    const networkErr = new Error("fetch failed");
    networkErr.code = "ECONNRESET";
    assert.equal(categorizeError(networkErr), ErrorCategory.NETWORK);

    const timeoutErr = new Error("timeout");
    timeoutErr.name = "TimeoutError";
    assert.equal(categorizeError(timeoutErr), ErrorCategory.TIMEOUT);

    const validationErr = new Error("invalid input");
    validationErr.name = "ValidationError";
    assert.equal(categorizeError(validationErr), ErrorCategory.VALIDATION);

    const quotaErr = new Error("quota exceeded");
    assert.equal(categorizeError(quotaErr), ErrorCategory.QUOTA);

    const permErr = new Error("permission denied");
    assert.equal(categorizeError(permErr), ErrorCategory.PERMISSION);

    const httpErr = new Error("server error");
    httpErr.status = 500;
    assert.equal(categorizeError(httpErr), ErrorCategory.EXTERNAL);

    assert.equal(categorizeError(null), ErrorCategory.UNKNOWN);
  });

  await t.test("createErrorInfo creates structured info", () => {
    const error = new Error("test error");
    error.code = "TEST_CODE";

    const info = createErrorInfo(error, { userId: 123 });

    assert.ok(info.id.startsWith("err_"));
    assert.equal(info.message, "test error");
    assert.equal(info.code, "TEST_CODE");
    assert.ok(info.ts > 0);
    assert.equal(info.context.userId, 123);
    assert.equal(info.recovered, false);
  });

  await t.test("wrap catches errors and returns fallback", async () => {
    const boundary = new ErrorBoundary();

    const result = await boundary.wrap(
      async () => {
        throw new Error("failed");
      },
      { fallbackValue: "fallback" }
    );

    assert.equal(result, "fallback");
    assert.equal(boundary.errors.length, 1);
  });

  await t.test("wrap with rethrow passes error through", async () => {
    const boundary = new ErrorBoundary();

    await assert.rejects(
      boundary.wrap(
        async () => {
          throw new Error("should rethrow");
        },
        { rethrow: true }
      ),
      /should rethrow/
    );
  });

  await t.test("wrap with fallback function", async () => {
    const boundary = new ErrorBoundary({
      fallbacks: {
        [ErrorCategory.NETWORK]: () => "network fallback",
      },
    });

    const error = new Error("network issue");
    error.code = "ECONNRESET";

    const result = await boundary.wrap(async () => {
      throw error;
    });

    assert.equal(result, "network fallback");
  });

  await t.test("onError callback is called", async () => {
    let capturedInfo = null;
    const boundary = new ErrorBoundary({
      onError: (info) => {
        capturedInfo = info;
      },
    });

    await boundary.wrap(async () => {
      throw new Error("test");
    });

    assert.ok(capturedInfo);
    assert.equal(capturedInfo.message, "test");
  });

  await t.test("report adds error manually", () => {
    const boundary = new ErrorBoundary();

    boundary.report(new Error("manual error"), { source: "test" });

    assert.equal(boundary.errors.length, 1);
    assert.equal(boundary.errors[0].context.source, "test");
  });

  await t.test("markRecovered updates error", async () => {
    let recovered = null;
    const boundary = new ErrorBoundary({
      onRecovery: (info) => {
        recovered = info;
      },
    });

    await boundary.wrap(async () => {
      throw new Error("recoverable");
    });

    const errorId = boundary.errors[0].id;
    boundary.markRecovered(errorId);

    assert.equal(boundary.errors[0].recovered, true);
    assert.ok(recovered);
  });

  await t.test("stats reports error counts", async () => {
    const boundary = new ErrorBoundary();

    const networkErr = new Error("network");
    networkErr.code = "ECONNRESET";

    await boundary.wrap(async () => { throw networkErr; });
    await boundary.wrap(async () => { throw new Error("generic"); });

    const stats = boundary.stats;
    assert.equal(stats.total, 2);
    assert.equal(stats.byCategory[ErrorCategory.NETWORK], 1);
    assert.equal(stats.byCategory[ErrorCategory.UNKNOWN], 1);
  });

  await t.test("clear removes all errors", async () => {
    const boundary = new ErrorBoundary();

    await boundary.wrap(async () => { throw new Error("test"); });
    assert.equal(boundary.errors.length, 1);

    boundary.clear();
    assert.equal(boundary.errors.length, 0);
  });

  await t.test("maxErrors limits history", async () => {
    const boundary = new ErrorBoundary({ maxErrors: 3 });

    for (let i = 0; i < 5; i++) {
      await boundary.wrap(async () => { throw new Error(`error ${i}`); });
    }

    assert.equal(boundary.errors.length, 3);
  });

  await t.test("getErrorBoundary returns singleton", () => {
    const b1 = getErrorBoundary();
    const b2 = getErrorBoundary();
    assert.equal(b1, b2);
  });

  await t.test("withErrorBoundary uses global boundary", async () => {
    const result = await withErrorBoundary(
      async () => {
        throw new Error("global test");
      },
      { fallbackValue: "global fallback" }
    );

    assert.equal(result, "global fallback");
  });

  await t.test("ErrorCategory constants", () => {
    assert.equal(ErrorCategory.NETWORK, "network");
    assert.equal(ErrorCategory.VALIDATION, "validation");
    assert.equal(ErrorCategory.TIMEOUT, "timeout");
    assert.equal(ErrorCategory.QUOTA, "quota");
    assert.equal(ErrorCategory.PERMISSION, "permission");
    assert.equal(ErrorCategory.INTERNAL, "internal");
    assert.equal(ErrorCategory.EXTERNAL, "external");
    assert.equal(ErrorCategory.UNKNOWN, "unknown");
  });
});
