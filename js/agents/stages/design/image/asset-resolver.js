import { VisualDataStatus } from "../constants.js";
import { parseTagAttributes } from "../shared/html-parser.js";

import { toNonEmptyString } from "../../../shared/utils/value-utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Security: Protocol whitelist for asset URIs
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Set<string>} Allowed URI protocols */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "data:"]);

/** @type {Set<string>} Allowed MIME types for data: URIs */
const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/avif",
]);

/** @type {Set<string>} Attributes allowed to be passed through to img element */
const ALLOWED_IMG_ATTRS = new Set([
  "id",
  "class",
  "alt",
  "title",
  "width",
  "height",
  "loading",
  "decoding",
  "crossorigin",
  "referrerpolicy",
  // data-* attributes are handled separately
]);

/**
 * Check if a URI has an allowed protocol.
 * @param {string} uri - The URI to validate
 * @returns {boolean} True if protocol is allowed
 */
function isAllowedProtocol(uri) {
  if (!uri) return false;
  try {
    const url = new URL(uri, "http://placeholder");
    return ALLOWED_PROTOCOLS.has(url.protocol);
  } catch {
    // Relative URLs or invalid URLs - allow if they don't start with javascript:
    const lower = uri.toLowerCase().trim();
    return !lower.startsWith("javascript:") && !lower.startsWith("vbscript:");
  }
}

/**
 * Validate that a data: URI has an allowed image MIME type.
 * @param {string} uri - The data URI to validate
 * @returns {boolean} True if MIME type is allowed
 */
function isAllowedDataUri(uri) {
  if (!uri || !uri.startsWith("data:")) return true; // Not a data URI
  const match = uri.match(/^data:([^;,]+)/);
  if (!match) return false;
  const mime = match[1].toLowerCase().trim();
  return ALLOWED_IMAGE_MIMES.has(mime);
}

/**
 * Filter attributes to only include safe ones for img elements.
 * @param {Record<string, unknown>} attrs - Raw attributes
 * @returns {Record<string, string>} Filtered safe attributes
 */
