import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("DeltaSync: hash and manifest", async (t) => {
  const {
    computeHash,
    buildManifest,
    computeDelta,
    detectConflicts,
    resolveConflicts,
    ConflictStrategy,
    DeltaSyncSession,
  } = await import("../../../js/agents/vfs/delta-sync.js");

  await t.it("computeHash produces consistent hash", async () => {
    const h1 = await computeHash("hello world");
    const h2 = await computeHash("hello world");
    expect(h1).toBe(h2);

    const h3 = await computeHash("different");
    expect(h1).not.toBe(h3);
  });

  await t.it("computeHash handles various input types", async () => {
    const text = "test data";
    const bytes = new TextEncoder().encode(text);
    const buffer = bytes.buffer;

    const h1 = await computeHash(text);
    const h2 = await computeHash(bytes);
    const h3 = await computeHash(buffer);

    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  await t.it("computeHash rejects invalid input", async () => {
    await expect(computeHash(123)).rejects.toThrow(/must be string/);
  });

  await t.it("buildManifest creates correct structure", async () => {
    const files = [
      { path: "/a.txt", content: "content a" },
      { path: "/b.txt", content: "content b", mtime: 1000 },
    ];

    const manifest = await buildManifest(files);

    expect(manifest.id.startsWith("manifest_")).toBeTruthy();
    expect(manifest.ts > 0).toBeTruthy();
    expect(manifest.files.size).toBe(2);

    const aEntry = manifest.files.get("/a.txt");
    expect(aEntry).toBeTruthy();
    expect(aEntry.path).toBe("/a.txt");
    expect(aEntry.hash).toBeTruthy();
    expect(aEntry.size > 0).toBeTruthy();

    const bEntry = manifest.files.get("/b.txt");
    expect(bEntry.mtime).toBe(1000);
  });

  await t.it("computeDelta detects changes", async () => {
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
    expect(modified).toBeTruthy();
    expect(modified.type).toBe("modify");

    const added = delta.find((d) => d.path === "/d.txt");
    expect(added).toBeTruthy();
    expect(added.type).toBe("add");

    const deleted = delta.find((d) => d.path === "/c.txt");
    expect(deleted).toBeTruthy();
    expect(deleted.type).toBe("delete");

    // /b.txt should not be in delta
    const unchanged = delta.find((d) => d.path === "/b.txt");
    expect(unchanged).toBe(undefined);
  });

  await t.it("detectConflicts finds conflicts", () => {
    const localDelta = [
      { path: "/a.txt", type: "modify", hash: "local_hash" },
      { path: "/b.txt", type: "delete" },
    ];

    const remoteDelta = [
      { path: "/a.txt", type: "modify", hash: "remote_hash" },
      { path: "/b.txt", type: "modify", hash: "remote_b" },
    ];

    const conflicts = detectConflicts(localDelta, remoteDelta);

    expect(conflicts.length).toBe(2);
    expect(conflicts.some(c => c.path === "/a.txt")).toBeTruthy();
    expect(conflicts.some(c => c.path === "/b.txt")).toBeTruthy();
  });

  await t.it("resolveConflicts applies strategy", async () => {
    const conflicts = [{ path: "/a.txt", local: { type: "modify" }, remote: { type: "modify" } }];

    const localManifest = await buildManifest([{ path: "/a.txt", content: "local", mtime: 2000 }]);
    const remoteManifest = await buildManifest([{ path: "/a.txt", content: "remote", mtime: 1000 }]);

    const resolved1 = resolveConflicts(conflicts, ConflictStrategy.LOCAL_WINS, localManifest, remoteManifest);
    expect(resolved1[0].resolution).toBe("local");

    const resolved2 = resolveConflicts(conflicts, ConflictStrategy.REMOTE_WINS, localManifest, remoteManifest);
    expect(resolved2[0].resolution).toBe("remote");

    const resolved3 = resolveConflicts(conflicts, ConflictStrategy.NEWER_WINS, localManifest, remoteManifest);
    expect(resolved3[0].resolution).toBe("local"); // local has newer mtime
  });

  await t.it("DeltaSyncSession computes sync plan", async () => {
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

    expect(plan.toUpload.length > 0).toBeTruthy(); // local.txt and modified a.txt
    expect(plan.toDownload.length > 0).toBeTruthy(); // remote.txt
  });

  await t.it("ConflictStrategy constants", () => {
    expect(ConflictStrategy.LOCAL_WINS).toBe("local_wins");
    expect(ConflictStrategy.REMOTE_WINS).toBe("remote_wins");
    expect(ConflictStrategy.NEWER_WINS).toBe("newer_wins");
    expect(ConflictStrategy.MANUAL).toBe("manual");
  });
});

it("ConfigValidator: schema validation", async (t) => {
  const { ConfigValidator, validateConfig, CommonSchemas } = await import("../../../js/agents/runtime/core/config-validator.js");

  await t.it("validates required fields", () => {
    const validator = new ConfigValidator({
      name: { type: "string", required: true },
    });

    const result = validator.validate({});
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("Required")).toBeTruthy());
  });

  await t.it("fills default values", () => {
    const validator = new ConfigValidator({
      timeout: { type: "number", default: 5000 },
      enabled: { type: "boolean", default: true },
    });

    const result = validator.validate({});
    expect(result.valid).toBe(true);
    expect(result.config.timeout).toBe(5000);
    expect(result.config.enabled).toBe(true);
  });

  await t.it("validates types", () => {
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
    expect(valid.valid).toBe(true);

    const invalid = validator.validate({
      count: "not a number",
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.some(e => e.path === "count")).toBeTruthy();
  });

  await t.it("validates enum values", () => {
    const validator = new ConfigValidator({
      level: { type: "string", enum: ["low", "medium", "high"] },
    });

    const valid = validator.validate({ level: "medium" });
    expect(valid.valid).toBe(true);

    const invalid = validator.validate({ level: "invalid" });
    expect(invalid.valid).toBe(false);
  });

  await t.it("validates number constraints", () => {
    const validator = new ConfigValidator({
      port: { type: "number", min: 1, max: 65535 },
    });

    const valid = validator.validate({ port: 8080 });
    expect(valid.valid).toBe(true);

    const tooLow = validator.validate({ port: 0 });
    expect(tooLow.valid).toBe(false);

    const tooHigh = validator.validate({ port: 70000 });
    expect(tooHigh.valid).toBe(false);
  });

  await t.it("validates string constraints", () => {
    const validator = new ConfigValidator({
      name: { type: "string", minLength: 2, maxLength: 10 },
      email: { type: "string", pattern: "^[^@]+@[^@]+$" },
    });

    const valid = validator.validate({ name: "hello", email: "test@example.com" });
    expect(valid.valid).toBe(true);

    const tooShort = validator.validate({ name: "a" });
    expect(tooShort.valid).toBe(false);

    const badPattern = validator.validate({ email: "invalid" });
    expect(badPattern.valid).toBe(false);
  });

  await t.it("validates nested objects", () => {
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
    expect(result.valid).toBe(true);
    expect(result.config.server.host).toBe("localhost");
    expect(result.config.server.port).toBe(80);
  });

  await t.it("validates array items", () => {
    const validator = new ConfigValidator({
      ports: {
        type: "array",
        items: { type: "number", min: 1 },
      },
    });

    const valid = validator.validate({ ports: [80, 443, 8080] });
    expect(valid.valid).toBe(true);

    const invalid = validator.validate({ ports: [80, "invalid"] });
    expect(invalid.valid).toBe(false);
  });

  await t.it("custom validator function", () => {
    const validator = new ConfigValidator({
      value: {
        type: "number",
        validate: (v) => (v % 2 === 0 ? true : "Must be even"),
      },
    });

    const valid = validator.validate({ value: 4 });
    expect(valid.valid).toBe(true);

    const invalid = validator.validate({ value: 3 });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0].message.includes("even")).toBeTruthy();
  });

  await t.it("strict mode rejects unknown fields", () => {
    const validator = new ConfigValidator({ known: { type: "string" } }, { strict: true });

    const result = validator.validate({ known: "ok", unknown: "bad" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes("Unknown")).toBeTruthy());
  });

  await t.it("coerce mode converts types", () => {
    const validator = new ConfigValidator({ count: { type: "number" } }, { coerce: true });

    const result = validator.validate({ count: "42" });
    expect(result.valid).toBe(true);
    expect(result.config.count).toBe(42);
  });

  await t.it("validateConfig convenience function", () => {
    const result = validateConfig({ name: "test" }, { name: { type: "string" } });
    expect(result.valid).toBe(true);
  });

  await t.it("CommonSchemas are defined", () => {
    expect(CommonSchemas.positiveNumber).toBeTruthy();
    expect(CommonSchemas.nonEmptyString).toBeTruthy();
    expect(CommonSchemas.url).toBeTruthy();
    expect(CommonSchemas.email).toBeTruthy();
  });
});

