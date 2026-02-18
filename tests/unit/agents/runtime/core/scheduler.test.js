import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockToPositiveInt } = vi.hoisted(() => ({
  mockToPositiveInt: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  mockToPositiveInt.mockImplementation(actual.toPositiveInt);
  return {
    ...actual,
    toPositiveInt: mockToPositiveInt,
  };
});

import {
  RuntimeHealthStatus,
  TaskPriority,
  RuntimeScheduler,
} from "../../../../../js/agents/runtime/core/scheduler.js";
import { toPositiveInt } from "../../../../../js/agents/shared/index.js";

const createFakeTime = (start = 0) => {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += Math.max(0, Math.floor(ms || 0));
    },
  };
};

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeDeepNested = (depth) => {
  let node = { depth, value: "leaf" };
  for (let i = depth - 1; i >= 0; i -= 1) {
    node = { depth: i, child: node };
  }
  return node;
};

const waitForDeferredCount = async (list, count) => {
  while (list.length < count) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RuntimeHealthStatus", () => {
  it("defines stable, frozen status values", () => {
    expect(RuntimeHealthStatus).toEqual({
      HEALTHY: "healthy",
      DEGRADED: "degraded",
      UNHEALTHY: "unhealthy",
    });
    expect(Object.isFrozen(RuntimeHealthStatus)).toBe(true);
  });
});

describe("TaskPriority", () => {
  it("defines stable, frozen priority values", () => {
    expect(TaskPriority).toEqual({
      HIGH: 0,
      NORMAL: 1,
      LOW: 2,
    });
    expect(Object.isFrozen(TaskPriority)).toBe(true);
  });
});

