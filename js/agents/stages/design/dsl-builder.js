// Slide DSL builder for Design stage.
//
// The HTML must be compatible with `SlideParser.parse()`:
// - One slide = one <section data-type="freeform" ...>...</section>
// - Elements use `data-el` (text/shape/line/svg/image/card/icon...)

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

function makeTextEl({ x, y, w, h = "auto", font, color, bold, align, lineHeight, content }) {
  const attrs = [
    `data-el="text"`,
    `data-x="${x}"`,
    `data-y="${y}"`,
    `data-w="${w}"`,
    `data-h="${h}"`,
    `data-font="${font}"`,
    `data-color="${color}"`,
  ];
  if (bold) attrs.push(`data-bold="true"`);
  if (align) attrs.push(`data-align="${align}"`);
  if (lineHeight) attrs.push(`data-line-height="${lineHeight}"`);
  return `<div ${attrs.join(" ")}>${content}</div>`;
}

function makeShapeEl({ x, y, w, h, fill, stroke, radius = 14 }) {
  const attrs = [
    `data-el="shape"`,
    `data-shape="rounded"`,
    `data-x="${x}"`,
    `data-y="${y}"`,
    `data-w="${w}"`,
    `data-h="${h}"`,
    `data-fill="${fill}"`,
  ];
  if (stroke) attrs.push(`data-stroke="${stroke}"`);
  if (radius) attrs.push(`data-radius="${String(radius)}"`);
  return `<div ${attrs.join(" ")}></div>`;
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

function buildBodyHtml(pageType, slideIntent, claims, evidences) {
  const t = normalizePageType(pageType);

  if (t === "cover") return escapeHtml(slideIntent?.objective || "");

  if (t === "agenda") {
    const items = asLines(slideIntent?.keyPoints, 10);
    return items.length ? items.map((v, i) => `${String(i + 1).padStart(2, "0")}  ${escapeHtml(v)}`).join("<br>") : " ";
  }

  if (t === "appendix") {
    const evs = Array.isArray(evidences) ? evidences.slice(0, 6) : [];
    return evs.length
      ? evs.map((e) => `• [${escapeHtml(e?.evidenceId)}] ${escapeHtml(e?.quote || "")}`).join("<br>")
      : escapeHtml(" ");
  }

  if (t === "comparison") {
    const hints = asLines(slideIntent?.keyPoints, 8);
    const left = hints.filter((_, i) => i % 2 === 0).slice(0, 4);
    const right = hints.filter((_, i) => i % 2 === 1).slice(0, 4);
    const l = left.length ? left.map((v) => `• ${escapeHtml(v)}`).join("<br>") : " ";
    const r = right.length ? right.map((v) => `• ${escapeHtml(v)}`).join("<br>") : " ";
    return `<span style="font-weight:700">Option A</span><br>${l}<br><br><span style="font-weight:700">Option B</span><br>${r}`;
  }

  const points = [
    ...asLines(slideIntent?.keyPoints, 6),
    ...asLines(pickClaimsText(slideIntent, claims, 6), 6),
  ].slice(0, 8);
  return points.length ? points.map((v) => `• ${escapeHtml(v)}`).join("<br>") : escapeHtml(slideIntent?.objective || " ");
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

  return `
<section data-type="freeform" data-layout="${escapeHtml(layout)}" id="${escapeHtml(rawId)}" data-title="${escapeHtml(title)}" data-bg="${colors.bg}">
  ${makeTextEl({ x: "8%", y: titleY, w: "84%", font: titleFont, color: colors.text, bold: true, content: escapeHtml(title) })}
  ${panel}
  ${subtitle}
  ${body}
</section>`.trim();
}

