import { describe, it, expect, vi, beforeEach } from 'vitest';

const toNonEmptyStringMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../js/agents/shared/utils/value-utils.js', () => ({
  toNonEmptyString: toNonEmptyStringMock,
}));

import { MapAdapter } from '../../../../../js/agents/core/archive/map-adapter.js';

const defaultToNonEmptyString = (value) => {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
};

describe('MapAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new MapAdapter();
    toNonEmptyStringMock.mockReset();
    toNonEmptyStringMock.mockImplementation(defaultToNonEmptyString);
  });

  it('set/get stringifies keys across boundary inputs', async () => {
    const cases = [
      { key: null, expectedKey: 'null', value: 'v-null' },
      { key: undefined, expectedKey: 'undefined', value: 'v-undefined' },
      { key: '', expectedKey: '', value: 'v-empty' },
      { key: '   ', expectedKey: '   ', value: 'v-space' },
      { key: 0, expectedKey: '0', value: 'v-zero' },
      { key: -1, expectedKey: '-1', value: 'v-negative' },
      {
        key: Number.MAX_SAFE_INTEGER,
        expectedKey: String(Number.MAX_SAFE_INTEGER),
        value: 'v-max',
      },
      { key: [], expectedKey: '', value: 'v-empty-array-key' },
      { key: {}, expectedKey: '[object Object]', value: 'v-empty-object-key' },
    ];

    for (const { key, expectedKey, value } of cases) {
      const local = new MapAdapter();
      await expect(local.set(key, value)).resolves.toBe(true);
      expect(local.store.has(expectedKey)).toBe(true);
      await expect(local.get(expectedKey)).resolves.toBe(value);
    }
  });

  it('stores boundary values including null/undefined/empty containers', async () => {
    const emptyArray = [];
    const emptyObject = {};
    const arrayLikeObject = { 0: 'x', length: 1 };

    await adapter.set('null-value', null);
    await adapter.set('undefined-value', undefined);
    await adapter.set('empty-string', '');
    await adapter.set('empty-array', emptyArray);
    await adapter.set('empty-object', emptyObject);
    await adapter.set('array-like', arrayLikeObject);

    expect(adapter.store.has('null-value')).toBe(true);
    await expect(adapter.get('null-value')).resolves.toBeNull();
    expect(adapter.store.has('undefined-value')).toBe(true);
    await expect(adapter.get('undefined-value')).resolves.toBeUndefined();
    await expect(adapter.get('empty-string')).resolves.toBe('');
    await expect(adapter.get('empty-array')).resolves.toBe(emptyArray);
    await expect(adapter.get('empty-object')).resolves.toBe(emptyObject);
    await expect(adapter.get('array-like')).resolves.toEqual(arrayLikeObject);
  });

  it('get/delete handle missing keys and numeric-like coercion', async () => {
    await expect(adapter.get('missing')).resolves.toBeNull();
    await expect(adapter.delete('missing')).resolves.toBe(false);

    await adapter.set('123', 'from-string');
    await adapter.set(456, 'from-number');

    await expect(adapter.get(123)).resolves.toBe('from-string');
    await expect(adapter.get('456')).resolves.toBe('from-number');

    await expect(adapter.delete(123)).resolves.toBe(true);
    await expect(adapter.delete('456')).resolves.toBe(true);
    await expect(adapter.delete('456')).resolves.toBe(false);
  });

  it('keys defaults to "*" for empty patterns and returns sorted keys', async () => {
    await adapter.set('b', 2);
    await adapter.set('a', 1);
    await adapter.set('c', 3);

    await expect(adapter.keys()).resolves.toEqual(['a', 'b', 'c']);
    await expect(adapter.keys(null)).resolves.toEqual(['a', 'b', 'c']);
    await expect(adapter.keys('')).resolves.toEqual(['a', 'b', 'c']);
    await expect(adapter.keys('   ')).resolves.toEqual(['a', 'b', 'c']);

    expect(toNonEmptyStringMock.mock.calls).toEqual([[undefined], [null], [''], ['   ']]);
  });

  it('keys supports wildcard matching and escapes regex characters', async () => {
    await adapter.set('user:1', 1);
    await adapter.set('user:2', 2);
    await adapter.set('admin:1', 3);
    await adapter.set('a.b', 4);
    await adapter.set('aXb', 5);
    await adapter.set('a[1]', 6);
    await adapter.set('a1', 7);

    await expect(adapter.keys('user:*')).resolves.toEqual(['user:1', 'user:2']);
    await expect(adapter.keys('a.b')).resolves.toEqual(['a.b']);
    await expect(adapter.keys('a[1]')).resolves.toEqual(['a[1]']);
    await expect(adapter.keys('a*')).resolves.toEqual(['a.b', 'a1', 'aXb', 'a[1]', 'admin:1']);
  });

  it('keys propagates errors from toNonEmptyString', async () => {
    const error = new Error('boom');
    toNonEmptyStringMock.mockImplementation(() => {
      throw error;
    });

    await expect(adapter.keys('*')).rejects.toThrow('boom');
  });

  it('handles concurrent and rapid calls without state corruption', async () => {
    const pairs = Array.from({ length: 20 }, (_, i) => [`k${i}`, i]);
    await Promise.all(pairs.map(([key, value]) => adapter.set(key, value)));

    const values = await Promise.all(pairs.map(([key]) => adapter.get(key)));
    expect(values).toEqual(pairs.map(([, value]) => value));

    const rapidUpdates = Array.from({ length: 50 }, (_, i) => adapter.set('counter', i));
    await Promise.all(rapidUpdates);
    await expect(adapter.get('counter')).resolves.toBe(49);
  });

  it('stores large payloads, long keys, and deep nested values', async () => {
    const longKey = `key_${'x'.repeat(10000)}`;
    const largeValue = 'y'.repeat(1_000_000);
    const deepValue = Array.from({ length: 50 }).reduceRight(
      (child, _, idx) => ({ level: idx, child }),
      null
    );

    await adapter.set(longKey, largeValue);
    await adapter.set('deep', deepValue);

    await expect(adapter.get(longKey)).resolves.toBe(largeValue);
    await expect(adapter.get('deep')).resolves.toEqual(deepValue);
  });
});
