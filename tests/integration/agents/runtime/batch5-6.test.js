import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("PerformanceRouter: EWMA and routing", () => {
  let PerformanceRouter;
  let EwmaTracker;
  let ModelTier;
  let TaskComplexity;
  let estimateComplexity;

  beforeEach(async () => {
    const mod = await import("../../../../js/agents/runtime/routing/performance-router.js");
    PerformanceRouter = mod.PerformanceRouter;
    EwmaTracker = mod.EwmaTracker;
    ModelTier = mod.ModelTier;
    TaskComplexity = mod.TaskComplexity;
    estimateComplexity = mod.estimateComplexity;
  });

  it("EwmaTracker computes EWMA", () => {
    const tracker = new EwmaTracker({ alpha: 0.5 });

    tracker.record(100);
    expect(tracker.value).toBe(100);

    tracker.record(200);
    expect(tracker.value).toBe(150); // 0.5 * 200 + 0.5 * 100

    tracker.record(100);
    expect(tracker.value).toBe(125); // 0.5 * 100 + 0.5 * 150
  });

  it("EwmaTracker tracks min/max", () => {
    const tracker = new EwmaTracker();

    tracker.record(50);
    tracker.record(100);
    tracker.record(75);

    const stats = tracker.stats;
    expect(stats.min).toBe(50);
    expect(stats.max).toBe(100);
    expect(stats.count).toBe(3);
  });

  it("EwmaTracker handles invalid input", () => {
    const tracker = new EwmaTracker();

    tracker.record(100);
    tracker.record(NaN);
    tracker.record("invalid");

    expect(tracker.value).toBe(100); // Should not change
  });

  it("registerEndpoint adds endpoints", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("gpt-4", { tier: ModelTier.POWER });
    router.registerEndpoint("gpt-3.5", { tier: ModelTier.FAST });

    const stats = router.getAllStats();
    expect(stats).toHaveProperty("gpt-4", expect.any(Object));
    expect(stats).toHaveProperty("gpt-3.5", expect.any(Object));
    expect(stats["gpt-4"].tier).toBe(ModelTier.POWER);
    expect(stats["gpt-3.5"].tier).toBe(ModelTier.FAST);
  });

  it("recordResult updates stats", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("test");
    router.recordResult("test", { success: true, latencyMs: 100 });
    router.recordResult("test", { success: true, latencyMs: 200 });
    router.recordResult("test", { success: false, error: "timeout" });

    const stats = router.getEndpointStats("test");
    expect(stats.successCount).toBe(2);
    expect(stats.errorCount).toBe(1);
    expect(stats.latency.ewma).toBeGreaterThan(0);
  });

  it("selectEndpoint chooses best endpoint", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("fast", { tier: ModelTier.FAST });
    router.registerEndpoint("slow", { tier: ModelTier.FAST });

    // Make 'fast' perform better
    router.recordResult("fast", { success: true, latencyMs: 50 });
    router.recordResult("slow", { success: true, latencyMs: 500 });

    const result = router.selectEndpoint({ complexity: TaskComplexity.SIMPLE });
    expect(result.endpointId).toBe("fast");
  });

  it("selectEndpoint respects excludeIds", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("a");
    router.registerEndpoint("b");

    const result = router.selectEndpoint({ excludeIds: ["a"] });
    expect(result.endpointId).toBe("b");
  });

  it("selectEndpoint returns null when no candidates", () => {
    const router = new PerformanceRouter();

    const result = router.selectEndpoint();
    expect(result).toBe(null);
  });

  it("getRankedEndpoints sorts by score", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("good");
    router.registerEndpoint("bad");

    router.recordResult("good", { success: true, latencyMs: 100 });
    router.recordResult("bad", { success: false, error: "err" });

    const ranked = router.getRankedEndpoints();
    expect(ranked[0].id).toBe("good");
  });

  it("estimateComplexity categorizes tasks", () => {
    expect(estimateComplexity({ prompt: "short" })).toBe(TaskComplexity.SIMPLE);
    expect(estimateComplexity({ prompt: "a".repeat(500) })).toBe(TaskComplexity.MODERATE);
    expect(estimateComplexity({ prompt: "a".repeat(3000) })).toBe(TaskComplexity.COMPLEX);
  });

  it("ModelTier constants", () => {
    expect(ModelTier.FAST).toBe("fast");
    expect(ModelTier.POWER).toBe("power");
    expect(ModelTier.FALLBACK).toBe("fallback");
  });

  it("setWeight updates endpoint weight", () => {
    const router = new PerformanceRouter();

    router.registerEndpoint("test", { weight: 1 });
    router.setWeight("test", 2);

    const stats = router.getEndpointStats("test");
    expect(stats.weight).toBe(2);
  });
});

