/**
 * SharedContext - 分层记忆 + 阶段间通信
 *
 * 三层架构:
 * - L1 Summaries: 压缩摘要，始终在 prompt 里 (~200 tokens)
 * - L2 Index: 语义索引，不占 token，O(1) 查找
 * - L3 Store: 完整数据，按需加载
 */

import { isPlainObject, toNonEmptyString } from "../../shared/value-utils.js";

/**
 * 生成内容指纹（用于去重）
 */
function contentFingerprint(text, maxLen = 200) {
  const t = String(text || "").slice(0, maxLen).toLowerCase().replace(/\s+/g, " ").trim();
  // 简单 hash
  let hash = 0;
  for (let i = 0; i < t.length; i++) {
    const char = t.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

function normalizeLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export class SharedContext {
  constructor({ runId, limits, maxL1Entries, maxL2Entries } = {}) {
    this.runId = toNonEmptyString(runId) || `ctx_${Date.now()}`;
    this.createdAt = new Date().toISOString();

    const providedLimits = limits && typeof limits === "object" ? limits : {};
    const summaryLimit = normalizeLimit(maxL1Entries ?? providedLimits.maxL1Entries ?? providedLimits.summariesMax);
    const indexLimit = normalizeLimit(maxL2Entries ?? providedLimits.maxL2Entries ?? providedLimits.indexKeywordsMax);

    this.limits = {
      storeMax: 50,
      signalsMax: 200,
      decisionsMax: 200,
      seenMax: 5000,
      indexKeywordsMax: 500,
      indexIdsPerKeywordMax: 20,
      ...providedLimits,
    };

    if (summaryLimit !== null) this.limits.summariesMax = summaryLimit;
    if (indexLimit !== null) this.limits.indexKeywordsMax = indexLimit;

    // L1: 压缩摘要 (stage → summary string)
    this._summaries = new Map();

    // L2: 语义索引 (keyword → Set<id>)
    this._index = new Map();

    // L2: 阶段索引 (stage → index object)
    this._stageIndex = new Map();

    // L3: 完整数据 (id → full object)
    this._store = new Map();

    // 信号队列 (阶段间通信)
    this._signals = [];

    // 决策日志
    this._decisions = [];

    // 内容指纹 (去重用)
    this._seenFingerprints = new Set();
  }

  _pruneArray(arr, max) {
    const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
    while (arr.length > cap) arr.shift();
  }

  _pruneMap(map, max) {
    const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
    while (map.size > cap) {
      const firstKey = map.keys().next().value;
      map.delete(firstKey);
    }
  }

  // ===== L1: Summaries =====

  /**
   * 设置阶段摘要
   */
  setSummary(stage, summary) {
    const s = toNonEmptyString(stage);
    if (!s) return;
    this._summaries.set(s, String(summary || ""));
    if (Number.isFinite(this.limits.summariesMax)) {
      this._pruneMap(this._summaries, this.limits.summariesMax);
    }
  }

  /**
   * 获取阶段摘要
   */
  getSummary(stage) {
    return this._summaries.get(String(stage || "")) || null;
  }

  /**
   * 获取所有摘要（用于构建 prompt）
   */
  getAllSummaries() {
    const out = {};
    for (const [k, v] of this._summaries) {
      out[k] = v;
    }
    return out;
  }

  /**
   * 构建摘要文本（用于 prompt）
   */
  buildSummaryText() {
    const lines = [];
    for (const [stage, summary] of this._summaries) {
      if (summary) {
        lines.push(`[${stage}] ${summary}`);
      }
    }
    return lines.join("\n");
  }

  // ===== L2: Semantic Index =====

  /**
   * 添加索引条目
   */
  addToIndex(keyword, id) {
    const kw = String(keyword || "").toLowerCase().trim();
    if (!kw || !id) return;
    if (!this._index.has(kw)) {
      this._index.set(kw, new Set());
    }
    this._index.get(kw).add(String(id));
    this._pruneMap(this._index.get(kw), this.limits.indexIdsPerKeywordMax);
    this._pruneMap(this._index, this.limits.indexKeywordsMax);
  }

  /**
   * 批量添加索引
   */
  indexMany(keywords, id) {
    for (const kw of Array.isArray(keywords) ? keywords : []) {
      this.addToIndex(kw, id);
    }
  }

  /**
   * 设置阶段索引
   */
  setIndex(stage, index) {
    const s = toNonEmptyString(stage);
    if (!s) return;
    let stored = index;
    if (index instanceof Map) {
      stored = Object.fromEntries(index);
    } else if (!isPlainObject(index)) {
      stored = { value: index };
    }
    this._stageIndex.set(s, stored);

    const keywords = Array.isArray(stored?.keywords) ? stored.keywords : [];
    const ids = Array.isArray(stored?.ids) ? stored.ids : [];
    const paths = Array.isArray(stored?.paths) ? stored.paths : [];
    for (const token of [...keywords, ...ids, ...paths]) {
      const kw = toNonEmptyString(token);
      if (kw) this.addToIndex(kw, s);
    }
  }

  /**
   * 获取阶段索引
   */
  getIndex(stage) {
    return this._stageIndex.get(String(stage || "")) || null;
  }

  /**
   * 按关键词搜索
   */
  search(keyword) {
    const kw = String(keyword || "").toLowerCase().trim();
    const ids = this._index.get(kw);
    return ids ? Array.from(ids) : [];
  }

  /**
   * 多关键词搜索（交集）
   */
  searchAll(keywords) {
    const kws = (Array.isArray(keywords) ? keywords : [])
      .map(k => String(k || "").toLowerCase().trim())
      .filter(Boolean);
    if (!kws.length) return [];

    let result = null;
    for (const kw of kws) {
      const ids = this._index.get(kw);
      if (!ids || ids.size === 0) return [];
      if (!result) {
        result = new Set(ids);
      } else {
        for (const id of result) {
          if (!ids.has(id)) result.delete(id);
        }
      }
    }
    return result ? Array.from(result) : [];
  }

  // ===== L3: Full Store =====

  /**
   * 存储完整数据
   */
  store(id, data) {
    const key = toNonEmptyString(id);
    if (!key) return;
    this._store.set(key, data);
    this._pruneMap(this._store, this.limits.storeMax);
  }

  /**
   * 获取完整数据
   */
  getDetail(id) {
    return this._store.get(String(id || "")) || null;
  }

  /**
   * 检查是否存在
   */
  has(id) {
    return this._store.has(String(id || ""));
  }

  /**
   * 清理阶段存储
   */
  clearStore(stage) {
    const s = toNonEmptyString(stage);
    if (!s) {
      this._store.clear();
      return;
    }
    for (const key of this._store.keys()) {
      if (String(key).startsWith(`${s}_`)) {
        this._store.delete(key);
      }
    }
  }

  // ===== 便捷方法: commit =====

  /**
   * 一次性提交阶段结果
   * @param {string} stage - 阶段名
   * @param {object} data - { full, summary, keywords }
   */
  commit(stage, { full, summary, keywords } = {}) {
    const s = toNonEmptyString(stage);
    if (!s) return null;

    const id = `${s}_${Date.now()}`;

    // L3: 存储完整数据
    if (full !== undefined) {
      this.store(id, full);
    }

    // L1: 设置摘要
    if (summary) {
      this.setSummary(s, summary);
    }

    // L2: 建立索引
    if (Array.isArray(keywords)) {
      this.indexMany(keywords, id);
    }

    this._pruneMap(this._index, this.limits.indexKeywordsMax);
    for (const ids of this._index.values()) {
      this._pruneMap(ids, this.limits.indexIdsPerKeywordMax);
    }

    return id;
  }

  // ===== 信号机制 =====

  /**
   * 发送信号
   */
  signal(name, data) {
    const nameStr = toNonEmptyString(name);
    const stage = toNonEmptyString(data?.stage) || nameStr || "unknown";
    let type = toNonEmptyString(data?.type);
    if (!type) {
      type = toNonEmptyString(data?.stage) ? (nameStr || "info") : "info";
    }
    const sig = {
      id: `sig_${this._signals.length + 1}`,
      stage,
      type,
      payload: isPlainObject(data) ? data : { value: data },
      ts: Date.now(),
    };
    this._signals.push(sig);
    this._pruneArray(this._signals, this.limits.signalsMax);
    return sig;
  }

  /**
   * 更新或插入信号（用于状态同步）
   * @param {object} data - { type, id, status, keywords, by, ts }
   */
  upsertSignal(data) {
    if (!isPlainObject(data)) return null;
    const type = toNonEmptyString(data.type);
    const id = toNonEmptyString(data.id);
    if (!type || !id) return null;

    const key = `${type}:${id}`;
    const existing = this._signals.findIndex(s =>
      s.payload?._syncKey === key
    );

    const sig = {
      id: existing >= 0 ? this._signals[existing].id : `sig_${this._signals.length + 1}`,
      stage: type,
      type: "sync",
      payload: {
        _syncKey: key,
        type,
        id,
        status: toNonEmptyString(data.status) || "unknown",
        keywords: Array.isArray(data.keywords) ? data.keywords.slice(0, 5) : [],
        by: data.by,
      },
      ts: data.ts || Date.now(),
    };

    if (existing >= 0) {
      this._signals[existing] = sig;
    } else {
      this._signals.push(sig);
      this._pruneArray(this._signals, this.limits.signalsMax);
    }
    return sig;
  }

  /**
   * 获取同步信号表格（按 type 分组）
   */
  getSyncTable(type) {
    const signals = this._signals.filter(s =>
      s.type === "sync" && (!type || s.payload?.type === type)
    );
    return signals.map(s => s.payload).filter(Boolean);
  }

  /**
   * 获取所有信号
   */
  getSignals(filter) {
    if (typeof filter === "function") {
      return this._signals.filter(filter);
    }
    if (typeof filter === "string") {
      return this._signals.filter(s => s.type === filter || s.stage === filter);
    }
    return this._signals.slice();
  }

  /**
   * 获取最新信号
   */
  getLatestSignal(type) {
    for (let i = this._signals.length - 1; i >= 0; i--) {
      const s = this._signals[i];
      if (!type || s.type === type) return s;
    }
    return null;
  }

  /**
   * 清除信号
   */
  clearSignals() {
    this._signals = [];
  }

  // ===== 决策日志 =====

  /**
   * 记录决策
   */
  recordDecision(decision) {
    const d = {
      id: `dec_${this._decisions.length + 1}`,
      ...(isPlainObject(decision) ? decision : { action: decision }),
      ts: Date.now(),
    };
    this._decisions.push(d);
    this._pruneArray(this._decisions, this.limits.decisionsMax);
    return d;
  }

  /**
   * 获取决策历史
   */
  getDecisions(filter) {
    if (typeof filter === "function") {
      return this._decisions.filter(filter);
    }
    return this._decisions.slice();
  }

  // ===== 去重 =====

  /**
   * 检查内容是否已处理过
   */
  hasSeen(content) {
    const fp = contentFingerprint(content);
    return this._seenFingerprints.has(fp);
  }

  /**
   * 标记内容已处理
   */
  markSeen(content) {
    const fp = contentFingerprint(content);
    this._seenFingerprints.add(fp);
    this._pruneMap(this._seenFingerprints, this.limits.seenMax);
    return fp;
  }

  /**
   * 检查并标记（原子操作）
   */
  checkAndMark(content) {
    const fp = contentFingerprint(content);
    if (this._seenFingerprints.has(fp)) {
      return { seen: true, fingerprint: fp };
    }
    this._seenFingerprints.add(fp);
    this._pruneMap(this._seenFingerprints, this.limits.seenMax);
    return { seen: false, fingerprint: fp };
  }

  // ===== 统计 =====

  getStats() {
    return {
      runId: this.runId,
      summaryCount: this._summaries.size,
      indexKeywords: this._index.size,
      storeItems: this._store.size,
      signalCount: this._signals.length,
      decisionCount: this._decisions.length,
      seenCount: this._seenFingerprints.size,
    };
  }

  // ===== 序列化 =====

  toJSON() {
    return {
      runId: this.runId,
      createdAt: this.createdAt,
      summaries: Object.fromEntries(this._summaries),
      // index 和 store 可能太大，只序列化 keys
      indexKeys: Array.from(this._index.keys()),
      storeKeys: Array.from(this._store.keys()),
      signals: this._signals,
      decisions: this._decisions,
    };
  }
}

/**
 * 创建 SharedContext 实例
 */
export function createSharedContext(options = {}) {
  return new SharedContext(options);
}

export default SharedContext;
