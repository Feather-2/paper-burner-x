/**
 * @file tests/ppt/core/slide-constants.test.js
 * @description js/ppt/core/slide-constants.js unit tests
 */

import { describe, expect, it } from 'vitest';

import {
  SlideElementType,
  isValidSlideElementType,
  normalizeSlideElementType,
} from '../../../js/ppt/core/slide-constants.js';

describe('ppt/core/slide-constants', () => {
  it('isValidSlideElementType accepts only known types', () => {
    expect(isValidSlideElementType(SlideElementType.TEXT)).toBe(true);
    expect(isValidSlideElementType('not-a-type')).toBe(false);
    expect(isValidSlideElementType(undefined)).toBe(false);
  });

  it('normalizeSlideElementType lowercases and trims, otherwise returns fallback', () => {
    expect(normalizeSlideElementType(' TEXT ')).toBe('text');
    expect(normalizeSlideElementType('NotAType')).toBeUndefined();
    expect(normalizeSlideElementType('NotAType', 'text')).toBe('text');
    expect(normalizeSlideElementType(null, null)).toBe(null);
  });
});

