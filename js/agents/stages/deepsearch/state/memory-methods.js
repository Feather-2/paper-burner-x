import { createLogger, isPlainObject } from "../../../shared/index.js";

const logger = createLogger("stages/deepsearch/state/memory-methods");

const BLOCKED_SCRATCHPAD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function copyScratchpadEntries(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (BLOCKED_SCRATCHPAD_KEYS.has(key)) continue;
    target[key] = value;
  }
}

function logDebug(message, err) {
  logger.debug(message, { error: err?.message || err });
}

/**
 * @typedef {object} SharedContextLike
 * @property {(signal: Record<string, any>) => void} [upsertSignal]
 */

/**
 * @typedef {object} MemoryStoreLike
 * @property {(id: string, record: Record<string, any>) => void} [syncDiscovery]
 * @property {(key?: string) => any} [getScratchpad]
 * @property {(key: string|Record<string, any>, value?: any) => void} [setScratchpad]
 * @property {(goal: string) => void} [setTaskGoal]
 * @property {() => any[]|null} [getTodos]
 * @property {(todos: any[]) => void} [replaceTodos]
 * @property {any=} L0
 * @property {boolean=} awaitUserFeedback
 * @property {boolean=} taskImpossible
 */

/**
 * @typedef {object} MemoryMethodsThis
 * @property {MemoryStoreLike|null} [_memoryStore]
 * @property {SharedContextLike|null} [sharedContext]
 * @property {number|null} [subAgentIndex]
 * @property {string=} taskGoal
 * @property {any=} L2
 * @property {any[]=} todos
 * @property {any=} _stateEngine
 * @property {() => void=} _syncFromStateEngine
 */

