import { describe, it, expect, vi, beforeEach } from 'vitest';

const circuitBreakerCtorMock = vi.hoisted(() => vi.fn());
const toNonEmptyStringMock = vi.hoisted(() => vi.fn());
const computeCooldownMsMock = vi.hoisted(() => vi.fn());
const disableModelInternalMock = vi.hoisted(() => vi.fn());
const getShortestCooldownInternalMock = vi.hoisted(() => vi.fn());
const isPermanentAuthErrorMock = vi.hoisted(() => vi.fn());
const markHealthyInternalMock = vi.hoisted(() => vi.fn());
const markUnhealthyInternalMock = vi.hoisted(() => vi.fn());
const resetUnhealthyInternalMock = vi.hoisted(() => vi.fn());

const CircuitBreakerMock = vi.hoisted(() => {
  return class CircuitBreaker {
    constructor(options) {
      this.options = options;
      this.reset = vi.fn();
      this.getStats = vi.fn(() => ({ name: options?.name ?? "unknown", state: "closed" }));
      circuitBreakerCtorMock(options);
    }
  };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  CircuitBreaker: CircuitBreakerMock,
  toNonEmptyString: toNonEmptyStringMock,
}));

vi.mock("../../../../../js/agents/llm/internal/fallback.js", () => ({
  computeCooldownMs: computeCooldownMsMock,
  disableModel: disableModelInternalMock,
  getShortestCooldown: getShortestCooldownInternalMock,
  isPermanentAuthError: isPermanentAuthErrorMock,
  markHealthy: markHealthyInternalMock,
  markUnhealthy: markUnhealthyInternalMock,
  resetUnhealthy: resetUnhealthyInternalMock,
}));

import * as healthManager from "../../../../../js/agents/llm/internal/health-manager.js";

const {
  getHealth,
  resetUnhealthy,
  isAvailable,
  computeCooldownMsForBackoff,
  markUnhealthy,
  disableModel,
  markHealthy,
  getShortestCooldown,
  cleanupStaleBreakers,
  maybeCleanupStaleBreakers,
  evictLruBreakers,
  getCircuitBreaker,
  getCircuitBreakerState,
  resetCircuitBreaker,
} = healthManager;

