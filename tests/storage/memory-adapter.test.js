/**
 * @file tests/storage/memory-adapter.test.js
 * @description js/storage/adapters/memory-adapter.js unit tests
 */

import { describe, expect, it } from 'vitest';

import { MemoryAdapter } from '../../js/storage/adapters/memory-adapter.js';

describe('storage/adapters/memory-adapter (MemoryAdapter)', () => {
  it('initializes from Map', async () => {
    const initial = new Map([
      ['a', 1],
      ['b', { ok: true }],
    ]);
    const adapter = new MemoryAdapter({ initial });

    await expect(adapter.get('a')).resolves.toBe(1);
    await expect(adapter.get('b')).resolves.toEqual({ ok: true });
    await expect(adapter.get('missing')).resolves.toBeNull();
  });

  it('initializes from entries array', async () => {
    const adapter = new MemoryAdapter({ initial: [['a', 1]] });
    await expect(adapter.get('a')).resolves.toBe(1);
  });

  it('initializes from plain object', async () => {
    const adapter = new MemoryAdapter({ initial: { a: 1 } });
    await expect(adapter.get('a')).resolves.toBe(1);
  });

  it('set(undefined) removes the key', async () => {
    const adapter = new MemoryAdapter();
    await adapter.set('a', 1);
    await adapter.set('a', undefined);
    await expect(adapter.get('a')).resolves.toBeNull();
  });
});

