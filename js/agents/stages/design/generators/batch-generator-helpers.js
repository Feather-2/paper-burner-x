import { VisualDataStatus } from "../constants.js";
import { parseTagAttributes } from "../shared/html-parser.js";
import { toNonEmptyString } from "../../../shared/index.js";

// === 可配置常量 ===
export const BATCH_GENERATOR_DEFAULTS = {
  maxContentLength: 800, // markdown 截断长度
};

export const ALLOWED_TAGS = new Set([
  "section",
  "div",
  "span",
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "img",
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "filter",
  "fegaussianblur",
  "feoffset",
  "feblend",
  "fecolormatrix",
  "fecomponenttransfer",
  "fefuncr",
  "fefuncg",
  "fefuncb",
  "fefunca",
  "pattern",
  "symbol",
  "use",
  "title",
  "desc",
  "metadata",
]);

export const VOID_TAGS = new Set(["img", "br"]);
export const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "filter",
  "fegaussianblur",
  "feoffset",
  "feblend",
  "fecolormatrix",
  "fecomponenttransfer",
  "fefuncr",
  "fefuncg",
  "fefuncb",
  "fefunca",
  "pattern",
  "symbol",
  "use",
  "title",
  "desc",
  "metadata",
]);

export const GLOBAL_ALLOWED_ATTRS = new Set(["id", "class", "role", "title"]);
export const IMG_ALLOWED_ATTRS = new Set(["src", "alt", "width", "height", "loading", "decoding"]);
export const SVG_ALLOWED_ATTRS = new Set([
  "viewbox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "fill-rule",
  "clip-rule",
  "font-size",
  "font-family",
  "text-anchor",
  "dominant-baseline",
  "transform",
  "preserveaspectratio",
  "gradientunits",
  "gradienttransform",
  "offset",
  "stop-color",
  "stop-opacity",
  "maskunits",
  "maskcontentunits",
  "clippathunits",
  "filterunits",
  "stddeviation",
  "in",
  "in2",
  "type",
  "values",
  "result",
  "href",
  "xlink:href",
  "xmlns",
  "xmlns:xlink",
  "patternunits",
  "patterncontentunits",
  "patterntransform",
  "marker-start",
  "marker-end",
  "marker-mid",
  "markerwidth",
  "markerheight",
  "orient",
  "refx",
  "refy",
]);

export function nowMs() {
  return Date.now();
}

export function chunkIndexes(len, size) {
  const out = [];
  const n = Math.max(0, Number(len) || 0);
  const chunkSize = Math.max(1, Number(size) || 1);
  for (let i = 0; i < n; i += chunkSize) {
    const slideIndexes = [];
    for (let j = i; j < Math.min(n, i + chunkSize); j++) slideIndexes.push(j);
    out.push(slideIndexes);
  }
  return out;
}

/**
 * ReDoS-safe HTML validation
 * Uses indexOf + substring instead of vulnerable regex patterns
 */
export function looksLikeSlideHtml(html) {
  if (typeof html !== "string") return false;
  const lower = html.toLowerCase();
  // Check for <section with data-type="freeform" and data-el=
  const sectionIdx = lower.indexOf("<section");
  if (sectionIdx === -1) return false;
  const closeIdx = lower.indexOf(">", sectionIdx);
  if (closeIdx === -1) return false;
  const tag = lower.slice(sectionIdx, closeIdx + 1);
  return tag.includes('data-type="freeform"') && lower.includes("data-el=");
}

export function isUrlAttr(name) {
  if (!name) return false;
  if (name === "src" || name === "href" || name === "xlink:href") return true;
  if (name.endsWith("src") || name.endsWith("href") || name.endsWith("url")) return true;
  return false;
}

export function isAllowedAttr(tag, name) {
  if (!name) return false;
  if (name.startsWith("data-") || name.startsWith("aria-")) return true;
  if (GLOBAL_ALLOWED_ATTRS.has(name)) return true;
  if (tag === "img") return IMG_ALLOWED_ATTRS.has(name);
  if (SVG_TAGS.has(tag)) return SVG_ALLOWED_ATTRS.has(name);
  return false;
}

export function sanitizeAttrValue(name, value) {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (isUrlAttr(name)) {
    const lowered = raw.trim().toLowerCase();
    if (lowered.startsWith("javascript:") || lowered.startsWith("data:") || lowered.startsWith("vbscript:")) return null;
  }
  return raw;
}

