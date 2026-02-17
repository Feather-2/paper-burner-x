import { BaseAdapter } from "./base.js";
import { extractAssetsFromMarkdown } from "../extract-assets.js";
import { SourceKind } from "../constants.js";
import { basenameOfPath, fileLikeFromPath as nodeFileLikeFromPath } from "./node-io.js";

import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { createLogger } from "../../shared/utils/logger.js";
import { resolveOcrManager } from "./resolve-deps.js";

const logger = createLogger("agents");

let _pdfJsApiPromise = null;
let _pdfJsWarned = false;

function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function normalizeMaxFileSize(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

// Default PDF max file size (25MB). Override via new PdfAdapter({ maxFileSize }).
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;
const DEFAULT_MAX_PDF_TEXT_CHARS = 20_000;
const DEFAULT_MAX_PDF_TEXT_PAGES = 200;

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

async function fileLikeFromPath(path, { maxBytes } = {}) {
  return nodeFileLikeFromPath(path, { maxBytes, mimeType: "application/pdf" });
}

function fileLabel(input) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") return toNonEmptyString(input.name) || toNonEmptyString(input.filename) || "document.pdf";
  return "document.pdf";
}

function normalizePdfJsApi(mod) {
  const api = mod?.default && typeof mod.default.getDocument === "function" ? mod.default : mod;
  return api && typeof api.getDocument === "function" ? api : null;
}

async function loadPdfJsApi() {
  if (_pdfJsApiPromise) return _pdfJsApiPromise;
  _pdfJsApiPromise = (async () => {
    const loaders = [
      () => import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs"),
      () => import(/* @vite-ignore */ "pdfjs-dist/build/pdf.mjs"),
      () => import(/* @vite-ignore */ "pdfjs-dist"),
    ];
    for (const load of loaders) {
      try {
        const mod = await load();
        const api = normalizePdfJsApi(mod);
        if (api) return api;
      } catch {
        // Try the next candidate path.
      }
    }
    return null;
  })();
  return _pdfJsApiPromise;
}

function truncateText(value, maxChars) {
  if (!value) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 0) return String(value);
  return String(value).slice(0, maxChars);
}

async function extractTextWithPdfJs(file, { maxChars = DEFAULT_MAX_PDF_TEXT_CHARS, maxPages = DEFAULT_MAX_PDF_TEXT_PAGES } = {}) {
  const pdfjs = await loadPdfJsApi();
  if (!pdfjs) return "";

  const ab = typeof file?.arrayBuffer === "function" ? await file.arrayBuffer() : null;
  if (!(ab instanceof ArrayBuffer) || ab.byteLength === 0) return "";

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(ab),
    disableWorker: true,
  });

  let pdf = null;
  try {
    pdf = await loadingTask.promise;
    const pageCount = Math.min(Number(pdf.numPages) || 0, Math.max(1, Number(maxPages) || DEFAULT_MAX_PDF_TEXT_PAGES));
    const chunks = [];
    let used = 0;

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const text = await page.getTextContent();
      const parts = [];
      for (const item of text?.items || []) {
        const s = toNonEmptyString(item?.str);
        if (s) parts.push(s);
      }
      const pageText = parts.join(" ").trim();
      if (!pageText) continue;

      const remaining = maxChars - used;
      if (remaining <= 0) break;
      const clipped = truncateText(pageText, remaining);
      if (clipped) {
        chunks.push(clipped);
        used += clipped.length;
      }
    }

    return chunks.join("\n").trim();
  } finally {
    try { if (typeof pdf?.cleanup === "function") pdf.cleanup(); } catch {}
    try { if (typeof loadingTask?.destroy === "function") await loadingTask.destroy(); } catch {}
  }
}

