import { VisualDataStatus } from "../constants.js";
import { parseTagAttributes } from "../shared/html-parser.js";

import { toNonEmptyString } from "../../../shared/utils/value-utils.js";
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

function normalizeAssetUri(asset) {
  const uri = toNonEmptyString(asset?.assetUri) || toNonEmptyString(asset?.uri) || toNonEmptyString(asset?.url) || toNonEmptyString(asset?.src);
  if (uri) return uri;
  const data = toNonEmptyString(asset?.data);
  if (!data) return "";
  if (data.startsWith("data:")) return data;
  const mimeType = toNonEmptyString(asset?.mimeType) || "image/png";
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

/**
 * Replace `<div data-el="image-placeholder" ... data-render-type="asset">` with `<img data-el="image" data-src="...">`.
 * Pure string patch (Node-friendly; no DOM required).
 *
 * @param {string} html
 * @param {Array<{slotId:string,assetUri:string,width?:number|null,height?:number|null}>} resolvedAssets
 * @returns {{html:string, filledSlotIds:string[], skippedSlotIds:string[]}}
 */
export function fillAssetPlaceholders(html, resolvedAssets) {
  const input = typeof html === "string" ? html : "";
  const items = Array.isArray(resolvedAssets) ? resolvedAssets : [];
  if (!input || items.length === 0) return { html: input, filledSlotIds: [], skippedSlotIds: [] };

  const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";
  const findTagEnd = (s, start) => {
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
  };
  const findMatchingDivClose = (s, start) => {
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
        const closeStart = lt;
        const closeEnd = tagEnd + 1;
        pos = closeEnd;
        if (depth === 0) return { closeStart, closeEnd };
        continue;
      }
      if (s.slice(lt + 1, lt + 4).toLowerCase() === "div") {
        const tagEnd = findTagEnd(s, lt + 4);
        if (tagEnd === -1) return null;
        let k = tagEnd - 1;
        while (k > lt && isWs(s[k])) k--;
        const isSelfClosing = s[k] === "/";
        if (!isSelfClosing) depth++;
        pos = tagEnd + 1;
        continue;
      }
      pos = lt + 1;
    }
    return null;
  };
  const findImagePlaceholders = (s) => {
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
      while (k > divStart && isWs(s[k])) k--;
      const isSelfClosing = s[k] === "/";
      if (isSelfClosing) {
        const end = tagEnd + 1;
        results.push({ start: divStart, end, openTag, inner: "", isSelfClosing: true });
        pos = end;
        continue;
      }

      const close = findMatchingDivClose(s, tagEnd + 1);
      if (!close) {
        pos = tagEnd + 1;
        continue;
      }
      results.push({ start: divStart, end: close.closeEnd, openTag, inner: s.slice(tagEnd + 1, close.closeStart), isSelfClosing: false });
      pos = close.closeEnd;
    }
    return results;
  };

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
    bySlotId.set(slotId, { assetUri, width: r?.width, height: r?.height });
  }
  if (bySlotId.size === 0) return { html: input, filledSlotIds: [], skippedSlotIds: [...new Set(skippedSlotIds)] };

  const filledSlotIds = [];

  const buildReplacement = (tag) => {
    /** @type {Record<string, any>} */
    const attrs = parseTagAttributes(tag);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !bySlotId.has(slotId)) return null;

    const rt = normalizeRenderType(attrs["data-render-type"]);
    if (rt && rt !== "asset") return null;

    const { assetUri, width, height } = bySlotId.get(slotId);
    filledSlotIds.push(slotId);

    /** @type {Record<string, any>} */
    const imgAttrs = { ...attrs };
    imgAttrs["data-el"] = "image";
    imgAttrs["data-status"] = VisualDataStatus.FILLED;
    imgAttrs["data-render-type"] = "asset";
    delete imgAttrs["data-fallback"];
    delete imgAttrs["data-aspect-ratio"];

    imgAttrs["data-src"] = assetUri;
    imgAttrs.src = assetUri;
    if (!toNonEmptyString(imgAttrs.alt)) imgAttrs.alt = "Asset image";
    if (!toNonEmptyString(imgAttrs["data-fit"])) imgAttrs["data-fit"] = "cover";
    if (Number.isFinite(width)) imgAttrs.width = String(width);
    if (Number.isFinite(height)) imgAttrs.height = String(height);

    const attrPairs = Object.entries(imgAttrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
    return { slotId, html: `<img ${attrPairs.join(" ")} />` };
  };

  const placeholders = findImagePlaceholders(input);
  let out = input;
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const { start, end, openTag } = placeholders[i];
    const built = buildReplacement(openTag);
    if (!built) continue;
    out = out.slice(0, start) + built.html + out.slice(end);
  }

  return { html: out, filledSlotIds: [...new Set(filledSlotIds)], skippedSlotIds: [...new Set(skippedSlotIds)] };
}
