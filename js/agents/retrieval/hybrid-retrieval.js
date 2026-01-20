import { isPlainObject, toNonEmptyString, toPositiveInt } from "../shared/index.js";
import { search as bm25Search } from "./bm25.js";
import { searchAsync as vectorSearchAsync } from "./vector-search.js";

function safeFiniteNumber(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeWeight(v, fallback) {
  const n = safeFiniteNumber(v, fallback);
  return n >= 0 ? n : fallback;
}

function normalizeLimit(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Fuse two ranked lists with Reciprocal Rank Fusion (RRF).
 *
 * RRF formula: score(d) = Σ w_i / (k + rank_i(d))
 *
 * @param {Array<{chunkId:string,score?:number}>} bm25Results
 * @param {Array<{chunkId:string,score?:number}>} vectorResults
 * @param {object=} options
 * @param {number=} options.limit
 * @param {number=} options.rrfK
 * @param {number=} options.bm25Weight
 * @param {number=} options.vectorWeight
 * @returns {Array<{chunkId:string,rrfScore:number,bm25Score?:number,vectorScore?:number}>}
 */
export function rrfFuse(bm25Results = [], vectorResults = [], options = {}) {
  if (!Array.isArray(bm25Results)) throw new TypeError("rrfFuse(bm25Results, vectorResults): bm25Results must be an array");
  if (!Array.isArray(vectorResults)) throw new TypeError("rrfFuse(bm25Results, vectorResults): vectorResults must be an array");
  if (!isPlainObject(options)) throw new TypeError("rrfFuse(bm25Results, vectorResults, options): options must be an object");

  const limit = normalizeLimit(options.limit, 8);
  const rrfK = toPositiveInt(options.rrfK, 60);
  const bm25Weight = normalizeWeight(options.bm25Weight, 1.0);
  const vectorWeight = normalizeWeight(options.vectorWeight, 1.0);

  /** @type {Map<string, {rrfScore:number,bm25Score?:number,vectorScore?:number}>} */
  const rows = new Map();

  for (let i = 0; i < bm25Results.length; i++) {
    const row = bm25Results[i];
    const id = toNonEmptyString(row?.chunkId);
    if (!id) continue;
    const rank = i + 1;
    const contrib = bm25Weight / (rrfK + rank);
    const existing = rows.get(id) || { rrfScore: 0 };
    rows.set(id, {
      ...existing,
      rrfScore: existing.rrfScore + contrib,
      ...(typeof row?.score === "number" && Number.isFinite(row.score) ? { bm25Score: Math.max(existing.bm25Score || 0, row.score) } : {}),
    });
  }

  for (let i = 0; i < vectorResults.length; i++) {
    const row = vectorResults[i];
    const id = toNonEmptyString(row?.chunkId);
    if (!id) continue;
    const rank = i + 1;
    const contrib = vectorWeight / (rrfK + rank);
    const existing = rows.get(id) || { rrfScore: 0 };
    rows.set(id, {
      ...existing,
      rrfScore: existing.rrfScore + contrib,
      ...(typeof row?.score === "number" && Number.isFinite(row.score) ? { vectorScore: Math.max(existing.vectorScore || 0, row.score) } : {}),
    });
  }

  const out = Array.from(rows.entries())
    .map(([chunkId, data]) => ({ chunkId, ...data }))
    .sort((a, b) => (b.rrfScore === a.rrfScore ? (a.chunkId < b.chunkId ? -1 : 1) : b.rrfScore - a.rrfScore));

  if (limit === Infinity) return out;
  return out.slice(0, limit);
}

/**
 * Hybrid retrieval: BM25 + Vector -> RRF fusion.
 *
 * @param {{ bm25Index?: any, vectorIndex?: any }} indexes
 * @param {string} query
 * @param {object=} options
 * @param {number=} options.limit
 * @param {number=} options.rrfK
 * @param {number=} options.bm25Weight
 * @param {number=} options.vectorWeight
 * @param {boolean=} options.fallback - If a retriever throws, keep the other side (default true)
 * @param {{ embed: (texts:string[], opts?:any)=>Promise<any[]> }=} options.embeddingService
 * @param {Function=} options.bm25SearchFn - Test injection
 * @param {Function=} options.vectorSearchFn - Test injection (defaults to vectorSearchAsync)
 * @returns {Promise<Array<{chunkId:string,rrfScore:number,bm25Score?:number,vectorScore?:number}>>}
 */
export async function hybridSearch(indexes, query, options = {}) {
  if (!isPlainObject(indexes)) throw new TypeError("hybridSearch(indexes, query, options): indexes must be an object");
  if (typeof query !== "string") throw new TypeError("hybridSearch(indexes, query, options): query must be a string");
  if (!isPlainObject(options)) throw new TypeError("hybridSearch(indexes, query, options): options must be an object");

  const q = query.trim();
  if (!q) return [];

  const limit = normalizeLimit(options.limit, 8);
  const fetchK = limit === Infinity ? Infinity : Math.max(limit * 2, 10);
  const fallback = options.fallback === undefined ? true : !!options.fallback;
  const logger =
    options.logger && typeof options.logger.warn === "function"
      ? options.logger
      : typeof console !== "undefined" && typeof console.warn === "function"
        ? console
        : null;

  const bm25Fn = typeof options.bm25SearchFn === "function" ? options.bm25SearchFn : bm25Search;
  const vectorFn = typeof options.vectorSearchFn === "function" ? options.vectorSearchFn : vectorSearchAsync;

  /** @type {Array<{chunkId:string,score?:number}>} */
  let bm25Results = [];
  if (indexes.bm25Index) {
    try {
      bm25Results = bm25Fn(indexes.bm25Index, q, fetchK === Infinity ? 10_000 : fetchK, isPlainObject(options.bm25Options) ? options.bm25Options : {});
      if (!Array.isArray(bm25Results)) bm25Results = [];
    } catch (err) {
      logger?.warn?.("hybridSearch: bm25 failed", { error: err?.message || String(err) });
      if (!fallback) throw new Error("hybridSearch: bm25 failed");
    }
  }

  /** @type {Array<{chunkId:string,score?:number}>} */
  let vectorResults = [];
  if (indexes.vectorIndex) {
    try {
      vectorResults = await vectorFn(indexes.vectorIndex, q, fetchK === Infinity ? 10_000 : fetchK, {
        ...(isPlainObject(options.vectorOptions) ? options.vectorOptions : {}),
        ...(options.embeddingService ? { embeddingService: options.embeddingService } : {}),
      });
      if (!Array.isArray(vectorResults)) vectorResults = [];
    } catch (err) {
      logger?.warn?.("hybridSearch: vector search failed", { error: err?.message || String(err) });
      if (!fallback) throw new Error("hybridSearch: vector search failed");
    }
  }

  if (!bm25Results.length && !vectorResults.length) return [];

  return rrfFuse(bm25Results, vectorResults, {
    limit,
    rrfK: options.rrfK,
    bm25Weight: options.bm25Weight,
    vectorWeight: options.vectorWeight,
  });
}

export default {
  rrfFuse,
  hybridSearch,
};
