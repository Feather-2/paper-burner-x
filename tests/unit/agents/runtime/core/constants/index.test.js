import { describe, it, expect, vi, beforeEach } from 'vitest';

const INDEX_MODULE = '../../../../../../js/agents/runtime/core/constants/index.js';

const mocks = vi.hoisted(() => ({
  timeouts: {
    TIMEOUTS: {},
    getTimeout: vi.fn(),
  },
  limits: {
    LIMITS: {},
    getLimit: vi.fn(),
  },
  thresholds: {
    THRESHOLDS: {},
    getThreshold: vi.fn(),
  },
}));

vi.mock('../../../../../../js/agents/runtime/core/constants/timeouts.js', () => ({
  TIMEOUTS: mocks.timeouts.TIMEOUTS,
  getTimeout: mocks.timeouts.getTimeout,
}));

vi.mock('../../../../../../js/agents/runtime/core/constants/limits.js', () => ({
  LIMITS: mocks.limits.LIMITS,
  getLimit: mocks.limits.getLimit,
}));

vi.mock('../../../../../../js/agents/runtime/core/constants/thresholds.js', () => ({
  THRESHOLDS: mocks.thresholds.THRESHOLDS,
  getThreshold: mocks.thresholds.getThreshold,
}));

const BASE_TIMEOUTS = { DEFAULT: 1000, CONNECT: 5000 };
const BASE_LIMITS = { MAX_USERS: 10, MAX_RETRIES: 3 };
const BASE_THRESHOLDS = { WARN: 0.75, FAIL: 0.9 };

async function importIndex() {
  return import(INDEX_MODULE);
}

function createDeepNestedObject(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  mocks.timeouts.TIMEOUTS = { ...BASE_TIMEOUTS };
  mocks.limits.LIMITS = { ...BASE_LIMITS };
  mocks.thresholds.THRESHOLDS = { ...BASE_THRESHOLDS };

  mocks.timeouts.getTimeout.mockImplementation((key) => ({ kind: 'timeout', key }));
  mocks.limits.getLimit.mockImplementation((key) => ({ kind: 'limit', key }));
  mocks.thresholds.getThreshold.mockImplementation((key) => ({ kind: 'threshold', key }));
});

describe('TIMEOUTS', () => {
  it('re-exports TIMEOUTS by reference', async () => {
    const { TIMEOUTS } = await importIndex();
    expect(TIMEOUTS).toBe(mocks.timeouts.TIMEOUTS);
    expect(TIMEOUTS).toEqual(BASE_TIMEOUTS);
  });

  it('boundary: allows TIMEOUTS to be null', async () => {
    mocks.timeouts.TIMEOUTS = null;
    const { TIMEOUTS } = await importIndex();
    expect(TIMEOUTS).toBeNull();
  });
});

describe('getTimeout', () => {
  it('re-exports getTimeout by reference', async () => {
    const { getTimeout } = await importIndex();
    expect(getTimeout).toBe(mocks.timeouts.getTimeout);
  });

  it('normal path: forwards args and returns the dependency result', async () => {
    const { getTimeout } = await importIndex();

    const result = getTimeout('CONNECT');
    expect(result).toEqual({ kind: 'timeout', key: 'CONNECT' });
    expect(mocks.timeouts.getTimeout).toHaveBeenCalledTimes(1);
    expect(mocks.timeouts.getTimeout).toHaveBeenCalledWith('CONNECT');
  });

  it('boundaries: forwards null/undefined/empty/whitespace', async () => {
    const { getTimeout } = await importIndex();

    const inputs = [null, undefined, '', '   '];
    for (const input of inputs) {
      const result = getTimeout(input);
      expect(result.kind).toBe('timeout');
      expect(result.key).toBe(input);
    }

    expect(mocks.timeouts.getTimeout).toHaveBeenCalledTimes(inputs.length);
    inputs.forEach((input, idx) => {
      expect(mocks.timeouts.getTimeout).toHaveBeenNthCalledWith(idx + 1, input);
    });
  });

  it('error handling: bubbles up dependency exceptions', async () => {
    mocks.timeouts.getTimeout.mockImplementation(() => {
      throw new Error('boom');
    });

    const { getTimeout } = await importIndex();
    expect(() => getTimeout('CONNECT')).toThrow('boom');
  });

  it('concurrency boundary: supports simultaneous calls', async () => {
    const { getTimeout } = await importIndex();

    await Promise.all(
      Array.from({ length: 25 }, () => Promise.resolve().then(() => getTimeout('DEFAULT'))),
    );

    expect(mocks.timeouts.getTimeout).toHaveBeenCalledTimes(25);
  });
});

