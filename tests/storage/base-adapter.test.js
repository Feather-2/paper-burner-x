import { describe, expect, it } from 'vitest';

import BaseStorageAdapter, { BaseStorageAdapter as NamedBaseStorageAdapter } from '../../js/storage/adapters/base-adapter.js';

describe('storage/adapters/base-adapter (BaseStorageAdapter)', () => {
  it('exports the class as both default and named export', () => {
    expect(BaseStorageAdapter).toBe(NamedBaseStorageAdapter);
  });

  it('throws for all abstract methods by default', async () => {
    const adapter = new BaseStorageAdapter();

    await expect(adapter.get('k')).rejects.toThrow('BaseStorageAdapter.get() not implemented');
    await expect(adapter.set('k', 'v')).rejects.toThrow('BaseStorageAdapter.set() not implemented');
    await expect(adapter.remove('k')).rejects.toThrow('BaseStorageAdapter.remove() not implemented');
    await expect(adapter.keys()).rejects.toThrow('BaseStorageAdapter.keys() not implemented');
    await expect(adapter.clear()).rejects.toThrow('BaseStorageAdapter.clear() not implemented');
  });
});

