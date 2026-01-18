import { isPlainObject, toNonEmptyString, toPositiveInt } from "../utils/value-utils.js";

// Partition configuration for time-based bucketing
const PARTITION_CONFIG = Object.freeze({
  HOT_MS: 60 * 60 * 1000,        // Last 1 hour
  WARM_MS: 24 * 60 * 60 * 1000,  // Last 24 hours
});

function classifyPartition(ts, now) {
  if (!Number.isFinite(ts) || !Number.isFinite(now)) return "cold";
  const age = now - ts;
  if (age < PARTITION_CONFIG.HOT_MS) return "hot";
  if (age < PARTITION_CONFIG.WARM_MS) return "warm";
  return "cold";
}

function toFloat32Array(vector) {
  if (!vector) return null;
  if (vector instanceof Float32Array) return vector;
  if (ArrayBuffer.isView(vector)) {
    try {
      return new Float32Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
    } catch {
      return null;
    }
  }
  if (vector instanceof ArrayBuffer) {
    try {
      return new Float32Array(vector);
    } catch {
      return null;
    }
  }
  if (Array.isArray(vector)) {
    const out = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) out[i] = Number(vector[i] || 0);
    return out;
  }
  return null;
}

function normalizeToUnit(vec) {
  const v = toFloat32Array(vec);
  if (!v || v.length === 0) return null;
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) return null;
    sumSq += x * x;
  }
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm <= 0) return null;
  const out = new Float32Array(v.length);
  const inv = 1 / norm;
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

function dot(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Brute-force cosine similarity index (stores normalized vectors).
 *
 * Intended for small collections (<~5000), e.g., runtime memory.
 */
export class VectorIndex {
  /**
   * Create a new VectorIndex.
   * @param {{ maxItems?: number }} [options] - Configuration options.
   */
  constructor(options = {}) {
    const cfg = isPlainObject(options) ? options : {};
    this._maxItems = toPositiveInt(cfg.maxItems, 1000);
    this._dim = null;
    this._rows = new Map(); // id -> { vec: Float32Array, meta?: any }
  }

  get dimension() {
    return this._dim;
  }

  get size() {
    return this._rows.size;
  }

  /**
   * Check if a vector exists in the index.
   * @param {string} id - Vector identifier.
   * @returns {boolean} True if the vector exists.
   */
  has(id) {
    const key = toNonEmptyString(id);
    if (!key) return false;
    return this._rows.has(key);
  }

  /**
   * Clear all vectors from the index.
   * @returns {void}
   */
  clear() {
    this._rows.clear();
    this._dim = null;
  }

  /**
   * Delete a vector from the index.
   * @param {string} id - Vector identifier.
   * @returns {boolean} True if the vector was deleted.
   */
  delete(id) {
    const key = toNonEmptyString(id);
    if (!key) return false;
    return this._rows.delete(key);
  }

  /**
   * Insert or update a vector in the index.
   * @param {string} id - Vector identifier.
   * @param {Float32Array|number[]|ArrayBufferView} vector - The vector to store.
   * @param {*} [meta] - Optional metadata to associate with the vector.
   * @returns {boolean} True if the operation succeeded.
   */
  upsert(id, vector, meta) {
    const key = toNonEmptyString(id);
    if (!key) return false;

    const normalized = normalizeToUnit(vector);
    if (!normalized) return false;

    if (this._dim === null) this._dim = normalized.length;
    if (this._dim !== normalized.length) {
      throw new Error(`VectorIndex dimension mismatch: expected ${this._dim}, got ${normalized.length}`);
    }

    // LRU-ish behavior: refresh insertion order on overwrite.
    if (this._rows.has(key)) this._rows.delete(key);
    this._rows.set(key, { vec: normalized, meta });

    while (this._rows.size > this._maxItems) {
      const oldest = this._rows.keys().next().value;
      if (oldest === undefined) break;
      this._rows.delete(oldest);
    }

    return true;
  }

  /**
   * @param {Float32Array|number[]|ArrayBufferView} queryVector
   * @param {{ topK?: number, filter?: (meta:any, id:string)=>boolean, minScore?: number, partitions?: string|string[] }} [options]
   * @returns {Array<{id:string,score:number,meta:any}>}
   */
  search(queryVector, { topK = 5, filter, minScore, partitions } = {}) {
    const k = toPositiveInt(topK, 5);
    if (k <= 0) return [];
    if (this._rows.size === 0) return [];

    const q = normalizeToUnit(queryVector);
    if (!q) return [];
    if (this._dim !== null && q.length !== this._dim) return [];

    const min = typeof minScore === "number" && Number.isFinite(minScore) ? minScore : -Infinity;
    const predicate = typeof filter === "function" ? filter : null;

    // Partition filtering: normalize to Set for O(1) lookup
    const partitionSet = (() => {
      if (partitions === null || partitions === undefined) return null;
      if (typeof partitions === "string") return new Set([partitions]);
      if (Array.isArray(partitions)) return new Set(partitions.filter((p) => typeof p === "string"));
      return null;
    })();
    const now = Date.now();

    const top = [];
    const maybePush = (row) => {
      top.push(row);
      top.sort((a, b) => b.score - a.score);
      if (top.length > k) top.length = k;
    };

    for (const [id, row] of this._rows.entries()) {
      // Partition filter (skip vectors outside requested partitions)
      if (partitionSet !== null) {
        const ts = row.meta?.ts;
        const partition = classifyPartition(ts, now);
        if (!partitionSet.has(partition)) continue;
      }

      if (predicate && !predicate(row.meta, id)) continue;
      const score = dot(q, row.vec);
      if (!Number.isFinite(score) || score < min) continue;
      maybePush({ id, score, meta: row.meta });
    }

    return top;
  }

  /**
   * Get partition statistics for the index.
   * @returns {{hot:number, warm:number, cold:number, total:number}}
   */
  getPartitionStats() {
    const now = Date.now();
    const stats = { hot: 0, warm: 0, cold: 0, total: this._rows.size };
    for (const row of this._rows.values()) {
      const ts = row.meta?.ts;
      const partition = classifyPartition(ts, now);
      stats[partition]++;
    }
    return stats;
  }
}

export default { VectorIndex };