describe('LIMITS', () => {
  it('re-exports LIMITS by reference', async () => {
    const { LIMITS } = await importIndex();
    expect(LIMITS).toBe(mocks.limits.LIMITS);
    expect(LIMITS).toEqual(BASE_LIMITS);
  });

  it('boundary: allows LIMITS to be an empty object', async () => {
    mocks.limits.LIMITS = {};
    const { LIMITS } = await importIndex();
    expect(LIMITS).toBe(mocks.limits.LIMITS);
    expect(LIMITS).toEqual({});
  });
});

describe('getLimit', () => {
  it('re-exports getLimit by reference', async () => {
    const { getLimit } = await importIndex();
    expect(getLimit).toBe(mocks.limits.getLimit);
  });

  it('normal path: forwards args and returns the dependency result', async () => {
    const { getLimit } = await importIndex();

    const result = getLimit('MAX_USERS');
    expect(result).toEqual({ kind: 'limit', key: 'MAX_USERS' });
    expect(mocks.limits.getLimit).toHaveBeenCalledWith('MAX_USERS');
  });

  it('boundaries: forwards 0/-1/MAX_SAFE_INTEGER and type-edge inputs', async () => {
    const { getLimit } = await importIndex();

    const emptyArray = [];
    const emptyObject = {};
    const objectAsArray = { 0: 'x', length: 1 };

    const inputs = [
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '0',
      emptyArray,
      emptyObject,
      objectAsArray,
    ];

    for (const input of inputs) {
      const result = getLimit(input);
      expect(result.kind).toBe('limit');
      expect(result.key).toBe(input);
    }

    expect(mocks.limits.getLimit).toHaveBeenCalledTimes(inputs.length);
    inputs.forEach((input, idx) => {
      expect(mocks.limits.getLimit).toHaveBeenNthCalledWith(idx + 1, input);
    });
  });

  it('error handling: bubbles up dependency exceptions', async () => {
    mocks.limits.getLimit.mockImplementation(() => {
      throw new RangeError('invalid limit');
    });

    const { getLimit } = await importIndex();
    expect(() => getLimit('MAX_USERS')).toThrow(RangeError);
    expect(() => getLimit('MAX_USERS')).toThrow('invalid limit');
  });

  it('concurrency boundary: supports rapid consecutive calls', async () => {
    const { getLimit } = await importIndex();

    for (let i = 0; i < 100; i += 1) {
      getLimit('MAX_RETRIES');
    }

    expect(mocks.limits.getLimit).toHaveBeenCalledTimes(100);
  });
});

describe('THRESHOLDS', () => {
  it('re-exports THRESHOLDS by reference', async () => {
    const { THRESHOLDS } = await importIndex();
    expect(THRESHOLDS).toBe(mocks.thresholds.THRESHOLDS);
    expect(THRESHOLDS).toEqual(BASE_THRESHOLDS);
  });

  it('boundary: allows THRESHOLDS to be undefined', async () => {
    mocks.thresholds.THRESHOLDS = undefined;
    const { THRESHOLDS } = await importIndex();
    expect(THRESHOLDS).toBeUndefined();
  });
});

describe('getThreshold', () => {
  it('re-exports getThreshold by reference', async () => {
    const { getThreshold } = await importIndex();
    expect(getThreshold).toBe(mocks.thresholds.getThreshold);
  });

  it('normal path: forwards args and returns the dependency result', async () => {
    const { getThreshold } = await importIndex();

    const result = getThreshold('WARN');
    expect(result).toEqual({ kind: 'threshold', key: 'WARN' });
    expect(mocks.thresholds.getThreshold).toHaveBeenCalledWith('WARN');
  });

  it('boundaries: forwards numeric strings, empty containers, and deep nesting', async () => {
    const { getThreshold } = await importIndex();

    const emptyArray = [];
    const emptyObject = {};
    const deepNested = createDeepNestedObject(150);

    const inputs = ['0.75', emptyArray, emptyObject, deepNested];
    for (const input of inputs) {
      const result = getThreshold(input);
      expect(result.kind).toBe('threshold');
      expect(result.key).toBe(input);
    }

    expect(mocks.thresholds.getThreshold).toHaveBeenCalledTimes(inputs.length);
  });

  it('resource boundaries: forwards very large strings (simulated large file)', async () => {
    const { getThreshold } = await importIndex();

    const bigPayload = 'x'.repeat(2_000_000);
    const result = getThreshold(bigPayload);

    expect(result.kind).toBe('threshold');
    expect(result.key).toBe(bigPayload);
    expect(mocks.thresholds.getThreshold).toHaveBeenCalledWith(bigPayload);
  });

  it('error handling: bubbles up dependency exceptions', async () => {
    mocks.thresholds.getThreshold.mockImplementation(() => {
      throw new TypeError('bad threshold key');
    });

    const { getThreshold } = await importIndex();
    expect(() => getThreshold('WARN')).toThrow(TypeError);
    expect(() => getThreshold('WARN')).toThrow('bad threshold key');
  });
});