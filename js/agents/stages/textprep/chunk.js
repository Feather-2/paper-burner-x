// TP2: Chunking + locators (char offsets; optional line numbers).

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
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
