// Unit tests for js/agents/runtime/core/middleware/middleware-chain.js.
// Focus: public API + core business logic + error paths + boundary conditions.
import { beforeEach, describe, expect, it, vi } from "vitest";

import middlewareChainDefault, {
  MiddlewareChain,
  Stage,
  createBlackboardMiddleware,
  createCancellationMiddleware,
  createDefaultMiddlewareChain,
  createLoggingMiddleware,
  createRetryMiddleware,
  createShadowSystemMiddleware,
  createSnapshotMiddleware,
  createTelemetryMiddleware,
  createTimeoutMiddleware,
} from "../../../../../../js/agents/runtime/core/middleware/middleware-chain.js";

const createTestLogger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
});

const makeDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  current.value = "leaf";
  return root;
};

const getDeepValue = (root, depth) => {
  let current = root;
  for (let i = 0; i < depth; i += 1) {
    current = current.next;
  }
  return current.value;
};

const makePushMiddleware = (label, order) => async (_ctx, next) => {
  order.push(label);
  return next();
};

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("middleware-chain default export", () => {
  it("should_export_default_object_with_all_named_exports", () => {
    expect(middlewareChainDefault).toMatchObject({
      Stage,
      MiddlewareChain,
      createLoggingMiddleware,
      createTelemetryMiddleware,
      createCancellationMiddleware,
      createTimeoutMiddleware,
      createRetryMiddleware,
      createSnapshotMiddleware,
      createShadowSystemMiddleware,
      createBlackboardMiddleware,
      createDefaultMiddlewareChain,
    });
  });
});

describe("Stage", () => {
  it("should_return_expected_stage_constants_when_imported", () => {
    expect(Stage).toEqual({
      BEFORE_AGENT: "beforeAgent",
      BEFORE_MODEL: "beforeModel",
      AFTER_MODEL: "afterModel",
      BEFORE_TOOL: "beforeTool",
      AFTER_TOOL: "afterTool",
      AFTER_AGENT: "afterAgent",
    });
  });

  it("should_be_frozen_when_exported", () => {
    expect(Object.isFrozen(Stage)).toBe(true);
  });

  it("should_throw_TypeError_when_mutating_stage", () => {
    expect(() => {
      Stage.BEFORE_AGENT = "mutated";
    }).toThrow(TypeError);
  });

  it("should_keep_original_value_when_reading_stage", () => {
    expect(Stage.BEFORE_AGENT).toBe("beforeAgent");
  });
});

