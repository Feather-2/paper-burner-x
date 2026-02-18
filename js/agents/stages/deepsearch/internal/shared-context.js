/**
 * SharedContext - 分层记忆 + 阶段间通信
 *
 * 三层架构:
 * - L1 Summaries: 压缩摘要，始终在 prompt 里 (~200 tokens)
 * - L2 Index: 语义索引，不占 token，O(1) 查找
 * - L3 Store: 完整数据，按需加载
 */

import { isPlainObject, toNonEmptyString } from "../../../shared/index.js";
import { cryptoRandomHex } from "../../../shared/index.js";
import { makeSecureTimestampedId } from "../../../shared/index.js";

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

function sanitizeIdPart(value) {
  const s = toNonEmptyString(value);
  if (!s) return "";
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

function normalizeLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      /* intentional: stringify failure */
      return "[unserializable payload]";
    }
  }
}

function resolveSharedContextRunId(runId, runIdFactory) {
  const provided = toNonEmptyString(runId);
  if (provided) return provided;

  if (typeof runIdFactory === "function") {
    try {
      const custom = toNonEmptyString(runIdFactory({ prefix: "ctx", timestamp: Date.now() }));
      if (custom) return custom;
    } catch {
      // ignore custom factory failures and fall back
    }
  }

  return makeSecureTimestampedId("ctx", { allowInsecureFallback: true });
}

export class SharedContext {
  /**
   * @param {{ runId?: string, runIdFactory?: (meta: { prefix: string, timestamp: number }) => string|null|undefined, idFactory?: (meta: { prefix: string, sequence: number, instanceId: string }) => string|null|undefined, limits?: any, maxL1Entries?: number, maxL2Entries?: number }=} options
   */
  constructor({ runId, runIdFactory, idFactory, limits, maxL1Entries, maxL2Entries } = {}) {
    this.runId = resolveSharedContextRunId(runId, runIdFactory);
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
      actionsMax: 1000,
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

    // Concurrency + merge support:
    // - unique IDs (avoid Date.now collisions under parallel writes)
    // - monotonic version & bounded action log (for future action-stream merges)
    this._seq = 0;
    this._version = 0;
    this._actions = [];
    this._suppressActionRecording = false;
    this._applyingActions = false;

    // Per-instance salt to avoid cross-context collisions when rehydrating/merging.
    this._instanceId = cryptoRandomHex(4);
    this._idFactory = typeof idFactory === "function" ? idFactory : null;
  }

  _nextId(prefix) {
    this._seq += 1;
    const base = sanitizeIdPart(prefix) || "id";
    if (this._idFactory) {
      try {
        const custom = toNonEmptyString(
          this._idFactory({ prefix: base, sequence: this._seq, instanceId: this._instanceId })
        );
        if (custom) return custom;
      } catch {
        // ignore custom id factory errors and use deterministic fallback
      }
    }
    return `${base}_${this._instanceId}_${this._seq}`;
  }

  _recordAction(kind, payload) {
    if (this._suppressActionRecording || this._applyingActions) return;
    const k = toNonEmptyString(kind);
    if (!k) return;
    this._version += 1;
    const action = {
      id: this._nextId("act"),
      version: this._version,
      kind: k,
      payload: payload ?? null,
      ts: Date.now(),
    };
    this._actions.push(action);
    this._pruneArray(this._actions, this.limits.actionsMax);
  }

  getVersion() {
    return this._version;
  }

  getActions({ sinceVersion = 0, limit = 200 } = {}) {
    const since = Number.isFinite(sinceVersion) ? Math.max(0, Math.floor(sinceVersion)) : 0;
    const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 200;
    const filtered = this._actions.filter((a) => (Number(a?.version) || 0) > since);
    return cap > 0 ? filtered.slice(-cap) : filtered;
  }

  applyActions(actions) {
    const list = Array.isArray(actions) ? actions : [];
    if (list.length === 0) return;

    let maxIncomingVersion = this._version;

    const prev = this._applyingActions;
    this._applyingActions = true;
    try {
      for (const action of list) {
        const version = Number(action?.version);
        if (Number.isFinite(version)) maxIncomingVersion = Math.max(maxIncomingVersion, Math.floor(version));
        this._applyAction(action);
      }
    } finally {
      this._applyingActions = prev;
    }

    // Preserve monotonicity even when rehydrating a fresh context.
    this._version = Math.max(this._version, maxIncomingVersion);

    // Keep a bounded action log for downstream merges/debugging.
    for (const action of list) {
      if (!isPlainObject(action)) continue;
      const id = toNonEmptyString(action.id);
      if (id && this._actions.some((a) => a?.id === id)) continue;
      this._actions.push(action);
    }
    this._pruneArray(this._actions, this.limits.actionsMax);
  }

