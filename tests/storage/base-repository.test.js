/**
 * @file tests/storage/base-repository.test.js
 * @description js/storage/repositories/base-repository.js unit tests
 */

import { describe, expect, it } from 'vitest';

import { MemoryAdapter } from '../../js/storage/adapters/memory-adapter.js';
import { BaseRepository } from '../../js/storage/repositories/base-repository.js';

describe('storage/repositories/base-repository (BaseRepository)', () => {
  it('throws when adapter is missing', () => {
    expect(() => new BaseRepository()).toThrow('BaseRepository: adapter is required');
  });

  it('accepts BaseStorageAdapter instances without duck-typing checks', () => {
    const adapter = new MemoryAdapter();
    const repo = new BaseRepository(adapter);
    expect(repo.adapter).toBe(adapter);
  });

  it('accepts duck-typed adapters implementing the required methods', () => {
    const adapter = {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      keys: async () => [],
      clear: async () => {},
    };

    const repo = new BaseRepository(adapter);
    expect(repo.adapter).toBe(adapter);
  });

  it('rejects duck-typed adapters missing required methods', () => {
    expect(() => new BaseRepository({})).toThrow('adapter.get() is required');
    expect(
      () =>
        new BaseRepository({
          get: async () => null,
          set: async () => {},
          remove: async () => {},
          keys: async () => [],
        }),
    ).toThrow('adapter.clear() is required');
  });
});

