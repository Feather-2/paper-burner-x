const test = require("node:test");
const assert = require("node:assert/strict");

test("PerformanceRouter: EWMA and routing", async (t) => {
  const {
    PerformanceRouter,
    EwmaTracker,
    ModelTier,
    TaskComplexity,
    estimateComplexity,
  } = await import("../../../js/agents/runtime/routing/performance-router.js");

  await t.test("EwmaTracker computes EWMA", () => {
    const tracker = new EwmaTracker({ alpha: 0.5 });

    tracker.record(100);
    assert.equal(tracker.value, 100);

    tracker.record(200);
    assert.equal(tracker.value, 150); // 0.5 * 200 + 0.5 * 100

    tracker.record(100);
    assert.equal(tracker.value, 125); // 0.5 * 100 + 0.5 * 150
  });

  await t.test("EwmaTracker tracks min/max", () => {
    const tracker = new EwmaTracker();

    tracker.record(50);
    tracker.record(100);
    tracker.record(75);

    const stats = tracker.stats;
    assert.equal(stats.min, 50);
    assert.equal(stats.max, 100);
    assert.equal(stats.count, 3);
  });

  await t.test("EwmaTracker handles invalid input", () => {
    const tracker = new EwmaTracker();

    tracker.record(100);
    tracker.record(NaN);
    tracker.record("invalid");

    assert.equal(tracker.value, 100); // Should not change
  });

  await t.test("registerEndpoint adds endpoints", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("gpt-4", { tier: ModelTier.POWER });
    router.registerEndpoint("gpt-3.5", { tier: ModelTier.FAST });

    const stats = router.getAllStats();
    assert.ok(stats["gpt-4"]);
    assert.ok(stats["gpt-3.5"]);
    assert.equal(stats["gpt-4"].tier, ModelTier.POWER);
    assert.equal(stats["gpt-3.5"].tier, ModelTier.FAST);
  });

  await t.test("recordResult updates stats", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("test");
    router.recordResult("test", { success: true, latencyMs: 100 });
    router.recordResult("test", { success: true, latencyMs: 200 });
    router.recordResult("test", { success: false, error: "timeout" });

    const stats = router.getEndpointStats("test");
    assert.equal(stats.successCount, 2);
    assert.equal(stats.errorCount, 1);
    assert.ok(stats.latency.ewma > 0);
  });

  await t.test("selectEndpoint chooses best endpoint", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("fast", { tier: ModelTier.FAST });
    router.registerEndpoint("slow", { tier: ModelTier.FAST });

    // Make 'fast' perform better
    router.recordResult("fast", { success: true, latencyMs: 50 });
    router.recordResult("slow", { success: true, latencyMs: 500 });

    const result = router.selectEndpoint({ complexity: TaskComplexity.SIMPLE });
    assert.equal(result.endpointId, "fast");
  });

  await t.test("selectEndpoint respects excludeIds", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("a");
    router.registerEndpoint("b");

    const result = router.selectEndpoint({ excludeIds: ["a"] });
    assert.equal(result.endpointId, "b");
  });

  await t.test("selectEndpoint returns null when no candidates", () => {
    const router = new PerformanceRouter();

    const result = router.selectEndpoint();
    assert.equal(result, null);
  });

  await t.test("getRankedEndpoints sorts by score", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("good");
    router.registerEndpoint("bad");

    router.recordResult("good", { success: true, latencyMs: 100 });
    router.recordResult("bad", { success: false, error: "err" });

    const ranked = router.getRankedEndpoints();
    assert.equal(ranked[0].id, "good");
  });

  await t.test("estimateComplexity categorizes tasks", () => {
    assert.equal(estimateComplexity({ prompt: "short" }), TaskComplexity.SIMPLE);
    assert.equal(estimateComplexity({ prompt: "a".repeat(500) }), TaskComplexity.MODERATE);
    assert.equal(estimateComplexity({ prompt: "a".repeat(3000) }), TaskComplexity.COMPLEX);
  });

  await t.test("ModelTier constants", () => {
    assert.equal(ModelTier.FAST, "fast");
    assert.equal(ModelTier.POWER, "power");
    assert.equal(ModelTier.FALLBACK, "fallback");
  });

  await t.test("setWeight updates endpoint weight", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("test", { weight: 1 });
    router.setWeight("test", 2);

    const stats = router.getEndpointStats("test");
    assert.equal(stats.weight, 2);
  });
});

