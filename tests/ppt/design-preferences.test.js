import test from 'node:test';
import assert from 'node:assert/strict';

test("Design Preferences: enums + normalization", async () => {
  const {
    DesignVisualMode,
    DesignDensity,
    StyleReferenceStatus,
    normalizeDesignVisualMode,
    normalizeDesignDensity,
    normalizeStyleReferenceStatus,
  } = await import("../../js/ppt/design/design-preferences.js");

  assert.equal(normalizeDesignVisualMode("SVG-FIRST"), DesignVisualMode.SVG_FIRST);
  assert.equal(normalizeDesignVisualMode("unknown", DesignVisualMode.AI_FIRST), DesignVisualMode.AI_FIRST);

  assert.equal(normalizeDesignDensity("compact"), DesignDensity.COMPACT);
  assert.equal(normalizeDesignDensity("wide", DesignDensity.BALANCED), DesignDensity.BALANCED);

  assert.equal(normalizeStyleReferenceStatus("DONE"), StyleReferenceStatus.DONE);
  assert.equal(normalizeStyleReferenceStatus("bad", StyleReferenceStatus.ERROR), StyleReferenceStatus.ERROR);
});
