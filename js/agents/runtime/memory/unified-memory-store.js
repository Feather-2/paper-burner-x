/**
 * UnifiedMemoryStore - 统一记忆存储
 *
 * 内核：StateEngine (dispatch/reducer + action history + Lamport clock)
 * 外壳：MemoryStore 风格的直接 API（内部转 dispatch）
 *
 * 设计目标：
 * - 单一状态源（SSOT）：所有层数据统一存放在 StateEngine state 中
 * - 兼容性：保留 StateEngine 订阅/重放/时钟等能力，同时提供 MemoryStore 便捷方法
 * - 低开销读取：L0/L1/L2/L3 getter 返回 frozen 浅拷贝（COW）
 */

import { isPlainObject, toNonEmptyString, deepClone } from "../../shared/utils/value-utils.js";
import { estimateTokensCached } from "../../shared/utils/token-cache.js";
import { getGlobalTokenCounter } from "../../shared/tokenizers/adaptive-token-counter.js";
import { makeSecureTimestampedId } from "../../shared/utils/secure-id.js";

import { diffLayers } from "./state-diff.js";
import { RetrievalEngine } from "./retrieval-engine.js";
import { StateEngine } from "./state-engine.js";
import {
  L0_SET_SYSTEM_PROMPT,
  L0_SET_TASK_GOAL,
  L0_ADD_TODO,
  L0_UPDATE_TODO,
  L0_REMOVE_TODO,
  L0_REPLACE_TODOS,
  L1_ADD_MESSAGE,
  L1_ADD_MESSAGES,
  L1_CLEAR_MESSAGES,
  L1_SET_MESSAGES,
  L1_SET_DECK,
  L1_ADD_SIGNAL,
  L1_ACKNOWLEDGE_SIGNAL,
  L1_RECORD_DECISION,
  L1_SET_SCRATCHPAD,
  L1_CLEAR_SCRATCHPAD,
  L1_SET_FLAG,
  L1_SYNC_DISCOVERY,
  L1_SYNC_SUBAGENT,
  L2_SET_HISTORY_SUMMARY,
  L2_APPEND_HISTORY_SUMMARY,
  L2_SET_STAGE_SUMMARY,
  L2_ADD_CLAIM,
  L2_REPLACE_CLAIMS,
  L3_ARCHIVE,
  L3_ADD_CHECKPOINT,
} from "./action-types.js";
import { normalizeTodoEntry, normalizeTodoStatus } from "./todo-normalize.js";

// 默认配置（保持与 MemoryStore 一致）
const DEFAULT_CONFIG = Object.freeze({
  maxMessages: 20,
  maxSignals: 50,
  maxDecisions: 30,
  keepLastTurns: 6,
  compressThreshold: 0.8,
  contextWindow: 128000,
});

