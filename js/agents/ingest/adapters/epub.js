import { BaseAdapter } from "./base.js";
import { extractAssetsFromMarkdown } from "../extract-assets.js";
import { SourceKind } from "../constants.js";
import { basenameOfPath, fileLikeFromPath as nodeFileLikeFromPath } from "./node-io.js";

import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
let DOMParserRef = null;

function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".epub")) return "application/epub+zip";
  return "application/octet-stream";
}

async function fileLikeFromPath(path) {
  const name = await basenameOfPath(path);
  return nodeFileLikeFromPath(path, { mimeType: guessMimeType(name) });
}

function resolveTurndownService(stageApi) {
  if (typeof stageApi?.TurndownService === "function") return stageApi.TurndownService;
  if (typeof globalThis?.TurndownService === "function") return globalThis.TurndownService;
  return null;
}

async function importTurndownService() {
  try {
    const mod = await import("turndown");
    const svc = mod?.default || mod;
    return typeof svc === "function" ? svc : null;
  } catch {
    return null;
  }
}

function extFromMime(mimeType) {
  const mt = String(mimeType || "").toLowerCase();
  if (mt.includes("png")) return "png";
  if (mt.includes("jpeg") || mt.includes("jpg")) return "jpg";
  if (mt.includes("gif")) return "gif";
  if (mt.includes("webp")) return "webp";
  if (mt.includes("svg")) return "svg";
  return "png";
}

function parseDataUri(dataUri) {
  const s = String(dataUri || "");
  if (!s.startsWith("data:")) return null;
  const semi = s.indexOf(";");
  const comma = s.indexOf(",");
  const end = semi > 5 ? semi : comma;
  const mimeType = end > 5 ? s.slice("data:".length, end) : "";
  const base64 = comma !== -1 ? s.slice(comma + 1) : "";
  return { mimeType, base64 };
}

