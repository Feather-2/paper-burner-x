// Unit tests for performance-router with mocked logger.
// Covers EWMA tracking, routing decisions, and complexity estimation edge cases.
import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerInfoMock = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() =>
  vi.fn(() => ({
    info: loggerInfoMock,
  }))
);

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: createLoggerMock,
}));

import {
  EwmaTracker,
  ModelTier,
  PerformanceRouter,
  TaskComplexity,
  estimateComplexity,
} from "../../../../../js/agents/llm/performance-router.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModelTier", () => {
  it("exposes expected tiers and is frozen", () => {
    expect(ModelTier).toEqual({
      FAST: "fast",
      POWER: "power",
      FALLBACK: "fallback",
    });
    expect(Object.isFrozen(ModelTier)).toBe(true);

    const original = ModelTier.FAST;
    try {
      ModelTier.FAST = "slow";
    } catch {
      // ignore strict-mode mutation errors
    }
    expect(ModelTier.FAST).toBe(original);
  });
});

describe("TaskComplexity", () => {
  it("exposes expected levels and is frozen", () => {
    expect(TaskComplexity).toEqual({
      SIMPLE: "simple",
      MODERATE: "moderate",
      COMPLEX: "complex",
    });
    expect(Object.isFrozen(TaskComplexity)).toBe(true);

    const original = TaskComplexity.SIMPLE;
    try {
      TaskComplexity.SIMPLE = "easy";
    } catch {
      // ignore strict-mode mutation errors
    }
    expect(TaskComplexity.SIMPLE).toBe(original);
  });
});

describe("EwmaTracker", () => {
  it("clamps alpha and preserves initial value stats", () => {
    const tracker = new EwmaTracker({ alpha: 2, initialValue: 42 });
    expect(tracker._alpha).toBe(0.99);
    expect(tracker.value).toBe(42);
    expect(tracker.stats).toEqual({ ewma: 42, count: 0, min: 0, max: 0 });

    const lowAlpha = new EwmaTracker({ alpha: -1 });
    expect(lowAlpha._alpha).toBe(0.01);
  });

  it("records valid samples and updates EWMA stats", () => {
    const tracker = new EwmaTracker({ alpha: 0.5 });
    expect(tracker.record(10)).toBe(10);
    expect(tracker.record(20)).toBe(15);

    const stats = tracker.stats;
    expect(stats.count).toBe(2);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(20);
  });

  it("ignores invalid samples without mutating stats", () => {
    const tracker = new EwmaTracker({ initialValue: 7 });
    const invalidSamples = [null, undefined, "", "10", NaN, Infinity, -Infinity, {}, []];

    invalidSamples.forEach((sample) => {
      expect(tracker.record(sample)).toBe(7);
    });

    expect(tracker.stats).toEqual({ ewma: 7, count: 0, min: 0, max: 0 });
  });

  it("handles boundary values and resets cleanly", () => {
    const tracker = new EwmaTracker();
    tracker.record(0);
    tracker.record(-1);
    tracker.record(Number.MAX_SAFE_INTEGER);

    const stats = tracker.stats;
    expect(stats.count).toBe(3);
    expect(stats.min).toBe(-1);
    expect(stats.max).toBe(Number.MAX_SAFE_INTEGER);

    tracker.reset();
    expect(tracker.stats).toEqual({ ewma: 0, count: 0, min: 0, max: 0 });
  });

  it("supports rapid consecutive updates without corrupting stats", async () => {
    const tracker = new EwmaTracker({ alpha: 0.2 });
    const samples = Array.from({ length: 20 }, (_, index) => index + 1);

    await Promise.all(
      samples.map((sample) => Promise.resolve().then(() => tracker.record(sample)))
    );

    const stats = tracker.stats;
    expect(stats.count).toBe(samples.length);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(20);
  });
});

