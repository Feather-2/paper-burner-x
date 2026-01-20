import { describe, it, expect, vi, beforeEach } from 'vitest';

let isValidEventName;
let isValidEventPattern;
let assertValidEventName;
let assertValidEventPattern;
let createEventId;
let matchPattern;
let randomUUID;

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid'),
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  ({ randomUUID } = await import('node:crypto'));
  ({
    isValidEventName,
    isValidEventPattern,
    assertValidEventName,
    assertValidEventPattern,
    createEventId,
    matchPattern,
  } = await import('../../../../js/agents/core/event-bus-utils.js'));
});

describe('isValidEventName', () => {
  it('accepts valid names', () => {
    const valid = [
      '*',
      'user',
      'user.login',
      'user:login',
      'user.profile:update',
      'a_b1.c2',
      '0',
      'a.b:c',
    ];

    for (const value of valid) {
      expect(isValidEventName(value)).toBe(true);
    }
  });

  it('rejects invalid types and empty values', () => {
    const arrayLike = { 0: 'a', length: 1 };
    const invalid = [
      null,
      undefined,
      '',
      '   ',
      '\t',
      [],
      {},
      arrayLike,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      new String('abc'),
    ];

    for (const value of invalid) {
      expect(isValidEventName(value)).toBe(false);
    }
  });

  it('rejects invalid format', () => {
    const invalid = ['Bad.Name', 'user-login', '.start', 'end.', 'a..b', 'a::b', 'a.:b', 'a:'];

    for (const value of invalid) {
      expect(isValidEventName(value)).toBe(false);
    }
  });

  it('handles long and deeply nested names', () => {
    const longSegment = 'file.' + 'a'.repeat(50000);
    const deepName = Array.from({ length: 120 }, () => 'seg').join('.');

    expect(isValidEventName(longSegment)).toBe(true);
    expect(isValidEventName(deepName)).toBe(true);
  });
});

describe('isValidEventPattern', () => {
  it('accepts valid patterns', () => {
    const valid = [
      '*',
      'user.*',
      'user.?',
      'user.*.detail',
      'user:*',
      'a*b',
      'a?b',
      'a**',
      'a:?b',
      'a.b:*',
    ];

    for (const value of valid) {
      expect(isValidEventPattern(value)).toBe(true);
    }
  });

  it('rejects invalid types and empty values', () => {
    const arrayLike = { 0: 'a', length: 1 };
    const invalid = [
      null,
      undefined,
      '',
      '   ',
      '\n',
      [],
      {},
      arrayLike,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      new String('*'),
    ];

    for (const value of invalid) {
      expect(isValidEventPattern(value)).toBe(false);
    }
  });

  it('rejects invalid format', () => {
    const invalid = ['Bad.Pattern', 'user-login', '.start', 'end.', 'a..b', 'a::b', 'a.:b', 'a:'];

    for (const value of invalid) {
      expect(isValidEventPattern(value)).toBe(false);
    }
  });

  it('handles long and deeply nested patterns', () => {
    const longPattern = 'a'.repeat(20000) + '*';
    const deepPattern = Array.from({ length: 80 }, () => 'seg').join('.') + '.*';

    expect(isValidEventPattern(longPattern)).toBe(true);
    expect(isValidEventPattern(deepPattern)).toBe(true);
  });
});

describe('assertValidEventName', () => {
  it('does not throw for valid names', () => {
    expect(() => assertValidEventName('*')).not.toThrow();
    expect(() => assertValidEventName('user.login')).not.toThrow();
  });

  it('throws TypeError for invalid names', () => {
    const invalid = [null, undefined, '', 'Bad Name', 'a..b', [], {}];

    for (const value of invalid) {
      expect(() => assertValidEventName(value)).toThrow(TypeError);
      expect(() => assertValidEventName(value)).toThrow(/Invalid event name/);
    }
  });
});

