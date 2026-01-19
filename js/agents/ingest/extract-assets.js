import { normalizeText } from "../stages/textprep/normalize.js";
import { normalizeAssetMimeType } from "./constants.js";

import { isPlainObject, toNonEmptyString } from "../shared/index.js";
function guessMimeTypeFromNameOrData(name, data) {
  const d = String(data || "");
  if (d.startsWith("data:")) {
    const semi = d.indexOf(";");
    const comma = d.indexOf(",");
    const end = semi > 5 ? semi : comma;
    const mime = d.slice("data:".length, end);
    return toNonEmptyString(mime) || "application/octet-stream";
  }

  const n = String(name || "").toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function stripAngleBrackets(url) {
  const s = String(url || "").trim();
  if (s.startsWith("<") && s.endsWith(">")) return s.slice(1, -1).trim();
  return s;
}

function normalizeUrlPath(url) {
  const u = stripAngleBrackets(url);
  const hash = u.indexOf("#");
  const query = u.indexOf("?");
  const cut = Math.min(hash === -1 ? u.length : hash, query === -1 ? u.length : query);
  return u.slice(0, cut);
}

function basename(p) {
  const s = String(p || "");
  const slash = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return slash === -1 ? s : s.slice(slash + 1);
}

function hasExtension(name) {
  const n = String(name || "");
  const dot = n.lastIndexOf(".");
  return dot > 0 && dot < n.length - 1;
}

function withoutExtension(name) {
  const n = String(name || "");
  const dot = n.lastIndexOf(".");
  return dot > 0 ? n.slice(0, dot) : n;
}

function buildImageLookup(images) {
  const map = new Map();
  for (const img of Array.isArray(images) ? images : []) {
    if (!img) continue;
    const id = toNonEmptyString(img.id) || toNonEmptyString(img.name) || toNonEmptyString(img.filename);
    const data = toNonEmptyString(img.data) || (typeof img === "string" ? img : undefined);
    if (!id || !data) continue;

    const keys = new Set();
    keys.add(id);
    keys.add(`images/${id}`);

    const base = withoutExtension(id);
    keys.add(base);
    keys.add(`images/${base}`);

    if (!hasExtension(id)) {
      for (const ext of [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]) {
        keys.add(`${id}${ext}`);
        keys.add(`images/${id}${ext}`);
      }
    }

    for (const k of keys) map.set(k, { id, data, raw: img });
  }
  return map;
}

function defaultAssetIdFromHash(hash) {
  const hex = String(hash || "").startsWith("sha256:") ? String(hash).slice("sha256:".length) : String(hash || "");
  return `asset_${hex.slice(0, 12) || "unknown"}`;
}

/**
 * Extract OCR assets from markdown placeholders and attach locators.
 * Supports placeholders like: ![alt](images/img-001.jpg)
 * @param {string} markdown
 * @param {Array<{id?:string,name?:string,filename?:string,data?:string}>} images
 * @returns {Array<object>} Asset[]
 */
export function extractAssetsFromMarkdown(markdown, images) {
  const md = String(markdown || "");
  const lookup = buildImageLookup(images);

  const assets = [];
  const imageRe = /!\[([^\]]*?)\]\(([^)]+)\)/g;
  let m;
  while ((m = imageRe.exec(md))) {
    const full = m[0];
    const urlRaw = m[2];
    const urlPath = normalizeUrlPath(urlRaw);

    const urlBasename = basename(urlPath);
    const keyCandidates = [];
    if (urlPath) keyCandidates.push(urlPath);
    if (urlBasename) keyCandidates.push(urlBasename);
    if (urlPath && urlPath.startsWith("images/")) keyCandidates.push(urlPath.slice("images/".length));
    if (urlBasename) keyCandidates.push(withoutExtension(urlBasename));

    let resolved = null;
    for (const k of keyCandidates) {
      resolved = lookup.get(k);
      if (resolved) break;
    }
    if (!resolved) continue;

    const mimeType = normalizeAssetMimeType(guessMimeTypeFromNameOrData(urlBasename || resolved.id, resolved.data));
    const signature = JSON.stringify({ type: "image", mimeType, data: resolved.data });
    const hash = normalizeText(signature).textHash;

    assets.push({
      assetId: defaultAssetIdFromHash(hash),
      docId: "",
      type: "image",
      data: resolved.data,
      mimeType,
      locator: { charStart: m.index, charEnd: m.index + full.length },
      source: "ocr",
      reusable: true,
      ...(isPlainObject(resolved.raw) && Number.isFinite(resolved.raw.page) ? { locator: { charStart: m.index, charEnd: m.index + full.length, page: resolved.raw.page } } : {}),
    });
  }

  return assets;
}