describe("PerformanceRouter", () => {
  it("registers endpoints with validated tier and weight", () => {
    const router = new PerformanceRouter();
    router.registerEndpoint("bad", { tier: "unknown", weight: "oops" });
    router.registerEndpoint("heavy", { tier: ModelTier.FAST, weight: 12 });
    router.registerEndpoint("light", { tier: ModelTier.FAST, weight: -1 });

    expect(router.getEndpointStats("bad")).toMatchObject({
      tier: ModelTier.POWER,
      weight: 1,
    });
    expect(router.getEndpointStats("heavy")).toMatchObject({
      tier: ModelTier.FAST,
      weight: 10,
    });
    expect(router.getEndpointStats("light")).toMatchObject({
      tier: ModelTier.FAST,
      weight: 0,
    });
  });

  it("ignores invalid endpoint ids and normalizes latency", () => {
    const router = new PerformanceRouter();
    const invalidIds = [null, undefined, "", 0, {}, []];

    invalidIds.forEach((id) => {
      router.recordResult(id, { success: true, latencyMs: 5 });
    });
    expect(Object.keys(router.getAllStats())).toHaveLength(0);

    router.recordResult("ok", { success: true, latencyMs: "10" });
    router.recordResult("ok", { success: true, latencyMs: -1 });
    const stats = router.getEndpointStats("ok");
    expect(stats.successCount).toBe(2);
    expect(stats.latency.ewma).toBe(0);
  });

  it("records errors with penalty latency", () => {
    const router = new PerformanceRouter();
    router.recordResult("bad", { success: false, error: "" });

    const stats = router.getEndpointStats("bad");
    expect(stats.errorCount).toBe(1);
    expect(stats.successCount).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.latency.ewma).toBe(5000);
  });

  it("returns null when no endpoints are selectable", () => {
    const router = new PerformanceRouter();
    expect(router.selectEndpoint()).toBeNull();

    router.registerEndpoint("a");
    router.registerEndpoint("b");
    expect(router.selectEndpoint({ excludeIds: ["a", "b"] })).toBeNull();

    const selected = router.selectEndpoint({ excludeIds: {}, includeIds: {} });
    expect(selected).not.toBeNull();
    expect(["a", "b"]).toContain(selected.endpointId);
  });

  it("prefers fast tier for simple tasks when configured", () => {
    const router = new PerformanceRouter({ preferFastTier: true });
    router.registerEndpoint("fast", { tier: ModelTier.FAST, weight: 1 });
    router.registerEndpoint("power", { tier: ModelTier.POWER, weight: 10 });

    const simplePick = router.selectEndpoint({ complexity: TaskComplexity.SIMPLE });
    expect(simplePick.endpointId).toBe("fast");

    const moderatePick = router.selectEndpoint({ complexity: TaskComplexity.MODERATE });
    expect(moderatePick.endpointId).toBe("power");
  });

  it("falls back to all candidates when target tier is missing", () => {
    const router = new PerformanceRouter({ preferFastTier: true });
    router.registerEndpoint("p1", { tier: ModelTier.POWER, weight: 2 });
    router.registerEndpoint("p2", { tier: ModelTier.POWER, weight: 1 });

    const selected = router.selectEndpoint({ complexity: TaskComplexity.SIMPLE });
    expect(selected.endpointId).toBe("p1");
  });

  it("invokes route decision callback and logs selection", () => {
    const onRouteDecision = vi.fn();
    const router = new PerformanceRouter({ onRouteDecision });
    router.registerEndpoint("fast", { tier: ModelTier.FAST, weight: 1 });

    const selected = router.selectEndpoint({ complexity: TaskComplexity.SIMPLE });
    expect(selected.endpointId).toBe("fast");
    expect(onRouteDecision).toHaveBeenCalledTimes(1);
    expect(onRouteDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: "fast",
        complexity: TaskComplexity.SIMPLE,
        reason: expect.stringContaining("tier=fast"),
      })
    );
    expect(loggerInfoMock).toHaveBeenCalledWith(
      "Endpoint selected",
      expect.objectContaining({ id: "fast" })
    );
  });

  it("returns stats snapshots and ranked endpoints", () => {
    const router = new PerformanceRouter();
    expect(router.getEndpointStats("missing")).toBeNull();
    expect(Object.keys(router.getAllStats())).toHaveLength(0);

    router.registerEndpoint("low", { weight: 1 });
    router.registerEndpoint("high", { weight: 2 });

    const stats = router.getAllStats();
    expect(Object.keys(stats).sort()).toEqual(["high", "low"]);

    const ranked = router.getRankedEndpoints();
    expect(ranked[0].id).toBe("high");
    expect(ranked[1].id).toBe("low");
  });

  it("updates weight and tier with validation", () => {
    const router = new PerformanceRouter();
    router.registerEndpoint("a", { tier: ModelTier.FAST, weight: 1 });

    router.setWeight("a", "3");
    expect(router.getEndpointStats("a").weight).toBe(1);

    router.setWeight("a", Number.MAX_SAFE_INTEGER);
    expect(router.getEndpointStats("a").weight).toBe(10);

    router.setWeight("a", -1);
    expect(router.getEndpointStats("a").weight).toBe(0);

    router.setTier("a", "invalid");
    expect(router.getEndpointStats("a").tier).toBe(ModelTier.FAST);

    router.setTier("a", ModelTier.POWER);
    expect(router.getEndpointStats("a").tier).toBe(ModelTier.POWER);
  });

  it("removes endpoints and resets stats", () => {
    const router = new PerformanceRouter();
    router.registerEndpoint("a", { tier: ModelTier.POWER, weight: 1 });
    router.recordResult("a", { success: true, latencyMs: 12 });
    router.recordResult("a", { success: false, error: "boom" });

    router.resetStats();
    const stats = router.getEndpointStats("a");
    expect(stats.successCount).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.latency).toEqual({ ewma: 0, count: 0, min: 0, max: 0 });
    expect(stats.successRate).toBe(1);

    router.removeEndpoint("a");
    expect(router.getEndpointStats("a")).toBeNull();
  });

  it("handles rapid concurrent result updates", async () => {
    const router = new PerformanceRouter();
    router.registerEndpoint("a");
    const updates = Array.from({ length: 30 }, (_, index) => index);

    await Promise.all(
      updates.map((latency) =>
        Promise.resolve().then(() => router.recordResult("a", { success: true, latencyMs: latency }))
      )
    );

    const stats = router.getEndpointStats("a");
    expect(stats.successCount).toBe(updates.length);
    expect(stats.latency.count).toBe(updates.length);
    expect(stats.latency.min).toBe(0);
    expect(stats.latency.max).toBe(29);
  });
});

