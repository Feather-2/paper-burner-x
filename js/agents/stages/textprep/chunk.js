import { isPlainObject } from "../../shared/utils/value-utils.js";

// TP2: Chunking + locators (char offsets; optional line numbers).

/**
 * 分块策略枚举
 */
export const ChunkStrategy = {
  MARKDOWN: "markdown",   // 按 markdown 标题层级
  SEMANTIC: "semantic",   // 按段落/句子边界
  FIXED: "fixed",         // 固定长度
};

/**
 * 检测文档的分块策略
 * 优先级: markdown > semantic > fixed
 *
 * @param {string} text
 * @returns {{ strategy: string, reason: string, headingCount?: number }}
 */
export function detectChunkStrategy(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { strategy: ChunkStrategy.FIXED, reason: "empty or invalid" };
  }

  // 检测 markdown 标题
  const headings = (text.match(/^#{1,6}\s+.+$/gm) || []);
  const headingCount = headings.length;

  // 有 2+ 个标题且标题覆盖率合理（每 2000 字至少 1 个标题）
  if (headingCount >= 2 && headingCount >= text.length / 5000) {
    return { strategy: ChunkStrategy.MARKDOWN, reason: "has markdown structure", headingCount };
  }

  // 检测段落结构（双换行）
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 50);
  if (paragraphs.length >= 3) {
    return { strategy: ChunkStrategy.SEMANTIC, reason: "has paragraph structure", paragraphCount: paragraphs.length };
  }

  return { strategy: ChunkStrategy.FIXED, reason: "no clear structure" };
}

/**
 * 智能分块 - 自动选择最佳策略
 *
 * @param {string} text
 * @param {object} options
 * @param {string} [options.forceStrategy] - 强制使用某策略
 * @param {number} [options.maxSize] - 最大块大小
 * @returns {{ strategy: string, chunks: Array, meta: object }}
 */
export function smartChunk(text, options = {}) {
  const { forceStrategy, maxSize = 2000 } = options;

  const detection = detectChunkStrategy(text);
  const strategy = forceStrategy || detection.strategy;

  let chunks;
  switch (strategy) {
    case ChunkStrategy.MARKDOWN:
      chunks = markdownChunk(text, { maxSize });
      break;
    case ChunkStrategy.SEMANTIC:
      chunks = semanticChunk(text, { maxSize, minSize: Math.floor(maxSize / 4) });
      break;
    default:
      chunks = chunkText(text, { chunkSize: maxSize, overlap: Math.floor(maxSize / 10) });
  }

  return {
    strategy,
    reason: detection.reason,
    chunks,
    meta: {
      totalLength: text.length,
      chunkCount: chunks.length,
      avgChunkSize: chunks.length > 0 ? Math.round(text.length / chunks.length) : 0,
      ...detection,
    },
  };
}

function precomputeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

function lineNumberAt(lineStarts, charIndex) {
  // Returns 0-based line index for a 0-based char index. If charIndex==len, clamp to last line.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= charIndex) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, lo - 1);
}

/**
 * @typedef {Object} Chunk
 * @property {string} chunkId
 * @property {string} text
 * @property {{charStart:number,charEnd:number,lineStart?:number,lineEnd?:number}} locator
 */

/**
 * @param {string} normalizedText
 * @param {object=} options
 * @returns {Chunk[]}
 */
export function chunkText(normalizedText, options = {}) {
  if (typeof normalizedText !== "string") throw new TypeError("chunkText(normalizedText): normalizedText must be a string");
  if (!isPlainObject(options)) throw new TypeError("chunkText(normalizedText, options): options must be an object");

  const chunkSize = Number.isFinite(options.chunkSize) ? Math.max(1, Math.floor(options.chunkSize)) : 2000;
  const overlap = Number.isFinite(options.overlap) ? Math.max(0, Math.floor(options.overlap)) : 200;
  const includeLineNumbers = Boolean(options.includeLineNumbers);

  if (overlap >= chunkSize) throw new Error("chunkText(): overlap must be < chunkSize");

  const text = normalizedText;
  const n = text.length;
  if (n === 0) return [];

  const lineStarts = includeLineNumbers ? precomputeLineStarts(text) : null;
  const chunks = [];

  let start = 0;
  let i = 0;
  while (start < n) {
    const end = Math.min(start + chunkSize, n);
    if (end <= start) break;

    const chunk = {
      chunkId: `chunk_${++i}`,
      text: text.slice(start, end),
      locator: { charStart: start, charEnd: end },
    };

    if (includeLineNumbers && lineStarts) {
      const lineStart0 = lineNumberAt(lineStarts, start);
      const lineEnd0 = lineNumberAt(lineStarts, Math.max(start, end - 1));
      chunk.locator.lineStart = lineStart0 + 1;
      chunk.locator.lineEnd = lineEnd0 + 1;
    }

    chunks.push(chunk);
    if (end === n) break;

    start = end - overlap;
  }

  return chunks;
}

