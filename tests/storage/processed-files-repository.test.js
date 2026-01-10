/**
 * @file tests/storage/processed-files-repository.test.js
 * @description js/storage/repositories/processed-files-repository.js unit tests
 */

import { describe, expect, it, vi } from 'vitest';

import { MemoryAdapter } from '../../js/storage/adapters/memory-adapter.js';
import { ProcessedFilesRepository } from '../../js/storage/repositories/processed-files-repository.js';

describe('storage/repositories/processed-files-repository (ProcessedFilesRepository)', () => {
  it('loadProcessedFilesRecord returns {} when storage is empty', async () => {
    const repo = new ProcessedFilesRepository(new MemoryAdapter());
    await expect(repo.loadProcessedFilesRecord()).resolves.toEqual({});
  });

  it('loadProcessedFilesRecord returns stored object when present', async () => {
    const adapter = new MemoryAdapter();
    await adapter.set('processedFilesRecord', { 'id:a': true });

    const repo = new ProcessedFilesRepository(adapter);
    await expect(repo.loadProcessedFilesRecord()).resolves.toEqual({ 'id:a': true });
  });

  it('loadProcessedFilesRecord resets to {} when adapter.get throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const badAdapter = {
      get: async () => {
        throw new Error('boom');
      },
      set: async () => {},
      remove: async () => {},
      keys: async () => [],
      clear: async () => {},
    };

    const repo = new ProcessedFilesRepository(badAdapter);
    await expect(repo.loadProcessedFilesRecord()).resolves.toEqual({});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ProcessedFilesRepository.loadProcessedFilesRecord'),
      expect.any(Error),
    );
  });

  it('saveProcessedFilesRecord does not throw when adapter.set fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const badAdapter = {
      get: async () => ({}),
      set: async () => {
        throw new Error('write failed');
      },
      remove: async () => {},
      keys: async () => [],
      clear: async () => {},
    };

    const repo = new ProcessedFilesRepository(badAdapter);
    await expect(repo.saveProcessedFilesRecord({ a: true })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ProcessedFilesRepository.saveProcessedFilesRecord'),
      expect.any(Error),
    );
  });

  it('markFileAsProcessed and isAlreadyProcessed work together', () => {
    const repo = new ProcessedFilesRepository(new MemoryAdapter());
    const record = {};

    expect(repo.isAlreadyProcessed('id:a', record)).toBe(false);

    repo.markFileAsProcessed('id:a', record);
    expect(record).toEqual({ 'id:a': true });
    expect(repo.isAlreadyProcessed('id:a', record)).toBe(true);
    expect(repo.isAlreadyProcessed('id:b', record)).toBe(false);
  });
});

