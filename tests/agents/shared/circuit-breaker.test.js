import { describe, it } from "node:test";
import assert from "node:assert/strict";

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

    await assert.rejects(() => breaker.execute(async () => { throw new Error("boom"); }), /boom/);
    assert.equal(breaker.state, CircuitState.OPEN);

    let blockedErr = null;
    try {
      await breaker.execute(async () => "ok");
    } catch (err) {
      blockedErr = err;
    }
    assert.ok(blockedErr);
    assert.equal(blockedErr.name, "CircuitBreakerOpenError");

    time.advance(100);
    assert.equal(breaker.state, CircuitState.HALF_OPEN);
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

    await assert.rejects(() => breaker.execute(async () => { throw new Error("fail"); }), /fail/);
    assert.equal(breaker.state, CircuitState.OPEN);

    time.advance(1);
    assert.equal(breaker.state, CircuitState.HALF_OPEN);

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
    assert.ok(secondErr);
    assert.equal(secondErr.name, "CircuitBreakerOpenError");

    release();
    const out = await first;
    assert.equal(out, "ok");
    assert.equal(breaker.state, CircuitState.CLOSED);
  });
});
