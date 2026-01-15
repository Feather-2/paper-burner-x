import { describe, it, expect, vi, afterEach } from "vitest";

import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitState,
  getGlobalCircuitBreakerRegistry,
  getCircuitBreaker,
  withCircuitBreaker,
} from "../../../../js/agents/shared/utils/circuit-breaker.js";

import { Container } from "../../../../js/agents/runtime/di/container.js";
import { getGlobalContainer, setGlobalContainer } from "../../../../js/agents/runtime/di/global-container.js";

function createFakeTime(startMs = 0) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance: (ms) => {
      nowMs += Math.max(0, Math.floor(ms || 0));
    },
  };
}

describe("CircuitBreaker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to CLOSED and canExecute() returns true", () => {
    const breaker = new CircuitBreaker(); // exercises default time provider
    expect(breaker.state).toBe(CircuitState.CLOSED);
    expect(breaker.canExecute()).toBe(true);
  });

  it("opens after reaching failureThreshold and transitions to HALF_OPEN after openDurationMs", async () => {
    const time = createFakeTime(0);
    const onStateChange = vi.fn();

    const breaker = new CircuitBreaker({
      name: "svc",
      failureThreshold: 2,
      successThreshold: 1,
      openDurationMs: 100,
      halfOpenMaxCalls: 1,
      time,
      onStateChange,
    });

    await expect(breaker.execute(async () => "ok")).resolves.toBe("ok");

    await expect(breaker.execute(async () => { throw new Error("boom-1"); })).rejects.toThrow("boom-1");
    expect(breaker.state).toBe(CircuitState.CLOSED);
    expect(breaker.canExecute()).toBe(true);

    await expect(breaker.execute(async () => { throw new Error("boom-2"); })).rejects.toThrow("boom-2");
    expect(breaker.state).toBe(CircuitState.OPEN);
    expect(breaker.canExecute()).toBe(false);

    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      name: "svc",
      from: CircuitState.CLOSED,
      to: CircuitState.OPEN,
      reason: "failure_threshold",
    }));

    const blocked = breaker.execute(async () => "should-not-run");
    await expect(blocked).rejects.toMatchObject({
      name: "CircuitBreakerOpenError",
      circuitBreaker: "svc",
      state: CircuitState.OPEN,
    });

    time.advance(99);
    expect(breaker.state).toBe(CircuitState.OPEN);

    time.advance(1);
    expect(breaker.state).toBe(CircuitState.HALF_OPEN);
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      from: CircuitState.OPEN,
      to: CircuitState.HALF_OPEN,
      reason: "timeout_elapsed",
    }));
  });

  it("enforces halfOpenMaxCalls and recovers after successThreshold successes", async () => {
    const time = createFakeTime(0);
    const onStateChange = vi.fn();

    const breaker = new CircuitBreaker({
      name: "svc2",
      failureThreshold: 1,
      successThreshold: 1,
      openDurationMs: 10,
      halfOpenMaxCalls: 1,
      time,
      onStateChange,
    });

    await expect(breaker.execute(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(breaker.state).toBe(CircuitState.OPEN);

    time.advance(10);
    expect(breaker.state).toBe(CircuitState.HALF_OPEN);

    let resolvePending;
    const pending = new Promise((resolve) => {
      resolvePending = () => resolve("ok");
    });

    const first = breaker.execute(async () => pending);
    expect(breaker.canExecute()).toBe(false);

    await expect(breaker.execute(async () => "nope")).rejects.toMatchObject({
      name: "CircuitBreakerOpenError",
      state: CircuitState.HALF_OPEN,
      circuitBreaker: "svc2",
    });

    resolvePending();
    await expect(first).resolves.toBe("ok");
    expect(breaker.state).toBe(CircuitState.CLOSED);

    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      from: CircuitState.HALF_OPEN,
      to: CircuitState.CLOSED,
      reason: "recovery_success",
    }));
  });

  it("re-opens if a probe fails during HALF_OPEN", async () => {
    const time = createFakeTime(0);
    const onStateChange = vi.fn();

    const breaker = new CircuitBreaker({
      name: "svc3",
      failureThreshold: 1,
      successThreshold: 2,
      openDurationMs: 5,
      halfOpenMaxCalls: 2,
      time,
      onStateChange,
    });

    await expect(breaker.execute(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    time.advance(5);
    expect(breaker.state).toBe(CircuitState.HALF_OPEN);

    await expect(breaker.execute(async () => { throw new Error("probe failed"); })).rejects.toThrow("probe failed");
    expect(breaker.state).toBe(CircuitState.OPEN);

    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({
      from: CircuitState.HALF_OPEN,
      to: CircuitState.OPEN,
      reason: "half_open_failure",
    }));
  });

  it("treats non-failure errors as success (but still rethrows the error)", async () => {
    const time = createFakeTime(0);
    const isFailure = vi.fn((err) => err?.fatal !== false);

    const breaker = new CircuitBreaker({
      name: "svc4",
      failureThreshold: 1,
      successThreshold: 1,
      openDurationMs: 50,
      halfOpenMaxCalls: 1,
      time,
      isFailure,
    });

    const nonFatal = /** @type {any} */ (new Error("non-fatal"));
    nonFatal.fatal = false;

    await expect(breaker.execute(async () => { throw nonFatal; })).rejects.toBe(nonFatal);
    expect(isFailure).toHaveBeenCalledWith(nonFatal);
    expect(breaker.state).toBe(CircuitState.CLOSED);

    const stats = breaker.getStats();
    expect(stats.totalCalls).toBe(1);
    expect(stats.totalFailures).toBe(0);
    expect(stats.totalSuccesses).toBe(1);
  });

  it("trip()/reset() cause state transitions; redundant transitions are ignored", () => {
    const onStateChange = vi.fn();
    const breaker = new CircuitBreaker({ name: "svc5", onStateChange });

    breaker.trip("manual");
    expect(breaker.state).toBe(CircuitState.OPEN);

    // No-op (already OPEN)
    breaker.trip("manual-2");

    // trip -> reset should emit exactly 2 transitions (OPEN + manual_reset back to CLOSED)
    breaker.reset();
    expect(breaker.state).toBe(CircuitState.CLOSED);

    const reasons = onStateChange.mock.calls.map((c) => c[0].reason);
    expect(reasons).toEqual(["manual", "manual_reset"]);
  });
});