describe("ToolQuotaManager: quota management", () => {
  let ToolQuotaManager;
  let ContractValidator;
  let createToolContract;

  beforeEach(async () => {
    const mod = await import("../../../../js/agents/runtime/tools/tool-quotas.js");
    ToolQuotaManager = mod.ToolQuotaManager;
    ContractValidator = mod.ContractValidator;
    createToolContract = mod.createToolContract;
  });

  it("setQuota configures tool quotas", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("search", { maxCalls: 10, windowMs: 1000 });

    const stats = manager.getToolStats("search");
    expect(stats.maxCalls).toBe(10);
    expect(stats.windowMs).toBe(1000);
  });

  it("tryCall allows within quota", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("search", { maxCalls: 5 });

    const result = manager.tryCall("search");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("tryCall blocks over quota", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("search", { maxCalls: 2 });

    manager.tryCall("search");
    manager.tryCall("search");
    const result = manager.tryCall("search");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Quota exceeded");
  });

  it("canCall checks without counting", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("search", { maxCalls: 1 });

    expect(manager.canCall("search")).toBe(true);
    manager.tryCall("search");
    expect(manager.canCall("search")).toBe(false);
  });

  it("getBlockedTools returns blocked tools", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("blocked", { maxCalls: 1 });
    manager.setQuota("available", { maxCalls: 100 });

    manager.tryCall("blocked");
    manager.tryCall("blocked");

    const blocked = manager.getBlockedTools();
    expect(blocked.length).toBe(1);
    expect(blocked[0].toolName).toBe("blocked");
  });

  it("onQuotaExceeded callback fires", () => {
    let exceeded = null;

    const manager = new ToolQuotaManager({
      onQuotaExceeded: (info) => {
        exceeded = info;
      },
    });

    manager.setQuota("test", { maxCalls: 1 });
    manager.tryCall("test");
    manager.tryCall("test");

    expect(exceeded).toEqual(expect.any(Object));
    expect(exceeded.toolName).toBe("test");
  });

  it("resetTool clears tool stats", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("test", { maxCalls: 2 });
    manager.tryCall("test");
    manager.tryCall("test");
    expect(manager.canCall("test")).toBe(false);

    manager.resetTool("test");
    expect(manager.canCall("test")).toBe(true);
  });

  it("summary provides overview", () => {
    const manager = new ToolQuotaManager();

    manager.setQuota("a", { maxCalls: 1 });
    manager.setQuota("b", { maxCalls: 100 });

    manager.tryCall("a");
    manager.tryCall("a"); // This is blocked, but still counts as attempted
    manager.tryCall("b");

    const summary = manager.summary;
    expect(summary.totalTools).toBe(2);
    expect(summary.blockedTools).toBe(1);
    // totalCalls only counts successful calls that were allowed
    expect(summary.totalCalls).toBeGreaterThanOrEqual(2);
    expect(summary.totalBlocked).toBe(1);
  });

  it("ContractValidator validates schema", () => {
    const validator = new ContractValidator({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number", minimum: 0 },
      },
      required: ["name"],
    });

    const valid = validator.validate({ name: "test", age: 25 });
    expect(valid.valid).toBe(true);

    const missingRequired = validator.validate({ age: 25 });
    expect(missingRequired.valid).toBe(false);

    const wrongType = validator.validate({ name: 123 });
    expect(wrongType.valid).toBe(false);
  });

  it("createToolContract creates input/output validators", () => {
    const contract = createToolContract(
      { type: "object", properties: { query: { type: "string" } } },
      { type: "array", items: { type: "object" } }
    );

    const inputResult = contract.validateInput({ query: "test" });
    expect(inputResult.valid).toBe(true);

    const outputResult = contract.validateOutput([{ result: "data" }]);
    expect(outputResult.valid).toBe(true);
  });
});

