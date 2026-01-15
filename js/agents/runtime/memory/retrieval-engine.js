import { isPlainObject, toNonEmptyString, toPositiveInt } from "../../shared/utils/value-utils.js";
import { EmbeddingService } from "../../shared/embeddings/embedding-service.js";
import { VectorIndex } from "../../shared/embeddings/vector-index.js";
import { TokenBucketRateLimiter } from "../../llm/rate-limit.js";

function tokenizeQuery(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[\s,，。！？；：""''（）【】\[\]{}]+/)
    .filter((t) => t.length >= 2);
}

function buildArchiveEmbeddingText(entry) {
  const e = entry && typeof entry === "object" ? entry : null;
  if (!e) return "";
  const stage = toNonEmptyString(e.stageKey) || "";
  const summary = toNonEmptyString(e.summary) || "";
  const prefix = stage ? `stage:${stage}` : "";
  const text = [prefix, summary].filter(Boolean).join("\n");
  return text.trim();
}

function getTimeline(store) {
  const t = store?._L3?.index?.timeline ?? store?.L3?.index?.timeline ?? null;
  return Array.isArray(t) ? t : null;
}

function getSnapshots(store) {
  return store?._L3?.snapshots ?? store?.L3?.snapshots ?? null;
}

function getKeywordIndex(store) {
  return store?._L3?.index?.keywords ?? store?.L3?.index?.keywords ?? null;
}

function getSnapshotById(snapshots, id) {
  if (!snapshots || !id) return null;
  if (typeof snapshots.get === "function") return snapshots.get(id) || null;
  if (typeof snapshots === "object") return snapshots[id] || null;
  return null;
}

function *iterateSnapshotsEntries(snapshots) {
  if (!snapshots) return;
  if (typeof snapshots.entries === "function") {
    yield *snapshots.entries();
    return;
  }
  if (typeof snapshots === "object") {
    yield *Object.entries(snapshots);
  }
}

function getKeywordIds(keywordIndex, kw) {
  if (!keywordIndex || !kw) return [];
  if (typeof keywordIndex.get === "function") {
    const ids = keywordIndex.get(kw);
    if (!ids) return [];
    if (Array.isArray(ids)) return ids;
    if (typeof ids[Symbol.iterator] === "function") return Array.from(ids);
    return [];
  }
  if (typeof keywordIndex === "object") {
    const ids = keywordIndex[kw];
    return Array.isArray(ids) ? ids : [];
  }
  return [];
}

export class RetrievalEngine {
  constructor(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const memoryStore = opts.memoryStore || opts.store || null;
    if (!memoryStore) throw new Error("RetrievalEngine requires { memoryStore }");

    this.memoryStore = memoryStore;
    this.eventBus = opts.eventBus || memoryStore.eventBus || null;

    const embeddingService = opts.embeddingService ?? memoryStore.embeddingService ?? memoryStore._embeddingService ?? null;
    this.embeddingService = embeddingService instanceof EmbeddingService || (embeddingService && typeof embeddingService === "object")
      ? embeddingService
      : null;

    const maxItems = toPositiveInt(opts.vectorMaxItems ?? memoryStore.config?.vectorMaxItems, 1000);
    const vectorIndex = opts.vectorIndex ?? memoryStore.vectorIndex ?? memoryStore._vectorIndex ?? null;
    if (vectorIndex) {
      this.vectorIndex = vectorIndex;
    } else if (this.embeddingService) {
      this.vectorIndex = new VectorIndex({ maxItems });
    } else {
      this.vectorIndex = null;
    }

    // 反压配置
    this._indexQueue = [];
    this._indexQueueMaxSize = toPositiveInt(opts.indexQueueMaxSize, 100);
    this._indexRetryMax = toPositiveInt(opts.indexRetryMax, 2);
    this._indexRetryDelayMs = toPositiveInt(opts.indexRetryDelayMs, 500);
    this._indexInFlight = 0;
    this._indexMaxConcurrent = toPositiveInt(opts.indexMaxConcurrent, 3);
    this._indexDroppedCount = 0;

    // 限流配置
    const rlOpts = isPlainObject(opts.rateLimit) ? opts.rateLimit : {};
    const rlEnabled = rlOpts.enabled !== false && opts.rateLimiter !== null;
    if (opts.rateLimiter instanceof TokenBucketRateLimiter) {
      this._rateLimiter = opts.rateLimiter;
    } else if (rlEnabled) {
      this._rateLimiter = new TokenBucketRateLimiter({
        rps: toPositiveInt(rlOpts.rps, 100),
        burst: toPositiveInt(rlOpts.burst, 200),
        concurrency: toPositiveInt(rlOpts.concurrency, 50),
        maxQueue: toPositiveInt(rlOpts.maxQueue, 500),
      });
    } else {
      this._rateLimiter = null;
    }

    this._unsubscribeArchived = null;
    if (opts.subscribe !== false) {
      this._subscribeToMemoryEvents();
    }
  }