export function escapeAttrValue(value) {
  return String(value ?? "")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function sanitizeSlideHtml(html) {
  if (typeof html !== "string" || !html) return "";
  let s = html;
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  s = s.replace(/<script\b[^>]*\/>/gi, "");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  s = s.replace(/<style\b[^>]*\/>/gi, "");
  s = s.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, "");
  s = s.replace(/<foreignObject\b[^>]*\/>/gi, "");

  let out = "";
  let pos = 0;
  while (pos < s.length) {
    const lt = s.indexOf("<", pos);
    if (lt === -1) {
      out += s.slice(pos);
      break;
    }
    out += s.slice(pos, lt);
    const gt = s.indexOf(">", lt + 1);
    if (gt === -1) {
      out += s.slice(lt);
      break;
    }
    const rawTag = s.slice(lt, gt + 1);
    const rawLower = rawTag.toLowerCase();

    if (rawLower.startsWith("<!--") || rawLower.startsWith("<!doctype") || rawLower.startsWith("<!")) {
      pos = gt + 1;
      continue;
    }

    const closeMatch = rawLower.match(/^<\s*\/\s*([a-z0-9:-]+)/);
    if (closeMatch) {
      const tagName = closeMatch[1];
      if (ALLOWED_TAGS.has(tagName)) out += `</${tagName}>`;
      pos = gt + 1;
      continue;
    }

    const openMatch = rawLower.match(/^<\s*([a-z0-9:-]+)/);
    if (!openMatch) {
      pos = gt + 1;
      continue;
    }
    const tagName = openMatch[1];
    if (!ALLOWED_TAGS.has(tagName)) {
      pos = gt + 1;
      continue;
    }

    const attrs = parseTagAttributes(rawTag);
    const attrPairs = [];
    for (const [name, value] of Object.entries(attrs)) {
      if (!name || name.startsWith("on")) continue;
      if (!isAllowedAttr(tagName, name)) continue;
      const sanitizedValue = sanitizeAttrValue(name, value);
      if (sanitizedValue === null) continue;
      attrPairs.push(`${name}="${escapeAttrValue(sanitizedValue)}"`);
    }

    const isSelfClosing = rawLower.endsWith("/>") || VOID_TAGS.has(tagName);
    out += `<${tagName}${attrPairs.length ? " " + attrPairs.join(" ") : ""}${isSelfClosing ? " />" : ">"}>`;
    pos = gt + 1;
  }

  return out;
}

export function stripHtmlFences(text) {
  let s = String(text || "").trim();
  if (!s) return "";
  s = s.replace(/^```(?:html)?[\s\n]*/i, "").replace(/[\s\n]*```$/i, "");
  return s.trim();
}

export function extractSectionBlock(text) {
  const s = stripHtmlFences(text);
  if (!s) return "";
  const lower = s.toLowerCase();
  const start = lower.indexOf("<section");
  if (start < 0) return s;
  const end = lower.lastIndexOf("</section>");
  if (end > start) return s.slice(start, end + "</section>".length);
  return s.slice(start);
}

export function ensureSectionAttr(slideHtml, name, value) {
  if (typeof slideHtml !== "string") return slideHtml;
  const m = slideHtml.match(/<section\b[^>]*>/i);
  if (!m) return slideHtml;
  const tag = m[0];
  if (new RegExp(`\\b${name}=`, "i").test(tag)) return slideHtml;
  const patched = tag.replace(/<section\b/i, `<section ${name}="${String(value).replace(/"/g, "&quot;")}"`);
  return slideHtml.replace(tag, patched);
}

export function normalizeDslRules(dslRules) {
  if (typeof dslRules === "string") return dslRules.trim();
  if (dslRules === undefined || dslRules === null) return "";
  return String(dslRules).trim();
}

export function normalizeSlideIntentContentForPrompt(slideIntent) {
  const content = slideIntent?.content;
  let markdown = "";

  if (typeof content === "string") {
    markdown = content.trim();
  } else if (content && typeof content === "object") {
    markdown = typeof content?.markdown === "string" ? content.markdown.trim() : "";
  }

  // Limit content length to prevent text overflow in slides
  const maxLen = BATCH_GENERATOR_DEFAULTS.maxContentLength;
  if (markdown.length > maxLen) {
    markdown = markdown.slice(0, maxLen) + "\n...(content truncated, summarize key points only)";
  }

  return { content: content || null, contentMarkdown: markdown };
}

