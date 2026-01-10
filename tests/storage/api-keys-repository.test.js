/**
 * @file tests/storage/api-keys-repository.test.js
 * @description js/storage/repositories/api-keys-repository.js migration/unit tests
 */

import { describe, expect, it, vi } from 'vitest';

import { MemoryAdapter } from '../../js/storage/adapters/memory-adapter.js';
import { ApiKeysRepository } from '../../js/storage/repositories/api-keys-repository.js';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('storage/repositories/api-keys-repository (ApiKeysRepository)', () => {
  it('migrates string[] keys to object[] keys and persists the new format', async () => {
    const adapter = new MemoryAdapter();
    await adapter.set('translationModelKeys', { openai: ['sk-1', 'sk-2'] });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const repo = new ApiKeysRepository(adapter);

    const keys = await repo.loadModelKeys('openai');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Migrating keys for model openai'));
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.value)).toEqual(['sk-1', 'sk-2']);
    expect(keys.map((k) => k.order)).toEqual([0, 1]);
    expect(keys.every((k) => typeof k.id === 'string' && UUID_V4_REGEX.test(k.id))).toBe(true);

    const stored = await adapter.get('translationModelKeys');
    expect(stored.openai[0]).toHaveProperty('value', 'sk-1');
    expect(stored.openai[0]).toHaveProperty('status', 'untested');
  });

  it('merges legacy tongyi* model keys into tongyi', async () => {
    const adapter = new MemoryAdapter();
    await adapter.set('translationModelKeys', {
      'tongyi-deepseek-v3': ['k1'],
      'tongyi-qwen-turbo': ['k2'],
    });

    const repo = new ApiKeysRepository(adapter);
    const keys = await repo.loadModelKeys('tongyi');

    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.value)).toEqual(['k1', 'k2']);
    expect(keys.map((k) => k.order)).toEqual([0, 1]);

    const stored = await adapter.get('translationModelKeys');
    expect(stored.tongyi).toHaveLength(2);
  });

  it('migrates very old mistralApiKeys newline string', async () => {
    const adapter = new MemoryAdapter();
    await adapter.set('mistralApiKeys', 'm1\n\nm2\n');
    await adapter.set('translationModelKeys', {});

    const repo = new ApiKeysRepository(adapter);
    const keys = await repo.loadModelKeys('mistral');

    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.value)).toEqual(['m1', 'm2']);
    expect(keys.map((k) => k.order)).toEqual([0, 1]);

    const stored = await adapter.get('translationModelKeys');
    expect(stored.mistral).toHaveLength(2);
  });

  it('migrates very old translationApiKeys newline string for non-custom models', async () => {
    const adapter = new MemoryAdapter();
    await adapter.set('translationApiKeys', 't1\nt2');
    await adapter.set('translationModelKeys', {});

    const repo = new ApiKeysRepository(adapter);
    const keys = await repo.loadModelKeys('openai');

    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.value)).toEqual(['t1', 't2']);

    const stored = await adapter.get('translationModelKeys');
    expect(stored.openai).toHaveLength(2);
  });
});

