import { BaseAdapter } from "./base.js";
import { extractAssetsFromMarkdown } from "../extract-assets.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".html") || name.endsWith(".htm")) return "text/html";
  return "text/html";
}

async function basenameOfPath(path) {
  const { basename } = await import("node:path");
  return basename(path);
}

async function readTextFromPath(path) {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);
  return { text: buf.toString("utf8"), size: buf.length };
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

function extractDataUriImagesFromHtml(html, { idPrefix = "html_img" } = {}) {
  let out = String(html || "");
  const images = [];
  let counter = 0;

  out = out.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:image\/[^"']+?)(\2)/gi, (match, prefix, quote, src, suffixQuote) => {
    const parsed = parseDataUri(src);
    if (!parsed?.base64) return match;
    counter += 1;
    const ext = extFromMime(parsed.mimeType);
    const filename = `${idPrefix}_${counter}.${ext}`;
    images.push({ id: filename, data: parsed.base64 });
    return `${prefix}${quote}images/${filename}${suffixQuote}`;
  });

  return { html: out, images, nextIndex: counter };
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

export class HtmlAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "html" });
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,mimeType?:string,size?:number,text?:Function,arrayBuffer?:Function,content?:string}} input
   * @param {{TurndownService?:Function}=} stageApi
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();

    let filename = "";
    let mimeType = "";
    let size = undefined;
    let html = "";

    if (typeof input === "string") {
      filename = await basenameOfPath(input);
      mimeType = guessMimeType(filename);
      const res = await readTextFromPath(input);
      size = res.size;
      html = res.text;
    } else if (input && typeof input === "object") {
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "document.html";
      mimeType = toNonEmptyString(input.type) || toNonEmptyString(input.mimeType) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;

      if (typeof input.text === "function") {
        html = String(await input.text());
      } else if (typeof input.arrayBuffer === "function") {
        const buf = Buffer.from(await input.arrayBuffer());
        html = buf.toString("utf8");
        size = size ?? buf.length;
      } else if (isPlainObject(input) && typeof input.content === "string") {
        html = input.content;
      } else {
        throw new Error("HtmlAdapter.parse(input): unsupported file-like input");
      }
    } else {
      throw new TypeError("HtmlAdapter.parse(input): input must be a path string or a file-like object");
    }

    const TurndownService = resolveTurndownService(stageApi) || (await importTurndownService());
    if (!TurndownService) throw new Error("HtmlAdapter.parse(input): TurndownService is required (stageApi.TurndownService, globalThis.TurndownService, or npm 'turndown')");

    const extractedFromHtml = extractDataUriImagesFromHtml(html, { idPrefix: "html_img" });
    const images = [...extractedFromHtml.images];

    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    let markdown = turndown.turndown(extractedFromHtml.html);

    const embedded = extractEmbeddedDataUriImagesFromMarkdown(markdown, { idPrefix: "html_extracted", startIndex: images.length });
    markdown = embedded.markdown;
    images.push(...embedded.images);

    const assets = extractAssetsFromMarkdown(markdown, images).map((a) => ({ ...a, source: "extracted" }));

    const title = filename;
    const parsed = this.buildParsedDocument({
      sourceType: "html",
      origin: { filename, mimeType, size },
      markdown,
      assets,
      metadata: { title },
      parseInfo: { adapter: "html", durationMs: Date.now() - t0 },
    });

    for (const a of parsed.assets) a.docId = parsed.docId;
    return parsed;
  }
}

