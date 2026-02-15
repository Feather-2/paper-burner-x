import { describe, it, expect, vi, beforeEach } from "vitest";

let mockContainer;
let now;
let mockTime;

const createMockContainer = (entries = []) => {
  const store = new Map(entries);
  return {
    has: vi.fn((key) => store.has(key)),
    register: vi.fn((key, factory) => {
      if (!store.has(key)) {
        store.set(key, factory());
      }
    }),
    get: vi.fn((key) => store.get(key)),
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

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/utils/value-utils.js");
  return {
    ...actual,
    toPositiveInt: vi.fn(actual.toPositiveInt),
  };
});

vi.mock("../../../../../js/agents/core/di/global-container.js", () => ({
  getGlobalContainer: vi.fn(() => mockContainer),
}));

import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitState,
  getGlobalCircuitBreakerRegistry,
  getCircuitBreaker,
  withCircuitBreaker,
} from "../../../../../js/agents/shared/utils/circuit-breaker.js";

import { toPositiveInt } from "../../../../../js/agents/shared/utils/value-utils.js";
import { getGlobalContainer } from "../../../../../js/agents/core/di/global-container.js";

beforeEach(() => {
  vi.clearAllMocks();
  now = 0;
  mockTime = { now: () => now };
  mockContainer = createMockContainer();
});

describe("CircuitState", () => {
  it("has expected values", () => {
    expect(CircuitState.CLOSED).toBe("closed");
    expect(CircuitState.OPEN).toBe("open");
    expect(CircuitState.HALF_OPEN).toBe("half_open");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(CircuitState)).toBe(true);
  });
});

