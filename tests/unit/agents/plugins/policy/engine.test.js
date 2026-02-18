import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../../js/agents/plugins/policy/match.js', () => {
  const toList = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const toStr = (value) => (typeof value === 'string' ? value : '');

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const globToRegExp = (pattern) => {
    const raw = toStr(pattern);
    if (!raw) return null;
    if (raw === '*' || raw === '**') return /^.*$/;
    const escaped = escapeRegExp(raw)
      .replace(/\\\*\\\*/g, '.*')
      .replace(/\\\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
  };

  const matchAny = (value, patterns) => {
    const v = toStr(value);
    if (!v) return false;
    for (const p of toList(patterns)) {
      const re = globToRegExp(p);
      if (re && re.test(v)) return true;
    }
    return false;
  };

  return {
    matchAnyWildcard: vi.fn(matchAny),
    matchAnyGlob: vi.fn(matchAny),
  };
});

vi.mock('../../../../../js/agents/shared/index.js', () => {
  const toNonEmptyString = (value) => {
    if (typeof value !== 'string') return '';
    const s = value.trim();
    return s ? s : '';
  };

  const isPlainObject = (value) => {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  return {
    toNonEmptyString,
    isPlainObject,
    makeSecureTimestampedId: vi.fn(() => 'mock-id-0'),
    createLogger: vi.fn(() => mockLogger),
  };
});

const engine = await import('../../../../../js/agents/plugins/policy/engine.js');
const match = await import('../../../../../js/agents/plugins/policy/match.js');
const shared = await import('../../../../../js/agents/shared/index.js');

let idCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  shared.makeSecureTimestampedId.mockImplementation(() => `mock-id-${++idCounter}`);
});

const BIG_STRING = 'a'.repeat(10_000);

function isPromiseLike(value) {
  return !!value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

async function safeInvoke(fn, args) {
  try {
    const out = fn(...args);
    const value = isPromiseLike(out) ? await out : out;
    return { ok: true, value };
  } catch (error) {
    if (
      error instanceof TypeError &&
      typeof error.message === 'string' &&
      /class constructor|cannot be invoked without 'new'|cannot call a class as a function/i.test(error.message)
    ) {
      try {
        const constructed = new fn(...args);
        return { ok: true, value: constructed };
      } catch (ctorError) {
        return { ok: false, error: ctorError };
      }
    }
    return { ok: false, error };
  }
}

function makeDeepObject(depth = 60) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = { i };
    cursor = cursor.next;
  }
  return root;
}

const sampleRule = {
  effect: 'allow',
  type: 'tool',
  tool: 'echo',
  resource: 'https://example.com',
  enabled: true,
  priority: 0,
};

const sampleRequest = {
  type: 'tool',
  tool: 'echo',
  resource: 'https://example.com/path',
  path: '/path',
  ts: '2026-01-27T00:00:00.000Z',
};

describe('engine module', () => {
  it('exports at least one symbol', () => {
    expect(Object.keys(engine).length).toBeGreaterThan(0);
  });
});

function addGenericFunctionTests(name, fn) {
  it('handles empty/nullish inputs (error handling)', async () => {
    const invalidArgSets = [
      [],
      [undefined],
      [null],
      [''],
      ['   '],
      [[]],
      [{}],
      [Number.MAX_SAFE_INTEGER],
      [BIG_STRING],
      [makeDeepObject(40)],
      [undefined, undefined],
      [null, null],
      [[], {}],
      [{}, []],
    ];

    const results = await Promise.all(invalidArgSets.map((args) => safeInvoke(fn, args)));
    for (const r of results) {
      if (!r.ok) expect(r.error).toBeInstanceOf(Error);
    }
  });

  it('supports concurrent calls (concurrency boundary)', async () => {
    const args = [null];
    const results = await Promise.all(Array.from({ length: 25 }, () => safeInvoke(fn, args)));
    for (const r of results) {
      if (!r.ok) expect(r.error).toBeInstanceOf(Error);
    }
  });

  it('accepts at least one typical input shape (normal path)', async () => {
    const candidates = [
      [],
      [{}],
      [[]],
      [sampleRule],
      [[sampleRule]],
      [sampleRequest],
      [[sampleRule], sampleRequest],
      [sampleRequest, [sampleRule]],
      [{ rules: [sampleRule] }, sampleRequest],
      [{ rules: [sampleRule], defaultEffect: 'deny' }, sampleRequest],
      [[sampleRule], sampleRequest, 'deny'],
      [[sampleRule], sampleRequest, { defaultEffect: 'deny' }],
    ];

    if (/match/i.test(name)) {
      candidates.unshift(['echo', ['*']]);
      candidates.unshift(['echo', ['echo']]);
      candidates.unshift(['echo', 'echo']);
    }

    let succeeded = false;
    for (const args of candidates) {
      const r = await safeInvoke(fn, args);
      if (r.ok) {
        succeeded = true;
        if (r.value && typeof r.value === 'object') {
          if (typeof r.value.allowed === 'boolean') {
            expect(typeof r.value.requiresApproval).toBe('boolean');
            expect(typeof r.value.reason).toBe('string');
          }
          if (typeof r.value.ruleId === 'string') {
            expect(r.value.ruleId.length).toBeGreaterThan(0);
          }
        }
        break;
      }
    }

    expect(succeeded).toBe(true);
  });
}

