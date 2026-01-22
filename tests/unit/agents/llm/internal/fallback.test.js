import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/llm/internal/fallback.js';
const SHARED_MODULE_PATH = '../../../../../js/agents/shared/index.js';

vi.mock('../../../../../js/agents/shared/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

const makeDeepObject = (depth) => {
  let obj = { leaf: true };
  for (let i = 0; i < depth; i += 1) {
    obj = { nested: obj };
  }
  return obj;
};

const makeTime = (...values) => {
  const timeline = values.length ? values : [0];
  let index = 0;
  return {
    now: vi.fn(() => timeline[Math.min(index++, timeline.length - 1)]),
    sleep: vi.fn(),
  };
};

let toErrorInfo;
let extractHttpStatus;
let isPermanentAuthError;
let computeCooldownMs;
let markUnhealthy;
let disableModel;
let markHealthy;
let resetUnhealthy;
let getShortestCooldown;
let toNonEmptyString;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  ({
    toErrorInfo,
    extractHttpStatus,
    isPermanentAuthError,
    computeCooldownMs,
    markUnhealthy,
    disableModel,
    markHealthy,
    resetUnhealthy,
    getShortestCooldown,
  } = await import(MODULE_PATH));
  ({ toNonEmptyString } = await import(SHARED_MODULE_PATH));
});

describe('toErrorInfo', () => {
  it('returns name and message for Error instances', () => {
    const err = new TypeError('bad input');

    expect(toErrorInfo(err)).toEqual({ name: 'TypeError', message: 'bad input' });
  });

  it('stringifies non-Error values including boundary and resource cases', () => {
    const hugeText = 'x'.repeat(10000);
    const deepObject = makeDeepObject(40);
    deepObject.toString = () => 'deep-nested';
    const arrayLike = { 0: 'x', length: 1, toString: () => 'array-like' };

    const cases = [
      { input: null, message: 'null' },
      { input: undefined, message: 'undefined' },
      { input: '', message: '' },
      { input: '   ', message: '   ' },
      { input: [], message: '' },
      { input: {}, message: '[object Object]' },
      { input: arrayLike, message: 'array-like' },
      { input: 0, message: '0' },
      { input: -1, message: '-1' },
      { input: Number.MAX_SAFE_INTEGER, message: String(Number.MAX_SAFE_INTEGER) },
      { input: hugeText, message: hugeText },
      { input: deepObject, message: 'deep-nested' },
    ];

    cases.forEach(({ input, message }) => {
      const result = toErrorInfo(input);
      expect(result.name).toBe('Error');
      expect(result.message).toBe(message);
    });
  });
});

describe('extractHttpStatus', () => {
  it('returns null for non-object and empty inputs', () => {
    const inputs = [null, undefined, '', 0, false, [], {}];

    inputs.forEach((input) => {
      expect(extractHttpStatus(input)).toBeNull();
    });
  });

  it('extracts direct status values with precedence', () => {
    expect(extractHttpStatus({ status: 429 })).toBe(429);
    expect(extractHttpStatus({ statusCode: 500 })).toBe(500);
    expect(extractHttpStatus({ httpStatus: 503 })).toBe(503);
    expect(extractHttpStatus({ status: 400, response: { status: 401 } })).toBe(400);
  });

  it('falls back to nested response status and ignores non-numeric values', () => {
    expect(extractHttpStatus({ response: { status: 418 } })).toBe(418);
    expect(extractHttpStatus({ status: '401', response: { status: 402 } })).toBe(402);
    expect(extractHttpStatus({ status: Number.NaN, response: { statusCode: 403 } })).toBe(403);
    expect(extractHttpStatus({ status: Infinity, response: { statusCode: '404' } })).toBeNull();
  });
});

describe('isPermanentAuthError', () => {
  it('returns true for permanent auth status codes', () => {
    expect(isPermanentAuthError({ status: 401 })).toBe(true);
    expect(isPermanentAuthError({ response: { status: 403 } })).toBe(true);
  });

  it('matches auth-related error messages', () => {
    const messages = [
      'Invalid API key',
      'Unauthorized request',
      'forbidden access',
      'api key invalid',
      'Authentication failed',
      'HTTP 401',
      'Error 403: forbidden',
    ];

    messages.forEach((message) => {
      expect(isPermanentAuthError(new Error(message))).toBe(true);
    });
  });

  it('returns false for unrelated or empty errors', () => {
    expect(isPermanentAuthError(new Error('server error'))).toBe(false);
    expect(isPermanentAuthError('')).toBe(false);
    expect(isPermanentAuthError({ status: 500 })).toBe(false);
  });
});

