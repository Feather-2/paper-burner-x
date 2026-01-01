function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "me",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "should",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

function wordRegex() {
  try {
    // eslint-disable-next-line no-new
    new RegExp("\\p{L}", "u");
    return /[\p{L}\p{N}]+/gu;
  } catch {
    // Best-effort fallback for older engines without Unicode property escapes.
    return /[A-Za-z0-9]+|[\u4e00-\u9fff]+|[\u3040-\u30ff]+|[\uac00-\ud7af]+/g;
  }
}

const WORD_RE = wordRegex();

let _wordSegmenter = null;
function getWordSegmenter() {
  if (_wordSegmenter !== null) return _wordSegmenter;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      _wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
      return _wordSegmenter;
    }
  } catch {
    // ignore
  }
  _wordSegmenter = undefined;
  return _wordSegmenter;
}

function shouldDropSingleCharToken(t) {
  if (t.length !== 1) return false;
  // Keep digits and non-ASCII (e.g. CJK) single-char tokens; drop only Latin noise.
  return /^[a-z]$/i.test(t);
}

function tokenize(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return [];

  const seg = getWordSegmenter();
  if (seg && typeof seg.segment === "function") {
    const out = [];
    for (const part of seg.segment(s)) {
      if (part && part.isWordLike === false) continue;
      const t = String(part?.segment || "").trim().toLowerCase();
      if (!t) continue;
      if (STOPWORDS.has(t)) continue;
      if (shouldDropSingleCharToken(t)) continue;
      out.push(t);
    }
    return out;
  }

  const tokens = s.match(WORD_RE) || [];
  const out = [];
  for (const t of tokens) {
    if (!t) continue;
    if (STOPWORDS.has(t)) continue;
    if (shouldDropSingleCharToken(t)) continue;
    out.push(t);
  }
  return out;
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const a of arr) {
    if (seen.has(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

/**
 * @typedef {Object} BM25Index
 * @property {string[]} chunkIds
 * @property {number[]} docLens
 * @property {number} avgDocLen
 * @property {Map<string, number>} df
 * @property {Map<string, Array<[number, number]>>} postings
 * @property {number} k1
 * @property {number} b
 */

/**
 * @param {Array<{chunkId:string,text:string}>} chunks
 * @param {object=} options
 * @returns {BM25Index}
 */
export function buildIndex(chunks, options = {}) {
  if (!Array.isArray(chunks)) throw new TypeError("buildIndex(chunks): chunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("buildIndex(chunks, options): options must be an object");

  const k1 = Number.isFinite(options.k1) ? options.k1 : 1.2;
  const b = Number.isFinite(options.b) ? options.b : 0.75;

  const chunkIds = [];
  const docLens = new Array(chunks.length);
  const df = new Map();
  const postings = new Map();

  let totalLen = 0;

  for (let di = 0; di < chunks.length; di++) {
    const c = chunks[di];
    const chunkId = c && c.chunkId ? String(c.chunkId) : `chunk_${di + 1}`;
    chunkIds.push(chunkId);

    const tokens = tokenize(c && c.text);
    const docLen = tokens.length;
    docLens[di] = docLen;
    totalLen += docLen;

    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    for (const [term, freq] of tf.entries()) {
      df.set(term, (df.get(term) || 0) + 1);
      const list = postings.get(term);
      if (list) list.push([di, freq]);
      else postings.set(term, [[di, freq]]);
    }
  }

  const avgDocLen = chunks.length ? totalLen / chunks.length : 0;
  return { chunkIds, docLens, avgDocLen, df, postings, k1, b };
}

/**
 * Async index builder that can offload CPU work to a WorkerPool when provided.
 *
 * @param {Array<{chunkId:string,text:string}>} chunks
 * @param {{k1?:number,b?:number,workerPool?:{buildIndex?:(chunks:any,options?:any)=>Promise<any>}}=} options
 * @returns {Promise<BM25Index>}
 */
export async function buildIndexAsync(chunks, options = {}) {
  if (!Array.isArray(chunks)) throw new TypeError("buildIndexAsync(chunks): chunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("buildIndexAsync(chunks, options): options must be an object");

  const workerPool = options.workerPool && typeof options.workerPool.buildIndex === "function" ? options.workerPool : null;
  if (workerPool) {
    const safeOptions = {
      ...(Number.isFinite(options.k1) ? { k1: options.k1 } : {}),
      ...(Number.isFinite(options.b) ? { b: options.b } : {}),
    };
    return workerPool.buildIndex(chunks, safeOptions);
  }

  return buildIndex(chunks, options);
}

function idf(nDocs, df) {
  // BM25+ style stable idf: log(1 + (N - df + 0.5)/(df + 0.5))
  return Math.log(1 + (nDocs - df + 0.5) / (df + 0.5));
}

/**
 * @param {BM25Index} index
 * @param {string} query
 * @param {number} topK
 * @param {object=} options
 * @returns {Array<{chunkId:string,score:number}>}
 */
export function search(index, query, topK = 8, options = {}) {
  if (!isPlainObject(index)) throw new TypeError("search(index, query, topK): index must be an object");
  if (typeof query !== "string") throw new TypeError("search(index, query, topK): query must be a string");
  if (!isPlainObject(options)) throw new TypeError("search(index, query, topK, options): options must be an object");

  const nDocs = index.chunkIds ? index.chunkIds.length : 0;
  const k = Number.isFinite(topK) ? Math.max(1, Math.floor(topK)) : 8;
  if (!nDocs) return [];

  const filterDocIndex = typeof options.filterDocIndex === "function" ? options.filterDocIndex : null;
  const qTerms = uniq(tokenize(query));
  if (qTerms.length === 0) return [];

  const scores = new Float64Array(nDocs);
  const avgLen = index.avgDocLen || 1;

  for (const term of qTerms) {
    const list = index.postings && index.postings.get(term);
    if (!list) continue;
    const termDf = index.df.get(term) || 0;
    if (!termDf) continue;
    const w = idf(nDocs, termDf);

    for (let i = 0; i < list.length; i++) {
      const [di, tf] = list[i];
      if (filterDocIndex && !filterDocIndex(di)) continue;
      const dl = index.docLens[di] || 0;
      const denom = tf + index.k1 * (1 - index.b + (index.b * dl) / avgLen);
      const s = (w * (tf * (index.k1 + 1))) / (denom || 1);
      scores[di] += s;
    }
  }

  const results = [];
  for (let di = 0; di < nDocs; di++) {
    const sc = scores[di];
    if (sc <= 0) continue;
    results.push({ chunkId: index.chunkIds[di], score: sc });
  }
  results.sort((a, b) => (b.score === a.score ? (a.chunkId < b.chunkId ? -1 : 1) : b.score - a.score));
  return results.slice(0, k);
}