describe("CircuitBreaker", () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      successThreshold: 2,
      openDurationMs: 1000,
      halfOpenMaxCalls: 2,
      time: mockTime,
    });
  });

  it("normalizes numeric options using toPositiveInt for boundary values", () => {
    toPositiveInt.mockClear();
    const b = new CircuitBreaker({
      failureThreshold: 0,
      successThreshold: -1,
      openDurationMs: "7",
      halfOpenMaxCalls: Number.MAX_SAFE_INTEGER,
    });

    expect(toPositiveInt).toHaveBeenCalledTimes(4);
    expect(toPositiveInt).toHaveBeenNthCalledWith(1, 0, 5);
    expect(toPositiveInt).toHaveBeenNthCalledWith(2, -1, 2);
    expect(toPositiveInt).toHaveBeenNthCalledWith(3, "7", 30000);
    expect(toPositiveInt).toHaveBeenNthCalledWith(4, Number.MAX_SAFE_INTEGER, 3);

    expect(b.failureThreshold).toBe(5);
    expect(b.successThreshold).toBe(2);
    expect(b.openDurationMs).toBe(7);
    expect(b.halfOpenMaxCalls).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("falls back for null/empty/whitespace numeric inputs", () => {
    const arrayLike = { 0: "x", length: 1 };
    const b = new CircuitBreaker({
      failureThreshold: null,
      successThreshold: [],
      openDurationMs: "   ",
      halfOpenMaxCalls: arrayLike,
      time: mockTime,
    });

    expect(b.failureThreshold).toBe(5);
    expect(b.successThreshold).toBe(2);
    expect(b.openDurationMs).toBe(30000);
    expect(b.halfOpenMaxCalls).toBe(3);
  });

  it.each([
    { label: "undefined uses default", value: undefined, expected: "default" },
    { label: "null coerces to string", value: null, expected: "null" },
    { label: "empty string", value: "", expected: "" },
    { label: "whitespace string", value: "   ", expected: "   " },
    { label: "empty array", value: [], expected: "" },
    { label: "empty object", value: {}, expected: "[object Object]" },
  ])("coerces name when $label", ({ value, expected }) => {
    const b = new CircuitBreaker({ name: value });
    expect(b.name).toBe(expected);
  });

  it("preserves very long names", () => {
    const longName = "x".repeat(10000);
    const b = new CircuitBreaker({ name: longName });
    expect(b.name).toBe(longName);
  });

  it("canExecute reflects state transitions", () => {
    expect(breaker.canExecute()).toBe(true);

    breaker.trip("manual");
    expect(breaker.canExecute()).toBe(false);

    now = 2000;
    expect(breaker.canExecute()).toBe(true);
    expect(breaker.state).toBe(CircuitState.HALF_OPEN);
  });

  it("ignores stale timeout transition when state changes during check", () => {
    const b = new CircuitBreaker({
      openDurationMs: 1,
      time: mockTime,
    });

    b.trip("manual");
    now = 10;

    let openedAt = b._openedAt;
    Object.defineProperty(b, "_openedAt", {
      configurable: true,
      get() {
        b._state = CircuitState.CLOSED;
        return openedAt;
      },
      set(value) {
        openedAt = value;
      },
    });

    expect(b.state).toBe(CircuitState.CLOSED);
  });

  it("trip opens and records openedAt with reason", () => {
    const events = [];
    const b = new CircuitBreaker({
      name: "trip",
      time: mockTime,
      onStateChange: (event) => events.push(event),
    });

    now = 123;
    b.trip("manual_reason");

    const stats = b.getStats();
    expect(stats.state).toBe(CircuitState.OPEN);
    expect(stats.openedAt).toBe(123);
    expect(events[0]).toMatchObject({
      name: "trip",
      from: CircuitState.CLOSED,
      to: CircuitState.OPEN,
      reason: "manual_reason",
    });
  });

  it("throws CircuitBreakerOpenError when open and does not count the call", async () => {
    breaker.trip("manual");

    await expect(breaker.execute(async () => "ok")).rejects.toMatchObject({
      name: "CircuitBreakerOpenError",
      circuitBreaker: "test",
      state: CircuitState.OPEN,
    });

    expect(breaker.getStats().totalCalls).toBe(0);
  });

  it("opens after failure threshold and records lastFailureTime", async () => {
    const b = new CircuitBreaker({ failureThreshold: 2, time: mockTime });

    now = 10;
    await expect(
      b.execute(async () => {
        throw new Error("fail1");
      })
    ).rejects.toThrow("fail1");

    now = 20;
    await expect(
      b.execute(async () => {
        throw new Error("fail2");
      })
    ).rejects.toThrow("fail2");

    expect(b.state).toBe(CircuitState.OPEN);
    const stats = b.getStats();
    expect(stats.lastFailureTime).toBe(20);
    expect(stats.totalFailures).toBe(2);
  });

  it("resets failure count on success in closed state", async () => {
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error("fail");
        })
      ).rejects.toThrow();
    }

    expect(breaker.getStats().failureCount).toBe(2);

    await breaker.execute(async () => "ok");

    expect(breaker.getStats().failureCount).toBe(0);
    expect(breaker.state).toBe(CircuitState.CLOSED);
  });

  it("treats non-failure errors as success when isFailure returns false", async () => {
    const err = new Error("soft");
    const b = new CircuitBreaker({
      failureThreshold: 1,
      isFailure: () => false,
      time: mockTime,
    });

    await expect(
      b.execute(async () => {
        throw err;
      })
    ).rejects.toThrow("soft");

    const stats = b.getStats();
    expect(stats.totalFailures).toBe(0);
    expect(stats.totalSuccesses).toBe(1);
    expect(b.state).toBe(CircuitState.CLOSED);
  });

  it("recovers from half-open after success threshold and emits events", async () => {
    const events = [];
    const b = new CircuitBreaker({
      name: "recover",
      failureThreshold: 1,
      successThreshold: 2,
      openDurationMs: 1000,
      time: mockTime,
      onStateChange: (event) => events.push(event),
    });

    await expect(
      b.execute(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow();
    expect(b.state).toBe(CircuitState.OPEN);

    now = 1500;
    expect(b.state).toBe(CircuitState.HALF_OPEN);

    await b.execute(async () => "ok");
    await b.execute(async () => "ok");

    expect(b.state).toBe(CircuitState.CLOSED);
    expect(
      events.some(
        (event) => event.reason === "timeout_elapsed" && event.to === CircuitState.HALF_OPEN
      )
    ).toBe(true);
    expect(
      events.some(
        (event) => event.reason === "recovery_success" && event.to === CircuitState.CLOSED
      )
    ).toBe(true);
  });

  it("reopens on failure during half-open", async () => {
    const b = new CircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 100,
      time: mockTime,
    });

    await expect(
      b.execute(async () => {
        throw new Error("fail");
      })
    ).rejects.toThrow();

    now = 200;
    expect(b.state).toBe(CircuitState.HALF_OPEN);

    await expect(
      b.execute(async () => {
        throw new Error("fail2");
      })
    ).rejects.toThrow();
    expect(b.state).toBe(CircuitState.OPEN);
  });

  it("enforces halfOpenMaxCalls across concurrent probes", async () => {
    const b = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 10,
      halfOpenMaxCalls: 2,
      openDurationMs: 10,
      time: mockTime,
    });

    await expect(
      b.execute(async () => {
        throw new Error("fail");
      })
    ).rejects.toThrow();

    now = 20;
    expect(b.state).toBe(CircuitState.HALF_OPEN);

    const d1 = createDeferred();
    const d2 = createDeferred();
    const fn = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    const p1 = b.execute(fn);
    const p2 = b.execute(fn);
    const callsBefore = b.getStats().totalCalls;
    const p3 = b.execute(fn);

    await expect(p3).rejects.toMatchObject({
      name: "CircuitBreakerOpenError",
      state: CircuitState.HALF_OPEN,
    });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(b.getStats().totalCalls).toBe(callsBefore);

    d1.resolve("a");
    d2.resolve("b");

    await Promise.all([p1, p2]);
  });

  it("tracks simultaneous calls in closed state", async () => {
    const d1 = createDeferred();
    const d2 = createDeferred();
    const fn = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);

    const p1 = breaker.execute(fn);
    const p2 = breaker.execute(fn);

    expect(breaker.getStats().totalCalls).toBe(2);

    d1.resolve("one");
    d2.resolve("two");

    await expect(Promise.all([p1, p2])).resolves.toEqual(["one", "two"]);

    const stats = breaker.getStats();
    expect(stats.totalSuccesses).toBe(2);
  });

  it("handles rapid consecutive calls", async () => {
    const fn = vi.fn(async () => "ok");

    for (let i = 0; i < 10; i++) {
      await breaker.execute(fn);
    }

    const stats = breaker.getStats();
    expect(stats.totalCalls).toBe(10);
    expect(stats.totalSuccesses).toBe(10);
    expect(breaker.state).toBe(CircuitState.CLOSED);
  });

  it("handles large payload results without changing state", async () => {
    const payload = new Uint8Array(1024 * 1024);
    const result = await breaker.execute(async () => payload);

    expect(result.byteLength).toBe(payload.byteLength);
    expect(breaker.state).toBe(CircuitState.CLOSED);
  });

  it("handles deeply nested error objects in isFailure", async () => {
    let nested = { value: "fatal" };
    for (let i = 0; i < 25; i++) {
      nested = { child: nested };
    }
    const err = { response: nested };
    const isFailure = vi.fn((e) => {
      let node = e?.response;
      for (let i = 0; i < 25; i++) {
        node = node?.child;
      }
      return node?.value === "fatal";
    });

    const b = new CircuitBreaker({
      failureThreshold: 1,
      isFailure,
      time: mockTime,
    });

    await expect(
      b.execute(async () => {
        throw err;
      })
    ).rejects.toBe(err);

    expect(isFailure).toHaveBeenCalledWith(err);
    expect(b.state).toBe(CircuitState.OPEN);
  });

  it("reset emits manual_reset only when needed and clears counters", () => {
    const events = [];
    const b = new CircuitBreaker({
      time: mockTime,
      onStateChange: (event) => events.push(event),
    });

    b.reset();
    expect(events).toHaveLength(0);

    b.trip("manual");
    b.reset();

    const resetEvent = events.find((event) => event.reason === "manual_reset");
    expect(resetEvent).toMatchObject({
      from: CircuitState.OPEN,
      to: CircuitState.CLOSED,
      reason: "manual_reset",
    });

    const stats = b.getStats();
    expect(stats.failureCount).toBe(0);
    expect(stats.successCount).toBe(0);
    expect(stats.state).toBe(CircuitState.CLOSED);
  });
});