describe("MiddlewareChain", () => {
  it("should_return_zero_length_when_new_chain_created", () => {
    const chain = new MiddlewareChain();
    expect(chain.length).toBe(0);
  });

  it("should_return_self_when_use_adds_middleware", () => {
    const chain = new MiddlewareChain();
    const out = chain.use(async (_ctx, next) => next());
    expect(out).toBe(chain);
  });

  it("should_increment_length_when_use_adds_middleware", () => {
    const chain = new MiddlewareChain();
    chain.use(async (_ctx, next) => next());
    expect(chain.length).toBe(1);
  });

  const invalidMiddlewareValues = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, {}, []];

  it.each(invalidMiddlewareValues)(
    "should_throw_TypeError_when_use_receives_non_function_%p",
    (value) => {
      const chain = new MiddlewareChain();
      expect(() => chain.use(value)).toThrow(TypeError);
    },
  );

  it.each(invalidMiddlewareValues)(
    "should_throw_TypeError_when_insertAt_receives_non_function_%p",
    (value) => {
      const chain = new MiddlewareChain();
      expect(() => chain.insertAt(0, value)).toThrow(TypeError);
    },
  );

  it("should_return_self_when_useAll_receives_empty_array", () => {
    const chain = new MiddlewareChain();
    const out = chain.useAll([]);
    expect(out).toBe(chain);
  });

  it("should_keep_length_zero_when_useAll_receives_empty_array", () => {
    const chain = new MiddlewareChain();
    chain.useAll([]);
    expect(chain.length).toBe(0);
  });

  it.each([{}, null, undefined])(
    "should_throw_TypeError_when_useAll_receives_non_iterable_%p",
    (value) => {
      const chain = new MiddlewareChain();
      expect(() => chain.useAll(value)).toThrow(TypeError);
    },
  );

  it("should_throw_TypeError_when_useAll_receives_string_iterable_of_non_functions", () => {
    const chain = new MiddlewareChain();
    expect(() => chain.useAll("bad")).toThrow(TypeError);
  });

  it("should_execute_middlewares_in_expected_order_when_insertAt_uses_boundary_indices", async () => {
    const order = [];
    const chain = new MiddlewareChain();

    chain.use(makePushMiddleware("A", order));
    chain.use(makePushMiddleware("B", order));
    chain.insertAt(0, makePushMiddleware("START", order));
    chain.insertAt(-1, makePushMiddleware("NEG", order));
    chain.insertAt(Number.MAX_SAFE_INTEGER, makePushMiddleware("MAX", order));

    await chain.execute({});
    expect(order).toEqual(["START", "A", "NEG", "B", "MAX"]);
  });

  it("should_coerce_numeric_string_index_when_insertAt_is_called", async () => {
    const order = [];
    const chain = new MiddlewareChain();

    chain.use(makePushMiddleware("A", order));
    chain.use(makePushMiddleware("B", order));
    chain.insertAt("1", makePushMiddleware("C", order));

    await chain.execute({});
    expect(order).toEqual(["A", "C", "B"]);
  });

  it("should_return_false_when_remove_receives_unknown_middleware", () => {
    const chain = new MiddlewareChain();
    expect(chain.remove(() => {})).toBe(false);
  });

  it("should_return_true_when_remove_removes_existing_middleware", () => {
    const chain = new MiddlewareChain();
    const mw = async (_ctx, next) => next();
    chain.use(mw);
    expect(chain.remove(mw)).toBe(true);
  });

  it("should_decrement_length_when_remove_succeeds", () => {
    const chain = new MiddlewareChain();
    const mw1 = async (_ctx, next) => next();
    const mw2 = async (_ctx, next) => next();
    chain.use(mw1).use(mw2);
    chain.remove(mw1);
    expect(chain.length).toBe(1);
  });

  it("should_reset_length_to_zero_when_clear_is_called", () => {
    const chain = new MiddlewareChain();
    chain.use(async (_ctx, next) => next());
    chain.clear();
    expect(chain.length).toBe(0);
  });

  it("should_return_ctx_when_execute_called_on_empty_chain", async () => {
    const chain = new MiddlewareChain();
    const ctx = {};
    const out = await chain.execute(ctx);
    expect(out).toBe(ctx);
  });

  it("should_return_null_when_execute_called_with_null_ctx", async () => {
    const chain = new MiddlewareChain();
    await expect(chain.execute(null)).resolves.toBeNull();
  });

  it("should_return_undefined_when_execute_called_with_undefined_ctx", async () => {
    const chain = new MiddlewareChain();
    await expect(chain.execute(undefined)).resolves.toBeUndefined();
  });

  it("should_return_finalHandler_result_when_provided", async () => {
    const chain = new MiddlewareChain();
    const out = await chain.execute({ a: 1 }, () => ({ ok: true }));
    expect(out).toEqual({ ok: true });
  });

  it("should_pass_ctx_to_finalHandler_when_provided", async () => {
    const chain = new MiddlewareChain();
    const finalHandler = vi.fn(() => "ok");
    await chain.execute({ a: 1 }, finalHandler);
    expect(finalHandler).toHaveBeenCalledWith({ a: 1 });
  });

  it("should_execute_middlewares_in_onion_order_when_execute_is_called", async () => {
    const chain = new MiddlewareChain();
    const order = [];

    chain.use(async (ctx, next) => {
      order.push("A-before");
      ctx.a ??= 1;
      const result = await next();
      order.push("A-after");
      return result;
    });
    chain.use(async (ctx, next) => {
      order.push("B-before");
      ctx.b = ctx.a + 1;
      const result = await next();
      order.push("B-after");
      return result;
    });

    const ctx = {};
    const out = await chain.execute(ctx);

    expect({ returnedSame: out === ctx, ctx, order }).toEqual({
      returnedSame: true,
      ctx: { a: 1, b: 2 },
      order: ["A-before", "B-before", "B-after", "A-after"],
    });
  });

  it("should_rethrow_error_when_middleware_throws", async () => {
    const chain = new MiddlewareChain();
    chain.use(async () => {
      throw new Error("boom");
    });
    await expect(chain.execute({})).rejects.toThrow("boom");
  });

  it("should_rethrow_error_when_finalHandler_throws", async () => {
    const chain = new MiddlewareChain();
    await expect(chain.execute({}, () => {
      throw new Error("final");
    })).rejects.toThrow("final");
  });

  it("should_support_multiple_next_calls_for_retry_style_flows", async () => {
    const chain = new MiddlewareChain();

    chain.use(async (ctx, next) => {
      ctx.results = [];
      ctx.results.push(await next());
      ctx.results.push(await next());
      return ctx.results;
    });
    chain.use(async (ctx) => {
      ctx.downstream = (ctx.downstream ?? 0) + 1;
      return ctx.downstream;
    });

    const ctx = {};
    const out = await chain.execute(ctx);

    expect({ out, downstream: ctx.downstream }).toEqual({ out: [1, 2], downstream: 2 });
  });

  it("should_isolate_context_between_concurrent_execute_calls", async () => {
    vi.useFakeTimers();
    const chain = new MiddlewareChain();

    chain.use(async (ctx, next) => {
      ctx.events.push(`start-${ctx.id}`);
      const result = await next();
      ctx.events.push(`end-${ctx.id}`);
      return result;
    });
    chain.use(async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, ctx.delay));
      ctx.events.push(`work-${ctx.id}`);
      return ctx.id;
    });

    const ctxA = { id: "A", delay: 5, events: [] };
    const ctxB = { id: "B", delay: 10, events: [] };
    const promiseA = chain.execute(ctxA);
    const promiseB = chain.execute(ctxB);

    await vi.advanceTimersByTimeAsync(20);
    const results = await Promise.all([promiseA, promiseB]);

    expect({ results, ctxAEvents: ctxA.events, ctxBEvents: ctxB.events }).toEqual({
      results: ["A", "B"],
      ctxAEvents: ["start-A", "work-A", "end-A"],
      ctxBEvents: ["start-B", "work-B", "end-B"],
    });
  });

  it("should_not_share_state_between_rapid_sequential_execute_calls", async () => {
    const chain = new MiddlewareChain();

    chain.use(async (ctx, next) => {
      ctx.count = (ctx.count ?? 0) + 1;
      return next();
    });
    chain.use(async (ctx) => {
      ctx.final = true;
      return ctx.count;
    });

    const ctx1 = {};
    const ctx2 = {};

    await chain.execute(ctx1);
    await chain.execute(ctx2);

    expect({ ctx1, ctx2 }).toEqual({
      ctx1: { count: 1, final: true },
      ctx2: { count: 1, final: true },
    });
  });

  it("should_pass_large_payloads_without_mutation", async () => {
    const chain = new MiddlewareChain();
    const deep = makeDeepObject(25);
    const largeFile = "x".repeat(200000);

    const ctx = { deep, fileContent: largeFile, meta: { name: "file.txt" } };
    const out = await chain.execute(ctx, (current) => ({
      size: current.fileContent.length,
      leaf: getDeepValue(current.deep, 25),
    }));

    expect({ out, ctxSize: ctx.fileContent.length, leaf: getDeepValue(ctx.deep, 25) }).toEqual({
      out: { size: 200000, leaf: "leaf" },
      ctxSize: 200000,
      leaf: "leaf",
    });
  });
});

