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
  if (name.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function hasProcessFile(v) {
  return v && typeof v === "object" && typeof v.processFile === "function";
}

// 缓存 OcrManager 实例，避免重复创建
let _cachedOcrManager = null;

function resolveOcr(stageApi) {
  // 1. 优先使用注入的 OCR 引擎
  if (hasProcessFile(stageApi?.ocr)) return stageApi.ocr;

  // 2. 检测全局 OcrManager（浏览器环境）
  const OcrManagerClass = globalThis?.OcrManager;
  if (OcrManagerClass) {
    // 如果是已实例化的对象
    if (hasProcessFile(OcrManagerClass)) return OcrManagerClass;

    // 如果是类，使用缓存的实例或创建新实例
    if (typeof OcrManagerClass === "function") {
      if (!_cachedOcrManager) {
        _cachedOcrManager = new OcrManagerClass();
      }
      if (hasProcessFile(_cachedOcrManager)) return _cachedOcrManager;
    }
  }

  return null;
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
    type: "application/pdf",
    size: buf.length,
    async arrayBuffer() {
      return bufferToArrayBuffer(buf);
    },
  };
}

function fileLabel(input) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") return toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "document.pdf";
  return "document.pdf";
}

export class PdfAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "pdf" });
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,size?:number,arrayBuffer?:Function}} input
   * @param {{ocr?:object}=} stageApi
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();

    const ocr = resolveOcr(stageApi);
    if (!ocr) {
      const hint = typeof globalThis?.OcrManager === "undefined"
        ? "In browser, ensure ocr-manager.js and ocr-adapters are loaded."
        : "OcrManager found but processFile() unavailable.";
      throw new Error(`PdfAdapter: OCR engine required. Provide stageApi.ocr or load globalThis.OcrManager. ${hint}`);
    }

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
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "document.pdf";
      mimeType = toNonEmptyString(input.type) || toNonEmptyString(input.mimeType) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;

      if (typeof input.arrayBuffer !== "function" && typeof input.stream !== "function" && typeof input.text !== "function") {
        throw new Error("PdfAdapter.parse(input): unsupported file-like input (missing arrayBuffer())");
      }
    } else {
      throw new TypeError("PdfAdapter.parse(input): input must be a path string or a file-like object");
    }

    const progress = (current, total, message) => {
      if (typeof stageApi?.onProgress === "function") stageApi.onProgress(current, total, message);
    };

    const ocrResult = await ocr.processFile(file, progress);
    const markdown = String(ocrResult?.markdown || "");
    const images = Array.isArray(ocrResult?.images) ? ocrResult.images : [];
    const assets = extractAssetsFromMarkdown(markdown, images);

    const label = fileLabel(input);
    const title = filename || label;
    const parsed = this.buildParsedDocument({
      sourceType: SourceKind.PDF,
      origin: { filename: title, mimeType, size },
      markdown,
      assets,
      metadata: { title, ...(isPlainObject(ocrResult?.metadata) ? ocrResult.metadata : {}) },
      parseInfo: { adapter: "pdf", durationMs: Date.now() - t0 },
    });

    for (const a of parsed.assets) a.docId = parsed.docId;
    return parsed;
  }
}
