// Design tokens generator for Design stage.
//
// Contract (tests + docs):
//   generateDesignTokens(constraints) -> DesignSystem
//   DesignSystem: { theme, designTokens: { colors, typography, spacing, grid } }

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

  return { theme: resolvedTheme, designTokens: { colors, typography, spacing, grid } };
}