describe("CircuitBreakerRegistry", () => {
  it("returns same breaker for same normalized name", () => {
    const registry = new CircuitBreakerRegistry();
    const first = registry.get(null);
    const second = registry.get("null");

    expect(first).toBe(second);
  });

  it("applies options only on first creation", () => {
    const registry = new CircuitBreakerRegistry();
    const first = registry.get("alpha", { failureThreshold: 10 });
    const second = registry.get("alpha", { failureThreshold: 1 });

    expect(second).toBe(first);
    expect(second.failureThreshold).toBe(10);
  });

  it("has/remove handle missing entries", () => {
    const registry = new CircuitBreakerRegistry();

    expect(registry.has("missing")).toBe(false);

    registry.get("present");
    expect(registry.has("present")).toBe(true);
    expect(registry.remove("present")).toBe(true);
    expect(registry.has("present")).toBe(false);

    expect(registry.remove("missing")).toBe(false);
  });

  it("getAllStats returns stats for registered breakers and empty for none", () => {
    const registry = new CircuitBreakerRegistry();

    expect(registry.getAllStats()).toEqual({});

    registry.get("a");
    registry.get("b");

    const stats = registry.getAllStats();
    expect(Object.keys(stats).sort()).toEqual(["a", "b"]);
    expect(stats.a.state).toBe(CircuitState.CLOSED);
  });

  it("resetAll resets all breakers", () => {
    const registry = new CircuitBreakerRegistry();
    const a = registry.get("a");
    const b = registry.get("b");

    a.trip("test");
    b.trip("test");

    registry.resetAll();

    expect(a.state).toBe(CircuitState.CLOSED);
    expect(b.state).toBe(CircuitState.CLOSED);
  });
});