test("ToolQuotaManager: quota management", async (t) => {
  const {
    ToolQuotaManager,
    ContractValidator,
    createToolContract,
  } = await import("../../../js/agents/runtime/tools/tool-quotas.js");

  await t.test("setQuota configures tool quotas", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("search", { maxCalls: 10, windowMs: 1000 });

    const stats = manager.getToolStats("search");
    assert.equal(stats.maxCalls, 10);
    assert.equal(stats.windowMs, 1000);
  });

  await t.test("tryCall allows within quota", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("search", { maxCalls: 5 });

    const result = manager.tryCall("search");
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 4);
  });

  await t.test("tryCall blocks over quota", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("search", { maxCalls: 2 });

    manager.tryCall("search");
    manager.tryCall("search");
    const result = manager.tryCall("search");

    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("Quota exceeded"));
  });

  await t.test("canCall checks without counting", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("search", { maxCalls: 1 });

    assert.equal(manager.canCall("search"), true);
    manager.tryCall("search");
    assert.equal(manager.canCall("search"), false);
  });

  await t.test("getBlockedTools returns blocked tools", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("blocked", { maxCalls: 1 });
    manager.setQuota("available", { maxCalls: 100 });

    manager.tryCall("blocked");
    manager.tryCall("blocked");

    const blocked = manager.getBlockedTools();
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].toolName, "blocked");
  });

  await t.test("onQuotaExceeded callback fires", () => {
    let exceeded = null;

    const manager = new ToolQuotaManager({
      onQuotaExceeded: (info) => {
        exceeded = info;
      },
    });

    manager.setQuota("test", { maxCalls: 1 });
    manager.tryCall("test");
    manager.tryCall("test");

    assert.ok(exceeded);
    assert.equal(exceeded.toolName, "test");
  });

  await t.test("resetTool clears tool stats", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("test", { maxCalls: 2 });
    manager.tryCall("test");
    manager.tryCall("test");
    assert.equal(manager.canCall("test"), false);

    manager.resetTool("test");
    assert.equal(manager.canCall("test"), true);
  });

  await t.test("summary provides overview", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("a", { maxCalls: 1 });
    manager.setQuota("b", { maxCalls: 100 });

    manager.tryCall("a");
    manager.tryCall("a"); // This is blocked, but still counts as attempted
    manager.tryCall("b");

    const summary = manager.summary;
    assert.equal(summary.totalTools, 2);
    assert.equal(summary.blockedTools, 1);
    // totalCalls only counts successful calls that were allowed
    assert.ok(summary.totalCalls >= 2);
    assert.equal(summary.totalBlocked, 1);
  });

  await t.test("ContractValidator validates schema", () => {
    const validator = new ContractValidator({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number", minimum: 0 },
      },
      required: ["name"],
    });

    const valid = validator.validate({ name: "test", age: 25 });
    assert.equal(valid.valid, true);

    const missingRequired = validator.validate({ age: 25 });
    assert.equal(missingRequired.valid, false);

    const wrongType = validator.validate({ name: 123 });
    assert.equal(wrongType.valid, false);
  });

  await t.test("createToolContract creates input/output validators", () => {
    const contract = createToolContract(
      { type: "object", properties: { query: { type: "string" } } },
      { type: "array", items: { type: "object" } }
    );

    const inputResult = contract.validateInput({ query: "test" });
    assert.equal(inputResult.valid, true);

    const outputResult = contract.validateOutput([{ result: "data" }]);
    assert.equal(outputResult.valid, true);
  });
});

