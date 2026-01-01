/**
 * MemoryStore - 统一记忆管理
 *
 * 分层架构:
 * - L0: Immutable (不可压缩) - systemPrompt, taskGoal, todos
 * - L1: Working (工作记忆) - messages, signals, decisions, syncTable
 * - L2: Condensed (压缩记忆) - historySummary, stageSummaries, claims
 * - L3: Archive (归档) - snapshots, index, checkpoints
 */

import { isPlainObject, toNonEmptyString, estimateTokenCount, deepClone } from "../../shared/utils/value-utils.js";
import { getGlobalTokenCounter } from "../../shared/tokenizers/adaptive-token-counter.js";

// 默认配置
const DEFAULT_CONFIG = Object.freeze({
  maxMessages: 20,        // L1 最大消息数
  maxSignals: 50,         // L1 最大信号数
  maxDecisions: 30,       // L1 最大决策数
  keepLastTurns: 6,       // 压缩时保留最近轮数
  compressThreshold: 0.8, // 触发压缩的填充率
  contextWindow: 128000,  // 上下文窗口大小
});

// Token 估算 (4 chars ≈ 1 token)
function estimateTokens(text, tokenCounter) {
  if (!text) return 0;
  if (tokenCounter && typeof tokenCounter.count === "function") {
    try {
      return tokenCounter.count(text);
    } catch {
      // fall back below
    }
  }
  const rawText = typeof text === "string" ? text : JSON.stringify(text);
  return estimateTokenCount(rawText);
}

// 截断文本
function truncate(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// 生成唯一 ID
function genId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
}

export class MemoryStore {
  constructor(options = {}) {
    this.runId = toNonEmptyString(options.runId) || genId("run");
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.eventBus = options.eventBus || null;
    this.archiveAdapter = options.archiveAdapter || null;
    this._tokenCounter = options.tokenCounter === null ? null : options.tokenCounter || getGlobalTokenCounter();

    // 委托层：渐进式统一，内部持有底层组件引用
    this._sharedContext = options.sharedContext || null;
    this._discoveryManager = options.discoveryManager || null;

    // L0: Immutable (不可压缩)
    this.L0 = {
      systemPrompt: "",
      taskGoal: "",
      todos: [],
    };

    // L1: Working (工作记忆)
    this.L1 = {
      messages: [],
      signals: [],
      decisions: [],
      syncTable: {
        discoveries: new Map(),  // id → {id, status, keywords, by, ts}
        subagents: new Map(),    // id → {id, status, progress, ts}
      },
      // Memory 2.0: 统一运行时状态
      scratchpad: {},           // 阶段临时数据
      flags: {
        awaitUserFeedback: false,
        taskImpossible: false,
      },
    };

    // L2: Condensed (压缩记忆)
    this.L2 = {
      historySummary: "",
      stageSummaries: new Map(), // stage → summary
      claims: [],
    };

    // L3: Archive (归档)
    this.L3 = {
      snapshots: new Map(),     // id → full data
      index: {
        keywords: new Map(),    // keyword → Set<snapshotId>
        stages: new Map(),      // stage → snapshotId
        timeline: [],           // [{id, ts, summary}]
      },
      checkpoints: [],
    };

    // 统计
    this._stats = {
      tokenUsage: 0,
      compressionCount: 0,
      recallCount: 0,
    };
  }

  // ===== L0: Immutable =====

  setSystemPrompt(prompt) {
    this.L0.systemPrompt = toNonEmptyString(prompt) || "";
  }

  setTaskGoal(goal) {
    this.L0.taskGoal = toNonEmptyString(goal) || "";
  }

  addTodo(todo) {
    const item = isPlainObject(todo) ? todo : { content: String(todo) };
    const id = item.id || genId("todo");
    const entry = {
      id,
      content: item.content || "",
      status: item.status || "pending",
      priority: item.priority || "normal",
      ts: Date.now(),
    };
    this.L0.todos.push(entry);
    return entry;
  }

  updateTodo(id, data) {
    const todo = this.L0.todos.find(t => t.id === id);
    if (todo && isPlainObject(data)) {
      Object.assign(todo, data, { updatedAt: Date.now() });
    }
    return todo;
  }

