import { BaseAdapter } from "./base.js";
import { extractAssetsFromMarkdown } from "../extract-assets.js";
import { SourceKind } from "../constants.js";

import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function hasProcessFile(v) {
  return v && typeof v === "object" && typeof v.processFile === "function";
}

function normalizeMaxFileSize(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

// Default PDF max file size (25MB). Override via new PdfAdapter({ maxFileSize }).
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;

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

function extractAsciiStrings(bytes, { minLen = 4, maxStrings = 200, maxChars = 20_000 } = {}) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array();
  const out = [];
  let cur = "";
  let total = 0;

  const pushCur = () => {
    const s = cur.trim();
    cur = "";
    if (!s || s.length < minLen) return;
    if (out.length >= maxStrings) return;
    const remaining = maxChars - total;
    if (remaining <= 0) return;
    const clipped = s.length > remaining ? s.slice(0, remaining) : s;
    total += clipped.length;
    out.push(clipped);
  };

  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    // Printable ASCII + common whitespace.
    const isPrintable = b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
    if (!isPrintable) {
      pushCur();
      continue;
    }
    const ch = String.fromCharCode(b);
    if (total >= maxChars || out.length >= maxStrings) break;
    cur += ch;
    if (cur.length > 512) pushCur();
  }
  pushCur();

  // Deduplicate while preserving order.
  const seen = new Set();
  const unique = [];
  for (const s of out) {
    if (seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }
  return unique.join("\n").trim();
}

async function basenameOfPath(path) {
  const { basename } = await import("node:path");
  return basename(path);
}

function bufferToArrayBuffer(buf) {
  if (!buf) return new ArrayBuffer(0);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function fileLikeFromPath(path, { maxBytes } = {}) {
  const { readFile, stat } = await import("node:fs/promises");
  const limit = normalizeMaxFileSize(maxBytes, Infinity);
  const stats = await stat(path);
  if (Number.isFinite(limit) && limit > 0 && stats.size > limit) {
    throw new Error(`PdfAdapter: file too large: ${stats.size} bytes (max ${limit})`);
  }
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
    this.maxFileSize = normalizeMaxFileSize(options.maxFileSize, DEFAULT_MAX_FILE_SIZE);
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,size?:number,arrayBuffer?:Function}} input
   * @param {{ocr?:object}=} stageApi
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();

    const ocr = resolveOcr(stageApi);

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
      filename = toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "document.pdf";
      mimeType = toNonEmptyString(input.type) || toNonEmptyString(input.mimeType) || guessMimeType(filename);
      size = Number.isFinite(input.size) ? input.size : undefined;

      if (typeof input.arrayBuffer !== "function" && typeof input.stream !== "function" && typeof input.text !== "function") {
        throw new Error("PdfAdapter.parse(input): unsupported file-like input (missing arrayBuffer())");
      }
    } else {
      throw new TypeError("PdfAdapter.parse(input): input must be a path string or a file-like object");
    }

    if (Number.isFinite(maxBytes) && maxBytes > 0 && Number.isFinite(size) && size > maxBytes) {
      throw new Error(`PdfAdapter: file too large: ${size} bytes (max ${maxBytes})`);
    }

    const progress = (current, total, message) => {
      if (typeof stageApi?.onProgress === "function") stageApi.onProgress(current, total, message);
    };

    let markdown = "";
    let images = [];
    let ocrResult = null;

    if (ocr) {
      ocrResult = await ocr.processFile(file, progress);
      markdown = String(ocrResult?.markdown || "");
      images = Array.isArray(ocrResult?.images) ? ocrResult.images : [];
    } else {
      // Fallback: best-effort text extraction from embedded printable strings.
      // This is not a full PDF parser, but avoids hard failure when OCR is unavailable.
      const ab = typeof file?.arrayBuffer === "function" ? await file.arrayBuffer() : new ArrayBuffer(0);
      const text = extractAsciiStrings(new Uint8Array(ab));
      const hint = typeof globalThis?.OcrManager === "undefined"
        ? "OCR unavailable; extracted embedded text strings instead."
        : "OcrManager found but processFile() unavailable; extracted embedded text strings instead.";
      markdown = text ? `# ${fileLabel(input)}\n\n${text}\n` : `# ${fileLabel(input)}\n\n(Empty PDF text; OCR unavailable.)\n`;
      images = [];
      ocrResult = { markdown, images: [], metadata: { engine: "fallback", hint } };
    }

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
