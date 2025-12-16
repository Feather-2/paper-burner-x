function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeEmit(emit, name, status, payload) {
  if (typeof emit !== "function") return;
  emit(name, { actor: "design", status, payload });
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseTagAttributes(tag) {
  const attrs = {};
  const re = /\b([a-zA-Z0-9_:-]+)\s*=\s*(["'])(.*?)\2/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[3];
  return attrs;
}

function normalizeRenderType(v) {
  const t = String(v || "").trim().toLowerCase();
  if (t === "svg") return "svg";
  if (t === "ai-image" || t === "ai_image" || t === "image") return "ai-image";
  if (t === "asset") return "asset";
  return "";
}

function parsePercent(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+(\.\d+)?)%$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function sizeFromPosition(position) {
  const wPct = parsePercent(position?.w);
  const hPct = parsePercent(position?.h);
  if (wPct === null || hPct === null || hPct === 0) return null;
  const ratio = wPct / hPct;
  const height = 360;
  const width = Math.max(100, Math.round(height * ratio));
  return { width, height };
}

function pickColors(designSystem) {
  const tokens = designSystem?.designTokens || designSystem || {};
  const colors = tokens?.colors || {};
  const primary = toNonEmptyString(colors.primary) || "#0ea5e9";
  const secondary = toNonEmptyString(colors.secondary) || "#8b5cf6";
  const text = toNonEmptyString(colors.text) || "#0f172a";
  const muted = toNonEmptyString(colors.textMuted) || "#64748b";
  const bg = toNonEmptyString(colors.surface) || toNonEmptyString(colors.background) || "#ffffff";
  return { primary, secondary, text, muted, bg };
}

function svgWrap({ width, height, label, inner }) {
  const aria = toNonEmptyString(label) || "Diagram";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(aria)}">`,
    inner,
    `</svg>`,
  ].join("");
}

function makeChartPlaceholder({ width, height, colors, title }) {
  const pad = Math.round(Math.min(width, height) * 0.08);
  const axisX0 = pad;
  const axisY0 = height - pad;
  const axisX1 = width - pad;
  const axisY1 = pad;
  const bars = 5;
  const barGap = Math.round((axisX1 - axisX0) * 0.03);
  const barW = Math.max(8, Math.round(((axisX1 - axisX0) - barGap * (bars + 1)) / bars));
  const maxBarH = Math.max(10, axisY0 - axisY1 - Math.round(height * 0.18));
  const inner = [];

  inner.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeAttr(colors.bg)}" />`);
  inner.push(`<line x1="${axisX0}" y1="${axisY0}" x2="${axisX1}" y2="${axisY0}" stroke="${escapeAttr(colors.muted)}" stroke-width="2" />`);
  inner.push(`<line x1="${axisX0}" y1="${axisY0}" x2="${axisX0}" y2="${axisY1}" stroke="${escapeAttr(colors.muted)}" stroke-width="2" />`);

  for (let i = 0; i < bars; i++) {
    const h = Math.round(maxBarH * (0.35 + (i / (bars - 1)) * 0.55));
    const x = axisX0 + barGap + i * (barW + barGap);
    const y = axisY0 - h;
    const fill = i % 2 === 0 ? colors.primary : colors.secondary;
    inner.push(`<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${escapeAttr(fill)}" opacity="0.85" />`);
  }

  const label = toNonEmptyString(title) || "Chart";
  inner.push(
    `<text x="${pad}" y="${Math.max(18, Math.round(pad * 0.7))}" font-family="Inter, system-ui, sans-serif" font-size="16" fill="${escapeAttr(colors.text)}">${escapeAttr(label)}</text>`
  );
  return inner.join("");
}

function makeFlowchart({ width, height, colors, svgSpec }) {
  const nodes = Array.isArray(svgSpec?.elements) ? svgSpec.elements.filter((e) => String(e?.type || "").toLowerCase() === "node") : [];
  const labels = nodes.length ? nodes.map((n) => toNonEmptyString(n?.label) || "Step") : ["Start", "Process", "End"];
  const n = labels.length;
  const cx0 = Math.round(width * 0.18);
  const cx1 = Math.round(width * 0.82);
  const cy = Math.round(height * 0.55);
  const r = Math.max(18, Math.round(Math.min(width, height) * 0.07));
  const inner = [];

  inner.push(`<defs>`);
  inner.push(
    `<linearGradient id="pb_grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${escapeAttr(colors.primary)}"/><stop offset="1" stop-color="${escapeAttr(colors.secondary)}"/></linearGradient>`
  );
  inner.push(
    `<filter id="pb_glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
  );
  inner.push(`</defs>`);

  inner.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeAttr(colors.bg)}" />`);

  const xs = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    xs.push(Math.round(cx0 + (cx1 - cx0) * t));
  }

  for (let i = 0; i < n - 1; i++) {
    const x1 = xs[i] + r;
    const x2 = xs[i + 1] - r;
    const mid = Math.round((x1 + x2) / 2);
    inner.push(
      `<path d="M ${x1} ${cy} C ${mid} ${Math.round(cy - r * 0.8)}, ${mid} ${Math.round(cy + r * 0.8)}, ${x2} ${cy}" fill="none" stroke="${escapeAttr(colors.muted)}" stroke-width="3" marker-end="url(#pb_arrow)" />`
    );
  }

  inner.push(`<defs><marker id="pb_arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${escapeAttr(colors.muted)}"/></marker></defs>`);

  for (let i = 0; i < n; i++) {
    inner.push(`<circle cx="${xs[i]}" cy="${cy}" r="${r}" fill="url(#pb_grad)" filter="url(#pb_glow)" />`);
    inner.push(
      `<text x="${xs[i]}" y="${cy + 5}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${Math.max(12, Math.round(r * 0.45))}" fill="#ffffff">${escapeAttr(labels[i])}</text>`
    );
  }

  const title = toNonEmptyString(svgSpec?.description) || toNonEmptyString(svgSpec?.type) || "Flowchart";
  inner.push(
    `<text x="${Math.round(width * 0.5)}" y="${Math.round(height * 0.18)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="16" fill="${escapeAttr(colors.text)}">${escapeAttr(title)}</text>`
  );
  return inner.join("");
}