describe("getGlobalCircuitBreakerRegistry", () => {
  it("registers registry when missing from container", () => {
    mockContainer = createMockContainer();

    const registry = getGlobalCircuitBreakerRegistry();

    expect(getGlobalContainer).toHaveBeenCalledTimes(1);
    expect(mockContainer.register).toHaveBeenCalledWith(
      "circuitBreakerRegistry",
      expect.any(Function)
    );
    expect(mockContainer.get).toHaveBeenCalledWith("circuitBreakerRegistry");
    expect(registry).toBeInstanceOf(CircuitBreakerRegistry);
  });

  it("returns existing registry without registering again", () => {
    const existing = new CircuitBreakerRegistry();
    mockContainer = createMockContainer([["circuitBreakerRegistry", existing]]);

    const registry = getGlobalCircuitBreakerRegistry();

    expect(registry).toBe(existing);
    expect(mockContainer.register).not.toHaveBeenCalled();
  });
});

describe("getCircuitBreaker", () => {
  it("delegates to global registry with name and options", () => {
    const registry = { get: vi.fn().mockReturnValue("breaker") };
    mockContainer = createMockContainer([["circuitBreakerRegistry", registry]]);

    const result = getCircuitBreaker("alpha", { failureThreshold: 9 });

    expect(registry.get).toHaveBeenCalledWith("alpha", { failureThreshold: 9 });
    expect(result).toBe("breaker");
  });
});

describe("withCircuitBreaker", () => {
  it("executes via registry breaker", async () => {
    const execute = vi.fn((fn) => fn());
    const registry = { get: vi.fn().mockReturnValue({ execute }) };
    mockContainer = createMockContainer([["circuitBreakerRegistry", registry]]);

    const fn = vi.fn(async () => "ok");
    const result = await withCircuitBreaker("test", fn, { openDurationMs: 1 });

    expect(registry.get).toHaveBeenCalledWith("test", { openDurationMs: 1 });
    expect(execute).toHaveBeenCalledWith(fn);
    expect(result).toBe("ok");
  });
});
