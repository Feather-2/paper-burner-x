import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockLogger, mockCreateLogger } = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    mockLogger,
    mockCreateLogger: vi.fn(() => mockLogger),
  };
});

vi.mock('../../../../../js/agents/shared/utils/logger.js', () => ({
  createLogger: mockCreateLogger,
}));

import { isRetryableError, RetryStrategy, resetGlobalRetryStats } from '../../../../../js/agents/shared/retry-strategy.js';

const FIXED_TIME = new Date('2024-01-01T00:00:00.000Z');

function createDeepObject(depth) {
  let node = {};
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, child: node };
  }
  return node;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isRetryableError', () => {
  it('returns false for nullish, empty, or whitespace values', () => {
    const arrayLike = { 0: 'x', length: 1 };
    const cases = [null, undefined, '', '   ', [], {}, arrayLike, { message: '   ' }];

    cases.forEach((value) => {
      expect(isRetryableError(value)).toBe(false);
    });
  });

  it('returns true for retryable error codes and status codes', () => {
    ['ECONNRESET', 'ETIMEDOUT'].forEach((code) => {
      expect(isRetryableError({ code })).toBe(true);
    });

    [429, 503].forEach((status) => {
      expect(isRetryableError({ status })).toBe(true);
    });
  });

  it('detects rate limit and timeout signals', () => {
    expect(isRetryableError({ message: 'rate limit exceeded' })).toBe(true);
    expect(isRetryableError({ message: 'upstream 429 error' })).toBe(true);
    expect(isRetryableError({ name: 'TimeoutError' })).toBe(true);
    expect(isRetryableError({ message: 'request timeout' })).toBe(true);
  });

  it('returns false for non-retryable or type-mismatched fields', () => {
    const arrayLikeStatus = { 0: 429, length: 1 };

    expect(isRetryableError({ code: 'EOTHER' })).toBe(false);
    expect(isRetryableError({ status: '429', message: 'nope' })).toBe(false);
    expect(isRetryableError({ status: arrayLikeStatus, message: 'nope' })).toBe(false);
  });

  it('handles long strings, deep nesting, and large payloads', () => {
    const deep = createDeepObject(25);
    const longMessage = `${'x'.repeat(100000)} rate limit reached`;
    const largePayload = new Uint8Array(1024 * 1024);

    const error = { message: longMessage, meta: deep, file: largePayload };
    expect(isRetryableError(error)).toBe(true);
  });
});