function lowerBound(arr, x) {
  // First index with arr[i] >= x
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr, x) {
  // First index with arr[i] > x
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lastBoundaryInRange(boundaries, minInclusive, maxInclusive) {
  const idx = upperBound(boundaries, maxInclusive) - 1;
  if (idx < 0) return null;
  const v = boundaries[idx];
  return v >= minInclusive ? v : null;
}

function firstBoundaryAtOrAfter(boundaries, pos) {
  const idx = lowerBound(boundaries, pos);
  return idx >= boundaries.length ? boundaries[boundaries.length - 1] : boundaries[idx];
}

function mergeSortedUnique(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const av = i < a.length ? a[i] : Infinity;
    const bv = j < b.length ? b[j] : Infinity;
    const v = av <= bv ? av : bv;
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
    if (av === v) i++;
    if (bv === v) j++;
  }
  return out;
}

function computeParagraphBoundaries(text) {
  // Boundary is the index *after* the "\n\n" delimiter (delimiter stays with previous chunk).
  const n = text.length;
  const boundaries = [0];
  for (let i = 0; i < n - 1; i++) {
    if (text.charCodeAt(i) === 10 /* \n */ && text.charCodeAt(i + 1) === 10 /* \n */) {
      boundaries.push(i + 2);
      i++;
    }
  }
  if (boundaries[boundaries.length - 1] !== n) boundaries.push(n);
  return boundaries;
}

function computeSentenceBoundaries(text) {
  // Sentence boundary is the index right after a terminator, optionally including closing quotes/brackets and spaces.
  const n = text.length;
  const boundaries = [0];
  const isCloser = (ch) => ch === '"' || ch === "'" || ch === "”" || ch === "’" || ch === ")" || ch === "]" || ch === "}" || ch === "）" || ch === "】";
  const isSpace = (ch) => ch === " " || ch === "\t";
  const isDigit = (code) => code >= 48 && code <= 57;

  for (let i = 0; i < n; i++) {
    const ch = text[i];
    const isTerminator = ch === "。" || ch === "！" || ch === "？" || ch === "!" || ch === "?";
    let isDot = ch === ".";
    if (isDot) {
      const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
      const next = i + 1 < n ? text.charCodeAt(i + 1) : 0;
      if (isDigit(prev) && isDigit(next)) isDot = false;
    }
    if (!isTerminator && !isDot) continue;

    let j = i + 1;
    while (j < n && isCloser(text[j])) j++;
    while (j < n && isSpace(text[j])) j++;
    if (boundaries[boundaries.length - 1] !== j) boundaries.push(j);
  }

  if (boundaries[boundaries.length - 1] !== n) boundaries.push(n);
  return boundaries;
}

/**
 * Semantic chunking with stable char locators.
 *
 * Algorithm (pure, no side effects):
 * - Choose chunk end by the latest boundary within [start+minSize, start+maxSize] (paragraph "\n\n" preferred, then sentence terminators).
 * - This naturally merges short paragraphs (by skipping early boundaries) and splits long paragraphs (by falling back to sentence boundaries).
 * - Next chunk start uses best-effort overlap, nudged forward to the next semantic boundary to avoid cutting sentences/paragraphs.
 *
 * @param {string} text
 * @param {{maxSize?:number,minSize?:number,overlap?:number}=} options
 * @returns {Chunk[]}
 */
/**
 * Markdown 结构分块 - 按标题层级切分
 *
 * 特点：
 * - 按 markdown 标题 (#{1,6}) 切分
 * - 保持层级关系 (parent 指针)
 * - 超长章节自动二次切分
 * - 结果稳定（确定性算法）
 *
 * @param {string} text
 * @param {{maxSize?:number, splitLongSections?:boolean}=} options
 * @returns {Array<{sectionId:string, title:string, level:number, parent:string|null, text:string, locator:{charStart:number,charEnd:number}}>}
 */
