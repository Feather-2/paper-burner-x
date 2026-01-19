import { isPlainObject, safeInt, safeNumber, toNonEmptyString } from "../../../shared/index.js";
import { ensureTokenUsage, normalizeBudgetConfig } from "../utils/state-utils.js";
import { normalizeTokenUsage } from "../model/usage.js";
import { cloneValue } from "../internal/checkpoint.js";
import { createTodo, transitionTodoStatus } from "../utils/todo-utils.js";
import {
  addTodo as addTodoLogic,
  setAwaitUserFeedback as setAwaitUserFeedbackLogic,
  setTaskImpossible as setTaskImpossibleLogic,
  addTimeline as addTimelineLogic,
  saveWriteSnapshot as saveWriteSnapshotLogic,
  reopenGaps as reopenGapsLogic,
  addNewGaps as addNewGapsLogic,
} from "../state-logic.js";
import {
  L0_ADD_TODO,
  L0_UPDATE_TODO,
  L0_REMOVE_TODO,
  L0_REPLACE_TODOS,
} from "../../../plugins/memory/index.js";

const TODO_PATCH_FIELDS = new Set([
  "priority",
  "queryHints",
  "expectedEvidence",
  "source",
  "history",
  "createdAt",
  "updatedAt",
  "relatedGapId",
]);

const BLOCKED_PATCH_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function applyTodoPatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (BLOCKED_PATCH_KEYS.has(key)) continue;
    if (!TODO_PATCH_FIELDS.has(key)) continue;
    target[key] = value;
  }
}

