import { describe, it, expect, vi, beforeEach } from 'vitest';

const valueUtilsMocks = vi.hoisted(() => {
  const toNonEmptyStringImpl = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };

  return {
    toNonEmptyStringImpl,
    toNonEmptyString: vi.fn(toNonEmptyStringImpl),
  };
});

vi.mock('../../../../../js/agents/shared/utils/value-utils.js', () => ({
  toNonEmptyString: valueUtilsMocks.toNonEmptyString,
}));

import {
  classifyDeepSearchError,
  isNonRecoverableDeepSearchError,
  toDeepSearchErrorMessage,
  classifyDesignError,
  isNonRetryableError,
} from '../../../../../js/agents/shared/utils/error-classifier.js';

const makeError = (message, props = {}) => {
  const err = new Error(message);
  Object.assign(err, props);
  return err;
};

const makeDeepNestedObject = () => {
  let root = { level: 0 };
  let current = root;
  for (let i = 1; i <= 25; i += 1) {
    const next = { level: i };
    current.child = next;
    current = next;
  }
  return root;
};

const makeBasicBoundaryCases = () => [
  { name: 'null', value: null },
  { name: 'undefined', value: undefined },
  { name: 'empty string', value: '' },
  { name: 'whitespace string', value: '   ' },
  { name: 'empty array', value: [] },
  { name: 'empty object', value: {} },
  { name: 'zero', value: 0 },
  { name: 'negative one', value: -1 },
  { name: 'max safe integer', value: Number.MAX_SAFE_INTEGER },
  { name: 'string number', value: '123' },
  { name: 'array-like object', value: { 0: 'a', length: 1 } },
];

const makeCauseChain = (messages) => {
  const root = makeError(messages[0]);
  let current = root;
  for (let i = 1; i < messages.length; i += 1) {
    const next = makeError(messages[i]);
    current.cause = next;
    current = next;
  }
  return root;
};

beforeEach(() => {
  valueUtilsMocks.toNonEmptyString.mockReset();
  valueUtilsMocks.toNonEmptyString.mockImplementation(valueUtilsMocks.toNonEmptyStringImpl);
});