function resolveZipPath(baseDir, href) {
  const rel = String(href || "").trim();
  if (!rel) return "";
  if (/^[a-zA-Z]+:\/\//.test(rel)) return rel;
  if (rel.startsWith("data:")) return rel;
  const base = String(baseDir || "").replace(/\\/g, "/");
  const prefix = base.endsWith("/") || !base ? base : `${base}/`;
  const raw = (rel.startsWith("/") ? rel.slice(1) : `${prefix}${rel}`).replace(/\\/g, "/");

  const parts = [];
  for (const p of raw.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return parts.join("/");
}

function dirname(zipPath) {
  const p = String(zipPath || "").replace(/\\/g, "/");
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

function pickOpfPath(zip, containerXml) {
  const fallback = Object.keys(zip?.files || {}).find((p) => p.toLowerCase().endsWith(".opf"));
  if (!containerXml) return fallback || "";

  if (!DOMParserRef) throw new Error("EpubAdapter: DOMParser is required");
  const doc = new DOMParserRef().parseFromString(containerXml, "text/xml");
  const rootfile = doc.querySelector("rootfile");
  const fp = rootfile?.getAttribute("full-path");
  return fp || fallback || "";
}

async function loadDomParser() {
  const { DOMParser } = await import("linkedom");
  DOMParserRef = DOMParser;
}

function parseXml(xmlText) {
  if (!DOMParserRef) throw new Error("EpubAdapter: DOMParser is required");
  return new DOMParserRef().parseFromString(String(xmlText || ""), "text/xml");
}

function safeTextContent(el) {
  const t = el?.textContent;
  return typeof t === "string" ? t.trim() : "";
}

function collectManifest(opfDoc) {
  const manifest = new Map();
  const items = opfDoc.querySelectorAll("manifest > item");
  for (const it of items) {
    const id = it.getAttribute("id");
    const href = it.getAttribute("href");
    const mediaType = it.getAttribute("media-type");
    if (id && href) manifest.set(id, { href, mediaType: mediaType || "" });
  }
  return manifest;
}

function collectSpine(opfDoc) {
  const spine = [];
  const refs = opfDoc.querySelectorAll("spine > itemref");
  for (const ref of refs) {
    const idref = ref.getAttribute("idref");
    if (idref) spine.push(idref);
  }
  return spine;
}

async function readZipText(zip, path) {
  const file = zip.file(path);
  return file ? await file.async("string") : "";
}

async function readZipBase64(zip, path) {
  const file = zip.file(path);
  return file ? await file.async("base64") : "";
}

function extractEmbeddedDataUriImagesFromMarkdown(markdown, { idPrefix, startIndex = 0 } = {}) {
  let md = String(markdown || "");
  const extracted = [];
  let idx = startIndex;

  md = md.replace(/!\[([^\]]*)\]\(data:image\/([^;]+);base64,([A-Za-z0-9+/=]+)\)/g, (match, altText, mimeSub, base64Data) => {
    idx += 1;
    const ext = String(mimeSub || "png").toLowerCase();
    const filename = `${idPrefix || "img"}_${idx}.${ext}`;
    extracted.push({ id: filename, data: base64Data });
    return `![${altText || "image"}](images/${filename})`;
  });

  return { markdown: md, images: extracted, nextIndex: idx };
}

async function materializeChapterImages(html, chapterPath, zip, { startIndex = 0 } = {}) {
  const images = [];
  let idx = startIndex;

  const chapterDir = dirname(chapterPath);
  const imgSrcRe = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+?)["'][^>]*>/gi;
  const srcs = new Set();
  let m;
  while ((m = imgSrcRe.exec(String(html || "")))) {
    const src = String(m[1] || "").trim();
    if (!src) continue;
    srcs.add(src);
  }

  const replacements = new Map();

  for (const src of srcs) {
    if (/^[a-zA-Z]+:\/\//.test(src)) continue;
    const parsed = parseDataUri(src);
    if (parsed?.base64) {
      idx += 1;
      const ext = extFromMime(parsed.mimeType);
      const filename = `epub_img_${idx}.${ext}`;
      images.push({ id: filename, data: parsed.base64 });
      replacements.set(src, `images/${filename}`);
      continue;
    }

    const zipPath = resolveZipPath(chapterDir, src);
    if (!zipPath || zipPath.startsWith("data:")) continue;
    const base64 = await readZipBase64(zip, zipPath);
    if (!base64) continue;
    idx += 1;
    const ext = zipPath.split(".").pop()?.toLowerCase() || "png";
    const filename = `epub_img_${idx}.${ext}`;
    images.push({ id: filename, data: base64 });
    replacements.set(src, `images/${filename}`);
  }

  let outHtml = String(html || "");
  for (const [from, to] of replacements.entries()) {
    const safe = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    outHtml = outHtml.replace(new RegExp(`(\\bsrc\\s*=\\s*["'])${safe}(["'])`, "g"), `$1${to}$2`);
  }

  return { html: outHtml, images, nextIndex: idx };
}

function extractTitleFromXhtml(xhtml) {
  try {
    const doc = parseXml(xhtml);
    const t = safeTextContent(doc.querySelector("title"));
    return t;
  } catch {
    return "";
  }
}

export class EpubAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "epub" });
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,mimeType?:string,size?:number,arrayBuffer?:Function}} input
   * @param {{TurndownService?:Function}=} stageApi
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();
    await loadDomParser();

    let file = input;
    let filename = "";
    let mimeType = "";
    let size = undefined;

    if (typeof input === "string") {
      filename = await basenameOfPath(input);
      mimeType = guessMimeType(filename);
      file = await fileLikeFromPath(input);
      size = file.size;
    } else if (input && typeof input === "object") {
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "book.epub";
      mimeType = toNonEmptyString(input.type) || toNonEmptyString(input.mimeType) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;
      if (typeof input.arrayBuffer !== "function") throw new Error("EpubAdapter.parse(input): unsupported file-like input (missing arrayBuffer())");
    } else {
      throw new TypeError("EpubAdapter.parse(input): input must be a path string or a file-like object");
    }

    const TurndownService = resolveTurndownService(stageApi) || (await importTurndownService());
    if (!TurndownService) throw new Error("EpubAdapter.parse(input): TurndownService is required (stageApi.TurndownService, globalThis.TurndownService, or npm 'turndown')");

    const jszipMod = await import("jszip");
    const JSZip = jszipMod?.default || jszipMod;
    if (typeof JSZip?.loadAsync !== "function") throw new Error("EpubAdapter.parse(input): JSZip is required");

    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const containerXml = await readZipText(zip, "META-INF/container.xml");
    const opfPath = pickOpfPath(zip, containerXml);
    if (!opfPath) throw new Error("EpubAdapter.parse(input): invalid EPUB (missing OPF)");

    const opfXml = await readZipText(zip, opfPath);
    if (!opfXml) throw new Error(`EpubAdapter.parse(input): invalid EPUB (missing ${opfPath})`);

    const opfDoc = parseXml(opfXml);
    const manifest = collectManifest(opfDoc);
    const spine = collectSpine(opfDoc);
    const opfDir = dirname(opfPath);

    const chapterPaths = [];
    for (const idref of spine) {
      const it = manifest.get(idref);
      if (!it?.href) continue;
      const media = String(it.mediaType || "").toLowerCase();
      if (!(media.includes("html") || media.includes("xhtml") || media.includes("xml"))) continue;
      chapterPaths.push(resolveZipPath(opfDir, it.href));
    }

    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

    const chapters = [];
    const allImages = [];
    let imageCounter = 0;

    for (let i = 0; i < chapterPaths.length; i++) {
      const chapterPath = chapterPaths[i];
      const xhtml = await readZipText(zip, chapterPath);
      if (!xhtml) continue;

      const title = extractTitleFromXhtml(xhtml);
      const materialized = await materializeChapterImages(xhtml, chapterPath, zip, { startIndex: imageCounter });
      imageCounter = materialized.nextIndex;
      allImages.push(...materialized.images);

      let chapterMd = turndown.turndown(materialized.html);
      const embedded = extractEmbeddedDataUriImagesFromMarkdown(chapterMd, { idPrefix: "epub_extracted", startIndex: imageCounter });
      chapterMd = embedded.markdown;
      imageCounter = embedded.nextIndex;
      allImages.push(...embedded.images);

      chapters.push({
        index: i + 1,
        path: chapterPath,
        title: title || `Chapter ${i + 1}`,
        markdown: chapterMd,
      });
    }

    const mdParts = [];
    mdParts.push(`# ${filename}`);
    for (const ch of chapters) {
      mdParts.push("");
      mdParts.push(`## ${ch.title}`);
      mdParts.push("");
      mdParts.push(ch.markdown);
    }
    const markdown = mdParts.join("\n").trim() + "\n";

    const assets = extractAssetsFromMarkdown(markdown, allImages).map((a) => ({ ...a, source: "extracted" }));

    const title = filename;
    const doc = this.buildParsedDocument({
      sourceType: SourceKind.EPUB,
      origin: { filename, mimeType, size },
      markdown,
      assets,
      metadata: { title, chapterCount: chapters.length },
      parseInfo: { adapter: "epub", durationMs: Date.now() - t0 },
    });

    doc.chapters = chapters;
    doc.metadata = { ...(isPlainObject(doc.metadata) ? doc.metadata : {}), chapterCount: chapters.length };
    for (const a of doc.assets) a.docId = doc.docId;
    return doc;
  }
}
