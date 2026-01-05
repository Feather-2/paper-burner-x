/**
 * StateEngine - 统一状态引擎
 *
 * P1.1: SSOT (Single Source of Truth) 实现
 *
 * 核心职责：
 * 1. 所有状态变更通过 dispatch(action) 提交
 * 2. Action 序列化支持调试/重放
 * 3. 并发安全（队列化 dispatch）
 * 4. 集成 Lamport 时钟确保因果排序
 *
 * 设计原则：
 * - 不可变更新：reducer 返回新状态，不修改原状态
 * - 单向数据流：Action → Reducer → State → Listeners
 * - 可序列化：所有 Action 和 State 可 JSON 序列化
 */

import { nextTick, sync as syncClock, currentSeq } from "../events/lamport-clock.js";
import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { cloneJson, buildStatePatch, applyStatePatch, diffLayers } from "./state-diff.js";
import { cryptoRandomHex } from "../../shared/utils/secure-id.js";
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/memory/state-engine");

// ─────────────────────────────────────────────────────────────────────────────
// LamportClock Wrapper (使用全局 lamport-clock 模块)
// ─────────────────────────────────────────────────────────────────────────────

class LamportClock {
  constructor({ actorId, initialValue } = {}) {
    this.actorId = actorId || `actor_${Date.now().toString(36)}`;
    // 如果提供了初始值，同步到全局时钟
    if (typeof initialValue === "number" && initialValue > 0) {
      syncClock(initialValue);
    }
  }

  get value() {
    return currentSeq();
  }

  tick() {
    const clock = nextTick();
    return clock.seq;
  }

  receive(remoteSeq) {
    syncClock(remoteSeq);
    return this.tick();
  }
}
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
  L2_ADD_SUMMARY,
  L2_RECORD_DECISION,
  L2_ADD_CLAIM,
  L2_REPLACE_CLAIMS,
  L3_ARCHIVE,
  L3_ADD_CHECKPOINT,
  COMPRESS,
  RESTORE_SNAPSHOT,
  RESTORE_CHECKPOINT,
  BATCH,
  isValidActionType,
  getActionLayer,
} from "./action-types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function generateId(prefix = "id") {
  const ts = Date.now().toString(36);
  const rand = cryptoRandomHex(3);
  return `${prefix}_${ts}_${rand}`;
}

function normalizeTodoStatus(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!v) return "pending";
  if (v === "done" || v === "complete" || v === "completed") return "completed";
  if (v === "inprogress" || v === "in_progress" || v === "in-progress" || v === "in progress") return "in_progress";
  if (v === "cancel" || v === "canceled" || v === "cancelled") return "cancelled";
  return v;
}

function normalizeTodoPriority(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "high" || v === "medium" || v === "low") return v;
  if (v === "normal") return "medium";
  return v || "medium";
}

function normalizeTodoEntry(todo) {
  const raw = isPlainObject(todo) ? todo : { text: String(todo ?? "") };

  const todoId = toNonEmptyString(raw.todoId) || toNonEmptyString(raw.id);
  const id = toNonEmptyString(raw.id) || todoId || generateId("todo");

  const text =
    toNonEmptyString(raw.text) ||
    toNonEmptyString(raw.content) ||
    toNonEmptyString(raw.title) ||
    toNonEmptyString(raw.message) ||
    "";

  const status = normalizeTodoStatus(raw.status);
  const priority = normalizeTodoPriority(raw.priority);

  const createdAt = typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt;
  const ts = typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : Date.now();

  return {
    ...raw,
    id,
    todoId: todoId || id,
    text: text || "",
    content: text || "",
    status,
    priority,
    ts,
    createdAt,
    updatedAt,
  };
}

