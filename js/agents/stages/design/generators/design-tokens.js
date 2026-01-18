import { isPlainObject } from "../../../shared/utils/value-utils.js";

// Design tokens generator for Design stage.
//
// Contract (tests + docs):
//   generateDesignTokens(constraints) -> DesignSystem
//   DesignSystem: { theme, visualPreference?, designTokens: { colors, typography, spacing, grid, visualPreference? } }
//
// Extensions (design system dynamic generation):
//   validateDesignSystem(system) -> { ok:boolean, errors:string[] }

function normalizeTheme(theme) {
  const t = String(theme || "auto").toLowerCase();
  if (t === "light" || t === "dark" || t === "colorful" || t === "auto") return t;
  return "auto";
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function safeMarginPctFromConstraints(constraints) {
  const v = constraints?.safeMarginPct ?? constraints?.safeMargin ?? undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return 6;
  return clamp(n, 3, 12);
}

function safeBox(marginPct) {
  const m = clamp(marginPct, 0, 40);
  return { x: `${m}%`, y: `${m}%`, w: `${100 - 2 * m}%`, h: `${100 - 2 * m}%` };
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isHexColor(s) {
  if (typeof s !== "string") return false;
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());
}

function isRgbaColor(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!/^rgba\(/i.test(t)) return false;
  // rgba(r,g,b,a) where r,g,b 0-255 and a 0-1
  const m = t.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i);
  if (!m) return false;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = Number(m[4]);
  return r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255 && a >= 0 && a <= 1;
}

function isColorToken(s) {
  return isHexColor(s) || isRgbaColor(s);
}

function normalizeVisualPreferenceMode(mode) {
  const m = String(mode || "").toLowerCase().trim();
  if (m === "ai-first" || m === "svg-first" || m === "balanced") return m;
  return "";
}

function getPath(obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (!isPlainObject(cur) && typeof cur !== "function") return undefined;
    cur = cur?.[p];
  }
  return cur;
}

