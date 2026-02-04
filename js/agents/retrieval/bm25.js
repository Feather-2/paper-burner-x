import { isPlainObject } from "../shared/index.js";

function normalizeLimit(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeIndexLimits(options = {}) {
  const opts = isPlainObject(options) ? options : {};
  return {
    maxTokensPerDoc: normalizeLimit(opts.maxTokensPerDoc, 10_000),
    maxUniqueTerms: normalizeLimit(opts.maxUniqueTerms, 50_000),
    maxPostingsPerTerm: normalizeLimit(opts.maxPostingsPerTerm, 10_000),
    maxTermLength: normalizeLimit(opts.maxTermLength, 64),
  };
}

/** @type {ReadonlySet<string>} */
const _DEFAULT_STOPWORDS = new Set([
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
  // Common CJK stopwords (keep list short; BM25 relies on meaningful tokens).
  "的",
  "了",
  "和",
  "是",
  "在",
  "我",
  "我们",
  "你",
  "你们",
  "他",
  "他们",
  "她",
  "她们",
  "它",
  "它们",
  "这",
  "那",
  "这些",
  "那些",
  "一个",
  "一些",
  "没有",
  "可以",
  "可能",
  "如果",
  "因为",
  "所以",
  "但是",
  "而且",
  "以及",
  "与",
  "及",
  "或",
]);

/**
 * Immutable copy of default stopwords. Returns a new Set each time to prevent mutation.
 * @returns {Set<string>}
 */
export function getDefaultStopwords() {
  return new Set(_DEFAULT_STOPWORDS);
}

/** @deprecated Use getDefaultStopwords() instead - this Set is frozen and will throw on mutation */
export const DEFAULT_STOPWORDS = Object.freeze(_DEFAULT_STOPWORDS);

/**
 * Default single-char token filter. Drops ASCII single letters, keeps digits and CJK.
 * @param {string} t
 * @returns {boolean}
 */
function defaultSingleCharFilter(t) {
  if (t.length !== 1) return false;
  return /^[a-z]$/i.test(t);
}

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

/** @type {WeakMap<object, Intl.Segmenter|undefined>} */
const _segmenterCache = new WeakMap();

/**
 * Get or create a word segmenter. Supports context-based caching to avoid singleton pollution.
 * @param {object} [context] - Optional context object for caching (e.g., AgentContext)
 * @returns {Intl.Segmenter|undefined}
 */
function getWordSegmenter(context) {
  if (context && _segmenterCache.has(context)) {
    return _segmenterCache.get(context);
  }

  let segmenter;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    }
  } catch {
    segmenter = undefined;
  }

  if (context) {
    _segmenterCache.set(context, segmenter);
  }
  return segmenter;
}

/**
 * @deprecated Use singleCharFilter option instead
 */
function shouldDropSingleCharToken(t, filter = defaultSingleCharFilter) {
  return filter(t);
}

function isCjkCodePoint(cp) {
  return (
    // CJK Unified Ideographs + extensions
    (cp >= 0x3400 && cp <= 0x4dbf) || // Extension A
    (cp >= 0x4e00 && cp <= 0x9fff) || // Unified Ideographs
    (cp >= 0xf900 && cp <= 0xfaff) || // Compatibility Ideographs
    (cp >= 0x20000 && cp <= 0x2a6df) || // Extension B
    (cp >= 0x2a700 && cp <= 0x2b73f) || // Extension C
    (cp >= 0x2b740 && cp <= 0x2b81f) || // Extension D
    (cp >= 0x2b820 && cp <= 0x2ceaf) || // Extension E
    (cp >= 0x2ceb0 && cp <= 0x2ebef) || // Extension F
    (cp >= 0x30000 && cp <= 0x3134f) || // Extension G
    (cp >= 0x2f800 && cp <= 0x2fa1f) || // Compatibility Ideographs Supplement
    // Hiragana / Katakana
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x31f0 && cp <= 0x31ff) || // Katakana Phonetic Extensions
    // Hangul
    (cp >= 0xac00 && cp <= 0xd7af)
  );
}

function isAllCjkToken(token) {
  const s = typeof token === "string" ? token : "";
  if (!s) return false;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (!Number.isFinite(cp) || !isCjkCodePoint(cp)) return false;
  }
  return true;
}

