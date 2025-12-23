import { BaseAdapter } from "./base.js";
import { extractAssetsFromMarkdown } from "../extract-assets.js";
import { SourceKind } from "../constants.js";

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

async function basenameOfPath(path) {
  const { basename } = await import("node:path");
  return basename(path);
}

function bufferToArrayBuffer(buf) {
  if (!buf) return new ArrayBuffer(0);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function fileLikeFromPath(path) {
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(path);
  const name = await basenameOfPath(path);
  return {
    name,
    type: guessMimeType(name),
    size: buf.length,
    async arrayBuffer() {
      return bufferToArrayBuffer(buf);
    },
  };
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

function mimeFromDataUri(dataUri) {
  const s = String(dataUri || "");
  if (!s.startsWith("data:")) return "";
  const semi = s.indexOf(";");
  const comma = s.indexOf(",");
  const end = semi > 5 ? semi : comma;
  if (end <= 5) return "";
  return s.slice("data:".length, end);
}

function extractBase64FromDataUri(dataUri) {
  const s = String(dataUri || "");
  const comma = s.indexOf(",");
  if (comma === -1) return "";
  return s.slice(comma + 1);
}

async function loadPptxSlideParserFromScript() {
  const { readFile } = await import("node:fs/promises");
  const vm = await import("node:vm");

  const { DOMParser } = await import("linkedom");
  const jszipMod = await import("jszip");
  const JSZip = jszipMod?.default || jszipMod;

  const srcUrl = new URL("../../../ppt/core/slide-parser-pptx.js", import.meta.url);
  const code = await readFile(srcUrl, "utf8");

  const sandbox = {
    console,
    JSZip,
    DOMParser,
  };
  const context = vm.createContext(sandbox);
  new vm.Script(code, { filename: "slide-parser-pptx.js" }).runInContext(context);

  const Parser = context.PPTXSlideParser;
  if (typeof Parser !== "function") throw new Error("PptxAdapter: failed to load PPTXSlideParser from script");
  return Parser;
}

async function resolvePptxParser(stageApi) {
  if (stageApi?.pptxParser && typeof stageApi.pptxParser.parse === "function") return stageApi.pptxParser;
  if (typeof globalThis?.PPTXSlideParser === "function") return new globalThis.PPTXSlideParser();
  const Parser = await loadPptxSlideParserFromScript();
  return new Parser();
}

function slideTitle(slide) {
  const elements = Array.isArray(slide?.elements) ? slide.elements : [];
  for (const el of elements) {
    const role = toNonEmptyString(el?.role);
    const t = toNonEmptyString(el?.content) || toNonEmptyString(el?.text);
    if (role === "title" && t) return t;
  }
  return "";
}

function extractTextLinesFromSlide(slide) {
  const elements = Array.isArray(slide?.elements) ? slide.elements : [];
  const lines = [];
  for (const el of elements) {
    const t = toNonEmptyString(el?.content) || toNonEmptyString(el?.text);
    if (t) lines.push(t);
  }
  return lines;
}

export class PptxAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "pptx" });
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,mimeType?:string,size?:number,arrayBuffer?:Function}} input
   * @param {{pptxParser?:{parse:Function}}=} stageApi
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();

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
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "slides.pptx";
      mimeType = toNonEmptyString(input.type) || toNonEmptyString(input.mimeType) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;
      if (typeof input.arrayBuffer !== "function") throw new Error("PptxAdapter.parse(input): unsupported file-like input (missing arrayBuffer())");
    } else {
      throw new TypeError("PptxAdapter.parse(input): input must be a path string or a file-like object");
    }

    const parser = await resolvePptxParser(stageApi);
    const arrayBuffer = await file.arrayBuffer();
    const parsedPptx = await parser.parse(arrayBuffer);
    const slides = Array.isArray(parsedPptx?.slides) ? parsedPptx.slides : [];
    const slideCount = Number.isFinite(parsedPptx?.metadata?.slideCount) ? parsedPptx.metadata.slideCount : slides.length;

    const images = [];
    let imageCounter = 0;

    const mdParts = [];
    mdParts.push(`# ${filename}`);

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const n = i + 1;
      const title = slideTitle(slide);
      mdParts.push("");
      mdParts.push(`## Slide ${n}${title ? `: ${title}` : ""}`);

      const lines = extractTextLinesFromSlide(slide);
      for (const line of lines) mdParts.push(`- ${line}`);

      const elements = Array.isArray(slide?.elements) ? slide.elements : [];
      for (const el of elements) {
        if (el?.type !== "image") continue;
        const src = toNonEmptyString(el?.src);
        if (!src || !src.startsWith("data:image/")) continue;
        const mime = mimeFromDataUri(src);
        const ext = extFromMime(mime);
        imageCounter += 1;
        const imgName = `pptx_img_${imageCounter}.${ext}`;
        images.push({ id: imgName, data: extractBase64FromDataUri(src) });
        mdParts.push(`![](${`images/${imgName}`})`);
      }
    }

    const markdown = mdParts.join("\n");
    const assets = extractAssetsFromMarkdown(markdown, images).map((a) => ({ ...a, source: "extracted" }));

    const doc = this.buildParsedDocument({
      sourceType: SourceKind.PPTX,
      origin: { filename, mimeType, size },
      markdown,
      assets,
      metadata: { title: filename, slideCount },
      parseInfo: { adapter: "pptx", durationMs: Date.now() - t0 },
    });

    for (const a of doc.assets) a.docId = doc.docId;
    return doc;
  }
}
