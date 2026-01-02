/**
 * Middleware Chain 单元测试
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  MiddlewareChain,
  createLoggingMiddleware,
  createTelemetryMiddleware,
  createCancellationMiddleware,
  createTimeoutMiddleware,
  createRetryMiddleware,
  createSnapshotMiddleware,
  createDefaultMiddlewareChain,
} from "../../../js/agents/runtime/middleware/middleware-chain.js";

describe("middleware-chain", () => {
  describe("MiddlewareChain", () => {
    it("should execute middlewares in order", async () => {
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

    it("should call final handler", async () => {
      const chain = new MiddlewareChain();
      let finalCalled = false;

      chain.use(async (ctx, next) => {
        ctx.step1 = true;
        return next();
      });

      await chain.execute({}, (ctx) => {
        finalCalled = true;
        return ctx;
      });

      assert.strictEqual(finalCalled, true);
    });

    it("should propagate errors", async () => {
      const chain = new MiddlewareChain();

      chain.use(async () => {
        throw new Error("Test error");
      });

      await assert.rejects(
        () => chain.execute({}),
        { message: "Test error" }
      );
    });

    it("should support useAll for batch adding", async () => {
      const chain = new MiddlewareChain();
      const order = [];

      chain.useAll([
        async (ctx, next) => { order.push(1); return next(); },
        async (ctx, next) => { order.push(2); return next(); },
      ]);

      await chain.execute({});
      assert.deepStrictEqual(order, [1, 2]);
    });

    it("should support insertAt", async () => {
      const chain = new MiddlewareChain();
      const order = [];

      chain.use(async (ctx, next) => { order.push(1); return next(); });
      chain.use(async (ctx, next) => { order.push(3); return next(); });
      chain.insertAt(1, async (ctx, next) => { order.push(2); return next(); });

      await chain.execute({});
      assert.deepStrictEqual(order, [1, 2, 3]);
    });

    it("should support remove", async () => {
      const chain = new MiddlewareChain();
      const order = [];

      const mw2 = async (ctx, next) => { order.push(2); return next(); };

      chain.use(async (ctx, next) => { order.push(1); return next(); });
      chain.use(mw2);
      chain.use(async (ctx, next) => { order.push(3); return next(); });

      chain.remove(mw2);

      await chain.execute({});
      assert.deepStrictEqual(order, [1, 3]);
    });

    it("should report correct length", () => {
      const chain = new MiddlewareChain();
      assert.strictEqual(chain.length, 0);

      chain.use(async (ctx, next) => next());
      chain.use(async (ctx, next) => next());
      assert.strictEqual(chain.length, 2);

      chain.clear();
      assert.strictEqual(chain.length, 0);
    });
  });

  describe("createLoggingMiddleware", () => {
    it("should log start and completion", async () => {
      const logs = [];
      const logger = {
        debug: (msg) => logs.push(msg),
        error: (msg) => logs.push(msg),
      };

      const chain = new MiddlewareChain();
      chain.use(createLoggingMiddleware({ logger }));

      await chain.execute({ stepName: "test-step" });

      assert.ok(logs.some(l => l.includes("test-step started")));
      assert.ok(logs.some(l => l.includes("test-step completed")));
    });

    it("should log errors", async () => {
      const logs = [];
      const logger = {
        debug: (msg) => logs.push(msg),
        error: (msg) => logs.push(msg),
      };

      const chain = new MiddlewareChain();
      chain.use(createLoggingMiddleware({ logger }));
      chain.use(async () => { throw new Error("Test failure"); });

      await assert.rejects(() => chain.execute({ stepName: "failing-step" }));

      assert.ok(logs.some(l => l.includes("failing-step failed")));
    });
  });

  describe("createTelemetryMiddleware", () => {
    it("should emit start and completion events", async () => {
      const events = [];
      const emit = (name, payload) => events.push({ name, payload });

      const chain = new MiddlewareChain();
      chain.use(createTelemetryMiddleware({ emit, stageName: "test" }));

      await chain.execute({ stepName: "my-step" });

      assert.ok(events.some(e => e.name === "test.middleware.my-step.started"));
      assert.ok(events.some(e => e.name === "test.middleware.my-step.completed"));
    });
  });

  describe("createCancellationMiddleware", () => {
    it("should pass when signal not aborted", async () => {
      const chain = new MiddlewareChain();
      chain.use(createCancellationMiddleware());

      const controller = new AbortController();
      await chain.execute({ signal: controller.signal }); // Should not throw
    });

    it("should throw when signal aborted", async () => {
      const chain = new MiddlewareChain();
      chain.use(createCancellationMiddleware());

      const controller = new AbortController();
      controller.abort("User cancelled");

      await assert.rejects(
        () => chain.execute({ signal: controller.signal }),
        { message: "User cancelled" }
      );
    });
  });

  describe("createTimeoutMiddleware", () => {
    it("should pass when within timeout", async () => {
      const chain = new MiddlewareChain();
      chain.use(createTimeoutMiddleware({ timeout: 1000 }));
      chain.use(async (ctx, next) => {
        await new Promise(r => setImmediate(r));
        return next();
      });

      await chain.execute({}); // Should not throw
    });

    it("should throw on timeout", async () => {
      const chain = new MiddlewareChain();
      chain.use(createTimeoutMiddleware({ timeout: 1 }));
      chain.use(async () => {
        await new Promise(() => {});
      });

      await assert.rejects(
        () => chain.execute({}),
        { code: "TIMEOUT" }
      );
    });
  });

  describe("createRetryMiddleware", () => {
    it("should retry on failure and track attempts", async () => {
      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({ maxRetries: 2, retryDelay: 10 }));
      chain.use(async (ctx, next) => {
        // 使用 ctx._retryAttempt 来跟踪重试次数
        if (ctx._retryAttempt < 2) throw new Error("Temporary failure");
        ctx.result = "success";
        return next();
      });

      const ctx = {};
      await chain.execute(ctx);
      assert.strictEqual(ctx.result, "success");
      assert.strictEqual(ctx._retryAttempt, 2);
    });

    it("should respect shouldRetry", async () => {
      let attempts = 0;

      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({
        maxRetries: 5,
        shouldRetry: (err) => !err.message.includes("permanent"),
      }));
      chain.use(async () => {
        attempts++;
        throw new Error("permanent failure");
      });

      await assert.rejects(() => chain.execute({}));
      assert.strictEqual(attempts, 1); // No retry for permanent errors
    });
  });

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
  });

  describe("createDefaultMiddlewareChain", () => {
    it("should create chain with cancellation middleware", async () => {
      const chain = createDefaultMiddlewareChain({});

      // Should have at least cancellation middleware
      assert.ok(chain.length >= 1);

      // Should work with non-aborted signal
      const controller = new AbortController();
      await chain.execute({ signal: controller.signal });
    });

    it("should include optional middlewares when configured", () => {
      const chain = createDefaultMiddlewareChain({
        logger: { debug: () => {}, error: () => {} },
        emit: () => {},
        timeout: 5000,
        maxRetries: 2,
      });

      // Should have multiple middlewares
      assert.ok(chain.length >= 4);
    });
  });
});
