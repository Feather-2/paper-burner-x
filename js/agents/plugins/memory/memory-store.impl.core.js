/**
 * MemoryStore - 统一记忆管理
 *
 * 分层架构:
 * - L0: Immutable (不可压缩) - systemPrompt, taskGoal, todos
 * - L1: Working (工作记忆) - messages, signals, decisions, syncTable
 * - L2: Condensed (压缩记忆) - historySummary, stageSummaries, claims
 * - L3: Archive (归档) - snapshots, index, checkpoints
 */

import { deepClone, isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { getGlobalTokenCounter, Platform, DisposableBase } from "../../shared/index.js";
import { normalizeTodoStatus } from "./todo-normalize.js";
import { defineL0Layer } from "./memory-store.impl.l0.js";
import { defineL1Layer } from "./memory-store.impl.l1.js";
import { defineL2Layer } from "./memory-store.impl.l2.js";
import { defineL3Layer } from "./memory-store.impl.l3.js";
import { estimateTokens, genId, truncate } from "./memory-store.impl.utils.js";

// 默认配置
const DEFAULT_CONFIG = Object.freeze({
  maxMessages: 20,        // L1 最大消息数
  maxSignals: 50,         // L1 最大信号数
  maxDecisions: 30,       // L1 最大决策数
  keepLastTurns: 6,       // 压缩时保留最近轮数
  compressThreshold: 0.8, // 触发压缩的填充率
  contextWindow: 128000,  // 上下文窗口大小
  // L3 归档/检查点总上限：浏览器 5GB，Node/Bun/Deno 无限制
  maxL3Bytes: Platform.isBrowser ? 5 * 1024 * 1024 * 1024 : Infinity,
});

/** @typedef {import("../../runtime/core/context/snapshotable.js").Snapshotable} Snapshotable */

/**
 * MemoryStore - 统一记忆管理
 *
 * Note: L0/L1/L2/L3 APIs are mixed in at runtime via `Object.defineProperties()`.
 * These declarations keep `tsc --checkJs` happy without altering runtime behavior.
 *
 * @property {() => Record<string, string>} getAllStageSummaries
 * @property {() => any[]} getAllDiscoveries
 * @property {() => any[]} getAllSubagents
 * @property {(filter?: "pending" | ((signal: any) => boolean)) => any[]} getSignals
 * @property {(limit?: number) => any[]} getDecisions
 * @property {() => void} _recalculateL3Bytes
 *
 * @implements {Snapshotable}
 * @extends {DisposableBase}
 */
export class MemoryStore extends DisposableBase {
  constructor(options = {}) {
    super();
    this.runId = toNonEmptyString(options.runId) || genId("run");
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.eventBus = options.eventBus || null;
    this.archiveAdapter = options.archiveAdapter || null;
    this._tokenCounter = options.tokenCounter === null ? null : options.tokenCounter || getGlobalTokenCounter();

    this._embeddingService = options.embeddingService && typeof options.embeddingService === "object" ? options.embeddingService : null;
    this._vectorIndex = options.vectorIndex && typeof options.vectorIndex === "object" ? options.vectorIndex : null;
    this._retrievalEngine = options.retrievalEngine && typeof options.retrievalEngine === "object" ? options.retrievalEngine : null;

    // 委托层：渐进式统一，内部持有底层组件引用
    this._sharedContext = options.sharedContext || null;
    this._discoveryManager = options.discoveryManager || null;

    /** @private */
    this._vfs = null;
    /** @private */
    this._l3Storage = null;
    /** @private */
    this._l3StoragePromise = null;

    const l3Storage = options.l3Storage;
    if (l3Storage && typeof l3Storage === "object") {
      this._l3Storage = l3Storage;
    } else if (options.vfs && typeof options.vfs === "object") {
      // Lazily construct L3Storage when first needed.
      this._vfs = options.vfs;
      this._l3Storage = null;
    }

    // Internal layers (do not expose mutable references).
    this._L0 = {
      systemPrompt: "",
      taskGoal: "",
      todos: [],
    };

    // L1: Working (工作记忆)
    this._L1 = {
      messages: [],
      signals: [],
      decisions: [],
      syncTable: {
        discoveries: new Map(), // id → {id, status, keywords, by, ts}
        subagents: new Map(),   // id → {id, status, progress, ts}
      },
      // Memory 2.0: 统一运行时状态
      scratchpad: {},          // 阶段临时数据
      flags: {
        awaitUserFeedback: false,
        taskImpossible: false,
      },
    };

    // L2: Condensed (压缩记忆)
    this._L2 = {
      historySummary: "",
      stageSummaries: new Map(), // stage → summary
      claims: [],
    };

    // L3: Archive (归档)
    this._L3 = {
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
      l0Tokens: 0,
      l1Tokens: 0,
      l2Tokens: 0,
      tokenUsage: 0,
      compressionCount: 0,
      recallCount: 0,
    };

    // L3 字节使用统计
    this._l3BytesUsed = 0;

    // Dirty tracking for incremental snapshots
    this._dirty = {
      L0: true, // Mark dirty on init
      L1: true,
      L2: true,
      L3: false,
    };
    this._lastSnapshotTs = 0;
  }

  // NOTE: L0/L1/L2/L3 methods are injected at runtime via defineL*Layer().
  // The stubs below keep `tsc --checkJs` happy; they will be overwritten by Object.defineProperties().

  /** @returns {Record<string, string>} */
  getAllStageSummaries() {
    return Object.fromEntries(this._L2?.stageSummaries || []);
  }

  /** @returns {any[]} */
  getAllDiscoveries() {
    const discoveries = this._L1?.syncTable?.discoveries;
    return discoveries instanceof Map ? Array.from(discoveries.values()) : [];
  }

  /** @returns {any[]} */
  getAllSubagents() {
    const subagents = this._L1?.syncTable?.subagents;
    return subagents instanceof Map ? Array.from(subagents.values()) : [];
  }

  /**
   * @param {"pending" | ((signal: any) => boolean)=} filter
   * @returns {any[]}
   */
  getSignals(filter) {
    const signals = Array.isArray(this._L1?.signals) ? this._L1.signals : [];
    if (typeof filter === "function") return signals.filter(filter);
    if (filter === "pending") return signals.filter((s) => !s?.acknowledged);
    return [...signals];
  }

  /**
   * @param {number=} limit
   * @returns {any[]}
   */
  getDecisions(limit = 10) {
    const decisions = Array.isArray(this._L1?.decisions) ? this._L1.decisions : [];
    return decisions.slice(-limit);
  }

  _recalculateL3Bytes() {}

  _markDirty(layer) {
    if (layer in this._dirty) this._dirty[layer] = true;
  }

  _clearDirty(layer) {
    if (layer !== undefined) {
      if (layer in this._dirty) this._dirty[layer] = false;
    } else {
      this._dirty.L0 = false;
      this._dirty.L1 = false;
      this._dirty.L2 = false;
      this._dirty.L3 = false;
    }
  }

  // ===== Compression =====

  compress({ force = false } = {}) {
    const { keepLastTurns, contextWindow, compressThreshold } = this.config;
    const messages = Array.isArray(this._L1.messages) ? this._L1.messages : [];
    if (messages.length === 0) return false;

    const thresholdRaw = Number.isFinite(contextWindow) && Number.isFinite(compressThreshold) ? contextWindow * compressThreshold : NaN;
    const threshold = Number.isFinite(thresholdRaw) ? Math.max(1, Math.floor(thresholdRaw)) : 0;
    const overBudget = force || (threshold > 0 && this._stats.tokenUsage >= threshold);
    if (!overBudget && messages.length <= keepLastTurns * 2) return false;

    // 分离：保留最近 N 轮，压缩其余
    const splitByTurns = (turnsToKeep) => {
      const kept = [];
      const toCompress = [];
      let turnCount = 0;

      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (turnCount < turnsToKeep) {
          kept.unshift(msg);
          if (msg.role === "assistant") turnCount++;
        } else {
          toCompress.unshift(msg);
        }
      }

      return { kept, toCompress };
    };

    let turnsToKeep =
      typeof keepLastTurns === "number" && Number.isFinite(keepLastTurns) ? Math.max(1, Math.floor(keepLastTurns)) : 1;
    let { kept, toCompress } = splitByTurns(turnsToKeep);

    // Token-based fallback: when over budget, we may need to compress even within the last keepLastTurns.
    if (overBudget) {
      while (toCompress.length === 0 && turnsToKeep > 1) {
        turnsToKeep -= 1;
        ({ kept, toCompress } = splitByTurns(turnsToKeep));
      }

      // Still nothing to compress (e.g., no assistant turns): keep only the last few messages.
      if (toCompress.length === 0 && messages.length > 2) {
        kept = messages.slice(-2);
        toCompress = messages.slice(0, -2);
      }
    }

    if (toCompress.length === 0) return false;

    // 生成摘要
    const hadHistorySummary = Boolean(this._L2.historySummary);
    const summary = this._summarizeMessages(toCompress);
    this._L2.historySummary = this._L2.historySummary
      ? `${this._L2.historySummary}\n${summary}`
      : summary;
    this._markDirty("L2");

    const addedL2Tokens = estimateTokens(summary, this._tokenCounter) + (hadHistorySummary ? estimateTokens("\n", this._tokenCounter) : 0);
    this._stats.l2Tokens += addedL2Tokens;
    this._stats.tokenUsage += addedL2Tokens;

    // 更新消息
    this._L1.messages = kept;
    this._markDirty("L1");
    this._stats.compressionCount++;

    const prevL1Tokens = this._stats.l1Tokens;
    let nextL1Tokens = 0;
    for (const msg of this._L1.messages) {
      nextL1Tokens += estimateTokens(msg?.content, this._tokenCounter);
    }
    this._stats.l1Tokens = nextL1Tokens;
    this._stats.tokenUsage += nextL1Tokens - prevL1Tokens;

    this._emit("memory:compressed", {
      compressedCount: toCompress.length,
      keptCount: kept.length,
    });
    this._emit("memory:l2:compress", {
      compressedCount: toCompress.length,
      keptCount: kept.length,
      summaryTokens: addedL2Tokens,
    });

    return true;
  }

  // ===== Build Prompt Context =====

  buildPromptContext() {
    const sections = [];

    // L0: 不可变层
    if (this._L0.taskGoal) {
      sections.push(`## 目标\n${this._L0.taskGoal}`);
    }

    if (this._L0.todos.length > 0) {
      const isClosed = (t) => {
        const st = normalizeTodoStatus(t?.status);
        return st === "completed" || st === "cancelled" || st === "done";
      };
      const todoLines = this._L0.todos.map((t) => {
        const st = normalizeTodoStatus(t?.status);
        const status = st === "completed" || st === "done" ? "✓" : st === "in_progress" ? "→" : "○";
        const text = t?.text || t?.content || t?.title || "(无描述)";
        return `${status} ${text}`;
      });
      const openCount = this._L0.todos.filter((t) => !isClosed(t)).length;
      sections.push(`## 待办 (${openCount}/${this._L0.todos.length})\n${todoLines.join("\n")}`);
    }

    // L2: 压缩摘要
    if (this._L2.historySummary) {
      sections.push(`## 历史摘要\n${truncate(this._L2.historySummary, 500)}`);
    }

    const summaries = this.getAllStageSummaries();
    if (Object.keys(summaries).length > 0) {
      const lines = Object.entries(summaries).map(([k, v]) => `[${k}] ${truncate(v, 100)}`);
      sections.push(`## 阶段发现\n${lines.join("\n")}`);
    }

    // L1: 同步表
    const discoveries = this.getAllDiscoveries();
    const pendingDiscoveries = discoveries.filter((d) => d.status !== "satisfied");
    if (pendingDiscoveries.length > 0) {
      const lines = pendingDiscoveries.slice(-5).map((d) => `- ${d.id}: ${d.status}${d.keywords?.length ? ` [${d.keywords.join(",")}]` : ""}`);
      sections.push(`## 待验证 (${pendingDiscoveries.length})\n${lines.join("\n")}`);
    }

    const subagents = this.getAllSubagents();
    const activeSubagents = subagents.filter((s) => s.status !== "completed" && s.status !== "failed");
    if (activeSubagents.length > 0) {
      const lines = activeSubagents.map((s) => `- ${s.id}: ${s.status} (${s.progress || 0}%)`);
      sections.push(`## SubAgents (${activeSubagents.length})\n${lines.join("\n")}`);
    }

    // L1: 待处理信号
    const pendingSignals = this.getSignals("pending");
    if (pendingSignals.length > 0) {
      const lines = pendingSignals.slice(-5).map((s) => `- [${s.type}] ${s.message || JSON.stringify(s.payload)}`);
      sections.push(`## 待处理信号\n${lines.join("\n")}`);
    }

    // L1: 最近决策
    const recentDecisions = this.getDecisions(3);
    if (recentDecisions.length > 0) {
      const lines = recentDecisions.map((d) => `- ${d.action}${d.reason ? `: ${d.reason}` : ""}`);
      sections.push(`## 最近决策\n${lines.join("\n")}`);
    }

    return sections.length > 0 ? sections.join("\n\n") : "";
  }

  // ===== Utilities =====

  _recalculateTotalTokens() {
    const total = (this._stats.l0Tokens || 0) + (this._stats.l1Tokens || 0) + (this._stats.l2Tokens || 0);
    this._stats.tokenUsage = total;
    return total;
  }

  _updateTokenUsage() {
    let l0Tokens = 0;
    l0Tokens += estimateTokens(this._L0.systemPrompt, this._tokenCounter);
    const todos = Array.isArray(this._L0.todos) ? this._L0.todos : [];
    for (const todo of todos) {
      l0Tokens += estimateTokens(todo?.content, this._tokenCounter);
    }

    let l1Tokens = 0;
    const messages = Array.isArray(this._L1.messages) ? this._L1.messages : [];
    for (const msg of messages) {
      l1Tokens += estimateTokens(msg?.content, this._tokenCounter);
    }

    const l2Tokens = estimateTokens(this._L2.historySummary, this._tokenCounter);

    this._stats.l0Tokens = l0Tokens;
    this._stats.l1Tokens = l1Tokens;
    this._stats.l2Tokens = l2Tokens;
    return this._recalculateTotalTokens();
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
      .filter((t) => t.length >= 2);
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
    this._emit("memory:updated", { field, delta, ts: Date.now() });
  }

  // ===== Stats =====

  getStats() {
    this._recalculateTotalTokens();
    return {
      runId: this.runId,
      tokenUsage: this._stats.tokenUsage,
      messageCount: this._L1.messages.length,
      todoCount: this._L0.todos.length,
      signalCount: this._L1.signals.length,
      decisionCount: this._L1.decisions.length,
      discoveryCount: this._L1.syncTable.discoveries.size,
      subagentCount: this._L1.syncTable.subagents.size,
      claimCount: this._L2.claims.length,
      archiveCount: this._L3.snapshots.size,
      checkpointCount: this._L3.checkpoints.length,
      compressionCount: this._stats.compressionCount,
      recallCount: this._stats.recallCount,
    };
  }

  /**
   * Get structured metrics for observability.
   * @returns {{
   *   l1: { messageCount: number, signalCount: number, decisionCount: number, tokenEstimate: number },
   *   l2: { stageSummaryCount: number, claimCount: number },
   *   l3: { archiveCount: number, checkpointCount: number },
   *   operations: { recallCount: number, compressCount: number, archiveCount: number }
   * }}
   */
  getMetrics() {
    this._recalculateTotalTokens();
    return {
      l1: {
        messageCount: this._L1.messages.length,
        signalCount: this._L1.signals.length,
        decisionCount: this._L1.decisions.length,
        tokenEstimate: this._stats.l1Tokens || 0,
      },
      l2: {
        stageSummaryCount: this._L2.stageSummaries.size,
        claimCount: this._L2.claims.length,
      },
      l3: {
        archiveCount: this._L3.snapshots.size,
        checkpointCount: this._L3.checkpoints.length,
      },
      operations: {
        recallCount: this._stats.recallCount || 0,
        compressCount: this._stats.compressionCount || 0,
        archiveCount: this._stats.archiveCount || 0,
      },
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
   * @param {{ sharedContext?: any, discoveryManager?: any } | undefined} [input]
   * @returns {this}
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
    const existingSignalIds = new Set(this._L1.signals.map((s) => s.id));
    for (const sig of signals) {
      if (!existingSignalIds.has(sig.id)) {
        this._L1.signals.push({ ...sig, ts: sig.ts || Date.now() });
      }
    }

    // 同步 stage summaries
    const summaries = this._sharedContext.getAllSummaries?.() || {};
    for (const [stage, summary] of Object.entries(summaries)) {
      this._L2.stageSummaries.set(stage, summary);
    }

    // 同步 decisions - 优化查找性能
    const decisions = this._sharedContext.getDecisions?.() || [];
    const existingDecisionIds = new Set(this._L1.decisions.map((d) => d.id));
    for (const d of decisions) {
      if (!existingDecisionIds.has(d.id)) {
        this._L1.decisions.push({ ...d, ts: d.ts || Date.now() });
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
      this._L1.syncTable.discoveries.set(d.id, {
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

  // ===== Snapshot / Restore =====

  /**
   * Serialize MemoryStore state for checkpoints.
   * Keep this schema stable: consumers (UnifiedAgentContext / Backtrack) should not reach into L0/L1/L2 internals.
   *
   * @param {{includeL3?:boolean, incremental?:boolean}=} options
   * - includeL3: Include L3 archive data (default: false)
   * - incremental: Only include dirty layers (default: false)
   */
  toSnapshot({ includeL3 = false, incremental = false } = {}) {
    const withL3 = includeL3 === true;
    this._recalculateTotalTokens();

    const snapshot = {
      schemaVersion: "0.1",
      runId: this.runId,
      ts: new Date().toISOString(),
      config: deepClone(this.config),
      stats: { ...this._stats },
      // Track which layers are included (for incremental restore)
      _dirtyLayers: incremental ? { ...this._dirty } : null,
    };

    // L0: Always include if dirty or full snapshot
    if (!incremental || this._dirty.L0) {
      snapshot.L0 = deepClone(this._L0);
    }

    // L1: Always include if dirty or full snapshot
    if (!incremental || this._dirty.L1) {
      snapshot.L1 = {
        messages: deepClone(this._L1.messages),
        signals: deepClone(this._L1.signals),
        decisions: deepClone(this._L1.decisions),
        syncTable: {
          discoveries: Array.from(this._L1.syncTable.discoveries.entries()),
          subagents: Array.from(this._L1.syncTable.subagents.entries()),
        },
        scratchpad: deepClone(this._L1.scratchpad || {}),
        flags: { ...this._L1.flags },
      };
    }

    // L2: Always include if dirty or full snapshot
    if (!incremental || this._dirty.L2) {
      snapshot.L2 = {
        historySummary: this._L2.historySummary,
        stageSummaries: Array.from(this._L2.stageSummaries.entries()),
        claims: deepClone(this._L2.claims),
      };
    }

    // L3: Only if requested AND (dirty or full)
    if (withL3 && (!incremental || this._dirty.L3)) {
      snapshot.L3 = {
        snapshots: Array.from(this._L3.snapshots.entries()),
        index: {
          keywords: Array.from(this._L3.index.keywords.entries()).map(([k, set]) => [k, Array.from(set || [])]),
          stages: Array.from(this._L3.index.stages.entries()),
          timeline: deepClone(this._L3.index.timeline),
        },
        checkpoints: deepClone(this._L3.checkpoints),
      };
    }

    // Clear dirty flags after snapshot
    if (incremental) {
      this._clearDirty();
    }
    this._lastSnapshotTs = Date.now();

    return snapshot;
  }

  /**
   * Restore MemoryStore state from a snapshot created by toSnapshot().
   * Supports incremental snapshots: only restores layers present in the snapshot.
   *
   * @param {object} snapshot
   */
  fromSnapshot(snapshot) {
    const s = snapshot && typeof snapshot === "object" ? snapshot : null;
    if (!s) return false;

    // Check if this is an incremental snapshot
    const isIncremental = s._dirtyLayers !== null && typeof s._dirtyLayers === "object";

    if (typeof s.runId === "string" && s.runId) this.runId = s.runId;
    if (s.config && typeof s.config === "object") this.config = { ...DEFAULT_CONFIG, ...s.config };

    // L0: Only restore if present (full snapshot or L0 was dirty)
    if (s.L0 && typeof s.L0 === "object") {
      const l0 = s.L0;
      this._L0.systemPrompt = toNonEmptyString(l0.systemPrompt) || "";
      this._L0.taskGoal = toNonEmptyString(l0.taskGoal) || "";
      this._L0.todos = Array.isArray(l0.todos) ? deepClone(l0.todos) : [];
    }

    // L1: Only restore if present
    if (s.L1 && typeof s.L1 === "object") {
      const l1 = s.L1;
      this._L1.messages = Array.isArray(l1.messages) ? deepClone(l1.messages) : [];
      this._L1.signals = Array.isArray(l1.signals) ? deepClone(l1.signals) : [];
      this._L1.decisions = Array.isArray(l1.decisions) ? deepClone(l1.decisions) : [];

      const sync = l1.syncTable && typeof l1.syncTable === "object" ? l1.syncTable : {};
      this._L1.syncTable.discoveries = new Map(Array.isArray(sync.discoveries) ? sync.discoveries : []);
      this._L1.syncTable.subagents = new Map(Array.isArray(sync.subagents) ? sync.subagents : []);

      this._L1.scratchpad = isPlainObject(l1.scratchpad) ? deepClone(l1.scratchpad) : {};
      this._L1.flags = isPlainObject(l1.flags) ? { ...this._L1.flags, ...l1.flags } : { ...this._L1.flags };
    }

    // L2: Only restore if present
    if (s.L2 && typeof s.L2 === "object") {
      const l2 = s.L2;
      this._L2.historySummary = typeof l2.historySummary === "string" ? l2.historySummary : "";
      this._L2.stageSummaries = new Map(Array.isArray(l2.stageSummaries) ? l2.stageSummaries : []);
      this._L2.claims = Array.isArray(l2.claims) ? deepClone(l2.claims) : [];
    }

    // L3: Only restore if present
    if (s.L3 && typeof s.L3 === "object") {
      const l3 = s.L3;
      this._L3.snapshots = new Map(Array.isArray(l3.snapshots) ? l3.snapshots : []);
      const index = l3.index && typeof l3.index === "object" ? l3.index : {};
      this._L3.index.keywords = new Map(
        Array.isArray(index.keywords) ? index.keywords.map(([k, arr]) => [k, new Set(Array.isArray(arr) ? arr : [])]) : []
      );
      this._L3.index.stages = new Map(Array.isArray(index.stages) ? index.stages : []);
      this._L3.index.timeline = Array.isArray(index.timeline) ? deepClone(index.timeline) : [];
      this._L3.checkpoints = Array.isArray(l3.checkpoints) ? deepClone(l3.checkpoints) : [];
    }

    if (s.stats && typeof s.stats === "object") {
      this._stats = { ...this._stats, ...s.stats };
    }

    // 重算 L3 字节使用量
    this._recalculateL3Bytes();

    // Clear dirty flags after restore (state is now in sync)
    this._clearDirty();
    this._updateTokenUsage();
    return true;
  }

  /**
   * 释放资源（DisposableBase 钩子）
   * @protected
   * @override
   * @returns {Promise<void>}
   */
  async _onDispose() {
    // 清理 RetrievalEngine（会解除其 eventBus 订阅）
    if (this._retrievalEngine) {
      if (typeof this._retrievalEngine.dispose === "function") {
        try {
          this._retrievalEngine.dispose();
        } catch {
          // ignore
        }
      }
      this._retrievalEngine = null;
    }

    // 清理 L3Storage
    if (this._l3Storage) {
      if (typeof this._l3Storage.dispose === "function") {
        try {
          await this._l3Storage.dispose();
        } catch {
          // ignore
        }
      }
      this._l3Storage = null;
    }
    this._l3StoragePromise = null;

    // 清理委托层引用
    this._sharedContext = null;
    this._discoveryManager = null;

    // 清理 eventBus 引用（不清理 eventBus 本身，它可能是外部传入的）
    this.eventBus = null;
  }
}

Object.defineProperties(MemoryStore.prototype, defineL0Layer());
Object.defineProperties(MemoryStore.prototype, defineL1Layer());
Object.defineProperties(MemoryStore.prototype, defineL2Layer());
Object.defineProperties(MemoryStore.prototype, defineL3Layer());

export default MemoryStore;
