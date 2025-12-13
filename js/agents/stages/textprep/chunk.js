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