function makeDeepObject(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

function makeLargeString(size) {
  return "x".repeat(size);
}

beforeEach(() => {
  toNonEmptyStringMock.mockReset();
  toNonEmptyStringMock.mockImplementation((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });
  computeCooldownMsMock.mockReset();
  disableModelInternalMock.mockReset();
  getShortestCooldownInternalMock.mockReset();
  isPermanentAuthErrorMock.mockReset();
  isPermanentAuthErrorMock.mockReturnValue(false);
  markHealthyInternalMock.mockReset();
  markUnhealthyInternalMock.mockReset();
  resetUnhealthyInternalMock.mockReset();
  circuitBreakerCtorMock.mockReset();
});

describe("getHealth", () => {
  it("returns stored record for a trimmed model id", () => {
    const healthMap = new Map([["model-1", { ok: true }]]);

    const result = getHealth({ healthMap, modelId: "  model-1  " });

    expect(result).toEqual({ ok: true });
    expect(toNonEmptyStringMock).toHaveBeenCalledWith("  model-1  ");
  });

  it.each([
    { label: "null", modelId: null },
    { label: "undefined", modelId: undefined },
    { label: "empty string", modelId: "" },
    { label: "whitespace", modelId: "   " },
    { label: "zero", modelId: 0 },
    { label: "negative", modelId: -1 },
    { label: "max safe integer", modelId: Number.MAX_SAFE_INTEGER },
    { label: "empty array", modelId: [] },
    { label: "empty object", modelId: {} },
  ])("returns null for $label modelId", ({ modelId }) => {
    const healthMap = new Map([["model-1", { ok: true }]]);

    expect(getHealth({ healthMap, modelId })).toBeNull();
  });

  it("returns null for falsy stored values", () => {
    const healthMap = new Map([
      ["m1", 0],
      ["m2", ""],
      ["m3", false],
    ]);

    expect(getHealth({ healthMap, modelId: "m1" })).toBeNull();
    expect(getHealth({ healthMap, modelId: "m2" })).toBeNull();
    expect(getHealth({ healthMap, modelId: "m3" })).toBeNull();
  });

  it("throws when healthMap is missing", () => {
    expect(() => getHealth({ healthMap: null, modelId: "m1" })).toThrow();
  });
});

describe("resetUnhealthy", () => {
  it("delegates to resetUnhealthyInternal", () => {
    const healthMap = new Map();
    const sentinel = { ok: true };
    resetUnhealthyInternalMock.mockReturnValue(sentinel);

    const result = resetUnhealthy({ healthMap, modelId: "m1" });

    expect(result).toBe(sentinel);
    expect(resetUnhealthyInternalMock).toHaveBeenCalledWith({ healthMap, modelId: "m1" });
  });

  it("forwards boundary inputs", () => {
    const healthMap = {};
    resetUnhealthyInternalMock.mockReturnValue("ok");

    const result = resetUnhealthy({ healthMap, modelId: "" });

    expect(result).toBe("ok");
    expect(resetUnhealthyInternalMock).toHaveBeenCalledWith({ healthMap, modelId: "" });
  });

  it("throws when called without arguments", () => {
    expect(() => resetUnhealthy()).toThrow();
  });
});

describe("isAvailable", () => {
  it("returns true for missing or healthy records", () => {
    const time = { now: vi.fn(() => 100) };
    const healthMap = new Map();

    expect(isAvailable({ healthMap, modelId: "m1", time })).toBe(true);

    healthMap.set("m2", {});
    expect(isAvailable({ healthMap, modelId: "m2", time })).toBe(true);
  });

  it.each([
    { label: "null", modelId: null },
    { label: "undefined", modelId: undefined },
    { label: "empty string", modelId: "" },
    { label: "whitespace", modelId: "   " },
    { label: "zero", modelId: 0 },
    { label: "negative", modelId: -1 },
    { label: "max safe integer", modelId: Number.MAX_SAFE_INTEGER },
    { label: "empty array", modelId: [] },
    { label: "empty object", modelId: {} },
  ])("returns false for invalid modelId $label", ({ modelId }) => {
    const time = { now: vi.fn(() => 10) };
    const healthMap = new Map();

    expect(isAvailable({ healthMap, modelId, time })).toBe(false);
    expect(time.now).not.toHaveBeenCalled();
  });

  it("handles disabled and unhealthyUntilMs boundaries", () => {
    const time = { now: vi.fn(() => 100) };
    const healthMap = new Map();
    healthMap.set("disabled", { disabled: true });
    healthMap.set("unhealthy", { unhealthyUntilMs: 101 });
    healthMap.set("edge", { unhealthyUntilMs: 100 });
    healthMap.set("stringy", { unhealthyUntilMs: "200" });

    expect(isAvailable({ healthMap, modelId: "disabled", time })).toBe(false);
    expect(isAvailable({ healthMap, modelId: "unhealthy", time })).toBe(false);
    expect(isAvailable({ healthMap, modelId: "edge", time })).toBe(true);
    expect(isAvailable({ healthMap, modelId: "stringy", time })).toBe(true);
  });

  it("throws when time is missing for a recorded model", () => {
    const healthMap = new Map([["m1", { unhealthyUntilMs: 10 }]]);

    expect(() => isAvailable({ healthMap, modelId: "m1", time: null })).toThrow();
  });
});

describe("computeCooldownMsForBackoff", () => {
  it("delegates to computeCooldownMs", () => {
    computeCooldownMsMock.mockReturnValue(123);

    const result = computeCooldownMsForBackoff({
      backoffLevel: 2,
      baseCooldownMs: 1000,
      maxCooldownMs: 10_000,
      backoffMultiplier: 2,
    });

    expect(result).toBe(123);
    expect(computeCooldownMsMock).toHaveBeenCalledWith({
      backoffLevel: 2,
      baseCooldownMs: 1000,
      maxCooldownMs: 10_000,
      backoffMultiplier: 2,
    });
  });

  it("forwards string and boundary numeric values", () => {
    computeCooldownMsMock.mockReturnValue(999);

    const result = computeCooldownMsForBackoff({
      backoffLevel: "2",
      baseCooldownMs: "1000",
      maxCooldownMs: Number.MAX_SAFE_INTEGER,
      backoffMultiplier: -1,
    });

    expect(result).toBe(999);
    expect(computeCooldownMsMock).toHaveBeenCalledWith({
      backoffLevel: "2",
      baseCooldownMs: "1000",
      maxCooldownMs: Number.MAX_SAFE_INTEGER,
      backoffMultiplier: -1,
    });
  });

  it("throws when called without arguments", () => {
    expect(() => computeCooldownMsForBackoff()).toThrow();
  });
});

describe("markUnhealthy", () => {
  it("delegates to markUnhealthyInternal", () => {
    const healthMap = new Map();
    const time = { now: vi.fn(() => 5) };
    const error = new Error("boom");
    const sentinel = { ok: false };
    markUnhealthyInternalMock.mockReturnValue(sentinel);

    const result = markUnhealthy({
      healthMap,
      time,
      modelId: "m1",
      error,
      baseCooldownMs: 100,
      maxCooldownMs: 1000,
      backoffMultiplier: 2,
    });

    expect(result).toBe(sentinel);
    expect(markUnhealthyInternalMock).toHaveBeenCalledWith({
      healthMap,
      time,
      modelId: "m1",
      error,
      baseCooldownMs: 100,
      maxCooldownMs: 1000,
      backoffMultiplier: 2,
    });
  });

  it("supports concurrent calls with deep and large errors", async () => {
    const healthMap = new Map();
    const time = { now: vi.fn(() => 10) };
    const deepError = makeDeepObject(12);
    const largeError = makeLargeString(200_000);
    markUnhealthyInternalMock.mockImplementation(({ modelId, error }) => ({ modelId, error }));

    const [first, second] = await Promise.all([
      Promise.resolve(
        markUnhealthy({
          healthMap,
          time,
          modelId: "m1",
          error: deepError,
          baseCooldownMs: 0,
          maxCooldownMs: 1_000,
          backoffMultiplier: 2,
        })
      ),
      Promise.resolve(
        markUnhealthy({
          healthMap,
          time,
          modelId: "m2",
          error: largeError,
          baseCooldownMs: 0,
          maxCooldownMs: 1_000,
          backoffMultiplier: 2,
        })
      ),
    ]);

    expect(first.modelId).toBe("m1");
    expect(second.modelId).toBe("m2");
    expect(markUnhealthyInternalMock).toHaveBeenCalledTimes(2);
  });

  it("throws when called without arguments", () => {
    expect(() => markUnhealthy()).toThrow();
  });
});

describe("disableModel", () => {
  it("delegates to disableModelInternal", () => {
    const healthMap = new Map();
    const error = new Error("auth");
    const sentinel = { disabled: true };
    disableModelInternalMock.mockReturnValue(sentinel);

    const result = disableModel({ healthMap, modelId: "m1", error, reason: "manual" });

    expect(result).toBe(sentinel);
    expect(disableModelInternalMock).toHaveBeenCalledWith({ healthMap, modelId: "m1", error, reason: "manual" });
  });

  it("handles empty inputs and large reasons", () => {
    const healthMap = new Map();
    const hugeReason = makeLargeString(200_000);
    disableModelInternalMock.mockReturnValueOnce("empty").mockReturnValueOnce("huge");

    const emptyResult = disableModel({});
    const hugeResult = disableModel({ healthMap, modelId: "m1", error: {}, reason: hugeReason });

    expect(emptyResult).toBe("empty");
    expect(hugeResult).toBe("huge");
    expect(disableModelInternalMock).toHaveBeenNthCalledWith(1, {
      healthMap: undefined,
      modelId: undefined,
      error: undefined,
      reason: undefined,
    });
    expect(disableModelInternalMock).toHaveBeenNthCalledWith(2, {
      healthMap,
      modelId: "m1",
      error: {},
      reason: hugeReason,
    });
  });

  it("throws when passed null", () => {
    expect(() => disableModel(null)).toThrow();
  });
});

describe("markHealthy", () => {
  it("delegates to markHealthyInternal", () => {
    const healthMap = new Map();
    markHealthyInternalMock.mockReturnValue({ ok: true });

    const result = markHealthy({ healthMap, modelId: "m1" });

    expect(result).toEqual({ ok: true });
    expect(markHealthyInternalMock).toHaveBeenCalledWith({ healthMap, modelId: "m1" });
  });

  it("forwards boundary model ids", () => {
    const healthMap = new Map();
    markHealthyInternalMock.mockReturnValue("ok");

    const result = markHealthy({ healthMap, modelId: "   " });

    expect(result).toBe("ok");
    expect(markHealthyInternalMock).toHaveBeenCalledWith({ healthMap, modelId: "   " });
  });

  it("throws when called without arguments", () => {
    expect(() => markHealthy()).toThrow();
  });
});

describe("getShortestCooldown", () => {
  it("delegates to getShortestCooldownInternal", () => {
    const healthMap = new Map();
    const time = { now: vi.fn(() => 100) };
    const expected = { modelId: "m1", remainingMs: 20 };
    getShortestCooldownInternalMock.mockReturnValue(expected);

    const result = getShortestCooldown({ healthMap, time, candidates: ["m1"] });

    expect(result).toBe(expected);
    expect(getShortestCooldownInternalMock).toHaveBeenCalledWith({ healthMap, time, candidates: ["m1"] });
  });

  it("forwards boundary candidate inputs", () => {
    const healthMap = new Map();
    const time = { now: vi.fn(() => 0) };
    const candidatesAsObject = { 0: "m1", length: 1 };
    getShortestCooldownInternalMock.mockReturnValueOnce(null).mockReturnValueOnce({
      modelId: "m1",
      remainingMs: 0,
    });

    const emptyResult = getShortestCooldown({ healthMap, time, candidates: [] });
    const objectResult = getShortestCooldown({ healthMap, time, candidates: candidatesAsObject });

    expect(emptyResult).toBeNull();
    expect(objectResult).toEqual({ modelId: "m1", remainingMs: 0 });
    expect(getShortestCooldownInternalMock).toHaveBeenNthCalledWith(1, { healthMap, time, candidates: [] });
    expect(getShortestCooldownInternalMock).toHaveBeenNthCalledWith(2, {
      healthMap,
      time,
      candidates: candidatesAsObject,
    });
  });

  it("throws when called without arguments", () => {
    expect(() => getShortestCooldown()).toThrow();
  });
});

describe("cleanupStaleBreakers", () => {
  it("removes stale and invalid breaker records", () => {
    const now = 10_000_000;
    const time = { now: vi.fn(() => now) };
    const circuitBreakers = new Map([
      ["fresh", { lastUsedMs: now - 1000 }],
      ["stale", { lastUsedMs: 0 }],
      ["missing", {}],
      ["nan", { lastUsedMs: Number.NaN }],
    ]);

    cleanupStaleBreakers({ circuitBreakers, time, nowMs: now });

    expect(circuitBreakers.has("fresh")).toBe(true);
    expect(circuitBreakers.has("stale")).toBe(false);
    expect(circuitBreakers.has("missing")).toBe(false);
    expect(circuitBreakers.has("nan")).toBe(false);
    expect(time.now).not.toHaveBeenCalled();
  });

  it("uses time.now when nowMs is invalid", () => {
    const time = { now: vi.fn(() => 9_000_000) };
    const circuitBreakers = new Map([["stale", { lastUsedMs: -2_000_000 }]]);

    cleanupStaleBreakers({ circuitBreakers, time, nowMs: "bad" });

    expect(time.now).toHaveBeenCalledTimes(1);
    expect(circuitBreakers.has("stale")).toBe(false);
  });

  it("throws when circuitBreakers is missing", () => {
    expect(() => cleanupStaleBreakers({ circuitBreakers: null, time: { now: () => 0 } })).toThrow();
  });
});

describe("maybeCleanupStaleBreakers", () => {
  it("cleans up when lastCleanupMs is null and returns now", () => {
    const time = { now: vi.fn(() => 2_000_000) };
    const circuitBreakers = new Map([["stale", { lastUsedMs: 0 }]]);

    const result = maybeCleanupStaleBreakers({ circuitBreakers, time, lastCleanupMs: null });

    expect(result).toBe(2_000_000);
    expect(circuitBreakers.has("stale")).toBe(false);
  });

  it("skips cleanup for rapid consecutive calls within interval", () => {
    const time = { now: vi.fn().mockReturnValueOnce(2_000_000).mockReturnValueOnce(2_000_001) };
    const circuitBreakers = new Map([["stale1", { lastUsedMs: 0 }]]);

    const first = maybeCleanupStaleBreakers({ circuitBreakers, time, lastCleanupMs: null });
    expect(circuitBreakers.has("stale1")).toBe(false);
    circuitBreakers.set("stale2", { lastUsedMs: 0 });
    const second = maybeCleanupStaleBreakers({ circuitBreakers, time, lastCleanupMs: first });

    expect(first).toBe(2_000_000);
    expect(second).toBe(2_000_000);
    expect(circuitBreakers.has("stale2")).toBe(true);
  });

  it("throws when time is missing", () => {
    expect(() => maybeCleanupStaleBreakers({ circuitBreakers: new Map(), time: null, lastCleanupMs: null })).toThrow();
  });
});

describe("evictLruBreakers", () => {
  it("evicts least-recently-used when pool exceeds max", () => {
    const circuitBreakers = new Map();
    circuitBreakers.set("oldest", { lastUsedMs: -1 });
    circuitBreakers.set("second", { lastUsedMs: 0 });
    for (let i = 0; i < 100; i += 1) {
      circuitBreakers.set(`m${i}`, { lastUsedMs: i + 1 });
    }

    expect(circuitBreakers.size).toBe(102);
    evictLruBreakers({ circuitBreakers });

    expect(circuitBreakers.size).toBe(100);
    expect(circuitBreakers.has("oldest")).toBe(false);
    expect(circuitBreakers.has("second")).toBe(false);
  });

  it("does nothing when at or below max and is safe to call repeatedly", () => {
    const circuitBreakers = new Map([
      ["a", { lastUsedMs: 1 }],
      ["b", { lastUsedMs: 2 }],
    ]);

    evictLruBreakers({ circuitBreakers });
    const sizeAfterFirst = circuitBreakers.size;
    evictLruBreakers({ circuitBreakers });

    expect(circuitBreakers.size).toBe(sizeAfterFirst);
    expect(circuitBreakers.has("a")).toBe(true);
    expect(circuitBreakers.has("b")).toBe(true);
  });

  it("throws when circuitBreakers is missing", () => {
    expect(() => evictLruBreakers({ circuitBreakers: null })).toThrow();
  });
});

describe("getCircuitBreaker", () => {
  it("creates and stores a new breaker with expected config", () => {
    const circuitBreakers = new Map();
    const time = { now: vi.fn(() => 123) };
    const logger = { info: vi.fn() };
    const emit = vi.fn();
    const longId = makeLargeString(10_000);
    circuitBreakers.set("oldest", { lastUsedMs: -1 });
    for (let i = 0; i < 99; i += 1) {
      circuitBreakers.set(`m${i}`, { lastUsedMs: i + 1 });
    }

    const breaker = getCircuitBreaker({ modelId: longId, circuitBreakers, time, logger, emit });

    expect(breaker).toBeInstanceOf(CircuitBreakerMock);
    expect(circuitBreakerCtorMock).toHaveBeenCalledTimes(1);
    const options = circuitBreakerCtorMock.mock.calls[0][0];
    expect(options.name).toBe(`model:${longId}`);
    expect(options.failureThreshold).toBe(5);
    expect(options.successThreshold).toBe(2);
    expect(options.openDurationMs).toBe(30_000);
    expect(options.halfOpenMaxCalls).toBe(3);
    expect(options.time).toBe(time);
    expect(circuitBreakers.get(longId).breaker).toBe(breaker);
    expect(circuitBreakers.get(longId).lastUsedMs).toBe(123);
    expect(circuitBreakers.size).toBe(100);
    expect(circuitBreakers.has("oldest")).toBe(false);
  });

  it("filters failures and emits state changes", () => {
    const circuitBreakers = new Map();
    const time = { now: vi.fn(() => 5) };
    const logger = { info: vi.fn() };
    const emit = vi.fn();

    getCircuitBreaker({ modelId: "m1", circuitBreakers, time, logger, emit });
    const options = circuitBreakerCtorMock.mock.calls[0][0];

    expect(options.isFailure({ name: "AbortError" })).toBe(false);
    expect(options.isFailure({ code: "TIMEOUT" })).toBe(false);
    expect(isPermanentAuthErrorMock).not.toHaveBeenCalled();

    isPermanentAuthErrorMock.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(options.isFailure({ code: "AUTH" })).toBe(false);
    expect(options.isFailure(new Error("boom"))).toBe(true);
    expect(isPermanentAuthErrorMock).toHaveBeenCalledTimes(2);

    const event = { name: "model:m1", from: "closed", to: "open", reason: "fail" };
    options.onStateChange(event);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toContain("Circuit breaker");
    expect(emit).toHaveBeenCalledWith("circuit:stateChange", event);
  });

  it("returns existing breaker and updates lastUsedMs", () => {
    const breaker = { getStats: vi.fn(), reset: vi.fn() };
    const circuitBreakers = new Map([["m1", { breaker, lastUsedMs: 1 }]]);
    const time = { now: vi.fn(() => 42) };
    const logger = { info: vi.fn() };
    const emit = vi.fn();

    const result = getCircuitBreaker({ modelId: "m1", circuitBreakers, time, logger, emit });

    expect(result).toBe(breaker);
    expect(circuitBreakers.get("m1").lastUsedMs).toBe(42);
    expect(circuitBreakerCtorMock).not.toHaveBeenCalled();
  });

  it("returns null for invalid modelId", () => {
    const circuitBreakers = new Map();
    const time = { now: vi.fn(() => 1) };
    const logger = { info: vi.fn() };
    const emit = vi.fn();

    const result = getCircuitBreaker({ modelId: "   ", circuitBreakers, time, logger, emit });

    expect(result).toBeNull();
    expect(circuitBreakerCtorMock).not.toHaveBeenCalled();
  });

  it("throws when time is missing", () => {
    expect(() =>
      getCircuitBreaker({
        modelId: "m1",
        circuitBreakers: new Map(),
        time: null,
        logger: { info: vi.fn() },
        emit: vi.fn(),
      })
    ).toThrow();
  });
});

describe("getCircuitBreakerState", () => {
  it("returns breaker stats and updates lastUsedMs", () => {
    const breaker = { getStats: vi.fn(() => ({ ok: true })), reset: vi.fn() };
    const circuitBreakers = new Map([["m1", { breaker, lastUsedMs: 1 }]]);
    const time = { now: vi.fn(() => Number.MAX_SAFE_INTEGER) };

    const result = getCircuitBreakerState({ modelId: "m1", circuitBreakers, time });

    expect(result).toEqual({ ok: true });
    expect(breaker.getStats).toHaveBeenCalledTimes(1);
    expect(circuitBreakers.get("m1").lastUsedMs).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns null for invalid ids or missing breakers", () => {
    const time = { now: vi.fn(() => 10) };
    const circuitBreakers = new Map([["m1", { breaker: null, lastUsedMs: 0 }]]);

    expect(getCircuitBreakerState({ modelId: "   ", circuitBreakers, time })).toBeNull();
    expect(getCircuitBreakerState({ modelId: "missing", circuitBreakers, time })).toBeNull();
  });

  it("throws when time is missing for an existing breaker", () => {
    const breaker = { getStats: vi.fn(() => ({})), reset: vi.fn() };
    const circuitBreakers = new Map([["m1", { breaker, lastUsedMs: 0 }]]);

    expect(() => getCircuitBreakerState({ modelId: "m1", circuitBreakers, time: null })).toThrow();
  });
});

describe("resetCircuitBreaker", () => {
  it("resets breaker and updates lastUsedMs", () => {
    const breaker = { reset: vi.fn(), getStats: vi.fn() };
    const circuitBreakers = new Map([["m1", { breaker, lastUsedMs: 1 }]]);
    const time = { now: vi.fn(() => 55) };

    resetCircuitBreaker({ modelId: "m1", circuitBreakers, time });

    expect(breaker.reset).toHaveBeenCalledTimes(1);
    expect(circuitBreakers.get("m1").lastUsedMs).toBe(55);
  });

  it("ignores missing records or invalid ids", () => {
    const breaker = { reset: vi.fn(), getStats: vi.fn() };
    const circuitBreakers = new Map([["m1", { breaker: null, lastUsedMs: 0 }]]);
    const time = { now: vi.fn(() => 1) };

    resetCircuitBreaker({ modelId: "   ", circuitBreakers, time });
    resetCircuitBreaker({ modelId: "m1", circuitBreakers, time });

    expect(breaker.reset).not.toHaveBeenCalled();
  });

  it("throws when time is missing for an existing breaker", () => {
    const breaker = { reset: vi.fn(), getStats: vi.fn() };
    const circuitBreakers = new Map([["m1", { breaker, lastUsedMs: 0 }]]);

    expect(() => resetCircuitBreaker({ modelId: "m1", circuitBreakers, time: null })).toThrow();
  });
});