describe("TraceContext: distributed tracing", () => {
  let TraceContext;
  let Span;
  let SpanStatus;
  let SpanKind;
  let generateTraceId;
  let generateSpanId;

  beforeEach(async () => {
    const mod = await import("../../../../js/agents/plugins/telemetry/trace-context.js");
    TraceContext = mod.TraceContext;
    Span = mod.Span;
    SpanStatus = mod.SpanStatus;
    SpanKind = mod.SpanKind;
    generateTraceId = mod.generateTraceId;
    generateSpanId = mod.generateSpanId;
  });

  it("generateTraceId creates 32-char hex", () => {
    const id = generateTraceId();
    expect(id.length).toBe(32);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it("generateSpanId creates 16-char hex", () => {
    const id = generateSpanId();
    expect(id.length).toBe(16);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it("startSpan creates new span", () => {
    const ctx = new TraceContext();

    const span = ctx.startSpan("test-operation");

    expect(span.name).toBe("test-operation");
    expect(span.traceId).toBe(ctx.traceId);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.isEnded).toBe(false);
  });

  it("span tracks parent relationship", () => {
    const ctx = new TraceContext();

    const parent = ctx.startSpan("parent");
    const child = ctx.startSpan("child");

    expect(child.parentSpanId).toBe(parent.spanId);
  });

  it("span.setAttribute sets attribute", () => {
    const ctx = new TraceContext();
    const span = ctx.startSpan("test");

    span.setAttribute("key", "value");
    expect(span.attributes.key).toBe("value");
  });

  it("span.addEvent records event", () => {
    const ctx = new TraceContext();
    const span = ctx.startSpan("test");

    span.addEvent("custom-event", { detail: "info" });

    expect(span.events.length).toBe(1);
    expect(span.events[0].name).toBe("custom-event");
  });

  it("span.recordException captures error", () => {
    const ctx = new TraceContext();
    const span = ctx.startSpan("test");

    span.recordException(new Error("test error"));

    expect(span.status).toBe(SpanStatus.ERROR);
    expect(span.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "exception" })])
    );
  });

  it("span.end finalizes span", () => {
    const ctx = new TraceContext();
    const span = ctx.startSpan("test");

    span.end();

    expect(span.isEnded).toBe(true);
    expect(span.endTime).toBeTypeOf("number");
    expect(span.duration).toBeGreaterThanOrEqual(0);
  });

  it("withSpan executes and ends span", async () => {
    const ctx = new TraceContext();

    const result = await ctx.withSpan("operation", async (span) => {
      span.setAttribute("test", true);
      return 42;
    });

    expect(result).toBe(42);

    const spans = ctx.getSpans();
    expect(spans.length).toBe(1);
    expect(spans[0].status).toBe(SpanStatus.OK);
  });

  it("withSpan captures exceptions", async () => {
    const ctx = new TraceContext();

    await expect(
      ctx.withSpan("failing", async () => {
        throw new Error("fail");
      })
    ).rejects.toThrow(/fail/);

    const spans = ctx.getSpans();
    expect(spans[0].status).toBe(SpanStatus.ERROR);
  });

  it("getTraceparent returns W3C format", () => {
    const ctx = new TraceContext();
    ctx.startSpan("test");

    const traceparent = ctx.getTraceparent();
    const parts = traceparent.split("-");

    expect(parts[0]).toBe("00"); // version
    expect(parts[1].length).toBe(32); // trace-id
    expect(parts[2].length).toBe(16); // span-id
    expect(parts[3]).toBe("01"); // flags
  });

  it("parseTraceparent extracts components", () => {
    const parsed = TraceContext.parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");

    expect(parsed).toEqual(expect.any(Object));
    expect(parsed.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(parsed.spanId).toBe("b7ad6b7169203331");
    expect(parsed.sampled).toBe(true);
  });

  it("parseTraceparent returns null for invalid", () => {
    expect(TraceContext.parseTraceparent("invalid")).toBe(null);
    expect(TraceContext.parseTraceparent(null)).toBe(null);
  });

  it("SpanStatus constants", () => {
    expect(SpanStatus.OK).toBe("ok");
    expect(SpanStatus.ERROR).toBe("error");
    expect(SpanStatus.UNSET).toBe("unset");
  });

  it("SpanKind constants", () => {
    expect(SpanKind.INTERNAL).toBe("internal");
    expect(SpanKind.CLIENT).toBe("client");
    expect(SpanKind.SERVER).toBe("server");
  });
});

