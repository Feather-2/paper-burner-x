/**
 * MemoryStore - 统一记忆管理
 *
 * 分层架构:
 * - L0: Immutable (不可压缩) - systemPrompt, taskGoal, todos
 * - L1: Working (工作记忆) - messages, signals, decisions, syncTable
 * - L2: Condensed (压缩记忆) - historySummary, stageSummaries, claims
 * - L3: Archive (归档) - snapshots, index, checkpoints
 */

import { isPlainObject, toNonEmptyString, deepClone } from "../../shared/utils/value-utils.js";
import { estimateTokensCached } from "../../shared/utils/token-cache.js";
import { getGlobalTokenCounter } from "../../shared/tokenizers/adaptive-token-counter.js";
import { makeSecureTimestampedId } from "../../shared/utils/secure-id.js";
import { Platform } from "../../shared/platform.js";
import { DisposableBase } from "../../shared/base/disposable-base.js";
import { RetrievalEngine } from "./retrieval-engine.js";
import { L3Storage } from "./l3-storage.js";
import { normalizeTodoEntry, normalizeTodoInPlace, normalizeTodoStatus } from "./todo-normalize.js";

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

// 估算对象字节大小（粗略）
function estimateBytes(obj) {
  if (obj === null || obj === undefined) return 0;
  if (typeof obj === "string") return obj.length * 2; // UTF-16
  if (typeof obj === "number") return 8;
  if (typeof obj === "boolean") return 4;
  try {
    return JSON.stringify(obj).length * 2;
  } catch {
    return 1024; // fallback
  }
}

// Token 估算 (4 chars ≈ 1 token)
function estimateTokens(text, tokenCounter) {
  if (text === null || text === undefined) return 0;
  let rawText = "";
  if (typeof text === "string") {
    rawText = text;
  } else {
    try {
      rawText = JSON.stringify(text);
    } catch {
      rawText = String(text);
    }
  }
  return estimateTokensCached(rawText, tokenCounter);
}

