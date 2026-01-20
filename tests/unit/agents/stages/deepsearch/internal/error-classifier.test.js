import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedMocks = vi.hoisted(() => ({
  classifyDeepSearchError: vi.fn(),
  isNonRecoverableDeepSearchError: vi.fn(),
  toDeepSearchErrorMessage: vi.fn(),
}));

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  classifyDeepSearchError: sharedMocks.classifyDeepSearchError,
  isNonRecoverableDeepSearchError: sharedMocks.isNonRecoverableDeepSearchError,
  toDeepSearchErrorMessage: sharedMocks.toDeepSearchErrorMessage,
}));

import {
  classifyDeepSearchError,
  isNonRecoverableDeepSearchError,
  toDeepSearchErrorMessage,
} from '../../../../../../js/agents/stages/deepsearch/internal/error-classifier.js';

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

const makeClassification = (message) => ({
  recoverable: false,
  category: 'unknown',
  statusCode: null,
  code: null,
  message,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('classifyDeepSearchError', () => {
  it('returns the classification from the shared helper', () => {
    const input = { message: 'boom', status: 500 };
    const expected = makeClassification('classified');
    sharedMocks.classifyDeepSearchError.mockReturnValue(expected);

    const result = classifyDeepSearchError(input);

    expect(result).toBe(expected);
    expect(sharedMocks.classifyDeepSearchError).toHaveBeenCalledWith(input);
  });

  it.each(makeBoundaryCases())('delegates boundary input: $name', ({ name, value }) => {
    const expected = makeClassification(`case:${name}`);
    sharedMocks.classifyDeepSearchError.mockReturnValueOnce(expected);

    const result = classifyDeepSearchError(value);

    expect(result).toBe(expected);
    expect(sharedMocks.classifyDeepSearchError).toHaveBeenCalledTimes(1);
    expect(sharedMocks.classifyDeepSearchError.mock.calls[0][0]).toBe(value);
  });

  it('propagates errors from the shared helper', () => {
    const error = new Error('boom');
    sharedMocks.classifyDeepSearchError.mockImplementation(() => {
      throw error;
    });

    expect(() => classifyDeepSearchError({})).toThrow(error);
  });

  it('handles simultaneous calls', async () => {
    const inputs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    sharedMocks.classifyDeepSearchError.mockImplementation((value) =>
      makeClassification(`id:${value.id}`)
    );

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => classifyDeepSearchError(input)))
    );

    expect(results.map((result) => result.message)).toEqual(['id:a', 'id:b', 'id:c']);
    expect(sharedMocks.classifyDeepSearchError).toHaveBeenCalledTimes(inputs.length);
  });

  it('handles rapid successive calls', () => {
    const inputs = [0, 1, 2, 3];
    sharedMocks.classifyDeepSearchError.mockImplementation((value) =>
      makeClassification(`value:${value}`)
    );

    const results = [];
    for (const input of inputs) {
      results.push(classifyDeepSearchError(input));
    }

    expect(results.map((result) => result.message)).toEqual([
      'value:0',
      'value:1',
      'value:2',
      'value:3',
    ]);
    expect(sharedMocks.classifyDeepSearchError).toHaveBeenCalledTimes(inputs.length);
  });
});