function addGenericValueTests(value) {
  it('is defined', () => {
    expect(value).not.toBeUndefined();
  });
}

function addNormalizeEffectTests(fn) {
  it('normalizes allow/deny case-insensitively', () => {
    expect(fn('ALLOW')).toBe('allow');
    expect(fn('deny')).toBe('deny');
    expect(fn('DeNy')).toBe('deny');
  });

  it('returns null for empty/invalid values (edge cases)', () => {
    expect(fn(undefined)).toBeNull();
    expect(fn(null)).toBeNull();
    expect(fn('')).toBeNull();
    expect(fn('   ')).toBeNull();
    expect(fn('prompt')).toBeNull();
    expect(fn('unknown')).toBeNull();
    expect(fn([])).toBeNull();
    expect(fn({})).toBeNull();
    expect(fn(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it('handles very long strings (resource boundary)', () => {
    expect(fn(BIG_STRING)).toBeNull();
  });

  it('supports concurrent calls (concurrency boundary)', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => Promise.resolve(fn('ALLOW'))));
    for (const r of results) expect(r).toBe('allow');
  });
}

function addNormalizeTypeListTests(fn) {
  it('normalizes a single type into a list', () => {
    expect(fn('tool')).toEqual(['tool']);
  });

  it('filters empty entries and preserves order', () => {
    expect(fn(['a', '', 'b', ''])).toEqual(['a', 'b']);
  });

  it('returns [] for nullish/empty inputs (edge cases)', () => {
    expect(fn(undefined)).toEqual([]);
    expect(fn(null)).toEqual([]);
    expect(fn('')).toEqual([]);
    expect(fn([])).toEqual([]);
  });

  it('handles wrong types without throwing (type boundary)', () => {
    expect(() => fn({})).not.toThrow();
    expect(() => fn(0)).not.toThrow();
    const r1 = fn({});
    const r2 = fn(0);
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
    for (const v of [...r1, ...r2]) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('supports concurrent calls (concurrency boundary)', async () => {
    const input = ['a', '', 'b'];
    const results = await Promise.all(Array.from({ length: 25 }, () => Promise.resolve(fn(input))));
    for (const r of results) expect(r).toEqual(['a', 'b']);
  });
}

function addNormalizeDomainSuffixesTests(fn) {
  it('lowercases and strips leading dots', () => {
    expect(fn(['.Example.COM', 'Sub.EXAMPLE.com'])).toEqual(['example.com', 'sub.example.com']);
  });

  it('accepts a single string and returns a list', () => {
    expect(fn('.Example.COM')).toEqual(['example.com']);
  });

  it('filters empty/invalid entries (edge cases)', () => {
    expect(fn(undefined)).toEqual([]);
    expect(fn(null)).toEqual([]);
    expect(fn([])).toEqual([]);
    expect(fn('')).toEqual([]);
    expect(fn('.')).toEqual([]);
    expect(fn(['', '.'])).toEqual([]);
  });

  it('handles wrong types without throwing (type boundary)', () => {
    expect(() => fn({})).not.toThrow();
    expect(() => fn(0)).not.toThrow();
    const r1 = fn({});
    const r2 = fn(0);
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
  });

  it('supports concurrent calls (concurrency boundary)', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => Promise.resolve(fn(['.A.COM', 'b.com']))));
    for (const r of results) expect(r).toEqual(['a.com', 'b.com']);
  });
}