describe("createLoggingMiddleware", () => {
  it("should_throw_TypeError_when_options_is_null", () => {
    expect(() => createLoggingMiddleware(null)).toThrow(TypeError);
  });

  it("should_log_started_and_completed_when_logger_provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const logger = createTestLogger();
    const stepName = `step-${"a".repeat(10000)}`;
    const middleware = createLoggingMiddleware({ logger, prefix: "[T]" });

    const result = await middleware({ stepName }, async () => {
      vi.advanceTimersByTime(12);
      return "ok";
    });

    expect({
      result,
      debugCalls: logger.debug.mock.calls,
      errorCalls: logger.error.mock.calls,
    }).toEqual({
      result: "ok",
      debugCalls: [[`[T] ${stepName} started`], [`[T] ${stepName} completed in 12ms`]],
      errorCalls: [],
    });
  });

  it("should_fallback_to_phase_when_stepName_is_empty_string", async () => {
    const logger = createTestLogger();
    const middleware = createLoggingMiddleware({ logger });

    await middleware({ stepName: "", phase: "phase-1" }, async () => "ok");

    expect(logger.debug.mock.calls[0][0]).toBe("[AgentLoop] phase-1 started");
  });

  it("should_fallback_to_default_step_when_stepName_and_phase_missing", async () => {
    const logger = createTestLogger();
    const middleware = createLoggingMiddleware({ logger });

    await middleware({}, async () => "ok");

    expect(logger.debug.mock.calls[0][0]).toBe("[AgentLoop] step started");
  });

  it("should_use_whitespace_stepName_as_is_when_provided", async () => {
    const logger = createTestLogger();
    const middleware = createLoggingMiddleware({ logger });

    await middleware({ stepName: "   ", phase: "phase-x" }, async () => "ok");

    expect(logger.debug.mock.calls[0][0]).toBe("[AgentLoop]     started");
  });

  it("should_return_next_result_when_logger_is_missing", async () => {
    const out = await createLoggingMiddleware()({ stepName: "silent" }, async () => "ok");
    expect(out).toBe("ok");
  });

  it("should_return_next_result_when_logger_is_null", async () => {
    const out = await createLoggingMiddleware({ logger: null })({ stepName: "silent" }, async () => "ok");
    expect(out).toBe("ok");
  });

  it("should_log_error_and_rethrow_when_next_throws", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const logger = createTestLogger();
    const middleware = createLoggingMiddleware({ logger, prefix: "[AgentLoop]" });

    let message;
    try {
      await middleware({ phase: "phase-fail" }, async () => {
        vi.advanceTimersByTime(5);
        throw new Error("fail");
      });
    } catch (err) {
      message = err?.message;
    }

    expect({ message, errorCalls: logger.error.mock.calls }).toEqual({
      message: "fail",
      errorCalls: [["[AgentLoop] phase-fail failed after 5ms: fail"]],
    });
  });
});

