import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedMocks = vi.hoisted(() => ({
  classifyDesignError: vi.fn(),
  isNonRetryableError: vi.fn(),
}));

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  classifyDesignError: sharedMocks.classifyDesignError,
  isNonRetryableError: sharedMocks.isNonRetryableError,
}));

import {
  classifyDesignError,
  isNonRetryableError,
} from '../../../../../../js/agents/stages/design/shared/error-classifier.js';

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

const makeBoundaryCases = () => [
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
  { name: 'long string', value: 'x'.repeat(10000) },
  { name: 'huge file', value: new Uint8Array(1024 * 1024 * 2) },
  { name: 'deep nested object', value: makeDeepNestedObject() },
];

const makeDelegatingCases = () =>
  makeBoundaryCases().filter(
    ({ value }) => value !== null && value !== undefined && value !== '' && value !== 0
  );

const makeClassification = (code) => ({
  kind: 'unknown',
  code,
  canRetry: false,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('classifyDesignError', () => {
  it('returns the classification from the shared helper', () => {
    const input = { message: 'boom', status: 500 };
    const expected = makeClassification('classified');
    sharedMocks.classifyDesignError.mockReturnValue(expected);

    const result = classifyDesignError(input);

    expect(result).toBe(expected);
    expect(sharedMocks.classifyDesignError).toHaveBeenCalledWith(input);
  });

  it.each(makeBoundaryCases())('delegates boundary input: $name', ({ name, value }) => {
    const expected = makeClassification(`case:${name}`);
    sharedMocks.classifyDesignError.mockReturnValueOnce(expected);

    const result = classifyDesignError(value);

    expect(result).toBe(expected);
    expect(sharedMocks.classifyDesignError).toHaveBeenCalledTimes(1);
    expect(sharedMocks.classifyDesignError.mock.calls[0][0]).toBe(value);
  });

  it('propagates errors from the shared helper', () => {
    const error = new Error('boom');
    sharedMocks.classifyDesignError.mockImplementation(() => {
      throw error;
    });

    expect(() => classifyDesignError({})).toThrow(error);
  });

  it('handles simultaneous calls', async () => {
    const inputs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    sharedMocks.classifyDesignError.mockImplementation((value) =>
      makeClassification(`id:${value.id}`)
    );

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => classifyDesignError(input)))
    );

    expect(results.map((result) => result.code)).toEqual(['id:a', 'id:b', 'id:c']);
    expect(sharedMocks.classifyDesignError).toHaveBeenCalledTimes(inputs.length);
  });

  it('handles rapid successive calls', () => {
    const inputs = [0, 1, 2, 3];
    sharedMocks.classifyDesignError.mockImplementation((value) =>
      makeClassification(`value:${value}`)
    );

    const results = [];
    for (const input of inputs) {
      results.push(classifyDesignError(input));
    }

    expect(results.map((result) => result.code)).toEqual([
      'value:0',
      'value:1',
      'value:2',
      'value:3',
    ]);
    expect(sharedMocks.classifyDesignError).toHaveBeenCalledTimes(inputs.length);
  });
});

describe('isNonRetryableError', () => {
  it('returns true for non-retryable error instances', () => {
    const input = { message: 'stop', nonRetryable: true };
    sharedMocks.isNonRetryableError.mockReturnValue(false);

    const result = isNonRetryableError(input);

    expect(result).toBe(true);
    expect(sharedMocks.isNonRetryableError).not.toHaveBeenCalled();
  });

  it('returns false for falsy inputs without delegating', () => {
    expect(isNonRetryableError(null)).toBe(false);
    expect(isNonRetryableError(undefined)).toBe(false);
    expect(isNonRetryableError('')).toBe(false);
    expect(isNonRetryableError(0)).toBe(false);
    expect(sharedMocks.isNonRetryableError).not.toHaveBeenCalled();
  });

  it.each(makeDelegatingCases())('delegates boundary input: $name', ({ name, value }) => {
    const expected = name.length % 2 === 0;
    sharedMocks.isNonRetryableError.mockReturnValueOnce(expected);

    const result = isNonRetryableError(value);

    expect(result).toBe(expected);
    expect(sharedMocks.isNonRetryableError).toHaveBeenCalledTimes(1);
    expect(sharedMocks.isNonRetryableError.mock.calls[0][0]).toBe(value);
  });

  it('propagates errors from the shared helper', () => {
    const error = new Error('boom');
    sharedMocks.isNonRetryableError.mockImplementation(() => {
      throw error;
    });

    expect(() => isNonRetryableError('fail')).toThrow(error);
  });

  it('handles simultaneous calls', async () => {
    const inputs = [{ fatal: true }, { fatal: false }, { fatal: true }];
    sharedMocks.isNonRetryableError.mockImplementation((value) => Boolean(value && value.fatal));

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => isNonRetryableError(input)))
    );

    expect(results).toEqual([true, false, true]);
    expect(sharedMocks.isNonRetryableError).toHaveBeenCalledTimes(inputs.length);
  });

  it('handles rapid successive calls', () => {
    const inputs = ['stop', 'go', 'stop', 'pause'];
    sharedMocks.isNonRetryableError.mockImplementation((value) => value === 'stop');

    const results = inputs.map((input) => isNonRetryableError(input));

    expect(results).toEqual([true, false, true, false]);
    expect(sharedMocks.isNonRetryableError).toHaveBeenCalledTimes(inputs.length);
  });
});
