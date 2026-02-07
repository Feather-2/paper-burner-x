import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { deepClone } from "../../shared/utils/value-utils.js";
import { normalizeTodoEntry, normalizeTodoInPlace, normalizeTodoStatus } from "./todo-normalize.js";
import { defineGetter, defineMethod, estimateTokens, genId } from "./memory-store.impl.utils.js";

export function defineL0Layer() {
  return {
    L0: defineGetter(function () {
      // 浅拷贝 + freeze，防止外部直接修改
      const shallow = {
        systemPrompt: this._L0.systemPrompt,
        taskGoal: this._L0.taskGoal,
        todos: Object.freeze([...this._L0.todos]), // 数组浅拷贝
      };
      return Object.freeze(shallow);
    }),

    cloneL0: defineMethod(function () {
      return deepClone(this._L0);
    }),

    setSystemPrompt: defineMethod(function (prompt) {
      const next = toNonEmptyString(prompt) || "";
      const prev = this._L0.systemPrompt;
      if (next === prev) return;

      this._L0.systemPrompt = next;
      this._markDirty("L0");
      const delta = estimateTokens(next, this._tokenCounter) - estimateTokens(prev, this._tokenCounter);
      this._stats.l0Tokens += delta;
      this._stats.tokenUsage += delta;
    }),

    setTaskGoal: defineMethod(function (goal) {
      this._L0.taskGoal = toNonEmptyString(goal) || "";
      this._markDirty("L0");
    }),

    getTaskGoal: defineMethod(function () {
      return this._L0.taskGoal || "";
    }),

    addTodo: defineMethod(function (todo) {
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
    }),

    updateTodo: defineMethod(function (id, data) {
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
    }),

    removeTodo: defineMethod(function (id) {
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
    }),

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
    getTodos: defineMethod(function (filter) {
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
    }),

    /**
     * Replace the entire todo list in one operation (avoids external mutation of L0).
     * @param {any[]} todos
     * @returns {any[]}
     */
    replaceTodos: defineMethod(function (todos) {
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
    }),
  };
}