  removeTodo(id) {
    const idx = this.L0.todos.findIndex(t => t.id === id);
    if (idx >= 0) {
      return this.L0.todos.splice(idx, 1)[0];
    }
    return null;
  }

  getTodos(filter) {
    if (typeof filter === "function") {
      return this.L0.todos.filter(filter);
    }
    if (typeof filter === "string") {
      return this.L0.todos.filter(t => t.status === filter);
    }
    return [...this.L0.todos];
  }

  // ===== L1: Working =====

  addMessage(msg) {
    const message = isPlainObject(msg) ? msg : { role: "user", content: String(msg) };
    this.L1.messages.push(message);
    this._updateTokenUsage();
    this._checkCompress();
    return message;
  }

  getMessages() {
    return [...this.L1.messages];
  }

  addSignal(signal) {
    const entry = {
      id: genId("sig"),
      type: signal.type || "info",
      message: signal.message || "",
      payload: signal.payload || {},
      acknowledged: false,
      ts: Date.now(),
    };
    this.L1.signals.push(entry);
    this._pruneArray(this.L1.signals, this.config.maxSignals);
    return entry;
  }

  acknowledgeSignal(id) {
    const sig = this.L1.signals.find(s => s.id === id);
    if (sig) sig.acknowledged = true;
    return sig;
  }

  getSignals(filter) {
    const signals = this.L1.signals;
    if (typeof filter === "function") return signals.filter(filter);
    if (filter === "pending") return signals.filter(s => !s.acknowledged);
    return [...signals];
  }

  recordDecision(decision) {
    const entry = {
      id: genId("dec"),
      action: decision.action || decision.type || "unknown",
      reason: decision.reason || "",
      result: decision.result || null,
      ts: Date.now(),
    };
    this.L1.decisions.push(entry);
    this._pruneArray(this.L1.decisions, this.config.maxDecisions);
    return entry;
  }

  getDecisions(limit = 10) {
    return this.L1.decisions.slice(-limit);
  }

  // ===== L1: Scratchpad & Flags (Memory 2.0) =====

  getScratchpad(key) {
    if (key === undefined) return { ...this.L1.scratchpad };
    return this.L1.scratchpad[key];
  }

  setScratchpad(key, value) {
    if (isPlainObject(key) && value === undefined) {
      Object.assign(this.L1.scratchpad, key);
    } else {
      this.L1.scratchpad[key] = value;
    }
    this._emitUpdate("scratchpad", { key, value });
  }

  clearScratchpad() {
    this.L1.scratchpad = {};
    this._emitUpdate("scratchpad", { cleared: true });
  }

  getFlags() {
    return { ...this.L1.flags };
  }

  setFlag(name, value) {
    if (name in this.L1.flags) {
      this.L1.flags[name] = Boolean(value);
      this._emitUpdate("flags", { [name]: value });
    }
  }

  get awaitUserFeedback() {
    return this.L1.flags.awaitUserFeedback;
  }

  set awaitUserFeedback(value) {
    this.setFlag("awaitUserFeedback", value);
  }

  get taskImpossible() {
    return this.L1.flags.taskImpossible;
  }

  set taskImpossible(value) {
    this.setFlag("taskImpossible", value);
  }

  // ===== L1: SyncTable (跨 SubAgent 同步) =====

  syncDiscovery(id, data) {
    const existing = this.L1.syncTable.discoveries.get(id);
    const entry = {
      id,
      status: data.status || existing?.status || "open",
      keywords: data.keywords || existing?.keywords || [],
      by: data.by || existing?.by || null,
      ts: Date.now(),
      ...data,
    };
    this.L1.syncTable.discoveries.set(id, entry);
    return entry;
  }

  getDiscovery(id) {
    return this.L1.syncTable.discoveries.get(id) || null;
  }

  getAllDiscoveries() {
    return Array.from(this.L1.syncTable.discoveries.values());
  }

  syncSubagent(id, data) {
    const existing = this.L1.syncTable.subagents.get(id);
    const entry = {
      id,
      status: data.status || existing?.status || "pending",
      progress: data.progress || existing?.progress || 0,
      result: data.result || existing?.result || null,
      ts: Date.now(),
      ...data,
    };
    this.L1.syncTable.subagents.set(id, entry);
    return entry;
  }

