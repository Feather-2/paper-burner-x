// Unit tests for token-cache utilities cover cache behavior and fallback paths.
// Focused on estimateTokensCached edge inputs plus clearTokenCache/getTokenCacheStats stats.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  estimateTokens: vi.fn(),
}));

vi.mock('../../../../../js/agents/shared/utils/value-utils.js', () => ({
  estimateTokens: hoisted.estimateTokens,
}));

import {
  estimateTokensCached,
  clearTokenCache,
  getTokenCacheStats,
} from '../../../../../js/agents/shared/utils/token-cache.js';

beforeEach(() => {
  clearTokenCache();
  hoisted.estimateTokens.mockReset();
  hoisted.estimateTokens.mockImplementation((text) => text.length);
});

describe('estimateTokensCached', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['empty array', []],
    ['empty object', {}],
    ['zero', 0],
    ['negative number', -1],
    ['max safe integer', Number.MAX_SAFE_INTEGER],
  ])('returns 0 for %s input', (_, value) => {
    expect(estimateTokensCached(value)).toBe(0);
    expect(hoisted.estimateTokens).not.toHaveBeenCalled();
  });

  it('returns 0 for array-like object input', () => {
    const arrayLike = { 0: 'a', length: 1 };
    expect(estimateTokensCached(arrayLike)).toBe(0);
    expect(hoisted.estimateTokens).not.toHaveBeenCalled();
  });

  it('handles deeply nested object input safely', () => {
    let deep = {};
    for (let i = 0; i < 500; i++) {
      deep = { nested: deep };
    }
    expect(estimateTokensCached(deep)).toBe(0);
    expect(hoisted.estimateTokens).not.toHaveBeenCalled();
  });

  it('estimates tokens for whitespace-only string', () => {
    const text = '  \n\t  ';
    expect(estimateTokensCached(text)).toBe(text.length);
    expect(hoisted.estimateTokens).toHaveBeenCalledWith(text);
  });

  it('accepts numeric string input', () => {
    const text = '12345';
    expect(estimateTokensCached(text)).toBe(text.length);
    expect(hoisted.estimateTokens).toHaveBeenCalledWith(text);
  });

  it('ignores non-counter tokenCounter inputs', () => {
    const first = estimateTokensCached('alpha', []);
    const second = estimateTokensCached('beta', {});
    expect(first).toBe('alpha'.length);
    expect(second).toBe('beta'.length);
    expect(hoisted.estimateTokens).toHaveBeenCalledTimes(2);
  });

  it('uses tokenCounter when valid and caches result', () => {
    const counter = { count: vi.fn(() => 7) };
    const text = 'counter text';
    expect(estimateTokensCached(text, counter)).toBe(7);
    expect(estimateTokensCached(text)).toBe(7);
    expect(counter.count).toHaveBeenCalledTimes(1);
    expect(hoisted.estimateTokens).not.toHaveBeenCalled();
    const stats = getTokenCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it.each([
    ['zero', 0],
    ['max safe integer', Number.MAX_SAFE_INTEGER],
  ])('accepts tokenCounter result %s', (_, value) => {
    const counter = { count: vi.fn(() => value) };
    const text = `value-${value}`;
    expect(estimateTokensCached(text, counter)).toBe(value);
    expect(counter.count).toHaveBeenCalledTimes(1);
    expect(hoisted.estimateTokens).not.toHaveBeenCalled();
  });

  it('falls back when tokenCounter throws', () => {
    const counter = {
      count: vi.fn(() => {
        throw new Error('boom');
      }),
    };
    const text = 'fallback';
    expect(estimateTokensCached(text, counter)).toBe(text.length);
    expect(counter.count).toHaveBeenCalledTimes(1);
    expect(hoisted.estimateTokens).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['non-number', '5'],
  ])('falls back when tokenCounter returns %s', (_, value) => {
    const counter = { count: vi.fn(() => value) };
    const text = 'fallback-check';
    expect(estimateTokensCached(text, counter)).toBe(text.length);
    expect(counter.count).toHaveBeenCalledTimes(1);
    expect(hoisted.estimateTokens).toHaveBeenCalledTimes(1);
  });

  it('caches repeated short string calls', () => {
    const text = 'short text';
    const first = estimateTokensCached(text);
    const second = estimateTokensCached(text);
    expect(second).toBe(first);
    expect(hoisted.estimateTokens).toHaveBeenCalledTimes(1);
    const stats = getTokenCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('caches long string inputs using hashed key path', () => {
    const text = 'x'.repeat(150);
    const first = estimateTokensCached(text);
    const second = estimateTokensCached(text);
    expect(first).toBe(text.length);
    expect(second).toBe(first);
    expect(hoisted.estimateTokens).toHaveBeenCalledTimes(1);
    const stats = getTokenCacheStats();
    expect(stats.size).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('handles very large text input (large file) safely', () => {
    const text = 'y'.repeat(200000);
    const first = estimateTokensCached(text);
    const second = estimateTokensCached(text);
    expect(first).toBe(text.length);
    expect(second).toBe(first);
    expect(hoisted.estimateTokens).toHaveBeenCalledTimes(1);
    const stats = getTokenCacheStats();
    expect(stats.size).toBe(1);
  });

  it('handles simultaneous calls consistently', async () => {
    const text = 'concurrent';
    const results = await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve().then(() => estimateTokensCached(text)))
    );
    expect(new Set(results).size).toBe(1);
    const stats = getTokenCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(9);
  });

  it('handles rapid successive calls without drifting stats', () => {
    const text = 'rapid';
    const calls = 50;
    for (let i = 0; i < calls; i++) {
      estimateTokensCached(text);
    }
    const stats = getTokenCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(calls - 1);
  });

  it('evicts oldest entry when exceeding maxSize', () => {
    const { maxSize } = getTokenCacheStats();
    for (let i = 0; i < maxSize; i++) {
      estimateTokensCached(`key-${i}`);
    }
    const statsFull = getTokenCacheStats();
    expect(statsFull.size).toBe(maxSize);
    expect(statsFull.misses).toBe(maxSize);

    estimateTokensCached('extra');
    const statsAfterExtra = getTokenCacheStats();
    expect(statsAfterExtra.size).toBe(maxSize);
    expect(statsAfterExtra.misses).toBe(maxSize + 1);

    estimateTokensCached('key-0');
    const statsAfterReadd = getTokenCacheStats();
    expect(statsAfterReadd.misses).toBe(maxSize + 2);
    expect(statsAfterReadd.hits).toBe(0);
  });
});

describe('clearTokenCache', () => {
  it('clears cache and resets counters', () => {
    estimateTokensCached('reset');
    estimateTokensCached('reset');
    let stats = getTokenCacheStats();
    expect(stats.size).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);

    clearTokenCache();
    stats = getTokenCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  it('is safe to call on an empty cache', () => {
    clearTokenCache();
    const stats = getTokenCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });
});

describe('getTokenCacheStats', () => {
  it('returns zeroed stats for a new cache', () => {
    const stats = getTokenCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.maxSize).toBeGreaterThan(0);
  });

  it('computes hit rate based on hits and misses', () => {
    estimateTokensCached('hit');
    estimateTokensCached('hit');
    estimateTokensCached('miss');
    const stats = getTokenCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBeCloseTo(1 / 3);
  });
});