  _subscribeToMemoryEvents() {
    if (!this.eventBus || typeof this.eventBus.on !== "function") return;
    if (this._unsubscribeArchived) return;

    this._unsubscribeArchived = this.eventBus.on("memory.archived", (evt) => {
      const payload = evt && typeof evt === "object" ? evt.payload : null;
      const id = toNonEmptyString(payload?.id);
      if (!id) return;
      this.queueIndexArchive(id);
    });
  }

  dispose() {
    if (this._unsubscribeArchived) {
      try {
        this._unsubscribeArchived();
      } catch {
        // ignore
      }
      this._unsubscribeArchived = null;
    }
    this._indexQueue.length = 0;
  }

  /**
   * 获取索引队列状态（用于监控和调试）
   */
  getIndexQueueStats() {
    return {
      queueSize: this._indexQueue.length,
      maxSize: this._indexQueueMaxSize,
      inFlight: this._indexInFlight,
      maxConcurrent: this._indexMaxConcurrent,
      droppedCount: this._indexDroppedCount,
      rateLimiter: this._rateLimiter?.getState?.() ?? null,
    };
  }

  /**
   * 将归档条目加入索引队列（带反压）
   * @param {string} archiveId
   * @returns {boolean} 是否成功入队
   */
  queueIndexArchive(archiveId) {
    const id = toNonEmptyString(archiveId);
    if (!id) return false;
    const svc = this.embeddingService;
    const idx = this.vectorIndex;
    if (!svc || typeof svc.enqueue !== "function") return false;
    if (!idx || typeof idx.upsert !== "function") return false;

    const entry = getSnapshotById(getSnapshots(this.memoryStore), id);
    if (!entry) return false;

    const text = buildArchiveEmbeddingText(entry);
    if (!text) return false;

    // 反压检查：队列已满时丢弃最旧的任务
    if (this._indexQueue.length >= this._indexQueueMaxSize) {
      this._indexQueue.shift();
      this._indexDroppedCount++;
    }

    this._indexQueue.push({ id, text, entry, retries: 0 });
    this._processIndexQueue();
    return true;
  }

  /**
   * 处理索引队列（控制并发）
   */
  _processIndexQueue() {
    while (this._indexInFlight < this._indexMaxConcurrent && this._indexQueue.length > 0) {
      const task = this._indexQueue.shift();
      if (!task) break;
      this._indexInFlight++;
      this._executeIndexTask(task);
    }
  }

  /**
   * 执行单个索引任务（带重试）
   */
  async _executeIndexTask(task) {
    const { id, text, entry, retries } = task;
    try {
      const vectors = await this.embeddingService.enqueue([text], { immediate: false });
      const v = Array.isArray(vectors) ? vectors[0] : null;
      if (v) {
        this.vectorIndex.upsert(id, v, { stageKey: entry.stageKey, ts: entry.ts });
      }
    } catch (err) {
      // 重试逻辑
      if (retries < this._indexRetryMax) {
        await new Promise((r) => setTimeout(r, this._indexRetryDelayMs * (retries + 1)));
        this._indexQueue.push({ ...task, retries: retries + 1 });
      }
      // 超过重试次数则静默丢弃
    } finally {
      this._indexInFlight--;
      this._processIndexQueue();
    }
  }

