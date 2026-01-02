/**
 * Action Types - 状态变更 Action 定义
 *
 * P1.1: StateEngine 的 Action 类型定义
 *
 * Action 结构:
 * {
 *   type: ActionType,
 *   payload: any,
 *   meta?: { ts: number, seq: number, actor?: string }
 * }
 */

// ─────────────────────────────────────────────────────────────────────────────
// L0: Immutable Layer Actions
// ─────────────────────────────────────────────────────────────────────────────

export const L0_SET_SYSTEM_PROMPT = "L0/SET_SYSTEM_PROMPT";
export const L0_SET_TASK_GOAL = "L0/SET_TASK_GOAL";
export const L0_ADD_TODO = "L0/ADD_TODO";
export const L0_UPDATE_TODO = "L0/UPDATE_TODO";
export const L0_REMOVE_TODO = "L0/REMOVE_TODO";
export const L0_REPLACE_TODOS = "L0/REPLACE_TODOS";

// ─────────────────────────────────────────────────────────────────────────────
// L1: Working Memory Actions
// ─────────────────────────────────────────────────────────────────────────────

export const L1_ADD_MESSAGE = "L1/ADD_MESSAGE";
export const L1_ADD_MESSAGES = "L1/ADD_MESSAGES";
export const L1_CLEAR_MESSAGES = "L1/CLEAR_MESSAGES";
export const L1_SET_MESSAGES = "L1/SET_MESSAGES";

export const L1_ADD_SIGNAL = "L1/ADD_SIGNAL";
export const L1_ACKNOWLEDGE_SIGNAL = "L1/ACKNOWLEDGE_SIGNAL";

export const L1_RECORD_DECISION = "L1/RECORD_DECISION";

export const L1_SET_SCRATCHPAD = "L1/SET_SCRATCHPAD";
export const L1_CLEAR_SCRATCHPAD = "L1/CLEAR_SCRATCHPAD";

export const L1_SET_FLAG = "L1/SET_FLAG";

export const L1_SYNC_DISCOVERY = "L1/SYNC_DISCOVERY";
export const L1_SYNC_SUBAGENT = "L1/SYNC_SUBAGENT";

// ─────────────────────────────────────────────────────────────────────────────
// L2: Condensed Memory Actions
// ─────────────────────────────────────────────────────────────────────────────

export const L2_SET_HISTORY_SUMMARY = "L2/SET_HISTORY_SUMMARY";
export const L2_APPEND_HISTORY_SUMMARY = "L2/APPEND_HISTORY_SUMMARY";
export const L2_SET_STAGE_SUMMARY = "L2/SET_STAGE_SUMMARY";
export const L2_ADD_CLAIM = "L2/ADD_CLAIM";
export const L2_REPLACE_CLAIMS = "L2/REPLACE_CLAIMS";

// ─────────────────────────────────────────────────────────────────────────────
// L3: Archive Actions
// ─────────────────────────────────────────────────────────────────────────────

export const L3_ARCHIVE = "L3/ARCHIVE";
export const L3_ADD_CHECKPOINT = "L3/ADD_CHECKPOINT";

// ─────────────────────────────────────────────────────────────────────────────
// Compression Actions
// ─────────────────────────────────────────────────────────────────────────────

export const COMPRESS = "MEMORY/COMPRESS";

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot Actions
// ─────────────────────────────────────────────────────────────────────────────

export const RESTORE_SNAPSHOT = "MEMORY/RESTORE_SNAPSHOT";
export const RESTORE_CHECKPOINT = "MEMORY/RESTORE_CHECKPOINT";

// ─────────────────────────────────────────────────────────────────────────────
// Batch Actions (for atomic multi-step operations)
// ─────────────────────────────────────────────────────────────────────────────

export const BATCH = "MEMORY/BATCH";

// ─────────────────────────────────────────────────────────────────────────────
// Action Creators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an action with optional metadata
 * @param {string} type - Action type
 * @param {any} payload - Action payload
 * @param {object} [meta] - Optional metadata
 * @returns {object} Action object
 */
export function createAction(type, payload, meta = {}) {
  return {
    type,
    payload,
    meta: {
      ts: Date.now(),
      ...meta,
    },
  };
}

// L0 Action Creators
export const setSystemPrompt = (prompt) => createAction(L0_SET_SYSTEM_PROMPT, { prompt });
export const setTaskGoal = (goal) => createAction(L0_SET_TASK_GOAL, { goal });
export const addTodo = (todo) => createAction(L0_ADD_TODO, { todo });
export const updateTodo = (id, updates) => createAction(L0_UPDATE_TODO, { id, updates });
export const removeTodo = (id) => createAction(L0_REMOVE_TODO, { id });
export const replaceTodos = (todos) => createAction(L0_REPLACE_TODOS, { todos });

// L1 Action Creators
export const addMessage = (message) => createAction(L1_ADD_MESSAGE, { message });
export const addMessages = (messages) => createAction(L1_ADD_MESSAGES, { messages });
export const clearMessages = () => createAction(L1_CLEAR_MESSAGES, {});
export const setMessages = (messages) => createAction(L1_SET_MESSAGES, { messages });