describe('computeCooldownMs', () => {
  it('computes exponential backoff and clamps to max', () => {
    const ms = computeCooldownMs({
      backoffLevel: 2,
      baseCooldownMs: 100,
      maxCooldownMs: 500,
      backoffMultiplier: 3,
    });

    expect(ms).toBe(500);
  });

  it('normalizes backoffLevel to a non-negative integer', () => {
    expect(
      computeCooldownMs({
        backoffLevel: 1.9,
        baseCooldownMs: 100,
        maxCooldownMs: 1000,
        backoffMultiplier: 2,
      })
    ).toBe(200);

    expect(
      computeCooldownMs({
        backoffLevel: -1,
        baseCooldownMs: 100,
        maxCooldownMs: 1000,
        backoffMultiplier: 2,
      })
    ).toBe(100);
  });

  it('falls back to max for non-positive or non-finite results', () => {
    expect(
      computeCooldownMs({
        backoffLevel: 1,
        baseCooldownMs: 0,
        maxCooldownMs: 500,
        backoffMultiplier: 2,
      })
    ).toBe(500);

    expect(
      computeCooldownMs({
        backoffLevel: 3,
        baseCooldownMs: -10,
        maxCooldownMs: 500,
        backoffMultiplier: 2,
      })
    ).toBe(500);

    expect(
      computeCooldownMs({
        backoffLevel: 10,
        baseCooldownMs: 100,
        maxCooldownMs: 500,
        backoffMultiplier: Infinity,
      })
    ).toBe(500);
  });

  it('handles string backoffLevel and large values', () => {
    expect(
      computeCooldownMs({
        backoffLevel: '2',
        baseCooldownMs: 150,
        maxCooldownMs: 1000,
        backoffMultiplier: 2,
      })
    ).toBe(150);

    expect(
      computeCooldownMs({
        backoffLevel: 1,
        baseCooldownMs: Number.MAX_SAFE_INTEGER,
        maxCooldownMs: Number.MAX_SAFE_INTEGER,
        backoffMultiplier: 2,
      })
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('markUnhealthy', () => {
  const baseParams = { baseCooldownMs: 100, maxCooldownMs: 1000, backoffMultiplier: 2 };

  it('returns null for invalid modelId inputs', () => {
    const healthMap = new Map();
    const time = makeTime(1000);
    const inputs = [null, undefined, '', '   ', []];

    inputs.forEach((modelId) => {
      const result = markUnhealthy({
        healthMap,
        time,
        modelId,
        error: new Error('boom'),
        ...baseParams,
      });
      expect(result).toBeNull();
    });

    expect(healthMap.size).toBe(0);
  });

  it('records failures and cooldown for valid models', () => {
    const healthMap = new Map();
    const time = makeTime(1000);
    const result = markUnhealthy({
      healthMap,
      time,
      modelId: 'model-a',
      error: new Error('boom'),
      ...baseParams,
    });

    expect(result).toEqual({
      failures: 1,
      unhealthyUntilMs: 1100,
      lastError: { name: 'Error', message: 'boom' },
      cooldownMs: 100,
      backoffLevel: 0,
    });
    expect(healthMap.get('model-a')).toEqual({
      failures: 1,
      unhealthyUntilMs: 1100,
      lastError: { name: 'Error', message: 'boom' },
    });
    expect(toNonEmptyString).toHaveBeenCalledWith('model-a');
  });

  it('returns existing state when model is disabled', () => {
    const healthMap = new Map();
    const prev = {
      failures: 2,
      unhealthyUntilMs: 0,
      lastError: { name: 'Error', message: 'prev' },
      disabled: true,
    };
    healthMap.set('model-b', prev);
    const time = makeTime(500);

    const result = markUnhealthy({
      healthMap,
      time,
      modelId: 'model-b',
      error: 'oops',
      ...baseParams,
    });

    expect(result).toEqual({ ...prev, cooldownMs: null, backoffLevel: null });
    expect(healthMap.get('model-b')).toBe(prev);
  });

  it('normalizes invalid previous failures', () => {
    const healthMap = new Map();
    healthMap.set('model-c', { failures: -5, unhealthyUntilMs: 0 });
    healthMap.set('model-d', { failures: 'nope', unhealthyUntilMs: 0 });
    const time = makeTime(0, 0);

    const resultA = markUnhealthy({
      healthMap,
      time,
      modelId: 'model-c',
      error: 'err',
      ...baseParams,
    });
    const resultB = markUnhealthy({
      healthMap,
      time,
      modelId: 'model-d',
      error: 'err',
      ...baseParams,
    });

    expect(resultA.backoffLevel).toBe(0);
    expect(resultA.failures).toBe(1);
    expect(resultB.backoffLevel).toBe(0);
    expect(resultB.failures).toBe(1);
  });

  it('handles rapid consecutive calls for the same model', () => {
    const healthMap = new Map();
    const time = makeTime(1000, 1000, 1000);

    const first = markUnhealthy({
      healthMap,
      time,
      modelId: 'model-rapid',
      error: 'boom',
      ...baseParams,
    });
    const second = markUnhealthy({
      healthMap,
      time,
      modelId: 'model-rapid',
      error: 'boom2',
      ...baseParams,
    });

    expect(first.failures).toBe(1);
    expect(second.failures).toBe(2);
    expect(second.backoffLevel).toBe(1);
    expect(second.cooldownMs).toBe(200);
  });

  it('handles simultaneous calls for different models', async () => {
    const healthMap = new Map();
    const time = makeTime(2000);
    const input = {
      healthMap,
      time,
      error: 'boom',
      ...baseParams,
    };

    await Promise.all([
      Promise.resolve().then(() => markUnhealthy({ ...input, modelId: 'm1' })),
      Promise.resolve().then(() => markUnhealthy({ ...input, modelId: 'm2' })),
    ]);

    expect(healthMap.size).toBe(2);
    expect(healthMap.get('m1').failures).toBe(1);
    expect(healthMap.get('m2').failures).toBe(1);
  });
});

describe('disableModel', () => {
  it('returns null for invalid modelId inputs', () => {
    const healthMap = new Map();
    const inputs = [null, undefined, '', '   ', []];

    inputs.forEach((modelId) => {
      const result = disableModel({ healthMap, modelId, error: 'x' });
      expect(result).toBeNull();
    });

    expect(disableModel()).toBeNull();
    expect(healthMap.size).toBe(0);
  });

  it('disables the model and sets a reason', () => {
    const healthMap = new Map([
      [
        'm1',
        {
          failures: 2,
          unhealthyUntilMs: 500,
          lastError: { name: 'Error', message: 'prev' },
        },
      ],
    ]);

    const result = disableModel({
      healthMap,
      modelId: 'm1',
      error: new Error('down'),
      reason: 'maintenance',
    });

    expect(result.failures).toBe(3);
    expect(result.disabled).toBe(true);
    expect(result.disabledReason).toBe('maintenance');
    expect(result.unhealthyUntilMs).toBe(0);
    expect(result.lastError).toEqual({ name: 'Error', message: 'down' });
    expect(healthMap.get('m1')).toEqual(result);
    expect(toNonEmptyString).toHaveBeenCalledWith('m1');
    expect(toNonEmptyString).toHaveBeenCalledWith('maintenance');
  });

  it('omits disabledReason when reason is empty', () => {
    const healthMap = new Map();

    const result = disableModel({
      healthMap,
      modelId: 'm2',
      error: 'x',
      reason: '   ',
    });

    expect(result.disabled).toBe(true);
    expect(result.disabledReason).toBeUndefined();
  });

  it('handles non-numeric failures and huge error payloads', () => {
    const healthMap = new Map([['big', { failures: 'nope', unhealthyUntilMs: 12 }]]);
    const hugeFileMessage = `file too large: ${Number.MAX_SAFE_INTEGER} bytes - ${'x'.repeat(10000)}`;

    const result = disableModel({
      healthMap,
      modelId: 'big',
      error: new Error(hugeFileMessage),
    });

    expect(result.failures).toBe(1);
    expect(result.lastError.message).toBe(hugeFileMessage);
    expect(result.lastError.message.length).toBe(hugeFileMessage.length);
  });

  it('handles rapid consecutive disable calls', () => {
    const healthMap = new Map();

    const first = disableModel({ healthMap, modelId: 'm3', error: 'err1' });
    const second = disableModel({ healthMap, modelId: 'm3', error: 'err2' });

    expect(first.failures).toBe(1);
    expect(second.failures).toBe(2);
    expect(healthMap.get('m3').lastError.message).toBe('err2');
  });
});

describe('markHealthy', () => {
  it('returns null for invalid ids or missing entries', () => {
    const healthMap = new Map();
    const inputs = [null, undefined, '', '   ', []];

    inputs.forEach((modelId) => {
      expect(markHealthy({ healthMap, modelId })).toBeNull();
    });

    healthMap.set('m1', { failures: 1, unhealthyUntilMs: 10 });
    expect(markHealthy({ healthMap, modelId: 'missing' })).toBeNull();
  });

  it('resets failures and unhealthyUntilMs and clears disabled flags', () => {
    const healthMap = new Map([
      [
        'm1',
        {
          failures: 3,
          unhealthyUntilMs: 999,
          lastError: { name: 'Error', message: 'boom' },
          disabled: true,
          disabledReason: 'bad',
        },
      ],
    ]);

    const result = markHealthy({ healthMap, modelId: 'm1' });

    expect(result.failures).toBe(0);
    expect(result.unhealthyUntilMs).toBe(0);
    expect(result.disabled).toBe(false);
    expect(result.disabledReason).toBeUndefined();
    expect(healthMap.get('m1')).toEqual(result);
  });
});

describe('resetUnhealthy', () => {
  it('returns null for invalid ids or missing entries', () => {
    const healthMap = new Map();
    const inputs = [null, undefined, '', '   ', []];

    inputs.forEach((modelId) => {
      expect(resetUnhealthy({ healthMap, modelId })).toBeNull();
    });

    healthMap.set('m1', { failures: 1, unhealthyUntilMs: 10 });
    expect(resetUnhealthy({ healthMap, modelId: 'missing' })).toBeNull();
  });

  it('clears unhealthyUntilMs while preserving failures and clearing disabled', () => {
    const healthMap = new Map([
      [
        'm1',
        {
          failures: 4,
          unhealthyUntilMs: 500,
          lastError: { name: 'Error', message: 'boom' },
          disabled: true,
          disabledReason: 'bad',
        },
      ],
    ]);

    const result = resetUnhealthy({ healthMap, modelId: 'm1' });

    expect(result.failures).toBe(4);
    expect(result.unhealthyUntilMs).toBe(0);
    expect(result.disabled).toBe(false);
    expect(result.disabledReason).toBeUndefined();
    expect(healthMap.get('m1')).toEqual(result);
  });
});

describe('getShortestCooldown', () => {
  it('returns null when there are no active cooldowns', () => {
    const healthMap = new Map([
      ['m1', { unhealthyUntilMs: 900 }],
      ['m2', { unhealthyUntilMs: 1000 }],
    ]);
    const time = makeTime(1000);

    expect(getShortestCooldown({ healthMap, time, candidates: [] })).toBeNull();
    expect(getShortestCooldown({ healthMap, time, candidates: ['m1', 'm2'] })).toBeNull();
  });

  it('returns the shortest remaining cooldown among candidates', () => {
    const healthMap = new Map([
      ['m1', { unhealthyUntilMs: 1500 }],
      ['m2', { unhealthyUntilMs: 1200 }],
      ['m3', { unhealthyUntilMs: 1100 }],
    ]);
    const time = makeTime(1000);

    const result = getShortestCooldown({ healthMap, time, candidates: ['m1', 'm2', 'm3'] });

    expect(result).toEqual({ modelId: 'm3', remainingMs: 100 });
  });

  it('supports iterable objects as candidates', () => {
    const healthMap = new Map([['m1', { unhealthyUntilMs: 1300 }]]);
    const time = makeTime(1000);
    const candidates = {
      [Symbol.iterator]: function* () {
        yield 'm1';
      },
    };

    const result = getShortestCooldown({ healthMap, time, candidates });

    expect(result).toEqual({ modelId: 'm1', remainingMs: 300 });
  });

  it('throws when candidates is a non-iterable object (type boundary)', () => {
    const healthMap = new Map([['m1', { unhealthyUntilMs: 1300 }]]);
    const time = makeTime(1000);
    const candidates = { 0: 'm1', length: 1 };

    expect(() => getShortestCooldown({ healthMap, time, candidates })).toThrow(TypeError);
  });
});
