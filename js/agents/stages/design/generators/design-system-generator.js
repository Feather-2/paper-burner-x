import { generateDesignTokens, validateDesignSystem } from "./design-tokens.js";
import { getDesignModelCaller } from "../model.js";
import { robustParseJson } from "../../../shared/index.js";
import { extractJsonCandidate } from "../../../shared/index.js";
import { createLogger } from "../../../shared/index.js";

import { isPlainObject } from "../../../shared/index.js";
const logger = createLogger("stages/design/generators/design-system-generator");

function normalizeVisualPreference(v) {
  if (typeof v === "string") return { mode: v.trim().toLowerCase() };
  if (!isPlainObject(v)) return v;
  const mode = typeof v.mode === "string" ? v.mode.trim().toLowerCase() : v.mode;
  return { ...v, ...(mode !== undefined ? { mode } : {}) };
}

function deepMerge(base, override) {
  if (override === undefined) return base;
  if (Array.isArray(override)) return override.slice();
  if (isPlainObject(base) && isPlainObject(override)) {
    const out = Object.create(null);
    const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
    for (const k of Array.from(keys).sort()) {
      if (k === "__proto__" || k === "prototype" || k === "constructor") continue;
      const bv = base[k];
      const ov = override[k];
      if (ov === undefined) {
        out[k] = isPlainObject(bv) ? deepMerge({}, bv) : Array.isArray(bv) ? bv.slice() : bv;
      } else {
        out[k] = deepMerge(bv, ov);
      }
    }
    return out;
  }
  if (isPlainObject(override)) return deepMerge({}, override);
  return override;
}

// merge 策略：深度合并，overrides 优先；特殊处理 visualPreference（支持 string → {mode}）
function mergeDesignSystemOverrides(generated, overrides) {
  const base = isPlainObject(generated) ? generated : {};
  const ov = isPlainObject(overrides) ? overrides : {};

  const normalizedBase =
    base && Object.prototype.hasOwnProperty.call(base, "visualPreference")
      ? { ...base, visualPreference: normalizeVisualPreference(base.visualPreference) }
      : base;
  const normalizedOverrides =
    ov && Object.prototype.hasOwnProperty.call(ov, "visualPreference")
      ? { ...ov, visualPreference: normalizeVisualPreference(ov.visualPreference) }
      : ov;

  return deepMerge(normalizedBase, normalizedOverrides);
}

function coerceFiniteNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeCompatTheme(theme, fallbackTheme = "light") {
  const t = String(theme || "").toLowerCase().trim();
  if (t === "light" || t === "dark" || t === "colorful") return t;
  return fallbackTheme;
}

function safeBox(marginPct) {
  const m = clamp(Number(marginPct) || 0, 0, 40);
  return { x: `${m}%`, y: `${m}%`, w: `${100 - 2 * m}%`, h: `${100 - 2 * m}%` };
}

function hexFromMaybe(v, fallback) {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  return fallback;
}

function rgbaOrHexFromMaybe(v, fallback) {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^rgba\\(\\s*\\d{1,3}\\s*,\\s*\\d{1,3}\\s*,\\s*\\d{1,3}\\s*,\\s*(0|1|0?\\.\\d+)\\s*\\)$/i.test(s)) return s;
  return fallback;
}

function inferThemeFromLegacyTokens(tokens) {
  const bg = String(tokens?.colors?.bg || "").toLowerCase();
  if (bg.startsWith("#0b") || bg.startsWith("#11") || bg.startsWith("#00")) return "dark";
  return "light";
}

