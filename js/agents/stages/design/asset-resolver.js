import { VisualDataStatus } from "./constants.js";

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
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

  const replaceOne = (match, tag) => {
    const attrs = parseTagAttributes(tag);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !bySlotId.has(slotId)) return match;

    const rt = normalizeRenderType(attrs["data-render-type"]);
    if (rt && rt !== "asset") return match;

    const { assetUri, width, height } = bySlotId.get(slotId);
    filledSlotIds.push(slotId);

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
    return `<img ${attrPairs.join(" ")} />`;
  };

  const placeholderRe = /(<div\b[^>]*\bdata-el=(["'])image-placeholder\2[^>]*>)[\s\S]*?<\/div>/gi;
  const out1 = input.replace(placeholderRe, (match, openTag) => replaceOne(match, openTag));

  const selfClosingRe = /(<div\b[^>]*\bdata-el=(["'])image-placeholder\2[^>]*\/>)/gi;
  const out2 = out1.replace(selfClosingRe, (match, tag) => replaceOne(match, tag));

  return { html: out2, filledSlotIds: [...new Set(filledSlotIds)], skippedSlotIds: [...new Set(skippedSlotIds)] };
}