// 截断文本
function truncate(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// 生成唯一 ID
function genId(prefix = "id") {
  return makeSecureTimestampedId(prefix);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** @typedef {import("../context/snapshotable.js").Snapshotable} Snapshotable */

/**
 * MemoryStore - 统一记忆管理
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
      L0: true,  // Mark dirty on init
      L1: true,
      L2: true,
      L3: false,
    };
    this._lastSnapshotTs = 0;
  }

  async _getL3Storage() {
    const existing = this._l3Storage;
    if (existing) return existing;
    const vfs = this._vfs;
    if (!vfs) return null;

    const inFlight = this._l3StoragePromise;
    if (inFlight) return await inFlight;

    this._l3StoragePromise = (async () => {
      const created = new L3Storage({ vfs, runId: this.runId });
      this._l3Storage = created;
      return created;
    })();

    return await this._l3StoragePromise;
  }

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

  // Read-only layer snapshots (external callers must use APIs to mutate).
  // COW 优化: getter 返回 frozen 浅拷贝，避免每次深拷贝开销
  // 需要深拷贝时使用 cloneL0() / cloneL1() / cloneL2() / cloneL3()

  get L0() {
    // 浅拷贝 + freeze，防止外部直接修改
    const shallow = {
      systemPrompt: this._L0.systemPrompt,
      taskGoal: this._L0.taskGoal,
      todos: Object.freeze([...this._L0.todos]),  // 数组浅拷贝
    };
    return Object.freeze(shallow);
  }

  get L1() {
    const shallow = {
      messages: Object.freeze([...this._L1.messages]),
      signals: Object.freeze([...this._L1.signals]),
      decisions: Object.freeze([...this._L1.decisions]),
      syncTable: Object.freeze({
        discoveries: this._L1.syncTable.discoveries,  // Map 引用，外部不应修改
        subagents: this._L1.syncTable.subagents,
      }),
      scratchpad: Object.freeze({ ...this._L1.scratchpad }),
      flags: Object.freeze({ ...this._L1.flags }),
    };
    return Object.freeze(shallow);
  }

  get L2() {
    const shallow = {
      historySummary: this._L2.historySummary,
      stageSummaries: this._L2.stageSummaries,  // Map 引用
      claims: Object.freeze([...this._L2.claims]),
    };
    return Object.freeze(shallow);
  }

  get L3() {
    const shallow = {
      snapshots: this._L3.snapshots,  // Map 引用
      index: Object.freeze({
        keywords: this._L3.index.keywords,
        stages: this._L3.index.stages,
        timeline: Object.freeze([...this._L3.index.timeline]),
      }),
      checkpoints: Object.freeze([...this._L3.checkpoints]),
    };
    return Object.freeze(shallow);
  }

  // 显式深拷贝方法（用于 checkpoint/backtrack 等需要独立副本的场景）
  cloneL0() {
    return deepClone(this._L0);
  }

  cloneL1() {
    return deepClone(this._L1);
  }

  cloneL2() {
    return deepClone(this._L2);
  }

  cloneL3() {
    return deepClone(this._L3);
  }

  // ===== L0: Immutable =====

  setSystemPrompt(prompt) {
    const next = toNonEmptyString(prompt) || "";
    const prev = this._L0.systemPrompt;
    if (next === prev) return;

    this._L0.systemPrompt = next;
    this._markDirty("L0");
    const delta = estimateTokens(next, this._tokenCounter) - estimateTokens(prev, this._tokenCounter);
    this._stats.l0Tokens += delta;
    this._stats.tokenUsage += delta;
  }

  setTaskGoal(goal) {
    this._L0.taskGoal = toNonEmptyString(goal) || "";
    this._markDirty("L0");
  }

  getTaskGoal() {
    return this._L0.taskGoal || "";
  }

  addTodo(todo) {
    const entry = normalizeTodoEntry(todo, { generateId: genId, fillTimestamps: false });
    // Avoid accidental duplicates when callers re-add an existing todoId.
    const key = toNonEmptyString(entry.todoId) || toNonEmptyString(entry.id);
    if (key) {
      const existing = this._L0.todos.find((t) => String(t?.todoId || t?.id || "") === key);
      if (existing) {
        const beforeTokens = estimateTokens(existing?.content, this._tokenCounter);
        const updatedAt = new Date().toISOString();
        const next = { ...existing, ...entry, updatedAt };
        normalizeTodoInPlace(next);
        const afterTokens = estimateTokens(next?.content, this._tokenCounter);
        Object.assign(existing, next);
        const delta = afterTokens - beforeTokens;
        this._stats.l0Tokens += delta;
        this._stats.tokenUsage += delta;
        this._markDirty("L0");
        return existing;
      }
    }

    this._L0.todos.push(entry);
    const addedTokens = estimateTokens(entry?.content, this._tokenCounter);
    this._stats.l0Tokens += addedTokens;
    this._stats.tokenUsage += addedTokens;
    this._markDirty("L0");
    return entry;
  }

  updateTodo(id, data) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const todo = this._L0.todos.find((t) => String(t?.id || "") === key || String(t?.todoId || "") === key);
    if (todo && isPlainObject(data)) {
      const beforeTokens = estimateTokens(todo?.content, this._tokenCounter);
      const updatedAt = new Date().toISOString();
      const next = { ...todo, ...data, updatedAt };
      normalizeTodoInPlace(next);
      const afterTokens = estimateTokens(next?.content, this._tokenCounter);
      Object.assign(todo, next);
      const delta = afterTokens - beforeTokens;
      this._stats.l0Tokens += delta;
      this._stats.tokenUsage += delta;
      this._markDirty("L0");
    }
    return todo || null;
  }

  removeTodo(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const idx = this._L0.todos.findIndex((t) => String(t?.id || "") === key || String(t?.todoId || "") === key);
    if (idx >= 0) {
      const removed = this._L0.todos.splice(idx, 1)[0];
      const removedTokens = estimateTokens(removed?.content, this._tokenCounter);
      this._stats.l0Tokens -= removedTokens;
      this._stats.tokenUsage -= removedTokens;
      this._markDirty("L0");
      return removed;
    }
    return null;
  }

  /**
   * Get todos with optional filtering.
   *
   * Backward compatible forms:
   * - `getTodos()` → all todos
   * - `getTodos((t) => ...)` → predicate filter
   * - `getTodos("pending"|"done"|...)` → status filter
   * - `getTodos({ status, filter })` → explicit options
   *
   * @param {undefined|string|((todo: any) => boolean)|{status?:string,filter?:((todo: any) => boolean)}} [filter]
   */
  getTodos(filter) {
    if (typeof filter === "function") {
      return this._L0.todos.filter(filter);
    }
    if (typeof filter === "string") {
      const wanted = normalizeTodoStatus(filter);
      return this._L0.todos.filter((t) => normalizeTodoStatus(t?.status) === wanted);
    }
    if (isPlainObject(filter)) {
      const wanted = typeof filter.status === "string" ? normalizeTodoStatus(filter.status) : null;
      const pred = typeof filter.filter === "function" ? filter.filter : null;
      return this._L0.todos.filter((t) => {
        if (wanted && normalizeTodoStatus(t?.status) !== wanted) return false;
        if (pred && !pred(t)) return false;
        return true;
      });
    }
    return [...this._L0.todos];
  }

  /**
   * Replace the entire todo list in one operation (avoids external mutation of L0).
   * @param {any[]} todos
   * @returns {any[]}
   */
  replaceTodos(todos) {
    const next = Array.isArray(todos) ? todos.map((t) => normalizeTodoEntry(t, { generateId: genId, fillTimestamps: false })) : [];
    const prev = Array.isArray(this._L0.todos) ? this._L0.todos : [];

    let prevTokens = 0;
    for (const t of prev) prevTokens += estimateTokens(t?.content, this._tokenCounter);
    let nextTokens = 0;
    for (const t of next) nextTokens += estimateTokens(t?.content, this._tokenCounter);

    this._L0.todos = next;
    const delta = nextTokens - prevTokens;
    this._stats.l0Tokens += delta;
    this._stats.tokenUsage += delta;
    this._markDirty("L0");
    return [...this._L0.todos];
  }

  // ===== L1: Working =====

  addMessage(msg) {
    const message = isPlainObject(msg) ? msg : { role: "user", content: String(msg) };
    this._L1.messages.push(message);
    const addedTokens = estimateTokens(message?.content, this._tokenCounter);
    this._stats.l1Tokens += addedTokens;
    this._stats.tokenUsage += addedTokens;
    this._markDirty("L1");
    this._checkCompress();
    return message;
  }

  /**
   * Batch add messages efficiently (avoids external mutation of L1).
   * @param {any[]} messages
   * @returns {any[]}
   */
  addMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (list.length === 0) return [];

    const added = [];
    let addedTokens = 0;
    for (const msg of list) {
      const message = isPlainObject(msg) ? msg : { role: "user", content: String(msg) };
      this._L1.messages.push(message);
      addedTokens += estimateTokens(message?.content, this._tokenCounter);
      added.push(message);
    }
    this._stats.l1Tokens += addedTokens;
    this._stats.tokenUsage += addedTokens;
    this._markDirty("L1");
    this._checkCompress();
    return added;
  }

  getMessages() {
    return [...this._L1.messages];
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
    this._L1.signals.push(entry);
    this._pruneArray(this._L1.signals, this.config.maxSignals);
    this._markDirty("L1");
    return entry;
  }

  acknowledgeSignal(id) {
    const sig = this._L1.signals.find(s => s.id === id);
    if (sig) {
      sig.acknowledged = true;
      this._markDirty("L1");
    }
    return sig;
  }

  getSignals(filter) {
    const signals = this._L1.signals;
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
    this._L1.decisions.push(entry);
    this._pruneArray(this._L1.decisions, this.config.maxDecisions);
    this._markDirty("L1");
    return entry;
  }

  getDecisions(limit = 10) {
    return this._L1.decisions.slice(-limit);
  }

  // ===== L1: Scratchpad & Flags (Memory 2.0) =====

  getScratchpad(key) {
    if (key === undefined) return { ...this._L1.scratchpad };
    return this._L1.scratchpad[key];
  }

  setScratchpad(key, value) {
    if (isPlainObject(key) && value === undefined) {
      Object.assign(this._L1.scratchpad, key);
    } else {
      this._L1.scratchpad[key] = value;
    }
    this._markDirty("L1");
    this._emitUpdate("scratchpad", { key, value });
  }

  clearScratchpad() {
    this._L1.scratchpad = {};
    this._markDirty("L1");
    this._emitUpdate("scratchpad", { cleared: true });
  }

  getFlags() {
    return { ...this._L1.flags };
  }

  setFlag(name, value) {
    if (name in this._L1.flags) {
      this._L1.flags[name] = Boolean(value);
      this._markDirty("L1");
      this._emitUpdate("flags", { [name]: value });
    }
  }

  get awaitUserFeedback() {
    return this._L1.flags.awaitUserFeedback;
  }

  set awaitUserFeedback(value) {
    this.setFlag("awaitUserFeedback", value);
  }

  get taskImpossible() {
    return this._L1.flags.taskImpossible;
  }

  set taskImpossible(value) {
    this.setFlag("taskImpossible", value);
  }

  // ===== L1: SyncTable (跨 SubAgent 同步) =====

  syncDiscovery(id, data) {
    const existing = this._L1.syncTable.discoveries.get(id);
    const payload = isPlainObject(data) ? data : {};
    const prev = isPlainObject(existing) ? existing : null;
    const entry = {
      ...(prev || {}),
      ...payload,
      id,
      ts: Date.now(),
    };

    if (!toNonEmptyString(entry.status)) {
      entry.status = toNonEmptyString(prev?.status) || "open";
    }
    if (!Array.isArray(entry.keywords)) {
      entry.keywords = Array.isArray(prev?.keywords) ? prev.keywords : [];
    }
    if (!("by" in entry)) {
      entry.by = prev?.by ?? null;
    }
    this._L1.syncTable.discoveries.set(id, entry);
    this._markDirty("L1");
    return entry;
  }

  getDiscovery(id) {
    return this._L1.syncTable.discoveries.get(id) || null;
  }

  getAllDiscoveries() {
    return Array.from(this._L1.syncTable.discoveries.values());
  }

  syncSubagent(id, data) {
    const existing = this._L1.syncTable.subagents.get(id);
    const payload = isPlainObject(data) ? data : {};
    const prev = isPlainObject(existing) ? existing : null;
    const entry = {
      ...(prev || {}),
      ...payload,
      id,
      ts: Date.now(),
    };

    if (!toNonEmptyString(entry.status)) {
      entry.status = toNonEmptyString(prev?.status) || "pending";
    }
    if (!isFiniteNumber(entry.progress)) {
      entry.progress = isFiniteNumber(prev?.progress) ? prev.progress : 0;
    }
    if (!("result" in entry)) {
      entry.result = prev?.result ?? null;
    }
    this._L1.syncTable.subagents.set(id, entry);
    this._markDirty("L1");
    return entry;
  }

  getSubagent(id) {
    return this._L1.syncTable.subagents.get(id) || null;
  }

  getAllSubagents() {
    return Array.from(this._L1.syncTable.subagents.values());
  }

  // ===== L2: Condensed =====

  setStageSummary(stage, summary) {
    const s = toNonEmptyString(stage);
    if (s) {
      this._L2.stageSummaries.set(s, toNonEmptyString(summary) || "");
      this._markDirty("L2");
    }
  }

  getStageSummary(stage) {
    return this._L2.stageSummaries.get(stage) || "";
  }

  getAllStageSummaries() {
    return Object.fromEntries(this._L2.stageSummaries);
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
    this._L2.claims.push(entry);
    this._markDirty("L2");
    return entry;
  }

  getClaims(filter) {
    if (typeof filter === "function") return this._L2.claims.filter(filter);
    return [...this._L2.claims];
  }

  /**
   * Replace the entire claim list (avoids external mutation of L2).
   * @param {any[]} claims
   * @returns {any[]}
   */
  replaceClaims(claims) {
    this._L2.claims = Array.isArray(claims) ? deepClone(claims) : [];
    this._markDirty("L2");
    return [...this._L2.claims];
  }

  // ===== L3: Archive =====

  /**
   * 淘汰最老的 snapshot 以释放空间
   * @private
   */
  _evictOldestSnapshot() {
    const timeline = this._L3.index.timeline;
    if (timeline.length === 0) return;

    const oldest = timeline.shift();
    if (!oldest?.id) return;

    const entry = this._L3.snapshots.get(oldest.id);
    if (entry) {
      this._l3BytesUsed -= estimateBytes(entry);
      this._L3.snapshots.delete(oldest.id);
    }

    // 清理关键词索引
    for (const [, idSet] of this._L3.index.keywords) {
      idSet.delete(oldest.id);
    }
  }

  /**
   * 淘汰最老的 checkpoint 以释放空间
   * @private
   */
  _evictOldestCheckpoint() {
    if (this._L3.checkpoints.length === 0) return;
    const oldest = this._L3.checkpoints.shift();
    if (oldest) {
      this._l3BytesUsed -= estimateBytes(oldest);
    }
  }

  /**
   * 确保 L3 字节使用在限制内
   * @private
   * @param {number} incomingBytes - 即将添加的字节数
   */
  _ensureL3Capacity(incomingBytes) {
    const maxBytes = this.config.maxL3Bytes;
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) return;

    // 优先淘汰 snapshots（摘要，重要性较低）
    while (this._l3BytesUsed + incomingBytes > maxBytes && this._L3.index.timeline.length > 0) {
      this._evictOldestSnapshot();
    }
    // 其次淘汰 checkpoints（保留更多，因为可能被 backtrack 依赖）
    while (this._l3BytesUsed + incomingBytes > maxBytes && this._L3.checkpoints.length > 1) {
      this._evictOldestCheckpoint();
    }
  }

  async archive(stageKey, data, keywords = []) {
    const l3Storage = await this._getL3Storage();
    if (l3Storage) {
      const id = await l3Storage.archive(stageKey, data, keywords);
      const entry = await l3Storage.getSnapshot(id);
      if (entry) {
        this._emit("memory.archived", { id, stageKey: entry.stageKey, summary: entry.summary, ts: entry.ts });
      } else {
        this._emit("memory.archived", { id, stageKey, ts: Date.now() });
      }
      return id;
    }

    const id = genId("snap");
    const entry = {
      id,
      stageKey,
      data,
      summary: data.summary || truncate(JSON.stringify(data), 200),
      ts: Date.now(),
    };

    const entryBytes = estimateBytes(entry);
    this._ensureL3Capacity(entryBytes);

    // 存储
    this._L3.snapshots.set(id, entry);
    this._l3BytesUsed += entryBytes;
    this._markDirty("L3");

    // 建立关键词索引
    for (const kw of keywords) {
      const k = toNonEmptyString(kw)?.toLowerCase();
      if (!k) continue;
      if (!this._L3.index.keywords.has(k)) {
        this._L3.index.keywords.set(k, new Set());
      }
      this._L3.index.keywords.get(k).add(id);
    }

    // 阶段索引
    if (stageKey) {
      this._L3.index.stages.set(stageKey, id);
    }

    // 时间线
    this._L3.index.timeline.push({ id, ts: entry.ts, summary: entry.summary });
    this._emit("memory.archived", { id, stageKey: entry.stageKey, summary: entry.summary, ts: entry.ts });

    return id;
  }

  _getRetrievalEngine() {
    const engine = this._retrievalEngine;
    if (engine && typeof engine === "object" && typeof engine.recall === "function") return engine;
    const next = new RetrievalEngine({
      memoryStore: this,
      embeddingService: this._embeddingService,
      vectorIndex: this._vectorIndex,
      eventBus: this.eventBus,
    });
    this._retrievalEngine = next;
    return next;
  }

  /**
   * @deprecated Use `new RetrievalEngine({ memoryStore }).recall(...)`.
   */
  recall(query, limit = 3) {
    return this._getRetrievalEngine().recall(query, limit);
  }

  /**
   * @deprecated Use `new RetrievalEngine({ memoryStore }).semanticRecall(...)`.
   */
  async semanticRecall(query, options) {
    return await this._getRetrievalEngine().semanticRecall(query, options);
  }

  /**
   * @deprecated Use `new RetrievalEngine({ memoryStore }).hybridRecall(...)`.
   */
  async hybridRecall(query, options) {
    return await this._getRetrievalEngine().hybridRecall(query, options);
  }

  listArchives(limit = 10) {
    return this._L3.index.timeline.slice(-limit).reverse();
  }

  async getSnapshot(snapshotId) {
    const l3Storage = await this._getL3Storage();
    if (l3Storage) return await l3Storage.getSnapshot(snapshotId);

    const id = toNonEmptyString(snapshotId);
    if (!id) return null;
    return this._L3.snapshots.get(id) || null;
  }

  // ===== Checkpoint =====

  /**
   * Create a checkpoint (uses incremental if dirty tracking available)
   * @param {Object} [options]
   * @param {boolean} [options.incremental=true] - Use incremental snapshot if possible
   * @param {number} [options.fullSnapshotEvery=5] - Force full snapshot every N checkpoints
   * @returns {Promise<string>} Checkpoint ID
   */
  async checkpoint(options) {
    const opts = isPlainObject(options) ? options : {};
    const incremental = opts.incremental ?? true;
    const fullSnapshotEvery = opts.fullSnapshotEvery ?? 5;

    const l3Storage = await this._getL3Storage();
    if (l3Storage) {
      this._recalculateTotalTokens();

      const id = genId("ckpt");
      const ts = Date.now();

      const checkpointIndex = await l3Storage.listCheckpoints();
      const checkpointCount = Array.isArray(checkpointIndex) ? checkpointIndex.length : 0;
      const shouldFull = !incremental || checkpointCount % fullSnapshotEvery === 0;

      /** @type {any} */
      let snapshot;
      if (shouldFull || !this._hasAnyDirty()) {
        snapshot = {
          id,
          runId: this.runId,
          ts,
          encoding: "full",
          L0: this.cloneL0(),
          L1: this.cloneL1(),
          L2: this.cloneL2(),
        };
      } else {
        snapshot = {
          id,
          runId: this.runId,
          ts,
          encoding: "incremental",
          dirtyLayers: { ...this._dirty },
        };
        if (this._dirty.L0) snapshot.L0 = this.cloneL0();
        if (this._dirty.L1) snapshot.L1 = this.cloneL1();
        if (this._dirty.L2) snapshot.L2 = this.cloneL2();

        const lastMeta = checkpointCount > 0 ? checkpointIndex[checkpointCount - 1] : null;
        const baseId = toNonEmptyString(lastMeta?.id);
        if (baseId) snapshot.baseId = baseId;
      }

      await l3Storage.checkpoint(snapshot);
      this._clearDirty();
      return id;
    }

    this._recalculateTotalTokens();
    const id = genId("ckpt");
    const ts = Date.now();

    const checkpointCount = this._L3.checkpoints.length;
    const shouldFull = !incremental || checkpointCount % fullSnapshotEvery === 0;

    /** @type {{
     *   id: string,
     *   runId: string,
     *   ts: number,
     *   encoding: string,
     *   dirtyLayers?: { L0: boolean, L1: boolean, L2: boolean, L3: boolean },
     *   baseId?: string,
     *   L0?: any,
     *   L1?: any,
     *   L2?: any,
     * }} */
    let snapshot;
    if (shouldFull || !this._hasAnyDirty()) {
      // Full snapshot
      snapshot = {
        id,
        runId: this.runId,
        ts,
        encoding: "full",
        L0: this.cloneL0(),
        L1: this.cloneL1(),
        L2: this.cloneL2(),
      };
    } else {
      // Incremental: only clone dirty layers
      snapshot = {
        id,
        runId: this.runId,
        ts,
        encoding: "incremental",
        dirtyLayers: { ...this._dirty },
      };
      if (this._dirty.L0) snapshot.L0 = this.cloneL0();
      if (this._dirty.L1) snapshot.L1 = this.cloneL1();
      if (this._dirty.L2) snapshot.L2 = this.cloneL2();

      // Store base checkpoint reference for restore
      const lastCkpt = this._L3.checkpoints[checkpointCount - 1];
      if (lastCkpt) snapshot.baseId = lastCkpt.id;
    }

    const snapshotBytes = estimateBytes(snapshot);
    this._ensureL3Capacity(snapshotBytes);

    this._L3.checkpoints.push(snapshot);
    this._l3BytesUsed += snapshotBytes;
    this._clearDirty(); // Reset dirty flags after checkpoint
    return id;
  }

  /**
   * Check if any layer is dirty
   * @private
   */
  _hasAnyDirty() {
    return this._dirty.L0 || this._dirty.L1 || this._dirty.L2 || this._dirty.L3;
  }

  async restore(checkpointId) {
    const l3Storage = await this._getL3Storage();
    if (l3Storage) {
      const id = toNonEmptyString(checkpointId);
      if (!id) return false;

      const ckpt = await l3Storage.getCheckpoint(id);
      if (!ckpt) return false;

      if (ckpt.encoding === "incremental" && ckpt.baseId) {
        const baseRestored = await this._restoreFromBaseStorage(ckpt, l3Storage);
        if (!baseRestored) {
          if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
          if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
          if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
        }
      } else {
        if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
        if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
        if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
      }

      this._updateTokenUsage();
      this._clearDirty();
      return true;
    }

    const ckpt = this._L3.checkpoints.find(c => c.id === checkpointId);
    if (!ckpt) return false;

    if (ckpt.encoding === "incremental" && ckpt.baseId) {
      // Incremental restore: first restore base, then apply incremental
      const baseRestored = this._restoreFromBase(ckpt);
      if (!baseRestored) {
        // Fallback: if we have the layers, use them directly
        if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
        if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
        if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
      }
    } else {
      // Full restore
      if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
      if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
      if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
    }

    this._updateTokenUsage();
    this._clearDirty();
    return true;
  }

  /**
   * Restore from base checkpoint then apply incremental changes
   * @private
   */
  _restoreFromBase(incrementalCkpt) {
    // Find the nearest full checkpoint
    let baseId = incrementalCkpt.baseId;
    const chain = [incrementalCkpt];

    while (baseId) {
      const base = this._L3.checkpoints.find(c => c.id === baseId);
      if (!base) break;
      chain.unshift(base);
      if (base.encoding === "full") {
        // Found full checkpoint, apply chain
        for (const ckpt of chain) {
          if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
          if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
          if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
        }
        return true;
      }
      baseId = base.baseId;
    }

    return false;
  }

  async _restoreFromBaseStorage(incrementalCkpt, l3Storage) {
    let baseId = toNonEmptyString(incrementalCkpt?.baseId);
    const chain = [incrementalCkpt];
    const seen = new Set([toNonEmptyString(incrementalCkpt?.id) || ""]);

    while (baseId) {
      if (seen.has(baseId)) break;
      seen.add(baseId);

      const base = await l3Storage.getCheckpoint(baseId);
      if (!base) break;
      chain.unshift(base);
      if (base.encoding === "full") {
        for (const ckpt of chain) {
          if (ckpt.L0) this._L0 = deepClone(ckpt.L0);
          if (ckpt.L1) this._L1 = deepClone(ckpt.L1);
          if (ckpt.L2) this._L2 = deepClone(ckpt.L2);
        }
        return true;
      }
      baseId = toNonEmptyString(base.baseId);
    }

    return false;
  }

  getLatestCheckpoint() {
    return this._L3.checkpoints[this._L3.checkpoints.length - 1] || null;
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
    const existingSignalIds = new Set(this._L1.signals.map(s => s.id));
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
    const existingDecisionIds = new Set(this._L1.decisions.map(d => d.id));
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
   * 重新计算 L3 字节使用量
   * @private
   */
  _recalculateL3Bytes() {
    let total = 0;
    for (const entry of this._L3.snapshots.values()) {
      total += estimateBytes(entry);
    }
    for (const ckpt of this._L3.checkpoints) {
      total += estimateBytes(ckpt);
    }
    this._l3BytesUsed = total;
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

export default MemoryStore;
