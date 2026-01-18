// Slide DSL builder for Design stage.
//
// The HTML must be compatible with `SlideParser.parse()`:
// - One slide = one <section data-type="freeform" ...>...</section>
// - Elements use `data-el` (text/shape/line/svg/image/card/icon...)

import { VisualDataStatus } from "../constants.js";

import { escapeHtml } from "../shared/design-utils.js";

// --- Security: Attribute Sanitization ---

/**
 * Validate and sanitize dimension value (x/y/w/h).
 * Only allows: numbers, numbers with %, "auto".
 * @param {string|number|undefined} val
 * @param {string} fallback
 * @returns {string}
 */
function sanitizeDimension(val, fallback = "0%") {
  if (val === undefined || val === null) return fallback;
  if (val === "auto") return "auto";
  const s = String(val).trim();
  // Allow: "10", "10%", "10.5", "10.5%"
  if (/^-?\d+(?:\.\d+)?%?$/.test(s)) {
    return s.endsWith("%") ? s : `${s}%`;
  }
  return fallback;
}

/**
 * Validate and sanitize color value.
 * Only allows: hex (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), hsla(), named colors.
 * @param {string|undefined} val
 * @param {string} fallback
 * @returns {string}
 */
function sanitizeColor(val, fallback = "#000000") {
  if (val === undefined || val === null) return fallback;
  const s = String(val).trim();
  // Hex: #rgb, #rrggbb, #rrggbbaa
  if (/^#[0-9A-Fa-f]{3,8}$/.test(s)) return s;
  // rgb/rgba/hsl/hsla with safe characters
  if (/^(?:rgb|rgba|hsl|hsla)\([^()]*\)$/i.test(s) && !/[<>"']/.test(s)) return s;
  // Named colors (safe subset, no special chars)
  if (/^[a-zA-Z]{3,20}$/.test(s)) return s;
  return fallback;
}

/**
 * Validate and sanitize numeric value within range.
 * @param {string|number|undefined} val
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function sanitizeNumber(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// --- End Security ---

function normalizePageType(pageType) {
  return String(pageType || "overview").toLowerCase();
}

function layoutFromPageType(pageType) {
  switch (normalizePageType(pageType)) {
    case "cover":
      return "cover";
    case "agenda":
      return "agenda";
    case "comparison":
      return "two_column";
    case "process":
    case "roadmap":
      return "process";
    case "summary":
      return "summary";
    case "appendix":
      return "appendix";
    case "overview":
    default:
      return "content";
  }
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

function resolveBuildArgs(arg3, arg4, arg5) {
  // Supported call forms:
  // 1) buildSlideHtml(slideIntent, designSystem, contentPackage, options)
  // 2) buildSlideHtml(slideIntent, designSystem, claims, evidences, options)
  if (
    arg5 === undefined &&
    arg4 &&
    typeof arg4 === "object" &&
    !Array.isArray(arg4) &&
    ("safeMode" in arg4 || "slideNo" in arg4)
  ) {
    const contentPackage = arg3 && typeof arg3 === "object" ? arg3 : null;
    return {
      claims: Array.isArray(contentPackage?.claims) ? contentPackage.claims : [],
      evidences: Array.isArray(contentPackage?.evidenceLedger) ? contentPackage.evidenceLedger : [],
      options: arg4 || {},
    };
  }

  return {
    claims: Array.isArray(arg3) ? arg3 : [],
    evidences: Array.isArray(arg4) ? arg4 : [],
    options: arg5 || {},
  };
}

function makeTextEl({ x, y, w, h = "auto", font, color, bold = false, align = "", lineHeight = null, content }) {
  const safeX = sanitizeDimension(x, "0%");
  const safeY = sanitizeDimension(y, "0%");
  const safeW = sanitizeDimension(w, "100%");
  const safeH = sanitizeDimension(h, "auto");
  const safeFont = sanitizeNumber(font, 8, 200, 16);
  const safeColor = sanitizeColor(color, "#000000");
  const attrs = [
    `data-el="text"`,
    `data-x="${safeX}"`,
    `data-y="${safeY}"`,
    `data-w="${safeW}"`,
    `data-h="${safeH}"`,
    `data-font="${safeFont}"`,
    `data-color="${safeColor}"`,
  ];
  if (bold) attrs.push(`data-bold="true"`);
  if (align && /^(?:left|center|right|justify)$/.test(align)) attrs.push(`data-align="${align}"`);
  if (lineHeight) attrs.push(`data-line-height="${sanitizeNumber(lineHeight, 0.5, 5, 1.4)}"`);
  return `<div ${attrs.join(" ")}>${content}</div>`;
}

function makeShapeEl({ x, y, w, h, fill, stroke, radius = 14 }) {
  const safeX = sanitizeDimension(x, "0%");
  const safeY = sanitizeDimension(y, "0%");
  const safeW = sanitizeDimension(w, "100%");
  const safeH = sanitizeDimension(h, "100%");
  const safeFill = sanitizeColor(fill, "#ffffff");
  const safeRadius = sanitizeNumber(radius, 0, 100, 14);
  const attrs = [
    `data-el="shape"`,
    `data-shape="rounded"`,
    `data-x="${safeX}"`,
    `data-y="${safeY}"`,
    `data-w="${safeW}"`,
    `data-h="${safeH}"`,
    `data-fill="${safeFill}"`,
  ];
  if (stroke) attrs.push(`data-stroke="${sanitizeColor(stroke, "#000000")}"`);
  if (safeRadius) attrs.push(`data-radius="${safeRadius}"`);
  return `<div ${attrs.join(" ")}></div>`;
}

function makeImageEl({ x, y, w, h, src, alt = "图片", fit = "cover", radius = 12 }) {
  const safeX = sanitizeDimension(x, "0%");
  const safeY = sanitizeDimension(y, "0%");
  const safeW = sanitizeDimension(w, "100%");
  const safeH = sanitizeDimension(h, "100%");
  const safeRadius = sanitizeNumber(radius, 0, 100, 12);
  const safeFit = /^(?:cover|contain|fill|none|scale-down)$/.test(fit) ? fit : "cover";
  const attrs = [
    `data-el="image"`,
    `data-x="${safeX}"`,
    `data-y="${safeY}"`,
    `data-w="${safeW}"`,
    `data-h="${safeH}"`,
    `data-src="${escapeHtml(src)}"`,
    `data-alt="${escapeHtml(alt)}"`,
    `data-fit="${safeFit}"`,
  ];
  if (safeRadius !== 0) attrs.push(`data-radius="${safeRadius}"`);
  return `<div ${attrs.join(" ")}></div>`;
}

function makeTableEl({ x, y, w, h, data, colors, fontSize = 12, radius = 8 }) {
  const safeX = sanitizeDimension(x, "0%");
  const safeY = sanitizeDimension(y, "0%");
  const safeW = sanitizeDimension(w, "100%");
  const safeH = sanitizeDimension(h, "100%");
  const safeFontSize = sanitizeNumber(fontSize, 8, 72, 12);
  const safeRadius = sanitizeNumber(radius, 0, 100, 8);
  const attrs = [
    `data-el="table"`,
    `data-x="${safeX}"`,
    `data-y="${safeY}"`,
    `data-w="${safeW}"`,
    `data-h="${safeH}"`,
    `data-data='${escapeHtml(data)}'`,
    `data-header-bg="${sanitizeColor(colors.primary, "#0ea5e9")}"`,
    `data-header-color="#FFFFFF"`,
    `data-row-bg="${sanitizeColor(colors.panel, "#ffffff")}"`,
    `data-alt-row-bg="${sanitizeColor(colors.panel, "#ffffff")}"`,
    `data-cell-color="${sanitizeColor(colors.text, "#0f172a")}"`,
    `data-border-color="${sanitizeColor(colors.border, "#e2e8f0")}"`,
    `data-font-size="${safeFontSize}"`,
    `data-radius="${safeRadius}"`,
  ];
  return `<div ${attrs.join(" ")}></div>`;
}

function makeChartEl({ x, y, w, h, chartType = "bar", chartData = "{}", colors = [] }) {
  const safeX = sanitizeDimension(x, "0%");
  const safeY = sanitizeDimension(y, "0%");
  const safeW = sanitizeDimension(w, "100%");
  const safeH = sanitizeDimension(h, "100%");
  const safeChartType = /^(?:bar|line|pie|doughnut|area|scatter|radar)$/.test(chartType) ? chartType : "bar";
  const attrs = [
    `data-el="chart"`,
    `data-x="${safeX}"`,
    `data-y="${safeY}"`,
    `data-w="${safeW}"`,
    `data-h="${safeH}"`,
    `data-chart-type="${safeChartType}"`,
    `data-chart-data="${escapeHtml(chartData)}"`,
    `data-colors='${escapeHtml(JSON.stringify(colors))}'`,
  ];
  return `<div ${attrs.join(" ")}></div>`;
}

function makeImagePlaceholderEl(slot, box = {}) {
  const slotId = String(slot?.slotId || "").trim();
  if (!slotId) return "";

  const rawAspect = String(slot?.aspectRatio || "16:9").trim() || "16:9";
  const safeAspect = /^\d{1,2}:\d{1,2}$/.test(rawAspect) ? rawAspect : "16:9";
  const attrs = [
    `data-el="image-placeholder"`,
    `id="${escapeHtml(slotId)}"`,
    `data-slot-id="${escapeHtml(slotId)}"`,
    `data-status="${VisualDataStatus.PENDING}"`,
    `data-aspect-ratio="${safeAspect}"`,
    `data-fallback="gradient"`,
  ];

  if (box?.x) attrs.push(`data-x="${sanitizeDimension(box.x, "0%")}"`);
  if (box?.y) attrs.push(`data-y="${sanitizeDimension(box.y, "0%")}"`);
  if (box?.w) attrs.push(`data-w="${sanitizeDimension(box.w, "100%")}"`);
  if (box?.h) attrs.push(`data-h="${sanitizeDimension(box.h, "100%")}"`);
  if (box?.z !== undefined) attrs.push(`data-z="${sanitizeNumber(box.z, 0, 1000, 0)}"`);

  return `<div ${attrs.join(" ")}></div>`;
}

function placeholderBoxFor(slot, pageType) {
  const purpose = String(slot?.purpose || "").toLowerCase();
  if (purpose === "hero" || pageType === "cover") return { x: "0%", y: "0%", w: "100%", h: "100%" };
  if (purpose === "illustration") return { x: "58%", y: "26%", w: "34%", h: "44%" };
  if (purpose === "icon") return { x: "82%", y: "12%", w: "10%", h: "10%" };
  if (purpose === "background") return { x: "0%", y: "0%", w: "100%", h: "100%" };
  return { x: "8%", y: "22%", w: "84%", h: "60%" };
}

function buildImagePlaceholdersHtml(slideIntent, options) {
  const pageType = normalizePageType(slideIntent?.pageType);
  const slots = Array.isArray(options?.imageSlotsForSlide) ? options.imageSlotsForSlide : [];
  if (!slots.length) return "";
  return slots
    .map((slot) => makeImagePlaceholderEl(slot, placeholderBoxFor(slot, pageType)))
    .filter(Boolean)
    .join("\n  ");
}

function asLines(items, max = 8) {
  return (Array.isArray(items) ? items : [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function pickClaimsText(slideIntent, claims, max = 6) {
  const claimIds = Array.isArray(slideIntent?.claimIds) ? slideIntent.claimIds : [];
  const byId = new Map((Array.isArray(claims) ? claims : []).map((c) => [c?.claimId, c]));
  const out = [];
  for (const id of claimIds) {
    const c = byId.get(id);
    if (c?.text) out.push(String(c.text));
    if (out.length >= max) break;
  }
  return out;
}

function extractContentFromSlideIntent(slideIntent) {
  const content = slideIntent?.content;

  if (typeof content === "string" && content.trim()) {
    return { text: content.trim(), source: "content" };
  }

  if (content && typeof content === "object") {
    const markdown = content?.markdown;
    if (typeof markdown === "string" && markdown.trim()) {
      return { text: markdown.trim(), source: "content.markdown" };
    }
  }

  const keyPoints = asLines(slideIntent?.keyPoints, 12);
  if (keyPoints.length) return { text: keyPoints.join("\n"), source: "keyPoints" };

  const objective = String(slideIntent?.objective || "").trim();
  if (objective) return { text: objective, source: "objective" };

  return { text: "", source: "empty" };
}

function stripMarkdownNoise(markdown) {
  return String(markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+.+\n?/gm, "");
}

function toDisplayLines(markdownOrText, max = 8) {
  const cleaned = stripMarkdownNoise(markdownOrText);
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, ""))
    .filter(Boolean);
  if (!lines.length) {
    const one = cleaned.trim().replace(/\s+/g, " ");
    return one ? [one.slice(0, 240) + (one.length > 240 ? "..." : "")] : [];
  }
  return lines.slice(0, max);
}

function buildBodyHtml(pageType, slideIntent, claims, evidences) {
  const t = normalizePageType(pageType);
  const extracted = extractContentFromSlideIntent(slideIntent);

  if (t === "cover") {
    const objective = String(slideIntent?.objective || "").trim();
    if (objective) return escapeHtml(objective);
    const lines = toDisplayLines(extracted.text, 4);
    return escapeHtml(lines.join(" · ") || " ");
  }

  if (t === "agenda") {
    const items = toDisplayLines(extracted.text, 10);
    return items.length ? items.map((v, i) => `${String(i + 1).padStart(2, "0")}  ${escapeHtml(v)}`).join("<br>") : " ";
  }

  if (t === "appendix") {
    const evs = Array.isArray(evidences) ? evidences.slice(0, 6) : [];
    return evs.length
      ? evs.map((e) => `• [${escapeHtml(e?.evidenceId)}] ${escapeHtml(e?.quote || "")}`).join("<br>")
      : escapeHtml(" ");
  }

  if (t === "comparison") {
    const hints = toDisplayLines(extracted.text, 8);
    const left = hints.filter((_, i) => i % 2 === 0).slice(0, 4);
    const right = hints.filter((_, i) => i % 2 === 1).slice(0, 4);
    const l = left.length ? left.map((v) => `• ${escapeHtml(v)}`).join("<br>") : " ";
    const r = right.length ? right.map((v) => `• ${escapeHtml(v)}`).join("<br>") : " ";
    return `<span style="font-weight:700">Option A</span><br>${l}<br><br><span style="font-weight:700">Option B</span><br>${r}`;
  }

  const shouldIncludeClaims = extracted.source !== "content" && extracted.source !== "content.markdown";
  const points = [
    ...toDisplayLines(extracted.text, 8),
    ...(shouldIncludeClaims ? asLines(pickClaimsText(slideIntent, claims, 6), 6) : []),
  ].slice(0, 8);

  if (points.length) {
    return points.map((v) => `• ${escapeHtml(v)}`).join("<br>");
  }

  return escapeHtml(slideIntent?.objective || " ");
}

/**
 * Build one slide HTML DSL.
 *
 * @param {object} slideIntent ContentPackage.slideIntents[i]
 * @param {object} designSystem DesignSystem (or raw tokens)
 * @param {object[]|object} arg3 claims[] or ContentPackage
 * @param {object[]|object} [arg4] evidences[] or options
 * @param {object} [arg5] options
 * @returns {string}
 */
export function buildSlideHtml(slideIntent, designSystem, arg3, arg4, arg5) {
  const { claims, evidences, options } = resolveBuildArgs(arg3, arg4, arg5);
  const { colors, typography } = resolveDesignTokens(designSystem);

  const pageType = normalizePageType(slideIntent?.pageType);
  const layout = options.safeMode ? "safe" : layoutFromPageType(pageType);

  const slideNo = Number.isFinite(options.slideNo) ? options.slideNo : undefined;
  const rawId = slideNo ? `slide-${slideNo}` : `slide-${slideIntent?.slideIntentId || 1}`;
  const title = String(slideIntent?.title || (pageType === "cover" ? "Presentation" : "Untitled"));

  const titleFont = Math.max(typography.minFont, pageType === "cover" ? 60 : typography.titleFont || 44);
  const bodyFont = Math.max(typography.minFont, typography.bodyFont || 16);
  const subtitleFont = Math.max(typography.minFont, typography.subtitleFont || 18);

  const titleY = pageType === "cover" ? "30%" : "8%";
  const bodyY = pageType === "cover" ? "44%" : "26%";
  const panelY = pageType === "cover" ? "0%" : "20%";
  const panelH = pageType === "cover" ? "0%" : "72%";

  const bodyHtml = buildBodyHtml(pageType, slideIntent, claims, evidences) || " ";

  const panel =
    pageType === "cover"
      ? ""
      : makeShapeEl({ x: "8%", y: panelY, w: "84%", h: panelH, fill: colors.panel, stroke: colors.border, radius: 16 });

  const subtitle =
    pageType === "cover" && slideIntent?.objective
      ? makeTextEl({
        x: "8%",
        y: bodyY,
        w: "84%",
        font: subtitleFont,
        color: colors.muted,
        lineHeight: 1.4,
        content: escapeHtml(slideIntent.objective),
      })
      : "";

  const body =
    pageType === "cover"
      ? ""
      : makeTextEl({
        x: "12%",
        y: bodyY,
        w: "76%",
        font: bodyFont,
        color: colors.text,
        lineHeight: 1.6,
        content: bodyHtml,
      });

  const imagePlaceholders = buildImagePlaceholdersHtml(slideIntent, options);
  const imageLayer = imagePlaceholders ? `  ${imagePlaceholders}\n` : "";

  return `
<section data-type="freeform" data-layout="${escapeHtml(layout)}" id="${escapeHtml(rawId)}" data-title="${escapeHtml(title)}" data-bg="${colors.bg}">
${imageLayer}  ${makeTextEl({ x: "8%", y: titleY, w: "84%", font: titleFont, color: colors.text, bold: true, content: escapeHtml(title) })}
  ${panel}
  ${subtitle}
  ${body}
</section>`.trim();
}

function coercePct(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return `${v}%`;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.endsWith("%") ? s : `${s}%`;
}

function clampNum(v, min, max, fallback = min) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Build one slide HTML DSL from Layout JSON.
 *
 * @param {object} layoutJson Layout JSON (Task-5 schema)
 * @param {object} designSystem DesignSystem (or raw tokens)
 * @param {object} [options] { slideId?, title?, safeMode? }
 * @returns {string}
 */
export function buildFromLayoutJson(layoutJson, designSystem, options = {}) {
  const { colors, typography } = resolveDesignTokens(designSystem);
  const slideId = String(options?.slideId || "slide-vision");

  const rawEls = Array.isArray(layoutJson?.elements) ? layoutJson.elements : [];
  const els = rawEls.filter((e) => e && typeof e === "object" && typeof e.type === "string");

  const titleText = String(options?.title || els.find((e) => e.type === "text" && e.content)?.content || "Untitled");

  if (options?.safeMode || !els.length) {
    const titleFont = Math.max(typography.minFont, typography.titleFont || 44);
    return `
<section data-type="freeform" data-layout="safe" id="${escapeHtml(slideId)}" data-title="${escapeHtml(titleText)}" data-bg="${colors.bg}">
  ${makeTextEl({ x: "8%", y: "10%", w: "84%", font: titleFont, color: colors.text, bold: true, content: escapeHtml(titleText) })}
</section>`.trim();
  }

  const palette = Array.isArray(layoutJson?.extractedPalette) ? layoutJson.extractedPalette.map((c) => String(c || "").trim()).filter(Boolean) : [];
  const chartColors = (palette.length ? palette : [colors.primary, colors.accent, colors.text]).slice(0, 6);

  const built = els
    .map((e) => {
      const b = e.bounds || {};
      const x = coercePct(b.x) || "8%";
      const y = coercePct(b.y) || "8%";
      const w = coercePct(b.w) || "84%";
      const h = coercePct(b.h) || "10%";

      if (e.type === "text") {
        const font = clampNum(e?.style?.fontSize ?? typography.bodyFont, 12, 80, typography.bodyFont || 16);
        const color = String(e?.style?.color || colors.text);
        const fw = String(e?.style?.fontWeight || "").toLowerCase();
        const bold = fw === "bold" || Number(fw) >= 600;
        return makeTextEl({ x, y, w, h: "auto", font, color, bold, content: escapeHtml(e?.content || " ") });
      }

      if (e.type === "shape") {
        const fill = String(e?.style?.fill || e?.style?.color || colors.panel);
        const stroke = String(e?.style?.stroke || colors.border);
        const radius = clampNum(e?.style?.radius, 0, 64, 14);
        return makeShapeEl({ x, y, w, h, fill, stroke, radius });
      }

      if (e.type === "image") {
        const src = String(e?.content || "").trim() || "about:blank";
        return makeImageEl({ x, y, w, h, src });
      }

      if (e.type === "table") {
        const data =
          e.content && typeof e.content !== "string" ? JSON.stringify(e.content) : String(e.content || "").trim() || "[]";
        return makeTableEl({ x, y, w, h, data, colors, fontSize: Math.max(typography.minFont, typography.smallFont || 12) });
      }

      if (e.type === "chart") {
        const chartType = String(e?.chartType || "bar");
        const chartData =
          e.content && typeof e.content !== "string" ? JSON.stringify(e.content) : String(e.content || "").trim() || "{}";
        return makeChartEl({ x, y, w, h, chartType, chartData, colors: chartColors });
      }

      return "";
    })
    .filter(Boolean)
    .join("\n  ");

  return `
<section data-type="freeform" data-layout="${escapeHtml(layoutFromPageType(layoutJson?.suggestedLayout))}" id="${escapeHtml(slideId)}" data-title="${escapeHtml(titleText)}" data-bg="${colors.bg}">
  ${built}
</section>`.trim();
}
