export const DesignVisualMode = Object.freeze({
  AI_FIRST: "ai-first",
  SVG_FIRST: "svg-first",
  BALANCED: "balanced",
});

export const DesignDensity = Object.freeze({
  COMPACT: "compact",
  BALANCED: "balanced",
  SPACIOUS: "spacious",
});

export const StyleReferenceStatus = Object.freeze({
  ANALYZING: "analyzing",
  DONE: "done",
  ERROR: "error",
});

const VALID_VISUAL_MODES = Object.freeze(new Set(Object.values(DesignVisualMode)));
const VALID_DENSITIES = Object.freeze(new Set(Object.values(DesignDensity)));
const VALID_STYLE_REFERENCE_STATUSES = Object.freeze(new Set(Object.values(StyleReferenceStatus)));

export function isValidDesignVisualMode(value) {
  return VALID_VISUAL_MODES.has(value);
}

export function isValidDesignDensity(value) {
  return VALID_DENSITIES.has(value);
}

export function isValidStyleReferenceStatus(value) {
  return VALID_STYLE_REFERENCE_STATUSES.has(value);
}

export function normalizeDesignVisualMode(value, fallback = DesignVisualMode.BALANCED) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_VISUAL_MODES.has(v) ? v : fallback;
}

export function normalizeDesignDensity(value, fallback = DesignDensity.BALANCED) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_DENSITIES.has(v) ? v : fallback;
}

export function normalizeStyleReferenceStatus(value, fallback = StyleReferenceStatus.ANALYZING) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_STYLE_REFERENCE_STATUSES.has(v) ? v : fallback;
}

if (typeof globalThis !== "undefined") {
  const existing = globalThis.PPTDesignPreferences && typeof globalThis.PPTDesignPreferences === "object"
    ? globalThis.PPTDesignPreferences
    : null;
  globalThis.PPTDesignPreferences = {
    ...(existing || {}),
    DesignVisualMode,
    DesignDensity,
    StyleReferenceStatus,
    isValidDesignVisualMode,
    isValidDesignDensity,
    isValidStyleReferenceStatus,
    normalizeDesignVisualMode,
    normalizeDesignDensity,
    normalizeStyleReferenceStatus,
  };
}
