import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { makeSecureTimestampedId } from "../../shared/utils/secure-id.js";

function defaultGenerateId(prefix = "id") {
  return makeSecureTimestampedId(prefix);
}

/**
 * Normalize todo status to canonical form.
 * @param {any} value - Raw status value
 * @returns {string} Normalized status ("pending", "completed", "in_progress", "cancelled", or original)
 */
export function normalizeTodoStatus(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!v) return "pending";
  if (v === "done" || v === "complete" || v === "completed") return "completed";
  if (v === "inprogress" || v === "in_progress" || v === "in-progress" || v === "in progress") return "in_progress";
  if (v === "cancel" || v === "canceled" || v === "cancelled") return "cancelled";
  return v;
}

/**
 * Normalize todo priority to canonical form.
 * @param {any} value - Raw priority value
 * @returns {string} Normalized priority ("high", "medium", "low", or original)
 */
export function normalizeTodoPriority(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "high" || v === "medium" || v === "low") return v;
  if (v === "normal") return "medium";
  return v || "medium";
}

/**
 * Normalize todo into a canonical object.
 *
 * @param {any} todo - Raw todo input
 * @param {{
 *   generateId?: (prefix?: string) => string,
 *   fillTimestamps?: boolean,
 * }} [options] - Options
 * @returns {object} Normalized todo object
 */
export function normalizeTodoEntry(todo, options = {}) {
  const raw = isPlainObject(todo) ? todo : { text: String(todo ?? "") };
  const generateId = typeof options.generateId === "function" ? options.generateId : defaultGenerateId;
  const fillTimestamps = options.fillTimestamps !== false;

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

  const createdAtInput = typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : null;
  const updatedAtInput = typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : null;

  const createdAt = fillTimestamps ? (createdAtInput || new Date().toISOString()) : createdAtInput;
  const updatedAt = fillTimestamps ? (updatedAtInput || createdAt || new Date().toISOString()) : updatedAtInput;

  const ts = typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : Date.now();

  /** @type {any} */
  const out = {
    ...raw,
    id,
    todoId: todoId || id,
    text: text || "",
    content: text || "",
    status,
    priority,
    ts,
  };

  if (createdAt) out.createdAt = createdAt;
  if (updatedAt) out.updatedAt = updatedAt;

  return out;
}

/**
 * Normalize todo in place (mutates input).
 * @param {object} todo - Todo object to normalize
 * @returns {object|null} The normalized todo or null if invalid
 */
export function normalizeTodoInPlace(todo) {
  if (!todo || typeof todo !== "object") return null;

  if (todo.todoId && !todo.id) todo.id = todo.todoId;
  if (todo.id && !todo.todoId) todo.todoId = todo.id;

  if (todo.text && !todo.content) todo.content = todo.text;
  if (todo.content && !todo.text) todo.text = todo.content;

  if ("status" in todo) todo.status = normalizeTodoStatus(todo.status);
  if ("priority" in todo) todo.priority = normalizeTodoPriority(todo.priority);
  return todo;
}

export default {
  normalizeTodoStatus,
  normalizeTodoPriority,
  normalizeTodoEntry,
  normalizeTodoInPlace,
};