describe('classifyDeepSearchError', () => {
  it('classifies config errors from normalized message patterns', () => {
    const err = makeError('  No    Model   Available  ');

    const result = classifyDeepSearchError(err);

    expect(result).toMatchObject({
      recoverable: false,
      category: 'config',
      statusCode: null,
      code: null,
    });
    expect(result.message).toBe('No    Model   Available');
  });

  it('classifies system errors from ENOSPC codes', () => {
    const err = makeError('disk full', { code: 'ENOSPC' });

    const result = classifyDeepSearchError(err);

    expect(result).toMatchObject({
      recoverable: false,
      category: 'system',
      statusCode: null,
      code: 'ENOSPC',
    });
    expect(valueUtilsMocks.toNonEmptyString).toHaveBeenCalledWith('ENOSPC');
  });

  it('classifies auth errors from nested response status codes', () => {
    const err = { response: { statusCode: '401' } };

    const result = classifyDeepSearchError(err);

    expect(result).toMatchObject({
      recoverable: false,
      category: 'auth',
      statusCode: 401,
    });
  });

  it('classifies auth errors from message patterns', () => {
    const err = makeError('Invalid API Key provided');

    const result = classifyDeepSearchError(err);

    expect(result.recoverable).toBe(false);
    expect(result.category).toBe('auth');
  });

  it('classifies quota errors from message patterns', () => {
    const err = makeError('Billing issue: payment required');

    const result = classifyDeepSearchError(err);

    expect(result.recoverable).toBe(false);
    expect(result.category).toBe('quota');
  });

  it('classifies rate limit errors from string status values', () => {
    const err = makeError('Too many requests', { status: '429.9' });

    const result = classifyDeepSearchError(err);

    expect(result.statusCode).toBe(429);
    expect(result.category).toBe('rate_limit');
  });

  it('classifies timeout errors from 408 status codes', () => {
    const err = makeError('Request timed out', { status: 408 });

    const result = classifyDeepSearchError(err);

    expect(result.category).toBe('timeout');
    expect(result.recoverable).toBe(true);
    expect(result.statusCode).toBe(408);
  });

  it('classifies server errors from 5xx status in the cause chain', () => {
    const err = makeError('upstream failed', {
      cause: makeError('service unavailable', { status: 503 }),
    });

    const result = classifyDeepSearchError(err);

    expect(result.category).toBe('server');
    expect(result.recoverable).toBe(true);
    expect(result.statusCode).toBe(503);
  });

  it('classifies network errors from error codes in the cause chain', () => {
    const err = makeError('connect failed', { code: '   ' });
    err.cause = makeError('reset', { code: 'ECONNRESET' });

    const result = classifyDeepSearchError(err);

    expect(result.category).toBe('network');
    expect(result.recoverable).toBe(true);
    expect(result.code).toBe('ECONNRESET');
  });

  it('classifies invalid requests from 4xx status codes', () => {
    const err = makeError('bad request', { status: 400 });

    const result = classifyDeepSearchError(err);

    expect(result.category).toBe('invalid_request');
    expect(result.recoverable).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it('returns unknown when no signals match', () => {
    const err = makeError('all good', { status: 200 });

    const result = classifyDeepSearchError(err);

    expect(result.category).toBe('unknown');
    expect(result.recoverable).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('builds message from cause chain and uses Unknown error for empty messages', () => {
    const err = makeError('', { cause: makeError('root cause') });

    const result = classifyDeepSearchError(err);

    expect(result.message).toBe('Unknown error | root cause');
  });

  it('limits the cause chain depth to 8 entries', () => {
    const messages = Array.from({ length: 10 }, (_, i) => `e${i}`);
    const err = makeCauseChain(messages);

    const result = classifyDeepSearchError(err);

    expect(result.message.split(' | ')).toEqual(messages.slice(0, 8));
  });

  it('avoids infinite loops on cyclic causes', () => {
    const err = makeError('cycle');
    err.cause = err;

    const result = classifyDeepSearchError(err);

    expect(result.message.split(' | ')).toEqual(['cycle']);
  });

  it.each(makeBasicBoundaryCases())('handles boundary input: $name', ({ value }) => {
    const result = classifyDeepSearchError(value);

    expect(result).toMatchObject({
      recoverable: true,
      category: 'unknown',
      statusCode: null,
      code: null,
    });
    expect(typeof result.message).toBe('string');
  });

  it('handles long string input', () => {
    const longMessage = 'x'.repeat(10000);

    const result = classifyDeepSearchError(longMessage);

    expect(result.category).toBe('unknown');
    expect(result.message.length).toBe(longMessage.length);
  });

  it('handles huge file input', () => {
    const file = new Uint8Array(1024 * 1024 * 2);

    const result = classifyDeepSearchError(file);

    expect(result.category).toBe('unknown');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('handles deep nested object input', () => {
    const obj = makeDeepNestedObject();

    const result = classifyDeepSearchError(obj);

    expect(result.category).toBe('unknown');
    expect(result.message).toBe('[object Object]');
  });

  it('handles simultaneous calls', async () => {
    const inputs = [
      makeError('rate limit'),
      makeError('no model available'),
      makeError('server error', { status: 503 }),
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => classifyDeepSearchError(input)))
    );

    expect(results.map((result) => result.category)).toEqual([
      'rate_limit',
      'config',
      'server',
    ]);
  });

  it('handles rapid successive calls', () => {
    const inputs = [
      makeError('invalid api key'),
      makeError('billing issue'),
      makeError('request timed out', { status: 408 }),
      makeError('misc'),
    ];

    const categories = inputs.map((input) => classifyDeepSearchError(input).category);

    expect(categories).toEqual(['auth', 'quota', 'timeout', 'unknown']);
  });
});

describe('isNonRecoverableDeepSearchError', () => {
  it('returns true for non-recoverable classifications', () => {
    const err = makeError('invalid api key');

    expect(isNonRecoverableDeepSearchError(err)).toBe(true);
  });

  it('returns false for recoverable classifications', () => {
    const err = makeError('rate limit');

    expect(isNonRecoverableDeepSearchError(err)).toBe(false);
  });

  it('returns false for nullish input', () => {
    expect(isNonRecoverableDeepSearchError(null)).toBe(false);
    expect(isNonRecoverableDeepSearchError(undefined)).toBe(false);
  });
});

describe('toDeepSearchErrorMessage', () => {
  it('returns the composed classification message', () => {
    const err = makeError('top', { cause: makeError('root') });

    expect(toDeepSearchErrorMessage(err)).toBe('top | root');
  });

  it('returns empty string for empty input', () => {
    expect(toDeepSearchErrorMessage('')).toBe('');
  });
});

describe('classifyDesignError', () => {
  it('classifies auth errors', () => {
    const result = classifyDesignError(new Error('Invalid API Key'));

    expect(result).toEqual({ kind: 'auth', code: 'AUTH', canRetry: false });
  });

  it('classifies config errors', () => {
    const result = classifyDesignError(new Error('No available model config'));

    expect(result).toEqual({ kind: 'config', code: 'CONFIG', canRetry: false });
  });

  it('classifies rate limit errors', () => {
    const result = classifyDesignError(new Error('429 Too many requests'));

    expect(result).toEqual({ kind: 'rate_limit', code: 'RATE_LIMIT', canRetry: true });
  });

  it('classifies timeout errors', () => {
    const result = classifyDesignError(new Error('ETIMEDOUT while waiting'));

    expect(result).toEqual({ kind: 'timeout', code: 'TIMEOUT', canRetry: true });
  });

  it('classifies network errors', () => {
    const result = classifyDesignError(new Error('502 Bad Gateway'));

    expect(result).toEqual({ kind: 'network', code: 'NETWORK', canRetry: true });
  });

  it('defaults to unknown for unmatched errors', () => {
    const result = classifyDesignError(new Error('Something else'));

    expect(result).toEqual({ kind: 'unknown', code: 'UNKNOWN', canRetry: false });
  });
});

describe('isNonRetryableError', () => {
  it('returns true for auth errors', () => {
    const err = new Error('Invalid API Key');

    expect(isNonRetryableError(err)).toBe(true);
  });

  it('returns true for config errors', () => {
    const err = new Error('No available model config');

    expect(isNonRetryableError(err)).toBe(true);
  });

  it('returns false for retryable errors', () => {
    const err = new Error('Too many requests');

    expect(isNonRetryableError(err)).toBe(false);
  });
});