describe('assertValidEventPattern', () => {
  it('does not throw for valid patterns', () => {
    expect(() => assertValidEventPattern('*')).not.toThrow();
    expect(() => assertValidEventPattern('user.*')).not.toThrow();
  });

  it('throws TypeError for invalid patterns', () => {
    const invalid = [null, undefined, '', 'Bad Pattern', 'a..b', [], {}];

    for (const value of invalid) {
      expect(() => assertValidEventPattern(value)).toThrow(TypeError);
      expect(() => assertValidEventPattern(value)).toThrow(/Invalid event pattern/);
    }
  });
});

describe('createEventId', () => {
  it('uses provided runId string and seq boundaries', () => {
    const runId = randomUUID();

    expect(createEventId(runId, 0)).toBe('evt_mock-uuid_0');
    expect(createEventId(runId, -1)).toBe('evt_mock-uuid_-1');
    expect(createEventId(runId, Number.MAX_SAFE_INTEGER)).toBe(
      'evt_mock-uuid_' + Number.MAX_SAFE_INTEGER
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('falls back to default runId for non-string or empty values', () => {
    const invalidRunIds = [null, undefined, '', 0, 123, {}, [], new String('x')];

    for (const value of invalidRunIds) {
      expect(createEventId(value, 1)).toBe('evt_run_1');
    }
  });

  it('preserves string seq values', () => {
    expect(createEventId('custom', '7')).toBe('evt_custom_7');
  });

  it('handles long runId inputs', () => {
    const longRunId = 'r'.repeat(20000);
    const id = createEventId(longRunId, 2);

    expect(id.startsWith('evt_')).toBe(true);
    expect(id.endsWith('_2')).toBe(true);
    expect(id.includes(longRunId)).toBe(true);
  });

  it('supports concurrent calls', async () => {
    const ids = await Promise.all(
      Array.from({ length: 50 }, (_, i) => Promise.resolve(createEventId('bulk', i)))
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('supports rapid consecutive calls', () => {
    const ids = [];

    for (let i = 0; i < 20; i += 1) {
      ids.push(createEventId('fast', i));
    }

    expect(ids[0]).toBe('evt_fast_0');
    expect(ids[19]).toBe('evt_fast_19');
  });
});

describe('matchPattern', () => {
  it('returns false for non-string inputs', () => {
    const invalidValues = [null, undefined, [], {}, 0, -1, Number.MAX_SAFE_INTEGER];

    for (const value of invalidValues) {
      expect(matchPattern(value, 'user.login')).toBe(false);
      expect(matchPattern('user.*', value)).toBe(false);
    }
  });

  it('matches global wildcard and exact match', () => {
    expect(matchPattern('*', 'any.event')).toBe(true);
    expect(matchPattern('user.login', 'user.login')).toBe(true);
  });

  it('returns false when pattern lacks an asterisk and is not equal', () => {
    expect(matchPattern('user.logout', 'user.login')).toBe(false);
    expect(matchPattern('user.?', 'user.a')).toBe(false);
  });

  it('matches prefix.* patterns via fast path', () => {
    expect(matchPattern('user.*', 'user')).toBe(true);
    expect(matchPattern('user.*', 'user.login')).toBe(true);
    expect(matchPattern('user.*', 'users.login')).toBe(false);
    expect(matchPattern('user.*', 'userx')).toBe(false);
  });

  it('matches general wildcard patterns', () => {
    expect(matchPattern('a*b', 'ab')).toBe(true);
    expect(matchPattern('a*b', 'axxb')).toBe(true);
    expect(matchPattern('a*b', 'ac')).toBe(false);
  });

  it('matches patterns with ? and separators when * is present', () => {
    expect(matchPattern('user.?*', 'user.ab')).toBe(true);
    expect(matchPattern('user:?*', 'user:ab')).toBe(true);
    expect(matchPattern('user:*', 'user:')).toBe(true);
    expect(matchPattern('user:*', 'user.login')).toBe(false);
  });

  it('handles long strings and deep nesting', () => {
    const deepName = Array.from({ length: 80 }, (_, i) => 'seg' + i).join('.');
    const longName = 'a'.repeat(20000);

    expect(matchPattern('seg0.*', deepName)).toBe(true);
    expect(matchPattern('a*', longName)).toBe(true);
  });
});
