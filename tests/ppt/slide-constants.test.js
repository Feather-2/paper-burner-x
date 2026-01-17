import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';

test("Slide Constants: element type validation + normalization", async () => {
  const { SlideElementType, isValidSlideElementType, normalizeSlideElementType } = await import("../../js/ppt/core/slide-constants.js");

  expect(isValidSlideElementType(SlideElementType.TEXT)).toBe(true);
  expect(isValidSlideElementType(SlideElementType.BAKED_ELEMENT)).toBe(true);
  expect(isValidSlideElementType("unknown")).toBe(false);

  expect(normalizeSlideElementType("SVG")).toBe(SlideElementType.SVG);
  expect(normalizeSlideElementType(" image ")).toBe(SlideElementType.IMAGE);
  expect(normalizeSlideElementType("unknown")).toBe(undefined);
});