export const addSignal = (signal) => createAction(L1_ADD_SIGNAL, { signal });
export const acknowledgeSignal = (id) => createAction(L1_ACKNOWLEDGE_SIGNAL, { id });

export const recordDecision = (decision) => createAction(L1_RECORD_DECISION, { decision });

export const setScratchpad = (key, value) => createAction(L1_SET_SCRATCHPAD, { key, value });
export const clearScratchpad = () => createAction(L1_CLEAR_SCRATCHPAD, {});

export const setFlag = (name, value) => createAction(L1_SET_FLAG, { name, value });

export const syncDiscovery = (id, data) => createAction(L1_SYNC_DISCOVERY, { id, data });
export const syncSubagent = (id, data) => createAction(L1_SYNC_SUBAGENT, { id, data });

// L2 Action Creators
export const setHistorySummary = (summary) => createAction(L2_SET_HISTORY_SUMMARY, { summary });
export const appendHistorySummary = (summary) => createAction(L2_APPEND_HISTORY_SUMMARY, { summary });
export const setStageSummary = (stage, summary) => createAction(L2_SET_STAGE_SUMMARY, { stage, summary });
export const addClaim = (claim) => createAction(L2_ADD_CLAIM, { claim });
export const replaceClaims = (claims) => createAction(L2_REPLACE_CLAIMS, { claims });

// L3 Action Creators
export const archive = (stageKey, data, keywords) => createAction(L3_ARCHIVE, { stageKey, data, keywords });
export const addCheckpoint = (checkpoint) => createAction(L3_ADD_CHECKPOINT, { checkpoint });

// Compression Action Creators
export const compress = (options = {}) => createAction(COMPRESS, options);

// Snapshot Action Creators
export const restoreSnapshot = (snapshot) => createAction(RESTORE_SNAPSHOT, { snapshot });
export const restoreCheckpoint = (checkpointId) => createAction(RESTORE_CHECKPOINT, { checkpointId });

// Batch Action Creator
export const batch = (actions) => createAction(BATCH, { actions });

// ─────────────────────────────────────────────────────────────────────────────
// Action Type Groups (for validation)
// ─────────────────────────────────────────────────────────────────────────────

export const L0_ACTIONS = Object.freeze([
  L0_SET_SYSTEM_PROMPT,
  L0_SET_TASK_GOAL,
  L0_ADD_TODO,
  L0_UPDATE_TODO,
  L0_REMOVE_TODO,
  L0_REPLACE_TODOS,
]);

export const L1_ACTIONS = Object.freeze([
  L1_ADD_MESSAGE,
  L1_ADD_MESSAGES,
  L1_CLEAR_MESSAGES,
  L1_SET_MESSAGES,
  L1_ADD_SIGNAL,
  L1_ACKNOWLEDGE_SIGNAL,
  L1_RECORD_DECISION,
  L1_SET_SCRATCHPAD,
  L1_CLEAR_SCRATCHPAD,
  L1_SET_FLAG,
  L1_SYNC_DISCOVERY,
  L1_SYNC_SUBAGENT,
]);

export const L2_ACTIONS = Object.freeze([
  L2_SET_HISTORY_SUMMARY,
  L2_APPEND_HISTORY_SUMMARY,
  L2_SET_STAGE_SUMMARY,
  L2_ADD_CLAIM,
  L2_REPLACE_CLAIMS,
]);

export const L3_ACTIONS = Object.freeze([
  L3_ARCHIVE,
  L3_ADD_CHECKPOINT,
]);

export const ALL_ACTIONS = Object.freeze([
  ...L0_ACTIONS,
  ...L1_ACTIONS,
  ...L2_ACTIONS,
  ...L3_ACTIONS,
  COMPRESS,
  RESTORE_SNAPSHOT,
  RESTORE_CHECKPOINT,
  BATCH,
]);

/**
 * Check if an action type is valid
 */
export function isValidActionType(type) {
  return ALL_ACTIONS.includes(type);
}

/**
 * Get the layer affected by an action type
 */
export function getActionLayer(type) {
  if (L0_ACTIONS.includes(type)) return "L0";
  if (L1_ACTIONS.includes(type)) return "L1";
  if (L2_ACTIONS.includes(type)) return "L2";
  if (L3_ACTIONS.includes(type)) return "L3";
  return null;
}

export default {
  // Types
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
  COMPRESS,
  RESTORE_SNAPSHOT,
  RESTORE_CHECKPOINT,
  BATCH,
  // Creators
  createAction,
  setSystemPrompt,
  setTaskGoal,
  addTodo,
  updateTodo,
  removeTodo,
  replaceTodos,
  addMessage,
  addMessages,
  clearMessages,
  setMessages,
  addSignal,
  acknowledgeSignal,
  recordDecision,
  setScratchpad,
  clearScratchpad,
  setFlag,
  syncDiscovery,
  syncSubagent,
  setHistorySummary,
  appendHistorySummary,
  setStageSummary,
  addClaim,
  replaceClaims,
  archive,
  addCheckpoint,
  compress,
  restoreSnapshot,
  restoreCheckpoint,
  batch,
  // Utilities
  isValidActionType,
  getActionLayer,
  L0_ACTIONS,
  L1_ACTIONS,
  L2_ACTIONS,
  L3_ACTIONS,
  ALL_ACTIONS,
};