test("TraceContext: distributed tracing", async (t) => {
  const {
    TraceContext,
    Span,
    SpanStatus,
    SpanKind,
    generateTraceId,
    generateSpanId,
  } = await import("../../../js/agents/runtime/telemetry/trace-context.js");

  await t.test("generateTraceId creates 32-char hex", () => {
    const id = generateTraceId();
    assert.equal(id.length, 32);
    assert.ok(/^[0-9a-f]+$/.test(id));
  });

  await t.test("generateSpanId creates 16-char hex", () => {
    const id = generateSpanId();
    assert.equal(id.length, 16);
    assert.ok(/^[0-9a-f]+$/.test(id));
  });

  await t.test("startSpan creates new span", () => {
    const ctx = new TraceContext();

    const span = ctx.startSpan("test-operation");

    assert.equal(span.name, "test-operation");
    assert.equal(span.traceId, ctx.traceId);
    assert.ok(span.spanId);
    assert.equal(span.isEnded, false);
  });

  await t.test("span tracks parent relationship", () => {
    const ctx = new TraceContext();

    const parent = ctx.startSpan("parent");
    const child = ctx.startSpan("child");

    assert.equal(child.parentSpanId, parent.spanId);
  });

  await t.test("span.setAttribute sets attribute", () => {
    const ctx = new TraceContext();
    const span = ctx.startSpan("test");

    span.setAttribute("key", "value");
    assert.equal(span.attributes.key, "value");
  });

  await t.test("span.addEvent records event", () => {
    const ctx = new TraceContext();
    const span = ctx.startSpan("test");

    span.addEvent("custom-event", { detail: "info" });

    assert.equal(span.events.length, 1);
    assert.equal(span.events[0].name, "custom-event");
  });

  await t.test("span.recordException captures error", () => {
    const ctx = new TraceContext();
    const span = ctx.startSpan("test");

    span.recordException(new Error("test error"));

    assert.equal(span.status, SpanStatus.ERROR);
    assert.ok(span.events.some((e) => e.name === "exception"));
  });

  await t.test("span.end finalizes span", () => {
    const ctx = new TraceContext();
    const span = ctx.startSpan("test");

    span.end();

    assert.equal(span.isEnded, true);
    assert.ok(span.endTime);
    assert.ok(span.duration >= 0);
  });

  await t.test("withSpan executes and ends span", async () => {
    const ctx = new TraceContext();

    const result = await ctx.withSpan("operation", async (span) => {
      span.setAttribute("test", true);
      return 42;
    });

    assert.equal(result, 42);

    const spans = ctx.getSpans();
    assert.equal(spans.length, 1);
    assert.equal(spans[0].status, SpanStatus.OK);
  });

  await t.test("withSpan captures exceptions", async () => {
    const ctx = new TraceContext();

    await assert.rejects(
      ctx.withSpan("failing", async () => {
        throw new Error("fail");
      }),
      /fail/
    );

    const spans = ctx.getSpans();
    assert.equal(spans[0].status, SpanStatus.ERROR);
  });

  await t.test("getTraceparent returns W3C format", () => {
    const ctx = new TraceContext();
    ctx.startSpan("test");

    const traceparent = ctx.getTraceparent();
    const parts = traceparent.split("-");

    assert.equal(parts[0], "00"); // version
    assert.equal(parts[1].length, 32); // trace-id
    assert.equal(parts[2].length, 16); // span-id
    assert.equal(parts[3], "01"); // flags
  });

  await t.test("parseTraceparent extracts components", () => {
    const parsed = TraceContext.parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");

    assert.ok(parsed);
    assert.equal(parsed.traceId, "0af7651916cd43dd8448eb211c80319c");
    assert.equal(parsed.spanId, "b7ad6b7169203331");
    assert.equal(parsed.sampled, true);
  });

  await t.test("parseTraceparent returns null for invalid", () => {
    assert.equal(TraceContext.parseTraceparent("invalid"), null);
    assert.equal(TraceContext.parseTraceparent(null), null);
  });

  await t.test("SpanStatus constants", () => {
    assert.equal(SpanStatus.OK, "ok");
    assert.equal(SpanStatus.ERROR, "error");
    assert.equal(SpanStatus.UNSET, "unset");
  });

  await t.test("SpanKind constants", () => {
    assert.equal(SpanKind.INTERNAL, "internal");
    assert.equal(SpanKind.CLIENT, "client");
    assert.equal(SpanKind.SERVER, "server");
  });
});