export class PdfAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, adapterName: "pdf" });
    this.maxFileSize = normalizeMaxFileSize(options.maxFileSize, DEFAULT_MAX_FILE_SIZE);
    this._ocrManager = options.ocrManager ?? null;
    this._pdfParser = options.pdfParser ?? null;
    this.maxPdfTextChars = normalizeMaxFileSize(options.maxPdfTextChars, DEFAULT_MAX_PDF_TEXT_CHARS);
    this.maxPdfTextPages = normalizeMaxFileSize(options.maxPdfTextPages, DEFAULT_MAX_PDF_TEXT_PAGES);
  }

  resolveOcr(stageApi) {
    // Use unified resolver from resolve-deps.js (AUDIT E4)
    // Priority: constructor injection > stageApi > globalThis
    if (this._ocrManager !== null) return this._ocrManager;

    const resolved = resolveOcrManager(stageApi);
    if (resolved) {
      // Cache the resolved instance to avoid repeated resolution
      this._ocrManager = resolved;
    }
    return resolved;
  }

  /**
   * @param {any} parser
   * @returns {Promise<string>}
   */
  async extractTextWithParser(parser, file) {
    if (typeof parser === "function") {
      const text = await parser(file);
      return toNonEmptyString(text) || "";
    }
    if (parser && typeof parser.extractText === "function") {
      const text = await parser.extractText(file);
      return toNonEmptyString(text) || "";
    }
    return "";
  }

  /**
   * @param {any} file
   * @param {{pdfParser?: any}} stageApi
   * @returns {Promise<{text:string,engine:string|null}>}
   */
  async extractPdfText(file, stageApi = {}) {
    const stageParser = stageApi?.pdfParser;
    const parser = stageParser ?? this._pdfParser;

    if (parser) {
      try {
        const text = await this.extractTextWithParser(parser, file);
        return { text, engine: text ? "pdf-parser" : null };
      } catch (error) {
        logger.warn?.(`PdfAdapter: custom pdfParser failed: ${error?.message || error}`);
        return { text: "", engine: null };
      }
    }

    try {
      const text = await extractTextWithPdfJs(file, {
        maxChars: this.maxPdfTextChars,
        maxPages: this.maxPdfTextPages,
      });
      return { text, engine: text ? "pdfjs" : null };
    } catch (error) {
      logger.warn?.(`PdfAdapter: pdf.js extraction failed: ${error?.message || error}`);
      return { text: "", engine: null };
    }
  }

  /**
   * @param {string|{name?:string,filename?:string,type?:string,size?:number,arrayBuffer?:Function}} input
   * @param {{ocr?:object}=} stageApi
   * @returns {Promise<object>} ParsedDocument
   */
  async parse(input, stageApi = {}) {
    const t0 = Date.now();

    const ocr = this.resolveOcr(stageApi);

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

    const tryPdfText = async () => {
      const parserConfigured = Boolean(stageApi?.pdfParser || this._pdfParser);
      const { text, engine } = await this.extractPdfText(file, stageApi);
      if (!text) {
        if (!engine && !parserConfigured && !_pdfJsWarned) {
          _pdfJsWarned = true;
          logger.info?.("PdfAdapter: pdf.js unavailable, falling back to embedded text scan.");
        }
        return false;
      }
      markdown = `# ${fileLabel(input)}\n\n${text}\n`;
      images = [];
      ocrResult = { markdown, images: [], metadata: { engine: engine || "pdf-parser" } };
      return true;
    };

    if (ocr) {
      try {
        ocrResult = await ocr.processFile(file, progress);
        markdown = String(ocrResult?.markdown || "");
        images = Array.isArray(ocrResult?.images) ? ocrResult.images : [];
      } catch (ocrError) {
        // OCR failed; fall back to embedded text extraction
        logger.warn?.(`PdfAdapter: OCR failed, falling back to text extraction: ${ocrError?.message || ocrError}`);
        const gotPdfText = await tryPdfText();
        if (!gotPdfText) {
          const ab = typeof file?.arrayBuffer === "function" ? await file.arrayBuffer() : new ArrayBuffer(0);
          const text = extractAsciiStrings(new Uint8Array(ab));
          markdown = text ? `# ${fileLabel(input)}\n\n${text}\n` : `# ${fileLabel(input)}\n\n(OCR failed; extracted embedded text strings.)\n`;
          images = [];
          ocrResult = { markdown, images: [], metadata: { engine: "fallback", hint: `OCR error: ${ocrError?.message || "unknown"}` } };
        }
      }
    } else {
      const gotPdfText = await tryPdfText();
      if (!gotPdfText) {
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
