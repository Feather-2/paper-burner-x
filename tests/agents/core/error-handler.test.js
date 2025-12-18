const test = require("node:test");
const assert = require("node:assert/strict");

test("ErrorHandler.withRetry: retries with exponential backoff", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler({ retryDelayMs: 10, exponentialBackoff: true });
  const slept = [];
  handler.sleep = async (ms) => slept.push(ms);

  let calls = 0;
  const origRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const out = await handler.withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new DeepSearchError("rate limit", { level: ErrorLevel.RETRYABLE });
        return "ok";
      },
      { retries: 4 }
    );

    assert.equal(out, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(slept, [10, 20]);
  } finally {
    Math.random = origRandom;
  }
});

test("ErrorHandler.withRetry: throws last error after retries exhausted", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler({ retryDelayMs: 5, exponentialBackoff: true });
  const slept = [];
  handler.sleep = async (ms) => slept.push(ms);

  let calls = 0;
  const origRandom = Math.random;
  Math.random = () => 0.5;
  try {
    await assert.rejects(
      handler.withRetry(
        async () => {
          calls++;
          throw new DeepSearchError("timeout", { level: ErrorLevel.RETRYABLE });
        },
        { retries: 2 }
      ),
      (err) => {
        assert.ok(err instanceof DeepSearchError);
        assert.equal(err.level, ErrorLevel.RETRYABLE);
        return true;
      }
    );

    assert.equal(calls, 3);
    assert.deepEqual(slept, [5, 10]);
  } finally {
    Math.random = origRandom;
  }
});

test("ErrorHandler.getDelay: exponential vs constant", async () => {
  const { ErrorHandler } = await import("../../../js/agents/core/error-handler.js");

  const exp = new ErrorHandler({ retryDelayMs: 7, exponentialBackoff: true });
  assert.equal(exp.getDelay(0, { jitter: false }), 7);
  assert.equal(exp.getDelay(1, { jitter: false }), 14);
  assert.equal(exp.getDelay(2, { jitter: false }), 28);

  const constant = new ErrorHandler({ retryDelayMs: 7, exponentialBackoff: false });
  assert.equal(constant.getDelay(0, { jitter: false }), 7);
  assert.equal(constant.getDelay(3, { jitter: false }), 7);
});

test("ErrorHandler.getDelay: full jitter varies and stays within expected band", async () => {
  const { ErrorHandler } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler({ retryDelayMs: 1000, exponentialBackoff: true });

  const origRandom = Math.random;
  const seq = [0, 0.25, 0.5, 0.75];
  let i = 0;
  Math.random = () => seq[i++ % seq.length];
  try {
    const delays = Array.from({ length: 8 }, () => handler.getDelay(0, { jitter: true, maxDelayMs: 30000 }));
    const unique = new Set(delays);
    assert.ok(unique.size > 1);
    for (const d of delays) {
      assert.ok(d >= 500 && d <= 1500);
    }
  } finally {
    Math.random = origRandom;
  }
});

test("ErrorHandler.sleep: supports AbortSignal and rejects on abort", async () => {
  const { ErrorHandler } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler();
  const ac = new AbortController();
  setTimeout(() => ac.abort(new Error("stop")), 10);

  await assert.rejects(handler.sleep(1000, ac.signal), /stop/);
});

test("ErrorHandler.withRetry: aborts immediately when signal already aborted", async () => {
  const { ErrorHandler } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler();
  const ac = new AbortController();
  ac.abort(new Error("user_cancel"));

  let called = 0;
  await assert.rejects(handler.withRetry(async () => {
    called++;
    return "ok";
  }, { signal: ac.signal }), /user_cancel/);
  assert.equal(called, 0);
});

test("ErrorHandler.withRetry: abort during backoff interrupts retry sleep", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler({ retryDelayMs: 200, exponentialBackoff: true });
  const ac = new AbortController();

  const origRandom = Math.random;
  Math.random = () => 0.5;
  try {
    setTimeout(() => ac.abort(new Error("cancelled")), 10);

    let calls = 0;
    await assert.rejects(
      handler.withRetry(
        async () => {
          calls++;
          throw new DeepSearchError("timeout", { level: ErrorLevel.RETRYABLE });
        },
        { retries: 5, signal: ac.signal }
      ),
      /cancelled/
    );
    assert.equal(calls, 1);
  } finally {
    Math.random = origRandom;
  }
});