function filterSafeAttributes(attrs) {
  /** @type {Record<string, string>} */
  const safe = {};
  for (const [key, value] of Object.entries(attrs)) {
    const lowerKey = key.toLowerCase();
    // Block event handlers (on*)
    if (lowerKey.startsWith("on")) continue;
    // Block style (potential CSS injection)
    if (lowerKey === "style") continue;
    // Block srcset (can bypass src validation)
    if (lowerKey === "srcset") continue;
    // Allow data-* attributes
    if (lowerKey.startsWith("data-")) {
      safe[key] = String(value ?? "");
      continue;
    }
    // Allow whitelisted attributes
    if (ALLOWED_IMG_ATTRS.has(lowerKey)) {
      safe[key] = String(value ?? "");
    }
  }
  return safe;
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeRenderType(v) {
  const t = String(v || "").trim().toLowerCase();
  if (t === "asset" || t === "doc-asset" || t === "document-asset") return "asset";
  if (t === "svg") return "svg";
  if (t === "ai-image" || t === "ai_image" || t === "image") return "ai-image";
  return "";
}

/**
 * Normalize and validate asset URI with security checks.
 * Rejects javascript:, vbscript:, and non-image data: URIs.
 * @param {object} asset - Asset object with URI/data fields
 * @returns {string} Validated URI or empty string if invalid
 */
function normalizeAssetUri(asset) {
  const uri =
    toNonEmptyString(asset?.assetUri) ||
    toNonEmptyString(asset?.uri) ||
    toNonEmptyString(asset?.url) ||
    toNonEmptyString(asset?.src);

  if (uri) {
    // Validate protocol and data: MIME type
    if (!isAllowedProtocol(uri)) return "";
    if (!isAllowedDataUri(uri)) return "";
    return uri;
  }

  const data = toNonEmptyString(asset?.data);
  if (!data) return "";

  // Already a data: URI - validate it
  if (data.startsWith("data:")) {
    if (!isAllowedDataUri(data)) return "";
    return data;
  }

  // Build data: URI from base64 - validate MIME type
  const mimeType = toNonEmptyString(asset?.mimeType) || "image/png";
  if (!ALLOWED_IMAGE_MIMES.has(mimeType.toLowerCase())) return "";
  return `data:${mimeType};base64,${data}`;
}

function extractDims(asset) {
  const w = Number(asset?.width ?? asset?.w ?? asset?.metadata?.width);
  const h = Number(asset?.height ?? asset?.h ?? asset?.metadata?.height);
  return {
    width: Number.isFinite(w) && w > 0 ? w : null,
    height: Number.isFinite(h) && h > 0 ? h : null,
  };
}

export class AssetResolver {
  constructor(assets) {
    const list = Array.isArray(assets) ? assets : [];
    this.byId = new Map();
    for (const a of list) {
      const assetId = toNonEmptyString(a?.assetId);
      if (!assetId) continue;
      this.byId.set(assetId, a);
    }
  }

  resolve(assetSlots) {
    const slots = Array.isArray(assetSlots) ? assetSlots : [];
    const out = [];

    for (const slot of slots) {
      const slotId = toNonEmptyString(slot?.slotId);
      if (!slotId) continue;
      const assetId = toNonEmptyString(slot?.assetSpec?.assetId) || toNonEmptyString(slot?.assetId) || "";
      if (!assetId) continue;

      const asset = this.byId.get(assetId) || null;
      if (!asset) continue;
      const assetUri = normalizeAssetUri(asset);
      if (!assetUri) continue;

      const dims = extractDims(asset);
      out.push({ slotId, assetUri, width: dims.width, height: dims.height });
    }

    return out;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML Parsing Helpers (extracted for readability and testability)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if character is whitespace.
 * @param {string} c - Single character
 * @returns {boolean}
 */
function isWhitespace(c) {
  return c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";
}

/**
 * Find the end of an HTML tag (the closing '>').
 * @param {string} s - HTML string
 * @param {number} start - Position to start searching from
 * @returns {number} Index of '>' or -1 if not found
 */
function findTagEnd(s, start) {
  let quote = null;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

/**
 * Find the matching closing </div> tag.
 * @param {string} s - HTML string
 * @param {number} start - Position after the opening tag
 * @returns {{closeStart: number, closeEnd: number}|null}
 */
function findMatchingDivClose(s, start) {
  let depth = 1;
  let pos = start;
  while (pos < s.length) {
    const lt = s.indexOf("<", pos);
    if (lt === -1) return null;
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      pos = end === -1 ? s.length : end + 3;
      continue;
    }
    const next = s[lt + 1];
    if (next === "/" && s.slice(lt + 2, lt + 5).toLowerCase() === "div") {
      const tagEnd = findTagEnd(s, lt + 2);
      if (tagEnd === -1) return null;
      depth--;
      if (depth === 0) return { closeStart: lt, closeEnd: tagEnd + 1 };
      pos = tagEnd + 1;
      continue;
    }
    if (s.slice(lt + 1, lt + 4).toLowerCase() === "div") {
      const tagEnd = findTagEnd(s, lt + 4);
      if (tagEnd === -1) return null;
      let k = tagEnd - 1;
      while (k > lt && isWhitespace(s[k])) k--;
      if (s[k] !== "/") depth++;
      pos = tagEnd + 1;
      continue;
    }
    pos = lt + 1;
  }
  return null;
}

/**
 * @typedef {Object} PlaceholderMatch
 * @property {number} start - Start index in HTML
 * @property {number} end - End index in HTML
 * @property {string} openTag - The opening tag string
 * @property {string} inner - Inner HTML content
 * @property {boolean} isSelfClosing - Whether tag is self-closing
 */

/**
 * Find all image placeholder divs in HTML.
 * @param {string} s - HTML string
 * @returns {PlaceholderMatch[]}
 */
function findImagePlaceholders(s) {
  const results = [];
  let pos = 0;
  while (pos < s.length) {
    const divStart = s.indexOf("<div", pos);
    if (divStart === -1) break;
    const tagEnd = findTagEnd(s, divStart + 4);
    if (tagEnd === -1) break;
    const openTag = s.slice(divStart, tagEnd + 1);
    const attrs = parseTagAttributes(openTag);
    if (String(attrs["data-el"] || "").toLowerCase() !== "image-placeholder") {
      pos = tagEnd + 1;
      continue;
    }

    let k = tagEnd - 1;
    while (k > divStart && isWhitespace(s[k])) k--;
    const isSelfClosing = s[k] === "/";
    if (isSelfClosing) {
      results.push({ start: divStart, end: tagEnd + 1, openTag, inner: "", isSelfClosing: true });
      pos = tagEnd + 1;
      continue;
    }

    const close = findMatchingDivClose(s, tagEnd + 1);
    if (!close) {
      pos = tagEnd + 1;
      continue;
    }
    results.push({
      start: divStart,
      end: close.closeEnd,
      openTag,
      inner: s.slice(tagEnd + 1, close.closeStart),
      isSelfClosing: false,
    });
    pos = close.closeEnd;
  }
  return results;
}

/**
 * Build an <img> tag HTML string from placeholder attributes and asset data.
 * Applies security filtering to attributes.
 * @param {Record<string, unknown>} rawAttrs - Parsed attributes from placeholder
 * @param {string} assetUri - Validated asset URI
 * @param {number|null} width - Asset width
 * @param {number|null} height - Asset height
 * @returns {string} HTML string for img element
 */
function buildImgHtml(rawAttrs, assetUri, width, height) {
  // Filter to safe attributes only (Issue #2 fix)
  const imgAttrs = filterSafeAttributes(rawAttrs);

  // Set required data attributes
  imgAttrs["data-el"] = "image";
  imgAttrs["data-status"] = VisualDataStatus.FILLED;
  imgAttrs["data-render-type"] = "asset";
  delete imgAttrs["data-fallback"];
  delete imgAttrs["data-aspect-ratio"];

  // Set image source
  imgAttrs["data-src"] = assetUri;
  imgAttrs.src = assetUri;

  // Set defaults
  if (!imgAttrs.alt) imgAttrs.alt = "Asset image";
  if (!imgAttrs["data-fit"]) imgAttrs["data-fit"] = "cover";
  if (Number.isFinite(width)) imgAttrs.width = String(width);
  if (Number.isFinite(height)) imgAttrs.height = String(height);

  const attrPairs = Object.entries(imgAttrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
  return `<img ${attrPairs.join(" ")} />`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ResolvedAsset
 * @property {string} slotId - Unique slot identifier
 * @property {string} assetUri - Validated asset URI (http/https/data:image)
 * @property {number|null} [width] - Asset width in pixels
 * @property {number|null} [height] - Asset height in pixels
 */

/**
 * @typedef {Object} FillResult
 * @property {string} html - HTML with placeholders replaced by img tags
 * @property {string[]} filledSlotIds - IDs of successfully filled slots
 * @property {string[]} skippedSlotIds - IDs of slots that were skipped
 */

/**
 * Replace `<div data-el="image-placeholder" ... data-render-type="asset">` with `<img>`.
 *
 * Pure string patch (Node-friendly; no DOM required). Applies security filtering
 * to block XSS vectors (event handlers, dangerous protocols, non-image MIME types).
 *
 * @param {string} html - HTML string containing image placeholders
 * @param {ResolvedAsset[]} resolvedAssets - Array of resolved assets with validated URIs
 * @returns {FillResult} Result with transformed HTML and slot tracking
 */
export function fillAssetPlaceholders(html, resolvedAssets) {
  const input = typeof html === "string" ? html : "";
  const items = Array.isArray(resolvedAssets) ? resolvedAssets : [];
  if (!input || items.length === 0) {
    return { html: input, filledSlotIds: [], skippedSlotIds: [] };
  }

  // Build lookup map and track skipped slots
  const bySlotId = new Map();
  const skippedSlotIds = [];
  for (const r of items) {
    const slotId = toNonEmptyString(r?.slotId);
    const assetUri = toNonEmptyString(r?.assetUri);
    if (!slotId) continue;
    if (!assetUri) {
      skippedSlotIds.push(slotId);
      continue;
    }
    bySlotId.set(slotId, { assetUri, width: r?.width ?? null, height: r?.height ?? null });
  }
  if (bySlotId.size === 0) {
    return { html: input, filledSlotIds: [], skippedSlotIds: [...new Set(skippedSlotIds)] };
  }

  // Find and replace placeholders
  const placeholders = findImagePlaceholders(input);
  const filledSlotIds = [];
  let out = input;

  // Process in reverse order to preserve indices
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const { start, end, openTag } = placeholders[i];
    const attrs = parseTagAttributes(openTag);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !bySlotId.has(slotId)) continue;

    const rt = normalizeRenderType(attrs["data-render-type"]);
    if (rt && rt !== "asset") continue;

    const { assetUri, width, height } = bySlotId.get(slotId);
    filledSlotIds.push(slotId);
    const imgHtml = buildImgHtml(attrs, assetUri, width, height);
    out = out.slice(0, start) + imgHtml + out.slice(end);
  }

  return {
    html: out,
    filledSlotIds: [...new Set(filledSlotIds)],
    skippedSlotIds: [...new Set(skippedSlotIds)],
  };
}