  /**
   * @param {{ timeoutMs?: number }} [options]
   */
  async ensureIndexed({ timeoutMs } = {}) {
    const svc = this.embeddingService;
    const idx = this.vectorIndex;
    if (!svc || typeof svc.embed !== "function") return false;
    if (!idx || typeof idx.upsert !== "function") return false;

    const pending = [];
    const snapshots = getSnapshots(this.memoryStore);
    if (!snapshots) return true;

    for (const [id, entry] of iterateSnapshotsEntries(snapshots)) {
      if (typeof idx.has === "function" && idx.has(id)) continue;
      const text = buildArchiveEmbeddingText(entry);
      if (!text) continue;
      pending.push({ id, entry, text });
    }

    if (!pending.length) return true;

    const vectors = await svc.embed(
      pending.map((p) => p.text),
      { ...(timeoutMs ? { timeoutMs } : {}) }
    );
    if (!Array.isArray(vectors) || vectors.length !== pending.length) return false;

    for (let i = 0; i < pending.length; i++) {
      const row = pending[i];
      const vec = vectors[i];
      if (!vec) continue;
      try {
        idx.upsert(row.id, vec, { stageKey: row.entry.stageKey, ts: row.entry.ts });
      } catch {
        // ignore vector dimension errors / index failures
      }
    }

    return true;
  }

  /**
   * Backward-compatible entrypoint: keyword recall.
   * @param {string} query
   * @param {number|{limit?:number}} [limitOrOptions]
   */
  recall(query, limitOrOptions = 3) {
    if (isPlainObject(limitOrOptions)) {
      return this.keywordRecall(query, /** @type {{ limit?: number }} */ (limitOrOptions));
    }
    return this.keywordRecall(query, { limit: /** @type {number} */ (limitOrOptions) });
  }

  /**
   * 内部方法：通过限流器获取执行权限
   * @param {string} [label]
   * @returns {Promise<void>}
   */
  async _acquireRateLimit(label) {
    if (!this._rateLimiter) return;
    await this._rateLimiter.schedule(() => {}, { label });
  }

  keywordRecall(query, { limit = 3 } = {}) {
    const q = toNonEmptyString(query) || "";
    const k = toPositiveInt(limit, 3);

    const timeline = getTimeline(this.memoryStore);
    const snapshots = getSnapshots(this.memoryStore);
    const keywordIndex = getKeywordIndex(this.memoryStore);
    if (!Array.isArray(timeline) || !snapshots) return [];

    const keywords = tokenizeQuery(q);
    if (!keywords.length) {
      return timeline
        .slice(-k)
        .reverse()
        .map((t) => {
          const snap = getSnapshotById(snapshots, t.id);
          return snap ? { id: t.id, summary: t.summary, data: snap.data } : null;
        })
        .filter(Boolean);
    }

    const scores = new Map();
    for (const kw of keywords) {
      const ids = getKeywordIds(keywordIndex, kw.toLowerCase());
      for (const id of ids) {
        scores.set(id, (scores.get(id) || 0) + 1);
      }
    }

    const ranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);