  _applyAction(action) {
    const a = isPlainObject(action) ? action : {};
    const kind = toNonEmptyString(a.kind);
    const payload = a.payload;
    if (!kind) return;

    if (kind === "setSummary") {
      if (isPlainObject(payload)) this.setSummary(payload.stage, payload.summary);
      return;
    }
    if (kind === "setIndex") {
      if (isPlainObject(payload)) this.setIndex(payload.stage, payload.index);
      return;
    }
    if (kind === "store") {
      if (isPlainObject(payload)) this.store(payload.id, payload.data);
      return;
    }
    if (kind === "addToIndex") {
      if (isPlainObject(payload)) this.addToIndex(payload.keyword, payload.id);
      return;
    }
    if (kind === "indexMany") {
      if (isPlainObject(payload)) this.indexMany(payload.keywords, payload.id);
      return;
    }
    if (kind === "signal") {
      if (isPlainObject(payload?.signal)) {
        this._signals.push(payload.signal);
        this._pruneArray(this._signals, this.limits.signalsMax);
      }
      return;
    }
    if (kind === "upsertSignal") {
      if (isPlainObject(payload?.signal)) {
        const syncKey = toNonEmptyString(payload.signal?.payload?._syncKey);
        if (syncKey) {
          const existing = this._signals.findIndex((s) => s?.payload?._syncKey === syncKey);
          if (existing >= 0) this._signals[existing] = payload.signal;
          else this._signals.push(payload.signal);
          this._pruneArray(this._signals, this.limits.signalsMax);
        } else {
          this._signals.push(payload.signal);
          this._pruneArray(this._signals, this.limits.signalsMax);
        }
      }
      return;
    }
    if (kind === "decision") {
      if (isPlainObject(payload?.decision)) {
        this._decisions.push(payload.decision);
        this._pruneArray(this._decisions, this.limits.decisionsMax);
      }
      return;
    }
    if (kind === "commit") {
      if (!isPlainObject(payload)) return;
      const prevSuppress = this._suppressActionRecording;
      this._suppressActionRecording = true;
      try {
        this.commit(payload.stage, {
          id: payload.id,
          full: payload.full,
          summary: payload.summary,
          keywords: payload.keywords,
        });
      } finally {
        this._suppressActionRecording = prevSuppress;
      }
    }
  }

  _normalizeTargetTaskId(targetTaskId) {
    const v = toNonEmptyString(targetTaskId);
    return v ? String(v) : null;
  }