export function normalizeSelectedIdeas(selectedIdeas = []) {
  const list = Array.isArray(selectedIdeas) ? selectedIdeas : [];

  /** @type {Map<string, {slideIntentId:string,atmosphere?:any,elementsMarkdown?:string,visualSlots?:Array<object>}>} */
  const bySlideIntentId = new Map();
  /** @type {Map<string, {slotId:string,slideIntentId?:string,renderType?:string,position?:any,effects?:any}>} */
  const bySlotId = new Map();

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const slideIntentId = toNonEmptyString(raw.slideIntentId || raw.slideIntentID);
    if (!slideIntentId) continue;

    const atmosphere = raw.atmosphere && typeof raw.atmosphere === "object" ? { ...raw.atmosphere } : undefined;
    const elementsMarkdown = typeof raw.elementsMarkdown === "string" ? raw.elementsMarkdown : "";
    const visualSlots = Array.isArray(raw.visualSlots) ? raw.visualSlots.filter((s) => s && typeof s === "object") : [];

    bySlideIntentId.set(slideIntentId, { slideIntentId, atmosphere, elementsMarkdown, visualSlots });

    for (const slot of visualSlots) {
      const slotId = toNonEmptyString(slot?.slotId);
      if (!slotId) continue;
      bySlotId.set(slotId, {
        slotId,
        slideIntentId: toNonEmptyString(slot?.slideIntentId) || slideIntentId,
        renderType: toNonEmptyString(slot?.renderType),
        position: slot?.position && typeof slot.position === "object" ? { ...slot.position } : undefined,
        effects: slot?.effects && typeof slot.effects === "object" ? { ...slot.effects } : undefined,
      });
    }
  }

  return { bySlideIntentId, bySlotId };
}

export function escapeAttr(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildPatchedPlaceholder(tag, innerHtml, hint) {
  const attrs = parseTagAttributes(tag);
  const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
  if (!slotId) return null;

  const next = { ...attrs };
  if (hint?.renderType) next["data-render-type"] = hint.renderType;

  const position = hint?.position && typeof hint.position === "object" ? hint.position : null;
  if (position?.x) next["data-x"] = String(position.x);
  if (position?.y) next["data-y"] = String(position.y);
  if (position?.w) next["data-w"] = String(position.w);
  if (position?.h) next["data-h"] = String(position.h);

  const effects = hint?.effects && typeof hint.effects === "object" ? hint.effects : null;
  if (effects && Object.keys(effects).length) next["data-effects"] = JSON.stringify(effects);

  const attrPairs = Object.entries(next).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
  return `<div ${attrPairs.join(" ")}>${innerHtml}</div>`;
}

/**
 * ReDoS-safe: 迭代查找 image-placeholder div，避免 [^>]* 正则
 */
export function findImagePlaceholders(html) {
  const results = [];
  let pos = 0;
  while (pos < html.length) {
    const divStart = html.toLowerCase().indexOf("<div", pos);
    if (divStart === -1) break;
    const tagEnd = html.indexOf(">", divStart);
    if (tagEnd === -1) break;
    const openTag = html.slice(divStart, tagEnd + 1);
    const tagLower = openTag.toLowerCase();
    if (tagLower.includes('data-el="image-placeholder"') || tagLower.includes("data-el='image-placeholder'")) {
      const isSelfClosing = openTag.trimEnd().endsWith("/>");
      if (isSelfClosing) {
        results.push({ start: divStart, end: tagEnd + 1, openTag, inner: "", isSelfClosing: true });
      } else {
        const closeTag = "</div>";
        const closeIdx = html.toLowerCase().indexOf(closeTag, tagEnd);
        if (closeIdx !== -1) {
          const inner = html.slice(tagEnd + 1, closeIdx);
          results.push({ start: divStart, end: closeIdx + closeTag.length, openTag, inner, isSelfClosing: false });
        }
      }
    }
    pos = tagEnd + 1;
  }
  return results;
}

export function applyVisualSlotHintsToSlideHtml(slideHtml, imageSlotsForSlide = [], slotHintsBySlotId) {
  const html = typeof slideHtml === "string" ? slideHtml : "";
  const slots = Array.isArray(imageSlotsForSlide) ? imageSlotsForSlide : [];
  if (!html || !slots.length || !(slotHintsBySlotId instanceof Map) || slotHintsBySlotId.size === 0) return html;

  const needed = new Set(slots.map((s) => toNonEmptyString(s?.slotId)).filter(Boolean));
  if (needed.size === 0) return html;

  /** @type {Array<[string, any]>} */
  const slotPairs = [];
  for (const slot of slots) {
    const slotId = toNonEmptyString(slot?.slotId);
    if (!slotId) continue;
    slotPairs.push([slotId, slot]);
  }
  const slotById = new Map(slotPairs);
  const seen = new Set();

  // ReDoS-safe: 使用迭代字符串解析替代 [^>]* 正则
  const placeholders = findImagePlaceholders(html);
  let patched2 = html;
  // 从后向前替换，避免偏移量变化
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const { start, end, openTag, inner, isSelfClosing } = placeholders[i];
    const attrs = parseTagAttributes(openTag);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !needed.has(slotId)) continue;
    const hint = slotHintsBySlotId.get(slotId);
    if (!hint) continue;
    seen.add(slotId);
    const tag = isSelfClosing ? openTag.replace(/\/>$/i, ">") : openTag;
    const replacement = buildPatchedPlaceholder(tag, inner, hint);
    if (replacement) {
      patched2 = patched2.slice(0, start) + replacement + patched2.slice(end);
    }
  }

  const missing = [...needed].filter((slotId) => !seen.has(slotId) && slotHintsBySlotId.has(slotId));
  if (missing.length === 0) return patched2;

  const insertTags = missing
    .map((slotId) => {
      const hint = slotHintsBySlotId.get(slotId);
      const baseSlot = slotById.get(slotId) || null;
      const attrs = {
        "data-el": "image-placeholder",
        id: slotId,
        "data-slot-id": slotId,
        "data-status": VisualDataStatus.PENDING,
        ...(toNonEmptyString(baseSlot?.aspectRatio) ? { "data-aspect-ratio": toNonEmptyString(baseSlot.aspectRatio) } : {}),
        "data-fallback": "gradient",
        ...(hint?.renderType ? { "data-render-type": hint.renderType } : {}),
        ...(hint?.position?.x ? { "data-x": String(hint.position.x) } : {}),
        ...(hint?.position?.y ? { "data-y": String(hint.position.y) } : {}),
        ...(hint?.position?.w ? { "data-w": String(hint.position.w) } : {}),
        ...(hint?.position?.h ? { "data-h": String(hint.position.h) } : {}),
        ...(hint?.effects && Object.keys(hint.effects).length ? { "data-effects": JSON.stringify(hint.effects) } : {}),
      };
      const attrPairs = Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
      return `<div ${attrPairs.join(" ")}></div>`;
    })
    .join("");

  if (/<\/section>\s*$/i.test(patched2)) return patched2.replace(/<\/section>\s*$/i, `${insertTags}</section>`);
  return patched2 + insertTags;
}

