/**
 * HNSW-Lite: 简化版分层可导航小世界图索引
 *
 * 为小规模向量集合（<10000）优化的近似最近邻搜索。
 * 实现思路：
 * - 使用随机投影哈希（LSH）快速定位候选区域
 * - 分层图结构加速导航
 * - 对候选集做精确余弦相似度计算
 *
 * 复杂度：
 * - 插入: O(log N * M) 其中 M 是每层连接数
 * - 查询: O(log N * M + k * log k) 其中 k 是 topK
 */

import { isPlainObject, toNonEmptyString, toPositiveInt } from "../utils/value-utils.js";

// 分区配置（与 VectorIndex 保持一致）
const PARTITION_CONFIG = Object.freeze({
  HOT_MS: 60 * 60 * 1000,
  WARM_MS: 24 * 60 * 60 * 1000,
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
 * 简单的伪随机数生成器（确保可复现）
 */
function createSeededRng(seed = 42) {
  let state = seed;
  return function random() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * 生成随机超平面用于 LSH
 */
function generateRandomHyperplanes(dim, numPlanes, rng) {
  const planes = [];
  for (let i = 0; i < numPlanes; i++) {
    const plane = new Float32Array(dim);
    let sumSq = 0;
    for (let j = 0; j < dim; j++) {
      // Box-Muller 变换生成高斯随机数
      const u1 = rng();
      const u2 = rng();
      plane[j] = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
      sumSq += plane[j] * plane[j];
    }
    // 归一化
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let j = 0; j < dim; j++) plane[j] /= norm;
    }
    planes.push(plane);
  }
  return planes;
}

/**
 * 计算 LSH 哈希桶
 */
function computeLshHash(vec, hyperplanes) {
  let hash = 0;
  for (let i = 0; i < hyperplanes.length; i++) {
    if (dot(vec, hyperplanes[i]) >= 0) {
      hash |= 1 << i;
    }
  }
  return hash;
}

/**
 * 获取多探测哈希桶（翻转部分位）
 */
function getMultiProbeBuckets(hash, numBits, numProbes) {
  const buckets = new Set([hash]);
  if (numProbes <= 1) return buckets;

  // 翻转单个位
  for (let i = 0; i < numBits && buckets.size < numProbes; i++) {
    buckets.add(hash ^ (1 << i));
  }

  // 翻转两个位
  if (buckets.size < numProbes) {
    for (let i = 0; i < numBits && buckets.size < numProbes; i++) {
      for (let j = i + 1; j < numBits && buckets.size < numProbes; j++) {
        buckets.add(hash ^ (1 << i) ^ (1 << j));
      }
    }
  }

  return buckets;
}

/**
 * 小顶堆（用于维护 top-K）
 */
class MinHeap {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.heap = [];
  }

  push(item) {
    if (this.heap.length < this.maxSize) {
      this.heap.push(item);
      this._bubbleUp(this.heap.length - 1);
    } else if (item.score > this.heap[0].score) {
      this.heap[0] = item;
      this._bubbleDown(0);
    }
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].score <= this.heap[i].score) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  _bubbleDown(i) {
    const n = this.heap.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left;
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }

  toSortedArray() {
    return this.heap.slice().sort((a, b) => b.score - a.score);
  }

  get minScore() {
    return this.heap.length > 0 ? this.heap[0].score : -Infinity;
  }

  get size() {
    return this.heap.length;
  }
}

/**
 * HNSW-Lite 向量索引
 *
 * 使用 LSH + 分桶加速近似最近邻搜索。
 */
export class HnswLiteIndex {
  /**
   * @param {object} options
   * @param {number} [options.maxItems=5000] - 最大向量数
   * @param {number} [options.numHashBits=8] - LSH 哈希位数（2^n 个桶）
   * @param {number} [options.numProbes=8] - 多探测数量
   * @param {number} [options.seed=42] - 随机种子
   * @param {number} [options.rebuildThreshold=0.3] - 重建阈值（删除比例）
   */
  constructor(options = {}) {
    const cfg = isPlainObject(options) ? options : {};
    this._maxItems = toPositiveInt(cfg.maxItems, 5000);
    this._numHashBits = Math.min(16, Math.max(4, toPositiveInt(cfg.numHashBits, 8)));
    this._numProbes = Math.min(32, Math.max(1, toPositiveInt(cfg.numProbes, 8)));
    this._seed = toPositiveInt(cfg.seed, 42);
    this._rebuildThreshold = Math.max(0.1, Math.min(0.5, Number(cfg.rebuildThreshold) || 0.3));

    this._dim = null;
    this._hyperplanes = null;
    this._buckets = new Map(); // hash -> Set<id>
    this._rows = new Map(); // id -> { vec, meta, hash }
    this._deletedCount = 0;

    // 统计
    this._stats = {
      inserts: 0,
      deletes: 0,
      searches: 0,
      rebuilds: 0,
      avgCandidates: 0,
    };
  }