function generateSvgForSlot(slot, designSystem) {
  const svgSpec = slot?.svgSpec && typeof slot.svgSpec === "object" ? slot.svgSpec : {};
  const type = toNonEmptyString(svgSpec?.type || slot?.type).toLowerCase();
  const colors = pickColors(designSystem);
  const size = sizeFromPosition(slot?.position) || { width: 800, height: 450 };
  const width = safeNumber(slot?.width, size.width);
  const height = safeNumber(slot?.height, size.height);
  const label = toNonEmptyString(svgSpec?.description) || toNonEmptyString(slot?.slotId) || "SVG";

  if (type.includes("flow")) {
    return { svgContent: svgWrap({ width, height, label, inner: makeFlowchart({ width, height, colors, svgSpec }) }), width, height };
  }

  if (type.includes("chart")) {
    return { svgContent: svgWrap({ width, height, label, inner: makeChartPlaceholder({ width, height, colors, title: label }) }), width, height };
  }

  const inner = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeAttr(colors.bg)}" />`,
    `<rect x="10" y="10" width="${Math.max(0, width - 20)}" height="${Math.max(0, height - 20)}" rx="12" fill="none" stroke="${escapeAttr(colors.muted)}" stroke-width="2" stroke-dasharray="8 8" />`,
    `<text x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="16" fill="${escapeAttr(colors.text)}">${escapeAttr(label)}</text>`,
  ].join("");
  return { svgContent: svgWrap({ width, height, label, inner }), width, height };
}

export class SVGGenerator {
  async generate(svgSlots, designSystem, { emit, aiApiService } = {}) {
    const slots = Array.isArray(svgSlots) ? svgSlots : [];
    const out = [];

    for (const slot of slots) {
      const slotId = toNonEmptyString(slot?.slotId);
      if (!slotId) continue;

      // Future: allow aiApiService-backed SVG generation. For now we keep it deterministic.
      void aiApiService;
      const res = generateSvgForSlot(slot, designSystem);
      out.push({ slotId, svgContent: res.svgContent, width: res.width, height: res.height });
    }

    safeEmit(emit, "design.svg.generate.completed", "completed", { slots: out.length });
    return out;
  }
}

/**
 * Replace `<div data-el="image-placeholder" ... data-render-type="svg">` with `<div data-el="svg">...</div>`.
 * Pure string patch (Node-friendly; no DOM required).
 *
 * @param {string} html
 * @param {Array<{slotId:string,svgContent:string,width?:number,height?:number}>} filledSlots
 * @returns {{html:string, filledSlotIds:string[], skippedSlotIds:string[]}}
 */
export function fillSvgPlaceholders(html, filledSlots) {
  const input = typeof html === "string" ? html : "";
  const slots = Array.isArray(filledSlots) ? filledSlots : [];
  if (!input || slots.length === 0) return { html: input, filledSlotIds: [], skippedSlotIds: [] };

  const bySlotId = new Map();
  const skippedSlotIds = [];
  for (const s of slots) {
    const slotId = toNonEmptyString(s?.slotId);
    const svgContent = toNonEmptyString(s?.svgContent);
    if (!slotId) continue;
    if (!svgContent) {
      skippedSlotIds.push(slotId);
      continue;
    }
    bySlotId.set(slotId, { svgContent, width: s?.width, height: s?.height });
  }
  if (bySlotId.size === 0) return { html: input, filledSlotIds: [], skippedSlotIds: [...new Set(skippedSlotIds)] };

  const filledSlotIds = [];

  const replaceOne = (match, tag, innerHtml, selfClosing) => {
    const attrs = parseTagAttributes(tag);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !bySlotId.has(slotId)) return match;

    const rt = normalizeRenderType(attrs["data-render-type"]);
    if (rt && rt !== "svg") return match;

    const { svgContent, width, height } = bySlotId.get(slotId);
    filledSlotIds.push(slotId);

    const next = { ...attrs };
    next["data-el"] = "svg";
    next["data-status"] = "filled";
    next["data-render-type"] = "svg";
    delete next["data-fallback"];
    delete next["data-aspect-ratio"];
    if (Number.isFinite(width)) next["data-width"] = String(width);
    if (Number.isFinite(height)) next["data-height"] = String(height);

    const attrPairs = Object.entries(next).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
    const body = selfClosing ? "" : innerHtml;
    return `<div ${attrPairs.join(" ")}>${svgContent || body}</div>`;
  };

  const placeholderRe = /(<div\b[^>]*\bdata-el=(["'])image-placeholder\2[^>]*>)([\s\S]*?)<\/div>/gi;
  const out1 = input.replace(placeholderRe, (match, openTag, _q, inner) => {
    return replaceOne(match, openTag, inner, false);
  });

  const selfClosingRe = /(<div\b[^>]*\bdata-el=(["'])image-placeholder\2[^>]*\/>)/gi;
  const out2 = out1.replace(selfClosingRe, (match, tag) => {
    return replaceOne(match, tag, "", true);
  });

  return { html: out2, filledSlotIds: [...new Set(filledSlotIds)], skippedSlotIds: [...new Set(skippedSlotIds)] };
}

