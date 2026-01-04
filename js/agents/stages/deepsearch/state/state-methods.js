import { isPlainObject, safeInt, safeNumber, toNonEmptyString } from "../../../shared/utils/value-utils.js";
import { ensureTokenUsage, normalizeBudgetConfig } from "../utils/state-utils.js";
import { normalizeTokenUsage } from "../model/usage.js";
import { cloneValue } from "../runtime/checkpoint.js";
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
} from "../../../runtime/memory/action-types.js";

export const stateMethods = {
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

  getBudgetConfig() {
    return normalizeBudgetConfig(this?.userConfig?.budget);
  },

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

      for (const [k, v] of Object.entries(patch)) {
        if (k === "text" || k === "content" || k === "title" || k === "status") continue;
        draft[k] = v;
      }

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

    for (const [k, v] of Object.entries(patch)) {
      if (k === "text" || k === "content" || k === "title" || k === "status") continue;
      todo[k] = v;
    }

    if (patch.status !== undefined && typeof this?._syncToShared === "function") {
      this._syncToShared("todo", todo.todoId || key, {
        status: todo.status || "pending",
        keywords: [todo.text?.slice(0, 50)].filter(Boolean),
      });
    }

    return todo;
  },

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

  addTimeline({ name, status = "info", payload } = {}) {
    return addTimelineLogic(this, { name, status, payload });
  },

  saveWriteSnapshot({ timestamp } = {}) {
    return saveWriteSnapshotLogic(this, { timestamp });
  },

  reopenGaps(gapIds, { reason, timestamp } = {}, emit = null) {
    return reopenGapsLogic(this, gapIds, { reason, timestamp }, emit);
  },

  addNewGaps(newGaps, { timestamp } = {}, emit = null) {
    return addNewGapsLogic(this, newGaps, { timestamp }, emit);
  },

  _ensureTokenUsage() {
    if (!isPlainObject(this.L2)) this.L2 = {};
    this.L2.tokenUsage = ensureTokenUsage(this.L2.tokenUsage);
    return this.L2.tokenUsage;
  },
};