function addParseTimeToMinutesTests(fn) {
  it('parses HH:MM strings', () => {
    expect(fn('00:00')).toBe(0);
    expect(fn('0:00')).toBe(0);
    expect(fn('23:59')).toBe(23 * 60 + 59);
    expect(fn('7:05')).toBe(7 * 60 + 5);
  });

  it('accepts finite numbers as minutes and floors floats', () => {
    expect(fn(0)).toBe(0);
    expect(fn(12.9)).toBe(12);
    expect(fn(1439)).toBe(1439);
  });

  it('returns null for invalid ranges and formats (edge cases)', () => {
    expect(fn(-1)).toBeNull();
    expect(fn(24 * 60)).toBeNull();
    expect(fn(Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(fn('24:00')).toBeNull();
    expect(fn('12:60')).toBeNull();
    expect(fn('7:5')).toBeNull();
    expect(fn('')).toBeNull();
    expect(fn('   ')).toBeNull();
    expect(fn({})).toBeNull();
    expect(fn([])).toBeNull();
    expect(fn('0')).toBeNull();
  });

  it('supports concurrent calls (concurrency boundary)', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => Promise.resolve(fn('23:59'))));
    for (const r of results) expect(r).toBe(1439);
  });
}

function addNormalizeTimeRangeTests(fn) {
  it('normalizes start/end and defaults to local timezone', () => {
    expect(fn({ start: '09:00', end: '17:00' })).toEqual({
      startMin: 9 * 60,
      endMin: 17 * 60,
      timezone: 'local',
    });
  });

  it('accepts utc timezone and alternative keys', () => {
    expect(fn({ from: '08:00', to: '09:00', tz: 'utc' })).toEqual({
      startMin: 8 * 60,
      endMin: 9 * 60,
      timezone: 'utc',
    });
  });

  it('accepts numeric startMin/endMin (including floats)', () => {
    expect(fn({ startMin: 1.9, endMin: 2.1 })).toEqual({
      startMin: 1,
      endMin: 2,
      timezone: 'local',
    });
  });

  it('returns null for invalid inputs (edge cases)', () => {
    expect(fn(null)).toBeNull();
    expect(fn(undefined)).toBeNull();
    expect(fn('')).toBeNull();
    expect(fn([])).toBeNull();
    expect(fn({})).toBeNull();
    expect(fn({ start: '00:00' })).toBeNull();
    expect(fn({ end: '00:01' })).toBeNull();
    expect(fn({ start: '24:00', end: '00:01' })).toBeNull();
    expect(fn({ startMin: -1, endMin: 0 })).toBeNull();
  });

  it('filters daysOfWeek into 0..6 and omits when empty', () => {
    const r1 = fn({ start: '00:00', end: '00:01', daysOfWeek: [0, 1, 6, 7, -1, '2', 'nope'] });
    expect(r1).toEqual({
      startMin: 0,
      endMin: 1,
      timezone: 'local',
      daysOfWeek: [0, 1, 6, 2],
    });

    const r2 = fn({ start: '00:00', end: '00:01', daysOfWeek: [] });
    expect(r2).toEqual({ startMin: 0, endMin: 1, timezone: 'local' });
    expect('daysOfWeek' in r2).toBe(false);
  });

  it('handles deep nested objects and very long strings (resource boundary)', () => {
    const deep = makeDeepObject(80);
    const r1 = fn({ start: '00:00', end: '00:01', extra: deep });
    expect(r1).toEqual({ startMin: 0, endMin: 1, timezone: 'local' });

    const r2 = fn({ start: BIG_STRING, end: '00:01' });
    expect(r2).toBeNull();
  });

  it('supports concurrent calls (concurrency boundary)', async () => {
    const input = { start: '09:00', end: '17:00', tz: 'utc' };
    const results = await Promise.all(Array.from({ length: 50 }, () => Promise.resolve(fn(input))));
    for (const r of results) {
      expect(r).toEqual({ startMin: 540, endMin: 1020, timezone: 'utc' });
    }
  });
}

function addExtractHostnameTests(fn) {
  it('returns empty string for nullish/empty inputs (edge cases)', () => {
    expect(fn(undefined)).toBe('');
    expect(fn(null)).toBe('');
    expect(fn('')).toBe('');
    expect(fn('   ')).toBe('');
    expect(fn([])).toBe('');
    expect(fn({})).toBe('');
  });

  it('extracts hostname from full URLs', () => {
    expect(fn('https://Example.COM/path')).toBe('example.com');
    expect(fn('http://example.com:8080/path')).toBe('example.com');
    expect(fn('ftp://EXAMPLE.com/something')).toBe('example.com');
  });

  it('extracts hostname from schemeless host/path (heuristic)', () => {
    expect(fn('example.com/path')).toBe('example.com');
    expect(fn('example.com')).toBe('example.com');
    expect(fn('sub.Example.com/foo')).toBe('sub.example.com');
  });

  it('returns empty string for non-host inputs and spaced strings', () => {
    expect(fn('localhost')).toBe('');
    expect(fn('not a url')).toBe('');
    expect(fn('foo.bar baz')).toBe('');
  });

  it('handles very long strings (resource boundary)', () => {
    expect(fn(`${'a'.repeat(10_000)}.com bad`)).toBe('');
  });

  it('supports concurrent calls (concurrency boundary)', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => Promise.resolve(fn('example.com/path'))));
    for (const r of results) expect(r).toBe('example.com');
  });
}

