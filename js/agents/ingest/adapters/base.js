import { normalizeText } from "../../stages/textprep/normalize.js";
import { chunkText, smartChunk, ChunkStrategy } from "../../stages/textprep/chunk.js";
import { buildToc } from "../../retrieval/toc-builder.js";
import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";

function safeDocId(sourceType, textHash) {
  const kind = toNonEmptyString(sourceType) || "doc";
  const hex = String(textHash || "").startsWith("sha256:") ? String(textHash).slice("sha256:".length) : String(textHash || "");
  const short = hex.slice(0, 12) || "unknown";
  return `${kind}_${short}`;
}

// Re-export for adapters that need these
export { isPlainObject, toNonEmptyString };

function isAsyncIterable(v) {
  return v && typeof v === "object" && typeof v[Symbol.asyncIterator] === "function";
}

function isIterable(v) {
  return v && typeof v === "object" && typeof v[Symbol.iterator] === "function";
}

function isWebReadableStream(v) {
  return v && typeof v === "object" && typeof v.getReader === "function";
}

async function* webStreamToAsyncIterable(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // ignore
    }
  }
}

function toAsyncIterable(readable) {
  if (isAsyncIterable(readable) || isIterable(readable)) return readable;
  if (isWebReadableStream(readable)) return webStreamToAsyncIterable(readable);
  throw new TypeError("BaseAdapter.parseStream(readable): readable must be an async iterable/iterable/ReadableStream");
}

function abortError(message) {
  const err = new Error(message || "Aborted");
  err.name = "AbortError";
  return err;
}

function normalizeChunkOptions(input, fallback) {
  const base = isPlainObject(fallback) ? fallback : { chunkSize: 2000, overlap: 200, includeLineNumbers: true };
  const opts = isPlainObject(input) ? input : {};
  const chunkSize = Number.isFinite(opts.chunkSize) ? Math.max(1, Math.floor(opts.chunkSize)) : base.chunkSize || 2000;
  const overlap = Number.isFinite(opts.overlap) ? Math.max(0, Math.floor(opts.overlap)) : base.overlap ?? 200;
  const includeLineNumbers = opts.includeLineNumbers !== undefined ? Boolean(opts.includeLineNumbers) : Boolean(base.includeLineNumbers);
  if (overlap >= chunkSize) throw new Error("BaseAdapter.parseStream(): overlap must be < chunkSize");
  return { chunkSize, overlap, includeLineNumbers };
}

function countNewlines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) n++;
  }
  return n;
}

export class BaseAdapter {
  constructor({ adapterName, defaultChunkOptions } = {}) {
    this.adapterName = toNonEmptyString(adapterName) || "base";
    this.defaultChunkOptions = isPlainObject(defaultChunkOptions)
      ? defaultChunkOptions
      : { chunkSize: 2000, overlap: 200, includeLineNumbers: true };
  }

