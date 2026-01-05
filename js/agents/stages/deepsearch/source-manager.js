import { safeInt, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { LRUCache } from "../../shared/utils/lru-cache.js";

function toPositiveInt(value, fallback) {
  const n = safeInt(value);
  if (n === null || n <= 0) return fallback;
  return n;
}

function toNonNegativeInt(value, fallback) {
  const n = safeInt(value);
  if (n === null || n < 0) return fallback;
  return n;
}

function normalizeId(value) {
  return toNonEmptyString(value);
}

function resolveSourceId(source) {
  if (!source || typeof source !== "object") return null;
  return normalizeId(source.sourceId) || normalizeId(source.docId) || normalizeId(source.id);
}

function resolveSourceName(source) {
  if (!source || typeof source !== "object") return null;
  return (
    normalizeId(source.name) ||
    normalizeId(source.title) ||
    normalizeId(source.metadata?.title) ||
    normalizeId(source.metadata?.origin?.title) ||
    normalizeId(source.metadata?.origin?.filename) ||
    resolveSourceId(source)
  );
}

function resolveSourceText(source, { preferNormalized = true } = {}) {
  if (!source || typeof source !== "object") return "";
  const direct = preferNormalized
    ? typeof source.sourceTextNormalized === "string"
      ? source.sourceTextNormalized
      : typeof source.sourceText === "string"
        ? source.sourceText
        : typeof source.textNormalized === "string"
          ? source.textNormalized
          : typeof source.text === "string"
            ? source.text
            : typeof source.rawText === "string"
              ? source.rawText
              : ""
    : typeof source.sourceText === "string"
      ? source.sourceText
      : typeof source.sourceTextNormalized === "string"
        ? source.sourceTextNormalized
        : typeof source.text === "string"
          ? source.text
          : typeof source.textNormalized === "string"
            ? source.textNormalized
            : typeof source.rawText === "string"
              ? source.rawText
              : "";
  return direct || "";
}

function computeLineStarts(text) {
  const s = typeof text === "string" ? text : "";
  const starts = [0];
  let cursor = 0;
  while (cursor < s.length) {
    const idx = s.indexOf("\n", cursor);
    if (idx === -1) break;
    starts.push(idx + 1);
    cursor = idx + 1;
  }
  return starts;
}

function sliceLine(text, starts, index) {
  const start = starts[index] ?? 0;
  const next = starts[index + 1];
  const end = Number.isFinite(next) ? Math.max(start, next - 1) : text.length;
  return text.slice(start, end);
}

function findLineNumberForOffset(starts, offset) {
  const target = Math.max(0, Number(offset) || 0);
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = starts[mid];
    const next = starts[mid + 1];
    const end = Number.isFinite(next) ? next : Infinity;
    if (target < start) {
      hi = mid - 1;
      continue;
    }
    if (target >= end) {
      lo = mid + 1;
      continue;
    }
    return mid + 1;
  }
  return starts.length;
}

function renderLineRange(text, starts, { startLine, endLine, maxLength }) {
  const lineCount = starts.length || 1;
  const start = Math.min(lineCount, Math.max(1, toPositiveInt(startLine, 1)));
  const end = Math.min(lineCount, Math.max(start, toPositiveInt(endLine, lineCount)));

  const limit = Math.max(1, toPositiveInt(maxLength, 5000));

  const rangeStartOffset = starts[start - 1] ?? 0;
  const rangeEndExclusive = end < lineCount ? Math.max(rangeStartOffset, (starts[end] ?? 0) - 1) : text.length;
  const fullLength = Math.max(0, rangeEndExclusive - rangeStartOffset);

  const pieces = [];
  let length = 0;

  for (let i = start - 1; i < end; i++) {
    const line = sliceLine(text, starts, i);
    if (i > start - 1) {
      if (length + 1 > limit) {
        break;
      }
      pieces.push("\n");
      length += 1;
    }
    if (length + line.length > limit) {
      const remaining = Math.max(0, limit - length);
      if (remaining) pieces.push(line.slice(0, remaining));
      length = limit;
      break;
    }
    pieces.push(line);
    length += line.length;
  }

  const content = pieces.join("");
  const truncated = fullLength > limit;
  return {
    content: truncated ? content + "\n\n... (truncated)" : content,
    contentLength: fullLength,
    truncated,
    lineStart: start,
    lineEnd: end,
    totalLines: lineCount,
  };
}