describe("createTelemetryMiddleware", () => {
  it("should_throw_TypeError_when_options_is_null", () => {
    expect(() => createTelemetryMiddleware(null)).toThrow(TypeError);
  });

  it("should_emit_started_and_completed_when_next_resolves", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const emit = vi.fn();
    const middleware = createTelemetryMiddleware({ emit, actor: "tester", stageName: "stage" });

    const out = await middleware({ stepName: "s1" }, async () => {
      vi.advanceTimersByTime(7);
      return "done";
    });

    expect({ out, calls: emit.mock.calls }).toEqual({
      out: "done",
      calls: [
        ["stage.middleware.s1.started", { actor: "tester", status: "progress", payload: { timestamp: 0 } }],
        ["stage.middleware.s1.completed", { actor: "tester", status: "success", payload: { duration: 7, timestamp: 7 } }],
      ],
    });
  });

  it("should_use_ctx_emit_over_options_emit_when_both_provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const emitFromOptions = vi.fn();
    const emitFromCtx = vi.fn();
    const middleware = createTelemetryMiddleware({ emit: emitFromOptions, stageName: "stage" });

    await middleware({ stepName: "s1", emit: emitFromCtx }, async () => {
      vi.advanceTimersByTime(1);
      return "ok";
    });

    expect({ optionsCalls: emitFromOptions.mock.calls.length, ctxCalls: emitFromCtx.mock.calls.length }).toEqual({
      optionsCalls: 0,
      ctxCalls: 2,
    });
  });

  it("should_emit_failed_event_and_rethrow_when_next_throws", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const emit = vi.fn();
    const middleware = createTelemetryMiddleware({ emit, stageName: "x" });

    let message;
    try {
      await middleware({ phase: "p1" }, async () => {
        vi.advanceTimersByTime(3);
        throw new Error("nope");
      });
    } catch (err) {
      message = err?.message;
    }

    expect({ message, calls: emit.mock.calls }).toEqual({
      message: "nope",
      calls: [
        ["x.middleware.p1.started", { actor: "agent", status: "progress", payload: { timestamp: 0 } }],
        ["x.middleware.p1.failed", { actor: "agent", status: "error", payload: { duration: 3, error: "nope", timestamp: 3 } }],
      ],
    });
  });

  it("should_return_next_result_when_emit_function_missing", async () => {
    const out = await createTelemetryMiddleware()({ stepName: "s1" }, async () => "ok");
    expect(out).toBe("ok");
  });
});

describe("createCancellationMiddleware", () => {
  it("should_throw_when_signal_aborted_with_string_reason", async () => {
    const controller = new AbortController();
    controller.abort("User cancelled");
    await expect(createCancellationMiddleware()({ signal: controller.signal }, async () => "ok")).rejects.toThrow(
      "User cancelled",
    );
  });

  it("should_throw_default_message_when_signal_aborted_with_non_string_reason", async () => {
    const controller = new AbortController();
    controller.abort({ code: "X" });
    await expect(createCancellationMiddleware()({ signal: controller.signal }, async () => "ok")).rejects.toThrow(
      "Run cancelled",
    );
  });

  it("should_return_next_result_when_signal_not_aborted", async () => {
    const controller = new AbortController();
    const out = await createCancellationMiddleware()({ signal: controller.signal }, async () => "ok");
    expect(out).toBe("ok");
  });

  it("should_return_next_result_when_signal_missing", async () => {
    const out = await createCancellationMiddleware()({}, async () => "ok");
    expect(out).toBe("ok");
  });
});

