import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedStorageFacade = vi.hoisted(() => ({
  storage: {
    apiKeys: {
      getKeysForModel: vi.fn(),
      markKeyInvalid: vi.fn(),
    },
  },
}));

vi.mock('../../js/storage/storage-facade.js', () => ({
  storage: mockedStorageFacade.storage,
}));

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
  };
}

async function loadKeyProviderModule() {
  return await import('../../js/core/api/key-provider.js');
}

describe('core/api/key-provider (KeyProvider)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockReset();
    mockedStorageFacade.storage.apiKeys.markKeyInvalid.mockReset();

    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([]);
    mockedStorageFacade.storage.apiKeys.markKeyInvalid.mockResolvedValue(undefined);

    globalThis.localStorage = makeLocalStorage();
    Reflect.deleteProperty(globalThis, 'window');

    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('filters available keys (valid/untested) and rotates round-robin', async () => {
    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([
      { id: 'k1', value: 'v1', status: 'valid' },
      { id: 'k2', value: 'v2', status: 'invalid' },
      { id: 'k3', value: 'v3', status: 'untested' },
    ]);

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    expect(provider.hasAvailableKeys()).toBe(false);
    expect(provider.getAvailableCount()).toBe(0);

    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'k1' });
    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'k3' });
    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'k1' });

    expect(provider.getAvailableCount()).toBe(2);
    expect(provider.hasAvailableKeys()).toBe(true);

    expect(mockedStorageFacade.storage.apiKeys.getKeysForModel).toHaveBeenCalledTimes(1);
    expect(mockedStorageFacade.storage.apiKeys.getKeysForModel).toHaveBeenCalledWith('openai');
  });

  it('starts with the last successful key for the model when available', async () => {
    globalThis.localStorage.setItem(
      'paperBurnerLastSuccessfulKeys',
      JSON.stringify({ openai: 'k2' }),
    );

    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([
      { id: 'k1', value: 'v1', status: 'valid' },
      { id: 'k2', value: 'v2', status: 'valid' },
      { id: 'k3', value: 'v3', status: 'untested' },
    ]);

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    const first = await provider.getNextKey();
    const second = await provider.getNextKey();

    expect(first.id).toBe('k2');
    expect(second.id).toBe('k3');
  });

  it('ignores the last successful key when it is not available', async () => {
    globalThis.localStorage.setItem(
      'paperBurnerLastSuccessfulKeys',
      JSON.stringify({ openai: 'k2' }),
    );

    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([
      { id: 'k1', value: 'v1', status: 'valid' },
      { id: 'k2', value: 'v2', status: 'invalid' },
      { id: 'k3', value: 'v3', status: 'valid' },
    ]);

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'k1' });
  });

  it('recordSuccess stores the last successful key per-model', async () => {
    globalThis.localStorage.setItem(
      'paperBurnerLastSuccessfulKeys',
      JSON.stringify({ otherModel: 'k0' }),
    );

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    await provider.recordSuccess('k9');

    const stored = JSON.parse(globalThis.localStorage.getItem('paperBurnerLastSuccessfulKeys'));
    expect(stored).toEqual({ otherModel: 'k0', openai: 'k9' });
  });

  it('ignores invalid JSON in last-successful key storage', async () => {
    globalThis.localStorage.setItem('paperBurnerLastSuccessfulKeys', 'not-json');

    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([
      { id: 'k1', value: 'v1', status: 'valid' },
      { id: 'k2', value: 'v2', status: 'valid' },
    ]);

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'k1' });
  });

  it('recordSuccess warns but does not throw when stored JSON is invalid', async () => {
    globalThis.localStorage.setItem('paperBurnerLastSuccessfulKeys', 'not-json');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    await expect(provider.recordSuccess('k1')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to record success'),
      expect.anything(),
    );
    expect(globalThis.localStorage.getItem('paperBurnerLastSuccessfulKeys')).toBe('not-json');
  });

  it('markKeyAsInvalid removes key from rotation, persists, and refreshes UI', async () => {
    globalThis.window = {
      refreshKeyManagerForModel: vi.fn(),
    };

    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([
      { id: 'k1', value: 'v1', status: 'valid' },
      { id: 'k2', value: 'v2', status: 'valid' },
      { id: 'k3', value: 'v3', status: 'valid' },
    ]);

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    const first = await provider.getNextKey();
    expect(first.id).toBe('k1');

    await provider.markKeyAsInvalid('k1');

    expect(mockedStorageFacade.storage.apiKeys.markKeyInvalid).toHaveBeenCalledTimes(1);
    expect(mockedStorageFacade.storage.apiKeys.markKeyInvalid).toHaveBeenCalledWith('openai', 'k1');

    expect(provider.keys.find((k) => k.id === 'k1')?.status).toBe('invalid');
    expect(provider.availableKeys.map((k) => k.id)).toEqual(['k2', 'k3']);
    expect(provider.getAvailableCount()).toBe(2);

    expect(globalThis.window.refreshKeyManagerForModel).toHaveBeenCalledTimes(1);
    expect(globalThis.window.refreshKeyManagerForModel).toHaveBeenCalledWith('openai', 'k1', 'invalid');

    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'k2' });
  });

  it('markKeyAsInvalid adjusts currentIndex when removing a lower index', async () => {
    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([
      { id: 'k1', value: 'v1', status: 'valid' },
      { id: 'k2', value: 'v2', status: 'valid' },
      { id: 'k3', value: 'v3', status: 'valid' },
    ]);

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    await provider.init();
    provider.currentIndex = 2;

    await provider.markKeyAsInvalid('k1');
    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'k3' });
  });

  it('markKeyAsInvalid falls back to window.saveModelKeys when repository update fails', async () => {
    globalThis.window = {
      saveModelKeys: vi.fn(async () => {}),
      refreshKeyManagerForModel: vi.fn(),
    };

    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([
      { id: 'k1', value: 'v1', status: 'valid' },
      { id: 'k2', value: 'v2', status: 'valid' },
    ]);
    mockedStorageFacade.storage.apiKeys.markKeyInvalid.mockRejectedValue(new Error('write failed'));

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    await provider.init();
    await provider.markKeyAsInvalid('k1');

    expect(globalThis.window.saveModelKeys).toHaveBeenCalledTimes(1);
    expect(globalThis.window.saveModelKeys).toHaveBeenCalledWith(
      'openai',
      expect.arrayContaining([expect.objectContaining({ id: 'k1', status: 'invalid' })]),
    );
    expect(globalThis.window.refreshKeyManagerForModel).toHaveBeenCalledWith('openai', 'k1', 'invalid');
  });

  it('falls back to window.loadModelKeys when repository is empty', async () => {
    globalThis.window = {
      loadModelKeys: vi.fn(() => [
        { id: 'wk1', value: 'wv1', status: 'valid' },
        { id: 'wk2', value: 'wv2', status: 'invalid' },
      ]),
    };

    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([]);

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'wk1' });
    expect(globalThis.window.loadModelKeys).toHaveBeenCalledTimes(1);
    expect(globalThis.window.loadModelKeys).toHaveBeenCalledWith('openai');
  });

  it('getNextKey returns null when no keys are available', async () => {
    mockedStorageFacade.storage.apiKeys.getKeysForModel.mockResolvedValue([
      { id: 'k1', value: 'v1', status: 'invalid' },
      { id: 'k2', value: 'v2', status: 'invalid' },
    ]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    await expect(provider.getNextKey()).resolves.toBe(null);
    expect(provider.hasAvailableKeys()).toBe(false);
    expect(provider.getAvailableCount()).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No available keys'));
  });

  it('reload clears initialization and reloads keys', async () => {
    mockedStorageFacade.storage.apiKeys.getKeysForModel
      .mockResolvedValueOnce([{ id: 'k1', value: 'v1', status: 'valid' }])
      .mockResolvedValueOnce([{ id: 'k2', value: 'v2', status: 'valid' }]);

    const { KeyProvider } = await loadKeyProviderModule();
    const provider = new KeyProvider('openai');

    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'k1' });
    expect(provider.getAvailableCount()).toBe(1);

    await provider.reload();
    await expect(provider.getNextKey()).resolves.toMatchObject({ id: 'k2' });
    expect(mockedStorageFacade.storage.apiKeys.getKeysForModel).toHaveBeenCalledTimes(2);
  });
});
