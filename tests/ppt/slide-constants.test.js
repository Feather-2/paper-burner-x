import test from 'node:test';
import assert from 'node:assert/strict';

test("Slide Constants: element type validation + normalization", async () => {
  const { SlideElementType, isValidSlideElementType, normalizeSlideElementType } = await import("../../js/ppt/core/slide-constants.js");

  assert.equal(isValidSlideElementType(SlideElementType.TEXT), true);
  assert.equal(isValidSlideElementType(SlideElementType.BAKED_ELEMENT), true);
  assert.equal(isValidSlideElementType("unknown"), false);

  assert.equal(normalizeSlideElementType("SVG"), SlideElementType.SVG);
  assert.equal(normalizeSlideElementType(" image "), SlideElementType.IMAGE);
  assert.equal(normalizeSlideElementType("unknown"), undefined);
});
