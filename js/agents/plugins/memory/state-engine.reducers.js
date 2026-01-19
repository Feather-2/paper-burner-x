/**
 * StateEngine - State transitions and reducers
 */

import { isPlainObject, toNonEmptyString, deepClone } from "../../shared/index.js";
import { cloneJson } from "./state-diff.js";
import { normalizeTodoEntry, normalizeTodoPriority, normalizeTodoStatus } from "./todo-normalize.js";
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
  RESTORE_SNAPSHOT,
  BATCH,
  getActionLayer,
} from "./action-types.js";
import { generateId, truncate } from "./state-engine.utils.js";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// ─────────────────────────────────────────────────────────────────────────────
// Initial State Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create initial state for StateEngine.
 * @param {object} [options] - Options
 * @param {string} [options.runId] - Run ID (auto-generated if not provided)
 * @returns {object} Initial state object with L0-L3 layers
 */
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

/**
 * L0 layer reducer.
 * @param {object} state - Current state
 * @param {object} action - Action with type and payload
 * @returns {object} Next state
 * @private
 */
export function reduceL0(state, action) {
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
      const entry = normalizeTodoEntry(payload?.todo, { generateId, fillTimestamps: true });
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
      const todos = Array.isArray(payload?.todos)
        ? payload.todos.map((t) => normalizeTodoEntry(t, { generateId, fillTimestamps: true }))
        : [];
      return { ...state, L0: { ...L0, todos } };
    }

    default:
      return state;
  }
}

/**
 * L1 layer reducer.
 * @param {object} state - Current state
 * @param {object} action - Action with type and payload
 * @returns {object} Next state
 * @private
 */
export function reduceL1(state, action) {
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
        id: toNonEmptyString(signal.id) || generateId("sig"),
        type: toNonEmptyString(signal.type) || "info",
        message: toNonEmptyString(signal.message) || "",
        payload: signal.payload || {},
        acknowledged: Boolean(signal.acknowledged),
        ts: typeof signal.ts === "number" && Number.isFinite(signal.ts) ? signal.ts : Date.now(),
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
        id: toNonEmptyString(decision.id) || generateId("dec"),
        action: decision.action || decision.type || "unknown",
        reason: decision.reason || "",
        result: decision.result || null,
        ts: typeof decision.ts === "number" && Number.isFinite(decision.ts) ? decision.ts : Date.now(),
      };
      return { ...state, L1: { ...L1, decisions: [...L1.decisions, entry] } };
    }

    case L1_SET_SCRATCHPAD: {
      const { key, value } = payload || {};
      if (isPlainObject(key) && value === undefined) {
        const entries = Object.entries(key).filter(([entryKey]) => !UNSAFE_KEYS.has(entryKey));
        if (entries.length === 0) return state;
        return { ...state, L1: { ...L1, scratchpad: { ...L1.scratchpad, ...Object.fromEntries(entries) } } };
      }
      const safeKey = toNonEmptyString(key);
      if (!safeKey || UNSAFE_KEYS.has(safeKey)) return state;
      return { ...state, L1: { ...L1, scratchpad: { ...L1.scratchpad, [safeKey]: value } } };
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
      if (!key || UNSAFE_KEYS.has(key)) return state;

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
      if (!key || UNSAFE_KEYS.has(key)) return state;

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

/**
 * L2 layer reducer.
 * @param {object} state - Current state
 * @param {object} action - Action with type and payload
 * @returns {object} Next state
 * @private
 */
export function reduceL2(state, action) {
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

/**
 * L3 layer reducer.
 * @param {object} state - Current state
 * @param {object} action - Action with type and payload
 * @returns {object} Next state
 * @private
 */
export function reduceL3(state, action) {
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

/**
 * Root reducer - dispatches to layer reducers.
 * @param {object} state - Current state
 * @param {object} action - Action with type and payload
 * @returns {object} Next state
 */
export function rootReducer(state, action) {
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
