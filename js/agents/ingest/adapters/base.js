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

export class BaseAdapter {
  constructor({ adapterName, defaultChunkOptions } = {}) {
    this.adapterName = toNonEmptyString(adapterName) || "base";
    this.defaultChunkOptions = isPlainObject(defaultChunkOptions)
      ? defaultChunkOptions
      : { chunkSize: 2000, overlap: 200, includeLineNumbers: true };
  }

  /**
   * Adapter interface: parse(input) -> ParsedDocument.
   * @abstract
   * @param {any} _input
   * @returns {Promise<object>}
   */
  async parse(_input) {
    throw new Error(`${this.constructor.name}.parse(): not implemented`);
  }

  buildParsedDocument({ sourceType, origin, markdown, assets, metadata, parseInfo, docId, chunkOptions, useSmartChunk = true } = {}) {
    const md = String(markdown || "");
    const normalized = normalizeText(md);

    // 智能分块：自动选择最佳策略
    let chunks, chunkStrategy, chunkMeta;
    const maxSize = chunkOptions?.chunkSize || this.defaultChunkOptions.chunkSize || 2000;

    if (useSmartChunk) {
      const result = smartChunk(normalized.normalized, {
        maxSize,
        forceStrategy: chunkOptions?.forceStrategy,
      });
      chunks = result.chunks;
      chunkStrategy = result.strategy;
      chunkMeta = result.meta;
    } else {
      chunks = chunkText(normalized.normalized, { ...this.defaultChunkOptions, ...(isPlainObject(chunkOptions) ? chunkOptions : {}) });
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