describe("createTimeoutMiddleware", () => {
  it("should_throw_TypeError_when_options_is_null", () => {
    expect(() => createTimeoutMiddleware(null)).toThrow(TypeError);
  });

  it("should_resolve_when_ctx_timeout_overrides_options_timeout", async () => {
    vi.useFakeTimers();

    const onTimeout = vi.fn();
    const middleware = createTimeoutMiddleware({ timeout: 50, onTimeout });
    const promise = middleware({ timeout: 1000 }, async () => new Promise((resolve) => setTimeout(() => resolve("ok"), 60)));

    await vi.advanceTimersByTimeAsync(60);
    const out = await promise;

    // Ensure the timer was cleared.
    await vi.advanceTimersByTimeAsync(2000);

    expect({ out, onTimeoutCalls: onTimeout.mock.calls.length }).toEqual({ out: "ok", onTimeoutCalls: 0 });
  });

  it("should_reject_with_TIMEOUT_code_when_next_exceeds_timeout", async () => {
    vi.useFakeTimers();

    const middleware = createTimeoutMiddleware({ timeout: 10 });

    const pending = middleware({}, async () => new Promise(() => {}));
    const outcome = pending.then(
      (value) => ({ status: "fulfilled", value }),
      (err) => ({ status: "rejected", err }),
    );
    await vi.advanceTimersByTimeAsync(10);
    const result = await outcome;
    const code = result.status === "rejected" ? result.err?.code : undefined;
    const message = result.status === "rejected" ? result.err?.message : undefined;

    expect({ code, message }).toEqual({ code: "TIMEOUT", message: "Step timeout after 10ms" });
  });

  it("should_call_onTimeout_when_timeout_occurs", async () => {
    vi.useFakeTimers();

    const onTimeout = vi.fn();
    const middleware = createTimeoutMiddleware({ timeout: 5, onTimeout });

    const pending = middleware({ id: "ctx" }, async () => new Promise(() => {}));
    const outcome = pending.then(
      (value) => ({ status: "fulfilled", value }),
      (err) => ({ status: "rejected", err }),
    );
    await vi.advanceTimersByTimeAsync(5);
    const result = await outcome;
    const code = result.status === "rejected" ? result.err?.code : undefined;

    expect({ code, onTimeoutCalls: onTimeout.mock.calls.length }).toEqual({ code: "TIMEOUT", onTimeoutCalls: 1 });
  });

  it("should_attach_cause_when_onTimeout_throws", async () => {
    vi.useFakeTimers();

    const onTimeout = () => {
      throw new Error("callback failed");
    };
    const middleware = createTimeoutMiddleware({ timeout: 5, onTimeout });

    const pending = middleware({}, async () => new Promise(() => {}));
    const outcome = pending.then(
      (value) => ({ status: "fulfilled", value }),
      (err) => ({ status: "rejected", err }),
    );
    await vi.advanceTimersByTimeAsync(5);
    const result = await outcome;
    const causeMessage = result.status === "rejected" ? result.err?.cause?.message : undefined;

    expect(causeMessage).toBe("callback failed");
  });

  it("should_not_call_onTimeout_when_next_rejects_before_timeout", async () => {
    vi.useFakeTimers();

    const onTimeout = vi.fn();
    const middleware = createTimeoutMiddleware({ timeout: 10, onTimeout });

    const pending = middleware({}, async () => new Promise((_, reject) => setTimeout(() => reject(new Error("downstream")), 1)));
    const outcome = pending.then(
      (value) => ({ status: "fulfilled", value }),
      (err) => ({ status: "rejected", err }),
    );
    await vi.advanceTimersByTimeAsync(1);
    const result = await outcome;
    const message = result.status === "rejected" ? result.err?.message : undefined;

    await vi.advanceTimersByTimeAsync(20);

    expect({ message, onTimeoutCalls: onTimeout.mock.calls.length }).toEqual({ message: "downstream", onTimeoutCalls: 0 });
  });

  it("should_clamp_step_timeout_to_minimum_1ms_when_timeout_is_fractional", async () => {
    vi.useFakeTimers();

    const middleware = createTimeoutMiddleware({ timeout: 0.5 });

    const pending = middleware({}, async () => new Promise(() => {}));
    const outcome = pending.then(
      (value) => ({ status: "fulfilled", value }),
      (err) => ({ status: "rejected", err }),
    );
    await vi.advanceTimersByTimeAsync(1);
    const result = await outcome;
    const message = result.status === "rejected" ? result.err?.message : undefined;

    expect(message).toBe("Step timeout after 1ms");
  });

  it("should_clamp_step_timeout_to_maximum_5min_when_timeout_is_huge", async () => {
    vi.useFakeTimers();

    const middleware = createTimeoutMiddleware({ timeout: Number.MAX_SAFE_INTEGER });

    const pending = middleware({}, async () => new Promise(() => {}));
    const outcome = pending.then(
      (value) => ({ status: "fulfilled", value }),
      (err) => ({ status: "rejected", err }),
    );
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const result = await outcome;
    const message = result.status === "rejected" ? result.err?.message : undefined;

    expect(message).toBe("Step timeout after 300000ms");
  });
});