function extractHeadings(text, { maxHeadings = 20 } = {}) {
  const src = typeof text === "string" ? text : "";
  const headings = (src.match(/^#{1,6}\s+.+$/gm) || []).map((h, i) => {
    const level = (h.match(/^#+/) || [""])[0].length;
    const title = h.replace(/^#+\s*/, "").trim();
    return { level, text: title, index: i };
  });
  return { headings, headingCount: headings.length, headingsPreview: headings.slice(0, maxHeadings) };
}

function buildToc(headings, { maxLength = 1000 } = {}) {
  const rows = Array.isArray(headings) ? headings : [];
  let toc = rows.map((h) => "  ".repeat(Math.max(0, h.level - 1)) + "- " + h.text).join("\n");
  const truncated = toc.length > maxLength;
  if (truncated) toc = toc.slice(0, maxLength) + "\n... (TOC 已截断)";
  return { toc, tocTruncated: truncated };
}

function cosineSimilarity(a, b) {
  const va = a && typeof a === "object" ? a : null;
  const vb = b && typeof b === "object" ? b : null;
  const al = typeof va?.length === "number" ? va.length : 0;
  const bl = typeof vb?.length === "number" ? vb.length : 0;
  if (!al || !bl || al !== bl) return 0;

  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < al; i++) {
    const x = Number(va[i] ?? 0);
    const y = Number(vb[i] ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function findSectionRange(text, starts, section) {
  const wanted = String(section || "").trim().toLowerCase();
  if (!wanted) return null;
  const wantedNoHash = wanted.replace(/^#+\s*/, "");

  const lineCount = starts.length || 1;
  let startIndex = -1;
  let foundHeader = "";

  for (let i = 0; i < lineCount; i++) {
    const line = sliceLine(text, starts, i).trim();
    if (!line.startsWith("#")) continue;
    const lower = line.toLowerCase();
    if (lower === wanted || lower.includes(wantedNoHash)) {
      startIndex = i;
      foundHeader = sliceLine(text, starts, i);
      break;
    }
  }

  if (startIndex === -1) return null;

  let endIndex = -1;
  for (let j = startIndex + 1; j < lineCount; j++) {
    const line = sliceLine(text, starts, j).trim();
    if (line.startsWith("#")) {
      endIndex = j;
      break;
    }
  }

  const lineStart = startIndex + 1;
  const lineEnd = endIndex === -1 ? lineCount : endIndex;
  return {
    section: String(section),
    foundHeader,
    isFuzzy: !foundHeader.toLowerCase().includes(wanted),
    lineStart,
    lineEnd,
  };
}

export class SourceManager {
  constructor(sources = [], options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    this.preferNormalized = typeof opts.preferNormalized === "boolean" ? opts.preferNormalized : true;
    this.maxCachedLineIndexes = toPositiveInt(opts.maxCachedLineIndexes, 20);

    this._sourcesRef = null;
    this._sourcesLength = 0;
    this._sourcesById = new Map();

    this._lineStartsCache = new LRUCache({ maxSize: this.maxCachedLineIndexes }); // sourceId -> { text, starts }

    this.setSources(sources);
  }

  setSources(sources) {
    const rows = Array.isArray(sources) ? sources : [];
    this._sourcesRef = rows;
    this._sourcesLength = rows.length;
    this._sourcesById.clear();
    this._lineStartsCache.clear();

    for (const s of rows) {
      const sid = resolveSourceId(s);
      if (!sid || this._sourcesById.has(sid)) continue;
      this._sourcesById.set(sid, s);
    }
  }

  syncSources(sources) {
    const rows = Array.isArray(sources) ? sources : [];
    if (rows === this._sourcesRef && rows.length === this._sourcesLength) return false;
    this.setSources(rows);
    return true;
  }

  listSources() {
    const out = [];
    for (const [sourceId, source] of this._sourcesById.entries()) {
      const name = resolveSourceName(source) || sourceId;
      const text = resolveSourceText(source, { preferNormalized: this.preferNormalized });
      out.push({ sourceId, name, size: text.length });
    }
    return out;
  }

  getSource(sourceIdOrName) {
    const key = normalizeId(sourceIdOrName);
    if (!key) return null;
    if (this._sourcesById.has(key)) return this._sourcesById.get(key);

    const wanted = key.toLowerCase();
    for (const s of this._sourcesById.values()) {
      const name = resolveSourceName(s);
      if (name && name.toLowerCase() === wanted) return s;
    }
    return null;
  }

  getSourceInfo(sourceIdOrName) {
    const source = this.getSource(sourceIdOrName);
    if (!source) return null;
    const sourceId = resolveSourceId(source);
    if (!sourceId) return null;
    const name = resolveSourceName(source) || sourceId;
    const text = resolveSourceText(source, { preferNormalized: this.preferNormalized });
    return { source, sourceId, name, text, totalLength: text.length };
  }

  getSourceText(sourceIdOrName) {
    const info = this.getSourceInfo(sourceIdOrName);
    return info ? info.text : "";
  }

  getLineStarts(sourceIdOrName) {
    const info = this.getSourceInfo(sourceIdOrName);
    if (!info) return null;
    const { sourceId, text } = info;

    const cached = this._lineStartsCache.get(sourceId);
    if (cached && cached.text === text) {
      return cached.starts;
    }

    const starts = computeLineStarts(text);
    this._lineStartsCache.set(sourceId, { text, starts });
    return starts;
  }

  read(sourceIdOrName, args = {}) {
    const info = this.getSourceInfo(sourceIdOrName);
    if (!info) {
      return {
        success: false,
        error: `Document not found: ${String(sourceIdOrName || "")}`,
        available: this.listSources()
          .map((s) => s.sourceId)
          .slice(0, 10),
      };
    }

    const params = args && typeof args === "object" ? args : {};
    const maxLength = Math.max(1, toPositiveInt(params.maxLength, 5000));
    const preview = params.preview;
    const section = toNonEmptyString(params.section);
    const startLine = params.startLine;
    const endLine = params.endLine;
    const start = params.start;
    const end = params.end;

    const { sourceId, name, text: fullContent } = info;

    if (preview) {
      const previewLength = typeof preview === "number" ? Math.max(0, preview) : 500;
      const { headings, headingCount, headingsPreview } = extractHeadings(fullContent);
      const tocMaxLength = 1000;
      const { toc, tocTruncated } = buildToc(headings, { maxLength: tocMaxLength });
      const bodyPreview = fullContent.slice(0, previewLength);
      const previewTruncated = fullContent.length > previewLength;

      const content = `## 文档结构 (${headingCount} 个章节)\n\n${toc || "(无标题结构)"}\n\n## 内容预览 (前 ${previewLength} 字)\n\n${bodyPreview}${previewTruncated ? "\n\n..." : ""}`;
      const truncated = content.length > maxLength;
      return {
        success: true,
        sourceId,
        name,
        content: truncated ? content.slice(0, maxLength) + "\n\n... (truncated)" : content,
        totalLength: fullContent.length,
        readMode: "preview",
        headingCount,
        headings: headingsPreview,
        previewLength,
        tocTruncated,
        truncated,
        contentLength: content.length,
      };
    }

    const startsArr = this.getLineStarts(sourceId);
    const starts = startsArr || [0];
    const totalLines = starts.length || 1;

    if (section) {
      const range = findSectionRange(fullContent, starts, section);
      if (!range) {
        const { headingsPreview } = extractHeadings(fullContent);
        return {
          success: false,
          error: `Section not found: ${section}`,
          hint: "可用章节：" + headingsPreview.map((h) => h.text).slice(0, 10).join(", "),
        };
      }
      const rendered = renderLineRange(fullContent, starts, { startLine: range.lineStart, endLine: range.lineEnd, maxLength });
      return {
        success: true,
        sourceId,
        name,
        content: rendered.content,
        totalLength: fullContent.length,
        readMode: "section",
        section: range.section,
        found: true,
        foundHeader: range.foundHeader,
        isFuzzy: range.isFuzzy,
        lineStart: rendered.lineStart,
        lineEnd: rendered.lineEnd,
        truncated: rendered.truncated,
        contentLength: rendered.contentLength,
      };
    }

    if (startLine !== undefined || endLine !== undefined) {
      const rendered = renderLineRange(fullContent, starts, { startLine, endLine, maxLength });
      return {
        success: true,
        sourceId,
        name,
        content: rendered.content,
        totalLength: fullContent.length,
        readMode: "lines",
        startLine: rendered.lineStart,
        endLine: rendered.lineEnd,
        lineStart: rendered.lineStart,
        lineEnd: rendered.lineEnd,
        totalLines: rendered.totalLines,
        truncated: rendered.truncated,
        contentLength: rendered.contentLength,
      };
    }

    if (start !== undefined || end !== undefined) {
      const s = Math.max(0, toNonNegativeInt(start, 0));
      const e = Math.min(fullContent.length, end === undefined ? fullContent.length : Math.max(0, toNonNegativeInt(end, fullContent.length)));
      const content = fullContent.slice(s, e);
      const lineStart = findLineNumberForOffset(starts, s);
      const lineEnd = findLineNumberForOffset(starts, Math.max(s, e));
      const truncated = content.length > maxLength;
      return {
        success: true,
        sourceId,
        name,
        content: truncated ? content.slice(0, maxLength) + "\n\n... (truncated)" : content,
        totalLength: fullContent.length,
        readMode: "chars",
        start: s,
        end: e,
        totalLengthChars: fullContent.length,
        lineStart,
        lineEnd,
        truncated,
        contentLength: content.length,
      };
    }

    const truncated = fullContent.length > maxLength;
    const lineStart = 1;
    const lineEnd = totalLines;

    return {
      success: true,
      sourceId,
      name,
      content: truncated ? fullContent.slice(0, maxLength) + "\n\n... (truncated)" : fullContent,
      totalLength: fullContent.length,
      readMode: "full",
      lineStart,
      lineEnd,
      totalLines,
      truncated,
      contentLength: fullContent.length,
    };
  }

  search(query, { sources, limit = 10 } = {}) {
    const q = typeof query === "string" ? query : "";
    const trimmed = q.trim();
    if (!trimmed) return [];

    const targetIds = Array.isArray(sources) && sources.length ? sources.map((s) => resolveSourceId(s) || normalizeId(s)).filter(Boolean) : [];
    const targetSources = targetIds.length
      ? targetIds.map((id) => this._sourcesById.get(id)).filter(Boolean)
      : Array.from(this._sourcesById.values());

    const results = [];
    const queryLower = trimmed.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter((w) => w.length >= 2);
    const maxResults = Math.max(1, toPositiveInt(limit, 10));

    for (const source of targetSources) {
      if (!source) continue;
      const sourceId = resolveSourceId(source);
      if (!sourceId) continue;
      const text = resolveSourceText(source, { preferNormalized: this.preferNormalized });
      if (!text) continue;

      const starts = this.getLineStarts(sourceId);
      const lineCount = starts?.length || 1;

      for (let i = 0; i < lineCount; i++) {
        const lineText = sliceLine(text, starts || [0], i);
        const lineLower = lineText.toLowerCase();
        const matched = keywords.some((kw) => lineLower.includes(kw));
        if (!matched) continue;

        const snippetStart = Math.max(1, i + 1 - 1);
        const snippetEnd = Math.min(lineCount, i + 1 + 1);
        const snippet = renderLineRange(text, starts || [0], { startLine: snippetStart, endLine: snippetEnd, maxLength: 800 }).content;

        results.push({
          sourceId,
          sourceName: resolveSourceName(source) || sourceId,
          line: i + 1,
          snippet,
          score: 1.0,
        });

        if (results.length >= maxResults) return results;
      }
    }

    return results.slice(0, maxResults);
  }

  /**
   * Semantic search: keyword candidates -> embedding rerank (best-effort).
   *
   * @param {string} query
   * @param {object=} options
   * @param {Array<object|string>=} options.sources
   * @param {number=} options.limit
   * @param {{embed:(texts:string[],opts?:any)=>Promise<any>}=} options.embeddingService
   * @param {number=} options.timeoutMs
   */
  async semanticSearch(query, { sources, limit = 10, embeddingService, timeoutMs } = {}) {
    const q = typeof query === "string" ? query : "";
    const trimmed = q.trim();
    if (!trimmed) return [];

    const maxResults = Math.max(1, toPositiveInt(limit, 10));
    const svc = embeddingService && typeof embeddingService.embed === "function" ? embeddingService : null;
    if (!svc) return this.search(trimmed, { sources, limit: maxResults });

    // 1) Use the existing keyword scan to cheaply produce candidates.
    const candidateFactor = 5;
    const candidates = this.search(trimmed, { sources, limit: maxResults * candidateFactor });
    if (!candidates.length) return [];

    // 2) Best-effort embedding rerank (avoid full-document embeddings).
    const snippets = candidates.map((r) => String(r?.snippet || "").slice(0, 2000));
    const vectors = await svc.embed([trimmed, ...snippets], { ...(timeoutMs ? { timeoutMs } : {}) });
    if (!Array.isArray(vectors) || vectors.length !== snippets.length + 1) {
      return candidates.slice(0, maxResults);
    }

    const qv = vectors[0];
    const scored = candidates.map((row, i) => {
      const sim = cosineSimilarity(qv, vectors[i + 1]);
      const score = Number.isFinite(sim) ? Math.max(0, sim) : 0;
      return { ...row, score };
    });

    scored.sort((a, b) => (b.score || 0) - (a.score || 0));
    return scored.slice(0, maxResults);
  }
}

export default SourceManager;