export function markdownChunk(text, options = {}) {
  if (typeof text !== "string") throw new TypeError("markdownChunk(text): text must be a string");

  const maxSize = Number.isFinite(options.maxSize) ? Math.max(100, Math.floor(options.maxSize)) : 4000;
  const splitLong = options.splitLongSections !== false;

  const n = text.length;
  if (n === 0) return [];

  // 找所有标题位置
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(text)) !== null) {
    headings.push({
      level: match[1].length,
      title: match[2].trim(),
      fullMatch: match[0],
      charStart: match.index,
    });
  }

  // 无标题时返回整个文档作为一个块
  if (headings.length === 0) {
    return [{
      sectionId: "section_1",
      title: "(无标题)",
      level: 0,
      parent: null,
      text: text,
      locator: { charStart: 0, charEnd: n },
    }];
  }

  // 计算每个标题的结束位置（下一个同级或更高级标题之前）
  const sections = [];
  const parentStack = []; // { level, sectionId }

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const nextH = headings[i + 1];
    const charEnd = nextH ? nextH.charStart : n;

    // 更新 parent stack
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].level >= h.level) {
      parentStack.pop();
    }
    const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1].sectionId : null;

    const sectionId = `section_${i + 1}`;
    const sectionText = text.slice(h.charStart, charEnd);

    // 超长章节二次切分
    if (splitLong && sectionText.length > maxSize) {
      const subChunks = splitLongSection(sectionText, h, sectionId, parent, h.charStart, maxSize);
      sections.push(...subChunks);
    } else {
      sections.push({
        sectionId,
        title: h.title,
        level: h.level,
        parent,
        text: sectionText,
        locator: { charStart: h.charStart, charEnd },
      });
    }

    parentStack.push({ level: h.level, sectionId });
  }

  // 处理第一个标题之前的内容（如果有）
  if (headings[0].charStart > 0) {
    const preamble = text.slice(0, headings[0].charStart).trim();
    if (preamble) {
      sections.unshift({
        sectionId: "section_0",
        title: "(前言)",
        level: 0,
        parent: null,
        text: preamble,
        locator: { charStart: 0, charEnd: headings[0].charStart },
      });
    }
  }

  return sections;
}

function splitLongSection(text, heading, baseSectionId, parent, baseCharStart, maxSize) {
  const chunks = [];
  const titleLine = text.split("\n")[0];
  const bodyStart = titleLine.length + 1;
  const body = text.slice(bodyStart);

  // 按段落切分
  const paragraphs = body.split(/\n\n+/);
  let currentChunk = titleLine + "\n\n";
  let chunkStart = baseCharStart;
  let partNum = 1;

  for (const para of paragraphs) {
    if (currentChunk.length + para.length + 2 > maxSize && currentChunk.length > titleLine.length + 10) {
      chunks.push({
        sectionId: `${baseSectionId}_p${partNum}`,
        title: `${heading.title} (第${partNum}部分)`,
        level: heading.level,
        parent,
        text: currentChunk.trim(),
        locator: { charStart: chunkStart, charEnd: chunkStart + currentChunk.length },
      });
      partNum++;
      chunkStart += currentChunk.length;
      currentChunk = "";
    }
    currentChunk += para + "\n\n";
  }

  if (currentChunk.trim()) {
    chunks.push({
      sectionId: partNum === 1 ? baseSectionId : `${baseSectionId}_p${partNum}`,
      title: partNum === 1 ? heading.title : `${heading.title} (第${partNum}部分)`,
      level: heading.level,
      parent,
      text: currentChunk.trim(),
      locator: { charStart: chunkStart, charEnd: baseCharStart + text.length },
    });
  }

  return chunks;
}

export function semanticChunk(text, options = {}) {
  if (typeof text !== "string") throw new TypeError("semanticChunk(text): text must be a string");
  if (!isPlainObject(options)) throw new TypeError("semanticChunk(text, options): options must be an object");

  const maxSize = Number.isFinite(options.maxSize) ? Math.max(1, Math.floor(options.maxSize)) : 1600;
  let minSize = Number.isFinite(options.minSize) ? Math.max(1, Math.floor(options.minSize)) : 400;
  const overlap = Number.isFinite(options.overlap) ? Math.max(0, Math.floor(options.overlap)) : 100;

  if (overlap >= maxSize) throw new Error("semanticChunk(): overlap must be < maxSize");
  if (minSize > maxSize) minSize = maxSize;

  const n = text.length;
  if (n === 0) return [];

  const paragraphBoundaries = computeParagraphBoundaries(text);
  const sentenceBoundaries = computeSentenceBoundaries(text);
  const boundaries = mergeSortedUnique(paragraphBoundaries, sentenceBoundaries);

  const chunks = [];
  let start = 0;
  let i = 0;
  while (start < n) {
    const minEnd = Math.min(start + minSize, n);
    const maxEnd = Math.min(start + maxSize, n);

    let end =
      lastBoundaryInRange(paragraphBoundaries, minEnd, maxEnd) ??
      lastBoundaryInRange(sentenceBoundaries, minEnd, maxEnd) ??
      maxEnd;

    if (end <= start) end = maxEnd;
    if (end <= start) break;

    chunks.push({
      chunkId: `chunk_${++i}`,
      text: text.slice(start, end),
      locator: { charStart: start, charEnd: end },
    });

    if (end === n) break;

    const rawNextStart = Math.max(0, end - overlap);
    let nextStart = firstBoundaryAtOrAfter(boundaries, rawNextStart);
    if (nextStart <= start) nextStart = end; // ensure forward progress even with very large overlap
    start = nextStart;
  }

  return chunks;
}
