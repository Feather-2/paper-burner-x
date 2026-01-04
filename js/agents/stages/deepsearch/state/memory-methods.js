import { isPlainObject } from "../../../shared/utils/value-utils.js";

export const memoryMethods = {
  _syncToShared(type, id, summary) {
    if (this._memoryStore?.syncDiscovery) {
      this._memoryStore.syncDiscovery(id, { type, ...summary, by: this.subAgentIndex });
    }
    if (!this.sharedContext || typeof this.sharedContext.upsertSignal !== "function") return;
    this.sharedContext.upsertSignal({ type, id, ...summary, by: this.subAgentIndex, ts: Date.now() });
  },

  getScratchpad(key) {
    if (this._memoryStore?.getScratchpad) return this._memoryStore.getScratchpad(key);
    if (key === undefined) return { ...(this.L2?.scratchpad || {}) };
    return this.L2?.scratchpad?.[key];
  },

  setScratchpad(key, value) {
    if (this._memoryStore?.setScratchpad) this._memoryStore.setScratchpad(key, value);
    if (!isPlainObject(this.L2)) this.L2 = { scratchpad: {} };
    if (!isPlainObject(this.L2.scratchpad)) this.L2.scratchpad = {};
    if (isPlainObject(key) && value === undefined) Object.assign(this.L2.scratchpad, key);
    else this.L2.scratchpad[key] = value;
  },

  bindMemoryStore(memoryStore) {
    this._memoryStore = memoryStore || null;
    if (!memoryStore) return;

    try {
      if (typeof memoryStore.setTaskGoal === "function") memoryStore.setTaskGoal(this.taskGoal || "");
      else if (memoryStore.L0 && typeof memoryStore.L0 === "object") memoryStore.L0.taskGoal = this.taskGoal || "";
    } catch { /* intentional: memoryStore API may vary */ }

    const stateTodos = Array.isArray(this.todos) ? this.todos : [];
    const memTodos = Array.isArray(memoryStore?.L0?.todos) ? memoryStore.L0.todos : null;

    const normalizeTodoInPlace = (todo) => {
      if (!todo || typeof todo !== "object") return;
      if (todo.todoId && !todo.id) todo.id = todo.todoId;
      if (todo.id && !todo.todoId) todo.todoId = todo.id;
      if (todo.text && !todo.content) todo.content = todo.text;
      if (todo.content && !todo.text) todo.text = todo.content;
    };

    let canonicalTodos = stateTodos;
    if (canonicalTodos.length === 0 && memTodos && memTodos.length) canonicalTodos = memTodos;

    if (memoryStore?.L0 && typeof memoryStore.L0 === "object") {
      if (!Array.isArray(memoryStore.L0.todos) || memoryStore.L0.todos !== canonicalTodos) memoryStore.L0.todos = canonicalTodos;
    }

    const localTodos = canonicalTodos;
    try {
      Object.defineProperty(this, "todos", {
        configurable: true,
        enumerable: true,
        get: () => (Array.isArray(this._memoryStore?.L0?.todos) ? this._memoryStore.L0.todos : localTodos),
        set: (value) => {
          const next = Array.isArray(value) ? value : [];
          if (this._memoryStore?.L0 && typeof this._memoryStore.L0 === "object") this._memoryStore.L0.todos = next;
          if (localTodos !== next) {
            localTodos.length = 0;
            localTodos.push(...next);
          }
        },
      });
    } catch {
      this.todos = Array.isArray(memoryStore?.L0?.todos) ? memoryStore.L0.todos : canonicalTodos;
    }

    for (const todo of Array.isArray(this.todos) ? this.todos : []) normalizeTodoInPlace(todo);

    if (this.L2?.awaitUserFeedback) memoryStore.awaitUserFeedback = true;
    if (this.L2?.taskImpossible) memoryStore.taskImpossible = true;
    if (isPlainObject(this.L2?.scratchpad) && typeof memoryStore.setScratchpad === "function") memoryStore.setScratchpad(this.L2.scratchpad);
  },
};