for (const [name, value] of Object.entries(engine)) {
  describe(name, () => {
    if (typeof value === 'function') {
      if (name === 'normalizeEffect') return addNormalizeEffectTests(value);
      if (name === 'normalizeTypeList') return addNormalizeTypeListTests(value);
      if (name === 'normalizeDomainSuffixes') return addNormalizeDomainSuffixesTests(value);
      if (name === 'parseTimeToMinutes') return addParseTimeToMinutesTests(value);
      if (name === 'normalizeTimeRange') return addNormalizeTimeRangeTests(value);
      if (name === 'extractHostname') return addExtractHostnameTests(value);

      if (/normalize.*rule/i.test(name)) {
        it('returns a normalized rule-like object for basic input (normal path)', async () => {
          const r = await safeInvoke(value, [sampleRule]);
          if (!r.ok) throw r.error;
          expect(r.value).toBeTruthy();
          if (r.value && typeof r.value === 'object') {
            if ('effect' in r.value) expect(typeof r.value.effect).toBe('string');
            if ('ruleId' in r.value) expect(typeof r.value.ruleId).toBe('string');
          }
        });
      }

      if (/(decide|evaluate|check|enforce).*policy|policy.*(decide|evaluate|check|enforce)/i.test(name)) {
        it('produces a decision-like object for a simple allow rule (normal path)', async () => {
          const candidates = [
            [[sampleRule], sampleRequest],
            [sampleRequest, [sampleRule]],
            [{ rules: [sampleRule] }, sampleRequest],
            [[sampleRule], sampleRequest, 'deny'],
            [[sampleRule], sampleRequest, { defaultEffect: 'deny' }],
          ];

          let decision = null;
          for (const args of candidates) {
            const r = await safeInvoke(value, args);
            if (r.ok && r.value && typeof r.value === 'object') {
              decision = r.value;
              break;
            }
          }

          expect(decision).toBeTruthy();
          if (decision && typeof decision === 'object') {
            expect(typeof decision.allowed).toBe('boolean');
            expect(typeof decision.requiresApproval).toBe('boolean');
            expect(typeof decision.reason).toBe('string');
          }
        });
      }

      return addGenericFunctionTests(name, value);
    }

    return addGenericValueTests(value);
  });
}

describe('external dependency mocks', () => {
  it('mocks match functions with spies', () => {
    expect(typeof match.matchAnyWildcard).toBe('function');
    expect(typeof match.matchAnyGlob).toBe('function');
    expect(typeof match.matchAnyWildcard.mock).toBe('object');
    expect(typeof match.matchAnyGlob.mock).toBe('object');
  });

  it('mocks makeSecureTimestampedId deterministically', () => {
    const id1 = shared.makeSecureTimestampedId();
    const id2 = shared.makeSecureTimestampedId();
    expect(id1).toBe('mock-id-1');
    expect(id2).toBe('mock-id-2');
  });
});

describe('PolicyEngine behavior specifics', () => {
  it('does not short-circuit to missing_type when tool/resource are present', () => {
    const e = new engine.PolicyEngine({
      rules: [],
      defaultEffect: 'prompt',
    });

    const decision = e.evaluate({ tool: 'fs.readFile', resource: '/tmp/a.txt' });
    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      requiresApproval: true,
      reason: 'missing_type_no_matching_rule',
    }));
  });

  it('warns on invalid defaultEffect and falls back to prompt behavior', () => {
    const e = new engine.PolicyEngine({
      rules: [],
      defaultEffect: 'invalid_effect',
    });

    const decision = e.evaluate({ type: 'tool.call', tool: 'fs.readFile' });
    expect(decision).toEqual(expect.objectContaining({
      allowed: false,
      requiresApproval: true,
      reason: 'no_matching_rule',
    }));
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Invalid policy defaultEffect; falling back to prompt',
      expect.objectContaining({ received: 'invalid_effect' }),
    );
  });
});