test("ErrorHandler.withRetry: allows overriding isRetryable to stop retries", async () => {
  const { ErrorHandler } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler({ retryDelayMs: 10, exponentialBackoff: true });
  const slept = [];
  handler.sleep = async (ms) => slept.push(ms);

  let calls = 0;
  await assert.rejects(
    handler.withRetry(
      async () => {
        calls++;
        throw new Error("timeout");
      },
      { retries: 3, isRetryable: () => false }
    ),
    /timeout/
  );

  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test("ErrorHandler.withDegradation: fallback used for degradable errors", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler();
  let degraded = 0;

  const out = await handler.withDegradation(
    async () => {
      throw new DeepSearchError("external search failed", { level: ErrorLevel.DEGRADABLE });
    },
    async () => "fallback",
    {
      onDegrade: ({ error }) => {
        assert.ok(error instanceof DeepSearchError);
        degraded++;
      },
    }
  );

  assert.equal(out, "fallback");
  assert.equal(degraded, 1);
});

test("ErrorHandler.withDegradation: non-degradable errors propagate", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler();
  await assert.rejects(handler.withDegradation(async () => {
    throw new DeepSearchError("bad schema", { level: ErrorLevel.FATAL });
  }, async () => "fallback"));
});

test("ErrorHandler.isRetryable: DeepSearchError and message heuristics", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler();

  assert.equal(handler.isRetryable(new DeepSearchError("x", { level: ErrorLevel.RETRYABLE })), true);
  assert.equal(handler.isRetryable(new DeepSearchError("x", { level: ErrorLevel.FATAL, canRetry: true })), true);
  assert.equal(handler.isRetryable(new DeepSearchError("x", { level: ErrorLevel.FATAL })), false);

  assert.equal(handler.isRetryable(new Error("timeout while calling api")), true);
  assert.equal(handler.isRetryable(new Error("Rate Limit exceeded")), true);
  assert.equal(handler.isRetryable(new Error("HTTP 429 Too Many Requests")), true);
  assert.equal(handler.isRetryable(new Error("HTTP 503 Service Unavailable")), true);
  assert.equal(handler.isRetryable(new Error("bad request")), false);
});

test("ErrorHandler.recordError: writes to timeline", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler();
  const timeline = [];
  const state = { addTimeline: (evt) => timeline.push(evt) };

  const err = new DeepSearchError("parse failed", { level: ErrorLevel.RECOVERABLE, context: { sourceId: "s1" } });
  assert.match(err.timestamp, /^\d{4}-\d{2}-\d{2}T/);

  handler.recordError(state, err, { stage: "deepsearch.scan" });

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].name, "deepsearch.error.recoverable");
  assert.equal(timeline[0].status, "error");
  assert.deepEqual(timeline[0].payload, {
    stage: "deepsearch.scan",
    message: "parse failed",
    level: ErrorLevel.RECOVERABLE,
    context: { sourceId: "s1" },
  });

  handler.recordError(null, err, { stage: "noop" });
});

test("ErrorHandler.isDegradable: recognizes degradable DeepSearchError", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler();
  assert.equal(handler.isDegradable(new DeepSearchError("x", { level: ErrorLevel.DEGRADABLE })), true);
  assert.equal(handler.isDegradable(new DeepSearchError("x", { level: ErrorLevel.RECOVERABLE })), false);
});