function collectColorStrings(v, out) {
  if (typeof v === "string") {
    out.push(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectColorStrings(x, out);
    return;
  }
  if (isPlainObject(v)) {
    for (const k of Object.keys(v)) collectColorStrings(v[k], out);
  }
}

/**
 * Validates the dynamic DesignSystem schema + DSL constraints.
 * @param {object} system
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateDesignSystem(system) {
  /** @type {string[]} */
  const errors = [];
  if (!isPlainObject(system)) return { ok: false, errors: ["system must be an object"] };

  const required = [
    "colors.background.slide",
    "colors.background.gradient",
    "colors.background.panel",
    "colors.text.primary",
    "colors.text.secondary",
    "colors.text.muted",
    "colors.text.inverse",
    "colors.accent.primary",
    "colors.accent.secondary",
    "colors.border",
    "typography.fontFamily",
    "typography.scale.hero",
    "typography.scale.h1",
    "typography.scale.h2",
    "typography.scale.subtitle",
    "typography.scale.body",
    "typography.scale.caption",
    "typography.lineHeight",
    "spacing.page.marginX",
    "spacing.page.marginTop",
    "spacing.page.contentStartY",
    "spacing.element.gapX",
    "spacing.element.gapY",
    "layouts.header",
    "layouts.cover",
    "layouts.content",
    "components.card",
    "components.table",
    "components.icon",
    "components.line",
    "effects.shadow",
    "effects.blur",
    "effects.imageMask",
    "effects.imageRadius",
    "constraints.minFontSize",
    "constraints.maxElementsPerSlide",
    "constraints.coordinateUnit",
    "constraints.colorFormat",
  ];

  for (const path of required) {
    if (getPath(system, path) === undefined) errors.push(`missing:${path}`);
  }

  const minFontSize = getPath(system, "constraints.minFontSize");
  if (!isFiniteNumber(minFontSize)) errors.push("constraints.minFontSize must be a number");
  if (isFiniteNumber(minFontSize) && minFontSize < 12) errors.push("constraints.minFontSize must be >= 12");
  if (isFiniteNumber(minFontSize) && (minFontSize < 12 || minFontSize > 80)) errors.push("constraints.minFontSize must be within 12-80");

  const scale = getPath(system, "typography.scale");
  if (!isPlainObject(scale)) errors.push("typography.scale must be an object");
  if (isPlainObject(scale)) {
    for (const k of ["hero", "h1", "h2", "subtitle", "body", "caption"]) {
      const v = scale[k];
      if (!isFiniteNumber(v)) errors.push(`typography.scale.${k} must be a number`);
      if (isFiniteNumber(v) && (v < 12 || v > 80)) errors.push(`typography.scale.${k} must be within 12-80`);
      if (isFiniteNumber(minFontSize) && isFiniteNumber(v) && v < minFontSize) errors.push(`typography.scale.${k} must be >= minFontSize`);
    }
  }

  const fontFamily = getPath(system, "typography.fontFamily");
  if (!isNonEmptyString(fontFamily)) errors.push("typography.fontFamily must be a non-empty string");
  const lineHeight = getPath(system, "typography.lineHeight");
  if (!isFiniteNumber(lineHeight)) errors.push("typography.lineHeight must be a number");

  const marginX = getPath(system, "spacing.page.marginX");
  const marginTop = getPath(system, "spacing.page.marginTop");
  if (!isFiniteNumber(marginX)) errors.push("spacing.page.marginX must be a number");
  if (isFiniteNumber(marginX) && marginX < 5) errors.push("spacing.page.marginX must be >= 5");
  if (!isFiniteNumber(marginTop)) errors.push("spacing.page.marginTop must be a number");
  if (isFiniteNumber(marginTop) && marginTop < 2) errors.push("spacing.page.marginTop must be >= 2");

  const coordinateUnit = getPath(system, "constraints.coordinateUnit");
  if (!isNonEmptyString(coordinateUnit)) errors.push("constraints.coordinateUnit must be a string");
  if (isNonEmptyString(coordinateUnit) && coordinateUnit.toLowerCase() !== "percent") errors.push("constraints.coordinateUnit must be 'percent'");

  const colorFormat = getPath(system, "constraints.colorFormat");
  if (!isNonEmptyString(colorFormat)) errors.push("constraints.colorFormat must be a string");
  if (isNonEmptyString(colorFormat)) {
    const cf = colorFormat.toLowerCase();
    if (cf !== "hex" && cf !== "rgba") errors.push("constraints.colorFormat must be 'hex' or 'rgba'");
  }

  const colors = getPath(system, "colors");
  if (!isPlainObject(colors)) errors.push("colors must be an object");
  if (isPlainObject(colors)) {
    const colorStrings = [];
    collectColorStrings(colors, colorStrings);
    if (colorStrings.length === 0) errors.push("colors must contain color strings");
    for (const c of colorStrings) {
      if (!isColorToken(c)) errors.push(`invalid_color:${String(c)}`);
    }
  }

  const vp = system?.visualPreference;
  if (vp !== undefined && vp !== null) {
    if (!isPlainObject(vp)) {
      errors.push("visualPreference must be an object");
    } else {
      const mode = normalizeVisualPreferenceMode(vp?.mode);
      if (!mode) errors.push("visualPreference.mode must be 'ai-first' | 'svg-first' | 'balanced'");
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Generate design tokens from constraints.
 * @param {{ theme?: 'light' | 'dark' | 'colorful' | 'auto', fontFamily?: string, safeMarginPct?: number, safeMargin?: number }} [constraints={}] - Theme and layout constraints
 * @returns {{ theme: string, visualPreference: { mode: string }, designTokens: { colors: object, typography: object, spacing: object, grid: object, visualPreference: object } }} Design system with tokens
 */
export function generateDesignTokens(constraints = {}) {
  const theme = normalizeTheme(constraints?.theme);
  const resolvedTheme = theme === "auto" ? "light" : theme;

  const palettes = {
    light: {
      bg: "#ffffff",
      panel: "#ffffff",
      text: "#0f172a",
      muted: "#64748b",
      border: "#e2e8f0",
      primary: "#0ea5e9",
      accent: "#22c55e",
    },
    dark: {
      bg: "#0b1220",
      panel: "#111827",
      text: "#e5e7eb",
      muted: "#94a3b8",
      border: "#1f2937",
      primary: "#38bdf8",
      accent: "#a3e635",
    },
    colorful: {
      bg: "#ffffff",
      panel: "#ffffff",
      text: "#0f172a",
      muted: "#475569",
      border: "#e2e8f0",
      primary: "#7c3aed",
      accent: "#f59e0b",
    },
  };

  const colors = palettes[resolvedTheme] || palettes.light;
  const safeMarginPct = safeMarginPctFromConstraints(constraints);

  const typography = {
    fontFamily:
      constraints?.fontFamily ||
      "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    minFont: 12,
    titleFont: 44,
    subtitleFont: 18,
    bodyFont: 16,
    smallFont: 12,
  };

  const spacing = { base: 8, safeMarginPct };

  const grid = {
    aspect: "16:9",
    columns: 12,
    gutterPct: 2,
    safe: safeBox(safeMarginPct),
  };

  const visualPreference = { mode: "balanced" };
  return { theme: resolvedTheme, visualPreference, designTokens: { colors, typography, spacing, grid, visualPreference } };
}
