import { BaseAdapter } from "./base.js";
import { extractAssetsFromMarkdown } from "../extract-assets.js";
import { SourceKind } from "../constants.js";
import { basenameOfPath as nodeBasenameOfPath, fileLikeFromPath as nodeFileLikeFromPath, isNodeEnvironment, readFileFromPath } from "./node-io.js";

import { toNonEmptyString } from "../../shared/index.js";
function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

function normalizeMaxBytes(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizePositiveInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeRatio(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

// Default PPTX limits (override via new PptxAdapter({ ... })).
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_ZIP_ENTRIES = 2000;
const DEFAULT_MAX_COMPRESSION_RATIO = 100;

async function basenameOfPath(path) {
  if (isNodeEnvironment()) {
    return nodeBasenameOfPath(path);
  }
  const parts = String(path || "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Read PPTX file from path (Node.js only, requires allowPathRead).
 * @param {string} path
 * @param {{allowPathRead?:boolean,maxBytes?:number}} options
 */
async function fileLikeFromPath(path, { allowPathRead = false, maxBytes } = {}) {
  if (!allowPathRead) {
    throw new Error("PptxAdapter: path string inputs are disabled (set allowPathRead:true to enable in Node.js)");
  }
  const name = await basenameOfPath(path);
  return nodeFileLikeFromPath(path, { maxBytes, mimeType: guessMimeType(name) });
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

function getZipEntrySizes(entry) {
  const data = entry?._data;
  const uncompressed = typeof data?.uncompressedSize === "number" ? data.uncompressedSize : undefined;
  const compressed = typeof data?.compressedSize === "number" ? data.compressedSize : undefined;
  return { uncompressed, compressed };
}

function enforceZipLimits(zip, { maxEntries, maxUncompressedBytes, maxCompressionRatio } = {}) {
  const entries = Object.values(zip?.files || {});
  if (Number.isFinite(maxEntries) && maxEntries > 0 && entries.length > maxEntries) {
    throw new Error(`PptxAdapter: zip entry count ${entries.length} exceeds max ${maxEntries}`);
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    if (entry?.dir) continue;
    const { uncompressed, compressed } = getZipEntrySizes(entry);
    if (Number.isFinite(uncompressed)) {
      totalUncompressed += uncompressed;
      if (Number.isFinite(maxUncompressedBytes) && maxUncompressedBytes > 0 && totalUncompressed > maxUncompressedBytes) {
        throw new Error(`PptxAdapter: zip uncompressed bytes ${totalUncompressed} exceeds max ${maxUncompressedBytes}`);
      }
      if (Number.isFinite(compressed) && compressed > 0 && Number.isFinite(maxCompressionRatio) && maxCompressionRatio > 0) {
        const ratio = uncompressed / compressed;
        if (ratio > maxCompressionRatio) {
          throw new Error(`PptxAdapter: zip compression ratio ${ratio.toFixed(1)} exceeds max ${maxCompressionRatio}`);
        }
      }
    }
  }
}

/**
 * Load PPTXSlideParser via Node.js vm module (Node-only fallback).
 * Browser builds should provide stageApi.pptxParser or globalThis.PPTXSlideParser.
 */
async function loadPptxSlideParserFromScript() {
  if (!isNodeEnvironment()) {
    throw new Error("PptxAdapter: loadPptxSlideParserFromScript requires Node.js; provide stageApi.pptxParser or globalThis.PPTXSlideParser for browser");
  }

  const code = await readFileFromPath(new URL("../../../ppt/core/slide-parser-pptx.js", import.meta.url), "utf8");
  // Avoid bundlers statically including node:vm in browser builds.
  const nodeVmSpecifier = ["node", "vm"].join(":");
  const vm = await import(nodeVmSpecifier);

  const { DOMParser } = await import("linkedom");
  const jszipMod = await import("jszip");
  const JSZip = jszipMod?.default || jszipMod;

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
    this.maxFileSize = normalizeMaxBytes(options.maxFileSize, DEFAULT_MAX_FILE_SIZE);
    this.maxUncompressedBytes = normalizeMaxBytes(options.maxUncompressedBytes, DEFAULT_MAX_UNCOMPRESSED_BYTES);
    this.maxZipEntries = normalizePositiveInt(options.maxZipEntries, DEFAULT_MAX_ZIP_ENTRIES);
    this.maxCompressionRatio = normalizeRatio(options.maxCompressionRatio, DEFAULT_MAX_COMPRESSION_RATIO);
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,mimeType?:string,size?:number,arrayBuffer?:Function}} input
   * @param {{pptxParser?:{parse:Function},allowPathRead?:boolean}=} stageApi
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();
    const allowPathRead = stageApi?.allowPathRead === true;

    let file = input;
    let filename = "";
    let mimeType = "";
    let size = undefined;

    const maxBytes = this.maxFileSize;

    if (typeof input === "string") {
      filename = await basenameOfPath(input);
      mimeType = guessMimeType(filename);
      file = await fileLikeFromPath(input, { allowPathRead, maxBytes });
      size = file.size;
    } else if (input && typeof input === "object") {
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "slides.pptx";
      mimeType = toNonEmptyString(input.type) || toNonEmptyString(input.mimeType) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;
      if (typeof input.arrayBuffer !== "function") throw new Error("PptxAdapter.parse(input): unsupported file-like input (missing arrayBuffer())");
    } else {
      throw new TypeError("PptxAdapter.parse(input): input must be a path string or a file-like object");
    }

    if (Number.isFinite(maxBytes) && maxBytes > 0 && Number.isFinite(size) && size > maxBytes) {
      throw new Error(`PptxAdapter: file too large: ${size} bytes (max ${maxBytes})`);
    }

    const parser = await resolvePptxParser(stageApi);
    const arrayBuffer = await file.arrayBuffer();
    const byteLength = arrayBuffer instanceof ArrayBuffer ? arrayBuffer.byteLength : undefined;
    if (Number.isFinite(maxBytes) && maxBytes > 0 && Number.isFinite(byteLength) && byteLength > maxBytes) {
      throw new Error(`PptxAdapter: file too large: ${byteLength} bytes (max ${maxBytes})`);
    }

    const jszipMod = await import("jszip");
    const JSZip = jszipMod?.default || jszipMod;
    if (typeof JSZip?.loadAsync !== "function") throw new Error("PptxAdapter.parse(input): JSZip is required");
    const zip = await JSZip.loadAsync(arrayBuffer);
    enforceZipLimits(zip, {
      maxEntries: this.maxZipEntries,
      maxUncompressedBytes: this.maxUncompressedBytes,
      maxCompressionRatio: this.maxCompressionRatio,
    });

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