function legacyTokensToDesignSystem(legacy) {
  const tokens = legacy?.designTokens || legacy || {};
  const colors = tokens?.colors || {};
  const typography = tokens?.typography || {};
  const spacing = tokens?.spacing || {};

  const safeMarginPct = clamp(coerceFiniteNumber(spacing?.safeMarginPct, 6), 5, 12);
  const theme = String(legacy?.theme || inferThemeFromLegacyTokens(tokens)).toLowerCase() || "light";

  const bg = rgbaOrHexFromMaybe(colors?.bg, theme === "dark" ? "#0b1220" : "#ffffff");
  const panel = rgbaOrHexFromMaybe(colors?.panel, bg);
  const text = rgbaOrHexFromMaybe(colors?.text, theme === "dark" ? "#e5e7eb" : "#0f172a");
  const muted = rgbaOrHexFromMaybe(colors?.muted, theme === "dark" ? "#94a3b8" : "#64748b");
  const border = rgbaOrHexFromMaybe(colors?.border, theme === "dark" ? "#1f2937" : "#e2e8f0");
  const primary = rgbaOrHexFromMaybe(colors?.primary, theme === "dark" ? "#38bdf8" : "#0ea5e9");
  const accent = rgbaOrHexFromMaybe(colors?.accent, theme === "dark" ? "#a3e635" : "#22c55e");

  const minFontSize = clamp(coerceFiniteNumber(typography?.minFont, 12), 12, 80);
  const titleFont = clamp(coerceFiniteNumber(typography?.titleFont, 44), minFontSize, 80);
  const subtitleFont = clamp(coerceFiniteNumber(typography?.subtitleFont, 18), minFontSize, 80);
  const bodyFont = clamp(coerceFiniteNumber(typography?.bodyFont, 16), minFontSize, 80);
  const smallFont = clamp(coerceFiniteNumber(typography?.smallFont, 12), minFontSize, 80);

  const system = {
    colors: {
      background: { slide: bg, gradient: primary, panel },
      text: { primary: text, secondary: muted, muted, inverse: theme === "dark" ? "#0b1220" : "#ffffff" },
      accent: { primary, secondary: accent },
      border,
    },
    typography: {
      fontFamily:
        typography?.fontFamily ||
        "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      scale: { hero: titleFont, h1: titleFont, h2: clamp(titleFont - 8, minFontSize, 80), subtitle: subtitleFont, body: bodyFont, caption: smallFont },
      lineHeight: 1.25,
    },
    spacing: {
      page: { marginX: safeMarginPct, marginTop: clamp(safeMarginPct - 2, 2, 12), contentStartY: clamp(safeMarginPct + 4, 6, 30) },
      element: { gapX: clamp(coerceFiniteNumber(spacing?.base, 8) * 0.5, 4, 24), gapY: clamp(coerceFiniteNumber(spacing?.base, 8) * 0.75, 4, 24) },
    },
    layouts: {
      header: { align: "left", heightPct: 12 },
      cover: { titleAlign: "left", hero: true },
      content: { columns: 1, density: "comfortable" },
    },
    components: {
      card: { radius: 12, padding: 16, borderWidth: 1 },
      table: { headerFill: panel, borderColor: border },
      icon: { style: "outline", size: 20 },
      line: { thickness: 2, color: border },
    },
    effects: {
      shadow: { elevation: 2, color: "rgba(0,0,0,0.15)" },
      blur: 0,
      imageMask: "none",
      imageRadius: 12,
    },
    constraints: {
      minFontSize,
      maxElementsPerSlide: 18,
      coordinateUnit: "percent",
      colorFormat: "hex",
    },
    visualPreference: normalizeVisualPreference(tokens?.visualPreference) || normalizeVisualPreference(legacy?.visualPreference) || { mode: "balanced" },
    // Compatibility with existing design stage implementation.
    theme,
    designTokens: legacy?.designTokens || legacy,
  };

  const res = validateDesignSystem(system);
  return res.ok ? system : null;
}

/**
 * @param {{ constraints?: any }} [options]
 * @returns {object}
 */
function fallbackDesignSystem({ constraints } = {}) {
  const legacy = generateDesignTokens(constraints || {});
  const system = legacyTokensToDesignSystem(legacy);
  if (system) return system;
  // Extremely defensive fallback: synthesize a minimal valid system.
  return legacyTokensToDesignSystem(generateDesignTokens({})) || {
    theme: legacy?.theme || "light",
    designTokens: legacy?.designTokens || legacy,
    visualPreference: { mode: "balanced" },
  };
}

