import { isPlainObject, toNonEmptyString } from "../../../shared/utils/value-utils.js";
import { createLogger } from "../../../shared/utils/logger.js";
import { TodoStatus, isValidTodoStatus } from "../states.js";

const logger = createLogger("stages/deepsearch/utils/todo-utils");

/**
 * @typedef {"high"|"medium"|"low"} TodoPriorityValue
 * @typedef {"open"|"pending"|"in_progress"|"completed"|"cancelled"} TodoStatusValue
 * @typedef {"user"|"llm"|"system"} TodoSourceValue
 *
 * @typedef {object} TodoHistoryEntry
 * @property {TodoStatusValue|null} from
 * @property {TodoStatusValue} to
 * @property {string} ts
 *
 * @typedef {object} DeepSearchTodo
 * @property {string} todoId
 * @property {string} text
 * @property {TodoPriorityValue} priority
 * @property {TodoStatusValue} status
 * @property {string[]} queryHints
 * @property {string} expectedEvidence
 * @property {TodoSourceValue} source
 * @property {TodoHistoryEntry[]} history
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string=} relatedGapId
 */

export const TodoSchema = Object.freeze({
  todoId: "string (required)",
  text: "string (required)",
  priority: "high|medium|low",
  status: "open|pending|in_progress|completed|cancelled",
  queryHints: "string[]",
  expectedEvidence: "string",
  source: "user|llm|system",
  history: "array of status changes",
  createdAt: "ISO string",
  updatedAt: "ISO string",
});

const TODO_PRIORITIES = new Set(["high", "medium", "low"]);
const TODO_SOURCES = new Set(["user", "llm", "system"]);