function pushCjkBigrams(token, out, { maxBigrams = 64 } = {}) {
  const t = typeof token === "string" ? token : "";
  if (!t) return;

  const chars = Array.from(t);
  if (chars.length <= 2) {
    out.push(t);
    return;
  }

  const total = chars.length - 1;
  const max = typeof maxBigrams === "number" && Number.isFinite(maxBigrams) ? Math.max(1, Math.floor(maxBigrams)) : 64;
  if (total <= max) {
    for (let i = 0; i < total; i++) out.push(chars[i] + chars[i + 1]);
    return;
  }

  const head = Math.max(1, Math.floor(max / 2));
  const tail = Math.max(1, max - head);
  for (let i = 0; i < head; i++) out.push(chars[i] + chars[i + 1]);
  const tailStart = Math.max(head, total - tail);
  for (let i = tailStart; i < total; i++) out.push(chars[i] + chars[i + 1]);
}

/**
 * Normalize stopwords input to a Set or null (disabled).
 * @param {Set<string>|string[]|false|null|undefined} input
 * @returns {Set<string>|null} - null means no stopword filtering
 */
function normalizeStopwords(input) {
  if (input === false) return null;
  if (input instanceof Set) return input;
  if (Array.isArray(input)) return new Set(input.map((x) => String(x ?? "")));
  return DEFAULT_STOPWORDS;
}

/**
 * @typedef {Object} TokenizeOptions
 * @property {Set<string>|null} [stopwords] - Stopwords set, null to disable
 * @property {(t:string)=>boolean} [singleCharFilter] - Filter for single-char tokens
 * @property {number} [maxBigrams] - Max bigrams for CJK tokens
 * @property {object} [context] - Context for segmenter caching
 */

/**
 * Tokenize text with configurable options.
 * @param {string} text
 * @param {Set<string>|null|TokenizeOptions} [optionsOrStopwords=DEFAULT_STOPWORDS]
 * @returns {string[]}
 */
