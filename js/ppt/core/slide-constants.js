export const SlideElementType = Object.freeze({
  TEXT: "text",
  SHAPE: "shape",
  IMAGE: "image",
  ICON: "icon",
  LINE: "line",
  CHART: "chart",
  FORMULA: "formula",
  GROUP: "group",
  CARD: "card",
  SVG: "svg",
  TABLE: "table",
  LIST: "list",
  BAKED_ELEMENT: "baked_element",
});

const VALID_SLIDE_ELEMENT_TYPES = Object.freeze(new Set(Object.values(SlideElementType)));

export function isValidSlideElementType(value) {
  return VALID_SLIDE_ELEMENT_TYPES.has(value);
}

export function normalizeSlideElementType(value, fallback = undefined) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_SLIDE_ELEMENT_TYPES.has(v) ? v : fallback;
}