describe("RuntimeScheduler", () => {
  it("applies scheduling/health defaults for boundary values", () => {
    const scheduler = new RuntimeScheduler({
      scheduling: {
        maxConcurrentPerRuntime: 0,
        maxQueueSize: "   ",
      },
      health: {
        degradedFailureThreshold: -1,
        unhealthyFailureThreshold: "3",
        degradedLatencyMs: 0,
        unhealthyLatencyMs: Number.MAX_SAFE_INTEGER,
        latencyEwmaAlpha: 2,
        recentErrorsMax: "5",
        recoverySuccessThreshold: "2",
        recoveryProbeCodeByType: null,
      },
    });

    expect(scheduler._maxConcurrent).toBe(3);
    expect(scheduler._maxQueueSize).toBe(100);
    expect(scheduler._healthConfig.degradedFailureThreshold).toBe(1);
    expect(scheduler._healthConfig.unhealthyFailureThreshold).toBe(3);
    expect(scheduler._healthConfig.degradedLatencyMs).toBe(2000);
    expect(scheduler._healthConfig.unhealthyLatencyMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(scheduler._healthConfig.latencyEwmaAlpha).toBe(1);
    expect(scheduler._healthConfig.recentErrorsMax).toBe(5);
    expect(scheduler._healthConfig.recoverySuccessThreshold).toBe(2);
    expect(scheduler._healthConfig.recoveryProbeCodeByType).toEqual({});
    expect(Object.isFrozen(scheduler._healthConfig)).toBe(true);

    expect(toPositiveInt).toHaveBeenCalledWith(0, 3);
    expect(toPositiveInt).toHaveBeenCalledWith("   ", 100);
    expect(toPositiveInt).toHaveBeenCalledWith(-1, 1);
    expect(toPositiveInt).toHaveBeenCalledWith("3", 3);
    expect(toPositiveInt).toHaveBeenCalledWith(0, 2000);
    expect(toPositiveInt).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, 10000);
  });

  it("throws for null options input", () => {
    expect(() => new RuntimeScheduler(null)).toThrow();
  });

  it("registerRuntime initializes health and supports empty runtimeType queries", () => {
    const scheduler = new RuntimeScheduler();
    scheduler.registerRuntime("js", { execute: vi.fn() });

    expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.HEALTHY);
    expect(scheduler.getHealthStatus()).toEqual({ js: RuntimeHealthStatus.HEALTHY });
    expect(scheduler.getHealthStatus(null)).toEqual({ js: RuntimeHealthStatus.HEALTHY });
    expect(scheduler.getHealthStatus("")).toEqual({ js: RuntimeHealthStatus.HEALTHY });

    const pyMetrics = scheduler.getHealthMetrics("py");
    expect(pyMetrics.runtimeType).toBe("py");
    expect(pyMetrics.totalCalls).toBe(0);
    expect(pyMetrics.successRate).toBe(null);

    const allMetrics = scheduler.getHealthMetrics();
    expect(Object.keys(allMetrics).sort()).toEqual(["js", "py"]);
  });

  it("returns cloned recentErrors arrays", () => {
    const scheduler = new RuntimeScheduler({ health: { recentErrorsMax: 2 } });
    scheduler._recordResult("js", { success: false, error: "boom" }, { latencyMs: 5 });

    const metrics = scheduler.getHealthMetrics("js");
    metrics.recentErrors.push({ message: "extra", at: 0 });

    const next = scheduler.getHealthMetrics("js");
    expect(next.recentErrors).toHaveLength(1);
    expect(next.recentErrors[0].message).toBe("boom");
  });

  it("isolateRuntime validates runtimeType and uses default reason for whitespace", () => {
    const eventBus = { emit: vi.fn() };
    const time = createFakeTime(0);
    const scheduler = new RuntimeScheduler({ eventBus, time });
    scheduler.registerRuntime("js", {});

    expect(() => scheduler.isolateRuntime("")).toThrow(/runtimeType/i);
    expect(() => scheduler.isolateRuntime(null)).toThrow(/runtimeType/i);
    expect(() => scheduler.isolateRuntime(undefined)).toThrow(/runtimeType/i);
    expect(() => scheduler.isolateRuntime(0)).toThrow(/runtimeType/i);

    scheduler.isolateRuntime("js", { reason: "   " });
    const metrics = scheduler.getHealthMetrics("js");
    expect(metrics.isolated).toBe(true);
    expect(metrics.isolationReason).toBe("manual_isolation");
    expect(metrics.status).toBe(RuntimeHealthStatus.UNHEALTHY);

    expect(eventBus.emit).toHaveBeenCalledWith(
      "runtime.health.changed",
      expect.objectContaining({
        runtimeType: "js",
        to: RuntimeHealthStatus.UNHEALTHY,
        reason: "manual_isolation",
      }),
    );

    eventBus.emit.mockClear();
    scheduler.isolateRuntime("js", { reason: "new_reason" });
    const after = scheduler.getHealthMetrics("js");
    expect(after.isolationReason).toBe("manual_isolation");
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("_clearIsolation resets isolation and marks degraded", () => {
    const time = createFakeTime(10);
    const scheduler = new RuntimeScheduler({ time });
    scheduler.registerRuntime("js", {});
    scheduler.isolateRuntime("js", { reason: "manual" });

    const before = scheduler.getHealthMetrics("js");
    time.advance(5);
    scheduler._clearIsolation("js", { reason: "probe" });

    const metrics = scheduler.getHealthMetrics("js");
    expect(metrics.isolated).toBe(false);
    expect(metrics.isolatedAt).toBe(null);
    expect(metrics.isolationReason).toBe(null);
    expect(metrics.consecutiveFailures).toBe(0);
    expect(metrics.status).toBe(RuntimeHealthStatus.DEGRADED);
    expect(metrics.lastStatusChangeAt).toBeGreaterThan(before.lastStatusChangeAt);
  });

  it("ignores eventBus errors when emitting health changes", () => {
    const eventBus = {
      emit: vi.fn(() => {
        throw new Error("emit_failed");
      }),
    };
    const scheduler = new RuntimeScheduler({ eventBus });
    scheduler.registerRuntime("js", {});

    expect(() =>
      scheduler._setHealthStatus("js", RuntimeHealthStatus.DEGRADED, { reason: "test" }),
    ).not.toThrow();
    expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.DEGRADED);
  });

  it("records results, including blocked and error trimming with EWMA", () => {
    const time = createFakeTime(100);
    const scheduler = new RuntimeScheduler({
      time,
      health: { recentErrorsMax: 2, latencyEwmaAlpha: 1 },
    });

    scheduler._recordResult("js", { success: false, error: "   " }, { latencyMs: "5" });
    let metrics = scheduler.getHealthMetrics("js");
    expect(metrics.totalCalls).toBe(1);
    expect(metrics.failureCount).toBe(1);
    expect(metrics.consecutiveFailures).toBe(1);
    expect(metrics.lastError.message).toBe("Runtime execution failed");
    expect(metrics.averageLatencyMs).toBe(5);
    expect(metrics.lastLatencyMs).toBe(5);
    expect(metrics.recentErrors).toHaveLength(1);

    scheduler._recordResult("js", { success: false, error: "second" }, { latencyMs: -1 });
    metrics = scheduler.getHealthMetrics("js");
    expect(metrics.averageLatencyMs).toBe(5);
    expect(metrics.recentErrors).toHaveLength(2);
    expect(metrics.recentErrors[0].message).toBe("second");

    scheduler._recordResult("js", { success: false, error: "third" }, { latencyMs: 1 });
    metrics = scheduler.getHealthMetrics("js");
    expect(metrics.recentErrors).toHaveLength(2);
    expect(metrics.recentErrors[0].message).toBe("third");

    scheduler._recordResult("js", { success: false, error: "blocked" }, { blocked: true });
    metrics = scheduler.getHealthMetrics("js");
    expect(metrics.blockedCount).toBe(1);
    expect(metrics.totalCalls).toBe(3);
  });

  it("dispatch builds context, preloads dependencies, and wraps raw results", async () => {
    const eventBus = { emit: vi.fn() };
    const vfs = { read: vi.fn() };
    const scheduler = new RuntimeScheduler({ eventBus, vfs });
    const runtime = {
      preload: vi.fn(async () => {}),
      execute: vi.fn(async (code, ctx) => {
        ctx.emit("runtime.event", { code });
        return "ok";
      }),
    };
    scheduler.registerRuntime("js", runtime);

    const controller = new AbortController();
    const dependencies = { files: ["a.js"], meta: { size: 1 } };
    const inputState = { ready: true };
    const result = await scheduler.dispatch("js", "return 1;", inputState, {
      dependencies,
      signal: controller.signal,
      trusted: true,
    });

    expect(result).toEqual({ success: true, data: "ok", metrics: undefined });
    expect(runtime.preload).toHaveBeenCalledWith(dependencies);
    expect(runtime.execute).toHaveBeenCalledWith(
      "return 1;",
      expect.objectContaining({
        vfs,
        state: inputState,
        signal: controller.signal,
        trusted: true,
        emit: expect.any(Function),
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith("runtime.event", { code: "return 1;" });
  });

  it("returns structured failure instead of throwing when runtime is not registered", async () => {
    const scheduler = new RuntimeScheduler();
    const result = await scheduler.dispatch("missing", "return 1;", {}, {});

    expect(result).toMatchObject({
      success: false,
      code: "ERR_RUNTIME_NOT_REGISTERED",
    });
    expect(result.error).toMatch(/not registered/i);
    expect(result.metrics?.queued).toBe(false);
  });

  it("dispatch accepts empty/nullish inputs without crashing", async () => {
    const scheduler = new RuntimeScheduler();
    const runtime = {
      execute: vi.fn(async (code, ctx) => ({
        success: true,
        data: { code, state: ctx.state },
      })),
    };
    scheduler.registerRuntime("js", runtime);

    const cases = [
      { code: "", state: {}, label: "empty string + empty object" },
      { code: "   ", state: [], label: "whitespace string + empty array" },
      { code: "return null;", state: null, label: "null state" },
      { code: "return undefined;", state: undefined, label: "undefined state" },
    ];

    for (const testCase of cases) {
      const result = await scheduler.dispatch("js", testCase.code, testCase.state, {});
      expect(result.success).toBe(true);
      expect(runtime.execute).toHaveBeenLastCalledWith(
        testCase.code,
        expect.objectContaining({ state: testCase.state }),
      );
    }
  });

  it("dispatch handles large payloads and deep nested state", async () => {
    const scheduler = new RuntimeScheduler();
    const runtime = {
      preload: vi.fn(async () => {}),
      execute: vi.fn(async (code, ctx) => ({
        success: true,
        data: { length: code.length, depth: ctx.state.depth },
      })),
    };
    scheduler.registerRuntime("js", runtime);

    const largeCode = "x".repeat(200000);
    const deepState = makeDeepNested(25);
    const largeDeps = { file: "y".repeat(120000) };

    const result = await scheduler.dispatch("js", largeCode, deepState, { dependencies: largeDeps });
    expect(result.success).toBe(true);
    expect(runtime.preload).toHaveBeenCalledWith(largeDeps);
    expect(runtime.execute).toHaveBeenCalledWith(
      largeCode,
      expect.objectContaining({ state: deepState }),
    );
  });

  it("queues tasks by priority and sequence for rapid consecutive calls", async () => {
    const scheduler = new RuntimeScheduler({
      scheduling: { maxConcurrentPerRuntime: 1, maxQueueSize: 10 },
    });
    const deferreds = [];
    const executeOrder = [];
    const runtime = {
      execute: vi.fn((code) => {
        executeOrder.push(code);
        const deferred = createDeferred();
        deferreds.push(deferred);
        return deferred.promise;
      }),
    };
    scheduler.registerRuntime("js", runtime);

    const p1 = scheduler.dispatch("js", "A", {}, {});
    const p2 = scheduler.dispatch("js", "B", {}, { priority: TaskPriority.LOW });
    const p3 = scheduler.dispatch("js", "C", {}, { priority: TaskPriority.HIGH });
    const p4 = scheduler.dispatch("js", "D", {}, { priority: "0" });

    const queued = scheduler._taskQueues.get("js").map((task) => task.code);
    expect(queued).toEqual(["C", "D", "B"]);

    deferreds[0].resolve({ success: true });
    await waitForDeferredCount(deferreds, 2);
    deferreds[1].resolve({ success: true });
    await waitForDeferredCount(deferreds, 3);
    deferreds[2].resolve({ success: true });
    await waitForDeferredCount(deferreds, 4);
    deferreds[3].resolve({ success: true });

    const results = await Promise.all([p1, p2, p3, p4]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(executeOrder).toEqual(["A", "C", "D", "B"]);
  });

  it("returns queue full when maxQueueSize exceeded", async () => {
    const scheduler = new RuntimeScheduler({
      scheduling: { maxConcurrentPerRuntime: 1, maxQueueSize: 1 },
    });
    const deferred = createDeferred();
    const runtime = {
      execute: vi.fn(() => deferred.promise),
    };
    scheduler.registerRuntime("js", runtime);

    const first = scheduler.dispatch("js", "A", {}, {});
    const second = scheduler.dispatch("js", "B", {}, { priority: TaskPriority.NORMAL });
    const third = await scheduler.dispatch("js", "C", {}, {});

    expect(third.success).toBe(false);
    expect(third.error).toMatch(/queue full/i);
    expect(third.metrics?.queued).toBe(false);
    expect(scheduler.getQueueStats("js").queueSize).toBe(1);

    deferred.resolve({ success: true });
    await Promise.resolve();
    await first;
    await second;
  });

  it("drops queued tasks that are aborted before execution", async () => {
    const scheduler = new RuntimeScheduler({
      scheduling: { maxConcurrentPerRuntime: 1, maxQueueSize: 5 },
    });
    const firstDeferred = createDeferred();
    const runtime = {
      execute: vi.fn(() => firstDeferred.promise),
    };
    scheduler.registerRuntime("js", runtime);

    const first = scheduler.dispatch("js", "A", {}, {});
    const controller = new AbortController();
    const second = scheduler.dispatch("js", "B", {}, { signal: controller.signal });

    expect(scheduler.getQueueStats("js").queueSize).toBe(1);
    controller.abort();

    await expect(second).resolves.toMatchObject({
      success: false,
      cancelled: true,
      code: "ERR_TASK_ABORTED",
    });
    expect(scheduler.getQueueStats("js").queueSize).toBe(0);
    expect(runtime.execute).toHaveBeenCalledTimes(1);

    firstDeferred.resolve({ success: true });
    await expect(first).resolves.toMatchObject({ success: true });
  });

  it("fails queued tasks when queue timeout is reached", async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new RuntimeScheduler({
        scheduling: { maxConcurrentPerRuntime: 1, maxQueueSize: 5, queueTimeoutMs: 10 },
      });
      const firstDeferred = createDeferred();
      const runtime = {
        execute: vi.fn(() => firstDeferred.promise),
      };
      scheduler.registerRuntime("js", runtime);

      const first = scheduler.dispatch("js", "A", {}, {});
      const second = scheduler.dispatch("js", "B", {}, {});

      await vi.advanceTimersByTimeAsync(11);
      await expect(second).resolves.toMatchObject({
        success: false,
        code: "ERR_RUNTIME_QUEUE_TIMEOUT",
      });

      firstDeferred.resolve({ success: true });
      await expect(first).resolves.toMatchObject({ success: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks dispatch when runtime is isolated", async () => {
    const scheduler = new RuntimeScheduler();
    const runtime = { execute: vi.fn() };
    scheduler.registerRuntime("js", runtime);
    scheduler.isolateRuntime("js", { reason: "manual" });

    const result = await scheduler.dispatch("js", "return 1;", {}, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/isolated/i);
    expect(runtime.execute).not.toHaveBeenCalled();
    expect(scheduler.getHealthMetrics("js").blockedCount).toBe(1);
  });

  it("handles execution errors and updates health status", async () => {
    const scheduler = new RuntimeScheduler({
      health: { degradedFailureThreshold: 1, unhealthyFailureThreshold: 3 },
    });
    const runtime = {
      execute: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    scheduler.registerRuntime("js", runtime);

    const result = await scheduler.dispatch("js", "bad", {}, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
    expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.DEGRADED);
    expect(scheduler.getHealthMetrics("js").failureCount).toBe(1);
    expect(scheduler.getQueueStats("js").inFlight).toBe(0);
  });

  it("selects probe code based on runtime type", () => {
    const scheduler = new RuntimeScheduler();
    expect(scheduler._defaultProbeCode("js")).toBe("return true;");
    expect(scheduler._defaultProbeCode("JavaScript")).toBe("return true;");
    expect(scheduler._defaultProbeCode("python")).toBe("1+1");
    expect(scheduler._defaultProbeCode("py")).toBe("1+1");
    expect(scheduler._defaultProbeCode("ruby")).toBe("");
  });

  it("recoveryCheck clears isolation when healthCheck succeeds", async () => {
    const time = createFakeTime(0);
    const scheduler = new RuntimeScheduler({
      time,
      health: { recoverySuccessThreshold: 1 },
    });
    const runtime = {
      healthCheck: vi.fn(async () => true),
    };
    scheduler.registerRuntime("js", runtime);
    scheduler.isolateRuntime("js", { reason: "manual" });

    const result = await scheduler.recoveryCheck();
    expect(result.js.ok).toBe(true);
    const metrics = scheduler.getHealthMetrics("js");
    expect(metrics.isolated).toBe(false);
    expect(metrics.status).toBe(RuntimeHealthStatus.DEGRADED);
    expect(runtime.healthCheck).toHaveBeenCalled();
  });

  it("recoveryCheck uses execute probe and handles missing methods", async () => {
    const scheduler = new RuntimeScheduler({
      health: {
        recoverySuccessThreshold: 1,
        recoveryProbeCodeByType: { python: "print(1)" },
      },
    });
    const pyRuntime = {
      execute: vi.fn(async (code) => ({ success: code === "print(1)" })),
    };
    const noopRuntime = {};
    scheduler.registerRuntime("python", pyRuntime);
    scheduler.registerRuntime("noop", noopRuntime);

    scheduler.isolateRuntime("python", { reason: "manual" });
    scheduler.isolateRuntime("noop", { reason: "manual" });

    const results = await scheduler.recoveryCheck();
    expect(pyRuntime.execute).toHaveBeenCalledWith(
      "print(1)",
      expect.objectContaining({ state: {} }),
    );
    expect(results.python.ok).toBe(true);
    expect(scheduler.getHealthMetrics("python").isolated).toBe(false);

    expect(results.noop.ok).toBe(false);
    expect(scheduler.getHealthMetrics("noop").isolated).toBe(true);
    expect(scheduler.getHealthMetrics("noop").lastError?.message).toMatch(/no healthCheck\/execute/i);
  });

  it("recoveryCheck captures healthCheck errors", async () => {
    const scheduler = new RuntimeScheduler({
      health: { recoverySuccessThreshold: 1 },
    });
    const runtime = {
      healthCheck: vi.fn(async () => {
        throw new Error("probe_failed");
      }),
    };
    scheduler.registerRuntime("js", runtime);
    scheduler.isolateRuntime("js", { reason: "manual" });

    const result = await scheduler.recoveryCheck();
    expect(result.js.ok).toBe(false);
    expect(result.js.error).toBe("probe_failed");
  });
});