function tokenize(text, optionsOrStopwords = DEFAULT_STOPWORDS) {
  // Normalize options
  let stopwords = DEFAULT_STOPWORDS;
  let singleCharFilter = defaultSingleCharFilter;
  let maxBigrams = 64;
  let context;

  if (optionsOrStopwords === null || optionsOrStopwords === false) {
    stopwords = null;
  } else if (optionsOrStopwords instanceof Set) {
    stopwords = optionsOrStopwords;
  } else if (typeof optionsOrStopwords === "object" && !Array.isArray(optionsOrStopwords)) {
    stopwords = optionsOrStopwords.stopwords !== undefined ? optionsOrStopwords.stopwords : DEFAULT_STOPWORDS;
    if (typeof optionsOrStopwords.singleCharFilter === "function") {
      singleCharFilter = optionsOrStopwords.singleCharFilter;
    }
    if (Number.isFinite(optionsOrStopwords.maxBigrams)) {
      maxBigrams = Math.max(1, Math.floor(optionsOrStopwords.maxBigrams));
    }
    context = optionsOrStopwords.context;
  }

  const s = String(text || "").toLowerCase();
  if (!s) return [];

  const seg = getWordSegmenter(context);
  if (seg && typeof seg.segment === "function") {
    const out = [];
    for (const part of seg.segment(s)) {
      if (part && part.isWordLike === false) continue;
      const t = String(part?.segment || "").trim().toLowerCase();
      if (!t) continue;
      if (stopwords && stopwords.has(t)) continue;
      if (singleCharFilter(t)) continue;
      out.push(t);
    }
    return out;
  }

  const tokens = s.match(WORD_RE) || [];
  const out = [];
  for (const t of tokens) {
    if (!t) continue;
    if (stopwords && stopwords.has(t)) continue;
    if (singleCharFilter(t)) continue;
    if (isAllCjkToken(t)) {
      pushCjkBigrams(t, out, { maxBigrams });
      continue;
    }
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
 * Derive stopwords from an existing index based on document frequency threshold.
 * Terms appearing in more than dfThreshold proportion of documents are considered stopwords.
 *
 * @param {BM25Index} index - The BM25 index to analyze
 * @param {{dfThreshold?:number}} [options] - Options
 * @returns {Set<string>} - Set of derived stopwords
 */
export function deriveStopwords(index, options = {}) {
  if (!isPlainObject(index)) return new Set();
  const nDocs = index.chunkIds ? index.chunkIds.length : 0;
  if (nDocs === 0) return new Set();

  const threshold = Number.isFinite(options?.dfThreshold) ? options.dfThreshold : 0.9;
  const minDf = Math.floor(nDocs * threshold);
  const result = new Set();

  if (index.df instanceof Map) {
    for (const [term, count] of index.df.entries()) {
      if (count >= minDf) result.add(term);
    }
  }

  return result;
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
 * @typedef {Object} BuildIndexOptions
 * @property {number} [k1=1.2]
 * @property {number} [b=0.75]
 * @property {Set<string>|string[]|false} [stopwords] - Custom stopwords, false to disable
 * @property {boolean|{dfThreshold?:number}} [autoStopwords] - Derive stopwords from corpus
 * @property {number} [maxTokensPerDoc]
 * @property {number} [maxUniqueTerms]
 * @property {number} [maxPostingsPerTerm]
 * @property {number} [maxTermLength]
 */

/**
 * @param {Array<{chunkId:string,text:string}>} chunks
 * @param {BuildIndexOptions} [options]
 * @returns {BM25Index}
 */
export function buildIndex(chunks, options = {}) {
  if (!Array.isArray(chunks)) throw new TypeError("buildIndex(chunks): chunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("buildIndex(chunks, options): options must be an object");

  const k1 = Number.isFinite(options.k1) ? options.k1 : 1.2;
  const b = Number.isFinite(options.b) ? options.b : 0.75;
  const limits = normalizeIndexLimits(options);
  const stopwords = normalizeStopwords(options.stopwords);

  const chunkIds = [];
  const docLens = new Array(chunks.length);
  const df = new Map();
  const postings = new Map();

  let totalLen = 0;

  for (let di = 0; di < chunks.length; di++) {
    const c = chunks[di];
    const chunkId = c && c.chunkId ? String(c.chunkId) : `chunk_${di + 1}`;
    chunkIds.push(chunkId);

    let tokens = tokenize(c && c.text, stopwords);
    if (limits.maxTokensPerDoc !== Infinity && tokens.length > limits.maxTokensPerDoc) {
      tokens = tokens.slice(0, limits.maxTokensPerDoc);
    }
    const docLen = tokens.length;
    docLens[di] = docLen;
    totalLen += docLen;

    const tf = new Map();
    for (const t of tokens) {
      if (limits.maxTermLength !== Infinity && t.length > limits.maxTermLength) continue;
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    for (const [term, freq] of tf.entries()) {
      if (!df.has(term) && limits.maxUniqueTerms !== Infinity && df.size >= limits.maxUniqueTerms) continue;
      const list = postings.get(term);
      if (list) {
        if (limits.maxPostingsPerTerm !== Infinity && list.length >= limits.maxPostingsPerTerm) continue;
        list.push([di, freq]);
      } else {
        postings.set(term, [[di, freq]]);
      }
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const avgDocLen = chunks.length ? totalLen / chunks.length : 0;
  let index = { chunkIds, docLens, avgDocLen, df, postings, k1, b };

  // Auto-derive stopwords and rebuild if requested
  if (options.autoStopwords) {
    const threshold =
      typeof options.autoStopwords === "object" && Number.isFinite(options.autoStopwords.dfThreshold)
        ? options.autoStopwords.dfThreshold
        : 0.9;
    const derived = deriveStopwords(index, { dfThreshold: threshold });
    if (derived.size > 0) {
      const merged = stopwords ? new Set([...stopwords, ...derived]) : derived;
      index = buildIndex(chunks, { ...options, stopwords: merged, autoStopwords: false });
    }
  }

  return index;
}

/**
 * Async index builder that can offload CPU work to a WorkerPool when provided.
 *
 * @param {Array<{chunkId:string,text:string}>} chunks
 * @param {BuildIndexOptions & {yieldEveryDocs?:number,signal?:AbortSignal,workerPool?:{buildIndex?:(chunks:any,options?:any)=>Promise<any>}}} [options]
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

  const yieldEveryDocs =
    typeof options.yieldEveryDocs === "number" && Number.isFinite(options.yieldEveryDocs) && options.yieldEveryDocs > 0
      ? Math.floor(options.yieldEveryDocs)
      : 80;
  const signal = options.signal;

  const sleep0 = () => new Promise((resolve) => setTimeout(resolve, 0));

  const k1 = Number.isFinite(options.k1) ? options.k1 : 1.2;
  const b = Number.isFinite(options.b) ? options.b : 0.75;
  const limits = normalizeIndexLimits(options);
  const stopwords = normalizeStopwords(options.stopwords);

  const chunkIds = [];
  const docLens = new Array(chunks.length);
  const df = new Map();
  const postings = new Map();

  let totalLen = 0;

  for (let di = 0; di < chunks.length; di++) {
    if (signal?.aborted) throw new Error("buildIndexAsync: aborted");
    if (yieldEveryDocs > 0 && di > 0 && di % yieldEveryDocs === 0) await sleep0();

    const c = chunks[di];
    const chunkId = c && c.chunkId ? String(c.chunkId) : `chunk_${di + 1}`;
    chunkIds.push(chunkId);

    let tokens = tokenize(c && c.text, stopwords);
    if (limits.maxTokensPerDoc !== Infinity && tokens.length > limits.maxTokensPerDoc) {
      tokens = tokens.slice(0, limits.maxTokensPerDoc);
    }
    const docLen = tokens.length;
    docLens[di] = docLen;
    totalLen += docLen;

    const tf = new Map();
    for (const t of tokens) {
      if (limits.maxTermLength !== Infinity && t.length > limits.maxTermLength) continue;
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    for (const [term, freq] of tf.entries()) {
      if (!df.has(term) && limits.maxUniqueTerms !== Infinity && df.size >= limits.maxUniqueTerms) continue;
      const list = postings.get(term);
      if (list) {
        if (limits.maxPostingsPerTerm !== Infinity && list.length >= limits.maxPostingsPerTerm) continue;
        list.push([di, freq]);
      } else {
        postings.set(term, [[di, freq]]);
      }
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const avgDocLen = chunks.length ? totalLen / chunks.length : 0;
  let index = { chunkIds, docLens, avgDocLen, df, postings, k1, b };

  // Auto-derive stopwords and rebuild if requested
  if (options.autoStopwords) {
    const threshold =
      typeof options.autoStopwords === "object" && Number.isFinite(options.autoStopwords.dfThreshold)
        ? options.autoStopwords.dfThreshold
        : 0.9;
    const derived = deriveStopwords(index, { dfThreshold: threshold });
    if (derived.size > 0) {
      const merged = stopwords ? new Set([...stopwords, ...derived]) : derived;
      index = await buildIndexAsync(chunks, { ...options, stopwords: merged, autoStopwords: false });
    }
  }

  return index;
}

function idf(nDocs, df) {
  // BM25+ style stable idf: log(1 + (N - df + 0.5)/(df + 0.5))
  return Math.log(1 + (nDocs - df + 0.5) / (df + 0.5));
}

/**
 * @param {BM25Index} index
 * @param {string} query
 * @param {number} topK
 * @param {{filterDocIndex?:(di:number)=>boolean,stopwords?:Set<string>|string[]|false}} [options]
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
  const stopwords = normalizeStopwords(options.stopwords);
  const qTerms = uniq(tokenize(query, stopwords));
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

function safeNumber(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x ?? "")).filter(Boolean);
}

/**
 * Serialize a BM25 index into a JSON-friendly snapshot (no Maps).
 * Intended for browser persistence (IndexedDB/RunStore/localStorage).
 *
 * @param {BM25Index} index
 * @returns {object}
 */
export function serializeIndex(index) {
  if (!isPlainObject(index)) throw new TypeError("serializeIndex(index): index must be an object");

  return {
    schemaVersion: "0.1",
    chunkIds: normalizeStringArray(index.chunkIds),
    docLens: Array.isArray(index.docLens) ? index.docLens.map((n) => safeNumber(n, 0)) : [],
    avgDocLen: safeNumber(index.avgDocLen, 0),
    df: index.df instanceof Map ? Array.from(index.df.entries()) : Array.isArray(index.df) ? index.df : [],
    postings:
      index.postings instanceof Map ? Array.from(index.postings.entries()) : Array.isArray(index.postings) ? index.postings : [],
    k1: safeNumber(index.k1, 1.2),
    b: safeNumber(index.b, 0.75),
  };
}

/**
 * Restore a BM25 index from a snapshot created by serializeIndex().
 *
 * @param {object} snapshot
 * @returns {BM25Index}
 */
export function deserializeIndex(snapshot) {
  const s = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!s) throw new TypeError("deserializeIndex(snapshot): snapshot must be an object");

  const chunkIds = normalizeStringArray(s.chunkIds);
  const docLens = Array.isArray(s.docLens) ? s.docLens.map((n) => safeNumber(n, 0)) : [];
  const avgDocLen = safeNumber(s.avgDocLen, chunkIds.length ? docLens.reduce((a, b) => a + b, 0) / chunkIds.length : 0);

  const df = new Map();
  const dfEntries = Array.isArray(s.df) ? s.df : [];
  for (const entry of dfEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const term = String(entry[0] ?? "");
    if (!term) continue;
    df.set(term, safeNumber(entry[1], 0));
  }

  const postings = new Map();
  const postingsEntries = Array.isArray(s.postings) ? s.postings : [];
  for (const entry of postingsEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const term = String(entry[0] ?? "");
    if (!term) continue;
    const list = Array.isArray(entry[1]) ? entry[1] : [];
    postings.set(
      term,
      list
        .map((pair) => (Array.isArray(pair) && pair.length >= 2 ? [safeNumber(pair[0], 0), safeNumber(pair[1], 0)] : null))
        .filter(Boolean)
    );
  }

  return {
    chunkIds,
    docLens,
    avgDocLen,
    df,
    postings,
    k1: safeNumber(s.k1, 1.2),
    b: safeNumber(s.b, 0.75),
  };
}