export function buildStyleDescription(designSystem) {
  const styleRef = designSystem?.styleReference?.extracted;
  const colors = designSystem?.designTokens?.colors || designSystem?.colors || {};
  const userNotes = designSystem?.styleReference?.userNotes || "";

  const parts = [];

  // Color palette
  const palette = styleRef?.palette || [];
  const primaryColors = [colors.primary, colors.accent, colors.bg, colors.text].filter(Boolean);
  const allColors = [...new Set([...palette, ...primaryColors])].slice(0, 6);
  if (allColors.length) {
    parts.push(`Color palette: ${allColors.join(", ")}`);
  }

  // Style attributes from reference images
  if (styleRef?.colorTone) parts.push(`Color tone: ${styleRef.colorTone}`);
  if (styleRef?.mood) parts.push(`Mood: ${styleRef.mood}`);
  if (styleRef?.layoutStyle) parts.push(`Layout: ${styleRef.layoutStyle}`);
  if (styleRef?.typography) parts.push(`Typography: ${styleRef.typography}`);
  if (styleRef?.effects) parts.push(`Effects: ${styleRef.effects}`);
  if (userNotes) parts.push(`User notes: ${userNotes}`);

  // Fallback if no style info
  if (!parts.length) {
    const bg = colors.bg || "#ffffff";
    const isDark = bg.toLowerCase().startsWith("#0") || bg.toLowerCase().startsWith("#1");
    parts.push(`Theme: ${isDark ? "dark" : "light"}, modern business style`);
    parts.push(`Primary: ${colors.primary || "#0ea5e9"}, Accent: ${colors.accent || "#22c55e"}`);
  }

  return parts.join("\n");
}

export function buildPlaceholderUrl(width, height, bgColor, textColor, text) {
  const w = Math.round(width) || 800;
  const h = Math.round(height) || 600;
  const bg = (bgColor || "#1a1a2e").replace("#", "");
  const fg = (textColor || "#666666").replace("#", "");
  const label = encodeURIComponent(String(text || "Image").slice(0, 30));
  return `https://placehold.co/${w}x${h}/${bg}/${fg}?text=${label}`;
}
