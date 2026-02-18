import { isPlainObject, toNonEmptyString, toPositiveInt } from "../shared/index.js";
import { VectorIndex } from "../shared/index.js";

function resolveVectorIndex(indexLike) {
  // Accept either a raw VectorIndex-like object or a { vectorIndex } wrapper.
  const direct = indexLike && typeof indexLike === "object" ? indexLike : null;
  if (direct && typeof direct.search === "function" && typeof direct.upsert === "function") return direct;
  const wrapped = isPlainObject(indexLike) ? indexLike.vectorIndex : null;
  if (wrapped && typeof wrapped === "object" && typeof wrapped.search === "function" && typeof wrapped.upsert === "function") return wrapped;
  return null;
}

function normalizeTopK(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeEmbeddingService(value) {
  const svc = value && typeof value === "object" ? value : null;
  return svc && typeof svc.embed === "function" ? svc : null;
}

function normalizeChunkId(chunk, idx) {
  const cid = toNonEmptyString(chunk?.chunkId);
  return cid || `chunk_${idx + 1}`;
}

function normalizeRate(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

function reportUpsertFailure(error, meta, options) {
  const onUpsertError = typeof options?.onUpsertError === "function" ? options.onUpsertError : null;
  const logger = options?.logger && typeof options.logger.warn === "function" ? options.logger : null;
  try {
    onUpsertError?.(error, meta);
  } catch {
    // ignore observer failure
  }
  try {
    logger?.warn?.("[vector-search] upsert failed", {
      chunkId: meta?.chunkId,
      index: meta?.index,
      error: error?.message || String(error),
    });
  } catch {
    // ignore logger failure
  }
}

function enforceUpsertThreshold({ mode, attempted, failed }, options) {
  const failOnUpsertError = options?.failOnUpsertError === true;
  if (failOnUpsertError && failed > 0) {
    const err = new Error(`${mode}: failed to upsert ${failed}/${attempted} vectors`);
    err.code = "ERR_VECTOR_UPSERT_FAILED";
    err.failedUpserts = failed;
    err.attemptedUpserts = attempted;
    throw err;
  }

  const minSuccessRate = normalizeRate(options?.minSuccessRate);
  if (minSuccessRate === null || attempted <= 0) return;
  const successRate = (attempted - failed) / attempted;
  if (successRate < minSuccessRate) {
    const err = new Error(`${mode}: upsert success rate ${successRate.toFixed(4)} below threshold ${minSuccessRate}`);
    err.code = "ERR_VECTOR_UPSERT_RATE_LOW";
    err.successRate = successRate;
    err.minSuccessRate = minSuccessRate;
    err.failedUpserts = failed;
    err.attemptedUpserts = attempted;
    throw err;
  }
}

/**
 * @typedef {object} VectorSearchIndex
 * @property {string[]} chunkIds
 * @property {any} vectorIndex - VectorIndex-like (has upsert/search)
 */

/**
 * Build a vector index from precomputed embeddings.
 *
 * @param {Array<{chunkId?:string,text?:string,embedding?:any}>} chunks
 * @param {object=} options
 * @param {any=} options.vectorIndex - Existing VectorIndex-like instance (test injection)
 * @param {number=} options.maxItems - Used when creating a new VectorIndex
 * @param {(chunk:any, idx:number)=>any=} options.getEmbedding - Used when chunks don't carry `.embedding`
 * @returns {VectorSearchIndex}
 */
export function buildIndex(chunks, options = {}) {
  if (!Array.isArray(chunks)) throw new TypeError("buildIndex(chunks): chunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("buildIndex(chunks, options): options must be an object");

  const chunkIds = new Array(chunks.length);
  const maxItems = toPositiveInt(options.maxItems, 1000);

  const injected = resolveVectorIndex(options.vectorIndex);
  const vectorIndex = injected || new VectorIndex({ maxItems });
  const getEmbedding = typeof options.getEmbedding === "function" ? options.getEmbedding : (c) => c?.embedding;

  let attemptedUpserts = 0;
  let failedUpserts = 0;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const chunkId = normalizeChunkId(c, i);
    chunkIds[i] = chunkId;

    const emb = getEmbedding(c, i);
    if (!emb) continue;
    attemptedUpserts += 1;
    try {
      vectorIndex.upsert(chunkId, emb, { chunkId, docIndex: i });
    } catch (error) {
      failedUpserts += 1;
      reportUpsertFailure(error, { chunkId, index: i, phase: "buildIndex" }, options);
    }
  }

  enforceUpsertThreshold({ mode: "buildIndex", attempted: attemptedUpserts, failed: failedUpserts }, options);

  return {
    chunkIds,
    vectorIndex,
    stats: {
      attemptedUpserts,
      successfulUpserts: attemptedUpserts - failedUpserts,
      failedUpserts,
    },
  };
}

/**
 * Build a vector index by embedding chunk texts with an embedding service.
 *
 * @param {Array<{chunkId?:string,text?:string}>} chunks
 * @param {object=} options
 * @param {{ embed: (texts:string[], opts?:any)=>Promise<any[]> }=} options.embeddingService
 * @param {any=} options.vectorIndex - Existing VectorIndex-like instance (test injection)
 * @param {number=} options.maxItems
 * @param {AbortSignal=} options.signal
 * @param {number=} options.timeoutMs
 * @returns {Promise<VectorSearchIndex>}
 */
export async function buildIndexAsync(chunks, options = {}) {
  if (!Array.isArray(chunks)) throw new TypeError("buildIndexAsync(chunks): chunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("buildIndexAsync(chunks, options): options must be an object");

  const svc = normalizeEmbeddingService(options.embeddingService);
  if (!svc) throw new TypeError("buildIndexAsync(chunks, options): embeddingService must provide embed()");

  const chunkIds = new Array(chunks.length);
  const maxItems = toPositiveInt(options.maxItems, 1000);
  const injected = resolveVectorIndex(options.vectorIndex);
  const vectorIndex = injected || new VectorIndex({ maxItems });

  const texts = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    chunkIds[i] = normalizeChunkId(c, i);
    texts[i] = String(c?.text ?? "");
  }

  const vectors = await svc.embed(texts, { ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(options.signal ? { signal: options.signal } : {}) });
  const arr = Array.isArray(vectors) ? vectors : [];

  let attemptedUpserts = 0;
  let failedUpserts = 0;
  for (let i = 0; i < chunkIds.length; i++) {
    const v = arr[i];
    if (!v) continue;
    attemptedUpserts += 1;
    try {
      vectorIndex.upsert(chunkIds[i], v, { chunkId: chunkIds[i], docIndex: i });
    } catch (error) {
      failedUpserts += 1;
      reportUpsertFailure(error, { chunkId: chunkIds[i], index: i, phase: "buildIndexAsync" }, options);
    }
  }

  enforceUpsertThreshold({ mode: "buildIndexAsync", attempted: attemptedUpserts, failed: failedUpserts }, options);

  return {
    chunkIds,
    vectorIndex,
    stats: {
      attemptedUpserts,
      successfulUpserts: attemptedUpserts - failedUpserts,
      failedUpserts,
    },
  };
}

/**
 * Search a vector index with a query embedding vector.
 *
 * @param {VectorSearchIndex|any} indexLike
 * @param {any} queryVector
 * @param {number=} topK
 * @param {object=} options
 * @param {(chunkId:string)=>boolean=} options.filterChunkId
 * @param {number=} options.minScore
 * @param {string|string[]=} options.partitions
 * @returns {Array<{chunkId:string,score:number}>}
 */
export function search(indexLike, queryVector, topK = 8, options = {}) {
  const idx = resolveVectorIndex(indexLike);
  if (!idx) throw new TypeError("search(index, queryVector, topK): index must be a VectorIndex-like object");
  if (!isPlainObject(options)) throw new TypeError("search(index, queryVector, topK, options): options must be an object");

  const k = normalizeTopK(topK, 8);
  if (k !== Infinity && k <= 0) return [];

  const filterChunkId = typeof options.filterChunkId === "function" ? options.filterChunkId : null;
  const hits = idx.search(queryVector, {
    topK: k === Infinity ? idx.size : k,
    ...(typeof options.minScore === "number" && Number.isFinite(options.minScore) ? { minScore: options.minScore } : {}),
    ...(options.partitions !== undefined ? { partitions: options.partitions } : {}),
    ...(filterChunkId ? { filter: (_meta, id) => filterChunkId(String(id)) } : {}),
  });

  return (Array.isArray(hits) ? hits : [])
    .map((h) => (h && h.id ? { chunkId: String(h.id), score: Number(h.score || 0) } : null))
    .filter(Boolean);
}

/**
 * Search a vector index by embedding the query text first.
 *
 * @param {VectorSearchIndex|any} indexLike
 * @param {string} query
 * @param {number=} topK
 * @param {object=} options
 * @param {{ embed: (texts:string[], opts?:any)=>Promise<any[]> }=} options.embeddingService
 * @param {AbortSignal=} options.signal
 * @param {number=} options.timeoutMs
 * @returns {Promise<Array<{chunkId:string,score:number}>>}
 */
export async function searchAsync(indexLike, query, topK = 8, options = {}) {
  const idx = resolveVectorIndex(indexLike);
  if (!idx) throw new TypeError("searchAsync(index, query, topK): index must be a VectorIndex-like object");
  if (typeof query !== "string") throw new TypeError("searchAsync(index, query, topK): query must be a string");
  if (!isPlainObject(options)) throw new TypeError("searchAsync(index, query, topK, options): options must be an object");

  const svc = normalizeEmbeddingService(options.embeddingService);
  if (!svc) return [];

  const q = query.trim();
  if (!q) return [];

  const vectors = await svc.embed([q], { ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(options.signal ? { signal: options.signal } : {}) });
  const v = Array.isArray(vectors) ? vectors[0] : null;
  if (!v) return [];

  return search(idx, v, topK, options);
}

export default {
  buildIndex,
  buildIndexAsync,
  search,
  searchAsync,
};
