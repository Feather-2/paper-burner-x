import { deepClone, isPlainObject, toNonEmptyString } from "../../shared/index.js";
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
  L2_SET_STAGE_SUMMARY,
  L2_ADD_CLAIM,
  L2_REPLACE_CLAIMS,
} from "./action-types.js";
import { normalizeTodoEntry } from "./todo-normalize.js";
import { genId } from "./unified-memory-store.utils.js";

export function applyWriteMethods(UnifiedMemoryStore) {
  Object.defineProperties(UnifiedMemoryStore.prototype, {
    awaitUserFeedback: {
      get() {
        return Boolean(this._getStateRef().L1?.flags?.awaitUserFeedback);
      },
      set(value) {
        this.setFlag("awaitUserFeedback", value);
      },
    },
    taskImpossible: {
      get() {
        return Boolean(this._getStateRef().L1?.flags?.taskImpossible);
      },
      set(value) {
        this.setFlag("taskImpossible", value);
      },
    },
    sharedContext: {
      get() {
        return this._sharedContext;
      },
    },
    discoveryManager: {
      get() {
        return this._discoveryManager;
      },
    },
  });

  UnifiedMemoryStore.prototype.setSystemPrompt = function setSystemPrompt(prompt) {
    const next = toNonEmptyString(prompt) || "";
    const prev = toNonEmptyString(this._getStateRef().L0?.systemPrompt) || "";
    if (next === prev) return;
    this.dispatchSync({ type: L0_SET_SYSTEM_PROMPT, payload: { prompt: next } });
  };

  UnifiedMemoryStore.prototype.setTaskGoal = function setTaskGoal(goal) {
    const next = toNonEmptyString(goal) || "";
    const prev = toNonEmptyString(this._getStateRef().L0?.taskGoal) || "";
    if (next === prev) return;
    this.dispatchSync({ type: L0_SET_TASK_GOAL, payload: { goal: next } });
  };

  UnifiedMemoryStore.prototype.addTodo = function addTodo(todo) {
    const entry = normalizeTodoEntry(todo, { generateId: genId, fillTimestamps: true });
    const key = toNonEmptyString(entry.todoId) || toNonEmptyString(entry.id);
    this.dispatchSync({ type: L0_ADD_TODO, payload: { todo: entry } });
    if (!key) return null;
    const todos = this._getStateRef().L0?.todos || [];
    return todos.find((t) => t?.id === key || t?.todoId === key) || null;
  };

  UnifiedMemoryStore.prototype.updateTodo = function updateTodo(id, data) {
    const key = toNonEmptyString(id);
    if (!key || !isPlainObject(data)) return null;
    this.dispatchSync({ type: L0_UPDATE_TODO, payload: { id: key, updates: data } });
    const todos = this._getStateRef().L0?.todos || [];
    return todos.find((t) => t?.id === key || t?.todoId === key) || null;
  };

  UnifiedMemoryStore.prototype.removeTodo = function removeTodo(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const prev = this._getStateRef().L0?.todos || [];
    const removed = prev.find((t) => t?.id === key || t?.todoId === key) || null;
    this.dispatchSync({ type: L0_REMOVE_TODO, payload: { id: key } });
    return removed;
  };

  UnifiedMemoryStore.prototype.replaceTodos = function replaceTodos(todos) {
    const next = Array.isArray(todos)
      ? todos.map((t) => normalizeTodoEntry(t, { generateId: genId, fillTimestamps: true }))
      : [];
    this.dispatchSync({ type: L0_REPLACE_TODOS, payload: { todos: next } });
    return this.getTodos();
  };

  UnifiedMemoryStore.prototype.addMessage = function addMessage(msg) {
    const prevLen = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages.length : 0;
    this.dispatchSync({ type: L1_ADD_MESSAGE, payload: { message: msg } });
    this._checkCompress();
    const messages = this._getStateRef().L1?.messages || [];
    return messages[prevLen] || messages[messages.length - 1] || null;
  };

  UnifiedMemoryStore.prototype.addMessages = function addMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    if (list.length === 0) return [];
    const prevLen = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages.length : 0;
    this.dispatchSync({ type: L1_ADD_MESSAGES, payload: { messages: list } });
    this._checkCompress();
    const next = Array.isArray(this._getStateRef().L1?.messages) ? this._getStateRef().L1.messages : [];
    return next.slice(prevLen);
  };

  UnifiedMemoryStore.prototype.clearMessages = function clearMessages() {
    this.dispatchSync({ type: L1_CLEAR_MESSAGES, payload: {} });
  };

  UnifiedMemoryStore.prototype.setMessages = function setMessages(messages) {
    this.dispatchSync({ type: L1_SET_MESSAGES, payload: { messages: Array.isArray(messages) ? messages : [] } });
  };

  UnifiedMemoryStore.prototype.setDeck = function setDeck(deck) {
    this.dispatchSync({ type: L1_SET_DECK, payload: { deck } });
  };

  UnifiedMemoryStore.prototype.addSignal = function addSignal(signal) {
    const prevLen = Array.isArray(this._getStateRef().L1?.signals) ? this._getStateRef().L1.signals.length : 0;
    this.dispatchSync({ type: L1_ADD_SIGNAL, payload: { signal } });
    const signals = Array.isArray(this._getStateRef().L1?.signals) ? this._getStateRef().L1.signals : [];
    return signals[prevLen] || signals[signals.length - 1] || null;
  };

  UnifiedMemoryStore.prototype.acknowledgeSignal = function acknowledgeSignal(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    this.dispatchSync({ type: L1_ACKNOWLEDGE_SIGNAL, payload: { id: key } });
    const signals = Array.isArray(this._getStateRef().L1?.signals) ? this._getStateRef().L1.signals : [];
    return signals.find((s) => s?.id === key) || null;
  };

  UnifiedMemoryStore.prototype.recordDecision = function recordDecision(decision) {
    const prevLen = Array.isArray(this._getStateRef().L1?.decisions) ? this._getStateRef().L1.decisions.length : 0;
    this.dispatchSync({ type: L1_RECORD_DECISION, payload: { decision } });
    const decisions = Array.isArray(this._getStateRef().L1?.decisions) ? this._getStateRef().L1.decisions : [];
    return decisions[prevLen] || decisions[decisions.length - 1] || null;
  };

  UnifiedMemoryStore.prototype.setScratchpad = function setScratchpad(key, value) {
    this.dispatchSync({ type: L1_SET_SCRATCHPAD, payload: { key, value } });
    this._emitUpdate("scratchpad", { key, value });
  };

  UnifiedMemoryStore.prototype.clearScratchpad = function clearScratchpad() {
    this.dispatchSync({ type: L1_CLEAR_SCRATCHPAD, payload: {} });
    this._emitUpdate("scratchpad", { cleared: true });
  };

  UnifiedMemoryStore.prototype.setFlag = function setFlag(name, value) {
    const n = toNonEmptyString(name);
    if (!n) return;
    this.dispatchSync({ type: L1_SET_FLAG, payload: { name: n, value: Boolean(value) } });
    this._emitUpdate("flags", { [n]: Boolean(value) });
  };

  UnifiedMemoryStore.prototype.syncDiscovery = function syncDiscovery(id, data) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const payload = isPlainObject(data) ? data : {};
    this.dispatchSync({ type: L1_SYNC_DISCOVERY, payload: { id: key, data: payload } });
    return this.getDiscovery(key);
  };

  UnifiedMemoryStore.prototype.syncSubagent = function syncSubagent(id, data) {
    const key = toNonEmptyString(id);
    if (!key) return null;
    const payload = isPlainObject(data) ? data : {};
    this.dispatchSync({ type: L1_SYNC_SUBAGENT, payload: { id: key, data: payload } });
    return this.getSubagent(key);
  };

  UnifiedMemoryStore.prototype.setStageSummary = function setStageSummary(stage, summary) {
    const s = toNonEmptyString(stage);
    if (!s) return;
    this.dispatchSync({ type: L2_SET_STAGE_SUMMARY, payload: { stage: s, summary: toNonEmptyString(summary) || "" } });
  };

  UnifiedMemoryStore.prototype.addClaim = function addClaim(claim) {
    const prevLen = Array.isArray(this._getStateRef().L2?.claims) ? this._getStateRef().L2.claims.length : 0;
    this.dispatchSync({ type: L2_ADD_CLAIM, payload: { claim } });
    const claims = Array.isArray(this._getStateRef().L2?.claims) ? this._getStateRef().L2.claims : [];
    return claims[prevLen] || claims[claims.length - 1] || null;
  };

  UnifiedMemoryStore.prototype.replaceClaims = function replaceClaims(claims) {
    this.dispatchSync({ type: L2_REPLACE_CLAIMS, payload: { claims: Array.isArray(claims) ? deepClone(claims) : [] } });
    return this.getClaims();
  };

  UnifiedMemoryStore.prototype.bind = function bind({ sharedContext, discoveryManager } = {}) {
    if (sharedContext) this._sharedContext = sharedContext;
    if (discoveryManager) this._discoveryManager = discoveryManager;
    return this;
  };

  UnifiedMemoryStore.prototype.syncFromSharedContext = function syncFromSharedContext() {
    if (!this._sharedContext) return;

    const actions = [];

    const signals = this._sharedContext.getSignals?.() || [];
    const existingSignalIds = new Set((this._getStateRef().L1?.signals || []).map((s) => s?.id).filter(Boolean));
    for (const sig of signals) {
      const id = toNonEmptyString(sig?.id);
      if (id && existingSignalIds.has(id)) continue;
      actions.push({ type: L1_ADD_SIGNAL, payload: { signal: sig } });
    }

    const summaries = this._sharedContext.getAllSummaries?.() || {};
    for (const [stage, summary] of Object.entries(summaries)) {
      actions.push({ type: L2_SET_STAGE_SUMMARY, payload: { stage, summary } });
    }

    const decisions = this._sharedContext.getDecisions?.() || [];
    const existingDecisionIds = new Set((this._getStateRef().L1?.decisions || []).map((d) => d?.id).filter(Boolean));
    for (const d of decisions) {
      const id = toNonEmptyString(d?.id);
      if (id && existingDecisionIds.has(id)) continue;
      actions.push({ type: L1_RECORD_DECISION, payload: { decision: d } });
    }

    if (actions.length > 0) this.dispatchBatchSync(actions);
  };

  UnifiedMemoryStore.prototype.syncFromDiscoveryManager = function syncFromDiscoveryManager() {
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
  };

  UnifiedMemoryStore.prototype.syncAll = function syncAll() {
    this.syncFromSharedContext();
    this.syncFromDiscoveryManager();
  };
}