  getSubagent(id) {
    return this.L1.syncTable.subagents.get(id) || null;
  }

  getAllSubagents() {
    return Array.from(this.L1.syncTable.subagents.values());
  }

  // ===== L2: Condensed =====

  setStageSummary(stage, summary) {
    const s = toNonEmptyString(stage);
    if (s) this.L2.stageSummaries.set(s, toNonEmptyString(summary) || "");
  }

  getStageSummary(stage) {
    return this.L2.stageSummaries.get(stage) || "";
  }

  getAllStageSummaries() {
    return Object.fromEntries(this.L2.stageSummaries);
  }

  addClaim(claim) {
    const entry = {
      id: genId("claim"),
      content: claim.content || String(claim),
      source: claim.source || null,
      confidence: claim.confidence || 1.0,
      verified: claim.verified || false,
      ts: Date.now(),
    };
    this.L2.claims.push(entry);
    return entry;
  }

  getClaims(filter) {
    if (typeof filter === "function") return this.L2.claims.filter(filter);
    return [...this.L2.claims];
  }

  // ===== L3: Archive =====

  archive(stageKey, data, keywords = []) {
    const id = genId("snap");
    const entry = {
      id,
      stageKey,
      data,
      summary: data.summary || truncate(JSON.stringify(data), 200),
      ts: Date.now(),
    };

    // 存储
    this.L3.snapshots.set(id, entry);

    // 建立关键词索引
    for (const kw of keywords) {
      const k = toNonEmptyString(kw)?.toLowerCase();
      if (!k) continue;
      if (!this.L3.index.keywords.has(k)) {
        this.L3.index.keywords.set(k, new Set());
      }
      this.L3.index.keywords.get(k).add(id);
    }

    // 阶段索引
    if (stageKey) {
      this.L3.index.stages.set(stageKey, id);
    }

    // 时间线
    this.L3.index.timeline.push({ id, ts: entry.ts, summary: entry.summary });

    return id;
  }

  recall(query, limit = 3) {
    this._stats.recallCount++;
    const keywords = this._tokenize(query);
    if (keywords.length === 0) {
      // 返回最近的
      return this.L3.index.timeline.slice(-limit).reverse().map(t => {
        const snap = this.L3.snapshots.get(t.id);
        return snap ? { id: t.id, summary: t.summary, data: snap.data } : null;
      }).filter(Boolean);
    }

    // 按关键词匹配
    const scores = new Map();
    for (const kw of keywords) {
      const ids = this.L3.index.keywords.get(kw.toLowerCase());
      if (ids) {
        for (const id of ids) {
          scores.set(id, (scores.get(id) || 0) + 1);
        }
      }
    }

    // 排序
    const ranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return ranked.map(([id]) => {
      const snap = this.L3.snapshots.get(id);
      return snap ? { id, summary: snap.summary, data: snap.data } : null;
    }).filter(Boolean);
  }

  listArchives(limit = 10) {
    return this.L3.index.timeline.slice(-limit).reverse();
  }

  // ===== Checkpoint =====

  checkpoint() {
    const id = genId("ckpt");
    // 使用 deepClone 确保 Map/Set 和深层嵌套对象被完整保留且解耦
    const snapshot = {
      id,
      runId: this.runId,
      ts: Date.now(),
      L0: deepClone(this.L0),
      L1: deepClone(this.L1),
      L2: deepClone(this.L2),
    };
    this.L3.checkpoints.push(snapshot);
    return id;
  }

  restore(checkpointId) {
    const ckpt = this.L3.checkpoints.find(c => c.id === checkpointId);
    if (!ckpt) return false;

    // 同样使用 deepClone 恢复，防止后续修改影响 L3 中的快照副本
    this.L0 = deepClone(ckpt.L0);
    this.L1 = deepClone(ckpt.L1);
    this.L2 = deepClone(ckpt.L2);

    return true;
  }

  getLatestCheckpoint() {
    return this.L3.checkpoints[this.L3.checkpoints.length - 1] || null;
  }

  // ===== Compression =====