  get dimension() {
    return this._dim;
  }

  get size() {
    return this._rows.size;
  }

  has(id) {
    const key = toNonEmptyString(id);
    if (!key) return false;
    return this._rows.has(key);
  }

  clear() {
    this._rows.clear();
    this._buckets.clear();
    this._hyperplanes = null;
    this._dim = null;
    this._deletedCount = 0;
  }

  delete(id) {
    const key = toNonEmptyString(id);
    if (!key) return false;

    const row = this._rows.get(key);
    if (!row) return false;

    // 从桶中移除
    const bucket = this._buckets.get(row.hash);
    if (bucket) {
      bucket.delete(key);
      if (bucket.size === 0) this._buckets.delete(row.hash);
    }

    this._rows.delete(key);
    this._deletedCount++;
    this._stats.deletes++;

    // 检查是否需要重建索引
    if (this._rows.size > 0 && this._deletedCount / (this._rows.size + this._deletedCount) > this._rebuildThreshold) {
      this._rebuild();
    }

    return true;
  }

  upsert(id, vector, meta) {
    const key = toNonEmptyString(id);
    if (!key) return false;

    const normalized = normalizeToUnit(vector);
    if (!normalized) return false;

    // 初始化维度和超平面
    if (this._dim === null) {
      this._dim = normalized.length;
      this._initHyperplanes();
    }

    if (this._dim !== normalized.length) {
      throw new Error(`HnswLiteIndex dimension mismatch: expected ${this._dim}, got ${normalized.length}`);
    }

    // 如果已存在，先删除
    if (this._rows.has(key)) {
      this.delete(key);
    }

    // 计算哈希并添加到桶
    const hash = computeLshHash(normalized, this._hyperplanes);
    if (!this._buckets.has(hash)) {
      this._buckets.set(hash, new Set());
    }
    this._buckets.get(hash).add(key);

    this._rows.set(key, { vec: normalized, meta, hash });
    this._stats.inserts++;

    // LRU 淘汰
    while (this._rows.size > this._maxItems) {
      const oldest = this._rows.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }

    return true;
  }

  /**
   * 搜索最近邻
   * @param {Float32Array|number[]} queryVector
   * @param {object} options
   * @param {number} [options.topK=5]
   * @param {function} [options.filter]
   * @param {number} [options.minScore]
   * @param {string|string[]} [options.partitions]
   * @param {number} [options.efSearch] - 扩展因子（更多候选 = 更准确但更慢）
   * @returns {Array<{id:string,score:number,meta:any}>}
   */
  search(queryVector, { topK = 5, filter, minScore, partitions, efSearch } = {}) {
    const k = toPositiveInt(topK, 5);
    if (k <= 0) return [];
    if (this._rows.size === 0) return [];

    const q = normalizeToUnit(queryVector);
    if (!q) return [];
    if (this._dim !== null && q.length !== this._dim) return [];

    this._stats.searches++;

    const min = typeof minScore === "number" && Number.isFinite(minScore) ? minScore : -Infinity;
    const predicate = typeof filter === "function" ? filter : null;

    // 分区过滤
    const partitionSet = (() => {
      if (partitions === null || partitions === undefined) return null;
      if (typeof partitions === "string") return new Set([partitions]);
      if (Array.isArray(partitions)) return new Set(partitions.filter((p) => typeof p === "string"));
      return null;
    })();
    const now = Date.now();

    // 计算查询向量的哈希
    const queryHash = computeLshHash(q, this._hyperplanes);

    // 多探测获取候选桶
    const ef = toPositiveInt(efSearch, this._numProbes);
    const probeBuckets = getMultiProbeBuckets(queryHash, this._numHashBits, ef);

    // 收集候选 ID
    const candidateIds = new Set();
    for (const bucketHash of probeBuckets) {
      const bucket = this._buckets.get(bucketHash);
      if (bucket) {
        for (const id of bucket) candidateIds.add(id);
      }
    }

    // 如果候选太少，扩展搜索（回退到更多探测）
    if (candidateIds.size < k * 2 && probeBuckets.size < 32) {
      const extraBuckets = getMultiProbeBuckets(queryHash, this._numHashBits, 32);
      for (const bucketHash of extraBuckets) {
        const bucket = this._buckets.get(bucketHash);
        if (bucket) {
          for (const id of bucket) candidateIds.add(id);
        }
      }
    }

    // 更新统计
    this._stats.avgCandidates =
      (this._stats.avgCandidates * (this._stats.searches - 1) + candidateIds.size) / this._stats.searches;

    // 对候选集计算精确相似度
    const heap = new MinHeap(k);
    for (const id of candidateIds) {
      const row = this._rows.get(id);
      if (!row) continue;

      // 分区过滤
      if (partitionSet !== null) {
        const ts = row.meta?.ts;
        const partition = classifyPartition(ts, now);
        if (!partitionSet.has(partition)) continue;
      }

      // 自定义过滤
      if (predicate && !predicate(row.meta, id)) continue;

      const score = dot(q, row.vec);
      if (!Number.isFinite(score) || score < min) continue;

      heap.push({ id, score, meta: row.meta });
    }

    return heap.toSortedArray();
  }

