import { generateDesignTokens, validateDesignSystem } from "./design-tokens.js";

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function coerceFiniteNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
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
    // Compatibility with existing design stage implementation.
    theme,
    designTokens: legacy?.designTokens || legacy,
  };

  const res = validateDesignSystem(system);
  return res.ok ? system : null;
}

function fallbackDesignSystem({ constraints } = {}) {
  const legacy = generateDesignTokens(constraints || {});
  const system = legacyTokensToDesignSystem(legacy);
  if (system) return system;
  // Extremely defensive fallback (should not happen): return legacy as-is.
  return { theme: legacy?.theme || "light", designTokens: legacy?.designTokens || legacy };
}

function buildPrompt({ contentSummary, tone, extractedPalette, userPreferences, constraints }) {
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

/**
 * Generate DesignSystem via AI with strict validation; fallback to template on failure.
 * @param {{contentSummary?:string,tone?:string,extractedPalette?:object,userPreferences?:object}} input
 * @param {{aiApiService?:object,signal?:AbortSignal,constraints?:object}=} options
 * @returns {Promise<object>} DesignSystem
 */
export async function generateDesignSystem(input = {}, options = {}) {
  const aiApiService = options?.aiApiService;
  const signal = options?.signal;
  const constraints = options?.constraints;

  if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");

  if (!aiApiService || typeof aiApiService.chat !== "function") {
    return fallbackDesignSystem({ constraints });
  }

  try {
    const prompt = buildPrompt({ ...input, constraints });
    const resp = await aiApiService.chat({
      messages: [
        { role: "system", content: "You are a strict JSON generator." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 1200,
    });

    const parsed = JSON.parse(resp?.content || "null");
    const res = validateDesignSystem(parsed);
    if (!res.ok) throw new Error(`invalid_design_system: ${res.errors.join("; ")}`);

    // Provide compatibility aliases expected by the existing Design stage code.
    const theme = String(parsed?.theme || "").toLowerCase();
    const withCompat = {
      ...parsed,
      theme: theme === "dark" || theme === "light" || theme === "colorful" ? theme : "light",
      designTokens: parsed?.designTokens || {
        colors: {
          bg: parsed?.colors?.background?.slide,
          panel: parsed?.colors?.background?.panel,
          text: parsed?.colors?.text?.primary,
          muted: parsed?.colors?.text?.muted,
          border: parsed?.colors?.border,
          primary: parsed?.colors?.accent?.primary,
          accent: parsed?.colors?.accent?.secondary,
        },
        typography: {
          fontFamily: parsed?.typography?.fontFamily,
          minFont: parsed?.constraints?.minFontSize,
          titleFont: parsed?.typography?.scale?.h1,
          subtitleFont: parsed?.typography?.scale?.subtitle,
          bodyFont: parsed?.typography?.scale?.body,
          smallFont: parsed?.typography?.scale?.caption,
        },
        spacing: { base: parsed?.spacing?.element?.gapX, safeMarginPct: parsed?.spacing?.page?.marginX },
        grid: { aspect: "16:9", columns: 12, gutterPct: 2, safe: null },
      },
    };

    // If the AI omitted required legacy token fields, rebuild from fallback tokens instead.
    if (!withCompat?.designTokens?.colors?.primary || !withCompat?.designTokens?.typography?.fontFamily) {
      const legacy = generateDesignTokens(constraints || {});
      const upgraded = legacyTokensToDesignSystem(legacy);
      if (upgraded) return upgraded;
    }

    return withCompat;
  } catch {
    return fallbackDesignSystem({ constraints });
  }
}