describe("createRetryMiddleware", () => {
  it("should_throw_TypeError_when_options_is_null", () => {
    expect(() => createRetryMiddleware(null)).toThrow(TypeError);
  });

  it("should_set_retryAttempt_zero_when_next_succeeds_on_first_try", async () => {
    const ctx = {};
    const next = vi.fn(() => "ok");
    const out = await createRetryMiddleware({ maxRetries: 2, retryDelay: 10 })(ctx, next);
    expect({ out, attempt: ctx._retryAttempt, calls: next.mock.calls.length }).toEqual({ out: "ok", attempt: 0, calls: 1 });
  });

  it("should_retry_with_linear_backoff_until_next_succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const ctx = {};
    const attemptTimes = [];
    let calls = 0;
    const next = () => {
      attemptTimes.push(Date.now());
      calls += 1;
      if (calls < 3) throw new Error(`fail-${calls}`);
      return "ok";
    };

    const middleware = createRetryMiddleware({ maxRetries: 2, retryDelay: 10 });
    const promise = middleware(ctx, next);
    await vi.runAllTimersAsync();
    const out = await promise;

    expect({ out, attemptTimes, attempt: ctx._retryAttempt }).toEqual({
      out: "ok",
      attemptTimes: [0, 10, 30],
      attempt: 2,
    });
  });

  it("should_throw_after_maxRetries_exceeded", async () => {
    vi.useFakeTimers();

    const ctx = {};
    const next = vi.fn(() => {
      throw new Error("always");
    });

    const middleware = createRetryMiddleware({ maxRetries: 1, retryDelay: 10 });

    const pending = middleware(ctx, next);
    const outcome = pending.then(
      (value) => ({ status: "fulfilled", value }),
      (err) => ({ status: "rejected", err }),
    );
    await vi.runAllTimersAsync();
    const result = await outcome;
    const message = result.status === "rejected" ? result.err?.message : undefined;

    expect({ message, attempt: ctx._retryAttempt, calls: next.mock.calls.length }).toEqual({
      message: "always",
      attempt: 1,
      calls: 2,
    });
  });

  it("should_stop_retrying_when_shouldRetry_returns_false", async () => {
    const ctx = {};
    const shouldRetry = vi.fn(() => false);
    const next = vi.fn(() => {
      throw new Error("permanent");
    });

    let message;
    try {
      await createRetryMiddleware({ maxRetries: 5, retryDelay: 10, shouldRetry })(ctx, next);
    } catch (err) {
      message = err?.message;
    }

    expect({
      message,
      attempt: ctx._retryAttempt,
      shouldRetryCalls: shouldRetry.mock.calls.length,
      nextCalls: next.mock.calls.length,
    }).toEqual({
      message: "permanent",
      attempt: 0,
      shouldRetryCalls: 1,
      nextCalls: 1,
    });
  });

  it("should_not_retry_when_maxRetries_is_zero_and_next_fails", async () => {
    const ctx = {};
    const next = vi.fn(() => {
      throw new Error("fail");
    });

    let message;
    try {
      await createRetryMiddleware({ maxRetries: 0, retryDelay: 10 })(ctx, next);
    } catch (err) {
      message = err?.message;
    }

    expect({ message, attempt: ctx._retryAttempt, calls: next.mock.calls.length }).toEqual({ message: "fail", attempt: 0, calls: 1 });
  });
});

