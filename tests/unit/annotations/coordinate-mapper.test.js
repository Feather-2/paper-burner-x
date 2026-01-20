/**
 * @file tests/annotations/coordinate-mapper.test.js
 * @description 坐标映射器纯函数测试
 */

import { describe, it, expect } from 'vitest';

// 动态导入
const loadModules = async () => {
  const mapper = await import('../../../js/annotations/core/coordinate-mapper.js');
  return mapper;
};

describe('normalizeOffset', () => {
  it('should return offset within range', async () => {
    const { normalizeOffset } = await loadModules();
    expect(normalizeOffset(5, 10)).toBe(5);
  });

  it('should clamp offset beyond maxLength', async () => {
    const { normalizeOffset } = await loadModules();
    expect(normalizeOffset(20, 10)).toBe(10);
  });

  it('should clamp negative offset to 0', async () => {
    const { normalizeOffset } = await loadModules();
    expect(normalizeOffset(-3, 10)).toBe(0);
  });
});

describe('buildNormalizedText', () => {
  it('should keep ordinary text unchanged', async () => {
    const { buildNormalizedText } = await loadModules();
    const { norm, map } = buildNormalizedText('hello');

    expect(norm).toBe('hello');
    expect(map).toEqual([0, 1, 2, 3, 4]);
  });

  it('should remove whitespace characters and keep index map', async () => {
    const { buildNormalizedText } = await loadModules();
    const text = 'a b\tc\n';
    const { norm, map } = buildNormalizedText(text);

    expect(norm).toBe('abc');
    expect(map).toEqual([0, 2, 4]);
  });

  it('should remove zero-width characters (\\u200B-\\u200D, \\uFEFF)', async () => {
    const { buildNormalizedText } = await loadModules();
    const text = `a\u200Bb\u200Cc\u200Dd\uFEFFe`;
    const { norm, map } = buildNormalizedText(text);

    expect(norm).toBe('abcde');
    expect(map).toEqual([0, 2, 4, 6, 8]);
  });
});

describe('recalibrateWithExact', () => {
  it('should recalibrate when exactText matches directly', async () => {
    const { recalibrateWithExact } = await loadModules();
    const texts = ['hello world', '!!'];
    const subBlockIds = ['a', 'b'];

    const result = recalibrateWithExact('world', texts, subBlockIds);

    expect(result).toEqual({
      startId: 'a',
      endId: 'a',
      startOffset: 6,
      endOffset: 11
    });
  });

  it('should match while ignoring whitespace differences', async () => {
    const { recalibrateWithExact } = await loadModules();
    const texts = ['hello\n', 'world'];
    const subBlockIds = ['a', 'b'];

    const result = recalibrateWithExact('hello world', texts, subBlockIds);

    expect(result).toEqual({
      startId: 'a',
      endId: 'b',
      startOffset: 0,
      endOffset: 5
    });
  });

  it('should match across sub-block boundaries', async () => {
    const { recalibrateWithExact } = await loadModules();
    const texts = ['hello', 'world'];
    const subBlockIds = ['a', 'b'];

    const result = recalibrateWithExact('lowo', texts, subBlockIds);

    expect(result).toEqual({
      startId: 'a',
      endId: 'b',
      startOffset: 3,
      endOffset: 2
    });
  });

  it('should return null when no match is found', async () => {
    const { recalibrateWithExact } = await loadModules();
    const texts = ['abc', 'def'];
    const subBlockIds = ['a', 'b'];

    expect(recalibrateWithExact('zzz', texts, subBlockIds)).toBeNull();
  });
});

