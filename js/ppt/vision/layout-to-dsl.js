/**
 * Layout JSON -> HTML DSL
 *
 * layoutToDsl(layoutJson, designSystem):
 * - Produces one <section data-type="freeform">...</section>
 * - Enforces DSL constraints (percent coords, font 12-80, margin >=5%, hex colors)
 * - Validates by parsing (re-uses js/ppt/dsl/serialize.js)
 * - On failure, returns a safe slide (title only)
 */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function toPct(n) {
  const x = clamp(n, 0, 100);
  const s = Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
  return `${s}%`;
}

function isHex6(s) {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s.trim());
}

function expandHex(hex) {
  const h = String(hex || "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    const r = h[1];
    const g = h[2];
    const b = h[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h;
  if (/^#[0-9a-fA-F]{8}$/.test(h)) return `#${h.slice(1, 7)}`; // drop alpha
  return null;
}

function rgbToHex(rgb) {
  const m = String(rgb || "")
    .trim()
    .match(/^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (!m) return null;
  const r = clamp(m[1], 0, 255);
  const g = clamp(m[2], 0, 255);
  const b = clamp(m[3], 0, 255);
  const to2 = (v) => v.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function normalizeColor(color, fallback) {
  const c = color === undefined || color === null ? "" : String(color).trim();
  const hex = expandHex(c) || rgbToHex(c);
  if (hex) return hex.toUpperCase();
  const fb = expandHex(fallback) || rgbToHex(fallback);
  return (fb || "#000000").toUpperCase();
}

function resolveDesignTokens(designSystemOrTokens) {
  const t = designSystemOrTokens?.designTokens || designSystemOrTokens || {};
  const colors = {
    bg: "#ffffff",
    panel: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    border: "#e2e8f0",
    primary: "#0ea5e9",
    accent: "#22c55e",
    ...(t.colors || {}),
  };
  const typography = {
    minFont: 12,
    titleFont: 44,
    subtitleFont: 18,
    bodyFont: 16,
    smallFont: 12,
    ...(t.typography || {}),
  };
  return { colors, typography };
}

function enforceMargins(bounds, margin = 5) {
  const b = bounds && typeof bounds === "object" ? bounds : {};
  let x = clamp(b.x, 0, 100);
  let y = clamp(b.y, 0, 100);
  let w = clamp(b.w, 0, 100);
  let h = clamp(b.h, 0, 100);

  x = Math.max(margin, x);
  y = Math.max(margin, y);
  w = Math.max(0, Math.min(w, 100 - x - margin));
  h = Math.max(0, Math.min(h, 100 - y - margin));

  return { x, y, w, h };
}

function pickTitle(layoutJson) {
  const els = Array.isArray(layoutJson?.elements) ? layoutJson.elements : [];
  const texts = els.filter((e) => e?.type === "text" && typeof e.content === "string" && e.content.trim());
  if (!texts.length) return "Untitled";

  // Prefer top-most / largest font size.
  texts.sort((a, b) => {
    const ay = Number(a?.bounds?.y ?? 999);
    const by = Number(b?.bounds?.y ?? 999);
    if (ay !== by) return ay - by;
    const af = Number(a?.style?.fontSize ?? 0);
    const bf = Number(b?.style?.fontSize ?? 0);
    return bf - af;
  });
  return String(texts[0].content).trim().slice(0, 120) || "Untitled";
}

function safeSlideHtml(title, designSystem) {
  const { colors, typography } = resolveDesignTokens(designSystem);
  const t = escapeHtml(String(title || "Untitled"));
  const font = clamp(typography.titleFont || 44, 12, 80);
  const color = normalizeColor(colors.text, "#0f172a");
  const bg = normalizeColor(colors.bg, "#ffffff");
  return (
    `<section data-type="freeform" id="slide-safe" data-bg="${bg}">\n` +
    `  <div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-h="auto" data-font="${font}" data-color="${color}" data-bold="true">${t}</div>\n` +
    `</section>`
  );
}

function layoutElementsToHtml(layoutJson, designSystem) {
  const { colors, typography } = resolveDesignTokens(designSystem);

  const rawElements = Array.isArray(layoutJson?.elements) ? layoutJson.elements : [];
  const margin = 5;

  const out = [];
  for (const el of rawElements) {
    if (!el || typeof el !== "object") continue;
    const type = String(el.type || "").trim();
    const bounds = enforceMargins(el.bounds, margin);

    const x = toPct(bounds.x);
    const y = toPct(bounds.y);
    const w = toPct(bounds.w);
    const h = type === "text" ? "auto" : toPct(bounds.h);

    if (type === "text") {
      const style = el.style && typeof el.style === "object" ? el.style : {};
      const font = clamp(style.fontSize ?? typography.bodyFont ?? 16, 12, 80);
      const color = normalizeColor(style.color, colors.text);
      const fw = String(style.fontWeight ?? "").toLowerCase();
      const bold = fw === "bold" || Number(fw) >= 600;
      const content = escapeHtml(String(el.content ?? " ").trim() || " ");
      out.push(
        `  <div data-el="text" data-x="${x}" data-y="${y}" data-w="${w}" data-h="${h}" data-font="${font}" data-color="${color}"${bold ? ' data-bold="true"' : ""}>${content}</div>`
      );
      continue;
    }

    if (type === "shape") {
      const style = el.style && typeof el.style === "object" ? el.style : {};
      const fill = normalizeColor(style.fill ?? style.color, colors.panel);
      const stroke = style.stroke ? normalizeColor(style.stroke, colors.border) : normalizeColor(colors.border, "#e2e8f0");
      out.push(
        `  <div data-el="shape" data-shape="rounded" data-x="${x}" data-y="${y}" data-w="${w}" data-h="${toPct(bounds.h)}" data-fill="${fill}" data-stroke="${stroke}" data-radius="12"></div>`
      );
      continue;
    }

    if (type === "image") {
      const src = String(el.content || "").trim();
      const alt = escapeHtml(String(el.alt || "图片"));
      out.push(
        `  <div data-el="image" data-x="${x}" data-y="${y}" data-w="${w}" data-h="${toPct(bounds.h)}" data-src="${escapeHtml(src)}" data-alt="${alt}" data-fit="cover" data-radius="12"></div>`
      );
      continue;
    }

    if (type === "table") {
      const data =
        el.content && typeof el.content !== "string"
          ? JSON.stringify(el.content)
          : String(el.content || "").trim();
      const dataAttr = escapeHtml(data || "[]");
      const headerBg = normalizeColor(colors.primary, "#0ea5e9");
      const headerColor = "#FFFFFF";
      const rowBg = normalizeColor(colors.panel, "#ffffff");
      const cellColor = normalizeColor(colors.text, "#0f172a");
      const borderColor = normalizeColor(colors.border, "#e2e8f0");
      const fontSize = clamp(typography.smallFont ?? 12, 12, 80);
      out.push(
        `  <div data-el="table" data-x="${x}" data-y="${y}" data-w="${w}" data-h="${toPct(bounds.h)}" data-data='${dataAttr}' data-header-bg="${headerBg}" data-header-color="${headerColor}" data-row-bg="${rowBg}" data-alt-row-bg="${rowBg}" data-cell-color="${cellColor}" data-border-color="${borderColor}" data-font-size="${fontSize}" data-radius="8"></div>`
      );
      continue;
    }

    if (type === "chart") {
      const chartType = escapeHtml(String(el.chartType || "bar"));
      const chartData =
        el.content && typeof el.content !== "string"
          ? JSON.stringify(el.content)
          : String(el.content || "").trim();
      const dataAttr = escapeHtml(chartData || "{}");
      const title = escapeHtml(String(el.title || ""));
      const palette = Array.isArray(layoutJson?.extractedPalette) ? layoutJson.extractedPalette.map((c) => normalizeColor(c, colors.primary)) : [normalizeColor(colors.primary, "#0ea5e9")];
      out.push(
        `  <div data-el="chart" data-x="${x}" data-y="${y}" data-w="${w}" data-h="${toPct(bounds.h)}" data-chart-type="${chartType}" data-chart-data="${dataAttr}" data-colors='${escapeHtml(JSON.stringify(palette))}'>${title}</div>`
      );
      continue;
    }
  }

  return out.join("\n");
}

function validateDslConstraints(html) {
  const s = String(html || "");
  if (!s.includes('data-type="freeform"')) throw new Error("DSL: missing freeform section");

  // Basic attribute conformance checks.
  const percentAttrs = [...s.matchAll(/\sdata-(x|y|w|h)=\"([^\"]+)\"/g)].map((m) => m[2]);
  for (const v of percentAttrs) {
    if (v === "auto") continue;
    if (!/^\d+(?:\.\d+)?%$/.test(v)) throw new Error(`DSL: non-percent coord: ${v}`);
  }

  const fontAttrs = [...s.matchAll(/\sdata-font=\"([^\"]+)\"/g)].map((m) => m[1]);
  for (const f of fontAttrs) {
    const n = Number(f);
    if (!Number.isFinite(n) || n < 12 || n > 80) throw new Error(`DSL: font out of range: ${f}`);
  }

  const colorAttrs = [...s.matchAll(/\sdata-(?:color|fill|stroke|header-bg|header-color|row-bg|alt-row-bg|cell-color|border-color)=\"([^\"]+)\"/g)].map((m) => m[1]);
  for (const c of colorAttrs) {
    if (!isHex6(c)) throw new Error(`DSL: non-hex color: ${c}`);
  }

  // Parse-level validation (structure) without depending on browser-only parsers.
  const sections = [...s.matchAll(/<section\b[^>]*\bdata-type\s*=\s*["']freeform["'][^>]*>/gi)];
  if (sections.length !== 1) throw new Error("DSL: expected exactly 1 freeform section");
  if (!/data-el\s*=\s*["'][^"']+["']/.test(s)) throw new Error("DSL: expected at least 1 element");
  return true;
}

function layoutToDsl(layoutJson, designSystem) {
  const title = pickTitle(layoutJson);
  const { colors } = resolveDesignTokens(designSystem);
  const bg = normalizeColor(colors.bg, "#ffffff");

  try {
    const inner = layoutElementsToHtml(layoutJson, designSystem);
    const html = `<section data-type="freeform" id="slide-vision" data-bg="${bg}">\n${inner || ""}\n</section>`;
    validateDslConstraints(html);
    return html;
  } catch {
    return safeSlideHtml(title, designSystem);
  }
}

export const _internal = {
  normalizeColor,
  enforceMargins,
  validateDslConstraints,
  safeSlideHtml,
};

export { layoutToDsl };

export default {
  layoutToDsl,
  _internal,
};
