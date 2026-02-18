import { describe, it, expect, vi, beforeEach } from 'vitest';

import safeJson, { safeJsonParse, safeJsonParseDetailed } from '../../../../../js/agents/shared/utils/safe-json.js';

const mockedOs = vi.hoisted(() => ({
  homedir: vi.fn(() => '/mock/home'),
}));

vi.mock('node:os', () => mockedOs);

const DEFAULT_MAX_CHARS = 1_000_000;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('safeJsonParse', () => {
  it('returns null for nullish and empty inputs', () => {
    expect(safeJsonParse(null)).toBeNull();
    expect(safeJsonParse(undefined)).toBeNull();
    expect(safeJsonParse('')).toBeNull();
    expect(safeJsonParse('   ')).toBeNull();
    expect(safeJsonParse('\n\t')).toBeNull();
  });

  it('returns object and array inputs unchanged, including empty and array-like objects', () => {
    const obj = { already: 'object' };
    const arr = [1, 2, 3];
    const emptyObj = {};
    const emptyArr = [];
    const arrayLike = { 0: 'a', length: 1 };

    expect(safeJsonParse(obj)).toBe(obj);
    expect(safeJsonParse(arr)).toBe(arr);
    expect(safeJsonParse(emptyObj)).toBe(emptyObj);
    expect(safeJsonParse(emptyArr)).toBe(emptyArr);
    expect(safeJsonParse(arrayLike)).toBe(arrayLike);
    expect(safeJsonParse(obj, { maxChars: 1 })).toBe(obj);
  });

  it('parses JSON strings and coerces non-string primitives', () => {
    expect(safeJsonParse('123')).toBe(123);
    expect(safeJsonParse('true')).toBe(true);
    expect(safeJsonParse('"hello"')).toBe('hello');
    expect(safeJsonParse('  {"key": "value"}  ')).toEqual({ key: 'value' });
    expect(safeJsonParse(0)).toBe(0);
    expect(safeJsonParse(-1)).toBe(-1);
    expect(safeJsonParse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('returns null for invalid JSON', () => {
    expect(safeJsonParse('{invalid}')).toBeNull();
    expect(safeJsonParse('{"a":}')).toBeNull();
  });

  it('respects maxChars when provided as numeric string and floors', () => {
    expect(safeJsonParse('1234', { maxChars: '4.9' })).toBe(1234);
    expect(safeJsonParse('12345', { maxChars: '4.9' })).toBeNull();
  });

  it('falls back to default maxChars for non-positive or invalid values', () => {
    expect(safeJsonParse('0', { maxChars: 0 })).toBe(0);
    expect(safeJsonParse('1', { maxChars: -1 })).toBe(1);
    expect(safeJsonParse('2', { maxChars: 'not-a-number' })).toBe(2);
  });

  it('returns null for oversized payloads with default limit', () => {
    const big = 'a'.repeat(DEFAULT_MAX_CHARS + 1);
    const payload = `"${big}"`;

    expect(safeJsonParse(payload)).toBeNull();
  });

  it('allows oversized payloads when maxChars is Infinity', () => {
    const big = 'b'.repeat(DEFAULT_MAX_CHARS + 1);
    const payload = `"${big}"`;

    expect(safeJsonParse(payload, { maxChars: Infinity })).toBe(big);
  });

  it('handles deep nested JSON payloads', () => {
    const depth = 200;
    let payload = '1';
    for (let i = 0; i < depth; i += 1) payload = `[${payload}]`;

    const parsed = safeJsonParse(payload);
    let cursor = parsed;
    for (let i = 0; i < depth; i += 1) {
      expect(Array.isArray(cursor)).toBe(true);
      cursor = cursor[0];
    }

    expect(cursor).toBe(1);
  });

  it('handles concurrent calls without shared state', async () => {
    const inputs = ['{"a":1}', '[1,2]', '0', 'bad', '   '];
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => safeJsonParse(input)))
    );

    expect(results).toEqual([{ a: 1 }, [1, 2], 0, null, null]);
  });

  it('handles rapid consecutive calls', () => {
    const results = [];
    for (let i = 0; i < 20; i += 1) {
      results.push(safeJsonParse(String(i)));
    }

    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('parses values derived from mocked external dependency', async () => {
    const os = await import('node:os');
    const payload = JSON.stringify({ home: os.homedir() });

    expect(safeJsonParse(payload)).toEqual({ home: '/mock/home' });
    expect(os.homedir).toHaveBeenCalledTimes(1);
  });
});

describe('safeJsonParseDetailed', () => {
  it('returns structured oversized diagnostics', () => {
    const payload = `"${'x'.repeat(10)}"`;
    const result = safeJsonParseDetailed(payload, { maxChars: 5 });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        value: null,
        code: 'oversized',
        maxChars: 5,
        observedChars: payload.length,
      }),
    );
  });

  it('distinguishes invalid JSON from nullish/empty input', () => {
    expect(safeJsonParseDetailed('{bad}')).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'invalid_json',
      }),
    );
    expect(safeJsonParseDetailed(undefined)).toEqual({ ok: false, value: null, code: 'nullish' });
    expect(safeJsonParseDetailed('   ')).toEqual({ ok: false, value: null, code: 'empty' });
  });
});

describe('default', () => {
  it('exposes safeJsonParse on the default export', () => {
    expect(safeJson.safeJsonParse).toBe(safeJsonParse);
    expect(safeJson.safeJsonParseDetailed).toBe(safeJsonParseDetailed);
  });
});
