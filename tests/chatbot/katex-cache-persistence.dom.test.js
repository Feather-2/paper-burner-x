// @vitest-environment jsdom
/**
 * @file tests/chatbot/katex-cache-persistence.dom.test.js
 * @description js/chatbot/utils/katex-cache-persistence.js unit tests (jsdom)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let KaTeXCachePersistence;
let STORAGE_CONFIG;

function makeCache(version, initialEntries = []) {
  const state = {
    entries: [...initialEntries],
    hits: 0,
    misses: 0,
  };

  return {
    _state: state,
    export: vi.fn(() => ({ version, entries: [...state.entries] })),
    import: vi.fn((data) => {
      if (!data || data.version !== version || !Array.isArray(data.entries)) return false;
      state.entries = [...data.entries];
      return true;
    }),
    clear: vi.fn(() => {
      state.entries = [];
    }),
    getStats: vi.fn(() => ({ hits: state.hits, misses: state.misses })),
  };
}

describe('chatbot/utils/katex-cache-persistence (KaTeXCachePersistence)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    localStorage.clear();
    document.body.innerHTML = '';

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    delete window.katexCache;
    delete window.katexCachePersistence;
    delete window.KaTeXCachePersistence;

    vi.resetModules();
    const mod = await import('../../js/chatbot/utils/katex-cache-persistence.js');
    KaTeXCachePersistence = mod.KaTeXCachePersistence;
    STORAGE_CONFIG = mod.STORAGE_CONFIG;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('load() returns false when no stored cache exists', () => {
    const cache = makeCache(STORAGE_CONFIG.VERSION, [{ k: 'a' }]);
    const persistence = new KaTeXCachePersistence(cache, { enableAutoSave: false });

    cache.import.mockClear();
    expect(persistence.load()).toBe(false);
    expect(cache.import).not.toHaveBeenCalled();
  });

  it('load() clears storage on version mismatch', () => {
    localStorage.setItem(
      STORAGE_CONFIG.KEY,
      JSON.stringify({
        version: STORAGE_CONFIG.VERSION + 1,
        timestamp: Date.now(),
        cacheData: { version: STORAGE_CONFIG.VERSION, entries: [{ k: 'a' }] },
      }),
    );

    const cache = makeCache(STORAGE_CONFIG.VERSION, [{ k: 'a' }]);
    const persistence = new KaTeXCachePersistence(cache, { enableAutoSave: false });

    expect(localStorage.getItem(STORAGE_CONFIG.KEY)).toBeNull();
    expect(cache.clear).toHaveBeenCalledTimes(1);
    expect(persistence.load()).toBe(false);
  });

  it('load() clears storage when cache is expired', () => {
    const now = Date.now();
    const oldTimestamp = now - 3 * 24 * 60 * 60 * 1000;

    localStorage.setItem(
      STORAGE_CONFIG.KEY,
      JSON.stringify({
        version: STORAGE_CONFIG.VERSION,
        timestamp: oldTimestamp,
        cacheData: { version: STORAGE_CONFIG.VERSION, entries: [{ k: 'a' }] },
      }),
    );

    const cache = makeCache(STORAGE_CONFIG.VERSION, [{ k: 'a' }]);
    const persistence = new KaTeXCachePersistence(cache, { enableAutoSave: false, maxAgeDays: 1 });

    expect(localStorage.getItem(STORAGE_CONFIG.KEY)).toBeNull();
    expect(cache.clear).toHaveBeenCalledTimes(1);
    expect(persistence.load()).toBe(false);
  });

  it('load() imports cache when stored data is valid', () => {
    const stored = {
      version: STORAGE_CONFIG.VERSION,
      timestamp: Date.now(),
      cacheData: { version: STORAGE_CONFIG.VERSION, entries: [{ k: 'a' }, { k: 'b' }] },
    };
    localStorage.setItem(STORAGE_CONFIG.KEY, JSON.stringify(stored));

    const cache = makeCache(STORAGE_CONFIG.VERSION, []);
    const persistence = new KaTeXCachePersistence(cache, { enableAutoSave: false });

    expect(cache.import).toHaveBeenCalledWith(stored.cacheData);
    expect(cache._state.entries).toEqual([{ k: 'a' }, { k: 'b' }]);
  });

  it('save() stores exported cache and updates counters', () => {
    const cache = makeCache(STORAGE_CONFIG.VERSION, [{ k: 'x' }]);
    const persistence = new KaTeXCachePersistence(cache, { enableAutoSave: false });

    persistence.estimateSize = vi.fn(() => 1);

    expect(persistence.saveCount).toBe(0);
    expect(persistence.save()).toBe(true);
    expect(persistence.saveCount).toBe(1);
    expect(persistence.lastSaveTime).toBe(Date.now());

    const stored = JSON.parse(localStorage.getItem(STORAGE_CONFIG.KEY));
    expect(stored).toEqual(
      expect.objectContaining({
        version: STORAGE_CONFIG.VERSION,
        timestamp: expect.any(Number),
        cacheData: expect.objectContaining({ entries: [{ k: 'x' }] }),
      }),
    );
  });

  it('save() prunes oversized cache and retries', () => {
    const cache = makeCache(STORAGE_CONFIG.VERSION, Array.from({ length: 10 }, (_, i) => ({ k: String(i) })));
    const persistence = new KaTeXCachePersistence(cache, { enableAutoSave: false });

    persistence.estimateSize = vi.fn()
      .mockReturnValueOnce(6000) // > 5MB (in KB)
      .mockReturnValueOnce(1);

    expect(persistence.save()).toBe(true);
    expect(cache.import).toHaveBeenCalled();
    expect(cache._state.entries.length).toBe(7); // 70% retained

    const stored = JSON.parse(localStorage.getItem(STORAGE_CONFIG.KEY));
    expect(stored.cacheData.entries).toHaveLength(7);
  });

  it('save() handles QuotaExceededError by clearing cache', () => {
    const cache = makeCache(STORAGE_CONFIG.VERSION, [{ k: 'x' }]);
    const persistence = new KaTeXCachePersistence(cache, { enableAutoSave: false });

    persistence.estimateSize = vi.fn(() => 1);

    const setItemSpy = vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    });

    try {
      expect(persistence.save()).toBe(false);
      expect(cache.clear).toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_CONFIG.KEY)).toBeNull();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('startAutoSave() saves only when cache has activity', async () => {
    const cache = makeCache(STORAGE_CONFIG.VERSION, [{ k: 'x' }]);
    cache.getStats
      .mockReturnValueOnce({ hits: 0, misses: 0 })
      .mockReturnValueOnce({ hits: 1, misses: 0 });

    const persistence = new KaTeXCachePersistence(cache, { enableAutoSave: true, autoSaveInterval: 10 });
    const saveSpy = vi.spyOn(persistence, 'save').mockReturnValue(true);

    await vi.advanceTimersByTimeAsync(10);
    expect(saveSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    persistence.stopAutoSave();
  });
});