/**
 * @param {{ contentSummary?: any, tone?: any, extractedPalette?: object, userPreferences?: object, constraints?: object }} input
 * @returns {string}
 */
function buildPrompt({ contentSummary, tone, extractedPalette, userPreferences, constraints } = {}) {
  const palette = isPlainObject(extractedPalette) ? extractedPalette : {};
  const prefs = isPlainObject(userPreferences) ? userPreferences : {};
  const c = isPlainObject(constraints) ? constraints : {};

  return [
    "You generate a PPT DesignSystem JSON used by a strict PPT HTML DSL renderer.",
    "Return ONLY valid JSON (no markdown).",
    "",
    "Hard DSL rules:",
    "- All coordinates use percent (0-100%).",
    "- Font sizes must be 12-80px. minFontSize must be >= 12.",
    "- Page margins: marginX >= 5, marginTop >= 2 (percent).",
    "- Colors must be HEX (#RGB/#RRGGBB) or rgba(r,g,b,a). Prefer HEX.",
    "",
    "Output JSON MUST match this shape (all fields required):",
    JSON.stringify(
      {
        colors: {
          background: { slide: "#ffffff", gradient: "#0ea5e9", panel: "#ffffff" },
          text: { primary: "#0f172a", secondary: "#475569", muted: "#64748b", inverse: "#ffffff" },
          accent: { primary: "#0ea5e9", secondary: "#22c55e" },
          border: "#e2e8f0",
        },
        typography: {
          fontFamily: "string",
          scale: { hero: 56, h1: 44, h2: 32, subtitle: 18, body: 16, caption: 12 },
          lineHeight: 1.25,
        },
        spacing: { page: { marginX: 6, marginTop: 4, contentStartY: 10 }, element: { gapX: 8, gapY: 10 } },
        layouts: { header: {}, cover: {}, content: {} },
        components: { card: {}, table: {}, icon: {}, line: {} },
        effects: { shadow: {}, blur: 0, imageMask: "none", imageRadius: 12 },
        constraints: { minFontSize: 12, maxElementsPerSlide: 18, coordinateUnit: "percent", colorFormat: "hex" },
      },
      null,
      0
    ),
    "",
    "Signals:",
    `tone: ${String(tone || "")}`,
    "contentSummary:",
    String(contentSummary || "").slice(0, 1500),
    "",
    "extractedPalette (optional):",
    JSON.stringify(palette),
    "",
    "userPreferences (optional):",
    JSON.stringify(prefs),
    "",
    "constraints (optional):",
    JSON.stringify(c),
  ].join("\n");
}

function assertValidDesignSystem(system, label) {
  const res = validateDesignSystem(system);
  if (!res.ok) throw new Error(`${label || "invalid_design_system"}: ${res.errors.join("; ")}`);
}

function syncLegacyTokens(system, constraints) {
  /** @type {any} */
  const baseLegacy = generateDesignTokens(constraints || {})?.designTokens || {};
  const pageMarginX = system?.spacing?.page?.marginX;
  const safeMarginPct = clamp(coerceFiniteNumber(pageMarginX, baseLegacy?.spacing?.safeMarginPct ?? 6), 0, 40);
  const grid = isPlainObject(baseLegacy?.grid)
    ? { ...baseLegacy.grid, safe: safeBox(safeMarginPct) }
    : { aspect: "16:9", columns: 12, gutterPct: 2, safe: safeBox(safeMarginPct) };

  const tokens = {
    ...(isPlainObject(baseLegacy) ? baseLegacy : null),
    colors: {
      ...(isPlainObject(baseLegacy?.colors) ? baseLegacy.colors : null),
      bg: system?.colors?.background?.slide,
      panel: system?.colors?.background?.panel,
      text: system?.colors?.text?.primary,
      muted: system?.colors?.text?.muted,
      border: system?.colors?.border,
      primary: system?.colors?.accent?.primary,
      accent: system?.colors?.accent?.secondary,
    },
    typography: {
      ...(isPlainObject(baseLegacy?.typography) ? baseLegacy.typography : null),
      fontFamily: system?.typography?.fontFamily,
      minFont: system?.constraints?.minFontSize,
      titleFont: system?.typography?.scale?.h1,
      subtitleFont: system?.typography?.scale?.subtitle,
      bodyFont: system?.typography?.scale?.body,
      smallFont: system?.typography?.scale?.caption,
    },
	    spacing: {
	      ...(isPlainObject(baseLegacy?.spacing) ? baseLegacy.spacing : null),
	      base: system?.spacing?.element?.gapX,
	      safeMarginPct,
	    },
	    grid,
	    visualPreference: undefined,
	  };

  if (system && Object.prototype.hasOwnProperty.call(system, "visualPreference")) {
    tokens.visualPreference = normalizeVisualPreference(system.visualPreference);
  } else if (baseLegacy && Object.prototype.hasOwnProperty.call(baseLegacy, "visualPreference")) {
    tokens.visualPreference = normalizeVisualPreference(baseLegacy.visualPreference);
  }

  return tokens;
}