describe("DegradationMatrix: resilience management", () => {
  let DegradationMatrix;
  let DegradationPolicy;
  let OperationLevel;
  let DegradationTrigger;

  beforeEach(async () => {
    const mod = await import("../../../../js/agents/plugins/resilience/degradation-matrix.js");
    DegradationMatrix = mod.DegradationMatrix;
    DegradationPolicy = mod.DegradationPolicy;
    OperationLevel = mod.OperationLevel;
    DegradationTrigger = mod.DegradationTrigger;
  });

  it("starts at NORMAL level", () => {
    const matrix = new DegradationMatrix();
    expect(matrix.currentLevel).toBe(OperationLevel.NORMAL);
  });

  it("recordRequest tracks metrics", () => {
    const matrix = new DegradationMatrix();

    matrix.recordRequest({ latencyMs: 100, isError: false });
    matrix.recordRequest({ latencyMs: 200, isError: false });

    const status = matrix.getStatus();
    expect(status.metrics.requestCount).toBe(2);
  });

  it("degrades on high error rate", () => {
    const matrix = new DegradationMatrix();

    // Record many errors
    for (let i = 0; i < 10; i++) {
      matrix.recordRequest({ latencyMs: 100, isError: true });
    }

    expect(matrix.currentLevel).not.toBe(OperationLevel.NORMAL);
  });

  it("degrades on high latency", () => {
    const matrix = new DegradationMatrix();

    // Record high latency requests
    for (let i = 0; i < 10; i++) {
      matrix.recordRequest({ latencyMs: 3000, isError: false });
    }

    expect(matrix.currentLevel).not.toBe(OperationLevel.NORMAL);
  });

  it("isFeatureEnabled checks feature availability", () => {
    const matrix = new DegradationMatrix();

    // Normal level - all features enabled
    expect(matrix.isFeatureEnabled("parallelRequests")).toBe(true);
    expect(matrix.isFeatureEnabled("retries")).toBe(true);
  });

  it("setManualOverride forces level", () => {
    const matrix = new DegradationMatrix();

    matrix.setManualOverride(OperationLevel.CRITICAL);
    expect(matrix.currentLevel).toBe(OperationLevel.CRITICAL);
  });

  it("clearManualOverride returns to auto", () => {
    const matrix = new DegradationMatrix();

    matrix.setManualOverride(OperationLevel.CRITICAL);
    matrix.clearManualOverride();
    matrix.forceEvaluate(); // Need to force re-evaluation

    // Should re-evaluate based on metrics (back to NORMAL with no data)
    expect(matrix.currentLevel).toBe(OperationLevel.NORMAL);
  });

  it("onLevelChange callback fires", () => {
    let change = null;

    const matrix = new DegradationMatrix({
      onLevelChange: (info) => {
        change = info;
      },
    });

    matrix.setManualOverride(OperationLevel.DEGRADED);

    expect(change).toEqual(expect.any(Object));
    expect(change.from).toBe(OperationLevel.NORMAL);
    expect(change.to).toBe(OperationLevel.DEGRADED);
  });

  it("getEnabledFeatures returns feature list", () => {
    const matrix = new DegradationMatrix();

    const features = matrix.getEnabledFeatures();
    expect(features).toBeInstanceOf(Array);
    expect(features).toContain("caching");
  });

  it("getRecommendations provides actionable advice", () => {
    const matrix = new DegradationMatrix();

    // Create degraded state
    for (let i = 0; i < 10; i++) {
      matrix.recordRequest({ latencyMs: 100, isError: true });
    }

    const recommendations = matrix.getRecommendations();
    expect(recommendations).toBeInstanceOf(Array);
  });

  it("reset returns to normal", () => {
    const matrix = new DegradationMatrix();

    matrix.setManualOverride(OperationLevel.CRITICAL);
    matrix.reset();

    expect(matrix.currentLevel).toBe(OperationLevel.NORMAL);
  });

  it("DegradationPolicy customizes thresholds", () => {
    const policy = new DegradationPolicy({
      thresholds: { errorRateDegraded: 0.5 },
    });

    expect(policy.thresholds.errorRateDegraded).toBe(0.5);
  });

  it("OperationLevel constants", () => {
    expect(OperationLevel.NORMAL).toBe("normal");
    expect(OperationLevel.DEGRADED).toBe("degraded");
    expect(OperationLevel.CRITICAL).toBe("critical");
    expect(OperationLevel.OFFLINE).toBe("offline");
  });

  it("DegradationTrigger constants", () => {
    expect(DegradationTrigger.ERROR_RATE).toBe("error_rate");
    expect(DegradationTrigger.LATENCY).toBe("latency");
    expect(DegradationTrigger.MEMORY).toBe("memory");
  });
});
