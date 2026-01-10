/**
 * @file tests/storage/local-storage-adapter.test.js
 * @description js/storage/adapters/local-storage-adapter.js unit tests
 */

import { describe, expect, it } from 'vitest';

import { LocalStorageAdapter } from '../../js/storage/adapters/local-storage-adapter.js';

function makeLocalStorage(initial = {}) {
  const entries = Object.entries(initial).map(([key, value]) => [key, String(value)]);
  const store = new Map(entries);

  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
    _dump: () => new Map(store),
  };
}

describe('storage/adapters/local-storage-adapter (LocalStorageAdapter)', () => {
  it('throws when localStorage is not available', () => {
    expect(() => new LocalStorageAdapter({ storage: null })).toThrow(
      'LocalStorageAdapter: localStorage is not available',
    );
  });

  it('set/get roundtrips JSON values', async () => {
    const storage = makeLocalStorage();
    const adapter = new LocalStorageAdapter({ storage });

    await adapter.set('k', { a: 1 });
    await expect(adapter.get('k')).resolves.toEqual({ a: 1 });
  });

  it('get returns raw string when stored value is not JSON', async () => {
    const storage = makeLocalStorage({ plain: 'hello' });
    const adapter = new LocalStorageAdapter({ storage });

    await expect(adapter.get('plain')).resolves.toBe('hello');
  });

  it('set(undefined) removes the key', async () => {
    const storage = makeLocalStorage();
    const adapter = new LocalStorageAdapter({ storage });

    await adapter.set('k', { a: 1 });
    await adapter.set('k', undefined);
    await expect(adapter.get('k')).resolves.toBeNull();
  });

  it('supports prefix namespace for keys() and clear()', async () => {
    const storage = makeLocalStorage({
      'pbx:a': JSON.stringify({ ok: true }),
      'pbx:b': JSON.stringify(2),
      other: JSON.stringify('x'),
    });

    const adapter = new LocalStorageAdapter({ prefix: 'pbx:', storage });

    const keys = await adapter.keys();
    expect(keys.sort()).toEqual(['a', 'b']);

    await adapter.clear();

    expect(storage._dump().has('pbx:a')).toBe(false);
    expect(storage._dump().has('pbx:b')).toBe(false);
    expect(storage._dump().has('other')).toBe(true);
  });

  it('without prefix, keys() returns all keys and clear() clears everything', async () => {
    const storage = makeLocalStorage({
      a: JSON.stringify(1),
      b: JSON.stringify(2),
    });

    const adapter = new LocalStorageAdapter({ storage });
    expect((await adapter.keys()).sort()).toEqual(['a', 'b']);

    await adapter.clear();
    expect(storage._dump().size).toBe(0);
  });
});