    return ranked
      .map(([id]) => {
        const snap = getSnapshotById(snapshots, id);
        return snap ? { id, summary: snap.summary, data: snap.data } : null;
      })
      .filter(Boolean);
  }

  /**
   * @param {string} query
   * @param {{ limit?: number, fallback?: boolean, timeoutMs?: number }} [options]
   */
  async semanticRecall(query, { limit = 3, fallback = true, timeoutMs } = {}) {
    await this._acquireRateLimit("semanticRecall");
    const q = toNonEmptyString(query) || "";
    const k = toPositiveInt(limit, 3);

    const svc = this.embeddingService;
    const idx = this.vectorIndex;
    if (!svc || typeof svc.embed !== "function" || !idx || typeof idx.search !== "function") {
      return fallback ? this.keywordRecall(q, { limit: k }) : [];
    }

    // Ensure archive vectors exist (best-effort); doesn't block queue-based indexing.
    await this.ensureIndexed({ ...(timeoutMs ? { timeoutMs } : {}) });

    const vectors = await svc.embed([q], { ...(timeoutMs ? { timeoutMs } : {}) });
    const v = Array.isArray(vectors) ? vectors[0] : null;
    if (!v) return fallback ? this.keywordRecall(q, { limit: k }) : [];

    const hits = idx.search(v, { topK: k });
    const out = [];
    for (const h of hits) {
      const snap = getSnapshotById(getSnapshots(this.memoryStore), h.id);
      if (!snap) continue;
      out.push({ id: h.id, score: h.score, summary: snap.summary, data: snap.data });
    }

    if (out.length) return out;
    return fallback ? this.keywordRecall(q, { limit: k }) : [];
  }

  /**
   * Hybrid recall with RRF (Reciprocal Rank Fusion) reranking.
   *
   * RRF formula: score(d) = Σ 1 / (k + rank_i(d))
   * where k is a constant (default 60) and rank_i(d) is document d's rank in list i.
   *
   * @param {string} query
   * @param {object} options
   * @param {number} [options.limit=3]
   * @param {boolean} [options.fallback=true]
   * @param {number} [options.timeoutMs]
   * @param {number} [options.rrfK=60] - RRF constant k (higher = more weight to lower ranks)
   * @param {number} [options.semanticWeight=1.0] - Weight multiplier for semantic results
   * @param {number} [options.keywordWeight=1.0] - Weight multiplier for keyword results
   */
  async hybridRecall(query, { limit = 3, fallback = true, timeoutMs, rrfK = 60, semanticWeight = 1.0, keywordWeight = 1.0 } = {}) {
    await this._acquireRateLimit("hybridRecall");
    const q = toNonEmptyString(query) || "";
    const k = toPositiveInt(limit, 3);
    const rrfConstant = toPositiveInt(rrfK, 60);
    const semWeight = typeof semanticWeight === "number" && Number.isFinite(semanticWeight) ? Math.max(0, semanticWeight) : 1.0;
    const kwWeight = typeof keywordWeight === "number" && Number.isFinite(keywordWeight) ? Math.max(0, keywordWeight) : 1.0;

    // 获取两个来源的结果（各取 k*2 以增加融合候选）
    const fetchLimit = Math.max(k * 2, 10);
    const semantic = await this.semanticRecall(q, { limit: fetchLimit, fallback: false, ...(timeoutMs ? { timeoutMs } : {}) });
    const keyword = this.keywordRecall(q, { limit: fetchLimit });

    // 如果两个来源都为空，使用 fallback
    if (!semantic.length && !keyword.length) {
      return fallback ? this.keywordRecall(q, { limit: k }) : [];
    }

    // RRF 分数累积
    const rrfScores = new Map(); // id -> { score, data }
    const dataMap = new Map();   // id -> row data

    // 处理语义搜索结果
    for (let i = 0; i < semantic.length; i++) {
      const row = semantic[i];
      if (!row?.id) continue;
      const rank = i + 1; // 排名从 1 开始
      const contribution = semWeight / (rrfConstant + rank);
      const current = rrfScores.get(row.id) || 0;
      rrfScores.set(row.id, current + contribution);
      if (!dataMap.has(row.id)) dataMap.set(row.id, row);
    }

    // 处理关键词搜索结果
    for (let i = 0; i < keyword.length; i++) {
      const row = keyword[i];
      if (!row?.id) continue;
      const rank = i + 1;
      const contribution = kwWeight / (rrfConstant + rank);
      const current = rrfScores.get(row.id) || 0;
      rrfScores.set(row.id, current + contribution);
      if (!dataMap.has(row.id)) dataMap.set(row.id, row);
    }

    // 按 RRF 分数排序
    const sorted = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, k);

    // 构建结果，附带 RRF 分数
    const out = sorted.map(([id, rrfScore]) => {
      const row = dataMap.get(id);
      return row ? { ...row, rrfScore } : null;
    }).filter(Boolean);

    return out.length ? out : (fallback ? this.keywordRecall(q, { limit: k }) : []);
  }
}

export default RetrievalEngine;