  compress() {
    const { keepLastTurns } = this.config;
    const messages = this.L1.messages;

    if (messages.length <= keepLastTurns * 2) return false;

    // 分离：保留最近 N 轮，压缩其余
    const kept = [];
    const toCompress = [];
    let turnCount = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (turnCount < keepLastTurns) {
        kept.unshift(msg);
        if (msg.role === "assistant") turnCount++;
      } else {
        toCompress.unshift(msg);
      }
    }

    if (toCompress.length === 0) return false;

    // 生成摘要
    const summary = this._summarizeMessages(toCompress);
    this.L2.historySummary = this.L2.historySummary
      ? `${this.L2.historySummary}\n${summary}`
      : summary;

    // 更新消息
    this.L1.messages = kept;
    this._stats.compressionCount++;
    this._updateTokenUsage();

    this._emit("memory.compressed", {
      compressedCount: toCompress.length,
      keptCount: kept.length,
    });

    return true;
  }

  // ===== Build Prompt Context =====

  buildPromptContext() {
    const sections = [];

    // L0: 不可变层
    if (this.L0.taskGoal) {
      sections.push(`## 目标\n${this.L0.taskGoal}`);
    }

    if (this.L0.todos.length > 0) {
      const todoLines = this.L0.todos.map(t => {
        const status = t.status === "done" ? "✓" : t.status === "in_progress" ? "→" : "○";
        const text = t.content || t.text || "(无描述)";
        return `${status} ${text}`;
      });
      sections.push(`## 待办 (${this.L0.todos.filter(t => t.status !== "done").length}/${this.L0.todos.length})\n${todoLines.join("\n")}`);
    }

    // L2: 压缩摘要
    if (this.L2.historySummary) {
      sections.push(`## 历史摘要\n${truncate(this.L2.historySummary, 500)}`);
    }

    const summaries = this.getAllStageSummaries();
    if (Object.keys(summaries).length > 0) {
      const lines = Object.entries(summaries).map(([k, v]) => `[${k}] ${truncate(v, 100)}`);
      sections.push(`## 阶段发现\n${lines.join("\n")}`);
    }

    // L1: 同步表
    const discoveries = this.getAllDiscoveries();
    const pendingDiscoveries = discoveries.filter(d => d.status !== "satisfied");
    if (pendingDiscoveries.length > 0) {
      const lines = pendingDiscoveries.slice(-5).map(d => `- ${d.id}: ${d.status}${d.keywords?.length ? ` [${d.keywords.join(",")}]` : ""}`);
      sections.push(`## 待验证 (${pendingDiscoveries.length})\n${lines.join("\n")}`);
    }

    const subagents = this.getAllSubagents();
    const activeSubagents = subagents.filter(s => s.status !== "completed" && s.status !== "failed");
    if (activeSubagents.length > 0) {
      const lines = activeSubagents.map(s => `- ${s.id}: ${s.status} (${s.progress || 0}%)`);
      sections.push(`## SubAgents (${activeSubagents.length})\n${lines.join("\n")}`);
    }

    // L1: 待处理信号
    const pendingSignals = this.getSignals("pending");
    if (pendingSignals.length > 0) {
      const lines = pendingSignals.slice(-5).map(s => `- [${s.type}] ${s.message || JSON.stringify(s.payload)}`);
      sections.push(`## 待处理信号\n${lines.join("\n")}`);
    }

    // L1: 最近决策
    const recentDecisions = this.getDecisions(3);
    if (recentDecisions.length > 0) {
      const lines = recentDecisions.map(d => `- ${d.action}${d.reason ? `: ${d.reason}` : ""}`);
      sections.push(`## 最近决策\n${lines.join("\n")}`);
    }

    return sections.length > 0 ? sections.join("\n\n") : "";
  }

  // ===== Utilities =====

  _updateTokenUsage() {
    let total = 0;
    total += estimateTokens(this.L0.systemPrompt, this._tokenCounter);
    total += estimateTokens(JSON.stringify(this.L0.todos), this._tokenCounter);
    for (const msg of this.L1.messages) {
      total += estimateTokens(msg.content, this._tokenCounter);
    }
    total += estimateTokens(this.L2.historySummary, this._tokenCounter);
    this._stats.tokenUsage = total;
  }

  _checkCompress() {
    const { contextWindow, compressThreshold } = this.config;
    if (this._stats.tokenUsage >= contextWindow * compressThreshold) {
      this.compress();
    }
  }

  _pruneArray(arr, max) {
    while (arr.length > max) arr.shift();
  }

  _summarizeMessages(messages) {
    const lines = [];
    for (const msg of messages) {
      const role = msg.role || "unknown";
      const content = truncate(String(msg.content || "").replace(/\s+/g, " "), 100);
      if (content) lines.push(`[${role}] ${content}`);
    }
    return lines.join("\n");
  }

  _tokenize(text) {
    if (!text) return [];
    return String(text).toLowerCase()
      .split(/[\s,，。！？；：""''（）【】\[\]{}]+/)
      .filter(t => t.length >= 2);
  }

  _emit(name, payload) {
    if (this.eventBus?.emit) {
      this.eventBus.emit(name, { actor: "memory", payload });
    }
  }

  /**
   * PushSync: 状态变更时触发 memory.updated 事件
   */
  _emitUpdate(field, delta) {
    this._emit("memory.updated", { field, delta, ts: Date.now() });
  }

  // ===== Stats =====

  getStats() {
    return {
      runId: this.runId,
      tokenUsage: this._stats.tokenUsage,
      messageCount: this.L1.messages.length,
      todoCount: this.L0.todos.length,
      signalCount: this.L1.signals.length,
      decisionCount: this.L1.decisions.length,
      discoveryCount: this.L1.syncTable.discoveries.size,
      subagentCount: this.L1.syncTable.subagents.size,
      claimCount: this.L2.claims.length,
      archiveCount: this.L3.snapshots.size,
      checkpointCount: this.L3.checkpoints.length,
      compressionCount: this._stats.compressionCount,
      recallCount: this._stats.recallCount,
    };
  }

  // ===== 委托层：统一接口 =====

  /**
   * 获取底层 SharedContext（工具层兼容）
   */
  get sharedContext() {
    return this._sharedContext;
  }

  /**
   * 获取底层 DiscoveryManager（工具层兼容）
   */
  get discoveryManager() {
    return this._discoveryManager;
  }

  /**
   * 绑定底层组件（延迟绑定）
   */
  bind({ sharedContext, discoveryManager } = {}) {
    if (sharedContext) this._sharedContext = sharedContext;
    if (discoveryManager) this._discoveryManager = discoveryManager;
    return this;
  }

  /**
   * 同步 SharedContext 数据到 MemoryStore
   */
  syncFromSharedContext() {
    if (!this._sharedContext) return;

    // 同步 signals - 优化查找性能
    const signals = this._sharedContext.getSignals?.() || [];
    const existingSignalIds = new Set(this.L1.signals.map(s => s.id));
    for (const sig of signals) {
      if (!existingSignalIds.has(sig.id)) {
        this.L1.signals.push({ ...sig, ts: sig.ts || Date.now() });
      }
    }

    // 同步 stage summaries
    const summaries = this._sharedContext.getAllSummaries?.() || {};
    for (const [stage, summary] of Object.entries(summaries)) {
      this.L2.stageSummaries.set(stage, summary);
    }

    // 同步 decisions - 优化查找性能
    const decisions = this._sharedContext.getDecisions?.() || [];
    const existingDecisionIds = new Set(this.L1.decisions.map(d => d.id));
    for (const d of decisions) {
      if (!existingDecisionIds.has(d.id)) {
        this.L1.decisions.push({ ...d, ts: d.ts || Date.now() });
      }
    }
  }

  /**
   * 同步 DiscoveryManager 数据到 MemoryStore
   */
  syncFromDiscoveryManager() {
    if (!this._discoveryManager) return;

    const discoveries = this._discoveryManager.getAllDiscoveries?.() || [];
    for (const d of discoveries) {
      this.L1.syncTable.discoveries.set(d.id, {
        id: d.id,
        status: d.status || "open",
        keywords: d.keywords || [],
        by: d.by || null,
        ts: d.ts || Date.now(),
      });
    }
  }

  /**
   * 从底层组件同步所有数据
   */
  syncAll() {
    this.syncFromSharedContext();
    this.syncFromDiscoveryManager();
  }
}

export default MemoryStore;
