/**
 * Middleware Chain 单元测试
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
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
} from "../../../js/agents/runtime/middleware/middleware-chain.js";

describe("middleware-chain", () => {
  // ===== Stage 常量 =====
  describe("Stage constants", () => {
    it("should export frozen Stage object with lifecycle phases", () => {
      assert.ok(Object.isFrozen(Stage));
      assert.strictEqual(Stage.BEFORE_AGENT, "beforeAgent");
      assert.strictEqual(Stage.BEFORE_MODEL, "beforeModel");
      assert.strictEqual(Stage.AFTER_MODEL, "afterModel");
      assert.strictEqual(Stage.BEFORE_TOOL, "beforeTool");
      assert.strictEqual(Stage.AFTER_TOOL, "afterTool");
      assert.strictEqual(Stage.AFTER_AGENT, "afterAgent");
    });
  });

  describe("default export", () => {
    it("should include all middleware factories and helpers", async () => {
      const module = await import("../../../js/agents/runtime/middleware/middleware-chain.js");
      const defaults = module.default;

      assert.ok(defaults);
      assert.strictEqual(defaults.Stage, Stage);
      assert.strictEqual(defaults.MiddlewareChain, MiddlewareChain);
      assert.strictEqual(defaults.createLoggingMiddleware, createLoggingMiddleware);
      assert.strictEqual(defaults.createTelemetryMiddleware, createTelemetryMiddleware);
      assert.strictEqual(defaults.createCancellationMiddleware, createCancellationMiddleware);
      assert.strictEqual(defaults.createTimeoutMiddleware, createTimeoutMiddleware);
      assert.strictEqual(defaults.createRetryMiddleware, createRetryMiddleware);
      assert.strictEqual(defaults.createSnapshotMiddleware, createSnapshotMiddleware);
      assert.strictEqual(defaults.createShadowSystemMiddleware, createShadowSystemMiddleware);
      assert.strictEqual(defaults.createBlackboardMiddleware, createBlackboardMiddleware);
      assert.strictEqual(defaults.createDefaultMiddlewareChain, createDefaultMiddlewareChain);
    });
  });

  // ===== MiddlewareChain =====
  describe("MiddlewareChain", () => {
    describe("use()", () => {
      it("should execute middlewares in order (onion model)", async () => {
        const chain = new MiddlewareChain();
        const order = [];

        chain.use(async (ctx, next) => {
          order.push("A-before");
          await next();
          order.push("A-after");
        });

        chain.use(async (ctx, next) => {
          order.push("B-before");
          await next();
          order.push("B-after");
        });

        await chain.execute({});

        assert.deepStrictEqual(order, ["A-before", "B-before", "B-after", "A-after"]);
      });

      it("should throw TypeError when middleware is not a function", () => {
        const chain = new MiddlewareChain();
        assert.throws(() => chain.use("not a function"), TypeError);
        assert.throws(() => chain.use(null), TypeError);
        assert.throws(() => chain.use(123), TypeError);
        assert.throws(() => chain.use({}), TypeError);
      });

      it("should return chain for fluent chaining", () => {
        const chain = new MiddlewareChain();
        const result = chain.use(async (ctx, next) => next());
        assert.strictEqual(result, chain);
      });

      it("should pass context through chain", async () => {
        const chain = new MiddlewareChain();

        chain.use(async (ctx, next) => {
          ctx.value = 1;
          await next();
        });

        chain.use(async (ctx, next) => {
          ctx.value += 10;
          await next();
        });

        const ctx = {};
        await chain.execute(ctx);

        assert.strictEqual(ctx.value, 11);
      });
    });

    describe("useAll()", () => {
      it("should add multiple middlewares in order", async () => {
        const chain = new MiddlewareChain();
        const order = [];

        chain.useAll([
          async (ctx, next) => { order.push(1); return next(); },
          async (ctx, next) => { order.push(2); return next(); },
          async (ctx, next) => { order.push(3); return next(); },
        ]);

        await chain.execute({});
        assert.deepStrictEqual(order, [1, 2, 3]);
      });

      it("should return chain for fluent chaining", () => {
        const chain = new MiddlewareChain();
        const result = chain.useAll([async (ctx, next) => next()]);
        assert.strictEqual(result, chain);
      });

      it("should throw TypeError for invalid middleware in array", () => {
        const chain = new MiddlewareChain();
        assert.throws(
          () => chain.useAll([async (ctx, next) => next(), "invalid"]),
          TypeError
        );
      });
    });

    describe("insertAt()", () => {
      it("should insert middleware at specified index", async () => {
        const chain = new MiddlewareChain();
        const order = [];

        chain.use(async (ctx, next) => { order.push(1); return next(); });
        chain.use(async (ctx, next) => { order.push(3); return next(); });
        chain.insertAt(1, async (ctx, next) => { order.push(2); return next(); });

        await chain.execute({});
        assert.deepStrictEqual(order, [1, 2, 3]);
      });

      it("should insert at beginning when index is 0", async () => {
        const chain = new MiddlewareChain();
        const order = [];

        chain.use(async (ctx, next) => { order.push(2); return next(); });
        chain.insertAt(0, async (ctx, next) => { order.push(1); return next(); });

        await chain.execute({});
        assert.deepStrictEqual(order, [1, 2]);
      });

      it("should throw TypeError when middleware is not a function", () => {
        const chain = new MiddlewareChain();
        assert.throws(() => chain.insertAt(0, "not a function"), TypeError);
        assert.throws(() => chain.insertAt(0, null), TypeError);
      });

      it("should return chain for fluent chaining", () => {
        const chain = new MiddlewareChain();
        const result = chain.insertAt(0, async (ctx, next) => next());
        assert.strictEqual(result, chain);
      });
    });

    describe("remove()", () => {
      it("should remove existing middleware and return true", async () => {
        const chain = new MiddlewareChain();
        const order = [];

        const mw2 = async (ctx, next) => { order.push(2); return next(); };

        chain.use(async (ctx, next) => { order.push(1); return next(); });
        chain.use(mw2);
        chain.use(async (ctx, next) => { order.push(3); return next(); });

        const removed = chain.remove(mw2);
        assert.strictEqual(removed, true);

        await chain.execute({});
        assert.deepStrictEqual(order, [1, 3]);
      });

      it("should return false when middleware not found", () => {
        const chain = new MiddlewareChain();
        chain.use(async (ctx, next) => next());

        const notAdded = async (ctx, next) => next();
        const removed = chain.remove(notAdded);
        assert.strictEqual(removed, false);
      });

      it("should return false when chain is empty", () => {
        const chain = new MiddlewareChain();
        const removed = chain.remove(async (ctx, next) => next());
        assert.strictEqual(removed, false);
      });
    });

    describe("execute()", () => {
      it("should call final handler when chain completes", async () => {
        const chain = new MiddlewareChain();
        let finalCalled = false;

        chain.use(async (ctx, next) => {
          ctx.step1 = true;
          return next();
        });

        const result = await chain.execute({}, (ctx) => {
          finalCalled = true;
          return "final-result";
        });

        assert.strictEqual(finalCalled, true);
        assert.strictEqual(result, "final-result");
      });

      it("should return ctx when no final handler", async () => {
        const chain = new MiddlewareChain();
        chain.use(async (ctx, next) => {
          ctx.modified = true;
          return next();
        });

        const ctx = { original: true };
        const result = await chain.execute(ctx);

        assert.strictEqual(result, ctx);
        assert.strictEqual(result.modified, true);
      });

      it("should execute empty chain and return ctx", async () => {
        const chain = new MiddlewareChain();
        const ctx = { test: "value" };
        const result = await chain.execute(ctx);
        assert.strictEqual(result, ctx);
      });

      it("should execute empty chain with final handler", async () => {
        const chain = new MiddlewareChain();
        const result = await chain.execute({}, () => "handler-result");
        assert.strictEqual(result, "handler-result");
      });

      it("should propagate errors from middleware", async () => {
        const chain = new MiddlewareChain();

        chain.use(async () => {
          throw new Error("Test error");
        });

        await assert.rejects(
          () => chain.execute({}),
          { message: "Test error" }
        );
      });

      it("should propagate errors from final handler", async () => {
        const chain = new MiddlewareChain();
        chain.use(async (ctx, next) => next());

        await assert.rejects(
          () => chain.execute({}, () => { throw new Error("Handler error"); }),
          { message: "Handler error" }
        );
      });

      it("should short-circuit when next is not called", async () => {
        const chain = new MiddlewareChain();
        const order = [];

        chain.use(async (ctx, next) => {
          order.push("first");
          return "short-circuited";
        });

        chain.use(async (ctx, next) => {
          order.push("second");
          return next();
        });

        const result = await chain.execute({});
        assert.deepStrictEqual(order, ["first"]);
        assert.strictEqual(result, "short-circuited");
      });

      it("should allow middleware to modify result", async () => {
        const chain = new MiddlewareChain();

        chain.use(async (ctx, next) => {
          const result = await next();
          return result + "-modified";
        });

        const result = await chain.execute({}, () => "original");
        assert.strictEqual(result, "original-modified");
      });
    });

    describe("length", () => {
      it("should report correct middleware count", () => {
        const chain = new MiddlewareChain();
        assert.strictEqual(chain.length, 0);

        chain.use(async (ctx, next) => next());
        chain.use(async (ctx, next) => next());
        assert.strictEqual(chain.length, 2);
      });
    });

    describe("clear()", () => {
      it("should remove all middlewares", () => {
        const chain = new MiddlewareChain();
        chain.use(async (ctx, next) => next());
        chain.use(async (ctx, next) => next());
        assert.strictEqual(chain.length, 2);

        chain.clear();
        assert.strictEqual(chain.length, 0);
      });

      it("should work on empty chain", () => {
        const chain = new MiddlewareChain();
        chain.clear();
        assert.strictEqual(chain.length, 0);
      });
    });
  });

  // ===== createLoggingMiddleware =====
  describe("createLoggingMiddleware", () => {
    it("should log start and completion with duration", async () => {
      const logs = [];
      const logger = {
        debug: (msg) => logs.push({ level: "debug", msg }),
        error: (msg) => logs.push({ level: "error", msg }),
      };

      const chain = new MiddlewareChain();
      chain.use(createLoggingMiddleware({ logger }));

      await chain.execute({ stepName: "test-step" });

      assert.ok(logs.some(l => l.level === "debug" && l.msg.includes("test-step started")));
      assert.ok(logs.some(l => l.level === "debug" && l.msg.includes("test-step completed")));
      assert.ok(logs.some(l => l.msg.includes("ms")));
    });

    it("should use custom prefix", async () => {
      const logs = [];
      const logger = { debug: (msg) => logs.push(msg), error: () => {} };

      const chain = new MiddlewareChain();
      chain.use(createLoggingMiddleware({ logger, prefix: "[Custom]" }));

      await chain.execute({ stepName: "step" });

      assert.ok(logs.some(l => l.includes("[Custom]")));
    });

    it("should use phase as fallback for stepName", async () => {
      const logs = [];
      const logger = { debug: (msg) => logs.push(msg), error: () => {} };

      const chain = new MiddlewareChain();
      chain.use(createLoggingMiddleware({ logger }));

      await chain.execute({ phase: "model-call" });

      assert.ok(logs.some(l => l.includes("model-call")));
    });

    it("should default to 'step' when no stepName or phase", async () => {
      const logs = [];
      const logger = { debug: (msg) => logs.push(msg), error: () => {} };

      const chain = new MiddlewareChain();
      chain.use(createLoggingMiddleware({ logger }));

      await chain.execute({});

      assert.ok(logs.some(l => l.includes("step started")));
    });

    it("should log errors with duration", async () => {
      const logs = [];
      const logger = {
        debug: (msg) => logs.push({ level: "debug", msg }),
        error: (msg) => logs.push({ level: "error", msg }),
      };

      const chain = new MiddlewareChain();
      chain.use(createLoggingMiddleware({ logger }));
      chain.use(async () => { throw new Error("Test failure"); });

      await assert.rejects(() => chain.execute({ stepName: "failing-step" }));

      assert.ok(logs.some(l => l.level === "error" && l.msg.includes("failing-step failed")));
      assert.ok(logs.some(l => l.msg.includes("Test failure")));
    });

    it("should work without logger", async () => {
      const chain = new MiddlewareChain();
      chain.use(createLoggingMiddleware({}));
      await chain.execute({});
    });
  });

  // ===== createTelemetryMiddleware =====
  describe("createTelemetryMiddleware", () => {
    it("should emit start and completion events", async () => {
      const events = [];
      const emit = (name, payload) => events.push({ name, payload });

      const chain = new MiddlewareChain();
      chain.use(createTelemetryMiddleware({ emit, stageName: "test" }));

      await chain.execute({ stepName: "my-step" });

      assert.ok(events.some(e => e.name === "test.middleware.my-step.started"));
      assert.ok(events.some(e => e.name === "test.middleware.my-step.completed"));
      assert.ok(events.some(e => e.payload.status === "success"));
    });

    it("should use ctx.emit if provided", async () => {
      const events = [];
      const ctxEmit = (name, payload) => events.push({ name, payload });

      const chain = new MiddlewareChain();
      chain.use(createTelemetryMiddleware({ stageName: "agent" }));

      await chain.execute({ stepName: "step", emit: ctxEmit });

      assert.ok(events.some(e => e.name === "agent.middleware.step.started"));
    });

    it("should emit failed event on error", async () => {
      const events = [];
      const emit = (name, payload) => events.push({ name, payload });

      const chain = new MiddlewareChain();
      chain.use(createTelemetryMiddleware({ emit, stageName: "test", actor: "agent" }));
      chain.use(async () => { throw new Error("Telemetry test error"); });

      await assert.rejects(() => chain.execute({ stepName: "failing" }));

      const failedEvent = events.find(e => e.name === "test.middleware.failing.failed");
      assert.ok(failedEvent);
      assert.strictEqual(failedEvent.payload.status, "error");
      assert.ok(failedEvent.payload.payload.error.includes("Telemetry test error"));
      assert.ok(failedEvent.payload.payload.duration >= 0);
    });

    it("should include duration in events", async () => {
      const events = [];
      const emit = (name, payload) => events.push({ name, payload });

      const chain = new MiddlewareChain();
      chain.use(createTelemetryMiddleware({ emit, stageName: "test" }));

      await chain.execute({ stepName: "step" });

      const completedEvent = events.find(e => e.name.includes("completed"));
      assert.ok(typeof completedEvent.payload.payload.duration === "number");
    });
  });

  // ===== createCancellationMiddleware =====
  describe("createCancellationMiddleware", () => {
    it("should pass when signal not aborted", async () => {
      const chain = new MiddlewareChain();
      chain.use(createCancellationMiddleware());

      const controller = new AbortController();
      await chain.execute({ signal: controller.signal });
    });

    it("should pass when no signal provided", async () => {
      const chain = new MiddlewareChain();
      chain.use(createCancellationMiddleware());
      await chain.execute({});
    });

    it("should throw when signal aborted with string reason", async () => {
      const chain = new MiddlewareChain();
      chain.use(createCancellationMiddleware());

      const controller = new AbortController();
      controller.abort("User cancelled");

      await assert.rejects(
        () => chain.execute({ signal: controller.signal }),
        { message: "User cancelled" }
      );
    });

    it("should throw default message when aborted without reason", async () => {
      const chain = new MiddlewareChain();
      chain.use(createCancellationMiddleware());

      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        () => chain.execute({ signal: controller.signal }),
        { message: "Run cancelled" }
      );
    });

    it("should throw default message when aborted with non-string reason", async () => {
      const chain = new MiddlewareChain();
      chain.use(createCancellationMiddleware());

      const controller = new AbortController();
      controller.abort({ code: "TIMEOUT" });

      await assert.rejects(
        () => chain.execute({ signal: controller.signal }),
        { message: "Run cancelled" }
      );
    });
  });

  // ===== createTimeoutMiddleware =====
  describe("createTimeoutMiddleware", () => {
    it("should pass when within timeout", async () => {
      const chain = new MiddlewareChain();
      chain.use(createTimeoutMiddleware({ timeout: 1000 }));
      chain.use(async (ctx, next) => {
        await new Promise(r => setImmediate(r));
        return next();
      });

      await chain.execute({});
    });

    it("should use ctx.timeout when provided", async () => {
      const chain = new MiddlewareChain();
      chain.use(createTimeoutMiddleware({ timeout: 1 }));
      chain.use(async (ctx, next) => {
        await new Promise(r => setImmediate(r));
        return next();
      });

      // ctx.timeout overrides default
      await chain.execute({ timeout: 1000 });
    });

    it("should throw on timeout with TIMEOUT code", async () => {
      const chain = new MiddlewareChain();
      chain.use(createTimeoutMiddleware({ timeout: 1 }));
      chain.use(async () => {
        await new Promise(() => {});
      });

      await assert.rejects(
        () => chain.execute({}),
        (err) => err.code === "TIMEOUT" && err.message.includes("timeout")
      );
    });

    it("should call onTimeout callback", async () => {
      let callbackCalled = false;
      let callbackCtx = null;
      let callbackErr = null;

      const chain = new MiddlewareChain();
      chain.use(createTimeoutMiddleware({
        timeout: 1,
        onTimeout: (ctx, err) => {
          callbackCalled = true;
          callbackCtx = ctx;
          callbackErr = err;
        },
      }));
      chain.use(async () => {
        await new Promise(() => {});
      });

      await assert.rejects(() => chain.execute({ testValue: 123 }));

      assert.strictEqual(callbackCalled, true);
      assert.strictEqual(callbackCtx.testValue, 123);
      assert.strictEqual(callbackErr.code, "TIMEOUT");
    });

    it("should clear timeout when next completes before timeout", async () => {
      const chain = new MiddlewareChain();
      chain.use(createTimeoutMiddleware({ timeout: 100 }));

      const result = await chain.execute({}, () => "completed");
      assert.strictEqual(result, "completed");
    });

    it("should clear timeout when next throws", async () => {
      const chain = new MiddlewareChain();
      chain.use(createTimeoutMiddleware({ timeout: 100 }));
      chain.use(async () => { throw new Error("Inner error"); });

      await assert.rejects(
        () => chain.execute({}),
        { message: "Inner error" }
      );
    });
  });

  // ===== createRetryMiddleware =====
  describe("createRetryMiddleware", () => {
    it("should retry on failure and track attempts", async () => {
      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({ maxRetries: 2, retryDelay: 1 }));
      chain.use(async (ctx, next) => {
        if (ctx._retryAttempt < 2) throw new Error("Temporary failure");
        ctx.result = "success";
        return next();
      });

      const ctx = {};
      await chain.execute(ctx);
      assert.strictEqual(ctx.result, "success");
      assert.strictEqual(ctx._retryAttempt, 2);
    });

    it("should throw after max retries exhausted", async () => {
      let attempts = 0;
      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({ maxRetries: 2, retryDelay: 1 }));
      chain.use(async () => {
        attempts++;
        throw new Error("Always fails");
      });

      await assert.rejects(
        () => chain.execute({}),
        { message: "Always fails" }
      );
      assert.strictEqual(attempts, 3); // 1 initial + 2 retries
    });

    it("should respect shouldRetry returning false", async () => {
      let attempts = 0;

      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({
        maxRetries: 5,
        retryDelay: 1,
        shouldRetry: (err) => !err.message.includes("permanent"),
      }));
      chain.use(async () => {
        attempts++;
        throw new Error("permanent failure");
      });

      await assert.rejects(() => chain.execute({}));
      assert.strictEqual(attempts, 1);
    });

    it("should retry when shouldRetry is undefined", async () => {
      let attempts = 0;

      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({ maxRetries: 1, retryDelay: 1 }));
      chain.use(async (ctx) => {
        attempts++;
        if (attempts === 1) {
          throw new Error("temporary");
        }
        ctx.result = "ok";
        return "ok";
      });

      const ctx = {};
      const result = await chain.execute(ctx);

      assert.strictEqual(result, "ok");
      assert.strictEqual(ctx.result, "ok");
      assert.strictEqual(attempts, 2);
      assert.strictEqual(ctx._retryAttempt, 1);
    });

    it("should pass attempt number to shouldRetry", async () => {
      const attemptsSeen = [];

      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({
        maxRetries: 3,
        retryDelay: 1,
        shouldRetry: (err, attempt) => {
          attemptsSeen.push(attempt);
          return attempt < 2;
        },
      }));
      chain.use(async () => {
        throw new Error("failure");
      });

      await assert.rejects(() => chain.execute({}));
      assert.deepStrictEqual(attemptsSeen, [0, 1, 2]);
    });

    it("should increase delay with each retry", async () => {
      const startTime = Date.now();
      let attempts = 0;

      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({ maxRetries: 2, retryDelay: 10 }));
      chain.use(async () => {
        attempts++;
        if (attempts < 3) throw new Error("retry");
        return "done";
      });

      await chain.execute({});
      const elapsed = Date.now() - startTime;
      // Should have delays: 10ms (attempt 1) + 20ms (attempt 2) = 30ms minimum
      assert.ok(elapsed >= 25, `Expected >=25ms, got ${elapsed}ms`);
    });

    it("should not retry when maxRetries is 0", async () => {
      let attempts = 0;

      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({ maxRetries: 0, retryDelay: 1 }));
      chain.use(async () => {
        attempts++;
        throw new Error("failure");
      });

      await assert.rejects(() => chain.execute({}));
      assert.strictEqual(attempts, 1);
    });

    it("should succeed on first attempt without retry", async () => {
      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({ maxRetries: 3, retryDelay: 1 }));
      chain.use(async (ctx, next) => {
        ctx.value = "immediate";
        return next();
      });

      const ctx = {};
      await chain.execute(ctx);
      assert.strictEqual(ctx.value, "immediate");
      assert.strictEqual(ctx._retryAttempt, 0);
    });
  });

  // ===== createSnapshotMiddleware =====
  describe("createSnapshotMiddleware", () => {
    it("should capture before and after snapshots", async () => {
      const chain = new MiddlewareChain();
      chain.use(createSnapshotMiddleware({
        onBeforeSnapshot: (ctx) => ({ value: ctx.value }),
        onAfterSnapshot: (ctx, result) => ({ value: ctx.value, result }),
      }));
      chain.use(async (ctx, next) => {
        ctx.value = 42;
        return next();
      });

      const ctx = { value: 0 };
      await chain.execute(ctx, () => "done");

      assert.deepStrictEqual(ctx._beforeSnapshot, { value: 0 });
      assert.deepStrictEqual(ctx._afterSnapshot, { value: 42, result: "done" });
    });

    it("should work with only onBeforeSnapshot", async () => {
      const chain = new MiddlewareChain();
      chain.use(createSnapshotMiddleware({
        onBeforeSnapshot: (ctx) => ({ captured: ctx.data }),
      }));

      const ctx = { data: "test" };
      await chain.execute(ctx);

      assert.deepStrictEqual(ctx._beforeSnapshot, { captured: "test" });
      assert.strictEqual(ctx._afterSnapshot, undefined);
    });

    it("should work with only onAfterSnapshot", async () => {
      const chain = new MiddlewareChain();
      chain.use(createSnapshotMiddleware({
        onAfterSnapshot: (ctx, result) => ({ result }),
      }));

      const ctx = {};
      await chain.execute(ctx, () => "final");

      assert.strictEqual(ctx._beforeSnapshot, undefined);
      assert.deepStrictEqual(ctx._afterSnapshot, { result: "final" });
    });

    it("should work with no snapshot functions", async () => {
      const chain = new MiddlewareChain();
      chain.use(createSnapshotMiddleware({}));

      const ctx = {};
      const result = await chain.execute(ctx, () => "pass-through");
      assert.strictEqual(result, "pass-through");
    });

    it("should handle async snapshot functions", async () => {
      const chain = new MiddlewareChain();
      chain.use(createSnapshotMiddleware({
        onBeforeSnapshot: async (ctx) => {
          await new Promise(r => setImmediate(r));
          return { async: true };
        },
        onAfterSnapshot: async (ctx, result) => {
          await new Promise(r => setImmediate(r));
          return { asyncResult: result };
        },
      }));

      const ctx = {};
      await chain.execute(ctx, () => "async-done");

      assert.deepStrictEqual(ctx._beforeSnapshot, { async: true });
      assert.deepStrictEqual(ctx._afterSnapshot, { asyncResult: "async-done" });
    });
  });

  // ===== createShadowSystemMiddleware =====
  describe("createShadowSystemMiddleware", () => {
    it("should inject shadow hints into context", async () => {
      const chain = new MiddlewareChain();
      chain.use(createShadowSystemMiddleware({
        getShadowHints: async (ctx) => ({
          system: "You are a helpful assistant.",
          memory: { key: "value" },
        }),
      }));

      const ctx = {};
      await chain.execute(ctx);

      assert.deepStrictEqual(ctx.shadowHints, {
        system: "You are a helpful assistant.",
        memory: { key: "value" },
      });
    });

    it("should inject shadow system message into messages array", async () => {
      const chain = new MiddlewareChain();
      chain.use(createShadowSystemMiddleware({
        getShadowHints: () => ({ system: "Shadow hint content" }),
      }));

      const ctx = {
        messages: [
          { role: "system", content: "Original system" },
          { role: "user", content: "Hello" },
        ],
      };
      await chain.execute(ctx);

      assert.strictEqual(ctx.messages.length, 3);
      const shadowMsg = ctx.messages.find(m =>
        m.role === "system" && m.content.includes("[Shadow System]")
      );
      assert.ok(shadowMsg);
      assert.ok(shadowMsg.content.includes("Shadow hint content"));
    });

    it("should insert shadow message before last user/tool message", async () => {
      const chain = new MiddlewareChain();
      chain.use(createShadowSystemMiddleware({
        getShadowHints: () => ({ system: "Injected" }),
      }));

      const ctx = {
        messages: [
          { role: "system", content: "System" },
          { role: "assistant", content: "Hi" },
          { role: "user", content: "Question" },
        ],
      };
      await chain.execute(ctx);

      // Shadow should be inserted before the last user message
      const userIdx = ctx.messages.findIndex(m => m.content === "Question");
      const shadowIdx = ctx.messages.findIndex(m =>
        m.content.includes("[Shadow System]")
      );
      assert.ok(shadowIdx < userIdx);
    });

    it("should handle non-object entries in messages", async () => {
      const chain = new MiddlewareChain();
      chain.use(createShadowSystemMiddleware({
        getShadowHints: () => ({ system: "Shadow hint content" }),
      }));

      const ctx = {
        messages: [
          "raw",
          { role: "assistant", content: "Hello" },
          123,
          { role: "user", content: "Question" },
        ],
      };
      await chain.execute(ctx);

      const shadowMsg = ctx.messages.find(m =>
        m && typeof m === "object" && m.role === "system" && m.content.includes("[Shadow System]")
      );
      assert.ok(shadowMsg);
      assert.ok(ctx.messages.includes("raw"));
      assert.ok(ctx.messages.includes(123));
    });

    it("should inject even when no system role messages exist", async () => {
      const chain = new MiddlewareChain();
      chain.use(createShadowSystemMiddleware({
        getShadowHints: () => ({ system: "Injected" }),
      }));

      const ctx = {
        messages: [
          { role: "assistant", content: "Hi" },
          { role: "user", content: "Ping" },
        ],
      };
      await chain.execute(ctx);

      const shadowIdx = ctx.messages.findIndex(m =>
        m && typeof m === "object" && m.role === "system" && m.content.includes("[Shadow System]")
      );
      const userIdx = ctx.messages.findIndex(m => m.content === "Ping");
      assert.ok(shadowIdx >= 0);
      assert.ok(shadowIdx < userIdx);
    });

    it("should skip injection when same shadow block already exists", async () => {
      const chain = new MiddlewareChain();
      chain.use(createShadowSystemMiddleware({
        getShadowHints: () => ({ system: "Injected" }),
      }));

      const existingBlock = "[Shadow System]\nInjected";
      const ctx = {
        messages: [
          { role: "system", content: existingBlock },
          { role: "user", content: "Hi" },
        ],
      };
      await chain.execute(ctx);

      const shadowMsgs = ctx.messages.filter(m =>
        m && typeof m === "object" && m.role === "system" && m.content.includes(existingBlock)
      );
      assert.strictEqual(shadowMsgs.length, 1);
      assert.strictEqual(ctx.messages.length, 2);
    });

    it("should not duplicate shadow injection", async () => {
      const chain = new MiddlewareChain();
      const mw = createShadowSystemMiddleware({
        getShadowHints: () => ({ system: "Shadow hint" }),
      });
      chain.use(mw);
      chain.use(mw); // Added twice

      const ctx = {
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "Hi" },
        ],
      };
      await chain.execute(ctx);

      const shadowMsgs = ctx.messages.filter(m =>
        m.content && m.content.includes("[Shadow System]")
      );
      assert.strictEqual(shadowMsgs.length, 1);
    });

    it("should skip injection when hints.system is empty", async () => {
      const chain = new MiddlewareChain();
      chain.use(createShadowSystemMiddleware({
        getShadowHints: () => ({ system: "   " }),
      }));

      const ctx = {
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "Hi" },
        ],
      };
      await chain.execute(ctx);

      assert.strictEqual(ctx.messages.length, 2);
    });

    it("should work without getShadowHints", async () => {
      const chain = new MiddlewareChain();
      chain.use(createShadowSystemMiddleware({}));

      const ctx = { messages: [{ role: "user", content: "Hi" }] };
      await chain.execute(ctx);

      assert.strictEqual(ctx.messages.length, 1);
    });

    it("should work when hints is null", async () => {
      const chain = new MiddlewareChain();
      chain.use(createShadowSystemMiddleware({
        getShadowHints: () => null,
      }));

      const ctx = {};
      await chain.execute(ctx);

      assert.strictEqual(ctx.shadowHints, undefined);
    });
  });

  // ===== createBlackboardMiddleware =====
  describe("createBlackboardMiddleware", () => {
    it("should sync specified keys to blackboard", async () => {
      const blackboard = new Map();
      const mockBlackboard = {
        set: (k, v) => blackboard.set(k, v),
        get: (k) => blackboard.get(k),
      };

      const chain = new MiddlewareChain();
      chain.use(createBlackboardMiddleware({
        blackboard: mockBlackboard,
        syncKeys: ["status", "progress"],
      }));
      chain.use(async (ctx, next) => {
        ctx.status = "running";
        ctx.progress = 50;
        ctx.internal = "not synced";
        return next();
      });

      await chain.execute({}, () => "result");

      assert.strictEqual(blackboard.get("status"), "running");
      assert.strictEqual(blackboard.get("progress"), 50);
      assert.strictEqual(blackboard.get("internal"), undefined);
      assert.strictEqual(blackboard.get("lastResult"), "result");
    });

    it("should sync lastResult from final handler", async () => {
      const blackboard = new Map();
      const mockBlackboard = { set: (k, v) => blackboard.set(k, v) };

      const chain = new MiddlewareChain();
      chain.use(createBlackboardMiddleware({
        blackboard: mockBlackboard,
        syncKeys: [],
      }));

      await chain.execute({}, () => ({ data: "important" }));

      assert.deepStrictEqual(blackboard.get("lastResult"), { data: "important" });
    });

    it("should not sync undefined keys", async () => {
      const blackboard = new Map();
      const mockBlackboard = { set: (k, v) => blackboard.set(k, v) };

      const chain = new MiddlewareChain();
      chain.use(createBlackboardMiddleware({
        blackboard: mockBlackboard,
        syncKeys: ["missing"],
      }));

      await chain.execute({});

      assert.strictEqual(blackboard.has("missing"), false);
    });

    it("should work without blackboard", async () => {
      const chain = new MiddlewareChain();
      chain.use(createBlackboardMiddleware({ syncKeys: ["x"] }));

      await chain.execute({}, () => "ok");
    });

    it("should work with blackboard without set method", async () => {
      const chain = new MiddlewareChain();
      chain.use(createBlackboardMiddleware({
        blackboard: {},
        syncKeys: ["x"],
      }));

      await chain.execute({}, () => "ok");
    });
  });

  // ===== createDefaultMiddlewareChain =====
  describe("createDefaultMiddlewareChain", () => {
    it("should create chain with cancellation middleware", async () => {
      const chain = createDefaultMiddlewareChain({});

      assert.ok(chain.length >= 1);

      const controller = new AbortController();
      await chain.execute({ signal: controller.signal });
    });

    it("should add logging middleware when logger provided", () => {
      const chain = createDefaultMiddlewareChain({
        logger: { debug: () => {}, error: () => {} },
      });

      assert.ok(chain.length >= 2);
    });

    it("should add telemetry middleware when emit provided", () => {
      const chain = createDefaultMiddlewareChain({
        emit: () => {},
        actor: "test-actor",
        stageName: "test-stage",
      });

      assert.ok(chain.length >= 2);
    });

    it("should add timeout middleware when timeout provided", () => {
      const chain = createDefaultMiddlewareChain({
        timeout: 5000,
      });

      assert.ok(chain.length >= 2);
    });

    it("should add retry middleware when maxRetries provided", () => {
      const chain = createDefaultMiddlewareChain({
        maxRetries: 2,
        retryDelay: 100,
      });

      assert.ok(chain.length >= 2);
    });

    it("should include all optional middlewares when fully configured", () => {
      const chain = createDefaultMiddlewareChain({
        logger: { debug: () => {}, error: () => {} },
        emit: () => {},
        timeout: 5000,
        maxRetries: 2,
      });

      assert.ok(chain.length >= 5);
    });

    it("should execute cancellation check first", async () => {
      const controller = new AbortController();
      controller.abort("Early cancel");

      const chain = createDefaultMiddlewareChain({
        logger: { debug: () => {}, error: () => {} },
        timeout: 10000,
      });

      await assert.rejects(
        () => chain.execute({ signal: controller.signal }),
        { message: "Early cancel" }
      );
    });
  });
});