  _signalMatchesTargetTaskId(signal, targetTaskId) {
    const scopedId = this._normalizeTargetTaskId(targetTaskId);
    if (!scopedId) return true;
    const payload = signal?.payload;
    const sigTarget = toNonEmptyString(payload?.targetTaskId);
    if (!sigTarget) return true; // broadcast signal
    return sigTarget === scopedId;
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
    this._recordAction("setSummary", { stage: s, summary: this._summaries.get(s) });
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

  /**
   * 构建完整黑板摘要（用于注入到模型上下文）
   * 包含：L1 摘要 + 最近信号 + 最近决策
   * @param {object} [options]
   * @param {number} [options.maxSignals] - 最多包含的信号数（默认 5）
   * @param {number} [options.maxDecisions] - 最多包含的决策数（默认 3）
   * @param {string} [options.targetTaskId] - 仅展示该 task 的定向信号（无 targetTaskId 的广播信号仍可见）
   * @returns {string}
   */
  buildBlackboardPrompt({ maxSignals = 5, maxDecisions = 3, targetTaskId } = {}) {
    const sections = [];

    // L1 摘要
    const summaryText = this.buildSummaryText();
    if (summaryText) {
      sections.push(`## 阶段摘要\n${summaryText}`);
    }

    // 最近信号（过滤掉 sync 类型，只保留有���义的发现）
    const recentSignals = this._signals
      .filter(s => s.type !== "sync")
      .filter(s => this._signalMatchesTargetTaskId(s, targetTaskId))
      .slice(-maxSignals);
    if (recentSignals.length > 0) {
      const signalLines = recentSignals.map(s => {
        const payload = s.payload || {};
        const msg = payload.message || payload.reason || payload.value || safeJsonStringify(payload);
        return `- [${s.type}] ${msg}`;
      });
      sections.push(`## 待处理信号\n${signalLines.join("\n")}`);
    }

    // 最近决策
    const recentDecisions = this._decisions.slice(-maxDecisions);
    if (recentDecisions.length > 0) {
      const decisionLines = recentDecisions.map(d => {
        const action = d.action || d.type || "unknown";
        const reason = d.reason || d.result || "";
        return `- ${action}${reason ? `: ${reason}` : ""}`;
      });
      sections.push(`## 最近决策\n${decisionLines.join("\n")}`);
    }

    return sections.join("\n\n");
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
    this._recordAction("addToIndex", { keyword: kw, id: String(id) });
  }

  /**
   * 批量添加索引
   */
  indexMany(keywords, id) {
    const list = Array.isArray(keywords) ? keywords : [];
    const prevSuppress = this._suppressActionRecording;
    this._suppressActionRecording = true;
    try {
      for (const kw of list) {
        this.addToIndex(kw, id);
      }
    } finally {
      this._suppressActionRecording = prevSuppress;
    }
    this._recordAction("indexMany", { keywords: list.slice(), id: String(id) });
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
    const prevSuppress = this._suppressActionRecording;
    this._suppressActionRecording = true;
    try {
      for (const token of [...keywords, ...ids, ...paths]) {
        const kw = toNonEmptyString(token);
        if (kw) this.addToIndex(kw, s);
      }
    } finally {
      this._suppressActionRecording = prevSuppress;
    }
    this._recordAction("setIndex", { stage: s, index: stored });
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
    this._recordAction("store", { id: key, data });
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
   * 获取 store 的所有 keys（只读快照）
   * @returns {string[]}
   */
  getStoreKeys() {
    return Array.from(this._store.keys());
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
  commit(stage, { id, full, summary, keywords } = {}) {
    const s = toNonEmptyString(stage);
    if (!s) return null;

    const commitId = toNonEmptyString(id) || this._nextId(s);

    const prevSuppress = this._suppressActionRecording;
    this._suppressActionRecording = true;
    try {
      // L3: 存储完整数据
      if (full !== undefined) {
        this.store(commitId, full);
      }

      // L1: 设置摘要
      if (summary) {
        this.setSummary(s, summary);
      }

      // L2: 建立索引
      if (Array.isArray(keywords)) {
        this.indexMany(keywords, commitId);
      }

      this._pruneMap(this._index, this.limits.indexKeywordsMax);
      for (const ids of this._index.values()) {
        this._pruneMap(ids, this.limits.indexIdsPerKeywordMax);
      }
    } finally {
      this._suppressActionRecording = prevSuppress;
    }

    this._recordAction("commit", { stage: s, id: commitId, full, summary, keywords });

    return commitId;
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
      id: this._nextId("sig"),
      stage,
      type,
      payload: isPlainObject(data) ? data : { value: data },
      ts: Date.now(),
    };
    this._signals.push(sig);
    this._pruneArray(this._signals, this.limits.signalsMax);
    this._recordAction("signal", { signal: sig });
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
      id: existing >= 0 ? this._signals[existing].id : this._nextId("sig"),
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
    this._recordAction("upsertSignal", { signal: sig });
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
    if (isPlainObject(filter)) {
      const includeSync = filter.includeSync !== false;
      const type = toNonEmptyString(filter.type);
      const stage = toNonEmptyString(filter.stage);
      const targetTaskId = this._normalizeTargetTaskId(filter.targetTaskId);

      return this._signals.filter(s => {
        if (!includeSync && s.type === "sync") return false;
        if (type && s.type !== type) return false;
        if (stage && s.stage !== stage) return false;
        if (!this._signalMatchesTargetTaskId(s, targetTaskId)) return false;
        return true;
      });
    }
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
      id: this._nextId("dec"),
      ...(isPlainObject(decision) ? decision : { action: decision }),
      ts: Date.now(),
    };
    this._decisions.push(d);
    this._pruneArray(this._decisions, this.limits.decisionsMax);
    this._recordAction("decision", { decision: d });
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
      version: this._version,
      summaryCount: this._summaries.size,
      indexKeywords: this._index.size,
      storeItems: this._store.size,
      signalCount: this._signals.length,
      decisionCount: this._decisions.length,
      seenCount: this._seenFingerprints.size,
      actionCount: this._actions.length,
    };
  }

  // ===== 序列化 =====

  toJSON() {
    return {
      runId: this.runId,
      createdAt: this.createdAt,
      version: this._version,
      summaries: Object.fromEntries(this._summaries),
      // index 和 store 可能太大，只序列化 keys
      indexKeys: Array.from(this._index.keys()),
      storeKeys: Array.from(this._store.keys()),
      signals: this._signals,
      decisions: this._decisions,
      actionsMeta: {
        actionCount: this._actions.length,
        maxActions: this.limits.actionsMax,
      },
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