describe('RetryStrategy', () => {
  beforeEach(() => {
    resetGlobalRetryStats();
  });

  it('stats counts retries in the last minute and tracks budget remaining', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);

    const strategy = new RetryStrategy({ globalBudgetPerMinute: 2 });

    strategy.recordRetry();
    vi.setSystemTime(new Date(FIXED_TIME.getTime() + 30000));
    strategy.recordRetry();

    expect(strategy.stats).toEqual({
      retriesLastMinute: 2,
      budgetPerMinute: 2,
      budgetRemaining: 0,
    });

    vi.setSystemTime(new Date(FIXED_TIME.getTime() + 61000));
    expect(strategy.stats).toEqual({
      retriesLastMinute: 1,
      budgetPerMinute: 2,
      budgetRemaining: 1,
    });
  });

  it('calculateDelay applies exponential backoff, caps, and jitter', () => {
    const strategy = new RetryStrategy({
      baseDelayMs: 1000,
      maxDelayMs: 3000,
      jitterFactor: 0.1,
    });

    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(strategy.calculateDelay(2)).toBe(3300);
  });

  it('calculateDelay clamps to zero for zero or negative base delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const zero = new RetryStrategy({ baseDelayMs: 0, jitterFactor: 0.3 });
    expect(zero.calculateDelay(5)).toBe(0);

    const negative = new RetryStrategy({ baseDelayMs: -1, jitterFactor: 0.3 });
    expect(negative.calculateDelay(0)).toBe(0);
  });

  it('calculateDelay respects MAX_SAFE_INTEGER boundary', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const strategy = new RetryStrategy({
      baseDelayMs: Number.MAX_SAFE_INTEGER,
      maxDelayMs: Number.MAX_SAFE_INTEGER,
      jitterFactor: 0,
    });

    expect(strategy.calculateDelay(1)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('canRetry trims old timestamps and handles rapid consecutive retries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);

    const strategy = new RetryStrategy({ globalBudgetPerMinute: 2 });

    strategy.recordRetry();
    strategy.recordRetry();

    expect(strategy.canRetry()).toBe(false);

    vi.setSystemTime(new Date(FIXED_TIME.getTime() + 61000));
    expect(strategy.canRetry()).toBe(true);
  });

  it('execute returns on first success without retries', async () => {
    const strategy = new RetryStrategy({ maxRetries: 2 });
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await strategy.execute(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('execute retries retryable errors and ignores onRetry failures', async () => {
    const strategy = new RetryStrategy({ maxRetries: 2, baseDelayMs: 100, jitterFactor: 0 });
    vi.spyOn(strategy, '_sleep').mockResolvedValue();

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue('ok');

    const onRetry = vi.fn(({ attempt }) => {
      if (attempt === 0) {
        throw new Error('onRetry boom');
      }
    });

    const result = await strategy.execute(fn, { onRetry });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledTimes(2);
  });

  it('execute honors numeric string options and custom isRetryable', async () => {
    const isRetryable = vi.fn(() => true);
    const strategy = new RetryStrategy({
      maxRetries: '1',
      baseDelayMs: '10',
      maxDelayMs: '20',
      jitterFactor: '0',
      globalBudgetPerMinute: '5',
      isRetryable,
    });
    vi.spyOn(strategy, '_sleep').mockResolvedValue();

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('not retryable'))
      .mockResolvedValue('done');

    const result = await strategy.execute(fn);

    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(isRetryable).toHaveBeenCalledTimes(1);
  });

  it('execute stops on non-retryable errors', async () => {
    const strategy = new RetryStrategy({ maxRetries: 2 });
    const fn = vi.fn().mockRejectedValue(new Error('nope'));

    await expect(strategy.execute(fn)).rejects.toThrow('nope');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('execute respects maxRetries = 0 boundary', async () => {
    const strategy = new RetryStrategy({ maxRetries: 0 });
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(strategy.execute(fn)).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('execute respects global budget = 0 boundary', async () => {
    const strategy = new RetryStrategy({ maxRetries: 1, globalBudgetPerMinute: 0 });
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(strategy.execute(fn)).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('execute throws when aborted before start', async () => {
    const strategy = new RetryStrategy();
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn();

    await expect(strategy.execute(fn, { signal: controller.signal })).rejects.toThrow('Aborted');
    expect(fn).not.toHaveBeenCalled();
  });

  it('sleep rejects when aborted during wait', async () => {
    const strategy = new RetryStrategy();
    const controller = new AbortController();

    const promise = strategy._sleep(50, controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow('Aborted');
  });

  it('supports concurrent executions with quick retries', async () => {
    const strategy = new RetryStrategy({
      maxRetries: 1,
      baseDelayMs: 1,
      jitterFactor: 0,
      globalBudgetPerMinute: 10,
    });
    vi.spyOn(strategy, '_sleep').mockResolvedValue();

    const makeFn = () => {
      let calls = 0;
      return vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('timeout');
        }
        return 'ok';
      });
    };

    const fnA = makeFn();
    const fnB = makeFn();

    const [resultA, resultB] = await Promise.all([
      strategy.execute(fnA),
      strategy.execute(fnB),
    ]);

    expect(resultA).toBe('ok');
    expect(resultB).toBe('ok');
    expect(fnA).toHaveBeenCalledTimes(2);
    expect(fnB).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledTimes(2);
  });
});