describe("createSnapshotMiddleware", () => {
  it("should_throw_TypeError_when_options_is_null", () => {
    expect(() => createSnapshotMiddleware(null)).toThrow(TypeError);
  });

  it("should_store_before_and_after_snapshots_when_hooks_succeed", async () => {
    const onBeforeSnapshot = vi.fn(async () => "before");
    const onAfterSnapshot = vi.fn(async () => "after");

    const middleware = createSnapshotMiddleware({ onBeforeSnapshot, onAfterSnapshot });
    const ctx = {};
    const out = await middleware(ctx, async () => "result");

    expect({ out, before: ctx._beforeSnapshot, after: ctx._afterSnapshot }).toEqual({
      out: "result",
      before: "before",
      after: "after",
    });
  });

  it("should_continue_and_record_error_when_onBeforeSnapshot_throws", async () => {
    const logger = createTestLogger();
    const onBeforeSnapshot = vi.fn(async () => {
      throw new Error("before failed");
    });
    const middleware = createSnapshotMiddleware({ onBeforeSnapshot });

    const ctx = { logger };
    const out = await middleware(ctx, async () => "ok");

    expect({
      out,
      errorMessage: ctx._beforeSnapshotError?.message,
      loggerErrorCalls: logger.error.mock.calls.length,
    }).toEqual({
      out: "ok",
      errorMessage: "before failed",
      loggerErrorCalls: 1,
    });
  });

  it("should_continue_and_record_error_when_onAfterSnapshot_throws", async () => {
    const logger = createTestLogger();
    const onAfterSnapshot = vi.fn(async () => {
      throw new Error("after failed");
    });
    const middleware = createSnapshotMiddleware({ onAfterSnapshot });

    const ctx = { logger };
    const out = await middleware(ctx, async () => "ok");

    expect({
      out,
      errorMessage: ctx._afterSnapshotError?.message,
      loggerErrorCalls: logger.error.mock.calls.length,
    }).toEqual({
      out: "ok",
      errorMessage: "after failed",
      loggerErrorCalls: 1,
    });
  });

  it("should_ignore_non_function_hooks", async () => {
    const middleware = createSnapshotMiddleware({ onBeforeSnapshot: null, onAfterSnapshot: 123 });
    const ctx = {};
    const out = await middleware(ctx, async () => "ok");

    expect({ out, before: ctx._beforeSnapshot, after: ctx._afterSnapshot }).toEqual({
      out: "ok",
      before: undefined,
      after: undefined,
    });
  });
});

describe("createShadowSystemMiddleware", () => {
  it("should_throw_TypeError_when_options_is_null", () => {
    expect(() => createShadowSystemMiddleware(null)).toThrow(TypeError);
  });

  it("should_inject_shadow_system_before_last_user_or_tool_message", async () => {
    const getShadowHints = vi.fn(async () => ({ system: "secret" }));
    const middleware = createShadowSystemMiddleware({ getShadowHints });

    const originalMessages = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u1" },
    ];
    const ctx = { messages: originalMessages };

    const out = await middleware(ctx, async () => "ok");

    expect({ out, originalLength: originalMessages.length, newMessages: ctx.messages, shadowHints: ctx.shadowHints }).toEqual({
      out: "ok",
      originalLength: 3,
      shadowHints: { system: "secret" },
      newMessages: [
        { role: "system", content: "sys" },
        { role: "assistant", content: "a1" },
        { role: "system", content: "[Shadow System]\nsecret" },
        { role: "user", content: "u1" },
      ],
    });
  });

  it("should_not_inject_duplicate_shadow_system_blocks", async () => {
    const getShadowHints = vi.fn(async () => ({ system: "secret" }));
    const middleware = createShadowSystemMiddleware({ getShadowHints });

    const block = "[Shadow System]\nsecret";
    const originalMessages = [
      { role: "system", content: `sys\n${block}` },
      { role: "assistant", content: "a1" },
    ];
    const ctx = { messages: originalMessages };

    await middleware(ctx, async () => "ok");

    expect({ originalLength: originalMessages.length, newLength: ctx.messages.length, systemBlocks: ctx.messages.map((m) => m?.content) }).toEqual({
      originalLength: 2,
      newLength: 2,
      systemBlocks: [`sys\n${block}`, "a1"],
    });
  });

  it("should_skip_injection_when_shadow_system_is_blank", async () => {
    const getShadowHints = vi.fn(async () => ({ system: "   " }));
    const middleware = createShadowSystemMiddleware({ getShadowHints });

    const messages = [{ role: "system", content: "sys" }];
    const ctx = { messages };
    await middleware(ctx, async () => "ok");

    expect({ messagesRefSame: ctx.messages === messages, length: ctx.messages.length, shadowHints: ctx.shadowHints }).toEqual({
      messagesRefSame: true,
      length: 1,
      shadowHints: { system: "   " },
    });
  });

  it("should_set_shadowHints_without_injection_when_hints_missing_system", async () => {
    const getShadowHints = vi.fn(async () => ({ foo: 1 }));
    const middleware = createShadowSystemMiddleware({ getShadowHints });

    const messages = [{ role: "system", content: "sys" }];
    const ctx = { messages };
    await middleware(ctx, async () => "ok");

    expect({ shadowHints: ctx.shadowHints, messagesRefSame: ctx.messages === messages, length: ctx.messages.length }).toEqual({
      shadowHints: { foo: 1 },
      messagesRefSame: true,
      length: 1,
    });
  });

  it("should_capture_error_and_continue_when_getShadowHints_throws", async () => {
    const logger = createTestLogger();
    const middleware = createShadowSystemMiddleware({
      getShadowHints: async () => {
        throw new Error("hints failed");
      },
    });

    const ctx = { logger, messages: [{ role: "system", content: "sys" }] };
    const out = await middleware(ctx, async () => "ok");

    expect({ out, errorMessage: ctx._shadowHintsError?.message, loggerErrorCalls: logger.error.mock.calls.length }).toEqual({
      out: "ok",
      errorMessage: "hints failed",
      loggerErrorCalls: 1,
    });
  });
});

