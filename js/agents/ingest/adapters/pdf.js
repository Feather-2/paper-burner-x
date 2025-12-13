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

function resolveOcr(stageApi) {
  if (hasProcessFile(stageApi?.ocr)) return stageApi.ocr;

  const g = globalThis?.OcrManager;
  if (hasProcessFile(g)) return g;
  if (typeof g === "function") {
    const instance = new g();
    if (hasProcessFile(instance)) return instance;
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
    if (!ocr) throw new Error("PdfAdapter.parse(input): OCR engine is required (stageApi.ocr or globalThis.OcrManager)");

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
      sourceType: "pdf",
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