describe("CircuitBreakerRegistry", () => {
  it("creates and returns named breaker singletons", () => {
    const registry = new CircuitBreakerRegistry();
    const breakerA1 = registry.get("a", { failureThreshold: 1 });
    const breakerA2 = registry.get("a", { failureThreshold: 999 });

    expect(breakerA1).toBe(breakerA2);
    expect(breakerA1.name).toBe("a");
    expect(registry.has("a")).toBe(true);
    expect(registry.remove("a")).toBe(true);
    expect(registry.has("a")).toBe(false);
  });

  it("returns stats for all breakers and can resetAll()", async () => {
    const time = createFakeTime(0);
    const registry = new CircuitBreakerRegistry();
    const b = registry.get("b", { time, failureThreshold: 1, openDurationMs: 10 });

    await expect(b.execute(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    expect(b.state).toBe(CircuitState.OPEN);

    const stats = registry.getAllStats();
    expect(stats.b.state).toBe(CircuitState.OPEN);

    registry.resetAll();
    expect(b.state).toBe(CircuitState.CLOSED);
  });
});

describe("global circuit breaker helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a global registry in the global DI container and reuses it", async () => {
    const previous = getGlobalContainer();
    const container = new Container();
    setGlobalContainer(container);

    try {
      const r1 = getGlobalCircuitBreakerRegistry();
      const r2 = getGlobalCircuitBreakerRegistry();
      expect(r1).toBe(r2);
      expect(container.has("circuitBreakerRegistry")).toBe(true);

      const time = createFakeTime(0);
      const breaker = getCircuitBreaker("x", { time, failureThreshold: 1, openDurationMs: 10 });
      expect(breaker.name).toBe("x");

      const fn = vi.fn(async () => "ok");
      await expect(withCircuitBreaker("x", fn, { time })).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      setGlobalContainer(previous);
    }
  });
});

