/**
 * @file tests/history/text-fitting.test.js
 * @description js/history/modules/TextFitting.js unit tests (pure logic)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TextFittingAdapter from '../../js/history/modules/TextFitting.js';

describe('history/modules/TextFitting (TextFittingAdapter)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('_calculateOptimalScale returns 0.5 when text contains formulas', () => {
    const adapter = new TextFittingAdapter();

    expect(adapter._calculateOptimalScale('E=$mc^2$', 1, 1)).toBe(0.5);
    expect(adapter._calculateOptimalScale('$$x+y$$', 1, 1)).toBe(0.5);
  });

  it('_calculateMode rounds to 0.05 and keeps earliest mode on ties', () => {
    const adapter = new TextFittingAdapter({ globalFontScale: 0.9 });

    expect(adapter._calculateMode([])).toBe(0.9);

    // 0.71, 0.72 -> 0.70; 0.74, 0.76 -> 0.75 (tie => keep 0.70)
    expect(adapter._calculateMode([0.71, 0.72, 0.74, 0.76])).toBe(0.7);
  });

  it('_calculatePercentile interpolates and validates inputs', () => {
    const adapter = new TextFittingAdapter({ globalFontScale: 0.88 });

    expect(adapter._calculatePercentile([1, 2, 3, 4], 0)).toBe(1);
    expect(adapter._calculatePercentile([1, 2, 3, 4], 1)).toBe(4);
    expect(adapter._calculatePercentile([1, 2, 3, 4], 0.5)).toBe(2.5);

    expect(adapter._calculatePercentile([], 0.6)).toBe(0.88);
    expect(adapter._calculatePercentile([1, 2, 3], -0.1)).toBe(0.88);
    expect(console.warn).toHaveBeenCalledWith('[TextFittingAdapter] 百分位参数超出范围，使用默认值');
  });

  it('preprocessGlobalFontSizes caches per-index font sizes and is idempotent', () => {
    const adapter = new TextFittingAdapter();

    const contentListJson = [
      { type: 'text', bbox: [0, 0, 1000, 1000] },
      { type: 'text', bbox: [0, 0, 1000, 500] },
      { type: 'image', bbox: [0, 0, 1000, 1000] },
      { type: 'text' }, // missing bbox => ignored
    ];

    const translatedContentList = [
      { text: 'Short title' },
      { text: 'This is a longer body paragraph that should not be treated as short text by the heuristic.' },
      { text: 'ignored image translation' },
      { text: 'ignored missing bbox' },
    ];

    adapter.preprocessGlobalFontSizes(contentListJson, translatedContentList);

    expect(adapter.hasPreprocessed).toBe(true);
    expect(adapter.globalFontSizeCache.size).toBe(2);
    expect(adapter.globalFontSizeCache.has(0)).toBe(true);
    expect(adapter.globalFontSizeCache.has(1)).toBe(true);

    const cached0 = adapter.globalFontSizeCache.get(0);
    const cached1 = adapter.globalFontSizeCache.get(1);

    expect(cached0).toEqual(expect.objectContaining({ estimatedFontSize: expect.any(Number), bbox: contentListJson[0].bbox }));
    expect(cached1).toEqual(expect.objectContaining({ estimatedFontSize: expect.any(Number), bbox: contentListJson[1].bbox }));

    // Idempotent: second call is a no-op.
    const sizeBefore = adapter.globalFontSizeCache.size;
    adapter.preprocessGlobalFontSizes([], []);
    expect(adapter.globalFontSizeCache.size).toBe(sizeBefore);
  });

  it('clearCache resets caches and preprocessing flag', () => {
    const adapter = new TextFittingAdapter();
    adapter.globalFontSizeCache.set(0, { estimatedFontSize: 1, bbox: [0, 0, 1, 1] });
    adapter.hasPreprocessed = true;
    adapter._formulaCache.set('x', 'y');

    adapter.clearCache();

    expect(adapter.globalFontSizeCache.size).toBe(0);
    expect(adapter._formulaCache.size).toBe(0);
    expect(adapter.hasPreprocessed).toBe(false);
  });
});