function normalizeStringArray(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

/**
 * @param {any} value
 * @returns {TodoPriorityValue}
 */
function normalizePriority(value) {
  const v = String(value || "").toLowerCase();
  return TODO_PRIORITIES.has(v) ? /** @type {TodoPriorityValue} */ (v) : "medium";
}

/**
 * @param {any} value
 * @returns {TodoSourceValue}
 */
function normalizeSource(value) {
  const v = String(value || "").toLowerCase();
  return TODO_SOURCES.has(v) ? /** @type {TodoSourceValue} */ (v) : "system";
}

/**
 * @param {any} value
 * @param {any} raw
 * @returns {TodoStatusValue}
 */
function normalizeStatus(value, raw) {
  if (typeof value === "boolean") return value ? TodoStatus.COMPLETED : TodoStatus.OPEN;
  const r = isPlainObject(raw) ? raw : {};
  if (r.done === true || r.completed === true) return TodoStatus.COMPLETED;

  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (v === "done") return TodoStatus.COMPLETED;
  if (v === "complete") return TodoStatus.COMPLETED;
  if (v === "canceled") return TodoStatus.CANCELLED;
  if (v === "cancel") return TodoStatus.CANCELLED;
  if (v === "inprogress") return TodoStatus.IN_PROGRESS;
  if (v === "in-progress") return TodoStatus.IN_PROGRESS;
  if (v === "in progress") return TodoStatus.IN_PROGRESS;
  if (v === "progress") return TodoStatus.IN_PROGRESS;
  return isValidTodoStatus(v) ? /** @type {TodoStatusValue} */ (v) : TodoStatus.OPEN;
}

function isIsoString(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const ts = Date.parse(value);
  return Number.isFinite(ts);
}

function deriveTodoIdFromGapId(gapId) {
  if (!gapId) return `todo_${Date.now().toString(36)}`;
  const m = String(gapId).match(/^gap_(\d+)$/);
  if (m) return `todo_${m[1]}`;
  return `todo_${String(gapId)}`;
}

/**
 * Create a normalized todo record (best-effort, tolerant of legacy field names).
 * @param {Partial<DeepSearchTodo> & Record<string, any>} [params]
 * @returns {DeepSearchTodo}
 */
export function createTodo(params = {}) {
  const raw = isPlainObject(params) ? params : {};
  const now = new Date().toISOString();
  const todoId = toNonEmptyString(raw.todoId) || toNonEmptyString(raw.id) || `todo_${Date.now().toString(36)}`;
  const text = toNonEmptyString(raw.text) || toNonEmptyString(raw.content) || toNonEmptyString(raw.title) || "";

  // 如果 text 为空，记录警告
  if (!text) {
    logger.warn(`[createTodo] Creating todo ${todoId} with empty text:`, { raw: JSON.stringify(raw).slice(0, 200) });
  }

  const priority = normalizePriority(raw.priority);
  const status = normalizeStatus(raw.status, raw);
  const queryHints = normalizeStringArray(raw.queryHints);
  const expectedEvidence = toNonEmptyString(raw.expectedEvidence) || "";
  const source = normalizeSource(raw.source);
  const createdAt = isIsoString(raw.createdAt) ? raw.createdAt : now;
  const updatedAt = isIsoString(raw.updatedAt) ? raw.updatedAt : createdAt;
  const history = Array.isArray(raw.history) ? [...raw.history] : [];

  if (!history.length) {
    history.push({ from: null, to: status, ts: createdAt });
  }

  const todo = {
    todoId,
    text,
    priority,
    status,
    queryHints,
    expectedEvidence,
    source,
    history,
    createdAt,
    updatedAt,
  };

  const relatedGapId = toNonEmptyString(raw.relatedGapId);
  if (relatedGapId) todo.relatedGapId = String(relatedGapId);
  return todo;
}

/**
 * Validate a todo record against a minimal schema.
 * @param {any} todo
 * @returns {{valid: boolean, issues: string[]}}
 */
export function validateTodo(todo) {
  const issues = [];
  if (!isPlainObject(todo)) {
    return { valid: false, issues: ["todo must be an object"] };
  }

  if (!toNonEmptyString(todo.todoId)) issues.push("todoId is required");
  if (!toNonEmptyString(todo.text)) issues.push("text is required");

  const priority = toNonEmptyString(todo.priority);
  if (priority && !TODO_PRIORITIES.has(priority.toLowerCase())) {
    issues.push("priority must be high|medium|low");
  }

  const status = toNonEmptyString(todo.status);
  if (status && !isValidTodoStatus(status.toLowerCase())) {
    issues.push("status must be open|pending|in_progress|completed|cancelled");
  }

  if ("queryHints" in todo) {
    if (!Array.isArray(todo.queryHints)) {
      issues.push("queryHints must be an array");
    } else if (todo.queryHints.some((h) => typeof h !== "string" || !h.trim())) {
      issues.push("queryHints must contain non-empty strings");
    }
  }

  if ("expectedEvidence" in todo && todo.expectedEvidence !== undefined && typeof todo.expectedEvidence !== "string") {
    issues.push("expectedEvidence must be a string");
  }

  const source = toNonEmptyString(todo.source);
  if (source && !TODO_SOURCES.has(source.toLowerCase())) {
    issues.push("source must be user|llm|system");
  }

  if ("history" in todo && !Array.isArray(todo.history)) {
    issues.push("history must be an array");
  }

  if ("createdAt" in todo && todo.createdAt !== undefined && todo.createdAt !== null && !isIsoString(todo.createdAt)) {
    issues.push("createdAt must be an ISO timestamp");
  }
  if ("updatedAt" in todo && todo.updatedAt !== undefined && todo.updatedAt !== null && !isIsoString(todo.updatedAt)) {
    issues.push("updatedAt must be an ISO timestamp");
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Transition a todo to a new status, updating timestamps + history.
 * @param {DeepSearchTodo} todo
 * @param {any} newStatus
 * @param {(eventName:string, payload:any)=>void=} emit
 * @returns {boolean}
 */
export function transitionTodoStatus(todo, newStatus, emit) {
  if (!todo || typeof todo !== "object") return false;
  const fromCandidate = toNonEmptyString(todo.status)?.toLowerCase() || "";
  const from = isValidTodoStatus(fromCandidate) ? /** @type {TodoStatusValue} */ (fromCandidate) : TodoStatus.OPEN;
  const toRaw = toNonEmptyString(newStatus);
  const toCandidate = toRaw ? toRaw.toLowerCase() : "";
  if (!isValidTodoStatus(toCandidate)) return false;
  const to = /** @type {TodoStatusValue} */ (toCandidate);
  if (from === to) return false;
  // 简化：移除状态机验证，允许任意有效状态转换

  const now = new Date().toISOString();
  todo.status = to;
  if (!toNonEmptyString(todo.createdAt)) todo.createdAt = now;
  todo.updatedAt = now;
  if (!Array.isArray(todo.history)) todo.history = [];
  todo.history.push({ from, to, ts: now });

  emit?.("deepsearch.todo.status.changed", {
    todoId: toNonEmptyString(todo.todoId) || "todo_unknown",
    from,
    to,
    ts: now,
  });

  return true;
}

/**
 * Best-effort migrate a legacy "gap" record to a todo.
 * @param {any} gap
 * @returns {DeepSearchTodo|null}
 */
export function migratGapToTodo(gap) {
  if (!isPlainObject(gap)) return null;
  const gapId = toNonEmptyString(gap.gapId);
  const question = toNonEmptyString(gap.question);
  const type = toNonEmptyString(gap.type) || "gap";
  const text = question ? `Fill gap: ${type} - ${question}` : `Fill gap: ${gapId || "gap"}`;
  const status = (() => {
    const s = String(gap.status || "").toLowerCase();
    if (s === "filled") return TodoStatus.COMPLETED;
    if (s === "blocked") return TodoStatus.CANCELLED;
    if (s === "searching" || s === "understanding") return TodoStatus.PENDING;
    return TodoStatus.OPEN;
  })();

  return createTodo({
    todoId: deriveTodoIdFromGapId(gapId),
    text,
    priority: normalizePriority(gap.priority),
    status,
    queryHints: Array.isArray(gap.queryHints) ? gap.queryHints : [],
    source: "system",
    relatedGapId: gapId,
    createdAt: toNonEmptyString(gap.createdAt),
  });
}

/**
 * Alias for {@link migratGapToTodo} (spelling fixed).
 * @param {any} gap
 * @returns {DeepSearchTodo|null}
 */
export const migrateGapToTodo = migratGapToTodo;