test("DegradationMatrix: resilience management", async (t) => {
  const {
    DegradationMatrix,
    DegradationPolicy,
    OperationLevel,
    DegradationTrigger,
  } = await import("../../../js/agents/runtime/resilience/degradation-matrix.js");

  await t.test("starts at NORMAL level", () => {
    const matrix = new DegradationMatrix();
    assert.equal(matrix.currentLevel, OperationLevel.NORMAL);
  });

  await t.test("recordRequest tracks metrics", () => {
    const matrix = new DegradationMatrix();

    matrix.recordRequest({ latencyMs: 100, isError: false });
    matrix.recordRequest({ latencyMs: 200, isError: false });

    const status = matrix.getStatus();
    assert.equal(status.metrics.requestCount, 2);
  });

  await t.test("degrades on high error rate", () => {
    const matrix = new DegradationMatrix();

    // Record many errors
    for (let i = 0; i < 10; i++) {
      matrix.recordRequest({ latencyMs: 100, isError: true });
    }

    assert.notEqual(matrix.currentLevel, OperationLevel.NORMAL);
  });

  await t.test("degrades on high latency", () => {
    const matrix = new DegradationMatrix();

    // Record high latency requests
    for (let i = 0; i < 10; i++) {
      matrix.recordRequest({ latencyMs: 3000, isError: false });
    }

    assert.notEqual(matrix.currentLevel, OperationLevel.NORMAL);
  });

  await t.test("isFeatureEnabled checks feature availability", () => {
    const matrix = new DegradationMatrix();

    // Normal level - all features enabled
    assert.equal(matrix.isFeatureEnabled("parallelRequests"), true);
    assert.equal(matrix.isFeatureEnabled("retries"), true);
  });

  await t.test("setManualOverride forces level", () => {
    const matrix = new DegradationMatrix();

    matrix.setManualOverride(OperationLevel.CRITICAL);
    assert.equal(matrix.currentLevel, OperationLevel.CRITICAL);
  });

  await t.test("clearManualOverride returns to auto", () => {
    const matrix = new DegradationMatrix();

    matrix.setManualOverride(OperationLevel.CRITICAL);
    matrix.clearManualOverride();
    matrix.forceEvaluate(); // Need to force re-evaluation

    // Should re-evaluate based on metrics (back to NORMAL with no data)
    assert.equal(matrix.currentLevel, OperationLevel.NORMAL);
  });

  await t.test("onLevelChange callback fires", () => {
    let change = null;

    const matrix = new DegradationMatrix({
      onLevelChange: (info) => {
        change = info;
      },
    });

    matrix.setManualOverride(OperationLevel.DEGRADED);

    assert.ok(change);
    assert.equal(change.from, OperationLevel.NORMAL);
    assert.equal(change.to, OperationLevel.DEGRADED);
  });

  await t.test("getEnabledFeatures returns feature list", () => {
    const matrix = new DegradationMatrix();

    const features = matrix.getEnabledFeatures();
    assert.ok(Array.isArray(features));
    assert.ok(features.includes("caching"));
  });

  await t.test("getRecommendations provides actionable advice", () => {
    const matrix = new DegradationMatrix();

    // Create degraded state
    for (let i = 0; i < 10; i++) {
      matrix.recordRequest({ latencyMs: 100, isError: true });
    }

    const recommendations = matrix.getRecommendations();
    assert.ok(Array.isArray(recommendations));
  });

  await t.test("reset returns to normal", () => {
    const matrix = new DegradationMatrix();

    matrix.setManualOverride(OperationLevel.CRITICAL);
    matrix.reset();

    assert.equal(matrix.currentLevel, OperationLevel.NORMAL);
  });

  await t.test("DegradationPolicy customizes thresholds", () => {
    const policy = new DegradationPolicy({
      thresholds: { errorRateDegraded: 0.5 },
    });

    assert.equal(policy.thresholds.errorRateDegraded, 0.5);
  });

  await t.test("OperationLevel constants", () => {
    assert.equal(OperationLevel.NORMAL, "normal");
    assert.equal(OperationLevel.DEGRADED, "degraded");
    assert.equal(OperationLevel.CRITICAL, "critical");
    assert.equal(OperationLevel.OFFLINE, "offline");
  });

  await t.test("DegradationTrigger constants", () => {
    assert.equal(DegradationTrigger.ERROR_RATE, "error_rate");
    assert.equal(DegradationTrigger.LATENCY, "latency");
    assert.equal(DegradationTrigger.MEMORY, "memory");
  });
});
