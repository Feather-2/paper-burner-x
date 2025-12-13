const test = require("node:test");
const assert = require("node:assert/strict");

test("ErrorHandler.withRetry: retries with exponential backoff", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler({ retryDelayMs: 10, exponentialBackoff: true });
  const slept = [];
  handler.sleep = async (ms) => slept.push(ms);

  let calls = 0;
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
});

test("ErrorHandler.withRetry: throws last error after retries exhausted", async () => {
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const handler = new ErrorHandler({ retryDelayMs: 5, exponentialBackoff: true });
  const slept = [];
  handler.sleep = async (ms) => slept.push(ms);

  let calls = 0;
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
});

test("ErrorHandler.getDelay: exponential vs constant", async () => {
  const { ErrorHandler } = await import("../../../js/agents/core/error-handler.js");

  const exp = new ErrorHandler({ retryDelayMs: 7, exponentialBackoff: true });
  assert.equal(exp.getDelay(0), 7);
  assert.equal(exp.getDelay(1), 14);
  assert.equal(exp.getDelay(2), 28);

  const constant = new ErrorHandler({ retryDelayMs: 7, exponentialBackoff: false });
  assert.equal(constant.getDelay(0), 7);
  assert.equal(constant.getDelay(3), 7);
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