test("CircuitBreaker: threshold trips OPEN and emits state change", async () => {
  const { CircuitBreaker, CircuitState } = await import("../../../js/agents/core/error-handler.js");

  const events = [];
  const breaker = new CircuitBreaker({
    name: "cb.threshold",
    threshold: 2,
    onStateChange: (evt) => events.push(evt),
  });

  assert.equal(breaker.getState(), CircuitState.CLOSED);
  await assert.rejects(breaker.execute(async () => {
    throw new Error("fail1");
  }));
  assert.equal(breaker.getState(), CircuitState.CLOSED);

  await assert.rejects(breaker.execute(async () => {
    throw new Error("fail2");
  }));

  assert.equal(breaker.getState(), CircuitState.OPEN);
  assert.equal(breaker.canExecute(), false);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "cb.threshold");
  assert.equal(events[0].from, CircuitState.CLOSED);
  assert.equal(events[0].to, CircuitState.OPEN);
  assert.equal(events[0].failures, 2);
  assert.match(events[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("CircuitBreaker: OPEN transitions to HALF_OPEN after resetTimeMs", async () => {
  const { CircuitBreaker, CircuitState } = await import("../../../js/agents/core/error-handler.js");

  const events = [];
  const breaker = new CircuitBreaker({
    name: "cb.reset",
    threshold: 1,
    resetTimeMs: 1000,
    onStateChange: (evt) => events.push(evt),
  });

  await assert.rejects(breaker.execute(async () => {
    throw new Error("boom");
  }));
  assert.equal(breaker.getState(), CircuitState.OPEN);

  breaker.lastFailureTime = Date.now() - breaker.resetTimeMs;
  assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

  assert.equal(events.length, 2);
  assert.equal(events[0].to, CircuitState.OPEN);
  assert.equal(events[1].from, CircuitState.OPEN);
  assert.equal(events[1].to, CircuitState.HALF_OPEN);
});

test("CircuitBreaker: HALF_OPEN allows limited probe requests and recovers on success", async () => {
  const { CircuitBreaker, CircuitState } = await import("../../../js/agents/core/error-handler.js");

  const breaker = new CircuitBreaker({
    name: "cb.halfopen",
    threshold: 1,
    resetTimeMs: 1000,
    halfOpenRequests: 1,
  });

  await assert.rejects(breaker.execute(async () => {
    throw new Error("trip");
  }));
  assert.equal(breaker.getState(), CircuitState.OPEN);

  breaker.lastFailureTime = Date.now() - breaker.resetTimeMs;
  assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

  let resolveProbe;
  const probe = breaker.execute(() => new Promise((resolve) => (resolveProbe = resolve)));

  let fallbackCalled = 0;
  const out = await breaker.execute(
    async () => "should_not_run",
    {
      fallback: (err) => {
        fallbackCalled++;
        assert.match(err.message, /is OPEN/);
        return "fallback";
      },
    }
  );
  assert.equal(out, "fallback");
  assert.equal(fallbackCalled, 1);

  resolveProbe("ok");
  assert.equal(await probe, "ok");
  assert.equal(breaker.getState(), CircuitState.CLOSED);

  assert.equal(await breaker.execute(async () => "ok2"), "ok2");
});

test("CircuitBreaker: HALF_OPEN failure re-opens circuit", async () => {
  const { CircuitBreaker, CircuitState } = await import("../../../js/agents/core/error-handler.js");

  const breaker = new CircuitBreaker({
    name: "cb.halfopen.fail",
    threshold: 1,
    resetTimeMs: 1000,
  });

  await assert.rejects(breaker.execute(async () => {
    throw new Error("trip");
  }));
  assert.equal(breaker.getState(), CircuitState.OPEN);

  breaker.lastFailureTime = Date.now() - breaker.resetTimeMs;
  assert.equal(breaker.getState(), CircuitState.HALF_OPEN);

  await assert.rejects(breaker.execute(async () => {
    throw new Error("still bad");
  }), /still bad/);
  assert.equal(breaker.getState(), CircuitState.OPEN);
});

test("CircuitBreaker: reset(), getStats(), and AbortSignal handling", async () => {
  const { CircuitBreaker, CircuitState } = await import("../../../js/agents/core/error-handler.js");

  const breaker = new CircuitBreaker({ name: "cb.stats", threshold: 1, resetTimeMs: 1000 });
  assert.deepEqual(breaker.getStats(), {
    name: "cb.stats",
    state: CircuitState.CLOSED,
    failures: 0,
    successes: 0,
    lastFailureTime: null,
    threshold: 1,
    resetTimeMs: 1000,
  });

  const ac = new AbortController();
  ac.abort(new Error("nope"));
  await assert.rejects(breaker.execute(async () => "x", { signal: ac.signal }), /nope/);

  await assert.rejects(breaker.execute(async () => {
    throw new Error("fail");
  }), /fail/);
  assert.equal(breaker.getState(), CircuitState.OPEN);

  breaker.reset();
  assert.equal(breaker.getState(), CircuitState.CLOSED);
});

test("Global circuit breaker registry: getCircuitBreaker singleton and resetAllBreakers", async () => {
  const { getCircuitBreaker, resetAllBreakers, CircuitState } = await import("../../../js/agents/core/error-handler.js");

  const name = `cb.global.${Date.now()}`;
  const a = getCircuitBreaker(name, { threshold: 2 });
  const b = getCircuitBreaker(name, { threshold: 99 });
  assert.equal(a, b);
  assert.equal(a.threshold, 2);

  await assert.rejects(a.execute(async () => {
    throw new Error("1");
  }));
  await assert.rejects(a.execute(async () => {
    throw new Error("2");
  }));
  assert.equal(a.getState(), CircuitState.OPEN);

  resetAllBreakers();
  assert.equal(a.getState(), CircuitState.CLOSED);
});

test("ErrorHandler.withRetry: integrates circuitBreaker and stops retries when breaker opens", async () => {
  const { ErrorHandler, CircuitBreaker, DeepSearchError, ErrorLevel, CircuitState } = await import(
    "../../../js/agents/core/error-handler.js"
  );

  const handler = new ErrorHandler({ retryDelayMs: 10, exponentialBackoff: true });
  const slept = [];
  handler.sleep = async (ms) => slept.push(ms);

  const breaker = new CircuitBreaker({ name: "cb.retry", threshold: 1, resetTimeMs: 1000 });

  let calls = 0;
  await assert.rejects(
    handler.withRetry(
      async () => {
        calls++;
        throw new DeepSearchError("rate limit", { level: ErrorLevel.RETRYABLE });
      },
      { retries: 5, circuitBreaker: breaker }
    )
  );

  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
  assert.equal(breaker.getState(), CircuitState.OPEN);

  calls = 0;
  await assert.rejects(handler.withRetry(async () => {
    calls++;
    return "ok";
  }, { circuitBreaker: breaker }), /Circuit breaker \[cb\.retry\] is OPEN/);
  assert.equal(calls, 0);
});
