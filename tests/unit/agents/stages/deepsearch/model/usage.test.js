// Unit tests for normalizeTokenUsage covering boundaries, type handling, and concurrency behavior.
// Targets js/agents/stages/deepsearch/model/usage.js token usage normalization helpers.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../js/agents/shared/index.js', async () => {
  const actual = await vi.importActual('../../../../../../js/agents/shared/index.js');
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    safeInt: vi.fn(actual.safeInt),
  };
});

import { normalizeTokenUsage, __test } from '../../../../../../js/agents/stages/deepsearch/model/usage.js';

describe('normalizeTokenUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for non-plain usage values', () => {
    const values = [null, undefined, '', [], ['x'], 0, -1, true, new Date(), () => {}];

    for (const value of values) {
      expect(normalizeTokenUsage(value)).toBeNull();
    }

    expect(__test.safeInt).not.toHaveBeenCalled();
    expect(__test.isPlainObject).toHaveBeenCalledTimes(values.length);
  });

  it('returns null for empty plain objects', () => {
    expect(normalizeTokenUsage({})).toBeNull();

    expect(__test.isPlainObject).toHaveBeenCalledTimes(1);
    expect(__test.safeInt).toHaveBeenCalledTimes(3);
  });

  it('returns null when token fields are blank strings', () => {
    const usage = { prompt_tokens: '   ', completion_tokens: ' ', total_tokens: '' };

    expect(normalizeTokenUsage(usage)).toBeNull();
    expect(__test.safeInt).toHaveBeenCalledTimes(3);
  });

  it('normalizes tokens from standard fields', () => {
    const usage = { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 };

    expect(normalizeTokenUsage(usage)).toEqual({ input: 5, output: 7, total: 12 });
    expect(__test.safeInt).toHaveBeenCalledWith(5);
    expect(__test.safeInt).toHaveBeenCalledWith(7);
    expect(__test.safeInt).toHaveBeenCalledWith(12);
  });

  it('uses fallback fields and computes total when missing', () => {
    const usage = { promptTokens: '12.9', output_tokens: 5 };

    expect(normalizeTokenUsage(usage)).toEqual({ input: 12, output: 5, total: 17 });
  });

  it('clamps negative values and preserves zeros', () => {
    const usage = { input_tokens: -1, output_tokens: 0, total_tokens: -5 };

    expect(normalizeTokenUsage(usage)).toEqual({ input: 0, output: 0, total: 0 });
  });

  it('handles maximum safe integers', () => {
    const usage = { input: Number.MAX_SAFE_INTEGER, output: 1 };

    expect(normalizeTokenUsage(usage)).toEqual({
      input: Number.MAX_SAFE_INTEGER,
      output: 1,
      total: Number.MAX_SAFE_INTEGER + 1,
    });
  });

  it('does not fall back when a higher-precedence field is present but invalid', () => {
    const usage = { prompt_tokens: ' ', input_tokens: 10, completion_tokens: 2 };

    expect(normalizeTokenUsage(usage)).toEqual({ input: 0, output: 2, total: 2 });
  });

  it('handles type mismatches for token fields', () => {
    const usage = { prompt_tokens: { value: 3 }, output_tokens: [1, 2], total_tokens: '5' };

    expect(normalizeTokenUsage(usage)).toEqual({ input: 0, output: 0, total: 5 });
  });

  it('handles concurrent calls consistently', async () => {
    const payloads = [
      { prompt_tokens: 1, completion_tokens: 2 },
      { inputTokens: '3', output: '4', totalTokens: '10' },
      { prompt: 0, completion: 0, total: 0 },
    ];

    const results = await Promise.all(
      payloads.map((usage) => Promise.resolve(normalizeTokenUsage(usage)))
    );

    expect(results).toEqual([
      { input: 1, output: 2, total: 3 },
      { input: 3, output: 4, total: 10 },
      { input: 0, output: 0, total: 0 },
    ]);
  });

  it('handles rapid successive calls without shared state', () => {
    const usage = { promptTokensUsed: 2, completionTokensUsed: 3 };

    for (let i = 0; i < 50; i += 1) {
      expect(normalizeTokenUsage(usage)).toEqual({ input: 2, output: 3, total: 5 });
    }
  });

  it('handles large payloads and deep nesting', () => {
    const deep = {};
    let cursor = deep;

    for (let i = 0; i < 60; i += 1) {
      cursor.child = {};
      cursor = cursor.child;
    }

    const longString = '9'.repeat(100000);
    const usage = {
      prompt_tokens: longString,
      completion_tokens: 1,
      file: 'x'.repeat(200000),
      chunks: new Array(5000).fill('y'),
      meta: deep,
    };

    expect(normalizeTokenUsage(usage)).toEqual({ input: 0, output: 1, total: 1 });
  });
});

describe('__test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes mocked helpers', () => {
    expect(typeof __test.isPlainObject).toBe('function');
    expect(typeof __test.safeInt).toBe('function');
    expect(vi.isMockFunction(__test.isPlainObject)).toBe(true);
    expect(vi.isMockFunction(__test.safeInt)).toBe(true);
  });

  it('passes through to helper behavior', () => {
    expect(__test.isPlainObject({})).toBe(true);
    expect(__test.isPlainObject([])).toBe(false);
    expect(__test.safeInt('4.8')).toBe(4);
    expect(__test.safeInt('')).toBeNull();
  });
});