export const memoryMethods = {
  /**
   * Best-effort sync a discovery signal to MemoryStore + shared context.
   *
   * @this {MemoryMethodsThis}
   * @param {string} type
   * @param {string} id
   * @param {Record<string, any>} summary
   * @returns {void}
   */
  _syncToShared(type, id, summary) {
    if (this._memoryStore?.syncDiscovery) {
      this._memoryStore.syncDiscovery(id, { type, ...summary, by: this.subAgentIndex });
    }
    if (!this.sharedContext || typeof this.sharedContext.upsertSignal !== "function") return;
    this.sharedContext.upsertSignal({ type, id, ...summary, by: this.subAgentIndex, ts: Date.now() });
  },

  /**
   * Read a scratchpad value.
   *
   * When `key` is omitted, returns a shallow copy of the full scratchpad object.
   *
   * @this {MemoryMethodsThis}
   * @param {string=} key
   * @returns {any}
   */
  getScratchpad(key) {
    if (this._memoryStore?.getScratchpad) return this._memoryStore.getScratchpad(key);
    if (key === undefined) return { ...(this.L2?.scratchpad || {}) };
    return this.L2?.scratchpad?.[key];
  },

  /**
   * Set one or more scratchpad values.
   *
   * @this {MemoryMethodsThis}
   * @param {string|Record<string, any>} key
   * @param {any=} value
   * @returns {void}
   */
  setScratchpad(key, value) {
    if (!isPlainObject(this.L2)) this.L2 = {};
    if (!isPlainObject(this.L2.scratchpad)) this.L2.scratchpad = Object.create(null);
    if (isPlainObject(key) && value === undefined) {
      const safePatch = Object.create(null);
      copyScratchpadEntries(safePatch, key);
      if (this._memoryStore?.setScratchpad) this._memoryStore.setScratchpad(safePatch);
      copyScratchpadEntries(this.L2.scratchpad, safePatch);
      return;
    }
    const keyName = typeof key === "string" ? key : key != null ? String(key) : "";
    if (!keyName || BLOCKED_SCRATCHPAD_KEYS.has(keyName)) return;
    if (this._memoryStore?.setScratchpad) this._memoryStore.setScratchpad(keyName, value);
    this.L2.scratchpad[keyName] = value;
  },

  /**
   * Attach or detach a memory store and attempt a best-effort initial sync.
   *
   * @this {MemoryMethodsThis}
   * @param {MemoryStoreLike|null} memoryStore
   * @returns {void}
   */
  bindMemoryStore(memoryStore) {
    this._memoryStore = memoryStore || null;
    if (!memoryStore) return;

    // When StateEngine is present, treat it as SSOT for L0 and just keep MemoryStore synced.
    if (this._stateEngine && typeof this._syncFromStateEngine === "function") {
      try {
        this._syncFromStateEngine();
      } catch (err) {
        logDebug("bindMemoryStore: sync from state engine failed", err);
      }
      if (isPlainObject(this.L2?.scratchpad) && typeof memoryStore.setScratchpad === "function") {
        try {
          memoryStore.setScratchpad(this.L2.scratchpad);
        } catch (err) {
          logDebug("bindMemoryStore: setScratchpad from L2 failed", err);
        }
      }
      return;
    }

    try {
      if (typeof memoryStore.setTaskGoal === "function") memoryStore.setTaskGoal(this.taskGoal || "");
      else if (memoryStore.L0 && typeof memoryStore.L0 === "object") memoryStore.L0.taskGoal = this.taskGoal || "";
    } catch (err) {
      logDebug("bindMemoryStore: setTaskGoal failed", err);
    }

    const stateTodos = Array.isArray(this.todos) ? this.todos : [];
    const memTodos = (() => {
      if (typeof memoryStore.getTodos === "function") {
        try {
          return memoryStore.getTodos();
        } catch (err) {
          logDebug("bindMemoryStore: getTodos failed", err);
          return null;
        }
      }
      return Array.isArray(memoryStore?.L0?.todos) ? memoryStore.L0.todos : null;
    })();

    const normalizeTodoInPlace = (todo) => {
      if (!todo || typeof todo !== "object") return;
      if (todo.todoId && !todo.id) todo.id = todo.todoId;
      if (todo.id && !todo.todoId) todo.todoId = todo.id;
      if (todo.text && !todo.content) todo.content = todo.text;
      if (todo.content && !todo.text) todo.text = todo.content;
    };

    let canonicalTodos = stateTodos;
    if (canonicalTodos.length === 0 && memTodos && memTodos.length) canonicalTodos = memTodos;

    const l0CanShareByRef = (() => {
      try {
        if (!memoryStore?.L0 || typeof memoryStore.L0 !== "object") return false;
        if (Object.isFrozen(memoryStore.L0)) return false;
        if (!Array.isArray(memoryStore.L0.todos) || Object.isFrozen(memoryStore.L0.todos)) return false;
        return true;
      } catch (err) {
        logDebug("bindMemoryStore: probe L0 shareability failed", err);
        return false;
      }
    })();

    if (typeof memoryStore.replaceTodos === "function") {
      try {
        memoryStore.replaceTodos(canonicalTodos);
      } catch (err) {
        logDebug("bindMemoryStore: replaceTodos failed", err);
      }
    } else if (l0CanShareByRef) {
      try {
        if (!Array.isArray(memoryStore.L0.todos) || memoryStore.L0.todos !== canonicalTodos) memoryStore.L0.todos = canonicalTodos;
      } catch (err) {
        logDebug("bindMemoryStore: assigning L0.todos failed", err);
      }
    }

    const localTodos = canonicalTodos;

    // Best-effort reference sharing for mutable L0 stores (mock objects, legacy adapters).
    if (l0CanShareByRef) {
      try {
        Object.defineProperty(this, "todos", {
          configurable: true,
          enumerable: true,
          get: () => (Array.isArray(this._memoryStore?.L0?.todos) ? this._memoryStore.L0.todos : localTodos),
          set: (value) => {
            const next = Array.isArray(value) ? value : [];
            if (this._memoryStore?.L0 && typeof this._memoryStore.L0 === "object" && !Object.isFrozen(this._memoryStore.L0)) {
              this._memoryStore.L0.todos = next;
            }
            if (localTodos !== next) {
              localTodos.length = 0;
              localTodos.push(...next);
            }
          },
        });
      } catch (err) {
        logDebug("bindMemoryStore: defineProperty for todos failed", err);
        this.todos = Array.isArray(memTodos) ? memTodos : canonicalTodos;
      }
    } else {
      // API-driven stores (like MemoryStore) cannot share references; keep state local.
      if (canonicalTodos !== stateTodos) this.todos = canonicalTodos;
    }

    for (const todo of Array.isArray(this.todos) ? this.todos : []) normalizeTodoInPlace(todo);

    if (this.L2?.awaitUserFeedback) memoryStore.awaitUserFeedback = true;
    if (this.L2?.taskImpossible) memoryStore.taskImpossible = true;
    if (isPlainObject(this.L2?.scratchpad) && typeof memoryStore.setScratchpad === "function") memoryStore.setScratchpad(this.L2.scratchpad);
  },
};
