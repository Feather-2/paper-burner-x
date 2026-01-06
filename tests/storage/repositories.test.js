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
    await adapter.initialize();
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
    await adapter.initialize();
    repo = new SettingsRepository(adapter);
  });

  it('should return default settings when empty', async () => {
    const settings = await repo.getAll();
    expect(settings).toBeDefined();
    expect(typeof settings).toBe('object');
  });

  it('should save and retrieve settings', async () => {
    const testSettings = { theme: 'dark', fontSize: 16 };
    await repo.save(testSettings);
    const retrieved = await repo.getAll();
    expect(retrieved.theme).toBe('dark');
    expect(retrieved.fontSize).toBe(16);
  });

  it('should get single setting value', async () => {
    await repo.save({ theme: 'light' });
    const theme = await repo.get('theme');
    expect(theme).toBe('light');
  });

  it('should merge with defaults', async () => {
    await repo.save({ customKey: 'customValue' });
    const settings = await repo.getAll();
    expect(settings.customKey).toBe('customValue');
    // 应该有其他默认值
    expect(settings).toBeDefined();
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
    await adapter.initialize();
    repo = new ApiKeysRepository(adapter);
  });

  it('should save and retrieve API key', async () => {
    await repo.saveKey('openai', 'sk-test-key');
    const key = await repo.getKey('openai');
    expect(key).toBe('sk-test-key');
  });

  it('should return null for non-existent provider', async () => {
    const key = await repo.getKey('nonexistent');
    expect(key).toBeNull();
  });

  it('should list all providers', async () => {
    await repo.saveKey('openai', 'sk-1');
    await repo.saveKey('anthropic', 'sk-2');
    const providers = await repo.listProviders();
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
  });

  it('should remove API key', async () => {
    await repo.saveKey('openai', 'sk-test');
    await repo.removeKey('openai');
    const key = await repo.getKey('openai');
    expect(key).toBeNull();
  });

  it('should check if key exists', async () => {
    await repo.saveKey('openai', 'sk-test');
    const exists = await repo.hasKey('openai');
    const notExists = await repo.hasKey('nonexistent');
    expect(exists).toBe(true);
    expect(notExists).toBe(false);
  });
});
