// Unit tests for js/agents/runtime/core/middleware/middleware-chain.js covering Stage, MiddlewareChain, and logging middleware.
// Includes boundary, concurrency, and error-path cases to guard behavior across edge inputs.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MiddlewareChain,
  Stage,
  createLoggingMiddleware,
} from '../../../../../../js/agents/runtime/core/middleware/middleware-chain.js';

const mockedLoggerModule = vi.hoisted(() => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../../../../../js/shared/utils/logger.js', () => ({
  default: mockedLoggerModule.createLogger,
  createLogger: mockedLoggerModule.createLogger,
}));

const loadLoggerFactory = async () => await import('../../../../../../js/shared/utils/logger.js');

const makeDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  current.value = 'leaf';
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

const getMockedLogger = async () => {
  const { createLogger } = await loadLoggerFactory();
  return createLogger('test');
};

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Stage', () => {
  it('exports frozen lifecycle constants', () => {
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

  it('rejects mutation attempts', () => {
    expect(() => {
      Stage.BEFORE_AGENT = 'mutated';
    }).toThrow(TypeError);
    expect(Stage.BEFORE_AGENT).toBe('beforeAgent');
  });
});

describe('MiddlewareChain', () => {
  it('starts empty and tracks length', () => {
    const chain = new MiddlewareChain();
    expect(chain.length).toBe(0);

    chain.use(async (_ctx, next) => next());
    expect(chain.length).toBe(1);
  });

  it('rejects non-function middleware for use/insertAt', () => {
    const chain = new MiddlewareChain();
    const invalid = [null, undefined, '', '   ', 0, -1, Number.MAX_SAFE_INTEGER, {}, []];

    for (const value of invalid) {
      expect(() => chain.use(value)).toThrow(TypeError);
      expect(() => chain.insertAt(0, value)).toThrow(TypeError);
    }

    expect(chain.length).toBe(0);
  });

  it('useAll handles empty arrays and rejects invalid iterables', () => {
    const chain = new MiddlewareChain();
    expect(chain.useAll([])).toBe(chain);
    expect(chain.length).toBe(0);

    expect(() => chain.useAll({})).toThrow(TypeError);
    expect(() => chain.useAll('bad')).toThrow(TypeError);
    expect(chain.length).toBe(0);
  });

  it('insertAt supports boundary indices (0, -1, MAX_SAFE_INTEGER)', async () => {
    const order = [];
    const chain = new MiddlewareChain();

    chain.use(makePushMiddleware('A', order));
    chain.use(makePushMiddleware('B', order));

    chain.insertAt(0, makePushMiddleware('START', order));
    chain.insertAt(-1, makePushMiddleware('NEG', order));
    chain.insertAt(Number.MAX_SAFE_INTEGER, makePushMiddleware('MAX', order));

    await chain.execute({});
    expect(order).toEqual(['START', 'A', 'NEG', 'B', 'MAX']);
  });

  it('coerces numeric strings in insertAt indices', async () => {
    const order = [];
    const chain = new MiddlewareChain();

    chain.use(makePushMiddleware('A', order));
    chain.use(makePushMiddleware('B', order));
    chain.insertAt('1', makePushMiddleware('C', order));

    await chain.execute({});
    expect(order).toEqual(['A', 'C', 'B']);
  });

  it('remove returns boolean and clear resets chain', async () => {
    const chain = new MiddlewareChain();
    const mw1 = async (_ctx, next) => next();
    const mw2 = async (_ctx, next) => next();

    chain.use(mw1).use(mw2);
    expect(chain.remove(() => {})).toBe(false);
    expect(chain.remove(mw1)).toBe(true);
    expect(chain.length).toBe(1);

    chain.clear();
    expect(chain.length).toBe(0);

    await expect(chain.execute({})).resolves.toEqual({});
  });

  it('executes in onion order and applies finalHandler', async () => {
    const chain = new MiddlewareChain();
    const order = [];

    chain.use(async (ctx, next) => {
      order.push('A-before');
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

    const finalHandler = vi.fn((current) => ({ ok: true, value: current.b }));
    const out = await chain.execute({ a: 4 }, finalHandler);

    expect(finalHandler).toHaveBeenCalledWith(expect.objectContaining({ a: 4 }));
    expect(out).toEqual({ ok: true, value: 5 });
  });

  it('returns ctx for empty chain including nullish values', async () => {
    const chain = new MiddlewareChain();

    await expect(chain.execute(null)).resolves.toBeNull();
    await expect(chain.execute(undefined)).resolves.toBeUndefined();

    const ctx = {};
    await expect(chain.execute(ctx)).resolves.toBe(ctx);
  });

  it('propagates errors from middlewares and finalHandler', async () => {
    const chain = new MiddlewareChain();
    chain.use(async () => {
      throw new Error('boom');
    });

    await expect(chain.execute({})).rejects.toThrow('boom');

    const chain2 = new MiddlewareChain();
    await expect(chain2.execute({}, () => {
      throw new Error('final');
    })).rejects.toThrow('final');
  });

  it('supports retry-style multiple next calls', async () => {
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
    const result = await chain.execute(ctx);

    expect(result).toEqual([1, 2]);
    expect(ctx.downstream).toBe(2);
  });

  it('handles concurrent executions without cross-talk', async () => {
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

    const ctxA = { id: 'A', delay: 5, events: [] };
    const ctxB = { id: 'B', delay: 10, events: [] };

    const promiseA = chain.execute(ctxA);
    const promiseB = chain.execute(ctxB);

    await vi.advanceTimersByTimeAsync(20);
    const results = await Promise.all([promiseA, promiseB]);

    expect(results).toEqual(['A', 'B']);
    expect(ctxA.events).toEqual(['start-A', 'work-A', 'end-A']);
    expect(ctxB.events).toEqual(['start-B', 'work-B', 'end-B']);
  });

  it('handles rapid sequential execute calls', async () => {
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

    expect(ctx1).toMatchObject({ count: 1, final: true });
    expect(ctx2).toMatchObject({ count: 1, final: true });
  });

  it('passes large payloads and deep nesting without mutation', async () => {
    const chain = new MiddlewareChain();
    const deep = makeDeepObject(25);
    const largeFile = 'x'.repeat(200000);

    const ctx = {
      deep,
      fileContent: largeFile,
      meta: { name: 'file.txt' },
    };

    const result = await chain.execute(ctx, (current) => ({
      size: current.fileContent.length,
      leaf: getDeepValue(current.deep, 25),
    }));

    expect(result).toEqual({ size: 200000, leaf: 'leaf' });
    expect(ctx.fileContent).toBe(largeFile);
    expect(getDeepValue(ctx.deep, 25)).toBe('leaf');
  });
});

describe('createLoggingMiddleware', () => {
  it('throws when options is null', () => {
    expect(() => createLoggingMiddleware(null)).toThrow(TypeError);
  });

  it('logs start/completion with custom prefix and long stepName', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const logger = await getMockedLogger();
    const middleware = createLoggingMiddleware({ logger, prefix: '[T]' });
    const stepName = `step-${'a'.repeat(10000)}`;

    const resultPromise = middleware({ stepName }, async () => {
      vi.advanceTimersByTime(12);
      return 'ok';
    });

    await expect(resultPromise).resolves.toBe('ok');
    expect(logger.debug).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenNthCalledWith(1, `[T] ${stepName} started`);

    const completionMessage = logger.debug.mock.calls[1][0];
    expect(completionMessage).toContain(`[T] ${stepName} completed in 12ms`);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('falls back to phase or default step name for empty inputs', async () => {
    const logger = await getMockedLogger();
    const middleware = createLoggingMiddleware({ logger });

    await middleware({ stepName: '', phase: 'phase-1' }, async () => 'ok');
    expect(logger.debug).toHaveBeenCalledWith('[AgentLoop] phase-1 started');

    logger.debug.mockClear();

    await middleware({}, async () => 'ok');
    expect(logger.debug).toHaveBeenCalledWith('[AgentLoop] step started');
  });

  it('uses whitespace stepName as-is', async () => {
    const logger = await getMockedLogger();
    const middleware = createLoggingMiddleware({ logger });

    await middleware({ stepName: '   ', phase: 'phase-x' }, async () => 'ok');
    expect(logger.debug).toHaveBeenNthCalledWith(1, '[AgentLoop]     started');
  });

  it('is a no-op when logger is missing or null', async () => {
    const middleware = createLoggingMiddleware();
    await expect(middleware({ stepName: 'silent' }, async () => 'ok')).resolves.toBe('ok');

    const middlewareNull = createLoggingMiddleware({ logger: null });
    await expect(middlewareNull({ stepName: 'silent' }, async () => 'ok')).resolves.toBe('ok');
  });

  it('logs errors and rethrows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const logger = await getMockedLogger();
    const middleware = createLoggingMiddleware({ logger, prefix: '[AgentLoop]' });

    const promise = middleware({ phase: 'phase-fail' }, async () => {
      vi.advanceTimersByTime(5);
      throw new Error('fail');
    });

    await expect(promise).rejects.toThrow('fail');
    expect(logger.error).toHaveBeenCalledTimes(1);

    const errorMessage = logger.error.mock.calls[0][0];
    expect(errorMessage).toContain('phase-fail failed after 5ms');
    expect(errorMessage).toContain('fail');
  });
});
