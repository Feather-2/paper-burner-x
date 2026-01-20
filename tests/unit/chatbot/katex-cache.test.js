/**
 * @file tests/chatbot/katex-cache.test.js
 * @description KaTeX 缓存系统单元测试（LRUCache / KaTeXCache）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 动态导入 ESM 模块
const loadModules = async () => {
  const mod = await import('../../../js/chatbot/utils/katex-cache.js');
  return mod;
};

describe('LRUCache', () => {
  let LRUCache;

  beforeEach(async () => {
    const mod = await loadModules();
    LRUCache = mod.LRUCache;
  });

  it('should support basic get/set operations', () => {
    const cache = new LRUCache(10);

    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);

    expect(cache.get('missing')).toBeNull();

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it('should evict least recently used entry when maxSize exceeded', () => {
    const cache = new LRUCache(2);

    cache.set('a', 'A');
    cache.set('b', 'B');

    // Touch 'a' so that 'b' becomes least recently used
    expect(cache.get('a')).toBe('A');

    cache.set('c', 'C'); // should evict 'b'

    expect(cache.cache.size).toBe(2);
    expect(cache.cache.has('b')).toBe(false);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe('A');
    expect(cache.get('c')).toBe('C');

    const stats = cache.getStats();
    expect(stats.evictions).toBe(1);
  });

  it('should report getStats correctly', () => {
    const cache = new LRUCache(3);

    cache.set('a', 1);
    cache.set('b', 2);

    // 2 hits
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
    // 1 miss
    expect(cache.get('c')).toBeNull();

    const stats = cache.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(3);
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe('66.7%');
    expect(stats.avgRenderTime).toMatch(/ms$/);
    expect(stats.avgCacheTime).toMatch(/ms$/);
  });

  it('should clear cache and reset stats', () => {
    const cache = new LRUCache(2);

    cache.set('a', 1);
    cache.get('a');
    cache.get('missing');

    cache.clear();

    expect(cache.cache.size).toBe(0);

    const stats = cache.getStats();
    expect(stats.size).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.evictions).toBe(0);
    expect(stats.hitRate).toBe('0.0%');
    expect(stats.avgRenderTime).toBe('0ms');
    expect(stats.avgCacheTime).toBe('0ms');
  });
});

describe('KaTeXCache', () => {
  let KaTeXCache;

  beforeEach(async () => {
    const mod = await loadModules();
    KaTeXCache = mod.KaTeXCache;

    globalThis.katex = {
      renderToString: vi.fn((tex) => `<span class="katex">${tex}</span>`)
    };
  });

  afterEach(() => {
    delete globalThis.katex;
  });

  it('should generate cache keys based on tex + key options', () => {
    const cache = new KaTeXCache();

    expect(cache.generateKey('x+y', { displayMode: true, output: 'html' }))
      .toBe('1:html:x+y');
    expect(cache.generateKey('x+y', { displayMode: false, output: 'mathml' }))
      .toBe('0:mathml:x+y');
    expect(cache.generateKey('x+y', { displayMode: false }))
      .toBe('0:html:x+y');
  });

  it('should cache render results (miss then hit) using mocked katex', () => {
    const cache = new KaTeXCache({ maxSize: 100, enableMonitoring: false });

    const result1 = cache.render('E=mc^2', { displayMode: false });
    expect(result1).toBe('<span class="katex">E=mc^2</span>');
    expect(katex.renderToString).toHaveBeenCalledTimes(1);

    const result2 = cache.render('E=mc^2', { displayMode: false });
    expect(result2).toBe(result1);
    expect(katex.renderToString).toHaveBeenCalledTimes(1);

    const stats = cache.getStats();
    expect(stats.size).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe('50.0%');
  });

  it('should export and import cache entries for persistence', () => {
    const cache1 = new KaTeXCache({ maxSize: 100, enableMonitoring: false });
    const rendered = cache1.render('\\frac{1}{2}', { displayMode: true });
    expect(rendered).toBe('<span class="katex">\\frac{1}{2}</span>');

    const exported = cache1.export();
    expect(exported.version).toBe(1);
    expect(Array.isArray(exported.entries)).toBe(true);

    // New instance restores entries
    const cache2 = new KaTeXCache({ maxSize: 100, enableMonitoring: false });
    const ok = cache2.import(exported);
    expect(ok).toBe(true);

    katex.renderToString.mockClear();

    const restored = cache2.render('\\frac{1}{2}', { displayMode: true });
    expect(restored).toBe(rendered);
    expect(katex.renderToString).toHaveBeenCalledTimes(0);

    const stats = cache2.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe('100.0%');
  });

  it('should reject invalid import data', () => {
    const cache = new KaTeXCache();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(cache.import({ version: 999 })).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