describe("estimateComplexity", () => {
  it("returns SIMPLE for empty or non-text inputs", () => {
    const samples = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      { prompt: "" },
      { content: "" },
      { message: "" },
    ];

    samples.forEach((sample) => {
      expect(estimateComplexity(sample)).toBe(TaskComplexity.SIMPLE);
    });
  });

  it("respects token threshold boundaries", () => {
    const simpleText = "a".repeat(396);
    const moderateText = "b".repeat(400);
    const highModerate = "c".repeat(1996);
    const complexText = "d".repeat(2000);

    expect(estimateComplexity({ prompt: simpleText })).toBe(TaskComplexity.SIMPLE);
    expect(estimateComplexity({ prompt: moderateText })).toBe(TaskComplexity.MODERATE);
    expect(estimateComplexity({ content: highModerate })).toBe(TaskComplexity.MODERATE);
    expect(estimateComplexity({ message: complexText })).toBe(TaskComplexity.COMPLEX);
  });

  it("handles huge strings, deep nesting, and non-string prompts", () => {
    const hugeText = "x".repeat(1_000_000);
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 50; i += 1) {
      cursor.nested = {};
      cursor = cursor.nested;
    }

    const task = { content: hugeText, meta: deep };
    expect(estimateComplexity(task)).toBe(TaskComplexity.COMPLEX);
    expect(estimateComplexity({ prompt: 123 })).toBe(TaskComplexity.COMPLEX);
  });
});