/**
 * Generate DesignSystem via AI with strict validation; fallback to template on failure.
 * @param {{contentSummary?:string,tone?:string,extractedPalette?:object,userPreferences?:object}} input
 * @param {{aiApiService?:object,modelRouter?:object,signal?:AbortSignal,constraints?:object}=} options
 * @returns {Promise<object>} DesignSystem
 */
export async function generateDesignSystem(input = {}, options = {}) {
  const aiApiService = options?.aiApiService;
  const modelRouter = options?.modelRouter;
  const signal = options?.signal;
  const constraints = options?.constraints;

  if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");

  const userPreferences = isPlainObject(input?.userPreferences) ? input.userPreferences : {};
  const overrides = isPlainObject(userPreferences?.designSystemOverrides) ? userPreferences.designSystemOverrides : {};

  const generateFromLLMOrFallback = async () => {
    const callModel = getDesignModelCaller({ modelRouter, aiApiService, signal }, { usage: "designer", timeoutMs: 30_000 });
    if (typeof callModel !== "function") return fallbackDesignSystem({ constraints });

    const prompt = buildPrompt({ ...input, constraints });
    const messages = [
      { role: "system", content: "You are a strict JSON generator." },
      { role: "user", content: prompt },
    ];

    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");
      try {
	        const resp = await callModel(messages, { temperature: 0.2, maxTokens: 4000, signal, timeoutMs: 120_000 });
	        const candidate = extractJsonCandidate(resp?.content, { prefer: "object" });
	        const parsed = robustParseJson(candidate);
	        if (parsed === null) throw new Error("Failed to parse design system JSON");
	        assertValidDesignSystem(parsed, "invalid_design_system");

	        const fallbackTheme = inferThemeFromLegacyTokens(parsed?.designTokens || {});
	        return {
          ...parsed,
          visualPreference: normalizeVisualPreference(parsed?.visualPreference) || { mode: "balanced" },
          theme: normalizeCompatTheme(parsed?.theme, fallbackTheme),
        };
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("[design.system] generateDesignSystem model call failed", { attempt: attempt + 1, error: msg });
      }
    }

    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr || "Unknown error");
    logger.warn("[design.system] generateDesignSystem falling back after retries", { error: errMsg });
    return fallbackDesignSystem({ constraints });
  };

  let designSystem = await generateFromLLMOrFallback();
  designSystem = mergeDesignSystemOverrides(designSystem, overrides);
  assertValidDesignSystem(designSystem, "invalid_design_system_after_overrides");

  const fallbackTheme = inferThemeFromLegacyTokens(designSystem?.designTokens || {});
  const theme = normalizeCompatTheme(designSystem?.theme, fallbackTheme);
  const visualPreference = normalizeVisualPreference(designSystem?.visualPreference) || { mode: "balanced" };

  const withCompat = { ...designSystem, theme, visualPreference };
  withCompat.designTokens = syncLegacyTokens(withCompat, constraints);
  return withCompat;
}
