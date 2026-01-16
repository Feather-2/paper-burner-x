
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { CircuitBreaker, CircuitState } from "../../../js/agents/shared/utils/circuit-breaker.js";

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
  it("opens after failureThreshold and blocks until openDurationMs elapses", async () => {
    const time = createFakeTime(0);
    const breaker = new CircuitBreaker({
      name: "t",
      failureThreshold: 1,
      successThreshold: 1,
      openDurationMs: 100,
      halfOpenMaxCalls: 1,
      time,
    });

    await expect(() => breaker.execute(async () => { throw new Error("boom"); })).rejects.toThrow(/boom/);
    expect(breaker.state).toBe(CircuitState.OPEN);

    let blockedErr = null;
    try {
      await breaker.execute(async () => "ok");
    } catch (err) {
      blockedErr = err;
    }
    expect(blockedErr).toBeTruthy();
    expect(blockedErr.name).toBe("CircuitBreakerOpenError");

    time.advance(100);
    expect(breaker.state).toBe(CircuitState.HALF_OPEN);
  });

  it("enforces halfOpenMaxCalls and recovers after successThreshold", async () => {
    const time = createFakeTime(0);
    const breaker = new CircuitBreaker({
      name: "t2",
      failureThreshold: 1,
      successThreshold: 1,
      openDurationMs: 1,
      halfOpenMaxCalls: 1,
      time,
    });

    await expect(() => breaker.execute(async () => { throw new Error("fail"); })).rejects.toThrow(/fail/);
    expect(breaker.state).toBe(CircuitState.OPEN);

    time.advance(1);
    expect(breaker.state).toBe(CircuitState.HALF_OPEN);

    let release;
    const pending = new Promise((resolve) => {
      release = () => resolve("ok");
    });

    const first = breaker.execute(async () => pending);
    let secondErr = null;
    try {
      await breaker.execute(async () => "nope");
    } catch (err) {
      secondErr = err;
    }
    expect(secondErr).toBeTruthy();
    expect(secondErr.name).toBe("CircuitBreakerOpenError");

    release();
    const out = await first;
    expect(out).toBe("ok");
    expect(breaker.state).toBe(CircuitState.CLOSED);
  });
});