describe("createBlackboardMiddleware", () => {
  it("should_throw_TypeError_when_options_is_null", () => {
    expect(() => createBlackboardMiddleware(null)).toThrow(TypeError);
  });

  it("should_sync_selected_keys_and_lastResult_to_blackboard", async () => {
    const blackboard = { set: vi.fn() };
    const middleware = createBlackboardMiddleware({ blackboard, syncKeys: ["a", "b", "missing"] });

    const ctx = { a: 1, b: undefined };
    const out = await middleware(ctx, async () => ({ ok: true }));

    expect({ out, calls: blackboard.set.mock.calls }).toEqual({
      out: { ok: true },
      calls: [
        ["a", 1],
        ["lastResult", { ok: true }],
      ],
    });
  });

  it("should_not_write_lastResult_when_result_is_undefined", async () => {
    const blackboard = { set: vi.fn() };
    const middleware = createBlackboardMiddleware({ blackboard, syncKeys: [] });

    const out = await middleware({}, async () => undefined);

    expect({ out, calls: blackboard.set.mock.calls.length }).toEqual({ out: undefined, calls: 0 });
  });

  it("should_return_result_when_blackboard_set_is_not_function", async () => {
    const middleware = createBlackboardMiddleware({ blackboard: { set: "nope" }, syncKeys: ["a"] });
    const out = await middleware({ a: 1 }, async () => "ok");
    expect(out).toBe("ok");
  });
});

describe("createDefaultMiddlewareChain", () => {
  it("should_throw_TypeError_when_options_is_null", () => {
    expect(() => createDefaultMiddlewareChain(null)).toThrow(TypeError);
  });

  it("should_return_MiddlewareChain_instance", () => {
    expect(createDefaultMiddlewareChain()).toBeInstanceOf(MiddlewareChain);
  });

  it("should_short_circuit_when_cancelled_before_other_middlewares", async () => {
    const logger = createTestLogger();
    const emit = vi.fn();
    const chain = createDefaultMiddlewareChain({ logger, emit, timeout: 10, maxRetries: 2, retryDelay: 1 });

    const controller = new AbortController();
    controller.abort("stop");

    let message;
    try {
      await chain.execute({ signal: controller.signal, stepName: "s" });
    } catch (err) {
      message = err?.message;
    }

    expect({ message, debugCalls: logger.debug.mock.calls.length, emitCalls: emit.mock.calls.length }).toEqual({
      message: "stop",
      debugCalls: 0,
      emitCalls: 0,
    });
  });

  it("should_execute_logging_and_telemetry_when_configured", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const logger = createTestLogger();
    const emit = vi.fn();
    const chain = createDefaultMiddlewareChain({ logger, emit, actor: "tester", stageName: "stage" });

    const out = await chain.execute({ stepName: "s1" }, async () => {
      vi.advanceTimersByTime(5);
      return "ok";
    });

    expect({
      out,
      debugCalls: logger.debug.mock.calls.map((c) => c[0]),
      emitEvents: emit.mock.calls.map((c) => c[0]),
    }).toEqual({
      out: "ok",
      debugCalls: ["[AgentLoop] s1 started", "[AgentLoop] s1 completed in 5ms"],
      emitEvents: ["stage.middleware.s1.started", "stage.middleware.s1.completed"],
    });
  });

  it("should_retry_finalHandler_when_maxRetries_configured", async () => {
    vi.useFakeTimers();

    const chain = createDefaultMiddlewareChain({ maxRetries: 1, retryDelay: 10 });

    let calls = 0;
    const finalHandler = () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return "ok";
    };

    const promise = chain.execute({}, finalHandler);
    await vi.runAllTimersAsync();
    const out = await promise;

    expect({ out, calls }).toEqual({ out: "ok", calls: 2 });
  });

  it("should_timeout_when_timeout_configured", async () => {
    vi.useFakeTimers();

    const chain = createDefaultMiddlewareChain({ timeout: 5 });
    const pending = chain.execute({}, async () => new Promise(() => {}));
    const outcome = pending.then(
      (value) => ({ status: "fulfilled", value }),
      (err) => ({ status: "rejected", err }),
    );

    await vi.advanceTimersByTimeAsync(5);

    const result = await outcome;
    const code = result.status === "rejected" ? result.err?.code : undefined;
    expect(code).toBe("TIMEOUT");
  });
});