describe('isNonRecoverableDeepSearchError', () => {
  it('returns the boolean from the shared helper', () => {
    const input = { status: 401 };
    sharedMocks.isNonRecoverableDeepSearchError.mockReturnValue(true);

    const result = isNonRecoverableDeepSearchError(input);

    expect(result).toBe(true);
    expect(sharedMocks.isNonRecoverableDeepSearchError).toHaveBeenCalledWith(input);
  });

  it.each(makeBoundaryCases())('delegates boundary input: $name', ({ name, value }) => {
    const expected = name.length % 2 === 0;
    sharedMocks.isNonRecoverableDeepSearchError.mockReturnValueOnce(expected);

    const result = isNonRecoverableDeepSearchError(value);

    expect(result).toBe(expected);
    expect(sharedMocks.isNonRecoverableDeepSearchError).toHaveBeenCalledTimes(1);
    expect(sharedMocks.isNonRecoverableDeepSearchError.mock.calls[0][0]).toBe(value);
  });

  it('propagates errors from the shared helper', () => {
    const error = new Error('boom');
    sharedMocks.isNonRecoverableDeepSearchError.mockImplementation(() => {
      throw error;
    });

    expect(() => isNonRecoverableDeepSearchError('fail')).toThrow(error);
  });

  it('handles simultaneous calls', async () => {
    const inputs = [{ fatal: true }, { fatal: false }, { fatal: true }];
    sharedMocks.isNonRecoverableDeepSearchError.mockImplementation((value) =>
      Boolean(value && value.fatal)
    );

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => isNonRecoverableDeepSearchError(input)))
    );

    expect(results).toEqual([true, false, true]);
    expect(sharedMocks.isNonRecoverableDeepSearchError).toHaveBeenCalledTimes(inputs.length);
  });

  it('handles rapid successive calls', () => {
    const inputs = ['stop', 'go', 'stop', 'pause'];
    sharedMocks.isNonRecoverableDeepSearchError.mockImplementation((value) => value === 'stop');

    const results = inputs.map((input) => isNonRecoverableDeepSearchError(input));

    expect(results).toEqual([true, false, true, false]);
    expect(sharedMocks.isNonRecoverableDeepSearchError).toHaveBeenCalledTimes(inputs.length);
  });
});

describe('toDeepSearchErrorMessage', () => {
  it('returns the message from the shared helper', () => {
    const input = { message: 'bad request' };
    sharedMocks.toDeepSearchErrorMessage.mockReturnValue('user message');

    const result = toDeepSearchErrorMessage(input);

    expect(result).toBe('user message');
    expect(sharedMocks.toDeepSearchErrorMessage).toHaveBeenCalledWith(input);
  });

  it.each(makeBoundaryCases())('delegates boundary input: $name', ({ name, value }) => {
    const expected = `message:${name}`;
    sharedMocks.toDeepSearchErrorMessage.mockReturnValueOnce(expected);

    const result = toDeepSearchErrorMessage(value);

    expect(result).toBe(expected);
    expect(sharedMocks.toDeepSearchErrorMessage).toHaveBeenCalledTimes(1);
    expect(sharedMocks.toDeepSearchErrorMessage.mock.calls[0][0]).toBe(value);
  });

  it('propagates errors from the shared helper', () => {
    const error = new Error('boom');
    sharedMocks.toDeepSearchErrorMessage.mockImplementation(() => {
      throw error;
    });

    expect(() => toDeepSearchErrorMessage({})).toThrow(error);
  });

  it('handles simultaneous calls', async () => {
    const inputs = [{ code: 'a' }, { code: 'b' }, { code: 'c' }];
    sharedMocks.toDeepSearchErrorMessage.mockImplementation((value) => `code:${value.code}`);

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => toDeepSearchErrorMessage(input)))
    );

    expect(results).toEqual(['code:a', 'code:b', 'code:c']);
    expect(sharedMocks.toDeepSearchErrorMessage).toHaveBeenCalledTimes(inputs.length);
  });

  it('handles rapid successive calls', () => {
    const inputs = ['a', 'b', 'c', 'd'];
    sharedMocks.toDeepSearchErrorMessage.mockImplementation((value) => `value:${value}`);

    const results = [];
    for (const input of inputs) {
      results.push(toDeepSearchErrorMessage(input));
    }

    expect(results).toEqual(['value:a', 'value:b', 'value:c', 'value:d']);
    expect(sharedMocks.toDeepSearchErrorMessage).toHaveBeenCalledTimes(inputs.length);
  });
});