function truncate(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial State Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createInitialState(options = {}) {
  return {
    // Metadata
    runId: toNonEmptyString(options.runId) || generateId("run"),
    schemaVersion: "1.0",
    createdAt: new Date().toISOString(),

    // L0: Immutable
    L0: {
      systemPrompt: "",
      taskGoal: "",
      todos: [],
    },

    // L1: Working Memory
    L1: {
      messages: [],
      signals: [],
      decisions: [],
      deck: null,
      syncTable: {
        discoveries: {},  // id → {id, status, keywords, by, ts}
        subagents: {},    // id → {id, status, progress, ts}
      },
      scratchpad: {},
      flags: {
        awaitUserFeedback: false,
        taskImpossible: false,
      },
    },

    // L2: Condensed Memory
    L2: {
      historySummary: "",
      stageSummaries: {},  // stage → summary
      decisions: [],
      claims: [],
    },

    // L3: Archive
    L3: {
      snapshots: {},       // id → full data
      index: {
        keywords: {},      // keyword → [snapshotIds]
        stages: {},        // stage → snapshotId
        timeline: [],      // [{id, ts, summary}]
      },
      checkpoints: [],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reducers (Pure Functions)
// ─────────────────────────────────────────────────────────────────────────────

function reduceL0(state, action) {
  const L0 = state.L0;
  const { type, payload } = action;

  switch (type) {
    case L0_SET_SYSTEM_PROMPT: {
      const prompt = toNonEmptyString(payload?.prompt) || "";
      if (prompt === L0.systemPrompt) return state;
      return { ...state, L0: { ...L0, systemPrompt: prompt } };
    }

    case L0_SET_TASK_GOAL: {
      const goal = toNonEmptyString(payload?.goal) || "";
      if (goal === L0.taskGoal) return state;
      return { ...state, L0: { ...L0, taskGoal: goal } };
    }

    case L0_ADD_TODO: {
      const entry = normalizeTodoEntry(payload?.todo);
      const key = toNonEmptyString(entry.todoId) || toNonEmptyString(entry.id);
      const existingIdx = key ? L0.todos.findIndex((t) => t?.id === key || t?.todoId === key) : -1;

      if (existingIdx >= 0) {
        // Update existing
        const updated = [...L0.todos];
        updated[existingIdx] = { ...updated[existingIdx], ...entry, updatedAt: new Date().toISOString() };
        return { ...state, L0: { ...L0, todos: updated } };
      }

      return { ...state, L0: { ...L0, todos: [...L0.todos, entry] } };
    }

    case L0_UPDATE_TODO: {
      const { id, updates } = payload || {};
      const key = toNonEmptyString(id);
      if (!key || !isPlainObject(updates)) return state;

      const idx = L0.todos.findIndex((t) => t?.id === key || t?.todoId === key);
      if (idx < 0) return state;

      const updated = [...L0.todos];
      updated[idx] = {
        ...updated[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
        status: updates.status !== undefined ? normalizeTodoStatus(updates.status) : updated[idx].status,
        priority: updates.priority !== undefined ? normalizeTodoPriority(updates.priority) : updated[idx].priority,
      };
      return { ...state, L0: { ...L0, todos: updated } };
    }

    case L0_REMOVE_TODO: {
      const key = toNonEmptyString(payload?.id);
      if (!key) return state;

      const filtered = L0.todos.filter((t) => t?.id !== key && t?.todoId !== key);
      if (filtered.length === L0.todos.length) return state;

      return { ...state, L0: { ...L0, todos: filtered } };
    }

    case L0_REPLACE_TODOS: {
      const todos = Array.isArray(payload?.todos) ? payload.todos.map(normalizeTodoEntry) : [];
      return { ...state, L0: { ...L0, todos } };
    }

    default:
      return state;
  }
}

function reduceL1(state, action) {
  const L1 = state.L1;
  const { type, payload } = action;

  switch (type) {
    case L1_ADD_MESSAGE: {
      const msg = isPlainObject(payload?.message)
        ? payload.message
        : { role: "user", content: String(payload?.message ?? "") };
      return { ...state, L1: { ...L1, messages: [...L1.messages, msg] } };
    }

    case L1_ADD_MESSAGES: {
      const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
      if (msgs.length === 0) return state;
      const normalized = msgs.map((m) =>
        isPlainObject(m) ? m : { role: "user", content: String(m ?? "") }
      );
      return { ...state, L1: { ...L1, messages: [...L1.messages, ...normalized] } };
    }

    case L1_CLEAR_MESSAGES: {
      if (L1.messages.length === 0) return state;
      return { ...state, L1: { ...L1, messages: [] } };
    }

    case L1_SET_MESSAGES: {
      const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
      return { ...state, L1: { ...L1, messages: msgs } };
    }

    case L1_SET_DECK: {
      if (!Object.prototype.hasOwnProperty.call(payload || {}, "deck")) return state;
      const deck = payload?.deck;
      const next = deck === undefined ? null : cloneJson(deck);
      if (next === L1.deck) return state;
      return { ...state, L1: { ...L1, deck: next } };
    }

    case L1_ADD_SIGNAL: {
      const signal = payload?.signal || {};
      const entry = {
        id: generateId("sig"),
        type: signal.type || "info",
        message: signal.message || "",
        payload: signal.payload || {},
        acknowledged: false,
        ts: Date.now(),
      };
      return { ...state, L1: { ...L1, signals: [...L1.signals, entry] } };
    }

    case L1_ACKNOWLEDGE_SIGNAL: {
      const id = toNonEmptyString(payload?.id);
      if (!id) return state;

      const idx = L1.signals.findIndex((s) => s.id === id);
      if (idx < 0) return state;

      const updated = [...L1.signals];
      updated[idx] = { ...updated[idx], acknowledged: true };
      return { ...state, L1: { ...L1, signals: updated } };
    }

    case L1_RECORD_DECISION: {
      const decision = payload?.decision || {};
      const entry = {
        id: generateId("dec"),
        action: decision.action || decision.type || "unknown",
        reason: decision.reason || "",
        result: decision.result || null,
        ts: Date.now(),
      };
      return { ...state, L1: { ...L1, decisions: [...L1.decisions, entry] } };
    }

    case L1_SET_SCRATCHPAD: {
      const { key, value } = payload || {};
      if (isPlainObject(key) && value === undefined) {
        return { ...state, L1: { ...L1, scratchpad: { ...L1.scratchpad, ...key } } };
      }
      return { ...state, L1: { ...L1, scratchpad: { ...L1.scratchpad, [key]: value } } };
    }

    case L1_CLEAR_SCRATCHPAD: {
      return { ...state, L1: { ...L1, scratchpad: {} } };
    }

    case L1_SET_FLAG: {
      const { name, value } = payload || {};
      if (!(name in L1.flags)) return state;
      if (L1.flags[name] === Boolean(value)) return state;
      return { ...state, L1: { ...L1, flags: { ...L1.flags, [name]: Boolean(value) } } };
    }

    case L1_SYNC_DISCOVERY: {
      const { id, data } = payload || {};
      const key = toNonEmptyString(id);
      if (!key) return state;

      const existing = L1.syncTable.discoveries[key] || {};
      const entry = {
        ...existing,
        ...data,
        id: key,
        ts: Date.now(),
        status: toNonEmptyString(data?.status) || toNonEmptyString(existing.status) || "open",
        keywords: Array.isArray(data?.keywords) ? data.keywords : existing.keywords || [],
        by: data?.by ?? existing.by ?? null,
      };

      return {
        ...state,
        L1: {
          ...L1,
          syncTable: {
            ...L1.syncTable,
            discoveries: { ...L1.syncTable.discoveries, [key]: entry },
          },
        },
      };
    }

    case L1_SYNC_SUBAGENT: {
      const { id, data } = payload || {};
      const key = toNonEmptyString(id);
      if (!key) return state;

      const existing = L1.syncTable.subagents[key] || {};
      const entry = {
        ...existing,
        ...data,
        id: key,
        ts: Date.now(),
        status: toNonEmptyString(data?.status) || toNonEmptyString(existing.status) || "pending",
        progress: typeof data?.progress === "number" ? data.progress : existing.progress ?? 0,
        result: data?.result ?? existing.result ?? null,
      };

      return {
        ...state,
        L1: {
          ...L1,
          syncTable: {
            ...L1.syncTable,
            subagents: { ...L1.syncTable.subagents, [key]: entry },
          },
        },
      };
    }

    default:
      return state;
  }
}

function reduceL2(state, action) {
  const L2 = state.L2;
  const { type, payload } = action;

  switch (type) {
    case L2_SET_HISTORY_SUMMARY: {
      const summary = toNonEmptyString(payload?.summary) || "";
      if (summary === L2.historySummary) return state;
      return { ...state, L2: { ...L2, historySummary: summary } };
    }

    case L2_APPEND_HISTORY_SUMMARY: {
      const summary = toNonEmptyString(payload?.summary) || "";
      if (!summary) return state;
      const next = L2.historySummary ? `${L2.historySummary}\n${summary}` : summary;
      return { ...state, L2: { ...L2, historySummary: next } };
    }

    case L2_SET_STAGE_SUMMARY: {
      const { stage, summary } = payload || {};
      const s = toNonEmptyString(stage);
      if (!s) return state;
      const sum = toNonEmptyString(summary) || "";
      if (L2.stageSummaries[s] === sum) return state;
      return { ...state, L2: { ...L2, stageSummaries: { ...L2.stageSummaries, [s]: sum } } };
    }

    case L2_ADD_SUMMARY: {
      const raw = payload?.summary;
      const s = toNonEmptyString(raw?.stage) || toNonEmptyString(payload?.stage);
      if (!s) return state;
      const sum = toNonEmptyString(raw?.summary ?? raw?.text) || toNonEmptyString(payload?.summary) || "";
      if (L2.stageSummaries[s] === sum) return state;
      return { ...state, L2: { ...L2, stageSummaries: { ...L2.stageSummaries, [s]: sum } } };
    }

    case L2_RECORD_DECISION: {
      const raw = payload?.decision;
      if (!raw) return state;
      const decision = isPlainObject(raw) ? cloneJson(raw) : { action: String(raw ?? "unknown") };
      const action = toNonEmptyString(decision.action) || toNonEmptyString(decision.type) || "unknown";
      const reason = toNonEmptyString(decision.reason) || "";
      const timestamp = typeof decision.timestamp === "number" ? decision.timestamp : Date.now();
      const entry = {
        ...decision,
        id: toNonEmptyString(decision.id) || generateId("dec"),
        action,
        reason,
        timestamp,
      };
      const decisions = Array.isArray(L2.decisions) ? L2.decisions : [];
      return { ...state, L2: { ...L2, decisions: [...decisions, entry] } };
    }

    case L2_ADD_CLAIM: {
      const claim = payload?.claim || {};
      const entry = {
        id: generateId("claim"),
        content: claim.content || String(claim),
        source: claim.source || null,
        confidence: claim.confidence || 1.0,
        verified: claim.verified || false,
        ts: Date.now(),
      };
      return { ...state, L2: { ...L2, claims: [...L2.claims, entry] } };
    }

    case L2_REPLACE_CLAIMS: {
      const claims = Array.isArray(payload?.claims) ? deepClone(payload.claims) : [];
      return { ...state, L2: { ...L2, claims } };
    }

    default:
      return state;
  }
}

function reduceL3(state, action) {
  const L3 = state.L3;
  const { type, payload } = action;

  switch (type) {
    case L3_ARCHIVE: {
      const { stageKey, data, keywords = [] } = payload || {};
      const id = generateId("snap");
      const entry = {
        id,
        stageKey,
        data,
        summary: data?.summary || truncate(JSON.stringify(data), 200),
        ts: Date.now(),
      };

      // Update snapshots
      const snapshots = { ...L3.snapshots, [id]: entry };

      // Update keyword index
      const keywordIndex = { ...L3.index.keywords };
      for (const kw of keywords) {
        const k = toNonEmptyString(kw)?.toLowerCase();
        if (!k) continue;
        keywordIndex[k] = [...(keywordIndex[k] || []), id];
      }

      // Update stage index
      const stages = stageKey
        ? { ...L3.index.stages, [stageKey]: id }
        : L3.index.stages;

      // Update timeline
      const timeline = [...L3.index.timeline, { id, ts: entry.ts, summary: entry.summary }];

      return {
        ...state,
        L3: {
          ...L3,
          snapshots,
          index: { ...L3.index, keywords: keywordIndex, stages, timeline },
        },
      };
    }

    case L3_ADD_CHECKPOINT: {
      const checkpoint = payload?.checkpoint;
      if (!checkpoint) return state;
      return { ...state, L3: { ...L3, checkpoints: [...L3.checkpoints, checkpoint] } };
    }

    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Root Reducer
// ─────────────────────────────────────────────────────────────────────────────

function rootReducer(state, action) {
  const { type, payload } = action;

  // Handle special actions
  if (type === RESTORE_SNAPSHOT) {
    const snapshot = payload?.snapshot;
    if (!snapshot || typeof snapshot !== "object") return state;
    return {
      ...createInitialState(),
      ...snapshot,
      // Ensure nested objects are properly restored
      L0: { ...createInitialState().L0, ...snapshot.L0 },
      L1: {
        ...createInitialState().L1,
        ...snapshot.L1,
        syncTable: {
          discoveries: isPlainObject(snapshot.L1?.syncTable?.discoveries)
            ? snapshot.L1.syncTable.discoveries
            : {},
          subagents: isPlainObject(snapshot.L1?.syncTable?.subagents)
            ? snapshot.L1.syncTable.subagents
            : {},
        },
      },
      L2: { ...createInitialState().L2, ...snapshot.L2 },
      L3: { ...createInitialState().L3, ...snapshot.L3 },
    };
  }

  if (type === BATCH) {
    const actions = Array.isArray(payload?.actions) ? payload.actions : [];
    return actions.reduce((s, a) => rootReducer(s, a), state);
  }

  // Delegate to layer reducers based on action type
  const layer = getActionLayer(type);
  switch (layer) {
    case "L0":
      return reduceL0(state, action);
    case "L1":
      return reduceL1(state, action);
    case "L2":
      return reduceL2(state, action);
    case "L3":
      return reduceL3(state, action);
    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// StateEngine Class
// ─────────────────────────────────────────────────────────────────────────────

export class StateEngine {
  /**
   * @param {object} options
   * @param {object} [options.initialState] - Initial state
   * @param {number} [options.maxActionHistory=1000] - Max action history size
   * @param {boolean} [options.enableActionHistory=true] - Enable action history for replay
   * @param {object} [options.eventBus] - EventBus for emitting state changes
   * @param {string} [options.actorId] - Actor ID for Lamport clock
   */
  constructor({
    initialState,
    maxActionHistory = 1000,
    enableActionHistory = true,
    eventBus = null,
    actorId,
  } = {}) {
    this._state = initialState
      ? { ...createInitialState(), ...initialState }
      : createInitialState();

    this._maxActionHistory = maxActionHistory;
    this._enableActionHistory = enableActionHistory;
    this._actionHistory = [];
    this._listeners = new Set();
    this._layerListeners = new Map(); // layer → Set<listener>
    this._eventBus = eventBus;
    this._checkpoints = new Map(); // checkpointId → { state, clock, encoding, baseId? }

    // Lamport clock for causal ordering
    this._clock = new LamportClock({
      actorId: actorId || this._state.runId,
    });

    // Dispatch queue for serializing concurrent dispatches
    this._dispatchQueue = [];
    this._isDispatching = false;
  }

  /**
   * Get current state (read-only clone)
   */
  getState() {
    return cloneJson(this._state);
  }

  /**
   * Get raw state reference (for internal use only)
   * @private
   */
  _getStateRef() {
    return this._state;
  }

  /**
   * Dispatch an action to update state
   * @param {object} action - Action object { type, payload, meta? }
   * @returns {object} The dispatched action with metadata
   */
  dispatch(action) {
    if (!action || typeof action !== "object" || !action.type) {
      throw new TypeError("StateEngine.dispatch: action must have a type");
    }

    // Queue the action
    return new Promise((resolve) => {
      this._dispatchQueue.push({ action, resolve });
      this._processQueue();
    });
  }

  /**
   * Batch dispatch multiple actions atomically
   * - Single clock tick for all actions
   * - Single listener notification after all actions complete
   * - Single EventBus emit
   * @param {object[]} actions - Array of action objects
   * @returns {Promise<object[]>} The dispatched actions with metadata
   */
  async dispatchBatch(actions) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return [];
    }

    // Validate all actions first
    for (const action of actions) {
      if (!action || typeof action !== "object" || !action.type) {
        throw new TypeError("StateEngine.dispatchBatch: each action must have a type");
      }
    }

    return new Promise((resolve) => {
      this._dispatchQueue.push({ actions, isBatch: true, resolve });
      this._processQueue();
    });
  }

  /**
   * Synchronous batch dispatch
   * @param {object[]} actions - Array of action objects
   * @returns {object[]} The dispatched actions with metadata
   */
  dispatchBatchSync(actions) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return [];
    }

    return this._executeBatchDispatch(actions);
  }

  /**
   * Synchronous dispatch (for internal use / compatibility)
   * @param {object} action
   * @returns {object} The dispatched action
   */
  dispatchSync(action) {
    if (!action || typeof action !== "object" || !action.type) {
      throw new TypeError("StateEngine.dispatchSync: action must have a type");
    }

    return this._executeDispatch(action);
  }

  /**
   * Process dispatch queue
   * @private
   */
  async _processQueue() {
    if (this._isDispatching) return;
    this._isDispatching = true;

    while (this._dispatchQueue.length > 0) {
      const item = this._dispatchQueue.shift();
      if (item.isBatch) {
        const result = this._executeBatchDispatch(item.actions);
        item.resolve(result);
      } else {
        const result = this._executeDispatch(item.action);
        item.resolve(result);
      }
    }

    this._isDispatching = false;
  }

  /**
   * Execute batch dispatch - single clock tick, single notification
   * @private
   */
  _executeBatchDispatch(actions) {
    const ts = Date.now();
    const seq = this._clock.tick(); // Single tick for entire batch
    const actorId = this._clock.actorId;

    const prevState = this._state;
    let currentState = prevState;
    const enrichedActions = [];

    // Apply all actions sequentially but atomically
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const enrichedAction = {
        ...action,
        meta: {
          ...action.meta,
          ts,
          seq,
          batchIndex: i,
          batchSize: actions.length,
          actorId,
        },
      };
      enrichedActions.push(enrichedAction);

      // Reduce
      currentState = rootReducer(currentState, enrichedAction);
    }

    // Only update if state changed
    if (currentState !== prevState) {
      this._state = currentState;

      // Record action history (batch as single entry or individual)
      if (this._enableActionHistory) {
        for (const action of enrichedActions) {
          this._actionHistory.push(action);
        }
        while (this._actionHistory.length > this._maxActionHistory) {
          this._actionHistory.shift();
        }
      }

      // Single notification for entire batch
      this._notifyListenersBatch(enrichedActions, prevState, currentState);

      // Single EventBus emit for batch
      this._emitBatchStateChange(enrichedActions, prevState, currentState);
    }

    return enrichedActions;
  }

  /**
   * Execute a single dispatch
   * @private
   */
  _executeDispatch(action) {
    // Add metadata
    const seq = this._clock.tick();
    const enrichedAction = {
      ...action,
      meta: {
        ...action.meta,
        ts: action.meta?.ts || Date.now(),
        seq,
        actorId: this._clock.actorId,
      },
    };

    // Reduce
    const prevState = this._state;
    const nextState = rootReducer(this._state, enrichedAction);

    // Only update if state changed
    if (nextState !== prevState) {
      this._state = nextState;

      // Record action history
      if (this._enableActionHistory) {
        this._actionHistory.push(enrichedAction);
        while (this._actionHistory.length > this._maxActionHistory) {
          this._actionHistory.shift();
        }
      }

      // Notify listeners
      this._notifyListeners(enrichedAction, prevState, nextState);

      // Emit to EventBus
      this._emitStateChange(enrichedAction, prevState, nextState);
    }

    return enrichedAction;
  }

  /**
   * Subscribe to state changes
   * @param {function|string} listenerOrLayer - Callback or layer name ("L0", "L1", etc.)
   * @param {function} [layerListener] - Callback when first arg is layer name
   * @returns {function} Unsubscribe function
   */
  subscribe(listenerOrLayer, layerListener) {
    // Overload: subscribe("L0", fn) -> layer subscription
    if (typeof listenerOrLayer === "string" && typeof layerListener === "function") {
      return this.subscribeLayer(listenerOrLayer, layerListener);
    }

    if (typeof listenerOrLayer !== "function") {
      throw new TypeError("StateEngine.subscribe: listener must be a function");
    }

    this._listeners.add(listenerOrLayer);
    return () => this._listeners.delete(listenerOrLayer);
  }

  /**
   * Subscribe to specific layer changes
   * @param {string} layer - "L0", "L1", "L2", or "L3"
   * @param {function} listener - Callback (action, prevLayer, nextLayer) => void
   * @returns {function} Unsubscribe function
   */
  subscribeLayer(layer, listener) {
    if (!["L0", "L1", "L2", "L3"].includes(layer)) {
      throw new Error(`Invalid layer: ${layer}`);
    }
    if (typeof listener !== "function") {
      throw new TypeError("StateEngine.subscribeLayer: listener must be a function");
    }

    if (!this._layerListeners.has(layer)) {
      this._layerListeners.set(layer, new Set());
    }
    this._layerListeners.get(layer).add(listener);

    return () => {
      const set = this._layerListeners.get(layer);
      if (set) set.delete(listener);
    };
  }

  /**
   * Notify all listeners
   * @private
   */
  _notifyListeners(action, prevState, nextState) {
    // Global listeners
    for (const listener of this._listeners) {
      try {
        listener(action, prevState, nextState);
      } catch (err) {
        logger.error("[StateEngine] Listener error:", { error: err?.message || String(err), stack: err?.stack });
      }
    }

    // Layer listeners
    const diff = diffLayers(prevState, nextState);
    for (const [layer, changed] of Object.entries(diff)) {
      if (!changed) continue;
      const set = this._layerListeners.get(layer);
      if (!set) continue;
      for (const listener of set) {
        try {
          listener(action, prevState[layer], nextState[layer]);
        } catch (err) {
          logger.error(`[StateEngine] Layer ${layer} listener error:`, { error: err?.message || String(err) });
        }
      }
    }
  }

  /**
   * Notify listeners for batch dispatch (single notification for multiple actions)
   * @private
   */
  _notifyListenersBatch(actions, prevState, nextState) {
    // Create synthetic batch action for global listeners
    const batchAction = {
      type: BATCH,
      payload: { actions, count: actions.length },
      meta: actions[0]?.meta || {},
    };

    // Global listeners receive batch summary
    for (const listener of this._listeners) {
      try {
        listener(batchAction, prevState, nextState);
      } catch (err) {
        logger.error("[StateEngine] Listener error (batch):", { error: err?.message || String(err) });
      }
    }

    // Layer listeners - only notify for layers that actually changed
    const diff = diffLayers(prevState, nextState);
    for (const [layer, changed] of Object.entries(diff)) {
      if (!changed) continue;
      const set = this._layerListeners.get(layer);
      if (!set) continue;
      for (const listener of set) {
        try {
          listener(batchAction, prevState[layer], nextState[layer]);
        } catch (err) {
          logger.error(`[StateEngine] Layer ${layer} listener error (batch):`, { error: err?.message || String(err) });
        }
      }
    }
  }

  /**
   * Emit state change to EventBus
   * @private
   */
  _emitStateChange(action, prevState, nextState) {
    if (!this._eventBus?.emit) return;

    const layer = getActionLayer(action.type);
    this._eventBus.emit("state.changed", {
      action: {
        type: action.type,
        layer,
        seq: action.meta?.seq,
        ts: action.meta?.ts,
      },
      runId: nextState.runId,
    });
  }

  /**
   * Emit batch state change to EventBus (single emit for multiple actions)
   * @private
   */
  _emitBatchStateChange(actions, prevState, nextState) {
    if (!this._eventBus?.emit) return;

    // Collect affected layers
    const layers = new Set();
    for (const action of actions) {
      const layer = getActionLayer(action.type);
      if (layer) layers.add(layer);
    }

    this._eventBus.emit("state.batch_changed", {
      actions: actions.map(a => ({
        type: a.type,
        layer: getActionLayer(a.type),
      })),
      layers: Array.from(layers),
      count: actions.length,
      seq: actions[0]?.meta?.seq,
      ts: actions[0]?.meta?.ts,
      runId: nextState.runId,
    });
  }

  /**
   * Get action history for replay/debugging
   * @param {number} [limit] - Limit number of actions returned
   * @returns {object[]} Action history
   */
  getActionHistory(limit) {
    if (!this._enableActionHistory) return [];
    const n = typeof limit === "number" && limit > 0 ? limit : this._actionHistory.length;
    return this._actionHistory.slice(-n).map(cloneJson);
  }

  /**
   * Replay actions on a fresh state
   * @param {object[]} actions - Actions to replay
   * @param {object} [initialState] - Starting state
   * @returns {object} Final state after replay
   */
  replay(actions, initialState) {
    let state = initialState ? { ...createInitialState(), ...initialState } : createInitialState();

    for (const action of actions) {
      state = rootReducer(state, action);
    }

    return state;
  }

  /**
   * Reset state to initial
   * @param {object} [newState] - Optional new initial state
   */
  reset(newState) {
    const prevState = this._state;
    this._state = newState
      ? { ...createInitialState(), ...newState }
      : createInitialState();
    this._actionHistory = [];
    this._clock = new LamportClock({ actorId: this._state.runId });

    // Notify listeners of reset
    const resetAction = { type: "@@RESET", payload: {}, meta: { ts: Date.now(), seq: 0 } };
    this._notifyListeners(resetAction, prevState, this._state);
  }

  /**
   * Get current Lamport clock value
   */
  getClockValue() {
    return this._clock.value;
  }

  /**
   * Receive external clock value (for distributed sync)
   * @param {number} externalSeq
   */
  receiveClockValue(externalSeq) {
    this._clock.receive(externalSeq);
  }

  /**
   * Create a snapshot of current state
   */
  createSnapshot() {
    return {
      state: cloneJson(this._state),
      clock: this._clock.value,
      ts: Date.now(),
    };
  }

  /**
   * Restore from a snapshot
   * @param {object} snapshot
   */
  restoreSnapshot(snapshot) {
    if (!snapshot?.state) return false;

    this._state = cloneJson(snapshot.state);
    if (typeof snapshot.clock === "number") {
      this._clock = new LamportClock({
        actorId: this._state.runId,
        initialValue: snapshot.clock,
      });
    }
    return true;
  }

  /**
   * Save differential checkpoint
   * @param {object} [options]
   * @param {number} [options.fullSnapshotEvery=10] - Force full snapshot every N checkpoints
   * @returns {object} Checkpoint metadata
   */
  saveCheckpoint(options = {}) {
    const { fullSnapshotEvery = 10 } = options;
    const checkpointId = generateId("cp");
    const ts = Date.now();
    const clock = this._clock.value;

    // Find most recent checkpoint as base
    const checkpointList = this._state.L3?.checkpoints || [];
    const lastCp = checkpointList[checkpointList.length - 1];
    const checkpointCount = checkpointList.length;

    // Determine encoding
    const shouldFull = !lastCp || checkpointCount % fullSnapshotEvery === 0;

    let checkpoint;
    if (shouldFull) {
      checkpoint = {
        checkpointId,
        ts,
        clock,
        encoding: "full",
        data: cloneJson(this._state),
      };
    } else {
      // Differential: store patch from last full/diff checkpoint
      const baseState = this._checkpoints.get(lastCp.checkpointId)?.data;
      if (!baseState) {
        // Fallback to full if base not found
        checkpoint = {
          checkpointId,
          ts,
          clock,
          encoding: "full",
          data: cloneJson(this._state),
        };
      } else {
        const patch = buildStatePatch(baseState, this._state);
        checkpoint = {
          checkpointId,
          ts,
          clock,
          encoding: "diff",
          baseId: lastCp.checkpointId,
          patch,
        };
      }
    }

    // Store in memory for future diffs
    this._checkpoints.set(checkpointId, {
      ...checkpoint,
      data: cloneJson(this._state),
    });

    // Add to L3.checkpoints
    this.dispatchSync({
      type: L3_ADD_CHECKPOINT,
      payload: { checkpoint: { checkpointId, ts, clock, encoding: checkpoint.encoding, baseId: checkpoint.baseId } },
    });

    return checkpoint;
  }

  /**
   * Restore from checkpoint by ID
   * @param {string} checkpointId
   * @returns {boolean} Success
   */
  restoreCheckpoint(checkpointId) {
    const cp = this._checkpoints.get(checkpointId);
    if (!cp?.data) return false;

    // Preserve checkpoint log
    const checkpoints = this._state.L3?.checkpoints || [];

    // Restore state
    this._state = {
      ...cloneJson(cp.data),
      L3: {
        ...cloneJson(cp.data.L3 || {}),
        checkpoints, // Keep checkpoint log
      },
    };

    if (typeof cp.clock === "number") {
      this._clock = new LamportClock({
        actorId: this._state.runId,
        initialValue: cp.clock,
      });
    }

    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { rootReducer, reduceL0, reduceL1, reduceL2, reduceL3 };

export default StateEngine;