function estimateTokensValue(text, tokenCounter) {
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

function truncate(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

function genId(prefix = "id") {
  return makeSecureTimestampedId(prefix);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export class UnifiedMemoryStore {
  constructor(options = {}) {
    this.runId = toNonEmptyString(options.runId) || genId("run");
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.eventBus = options.eventBus || null;
    this.archiveAdapter = options.archiveAdapter || null;
    this._tokenCounter = options.tokenCounter === null ? null : options.tokenCounter || getGlobalTokenCounter();

    this._embeddingService = options.embeddingService && typeof options.embeddingService === "object" ? options.embeddingService : null;
    this._vectorIndex = options.vectorIndex && typeof options.vectorIndex === "object" ? options.vectorIndex : null;
    this._retrievalEngine = options.retrievalEngine && typeof options.retrievalEngine === "object" ? options.retrievalEngine : null;

    // 委托层：工具层兼容
    this._sharedContext = options.sharedContext || null;
    this._discoveryManager = options.discoveryManager || null;

    // StateEngine 作为 SSOT
    this._engine = new StateEngine({
      initialState: {
        ...(isPlainObject(options.initialState) ? options.initialState : null),
        runId: this.runId,
      },
      maxActionHistory: isFiniteNumber(options.maxActionHistory) ? options.maxActionHistory : 1000,
      enableActionHistory: options.enableActionHistory !== false,
      eventBus: this.eventBus,
      actorId: options.actorId || this.runId,
    });

    // 统计
    this._stats = {
      l0Tokens: 0,
      l1Tokens: 0,
      l2Tokens: 0,
      tokenUsage: 0,
      compressionCount: 0,
      recallCount: 0,
    };

    // Dirty tracking for incremental snapshots/checkpoints
    this._dirty = {
      L0: true,
      L1: true,
      L2: true,
      L3: false,
    };
    this._lastSnapshotTs = 0;

    // Keep dirty flags in sync with state changes.
    this._unsubscribeEngine = this._engine.subscribe((action, prevState, nextState) => {
      const diff = diffLayers(prevState, nextState);
      for (const [layer, changed] of Object.entries(diff)) {
        if (changed) this._markDirty(layer);
      }
      // Token stats are recalculated lazily to avoid per-action overhead.
    });
  }

  dispose() {
    if (this._unsubscribeEngine) {
      try {
        this._unsubscribeEngine();
      } catch {
        // ignore
      }
      this._unsubscribeEngine = null;
    }
    if (this._retrievalEngine?.dispose) {
      try {
        this._retrievalEngine.dispose();
      } catch {
        // ignore
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Core (StateEngine delegation)
  // ─────────────────────────────────────────────────────────────────────────────

  dispatch(action) {
    return this._engine.dispatch(action);
  }

  dispatchSync(action) {
    return this._engine.dispatchSync(action);
  }

  dispatchBatch(actions) {
    return this._engine.dispatchBatch(actions);
  }

  dispatchBatchSync(actions) {
    return this._engine.dispatchBatchSync(actions);
  }

  subscribe(listenerOrLayer, layerListener) {
    return this._engine.subscribe(listenerOrLayer, layerListener);
  }

  subscribeLayer(layer, listener) {
    return this._engine.subscribeLayer(layer, listener);
  }

  getActionHistory(limit) {
    return this._engine.getActionHistory(limit);
  }

  replay(actions, initialState) {
    return this._engine.replay(actions, initialState);
  }

  getClockValue() {
    return this._engine.getClockValue();
  }

  receiveClockValue(externalSeq) {
    return this._engine.receiveClockValue(externalSeq);
  }

  getState() {
    return this._engine.getState();
  }

  /**
   * @private
   */
  _getStateRef() {
    return this._engine._getStateRef();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Read-only layer snapshots (COW getters)
  // ─────────────────────────────────────────────────────────────────────────────

  get L0() {
    const s = this._getStateRef();
    const shallow = {
      systemPrompt: s.L0.systemPrompt,
      taskGoal: s.L0.taskGoal,
      todos: Object.freeze([...(Array.isArray(s.L0.todos) ? s.L0.todos : [])]),
    };
    return Object.freeze(shallow);
  }

  get L1() {
    const s = this._getStateRef();
    const L1 = s.L1 || {};
    const shallow = {
      messages: Object.freeze([...(Array.isArray(L1.messages) ? L1.messages : [])]),
      signals: Object.freeze([...(Array.isArray(L1.signals) ? L1.signals : [])]),
      decisions: Object.freeze([...(Array.isArray(L1.decisions) ? L1.decisions : [])]),
      deck: Object.prototype.hasOwnProperty.call(L1, "deck") ? L1.deck : null,
      syncTable: Object.freeze({
        discoveries: L1.syncTable?.discoveries || {},
        subagents: L1.syncTable?.subagents || {},
      }),
      scratchpad: Object.freeze({ ...(isPlainObject(L1.scratchpad) ? L1.scratchpad : {}) }),
      flags: Object.freeze({ ...(isPlainObject(L1.flags) ? L1.flags : {}) }),
    };
    return Object.freeze(shallow);
  }

  get L2() {
    const s = this._getStateRef();
    const L2 = s.L2 || {};
    const shallow = {
      historySummary: toNonEmptyString(L2.historySummary) || "",
      stageSummaries: L2.stageSummaries || {},
      decisions: Object.freeze([...(Array.isArray(L2.decisions) ? L2.decisions : [])]),
      claims: Object.freeze([...(Array.isArray(L2.claims) ? L2.claims : [])]),
    };
    return Object.freeze(shallow);
  }

  get L3() {
    const s = this._getStateRef();
    const L3 = s.L3 || {};
    const shallow = {
      snapshots: L3.snapshots || {},
      index: Object.freeze({
        keywords: L3.index?.keywords || {},
        stages: L3.index?.stages || {},
        timeline: Object.freeze([...(Array.isArray(L3.index?.timeline) ? L3.index.timeline : [])]),
      }),
      checkpoints: Object.freeze([...(Array.isArray(L3.checkpoints) ? L3.checkpoints : [])]),
    };
    return Object.freeze(shallow);
  }

  cloneL0() {
    return deepClone(this._getStateRef().L0);
  }

  cloneL1() {
    return deepClone(this._getStateRef().L1);
  }

  cloneL2() {
    return deepClone(this._getStateRef().L2);
  }

  cloneL3() {
    return deepClone(this._getStateRef().L3);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // L0: Immutable (MemoryStore-style API)
  // ─────────────────────────────────────────────────────────────────────────────

  setSystemPrompt(prompt) {
    const next = toNonEmptyString(prompt) || "";
    const prev = toNonEmptyString(this._getStateRef().L0?.systemPrompt) || "";
    if (next === prev) return;
    this.dispatchSync({ type: L0_SET_SYSTEM_PROMPT, payload: { prompt: next } });
  }

  setTaskGoal(goal) {
    const next = toNonEmptyString(goal) || "";
    const prev = toNonEmptyString(this._getStateRef().L0?.taskGoal) || "";
    if (next === prev) return;
    this.dispatchSync({ type: L0_SET_TASK_GOAL, payload: { goal: next } });
  }

  getTaskGoal() {
    return toNonEmptyString(this._getStateRef().L0?.taskGoal) || "";
  }

  addTodo(todo) {
    const entry = normalizeTodoEntry(todo, { generateId: genId, fillTimestamps: true });
    const key = toNonEmptyString(entry.todoId) || toNonEmptyString(entry.id);
    this.dispatchSync({ type: L0_ADD_TODO, payload: { todo: entry } });
    if (!key) return null;
    const todos = this._getStateRef().L0?.todos || [];
    return todos.find((t) => t?.id === key || t?.todoId === key) || null;
  }

  updateTodo(id, data) {
    const key = toNonEmptyString(id);
    if (!key || !isPlainObject(data)) return null;
    this.dispatchSync({ type: L0_UPDATE_TODO, payload: { id: key, updates: data } });
    const todos = this._getStateRef().L0?.todos || [];
    return todos.find((t) => t?.id === key || t?.todoId === key) || null;
  }

  removeTodo(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const prev = this._getStateRef().L0?.todos || [];
    const removed = prev.find((t) => t?.id === key || t?.todoId === key) || null;
    this.dispatchSync({ type: L0_REMOVE_TODO, payload: { id: key } });
    return removed;
  }

  /**
   * @param {undefined|string|((todo: any) => boolean)|{status?:string,filter?:((todo: any) => boolean)}} [filter]
   */
  getTodos(filter) {
    const todos = Array.isArray(this._getStateRef().L0?.todos) ? this._getStateRef().L0.todos : [];

    if (typeof filter === "function") {
      return todos.filter(filter);
    }
    if (typeof filter === "string") {
      const wanted = normalizeTodoStatus(filter);
      return todos.filter((t) => normalizeTodoStatus(t?.status) === wanted);
    }
    if (isPlainObject(filter)) {
      const wanted = typeof filter.status === "string" ? normalizeTodoStatus(filter.status) : null;
      const pred = typeof filter.filter === "function" ? filter.filter : null;
      return todos.filter((t) => {
        if (wanted && normalizeTodoStatus(t?.status) !== wanted) return false;
        if (pred && !pred(t)) return false;
        return true;
      });
    }
    return [...todos];
  }

  replaceTodos(todos) {
    const next = Array.isArray(todos)
      ? todos.map((t) => normalizeTodoEntry(t, { generateId: genId, fillTimestamps: true }))
      : [];
    this.dispatchSync({ type: L0_REPLACE_TODOS, payload: { todos: next } });
    return this.getTodos();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // L1: Working (MemoryStore-style API)
  // ─────────────────────────────────────────────────────────────────────────────

  addMessage(msg) {
    const prevLen = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages.length : 0;
    this.dispatchSync({ type: L1_ADD_MESSAGE, payload: { message: msg } });
    this._checkCompress();
    const messages = this._getStateRef().L1?.messages || [];
    return messages[prevLen] || messages[messages.length - 1] || null;
  }

  addMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (list.length === 0) return [];
    const prevLen = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages.length : 0;
    this.dispatchSync({ type: L1_ADD_MESSAGES, payload: { messages: list } });
    this._checkCompress();
    const next = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages : [];
    return next.slice(prevLen);
  }

  getMessages() {
    const messages = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages : [];
    return [...messages];
  }

  clearMessages() {
    this.dispatchSync({ type: L1_CLEAR_MESSAGES, payload: {} });
  }

  setMessages(messages) {
    this.dispatchSync({ type: L1_SET_MESSAGES, payload: { messages: Array.isArray(messages) ? messages : [] } });
  }

  setDeck(deck) {
    this.dispatchSync({ type: L1_SET_DECK, payload: { deck } });
  }

  addSignal(signal) {
    const prevLen = Array.isArray(this._getStateRef().L1?.signals) ? this._getStateRef().L1.signals.length : 0;
    this.dispatchSync({ type: L1_ADD_SIGNAL, payload: { signal } });
    const signals = Array.isArray(this._getStateRef().L1?.signals) ? this._getStateRef().L1.signals : [];
    return signals[prevLen] || signals[signals.length - 1] || null;
  }

  acknowledgeSignal(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    this.dispatchSync({ type: L1_ACKNOWLEDGE_SIGNAL, payload: { id: key } });
    const signals = Array.isArray(this._getStateRef().L1?.signals) ? this._getStateRef().L1.signals : [];
    return signals.find((s) => s?.id === key) || null;
  }

  getSignals(filter) {
    const signals = Array.isArray(this._getStateRef().L1?.signals) ? this._getStateRef().L1.signals : [];
    if (typeof filter === "function") return signals.filter(filter);
    if (filter === "pending") return signals.filter((s) => !s?.acknowledged);
    return [...signals];
  }

  recordDecision(decision) {
    const prevLen = Array.isArray(this._getStateRef().L1?.decisions) ? this._getStateRef().L1.decisions.length : 0;
    this.dispatchSync({ type: L1_RECORD_DECISION, payload: { decision } });
    const decisions = Array.isArray(this._getStateRef().L1?.decisions) ? this._getStateRef().L1.decisions : [];
    return decisions[prevLen] || decisions[decisions.length - 1] || null;
  }

  getDecisions(limit = 10) {
    const decisions = Array.isArray(this._getStateRef().L1?.decisions) ? this._getStateRef().L1.decisions : [];
    const n = typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
    return decisions.slice(-n);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // L1: Scratchpad & Flags
  // ─────────────────────────────────────────────────────────────────────────────

  getScratchpad(key) {
    const scratchpad = isPlainObject(this._getStateRef().L1?.scratchpad) ? this._getStateRef().L1.scratchpad : {};
    if (key === undefined) return { ...scratchpad };
    return scratchpad[key];
  }

  setScratchpad(key, value) {
    this.dispatchSync({ type: L1_SET_SCRATCHPAD, payload: { key, value } });
    this._emitUpdate("scratchpad", { key, value });
  }

  clearScratchpad() {
    this.dispatchSync({ type: L1_CLEAR_SCRATCHPAD, payload: {} });
    this._emitUpdate("scratchpad", { cleared: true });
  }

  getFlags() {
    const flags = isPlainObject(this._getStateRef().L1?.flags) ? this._getStateRef().L1.flags : {};
    return { ...flags };
  }

  setFlag(name, value) {
    const n = toNonEmptyString(name);
    if (!n) return;
    this.dispatchSync({ type: L1_SET_FLAG, payload: { name: n, value: Boolean(value) } });
    this._emitUpdate("flags", { [n]: Boolean(value) });
  }

  get awaitUserFeedback() {
    return Boolean(this._getStateRef().L1?.flags?.awaitUserFeedback);
  }

  set awaitUserFeedback(value) {
    this.setFlag("awaitUserFeedback", value);
  }

  get taskImpossible() {
    return Boolean(this._getStateRef().L1?.flags?.taskImpossible);
  }

  set taskImpossible(value) {
    this.setFlag("taskImpossible", value);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // L1: SyncTable
  // ─────────────────────────────────────────────────────────────────────────────

  syncDiscovery(id, data) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const payload = isPlainObject(data) ? data : {};
    this.dispatchSync({ type: L1_SYNC_DISCOVERY, payload: { id: key, data: payload } });
    return this.getDiscovery(key);
  }

  getDiscovery(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const table = this._getStateRef().L1?.syncTable?.discoveries;
    return (table && typeof table === "object" ? table[key] : null) || null;
  }

  getAllDiscoveries() {
    const table = this._getStateRef().L1?.syncTable?.discoveries;
    if (!table || typeof table !== "object") return [];
    return Object.values(table);
  }

  syncSubagent(id, data) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const payload = isPlainObject(data) ? data : {};
    this.dispatchSync({ type: L1_SYNC_SUBAGENT, payload: { id: key, data: payload } });
    return this.getSubagent(key);
  }

  getSubagent(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const table = this._getStateRef().L1?.syncTable?.subagents;
    return (table && typeof table === "object" ? table[key] : null) || null;
  }

  getAllSubagents() {
    const table = this._getStateRef().L1?.syncTable?.subagents;
    if (!table || typeof table !== "object") return [];
    return Object.values(table);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // L2: Condensed (MemoryStore-style API)
  // ─────────────────────────────────────────────────────────────────────────────

  setStageSummary(stage, summary) {
    const s = toNonEmptyString(stage);
    if (!s) return;
    this.dispatchSync({ type: L2_SET_STAGE_SUMMARY, payload: { stage: s, summary: toNonEmptyString(summary) || "" } });
  }

  getStageSummary(stage) {
    const s = toNonEmptyString(stage);
    if (!s) return "";
    const obj = this._getStateRef().L2?.stageSummaries;
    return (obj && typeof obj === "object" ? obj[s] : null) || "";
  }

  getAllStageSummaries() {
    const obj = this._getStateRef().L2?.stageSummaries;
    return obj && typeof obj === "object" ? { ...obj } : {};
  }

  addClaim(claim) {
    const prevLen = Array.isArray(this._getStateRef().L2?.claims) ? this._getStateRef().L2.claims.length : 0;
    this.dispatchSync({ type: L2_ADD_CLAIM, payload: { claim } });
    const claims = Array.isArray(this._getStateRef().L2?.claims) ? this._getStateRef().L2.claims : [];
    return claims[prevLen] || claims[claims.length - 1] || null;
  }

  getClaims(filter) {
    const claims = Array.isArray(this._getStateRef().L2?.claims) ? this._getStateRef().L2.claims : [];
    if (typeof filter === "function") return claims.filter(filter);
    return [...claims];
  }

  replaceClaims(claims) {
    this.dispatchSync({ type: L2_REPLACE_CLAIMS, payload: { claims: Array.isArray(claims) ? deepClone(claims) : [] } });
    return this.getClaims();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // L3: Archive (MemoryStore-style API)
  // ─────────────────────────────────────────────────────────────────────────────

  archive(stageKey, data, keywords = []) {
    const prevLen = Array.isArray(this._getStateRef().L3?.index?.timeline) ? this._getStateRef().L3.index.timeline.length : 0;
    this.dispatchSync({ type: L3_ARCHIVE, payload: { stageKey, data, keywords } });
    const timeline = Array.isArray(this._getStateRef().L3?.index?.timeline) ? this._getStateRef().L3.index.timeline : [];
    const last = timeline[timeline.length - 1];
    const id = toNonEmptyString(last?.id);
    if (id) {
      const snap = this._getStateRef().L3?.snapshots?.[id] || null;
      this._emit("memory.archived", { id, stageKey: last?.stageKey || stageKey || null, summary: snap?.summary || last?.summary, ts: last?.ts });
    }
    // No-op: keep API compatible even if archive didn't change state.
    return id || (timeline.length > prevLen ? timeline[timeline.length - 1]?.id : null);
  }

  listArchives(limit = 10) {
    const timeline = Array.isArray(this._getStateRef().L3?.index?.timeline) ? this._getStateRef().L3.index.timeline : [];
    const n = typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
    return timeline.slice(-n).reverse();
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
    this._stats.recallCount += 1;
    return this._getRetrievalEngine().recall(query, limit);
  }

  /**
   * @deprecated Use `new RetrievalEngine({ memoryStore }).semanticRecall(...)`.
   */
  async semanticRecall(query, options) {
    this._stats.recallCount += 1;
    return await this._getRetrievalEngine().semanticRecall(query, options);
  }

  /**
   * @deprecated Use `new RetrievalEngine({ memoryStore }).hybridRecall(...)`.
   */
  async hybridRecall(query, options) {
    this._stats.recallCount += 1;
    return await this._getRetrievalEngine().hybridRecall(query, options);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Checkpoint / Restore (MemoryStore-style)
  // ─────────────────────────────────────────────────────────────────────────────

  checkpoint({ incremental = true, fullSnapshotEvery = 5 } = {}) {
    this._updateTokenUsage();
    const id = genId("ckpt");
    const ts = Date.now();

    const checkpoints = Array.isArray(this._getStateRef().L3?.checkpoints) ? this._getStateRef().L3.checkpoints : [];
    const checkpointCount = checkpoints.length;
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

      const last = checkpoints[checkpointCount - 1];
      if (last?.id) snapshot.baseId = last.id;
    }

    this.dispatchSync({ type: L3_ADD_CHECKPOINT, payload: { checkpoint: deepClone(snapshot) } });
    this._clearDirty();
    return id;
  }

  restore(checkpointId) {
    const id = toNonEmptyString(checkpointId);
    if (!id) return false;

    const checkpoints = Array.isArray(this._getStateRef().L3?.checkpoints) ? this._getStateRef().L3.checkpoints : [];
    const ckpt = checkpoints.find((c) => c?.id === id) || null;
    if (!ckpt) return false;

    const restored = this._restoreCheckpointLayers(ckpt, checkpoints);
    if (!restored) return false;

    const prev = this._getStateRef();
    const nextState = {
      ...prev,
      L0: restored.L0,
      L1: restored.L1,
      L2: restored.L2,
    };

    this._engine.restoreSnapshot({ state: nextState, clock: this.getClockValue(), ts: Date.now() });
    this._updateTokenUsage();
    this._clearDirty();
    return true;
  }

  _restoreCheckpointLayers(ckpt, checkpoints) {
    if (ckpt.encoding === "incremental" && ckpt.baseId) {
      // Incremental restore: find nearest full base, then apply chain in order.
      let baseId = ckpt.baseId;
      const chain = [ckpt];
      while (baseId) {
        const base = checkpoints.find((c) => c?.id === baseId);
        if (!base) break;
        chain.unshift(base);
        if (base.encoding === "full") break;
        baseId = base.baseId;
      }
      const full = chain.find((c) => c?.encoding === "full");
      if (!full) return null;

      /** @type {any} */
      let L0 = deepClone(full.L0 || {});
      /** @type {any} */
      let L1 = deepClone(full.L1 || {});
      /** @type {any} */
      let L2 = deepClone(full.L2 || {});

      for (const node of chain) {
        if (node.L0) L0 = deepClone(node.L0);
        if (node.L1) L1 = deepClone(node.L1);
        if (node.L2) L2 = deepClone(node.L2);
      }
      return { L0, L1, L2 };
    }

    // Full restore (or incremental without a valid base): use what we have.
    const L0 = deepClone(ckpt.L0 || {});
    const L1 = deepClone(ckpt.L1 || {});
    const L2 = deepClone(ckpt.L2 || {});
    return { L0, L1, L2 };
  }

  getLatestCheckpoint() {
    const checkpoints = Array.isArray(this._getStateRef().L3?.checkpoints) ? this._getStateRef().L3.checkpoints : [];
    return checkpoints[checkpoints.length - 1] || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Compression
  // ─────────────────────────────────────────────────────────────────────────────

  compress({ force = false } = {}) {
    const { keepLastTurns, contextWindow, compressThreshold } = this.config;
    const messages = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages : [];
    if (messages.length === 0) return false;

    this._updateTokenUsage();
    const thresholdRaw = Number.isFinite(contextWindow) && Number.isFinite(compressThreshold) ? contextWindow * compressThreshold : NaN;
    const threshold = Number.isFinite(thresholdRaw) ? Math.max(1, Math.floor(thresholdRaw)) : 0;
    const overBudget = force || (threshold > 0 && this._stats.tokenUsage >= threshold);
    if (!overBudget && messages.length <= keepLastTurns * 2) return false;

    const splitByTurns = (turnsToKeep) => {
      const kept = [];
      const toCompress = [];
      let turnCount = 0;

      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (turnCount < turnsToKeep) {
          kept.unshift(msg);
          if (msg?.role === "assistant") turnCount++;
        } else {
          toCompress.unshift(msg);
        }
      }
      return { kept, toCompress };
    };

    let turnsToKeep = typeof keepLastTurns === "number" && Number.isFinite(keepLastTurns) ? Math.max(1, Math.floor(keepLastTurns)) : 1;
    let { kept, toCompress } = splitByTurns(turnsToKeep);

    if (overBudget) {
      while (toCompress.length === 0 && turnsToKeep > 1) {
        turnsToKeep -= 1;
        ({ kept, toCompress } = splitByTurns(turnsToKeep));
      }
      if (toCompress.length === 0 && messages.length > 2) {
        kept = messages.slice(-2);
        toCompress = messages.slice(0, -2);
      }
    }

    if (toCompress.length === 0) return false;

    const hadHistorySummary = Boolean(this._getStateRef().L2?.historySummary);
    const summary = this._summarizeMessages(toCompress);

    const actions = [];
    actions.push(
      hadHistorySummary
        ? { type: L2_APPEND_HISTORY_SUMMARY, payload: { summary } }
        : { type: L2_SET_HISTORY_SUMMARY, payload: { summary } }
    );
    actions.push({ type: L1_SET_MESSAGES, payload: { messages: kept } });

    this.dispatchBatchSync(actions);
    this._stats.compressionCount += 1;
    this._emit("memory.compressed", { compressedCount: toCompress.length, keptCount: kept.length });
    this._updateTokenUsage();
    return true;
  }

  _checkCompress() {
    const { contextWindow, compressThreshold } = this.config;
    if (!Number.isFinite(contextWindow) || !Number.isFinite(compressThreshold)) return;
    this._updateTokenUsage();
    if (this._stats.tokenUsage >= contextWindow * compressThreshold) {
      this.compress();
    }
  }

  _summarizeMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const lines = [];
    for (const msg of list) {
      const role = toNonEmptyString(msg?.role) || "unknown";
      const content = truncate(String(msg?.content || "").replace(/\s+/g, " "), 100);
      if (content) lines.push(`[${role}] ${content}`);
    }
    return lines.join("\n");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Prompt Context
  // ─────────────────────────────────────────────────────────────────────────────

  buildPromptContext() {
    const s = this._getStateRef();
    const sections = [];

    // L0
    if (toNonEmptyString(s.L0?.taskGoal)) {
      sections.push(`## 目标\n${s.L0.taskGoal}`);
    }

    const todos = Array.isArray(s.L0?.todos) ? s.L0.todos : [];
    if (todos.length > 0) {
      const isClosed = (t) => {
        const st = normalizeTodoStatus(t?.status);
        return st === "completed" || st === "cancelled" || st === "done";
      };
      const todoLines = todos.map((t) => {
        const st = normalizeTodoStatus(t?.status);
        const status = st === "completed" || st === "done" ? "✓" : st === "in_progress" ? "→" : "○";
        const text = t?.text || t?.content || t?.title || "(无描述)";
        return `${status} ${text}`;
      });
      const openCount = todos.filter((t) => !isClosed(t)).length;
      sections.push(`## 待办 (${openCount}/${todos.length})\n${todoLines.join("\n")}`);
    }

    // L2
    if (toNonEmptyString(s.L2?.historySummary)) {
      sections.push(`## 历史摘要\n${truncate(s.L2.historySummary, 500)}`);
    }

    const summaries = this.getAllStageSummaries();
    if (Object.keys(summaries).length > 0) {
      const lines = Object.entries(summaries).map(([k, v]) => `[${k}] ${truncate(v, 100)}`);
      sections.push(`## 阶段发现\n${lines.join("\n")}`);
    }

    // L1 syncTable
    const discoveries = this.getAllDiscoveries();
    const pendingDiscoveries = discoveries.filter((d) => d?.status !== "satisfied");
    if (pendingDiscoveries.length > 0) {
      const lines = pendingDiscoveries
        .slice(-5)
        .map((d) => `- ${d.id}: ${d.status}${Array.isArray(d.keywords) && d.keywords.length ? ` [${d.keywords.join(",")}]` : ""}`);
      sections.push(`## 待验证 (${pendingDiscoveries.length})\n${lines.join("\n")}`);
    }

    const subagents = this.getAllSubagents();
    const activeSubagents = subagents.filter((x) => x?.status !== "completed" && x?.status !== "failed");
    if (activeSubagents.length > 0) {
      const lines = activeSubagents.map((x) => `- ${x.id}: ${x.status} (${x.progress || 0}%)`);
      sections.push(`## SubAgents (${activeSubagents.length})\n${lines.join("\n")}`);
    }

    // Signals
    const pendingSignals = this.getSignals("pending");
    if (pendingSignals.length > 0) {
      const lines = pendingSignals
        .slice(-5)
        .map((sig) => `- [${sig.type}] ${sig.message || JSON.stringify(sig.payload)}`);
      sections.push(`## 待处理信号\n${lines.join("\n")}`);
    }

    // Decisions
    const recentDecisions = this.getDecisions(3);
    if (recentDecisions.length > 0) {
      const lines = recentDecisions.map((d) => `- ${d.action}${d.reason ? `: ${d.reason}` : ""}`);
      sections.push(`## 最近决策\n${lines.join("\n")}`);
    }

    return sections.length > 0 ? sections.join("\n\n") : "";
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Snapshot / Restore (MemoryStore-style)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Serialize state for checkpoints/backtrack.
   * Schema matches MemoryStore.toSnapshot() for compatibility.
   */
  toSnapshot({ includeL3 = false, incremental = false } = {}) {
    const withL3 = includeL3 === true;
    this._updateTokenUsage();

    const s = this._getStateRef();
    const snapshot = {
      schemaVersion: "0.1",
      runId: this.runId,
      ts: new Date().toISOString(),
      config: deepClone(this.config),
      stats: { ...this._stats },
      _dirtyLayers: incremental ? { ...this._dirty } : null,
    };

    if (!incremental || this._dirty.L0) {
      snapshot.L0 = deepClone(s.L0);
    }

    if (!incremental || this._dirty.L1) {
      const sync = s.L1?.syncTable || {};
      snapshot.L1 = {
        messages: deepClone(s.L1?.messages || []),
        signals: deepClone(s.L1?.signals || []),
        decisions: deepClone(s.L1?.decisions || []),
        deck: Object.prototype.hasOwnProperty.call(s.L1 || {}, "deck") ? deepClone(s.L1.deck) : null,
        syncTable: {
          discoveries: Object.entries(sync.discoveries || {}),
          subagents: Object.entries(sync.subagents || {}),
        },
        scratchpad: deepClone(s.L1?.scratchpad || {}),
        flags: { ...(s.L1?.flags || {}) },
      };
    }

    if (!incremental || this._dirty.L2) {
      snapshot.L2 = {
        historySummary: toNonEmptyString(s.L2?.historySummary) || "",
        stageSummaries: Object.entries(s.L2?.stageSummaries || {}),
        claims: deepClone(s.L2?.claims || []),
      };
    }

    if (withL3 && (!incremental || this._dirty.L3)) {
      const idx = s.L3?.index || {};
      snapshot.L3 = {
        snapshots: Object.entries(s.L3?.snapshots || {}),
        index: {
          keywords: Object.entries(idx.keywords || {}),
          stages: Object.entries(idx.stages || {}),
          timeline: deepClone(idx.timeline || []),
        },
        checkpoints: deepClone(s.L3?.checkpoints || []),
      };
    }

    if (incremental) {
      this._clearDirty();
    }
    this._lastSnapshotTs = Date.now();
    return snapshot;
  }

  fromSnapshot(snapshot) {
    const s = snapshot && typeof snapshot === "object" ? snapshot : null;
    if (!s) return false;

    if (typeof s.runId === "string" && s.runId) this.runId = s.runId;
    if (s.config && typeof s.config === "object") this.config = { ...DEFAULT_CONFIG, ...s.config };

    const prev = this._getStateRef();
    const nextState = {
      ...prev,
      runId: this.runId,
    };

    // L0
    if (s.L0 && typeof s.L0 === "object") {
      nextState.L0 = deepClone(s.L0);
    }

    // L1
    if (s.L1 && typeof s.L1 === "object") {
      const l1 = s.L1;
      const sync = l1.syncTable && typeof l1.syncTable === "object" ? l1.syncTable : {};
      nextState.L1 = {
        ...prev.L1,
        messages: Array.isArray(l1.messages) ? deepClone(l1.messages) : [],
        signals: Array.isArray(l1.signals) ? deepClone(l1.signals) : [],
        decisions: Array.isArray(l1.decisions) ? deepClone(l1.decisions) : [],
        ...(Object.prototype.hasOwnProperty.call(l1, "deck") ? { deck: deepClone(l1.deck) } : {}),
        syncTable: {
          discoveries: Object.fromEntries(Array.isArray(sync.discoveries) ? sync.discoveries : []),
          subagents: Object.fromEntries(Array.isArray(sync.subagents) ? sync.subagents : []),
        },
        scratchpad: isPlainObject(l1.scratchpad) ? deepClone(l1.scratchpad) : {},
        flags: isPlainObject(l1.flags) ? { ...(prev.L1?.flags || {}), ...l1.flags } : { ...(prev.L1?.flags || {}) },
      };
    }

    // L2
    if (s.L2 && typeof s.L2 === "object") {
      const l2 = s.L2;
      nextState.L2 = {
        ...prev.L2,
        historySummary: typeof l2.historySummary === "string" ? l2.historySummary : "",
        stageSummaries: Object.fromEntries(Array.isArray(l2.stageSummaries) ? l2.stageSummaries : []),
        claims: Array.isArray(l2.claims) ? deepClone(l2.claims) : [],
      };
    }

    // L3
    if (s.L3 && typeof s.L3 === "object") {
      const l3 = s.L3;
      const idx = l3.index && typeof l3.index === "object" ? l3.index : {};
      nextState.L3 = {
        ...prev.L3,
        snapshots: Object.fromEntries(Array.isArray(l3.snapshots) ? l3.snapshots : []),
        index: {
          keywords: Object.fromEntries(Array.isArray(idx.keywords) ? idx.keywords : []),
          stages: Object.fromEntries(Array.isArray(idx.stages) ? idx.stages : []),
          timeline: Array.isArray(idx.timeline) ? deepClone(idx.timeline) : [],
        },
        checkpoints: Array.isArray(l3.checkpoints) ? deepClone(l3.checkpoints) : [],
      };
    }

    if (s.stats && typeof s.stats === "object") {
      this._stats = { ...this._stats, ...s.stats };
    }

    this._engine.restoreSnapshot({ state: nextState, clock: this.getClockValue(), ts: Date.now() });
    this._clearDirty();
    this._updateTokenUsage();
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Token / Stats
  // ─────────────────────────────────────────────────────────────────────────────

  estimateTokens(content) {
    return estimateTokensValue(content, this._tokenCounter);
  }

  _updateTokenUsage() {
    const s = this._getStateRef();
    let l0Tokens = 0;
    l0Tokens += estimateTokensValue(s.L0?.systemPrompt, this._tokenCounter);
    const todos = Array.isArray(s.L0?.todos) ? s.L0.todos : [];
    for (const todo of todos) {
      l0Tokens += estimateTokensValue(todo?.content, this._tokenCounter);
    }

    let l1Tokens = 0;
    const messages = Array.isArray(s.L1?.messages) ? s.L1.messages : [];
    for (const msg of messages) {
      l1Tokens += estimateTokensValue(msg?.content, this._tokenCounter);
    }

    const l2Tokens = estimateTokensValue(s.L2?.historySummary, this._tokenCounter);

    this._stats.l0Tokens = l0Tokens;
    this._stats.l1Tokens = l1Tokens;
    this._stats.l2Tokens = l2Tokens;
    this._stats.tokenUsage = (l0Tokens || 0) + (l1Tokens || 0) + (l2Tokens || 0);
    return this._stats.tokenUsage;
  }

  getStats() {
    this._updateTokenUsage();
    const s = this._getStateRef();
    const discoveries = s.L1?.syncTable?.discoveries;
    const subagents = s.L1?.syncTable?.subagents;
    const snapshots = s.L3?.snapshots;
    const checkpoints = s.L3?.checkpoints;
    return {
      runId: this.runId,
      tokenUsage: this._stats.tokenUsage,
      messageCount: Array.isArray(s.L1?.messages) ? s.L1.messages.length : 0,
      todoCount: Array.isArray(s.L0?.todos) ? s.L0.todos.length : 0,
      signalCount: Array.isArray(s.L1?.signals) ? s.L1.signals.length : 0,
      decisionCount: Array.isArray(s.L1?.decisions) ? s.L1.decisions.length : 0,
      discoveryCount: discoveries && typeof discoveries === "object" ? Object.keys(discoveries).length : 0,
      subagentCount: subagents && typeof subagents === "object" ? Object.keys(subagents).length : 0,
      claimCount: Array.isArray(s.L2?.claims) ? s.L2.claims.length : 0,
      archiveCount: snapshots && typeof snapshots === "object" ? Object.keys(snapshots).length : 0,
      checkpointCount: Array.isArray(checkpoints) ? checkpoints.length : 0,
      compressionCount: this._stats.compressionCount,
      recallCount: this._stats.recallCount,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Delegation layer (SharedContext/DiscoveryManager compatibility)
  // ─────────────────────────────────────────────────────────────────────────────

  get sharedContext() {
    return this._sharedContext;
  }

  get discoveryManager() {
    return this._discoveryManager;
  }

  bind({ sharedContext, discoveryManager } = {}) {
    if (sharedContext) this._sharedContext = sharedContext;
    if (discoveryManager) this._discoveryManager = discoveryManager;
    return this;
  }

  syncFromSharedContext() {
    if (!this._sharedContext) return;

    const actions = [];

    // signals
    const signals = this._sharedContext.getSignals?.() || [];
    const existingSignalIds = new Set((this._getStateRef().L1?.signals || []).map((s) => s?.id).filter(Boolean));
    for (const sig of signals) {
      const id = toNonEmptyString(sig?.id);
      if (id && existingSignalIds.has(id)) continue;
      actions.push({ type: L1_ADD_SIGNAL, payload: { signal: sig } });
    }

    // stage summaries
    const summaries = this._sharedContext.getAllSummaries?.() || {};
    for (const [stage, summary] of Object.entries(summaries)) {
      actions.push({ type: L2_SET_STAGE_SUMMARY, payload: { stage, summary } });
    }

    // decisions
    const decisions = this._sharedContext.getDecisions?.() || [];
    const existingDecisionIds = new Set((this._getStateRef().L1?.decisions || []).map((d) => d?.id).filter(Boolean));
    for (const d of decisions) {
      const id = toNonEmptyString(d?.id);
      if (id && existingDecisionIds.has(id)) continue;
      actions.push({ type: L1_RECORD_DECISION, payload: { decision: d } });
    }

    if (actions.length > 0) this.dispatchBatchSync(actions);
  }

  syncFromDiscoveryManager() {
    if (!this._discoveryManager) return;
    const discoveries = this._discoveryManager.getAllDiscoveries?.() || [];
    if (!Array.isArray(discoveries) || discoveries.length === 0) return;
    const actions = [];
    for (const d of discoveries) {
      const id = toNonEmptyString(d?.id);
      if (!id) continue;
      actions.push({
        type: L1_SYNC_DISCOVERY,
        payload: {
          id,
          data: {
            status: d.status || "open",
            keywords: d.keywords || [],
            by: d.by || null,
            ts: d.ts || Date.now(),
          },
        },
      });
    }
    if (actions.length > 0) this.dispatchBatchSync(actions);
  }

  syncAll() {
    this.syncFromSharedContext();
    this.syncFromDiscoveryManager();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────────

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

  _hasAnyDirty() {
    return Boolean(this._dirty.L0 || this._dirty.L1 || this._dirty.L2 || this._dirty.L3);
  }

  _emit(name, payload) {
    if (this.eventBus?.emit) {
      this.eventBus.emit(name, { actor: "memory", payload });
    }
  }

  _emitUpdate(field, delta) {
    this._emit("memory.updated", { field, delta, ts: Date.now() });
  }
}

export default UnifiedMemoryStore;