export const stateMethods = {
  /**
   * Add token usage deltas to state.
   * @param {Record<string, unknown>} usage
   * @returns {{ input: number, output: number, total: number, estimatedCostUSD: number }}
   */
  addTokenUsage(usage) {
    const delta = normalizeTokenUsage(usage);
    if (!delta) return this?.L2?.tokenUsage || { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };
    const estimatedCostUSDDeltaRaw = safeNumber(usage?.estimatedCostUSD ?? usage?.costUSD);
    const estimatedCostUSDDelta = estimatedCostUSDDeltaRaw !== null ? Math.max(0, estimatedCostUSDDeltaRaw) : null;

    if (!isPlainObject(this.L2)) this.L2 = {};
    if (typeof this.L2.awaitUserFeedback !== "boolean") this.L2.awaitUserFeedback = false;
    if (typeof this.L2.taskImpossible !== "boolean") this.L2.taskImpossible = false;
    if (!toNonEmptyString(this.L2.reason)) this.L2.reason = "";
    if (!isPlainObject(this.L2.tokenUsage)) this.L2.tokenUsage = { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };

    const cur = this.L2.tokenUsage;
    cur.input = (safeInt(cur.input) ?? 0) + delta.input;
    cur.output = (safeInt(cur.output) ?? 0) + delta.output;
    cur.total = (safeInt(cur.total) ?? 0) + delta.total;
    const curCost = safeNumber(cur.estimatedCostUSD) ?? 0;
    cur.estimatedCostUSD = estimatedCostUSDDelta !== null ? curCost + estimatedCostUSDDelta : curCost;
    return cur;
  },

  /**
   * Read normalized budget configuration.
   * @returns {import("../utils/state-utils.js").BudgetConfig}
   */
  getBudgetConfig() {
    return normalizeBudgetConfig(this?.userConfig?.budget);
  },

  /**
   * Add a todo item to the state.
   * @param {Record<string, unknown>=} params
   * @returns {import("../utils/todo-utils.js").DeepSearchTodo|Record<string, unknown>|null}
   */
  addTodo(params = {}) {
    const engine = this?._stateEngine;
    if (engine && typeof engine.dispatchSync === "function") {
      const raw = isPlainObject(params) ? params : {};
      const id = toNonEmptyString(raw.todoId) || toNonEmptyString(raw.id) || `todo_${(Array.isArray(this.todos) ? this.todos.length : 0) + 1}`;
      const row = createTodo({ ...raw, todoId: id });
      engine.dispatchSync({ type: L0_ADD_TODO, payload: { todo: cloneValue(row) } });
      if (typeof this?._syncFromStateEngine === "function") this._syncFromStateEngine();

      const created =
        toNonEmptyString(row.todoId) ? (this.todos || []).find((t) => t?.todoId === row.todoId || t?.id === row.todoId) : null;

      if (typeof this?._syncToShared === "function") {
        const todoForSync = created || row;
        this._syncToShared("todo", todoForSync.todoId, {
          status: todoForSync.status || "pending",
          keywords: [todoForSync.text?.slice(0, 50)].filter(Boolean),
        });
      }

      return created || row;
    }

    return addTodoLogic(this, params);
  },

  /**
   * Replace the entire todo list.
   * @param {Array<Record<string, unknown>>} todos
   * @returns {Array<Record<string, unknown>>}
   */
  replaceTodos(todos) {
    const list = Array.isArray(todos) ? todos : [];
    const engine = this?._stateEngine;
    if (engine && typeof engine.dispatchSync === "function") {
      engine.dispatchSync({ type: L0_REPLACE_TODOS, payload: { todos: cloneValue(list) } });
      if (typeof this?._syncFromStateEngine === "function") this._syncFromStateEngine();
      return this.todos;
    }

    if (!Array.isArray(this.todos)) this.todos = [];
    const target = this.todos;
    target.length = 0;
    target.push(...list);
    return target;
  },

  /**
   * Update an existing todo.
   * @param {string} id
   * @param {Record<string, unknown>} updates
   * @param {(eventName: string, payload: unknown) => void|null} [emit]
   * @returns {Record<string, unknown>|null}
   */
  updateTodo(id, updates, emit = null) {
    const key = toNonEmptyString(id);
    const patch = isPlainObject(updates) ? updates : null;
    if (!key || !patch) return null;

    const todos = Array.isArray(this.todos) ? this.todos : [];
    const todo = todos.find((t) => t?.todoId === key || t?.id === key);
    if (!todo) return null;

    const emitFn = typeof emit === "function" ? emit : null;
    const engine = this?._stateEngine;
    if (engine && typeof engine.dispatchSync === "function") {
      const draft = cloneValue(todo);
      const nextText = patch.text ?? patch.content ?? patch.title;
      if (typeof nextText === "string" && nextText.trim()) {
        draft.text = nextText.trim();
        draft.content = draft.text;
        draft.updatedAt = new Date().toISOString();
      }

      if (patch.status !== undefined) transitionTodoStatus(draft, patch.status, emitFn);

      applyTodoPatch(draft, patch);

      engine.dispatchSync({ type: L0_UPDATE_TODO, payload: { id: key, updates: cloneValue(draft) } });
      if (typeof this?._syncFromStateEngine === "function") this._syncFromStateEngine();

      const updated = (this.todos || []).find((t) => t?.todoId === key || t?.id === key) || null;
      if (updated && patch.status !== undefined && typeof this?._syncToShared === "function") {
        this._syncToShared("todo", updated.todoId || key, {
          status: updated.status || "pending",
          keywords: [updated.text?.slice(0, 50)].filter(Boolean),
        });
      }

      return updated || draft;
    }

    const nextText = patch.text ?? patch.content ?? patch.title;
    if (typeof nextText === "string" && nextText.trim()) {
      todo.text = nextText.trim();
      todo.content = todo.text;
      todo.updatedAt = new Date().toISOString();
    }

    if (patch.status !== undefined) transitionTodoStatus(todo, patch.status, emitFn);

    applyTodoPatch(todo, patch);

    if (patch.status !== undefined && typeof this?._syncToShared === "function") {
      this._syncToShared("todo", todo.todoId || key, {
        status: todo.status || "pending",
        keywords: [todo.text?.slice(0, 50)].filter(Boolean),
      });
    }

    return todo;
  },

  /**
   * Remove a todo by id.
   * @param {string} id
   * @returns {Record<string, unknown>|null}
   */
  removeTodo(id) {
    const key = toNonEmptyString(id);
    if (!key) return null;

    const todos = Array.isArray(this.todos) ? this.todos : [];
    const idx = todos.findIndex((t) => t?.todoId === key || t?.id === key);
    const existing = idx >= 0 ? todos[idx] : null;

    const engine = this?._stateEngine;
    if (engine && typeof engine.dispatchSync === "function") {
      engine.dispatchSync({ type: L0_REMOVE_TODO, payload: { id: key } });
      if (typeof this?._syncFromStateEngine === "function") this._syncFromStateEngine();
      return existing;
    }

    if (idx < 0) return null;
    return todos.splice(idx, 1)[0] || null;
  },

  setAwaitUserFeedback(value, reason) {
    return setAwaitUserFeedbackLogic(this, value, reason);
  },

  setTaskImpossible(reason) {
    return setTaskImpossibleLogic(this, reason);
  },

  /**
   * @param {{ name?: string, status?: string, payload?: any }=} entry
   * @returns {any}
   */
  addTimeline({ name, status = "info", payload } = {}) {
    return addTimelineLogic(this, { name, status, payload });
  },

  /**
   * @param {{ timestamp?: string }=} options
   * @returns {any}
   */
  saveWriteSnapshot({ timestamp } = {}) {
    return saveWriteSnapshotLogic(this, { timestamp });
  },

  /**
   * @param {string[]|string} gapIds
   * @param {{ reason?: string, timestamp?: string }=} options
   * @param {(eventName:string, payload:any)=>void|null} [emit]
   * @returns {any}
   */
  reopenGaps(gapIds, { reason, timestamp } = {}, emit = null) {
    return reopenGapsLogic(this, gapIds, { reason, timestamp }, emit);
  },

  /**
   * @param {any[]} newGaps
   * @param {{ timestamp?: string }=} options
   * @param {(eventName:string, payload:any)=>void|null} [emit]
   * @returns {any}
   */
  addNewGaps(newGaps, { timestamp } = {}, emit = null) {
    return addNewGapsLogic(this, newGaps, { timestamp }, emit);
  },

  _ensureTokenUsage() {
    if (!isPlainObject(this.L2)) this.L2 = {};
    this.L2.tokenUsage = ensureTokenUsage(this.L2.tokenUsage);
    return this.L2.tokenUsage;
  },
};
