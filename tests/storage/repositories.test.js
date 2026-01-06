/**
 * @file tests/storage/repositories.test.js
 * @description 存储层 Repository 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// 使用动态导入避免 ESM 问题
const loadModules = async () => {
  const { MemoryAdapter } = await import('../../js/storage/adapters/memory-adapter.js');
  const { SettingsRepository } = await import('../../js/storage/repositories/settings-repository.js');
  const { ApiKeysRepository } = await import('../../js/storage/repositories/api-keys-repository.js');
  return { MemoryAdapter, SettingsRepository, ApiKeysRepository };
};

describe('MemoryAdapter', () => {
  let MemoryAdapter;
  let adapter;

  beforeEach(async () => {
    const modules = await loadModules();
    MemoryAdapter = modules.MemoryAdapter;
    adapter = new MemoryAdapter();
  });

  it('should set and get values', async () => {
    await adapter.set('key1', 'value1');
    const result = await adapter.get('key1');
    expect(result).toBe('value1');
  });

  it('should return null for non-existent keys', async () => {
    const result = await adapter.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should remove values', async () => {
    await adapter.set('key1', 'value1');
    await adapter.remove('key1');
    const result = await adapter.get('key1');
    expect(result).toBeNull();
  });

  it('should list all keys', async () => {
    await adapter.set('key1', 'value1');
    await adapter.set('key2', 'value2');
    const keys = await adapter.keys();
    expect(keys).toContain('key1');
    expect(keys).toContain('key2');
    expect(keys.length).toBe(2);
  });

  it('should clear all values', async () => {
    await adapter.set('key1', 'value1');
    await adapter.set('key2', 'value2');
    await adapter.clear();
    const keys = await adapter.keys();
    expect(keys.length).toBe(0);
  });

  it('should handle complex objects', async () => {
    const obj = { nested: { value: 123 }, array: [1, 2, 3] };
    await adapter.set('complex', obj);
    const result = await adapter.get('complex');
    expect(result).toEqual(obj);
  });
});

describe('SettingsRepository', () => {
  let MemoryAdapter, SettingsRepository;
  let repo;

  beforeEach(async () => {
    const modules = await loadModules();
    MemoryAdapter = modules.MemoryAdapter;
    SettingsRepository = modules.SettingsRepository;
    const adapter = new MemoryAdapter();
    repo = new SettingsRepository(adapter);
  });

  it('should return default settings when empty', async () => {
    const settings = await repo.loadSettings();
    expect(settings).toBeDefined();
    expect(typeof settings).toBe('object');
    // 应有默认值
    expect(settings.targetLanguage).toBe('chinese');
  });

  it('should save and retrieve settings', async () => {
    const testSettings = { targetLanguage: 'english', concurrencyLevel: '5' };
    await repo.saveSettings(testSettings);
    const retrieved = await repo.loadSettings();
    expect(retrieved.targetLanguage).toBe('english');
    expect(retrieved.concurrencyLevel).toBe('5');
  });

  it('should merge with defaults', async () => {
    await repo.saveSettings({ customKey: 'customValue' });
    const settings = await repo.loadSettings();
    expect(settings.customKey).toBe('customValue');
    // 应该保留其他默认值
    expect(settings.targetLanguage).toBe('chinese');
    expect(settings.maxTokensPerChunk).toBe('2000');
  });

  it('should get default settings object', () => {
    const defaults = repo.getDefaultSettings();
    expect(defaults).toBeDefined();
    expect(defaults.targetLanguage).toBe('chinese');
  });
});

describe('ApiKeysRepository', () => {
  let MemoryAdapter, ApiKeysRepository;
  let repo;

  beforeEach(async () => {
    const modules = await loadModules();
    MemoryAdapter = modules.MemoryAdapter;
    ApiKeysRepository = modules.ApiKeysRepository;
    const adapter = new MemoryAdapter();
    repo = new ApiKeysRepository(adapter);
  });

  it('should save and load model keys', async () => {
    const keys = [
      { id: '1', value: 'sk-test-key', remark: '', status: 'untested', order: 0 }
    ];
    await repo.saveModelKeys('openai', keys);
    const loaded = await repo.loadModelKeys('openai');
    expect(loaded.length).toBe(1);
    expect(loaded[0].value).toBe('sk-test-key');
  });

  it('should return empty array for non-existent model', async () => {
    const keys = await repo.loadModelKeys('nonexistent');
    expect(keys).toEqual([]);
  });

  it('should save keys for multiple models', async () => {
    await repo.saveModelKeys('openai', [{ id: '1', value: 'sk-1', order: 0 }]);
    await repo.saveModelKeys('anthropic', [{ id: '2', value: 'sk-2', order: 0 }]);

    const openaiKeys = await repo.loadModelKeys('openai');
    const anthropicKeys = await repo.loadModelKeys('anthropic');

    expect(openaiKeys[0].value).toBe('sk-1');
    expect(anthropicKeys[0].value).toBe('sk-2');
  });

  it('should preserve existing keys when saving new model', async () => {
    await repo.saveModelKeys('openai', [{ id: '1', value: 'sk-1', order: 0 }]);
    await repo.saveModelKeys('anthropic', [{ id: '2', value: 'sk-2', order: 0 }]);

    // OpenAI keys should still exist
    const openaiKeys = await repo.loadModelKeys('openai');
    expect(openaiKeys.length).toBe(1);
  });

  it('should sort keys by order', async () => {
    const keys = [
      { id: '1', value: 'third', order: 2 },
      { id: '2', value: 'first', order: 0 },
      { id: '3', value: 'second', order: 1 }
    ];
    await repo.saveModelKeys('openai', keys);
    const loaded = await repo.loadModelKeys('openai');
    expect(loaded[0].value).toBe('first');
    expect(loaded[1].value).toBe('second');
    expect(loaded[2].value).toBe('third');
  });
});
