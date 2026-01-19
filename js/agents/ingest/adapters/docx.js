import { BaseAdapter } from "./base.js";
import { extractAssetsFromMarkdown } from "../extract-assets.js";
import { SourceKind } from "../constants.js";
import { basenameOfPath, fileLikeFromPath as nodeFileLikeFromPath } from "./node-io.js";

import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function normalizeMaxFileSize(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

// Default DOCX max file size (25MB). Override via new DocxAdapter({ maxFileSize }).
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;

async function fileLikeFromPath(path, { maxBytes } = {}) {
  const name = await basenameOfPath(path);
  return nodeFileLikeFromPath(path, { maxBytes, mimeType: guessMimeType(name) });
}

function resolveMammoth(stageApi) {
  if (stageApi?.mammoth && typeof stageApi.mammoth.convertToHtml === "function") return stageApi.mammoth;
  if (globalThis?.mammoth && typeof globalThis.mammoth.convertToHtml === "function") return globalThis.mammoth;
  return null;
}

async function importMammoth() {
  try {
    const mod = await import("mammoth");
    const mammoth = mod?.default || mod;
    return mammoth && typeof mammoth.convertToHtml === "function" ? mammoth : null;
  } catch {
    return null;
  }
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
  if (mt.includes("bmp")) return "bmp";
  return "png";
}

const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7W7WQAAAAASUVORK5CYII=";

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

  md = md.replace(/data:image\/([^;]+);base64,([A-Za-z0-9+/=]{100,})/g, (match, mimeSub, base64Data) => {
    idx += 1;
    const ext = String(mimeSub || "png").toLowerCase();
    const filename = `${idPrefix || "img"}_${idx}.${ext}`;
    extracted.push({ id: filename, data: base64Data });
    return `[image:${filename}]`;
  });

  return { markdown: md, images: extracted, nextIndex: idx };
}

export class DocxAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "docx" });
    this.maxFileSize = normalizeMaxFileSize(options.maxFileSize, DEFAULT_MAX_FILE_SIZE);
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,mimeType?:string,size?:number,arrayBuffer?:Function}} input
   * @param {{mammoth?:object,TurndownService?:Function}=} stageApi
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();

    let file = input;
    let filename = "";
    let mimeType = "";
    let size = undefined;

    const maxBytes = this.maxFileSize;

    if (typeof input === "string") {
      filename = await basenameOfPath(input);
      mimeType = guessMimeType(filename);
      file = await fileLikeFromPath(input, { maxBytes });
      size = file.size;
    } else if (input && typeof input === "object") {
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "document.docx";
      mimeType = toNonEmptyString(input.type) || toNonEmptyString(input.mimeType) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;
      if (typeof input.arrayBuffer !== "function") throw new Error("DocxAdapter.parse(input): unsupported file-like input (missing arrayBuffer())");
    } else {
      throw new TypeError("DocxAdapter.parse(input): input must be a path string or a file-like object");
    }

    if (Number.isFinite(maxBytes) && maxBytes > 0 && Number.isFinite(size) && size > maxBytes) {
      throw new Error(`DocxAdapter: file too large: ${size} bytes (max ${maxBytes})`);
    }

    const mammoth = resolveMammoth(stageApi) || (await importMammoth());
    if (!mammoth) throw new Error("DocxAdapter.parse(input): mammoth is required (stageApi.mammoth, globalThis.mammoth, or npm 'mammoth')");

    const TurndownService = resolveTurndownService(stageApi) || (await importTurndownService());
    if (!TurndownService) throw new Error("DocxAdapter.parse(input): TurndownService is required (stageApi.TurndownService, globalThis.TurndownService, or npm 'turndown')");

    const arrayBuffer = await file.arrayBuffer();
    const docxImages = [];
    const warnings = [];
    const MAX_WARNINGS = 50;
    const pushWarning = (message) => {
      if (warnings.length >= MAX_WARNINGS) return;
      warnings.push(message);
    };
    let imageCounter = 0;
    const imageIdPrefix = "img_";

    const convertImageImpl = (image) => {
      imageCounter += 1;
      const imageIndex = imageCounter;
      const mime = toNonEmptyString(image?.contentType) || "unknown";
      const ext = extFromMime(mime);
      const filename = `${imageIdPrefix}${imageIndex}.${ext}`;

      return image
        .read("base64")
        .then((base64) => {
          docxImages.push({ id: filename, data: base64 });
          return { src: `images/${filename}` };
        })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          pushWarning(`image#${imageIndex} (${mime}): ${msg}`);
          const placeholder = `${imageIdPrefix}${imageIndex}.png`;
          docxImages.push({ id: placeholder, data: TRANSPARENT_PNG_BASE64, placeholder: true });
          return { src: `images/${placeholder}` };
        });
    };

    const convertImage = mammoth?.images?.imgElement ? mammoth.images.imgElement(convertImageImpl) : convertImageImpl;

    const result = await mammoth.convertToHtml({ arrayBuffer, convertImage });
    const html = String(result?.value || "");
    const messages = Array.isArray(result?.messages) ? result.messages : [];
    for (const m of messages) pushWarning(typeof m?.message === "string" ? m.message : String(m));

    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    let markdown = turndown.turndown(html);

    const embedded = extractEmbeddedDataUriImagesFromMarkdown(markdown, { idPrefix: "img_extracted", startIndex: 0 });
    markdown = embedded.markdown;
    const images = [...docxImages, ...embedded.images];

    const assets = extractAssetsFromMarkdown(markdown, images).map((a) => ({ ...a, source: "extracted" }));

    const title = filename;
    const parsed = this.buildParsedDocument({
      sourceType: SourceKind.DOCX,
      origin: { filename, mimeType, size },
      markdown,
      assets,
      metadata: { title },
      parseInfo: { adapter: "docx", durationMs: Date.now() - t0, ...(warnings.length ? { warnings } : {}) },
    });

    for (const a of parsed.assets) a.docId = parsed.docId;
    return parsed;
  }
}