it("ErrorBoundary: error handling", async (t) => {
  const {
    ErrorBoundary,
    ErrorCategory,
    categorizeError,
    createErrorInfo,
    getErrorBoundary,
    withErrorBoundary,
  } = await import("../../../js/agents/runtime/core/error-boundary.js");

  await t.it("categorizeError identifies categories", () => {
    const networkErr = new Error("fetch failed");
    networkErr.code = "ECONNRESET";
    expect(categorizeError(networkErr)).toBe(ErrorCategory.NETWORK);

    const timeoutErr = new Error("timeout");
    timeoutErr.name = "TimeoutError";
    expect(categorizeError(timeoutErr)).toBe(ErrorCategory.TIMEOUT);

    const validationErr = new Error("invalid input");
    validationErr.name = "ValidationError";
    expect(categorizeError(validationErr)).toBe(ErrorCategory.VALIDATION);

    const quotaErr = new Error("quota exceeded");
    expect(categorizeError(quotaErr)).toBe(ErrorCategory.QUOTA);

    const permErr = new Error("permission denied");
    expect(categorizeError(permErr)).toBe(ErrorCategory.PERMISSION);

    const httpErr = new Error("server error");
    httpErr.status = 500;
    expect(categorizeError(httpErr)).toBe(ErrorCategory.EXTERNAL);

    expect(categorizeError(null)).toBe(ErrorCategory.UNKNOWN);
  });

  await t.it("createErrorInfo creates structured info", () => {
    const error = new Error("test error");
    error.code = "TEST_CODE";

    const info = createErrorInfo(error, { userId: 123 });

    expect(info.id.startsWith("err_")).toBeTruthy();
    expect(info.message).toBe("test error");
    expect(info.code).toBe("TEST_CODE");
    expect(info.ts > 0).toBeTruthy();
    expect(info.context.userId).toBe(123);
    expect(info.recovered).toBe(false);
  });

  await t.it("wrap catches errors and returns fallback", async () => {
    const boundary = new ErrorBoundary();

    const result = await boundary.wrap(
      async () => {
        throw new Error("failed");
      },
      { fallbackValue: "fallback" }
    );

    expect(result).toBe("fallback");
    expect(boundary.errors.length).toBe(1);
  });

  await t.it("wrap with rethrow passes error through", async () => {
    const boundary = new ErrorBoundary();

    await expect(
      boundary.wrap(
        async () => {
          throw new Error("should rethrow");
        },
        { rethrow: true }
      )
    ).rejects.toThrow(/should rethrow/);
  });

  await t.it("wrap with fallback function", async () => {
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

    expect(result).toBe("network fallback");
  });

  await t.it("onError callback is called", async () => {
    let capturedInfo = null;
    const boundary = new ErrorBoundary({
      onError: (info) => {
        capturedInfo = info;
      },
    });

    await boundary.wrap(async () => {
      throw new Error("test");
    });

    expect(capturedInfo).toBeTruthy();
    expect(capturedInfo.message).toBe("test");
  });

  await t.it("report adds error manually", () => {
    const boundary = new ErrorBoundary();

    boundary.report(new Error("manual error"), { source: "test" });

    expect(boundary.errors.length).toBe(1);
    expect(boundary.errors[0].context.source).toBe("test");
  });

  await t.it("markRecovered updates error", async () => {
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

    expect(boundary.errors[0].recovered).toBe(true);
    expect(recovered).toBeTruthy();
  });

  await t.it("stats reports error counts", async () => {
    const boundary = new ErrorBoundary();

    const networkErr = new Error("network");
    networkErr.code = "ECONNRESET";

    await boundary.wrap(async () => { throw networkErr; });
    await boundary.wrap(async () => { throw new Error("generic"); });

    const stats = boundary.stats;
    expect(stats.total).toBe(2);
    expect(stats.byCategory[ErrorCategory.NETWORK]).toBe(1);
    expect(stats.byCategory[ErrorCategory.UNKNOWN]).toBe(1);
  });

  await t.it("clear removes all errors", async () => {
    const boundary = new ErrorBoundary();

    await boundary.wrap(async () => { throw new Error("test"); });
    expect(boundary.errors.length).toBe(1);

    boundary.clear();
    expect(boundary.errors.length).toBe(0);
  });

  await t.it("maxErrors limits history", async () => {
    const boundary = new ErrorBoundary({ maxErrors: 3 });

    for (let i = 0; i < 5; i++) {
      await boundary.wrap(async () => { throw new Error(`error ${i}`); });
    }

    expect(boundary.errors.length).toBe(3);
  });

  await t.it("getErrorBoundary returns singleton", () => {
    const b1 = getErrorBoundary();
    const b2 = getErrorBoundary();
    expect(b1).toBe(b2);
  });

  await t.it("withErrorBoundary uses global boundary", async () => {
    const result = await withErrorBoundary(
      async () => {
        throw new Error("global test");
      },
      { fallbackValue: "global fallback" }
    );

    expect(result).toBe("global fallback");
  });

  await t.it("ErrorCategory constants", () => {
    expect(ErrorCategory.NETWORK).toBe("network");
    expect(ErrorCategory.VALIDATION).toBe("validation");
    expect(ErrorCategory.TIMEOUT).toBe("timeout");
    expect(ErrorCategory.QUOTA).toBe("quota");
    expect(ErrorCategory.PERMISSION).toBe("permission");
    expect(ErrorCategory.INTERNAL).toBe("internal");
    expect(ErrorCategory.EXTERNAL).toBe("external");
    expect(ErrorCategory.UNKNOWN).toBe("unknown");
  });
});