  /**
   * Streaming interface: parseStream(readable) -> AsyncIterator<Chunk>
   * Default implementation chunks a UTF-8 text stream (fixed-size + overlap).
   *
   * @param {AsyncIterable<string|Uint8Array>|Iterable<string|Uint8Array>|ReadableStream} readable
   * @param {{chunkOptions?:object,signal?:AbortSignal}=} options
   * @returns {AsyncIterableIterator<{chunkId:string,text:string,locator:{charStart:number,charEnd:number,lineStart?:number,lineEnd?:number}}>}
   */
  async* parseStream(readable, options = {}) {
    if (!isPlainObject(options)) throw new TypeError("BaseAdapter.parseStream(readable, options): options must be an object");

    const signal = options.signal;
    const { chunkSize, overlap, includeLineNumbers } = normalizeChunkOptions(options.chunkOptions, this.defaultChunkOptions);
    const advance = chunkSize - overlap;

    const iterable = toAsyncIterable(readable);

    const destroyStream = (err) => {
      try {
        if (readable && typeof readable === "object" && typeof readable.destroy === "function") readable.destroy(err);
      } catch {
        // ignore
      }
    };

    const onAbort = () => destroyStream(abortError("BaseAdapter.parseStream: aborted"));
    if (signal && typeof signal.addEventListener === "function") {
      if (signal.aborted) throw abortError("BaseAdapter.parseStream: aborted");
      signal.addEventListener("abort", onAbort, { once: true });
    }

    let decoder = null;
    try {
      decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
    } catch {
      decoder = null;
    }

    let pendingCR = false;
    let bufferText = "";
    let bufferStartAbs = 0;
    let lineAtBufferStart = 1; // 1-based line number
    let chunkIndex = 0;

    const normalizeSegment = (seg) => {
      let s = String(seg || "");

      if (pendingCR) {
        if (s.startsWith("\n")) s = s.slice(1);
        s = "\n" + s;
        pendingCR = false;
      }

      if (s.endsWith("\r")) {
        pendingCR = true;
        s = s.slice(0, -1);
      }

      if (s.includes("\r")) s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (s.includes("\u00A0")) s = s.replace(/\u00A0/g, " ");
      return s;
    };

    const decodeChunk = (chunk) => {
      if (typeof chunk === "string") return chunk;
      if (chunk instanceof Uint8Array) {
        if (decoder) return decoder.decode(chunk, { stream: true });
        if (typeof Buffer !== "undefined") return Buffer.from(chunk).toString("utf8");
        return String(chunk);
      }
      if (chunk instanceof ArrayBuffer) return decodeChunk(new Uint8Array(chunk));
      if (ArrayBuffer.isView(chunk)) return decodeChunk(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      return String(chunk ?? "");
    };

    try {
      for await (const part of iterable) {
        if (signal?.aborted) throw abortError("BaseAdapter.parseStream: aborted");

        const decoded = decodeChunk(part);
        const normalized = normalizeSegment(decoded);
        if (normalized) bufferText += normalized;

        while (bufferText.length >= chunkSize) {
          if (signal?.aborted) throw abortError("BaseAdapter.parseStream: aborted");

          const text = bufferText.slice(0, chunkSize);
          const charStart = bufferStartAbs;
          const charEnd = bufferStartAbs + chunkSize;

          const chunk = { chunkId: `chunk_${++chunkIndex}`, text, locator: { charStart, charEnd } };
          if (includeLineNumbers) {
            const lineStart = lineAtBufferStart;
            const newlines = countNewlines(text);
            const lineEnd = Math.max(lineStart, lineStart + newlines - (text.endsWith("\n") ? 1 : 0));
            chunk.locator.lineStart = lineStart;
            chunk.locator.lineEnd = lineEnd;
          }

          yield chunk;

          const removed = bufferText.slice(0, advance);
          bufferText = bufferText.slice(advance);
          bufferStartAbs += advance;
          if (includeLineNumbers && removed) lineAtBufferStart += countNewlines(removed);
        }
      }

      if (decoder) {
        const flushed = decoder.decode();
        const normalized = normalizeSegment(flushed);
        if (normalized) bufferText += normalized;
      }

      if (pendingCR) {
        pendingCR = false;
        bufferText += "\n";
      }

      if (signal?.aborted) throw abortError("BaseAdapter.parseStream: aborted");

      if (bufferText.length) {
        const charStart = bufferStartAbs;
        const charEnd = bufferStartAbs + bufferText.length;
        const chunk = { chunkId: `chunk_${++chunkIndex}`, text: bufferText, locator: { charStart, charEnd } };
        if (includeLineNumbers) {
          const lineStart = lineAtBufferStart;
          const newlines = countNewlines(bufferText);
          const lineEnd = Math.max(lineStart, lineStart + newlines - (bufferText.endsWith("\n") ? 1 : 0));
          chunk.locator.lineStart = lineStart;
          chunk.locator.lineEnd = lineEnd;
        }
        yield chunk;
      }
    } finally {
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  /**
   * Convenience (non-streaming) API: parse(readable) -> Promise<Chunk[]>
   * Collects parseStream() into an array.
   *
   * @param {AsyncIterable<string|Uint8Array>|Iterable<string|Uint8Array>|ReadableStream} readable
   * @param {{chunkOptions?:object,signal?:AbortSignal}=} options
   * @returns {Promise<Array>}
   */
  async parse(readable, options = {}) {
    const out = [];
    for await (const c of this.parseStream(readable, options)) out.push(c);
    return out;
  }

  _validateChunks(chunks, { maxSize, totalLength } = {}) {
    const list = Array.isArray(chunks) ? chunks : null;
    if (!list || list.length === 0) return { ok: true, reason: "empty" };

    const max = typeof maxSize === "number" && Number.isFinite(maxSize) ? Math.max(1, Math.floor(maxSize)) : 2000;
    const limit = Math.max(max * 2, max + 500);

    let maxLen = 0;
    for (const c of list) {
      if (!c || typeof c !== "object") return { ok: false, reason: "chunk_not_object" };
      const text = typeof c.text === "string" ? c.text : "";
      if (!text) return { ok: false, reason: "chunk_missing_text" };
      maxLen = Math.max(maxLen, text.length);

      const loc = c.locator;
      if (!isPlainObject(loc)) return { ok: false, reason: "chunk_missing_locator" };
      const start = Number(loc.charStart);
      const end = Number(loc.charEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return { ok: false, reason: "chunk_bad_locator" };
      if (typeof totalLength === "number" && Number.isFinite(totalLength)) {
        if (start < 0 || end > totalLength) return { ok: false, reason: "chunk_locator_oob" };
      }
    }

    if (maxLen > limit) return { ok: false, reason: `chunk_too_large:${maxLen}` };
    return { ok: true };
  }

  /**
   * Build a ParsedDocument from parsed content.
   * @param {object} params
   * @param {string} [params.sourceType] - Source type constant (e.g., SourceKind.PDF)
   * @param {object} [params.origin] - Original source info (filename, URL, etc.)
   * @param {string} [params.markdown] - Markdown content
   * @param {Array<{id:string,type:string,data:string|Uint8Array,mimeType?:string}>} [params.assets] - Extracted assets
   * @param {object} [params.metadata] - Document metadata (title, author, etc.)
   * @param {{adapter:string,durationMs?:number}} [params.parseInfo] - Parsing info
   * @param {string} [params.docId] - Optional explicit document ID
   * @param {{chunkSize?:number,overlap?:number,includeLineNumbers?:boolean,forceStrategy?:string}} [params.chunkOptions] - Chunking options
   * @param {boolean} [params.useSmartChunk=false] - Use smart chunking strategy
   * @returns {{docId:string,markdown:string,textNormalized:string,textHash:string,toc:object,chunks:Array,chunkStrategy:string,chunkMeta:object,assets:Array,metadata:object,parseInfo:object}} ParsedDocument
   */
  buildParsedDocument({ sourceType, origin, markdown, assets, metadata, parseInfo, docId, chunkOptions, useSmartChunk = false } = {}) {
    const md = String(markdown || "");
    const normalized = normalizeText(md);

    // 分块：默认固定大小；如需智能策略由调用方显式开启
    let chunks, chunkStrategy, chunkMeta;
    const maxSize = chunkOptions?.chunkSize || this.defaultChunkOptions.chunkSize || 2000;
    const chunkFallbackOptions = {
      ...this.defaultChunkOptions,
      ...(isPlainObject(chunkOptions) ? chunkOptions : {}),
      chunkSize: maxSize,
      overlap: (isPlainObject(chunkOptions) && chunkOptions.overlap !== undefined) ? chunkOptions.overlap : this.defaultChunkOptions.overlap,
    };

    if (useSmartChunk) {
      const result = smartChunk(normalized.normalized, {
        maxSize,
        forceStrategy: chunkOptions?.forceStrategy,
      });
      chunks = result.chunks;
      chunkStrategy = result.strategy;
      chunkMeta = result.meta;

      const validation = this._validateChunks(chunks, { maxSize, totalLength: normalized.normalized.length });
      if (!validation.ok) {
        chunks = chunkText(normalized.normalized, chunkFallbackOptions);
        chunkStrategy = ChunkStrategy.FIXED;
        chunkMeta = {
          totalLength: normalized.normalized.length,
          chunkCount: chunks.length,
          avgChunkSize: chunks.length > 0 ? Math.round(normalized.normalized.length / chunks.length) : 0,
          fallbackFrom: result.strategy,
          fallbackReason: validation.reason,
        };
      }
    } else {
      chunks = chunkText(normalized.normalized, chunkFallbackOptions);
      chunkStrategy = ChunkStrategy.FIXED;
      chunkMeta = { totalLength: normalized.normalized.length, chunkCount: chunks.length };
    }

    const tocRes = buildToc(normalized.normalized, {});
    const toc = (Array.isArray(tocRes?.tocNodes) && tocRes.tocNodes.length ? tocRes.tocNodes : tocRes?.fallbackSections) || [];

    const computedDocId = toNonEmptyString(docId) || safeDocId(sourceType, normalized.textHash);
    const outAssets = Array.isArray(assets) ? assets : [];

    return {
      docId: computedDocId,
      sourceType: toNonEmptyString(sourceType) || "markdown",
      origin: isPlainObject(origin) ? origin : {},
      markdown: md,
      textNormalized: normalized.normalized,
      textHash: normalized.textHash,
      toc,
      chunks,
      chunkStrategy,  // 记录使用的分块策略
      chunkMeta,      // 分块元信息
      assets: outAssets,
      metadata: isPlainObject(metadata) ? metadata : {},
      parseInfo: isPlainObject(parseInfo)
        ? parseInfo
        : {
            adapter: this.adapterName,
            durationMs: 0,
          },
    };
  }
}
