/**
 * @file tests/storage/results-repository.test.js
 * @description js/storage/repositories/results-repository.js unit tests
 */

import { describe, expect, it } from 'vitest';

import { MemoryAdapter } from '../../js/storage/adapters/memory-adapter.js';
import { ResultsRepository } from '../../js/storage/repositories/results-repository.js';

describe('storage/repositories/results-repository (ResultsRepository)', () => {
  it('saveResultToDB validates input', async () => {
    const repo = new ResultsRepository(new MemoryAdapter());

    await expect(repo.saveResultToDB(null)).rejects.toThrow('resultObj must be an object');
    await expect(repo.saveResultToDB('nope')).rejects.toThrow('resultObj must be an object');
    await expect(repo.saveResultToDB({})).rejects.toThrow('resultObj.id is required');
  });

  it('getAllResultsFromDB returns [] when adapter.keys is not an array', async () => {
    const repo = new ResultsRepository({
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      keys: async () => 'not-an-array',
      clear: async () => {},
    });

    await expect(repo.getAllResultsFromDB()).resolves.toEqual([]);
  });

  it('getAllResultsFromDB filters out missing values', async () => {
    const repo = new ResultsRepository({
      get: async (id) => (id === 'a' ? { id: 'a', ok: true } : null),
      set: async () => {},
      remove: async () => {},
      keys: async () => ['a', 'b'],
      clear: async () => {},
    });

    await expect(repo.getAllResultsFromDB()).resolves.toEqual([{ id: 'a', ok: true }]);
  });
});

