import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';

test("Design Preferences: enums + normalization", async () => {
  const {
    DesignVisualMode,
    DesignDensity,
    StyleReferenceStatus,
    normalizeDesignVisualMode,
    normalizeDesignDensity,
    normalizeStyleReferenceStatus,
  } = await import("../../../js/ppt/design/design-preferences.js");

  expect(normalizeDesignVisualMode("SVG-FIRST")).toBe(DesignVisualMode.SVG_FIRST);
  expect(normalizeDesignVisualMode("unknown", DesignVisualMode.AI_FIRST)).toBe(DesignVisualMode.AI_FIRST);

  expect(normalizeDesignDensity("compact")).toBe(DesignDensity.COMPACT);
  expect(normalizeDesignDensity("wide", DesignDensity.BALANCED)).toBe(DesignDensity.BALANCED);

  expect(normalizeStyleReferenceStatus("DONE")).toBe(StyleReferenceStatus.DONE);
  expect(normalizeStyleReferenceStatus("bad", StyleReferenceStatus.ERROR)).toBe(StyleReferenceStatus.ERROR);
});
