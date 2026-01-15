import { afterEach, describe, expect, it, vi } from 'vitest';

import {
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
} from '../../../../js/agents/runtime/middleware/middleware-chain.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runtime/middleware middleware-chain', () => {
  it('exports Stage constants (frozen)', () => {
    expect(Stage).toMatchObject({
      BEFORE_AGENT: 'beforeAgent',
      BEFORE_MODEL: 'beforeModel',
      AFTER_MODEL: 'afterModel',
      BEFORE_TOOL: 'beforeTool',
      AFTER_TOOL: 'afterTool',
      AFTER_AGENT: 'afterAgent',
    });
    expect(Object.isFrozen(Stage)).toBe(true);
  });

  describe('MiddlewareChain registration', () => {
    it('use()/useAll()/insertAt()/remove()/clear() validate and update chain', async () => {
      const chain = new MiddlewareChain();
      expect(chain.length).toBe(0);

      // Input validation
      expect(() => chain.use(null)).toThrow(/must be a function/i);
      expect(() => chain.insertAt(0, 123)).toThrow(/must be a function/i);

      const seen = [];
      const mw1 = vi.fn(async (_ctx, next) => {
        seen.push(1);
        return next();
      });
      const mw2 = vi.fn(async (_ctx, next) => {
        seen.push(2);
        return next();
      });

      expect(chain.use(mw1)).toBe(chain);
      expect(chain.useAll([mw2])).toBe(chain);
      expect(chain.length).toBe(2);

      const mw0 = vi.fn(async (_ctx, next) => {
        seen.push(0);
        return next();
      });
      expect(chain.insertAt(0, mw0)).toBe(chain);
      expect(chain.length).toBe(3);

      expect(chain.remove(() => {})).toBe(false);
      expect(chain.remove(mw1)).toBe(true);
      expect(chain.length).toBe(2);

      await chain.execute({});
      expect(seen).toEqual([0, 2]);

      chain.clear();
      expect(chain.length).toBe(0);
    });
  });

  describe('MiddlewareChain execution', () => {
    it('executes in onion order, returns ctx by default, and calls finalHandler', async () => {
      const chain = new MiddlewareChain();
      const order = [];

      chain.use(async (ctx, next) => {
        order.push('A-before');
        // Only initialize when missing so we can assert context propagation across different inputs.
        ctx.a ??= 1;
        const result = await next();
        order.push('A-after');
        return result;
      });

      chain.use(async (ctx, next) => {
        order.push('B-before');
        ctx.b = ctx.a + 1;
        const result = await next();
        order.push('B-after');
        return result;
      });

      const ctx = {};
      const returnedCtx = await chain.execute(ctx);

      expect(returnedCtx).toBe(ctx);
      expect(ctx).toMatchObject({ a: 1, b: 2 });
      expect(order).toEqual(['A-before', 'B-before', 'B-after', 'A-after']);

      const finalHandler = vi.fn((c) => ({ ok: true, value: c.b }));
      const out = await chain.execute({ a: 4 }, finalHandler);
      expect(finalHandler).toHaveBeenCalledWith(expect.objectContaining({ a: 4 }));
      expect(out).toEqual({ ok: true, value: 5 });
    });

    it('propagates errors from middlewares', async () => {
      const chain = new MiddlewareChain();
      chain.use(async () => {
        throw new Error('boom');
      });

      await expect(chain.execute({})).rejects.toThrow(/boom/);
    });
  });

  describe('createLoggingMiddleware', () => {
    it('logs start/completion with stepName/phase fallback', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

      const logger = { debug: vi.fn(), error: vi.fn() };
      const chain = new MiddlewareChain().use(createLoggingMiddleware({ logger, prefix: '[T]' }));

      const promise = chain.execute({ phase: 'phase-1' }, async () => {
        vi.advanceTimersByTime(25);
        return 'ok';
      });

      await expect(promise).resolves.toBe('ok');
      expect(logger.debug).toHaveBeenCalledWith('[T] phase-1 started');
      expect(logger.debug).toHaveBeenCalledWith(expect.stringMatching(/^\[T\] phase-1 completed in \d+ms$/));
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('is a no-op when logger is missing', async () => {
      const chain = new MiddlewareChain().use(createLoggingMiddleware());
      await expect(chain.execute({ stepName: 'silent' }, () => 'ok')).resolves.toBe('ok');
    });

    it('logs errors and rethrows', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

      const logger = { debug: vi.fn(), error: vi.fn() };
      const chain = new MiddlewareChain().use(createLoggingMiddleware({ logger }));

      const promise = chain.execute({ stepName: 'x' }, async () => {
        vi.advanceTimersByTime(10);
        throw new Error('fail');
      });

      await expect(promise).rejects.toThrow(/fail/);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('x failed after'));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('fail'));
    });
  });

  describe('createTelemetryMiddleware', () => {
    it('emits started/completed events via ctx.emit when present', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

      const emitFromOptions = vi.fn();
      const emitFromCtx = vi.fn();
      const chain = new MiddlewareChain().use(createTelemetryMiddleware({
        emit: emitFromOptions,
        actor: 'tester',
        stageName: 'stage',
      }));

      const ctx = { stepName: 's1', emit: emitFromCtx };
      const promise = chain.execute(ctx, async () => {
        vi.advanceTimersByTime(7);
        return 'done';
      });

      await expect(promise).resolves.toBe('done');
      expect(emitFromOptions).not.toHaveBeenCalled();
      expect(emitFromCtx).toHaveBeenCalledWith('stage.middleware.s1.started', expect.any(Object));
      expect(emitFromCtx).toHaveBeenCalledWith('stage.middleware.s1.completed', expect.any(Object));
    });

    it('skips emitting when no emit function is available', async () => {
      const chain = new MiddlewareChain().use(createTelemetryMiddleware());
      await expect(chain.execute({ stepName: 's' }, () => 'ok')).resolves.toBe('ok');
    });

    it('emits failed events and rethrows', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

      const emit = vi.fn();
      const chain = new MiddlewareChain().use(createTelemetryMiddleware({ emit, stageName: 'x' }));

      const promise = chain.execute({ phase: 'p1' }, async () => {
        vi.advanceTimersByTime(3);
        throw new Error('nope');
      });

      await expect(promise).rejects.toThrow(/nope/);
      expect(emit).toHaveBeenCalledWith('x.middleware.p1.started', expect.any(Object));
      expect(emit).toHaveBeenCalledWith('x.middleware.p1.failed', expect.objectContaining({
        actor: 'agent',
        status: 'error',
        payload: expect.objectContaining({ error: 'nope' }),
      }));
    });
  });

  describe('createCancellationMiddleware', () => {
    it('passes when not aborted and throws with correct reason when aborted', async () => {
      const chain = new MiddlewareChain().use(createCancellationMiddleware());

      const controller = new AbortController();
      await expect(chain.execute({ signal: controller.signal }, () => 'ok')).resolves.toBe('ok');

      const controller2 = new AbortController();
      controller2.abort('User cancelled');
      await expect(chain.execute({ signal: controller2.signal })).rejects.toThrow(/User cancelled/);

      const controller3 = new AbortController();
      controller3.abort({ code: 'X' });
      await expect(chain.execute({ signal: controller3.signal })).rejects.toThrow(/Run cancelled/);
    });
  });

  describe('createTimeoutMiddleware', () => {
    it('resolves within timeout and propagates downstream errors without timing out', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

      const onTimeout = vi.fn();
      const chain = new MiddlewareChain().use(createTimeoutMiddleware({ timeout: 50, onTimeout }));

      const ok = chain.execute({ timeout: 1000 }, async () => {
        vi.advanceTimersByTime(10);
        return 123;
      });
      await expect(ok).resolves.toBe(123);
      expect(onTimeout).not.toHaveBeenCalled();

      const boom = chain.execute({}, async () => {
        vi.advanceTimersByTime(10);
        throw new Error('downstream');
      });
      await expect(boom).rejects.toThrow(/downstream/);
      // Timer should be cleared on rejection; advancing time should not call onTimeout.
      await vi.advanceTimersByTimeAsync(1000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('rejects with TIMEOUT and calls onTimeout(ctx, err)', async () => {
      vi.useFakeTimers();

      const onTimeout = vi.fn();
      const chain = new MiddlewareChain().use(createTimeoutMiddleware({ timeout: 10, onTimeout }));

      const ctx = { timeout: 5 };
      const pending = chain.execute(ctx, async () => new Promise(() => {}));
      const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });

      await vi.advanceTimersByTimeAsync(5);
      await rejected;
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(onTimeout).toHaveBeenCalledWith(ctx, expect.objectContaining({ code: 'TIMEOUT' }));
    });

    it('rejects with TIMEOUT even when onTimeout is not provided', async () => {
      vi.useFakeTimers();

      const chain = new MiddlewareChain().use(createTimeoutMiddleware({ timeout: 5 }));
      const pending = chain.execute({}, async () => new Promise(() => {}));
      const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });

      await vi.advanceTimersByTimeAsync(5);
      await rejected;
    });
  });

  describe('createRetryMiddleware', () => {
    it('retries and re-executes downstream chain (ctx._retryAttempt tracks attempts)', async () => {
      vi.useFakeTimers();

      const chain = new MiddlewareChain();
      chain.use(createRetryMiddleware({ maxRetries: 2, retryDelay: 10 }));

      const downstream = vi.fn(async (ctx, next) => {
        if (ctx._retryAttempt < 2) throw new Error(`fail-${ctx._retryAttempt}`);
        ctx.value = 'ok';
        return next();
      });
      chain.use(downstream);

      const done = vi.fn(() => 'final');
      const ctx = {};
      const promise = chain.execute(ctx, done);

      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('final');

      expect(downstream).toHaveBeenCalledTimes(3);
      expect(ctx._retryAttempt).toBe(2);
      expect(ctx.value).toBe('ok');
    });

    it('respects shouldRetry=false and stops immediately', async () => {
      vi.useFakeTimers();

      const shouldRetry = vi.fn(() => false);
      const chain = new MiddlewareChain()
        .use(createRetryMiddleware({ maxRetries: 5, retryDelay: 10, shouldRetry }))
        .use(async () => {
          throw new Error('permanent');
        });

      const promise = chain.execute({});
      await expect(promise).rejects.toThrow(/permanent/);
      expect(shouldRetry).toHaveBeenCalledTimes(1);
    });

    it('uses shouldRetry=true to allow retries', async () => {
      vi.useFakeTimers();

      const shouldRetry = vi.fn(() => true);
      const worker = vi.fn(async (ctx, next) => {
        if (ctx._retryAttempt === 0) throw new Error('transient');
        return next();
      });

      const chain = new MiddlewareChain()
        .use(createRetryMiddleware({ maxRetries: 1, retryDelay: 10, shouldRetry }))
        .use(worker);

      const promise = chain.execute({}, () => 'ok');
      const resolved = expect(promise).resolves.toBe('ok');
      await vi.runAllTimersAsync();
      await resolved;

      expect(worker).toHaveBeenCalledTimes(2);
      expect(shouldRetry).toHaveBeenCalledTimes(1);
    });

    it('throws after maxRetries is exceeded', async () => {
      vi.useFakeTimers();

      const alwaysFail = vi.fn(async () => {
        throw new Error('always');
      });

      const chain = new MiddlewareChain()
        .use(createRetryMiddleware({ maxRetries: 1, retryDelay: 10 }))
        .use(alwaysFail);

      const promise = chain.execute({});
      const rejected = expect(promise).rejects.toThrow(/always/);
      await vi.runAllTimersAsync();
      await rejected;
      expect(alwaysFail).toHaveBeenCalledTimes(2);
    });
  });

  describe('createSnapshotMiddleware', () => {
    it('captures before/after snapshots (supports async hooks)', async () => {
      const onBeforeSnapshot = vi.fn(async (ctx) => ({ before: ctx.value }));
      const onAfterSnapshot = vi.fn(async (_ctx, result) => ({ after: result }));

      const chain = new MiddlewareChain()
        .use(createSnapshotMiddleware({ onBeforeSnapshot, onAfterSnapshot }))
        .use(async (ctx, next) => {
          ctx.value = 42;
          return next();
        });

      const ctx = { value: 1 };
      const out = await chain.execute(ctx, () => 'done');

      expect(out).toBe('done');
      expect(onBeforeSnapshot).toHaveBeenCalledWith(ctx);
      expect(onAfterSnapshot).toHaveBeenCalledWith(ctx, 'done');
      expect(ctx._beforeSnapshot).toEqual({ before: 1 });
      expect(ctx._afterSnapshot).toEqual({ after: 'done' });
    });

    it('skips snapshot hooks when they are not functions', async () => {
      const chain = new MiddlewareChain()
        .use(createSnapshotMiddleware({ onBeforeSnapshot: null, onAfterSnapshot: 123 }))
        .use(async (_ctx, next) => next());

      const ctx = {};
      await expect(chain.execute(ctx, () => 'ok')).resolves.toBe('ok');
      expect(ctx._beforeSnapshot).toBeUndefined();
      expect(ctx._afterSnapshot).toBeUndefined();
    });
  });

  describe('createShadowSystemMiddleware', () => {
    it('injects a new system message before the last user/tool turn (no in-place mutation)', async () => {
      const getShadowHints = vi.fn(async () => ({ system: 'secret' }));
      const chain = new MiddlewareChain().use(createShadowSystemMiddleware({ getShadowHints }));

      const originalMessages = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u1' },
      ];
      const ctx = { messages: originalMessages };

      await chain.execute(ctx, () => 'ok');

      expect(getShadowHints).toHaveBeenCalledWith(ctx);
      expect(ctx.shadowHints).toEqual({ system: 'secret' });
      expect(ctx.messages).not.toBe(originalMessages);
      expect(ctx.messages).toHaveLength(4);

      const injected = ctx.messages[2];
      expect(injected).toMatchObject({
        role: 'system',
        content: '[Shadow System]\nsecret',
      });
      expect(ctx.messages[3]).toMatchObject({ role: 'user', content: 'u1' });

      // Cache-friendly cloning: original message objects should not be the same references.
      expect(ctx.messages[0]).not.toBe(originalMessages[0]);
      expect(ctx.messages[1]).not.toBe(originalMessages[1]);
      expect(ctx.messages[3]).not.toBe(originalMessages[2]);
    });

    it('does not inject duplicate blocks (still clones)', async () => {
      const getShadowHints = vi.fn(async () => ({ system: 'secret' }));
      const chain = new MiddlewareChain().use(createShadowSystemMiddleware({ getShadowHints }));

      const block = '[Shadow System]\nsecret';
      const originalMessages = [
        { role: 'system', content: `sys\n${block}` },
        { role: 'assistant', content: 'a1' },
      ];
      const ctx = { messages: originalMessages };

      await chain.execute(ctx, () => 'ok');
      expect(ctx.messages).toHaveLength(2);
      expect(ctx.messages[0].content).toContain(block);
      expect(ctx.messages).not.toBe(originalMessages);
    });

    it('inserts at end when there is no user/tool message, and skips injection on empty hints.system', async () => {
      const getShadowHints = vi.fn(async (ctx) => (ctx.mode === 'empty' ? { system: '   ' } : { system: 'x' }));
      const chain = new MiddlewareChain().use(createShadowSystemMiddleware({ getShadowHints }));

      const ctx1 = { messages: [{ role: 'system', content: 'sys' }, { role: 'assistant', content: 'a' }] };
      await chain.execute(ctx1, () => 'ok');
      expect(ctx1.messages).toHaveLength(3);
      expect(ctx1.messages[2]).toMatchObject({ role: 'system', content: '[Shadow System]\nx' });

      const ctx2 = { mode: 'empty', messages: [{ role: 'system', content: 'sys' }] };
      const before = ctx2.messages;
      await chain.execute(ctx2, () => 'ok');
      expect(ctx2.shadowHints).toEqual({ system: '   ' });
      // No injection -> messages unchanged (same reference).
      expect(ctx2.messages).toBe(before);
    });

    it('does nothing when getShadowHints returns null', async () => {
      const getShadowHints = vi.fn(async () => null);
      const chain = new MiddlewareChain().use(createShadowSystemMiddleware({ getShadowHints }));

      const messages = [{ role: 'system', content: 'sys' }];
      const ctx = { messages };
      await expect(chain.execute(ctx, () => 'ok')).resolves.toBe('ok');

      expect(getShadowHints).toHaveBeenCalledTimes(1);
      expect(ctx.shadowHints).toBeUndefined();
      expect(ctx.messages).toBe(messages);
    });
  });

  describe('createBlackboardMiddleware', () => {
    it('syncs configured keys and lastResult to blackboard', async () => {
      const blackboard = { set: vi.fn() };
      const chain = new MiddlewareChain()
        .use(createBlackboardMiddleware({ blackboard, syncKeys: ['a', 'b', 'missing'] }))
        .use(async (ctx, next) => {
          ctx.a = 1;
          ctx.b = undefined;
          return next();
        });

      const ctx = {};
      const result = await chain.execute(ctx, () => ({ ok: true }));

      expect(result).toEqual({ ok: true });
      // a is defined -> written. b is undefined -> skipped. missing is undefined -> skipped.
      expect(blackboard.set).toHaveBeenCalledWith('a', 1);
      expect(blackboard.set).toHaveBeenCalledWith('lastResult', { ok: true });
      expect(blackboard.set).toHaveBeenCalledTimes(2);
    });

    it('does not write lastResult when result is undefined', async () => {
      const blackboard = { set: vi.fn() };
      const chain = new MiddlewareChain().use(createBlackboardMiddleware({ blackboard, syncKeys: [] }));

      const out = await chain.execute({}, () => undefined);
      expect(out).toBeUndefined();
      expect(blackboard.set).not.toHaveBeenCalled();
    });

    it('is a no-op when blackboard.set is not a function', async () => {
      const chain = new MiddlewareChain().use(createBlackboardMiddleware({
        blackboard: { set: 'nope' },
        syncKeys: ['a'],
      }));

      await expect(chain.execute({ a: 1 }, () => 'ok')).resolves.toBe('ok');
    });
  });

  describe('createDefaultMiddlewareChain', () => {
    it('cancellation middleware runs first (short-circuits before logging/telemetry)', async () => {
      const logger = { debug: vi.fn(), error: vi.fn() };
      const emit = vi.fn();

      const chain = createDefaultMiddlewareChain({
        logger,
        emit,
        timeout: 10,
        maxRetries: 2,
        retryDelay: 1,
      });

      const controller = new AbortController();
      controller.abort('stop');

      await expect(chain.execute({ signal: controller.signal, stepName: 's' })).rejects.toThrow(/stop/);

      // Should short-circuit: other middlewares never run.
      expect(logger.debug).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('includes optional middlewares based on options', () => {
      const chain = createDefaultMiddlewareChain({
        logger: { debug: () => {}, error: () => {} },
        emit: () => {},
        timeout: 5000,
        maxRetries: 2,
      });

      expect(chain.length).toBe(5);
    });

    it('only includes cancellation middleware when no options are provided', async () => {
      const chain = createDefaultMiddlewareChain();
      expect(chain.length).toBe(1);

      // No signal -> should still pass through.
      await expect(chain.execute({}, () => 'ok')).resolves.toBe('ok');
    });
  });
});