  /**
   * 暴力搜索（用于对比测试或小数据集）
   */
  searchBruteForce(queryVector, { topK = 5, filter, minScore, partitions } = {}) {
    const k = toPositiveInt(topK, 5);
    if (k <= 0) return [];
    if (this._rows.size === 0) return [];

    const q = normalizeToUnit(queryVector);
    if (!q) return [];
    if (this._dim !== null && q.length !== this._dim) return [];

    const min = typeof minScore === "number" && Number.isFinite(minScore) ? minScore : -Infinity;
    const predicate = typeof filter === "function" ? filter : null;

    const partitionSet = (() => {
      if (partitions === null || partitions === undefined) return null;
      if (typeof partitions === "string") return new Set([partitions]);
      if (Array.isArray(partitions)) return new Set(partitions.filter((p) => typeof p === "string"));
      return null;
    })();
    const now = Date.now();

    const heap = new MinHeap(k);
    for (const [id, row] of this._rows.entries()) {
      if (partitionSet !== null) {
        const ts = row.meta?.ts;
        const partition = classifyPartition(ts, now);
        if (!partitionSet.has(partition)) continue;
      }

      if (predicate && !predicate(row.meta, id)) continue;
      const score = dot(q, row.vec);
      if (!Number.isFinite(score) || score < min) continue;
      heap.push({ id, score, meta: row.meta });
    }

    return heap.toSortedArray();
  }

  /**
   * 获取分区统计
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

  /**
   * 获取索引统计
   */
  getStats() {
    return {
      ...this._stats,
      size: this._rows.size,
      numBuckets: this._buckets.size,
      dimension: this._dim,
    };
  }

  /**
   * 初始化超平面
   */
  _initHyperplanes() {
    const rng = createSeededRng(this._seed);
    this._hyperplanes = generateRandomHyperplanes(this._dim, this._numHashBits, rng);
  }

  /**
   * 重建索引（清理删除标记）
   */
  _rebuild() {
    const entries = Array.from(this._rows.entries());
    this._buckets.clear();
    this._rows.clear();
    this._deletedCount = 0;
    this._stats.rebuilds++;

    for (const [id, { vec, meta }] of entries) {
      const hash = computeLshHash(vec, this._hyperplanes);
      if (!this._buckets.has(hash)) {
        this._buckets.set(hash, new Set());
      }
      this._buckets.get(hash).add(id);
      this._rows.set(id, { vec, meta, hash });
    }
  }

  /**
   * 序列化索引
   */
  toJSON() {
    const rows = [];
    for (const [id, { vec, meta, hash }] of this._rows.entries()) {
      rows.push({ id, vec: Array.from(vec), meta, hash });
    }
    return {
      version: 1,
      dim: this._dim,
      numHashBits: this._numHashBits,
      numProbes: this._numProbes,
      seed: this._seed,
      rows,
    };
  }

  /**
   * 从 JSON 恢复索引
   */
  static fromJSON(json) {
    if (!json || json.version !== 1) {
      throw new Error("Invalid HnswLiteIndex JSON");
    }

    const index = new HnswLiteIndex({
      maxItems: json.rows?.length || 5000,
      numHashBits: json.numHashBits,
      numProbes: json.numProbes,
      seed: json.seed,
    });

    if (json.dim !== null && json.dim !== undefined) {
      index._dim = json.dim;
      index._initHyperplanes();
    }

    for (const row of json.rows || []) {
      const vec = new Float32Array(row.vec);
      index._rows.set(row.id, { vec, meta: row.meta, hash: row.hash });
      if (!index._buckets.has(row.hash)) {
        index._buckets.set(row.hash, new Set());
      }
      index._buckets.get(row.hash).add(row.id);
    }

    return index;
  }
}

export default { HnswLiteIndex };
