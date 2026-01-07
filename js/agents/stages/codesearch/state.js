/**
 * CodeSearchState - CodeSearch Agent 状态管理
 *
 * 参考 DeepSearchState 设计，支持：
 * - 可选 StateEngine 集成
 * - MemoryStore 绑定
 * - 序列化/反序列化
 */

import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
import { L0_SET_TASK_GOAL, L0_REPLACE_TODOS, L0_ADD_TODO, L0_UPDATE_TODO } from "../../runtime/memory/action-types.js";
import { CodeSearchPhase, TodoStatus } from "./states.js";

const STATE_SCHEMA_VERSION = "0.1";

/**
 * @typedef {object} CodeSearchTodo
 * @property {string=} todoId
 * @property {string=} id
 * @property {string=} text
 * @property {string=} status
 * @property {any[]=} history
 * @property {string=} relatedGapId
 *
 * @typedef {object} CodeSearchStep
 * @property {number=} step
 * @property {string=} tool
 * @property {any=} args
 * @property {any=} result
 * @property {string=} todoId
 *
 * @typedef {object} CodeSearchBudgetUsage
 * @property {number=} input
 * @property {number=} output
 * @property {number=} total
 * @property {number=} estimatedCostUSD
 *
 * @typedef {object} CodeSearchStateSnapshot
 * @property {string=} schemaVersion
 * @property {string=} runId
 * @property {string=} createdAt
 * @property {string=} query
 * @property {string=} taskGoal
 * @property {CodeSearchTodo[]=} todos
 * @property {string=} phase
 * @property {string[]=} observations
 * @property {CodeSearchStep[]=} steps
 * @property {boolean=} awaitUserFeedback
 * @property {string|null=} pauseReason
 * @property {string|null=} finalThought
 * @property {CodeSearchBudgetUsage|any|null=} budgetUsage
 * @property {any=} memoryStore
 * @property {any=} stateEngine
 */

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export class CodeSearchState {
  /**
   * @param {CodeSearchStateSnapshot} [snapshot]
   */
  constructor({
    runId,
    query,
    taskGoal,
    todos,
    observations,
    steps,
    phase,
    awaitUserFeedback,
    pauseReason,
    finalThought,
    budgetUsage,
    createdAt,
    schemaVersion,
    memoryStore,
    stateEngine,
  } = {}) {
    this.schemaVersion = toNonEmptyString(schemaVersion) || STATE_SCHEMA_VERSION;
    this.runId = toNonEmptyString(runId) || "run_unknown";
    this.createdAt = toNonEmptyString(createdAt) || new Date().toISOString();

    // 核心状态
    this._query = toNonEmptyString(query) || "";
    this._taskGoal = toNonEmptyString(taskGoal) || this._query;
    this._todos = Array.isArray(todos) ? todos : [];
    this._phase = toNonEmptyString(phase) || CodeSearchPhase.PLANNING;

    // L1: 运行时状态
    this._observations = Array.isArray(observations) ? observations : [];
    this._steps = Array.isArray(steps) ? steps : [];

    // 控制状态
    this.awaitUserFeedback = awaitUserFeedback === true;
    this.pauseReason = toNonEmptyString(pauseReason) || null;
    this.finalThought = toNonEmptyString(finalThought) || null;
    this.budgetUsage = isPlainObject(budgetUsage) ? budgetUsage : null;

    // 外部依赖
    this._memoryStore = memoryStore || null;
    this._stateEngine = stateEngine || null;
    this._stateEngineUnsubscribe = null;

    if (stateEngine) this.bindStateEngine(stateEngine);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // L0: 任务层 (query, taskGoal, todos)
  // ─────────────────────────────────────────────────────────────────────────────

  get query() {
    return this._query;
  }

  set query(value) {
    this._query = toNonEmptyString(value) || "";
  }

  get taskGoal() {
    // 优先从 StateEngine 读取
    if (this._stateEngine) {
      try {
        const snap = this._stateEngine.getState?.() || this._stateEngine._getStateRef?.();
        const engineGoal = toNonEmptyString(snap?.L0?.taskGoal);
        if (engineGoal) return engineGoal;
      } catch { /* fallback */ }
    }
    // 次优先从 MemoryStore 读取
    if (this._memoryStore) {
      try {
        const memGoal = toNonEmptyString(this._memoryStore.L0?.taskGoal);
        if (memGoal) return memGoal;
      } catch { /* fallback */ }
    }
    return this._taskGoal;
  }

  set taskGoal(value) {
    const next = toNonEmptyString(value) || "";
    this._taskGoal = next;

    // 同步到 StateEngine
    if (this._stateEngine && typeof this._stateEngine.dispatchSync === "function") {
      try {
        this._stateEngine.dispatchSync({ type: L0_SET_TASK_GOAL, payload: { taskGoal: next } });
      } catch { /* intentional */ }
    }

    // 同步到 MemoryStore
    if (this._memoryStore) {
      try {
        if (typeof this._memoryStore.setTaskGoal === "function") {
          this._memoryStore.setTaskGoal(next);
        } else if (this._memoryStore.L0) {
          this._memoryStore.L0.taskGoal = next;
        }
      } catch { /* intentional */ }
    }
  }

  get todos() {
    return this._todos;
  }

  set todos(value) {
    const next = Array.isArray(value) ? value : [];
    this._todos = next;

    // 同步到 StateEngine
    if (this._stateEngine && typeof this._stateEngine.dispatchSync === "function") {
      try {
        this._stateEngine.dispatchSync({ type: L0_REPLACE_TODOS, payload: { todos: cloneValue(next) } });
      } catch { /* intentional */ }
    }

    // 同步到 MemoryStore
    if (this._memoryStore && typeof this._memoryStore.replaceTodos === "function") {
      try {
        this._memoryStore.replaceTodos(cloneValue(next));
      } catch { /* intentional */ }
    }
  }

  /**
   * @param {CodeSearchTodo} todo
   * @returns {CodeSearchTodo|null}
   */
  addTodo(todo) {
    if (!isPlainObject(todo)) return null;
    this._todos.push(todo);

    if (this._stateEngine && typeof this._stateEngine.dispatchSync === "function") {
      try {
        this._stateEngine.dispatchSync({ type: L0_ADD_TODO, payload: { todo: cloneValue(todo) } });
      } catch { /* intentional */ }
    }

    return todo;
  }

  /**
   * @param {string} todoId
   * @param {Partial<CodeSearchTodo>} updates
   * @returns {CodeSearchTodo|null}
   */
  updateTodo(todoId, updates) {
    const idx = this._todos.findIndex((t) => t.todoId === todoId || t.id === todoId);
    if (idx === -1) return null;

    const oldTodo = this._todos[idx];
    const oldStatus = oldTodo.status || TodoStatus.OPEN;
    const newStatus = updates.status || oldStatus;

    // 初始化 history 数组
    if (!Array.isArray(oldTodo.history)) {
      oldTodo.history = [];
    }

    // 记录状态变更
    if (updates.status && updates.status !== oldStatus) {
      oldTodo.history.push({
        from: oldStatus,
        to: newStatus,
        timestamp: Date.now(),
      });
    }

    const updated = { ...oldTodo, ...updates };
    this._todos[idx] = updated;

    if (this._stateEngine && typeof this._stateEngine.dispatchSync === "function") {
      try {
        this._stateEngine.dispatchSync({ type: L0_UPDATE_TODO, payload: { todoId, updates } });
      } catch { /* intentional */ }
    }

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // L1: 运行时层 (observations, steps, phase)
  // ─────────────────────────────────────────────────────────────────────────────

  get phase() {
    return this._phase;
  }

  set phase(value) {
    this._phase = toNonEmptyString(value) || CodeSearchPhase.PLANNING;
  }

  get observations() {
    return this._observations;
  }

  /**
   * @param {string} text
   * @returns {void}
   */
  addObservation(text) {
    if (!text) return;
    this._observations.push(text);
  }

  get steps() {
    return this._steps;
  }

  /**
   * @param {CodeSearchStep} step
   * @returns {CodeSearchStep|null}
   */
  addStep(step) {
    if (!isPlainObject(step)) return null;
    this._steps.push(step);
    return step;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // StateEngine 绑定
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * @param {any} stateEngine
   * @returns {void}
   */
  bindStateEngine(stateEngine) {
    if (this._stateEngineUnsubscribe) {
      try {
        this._stateEngineUnsubscribe();
      } catch { /* ignore */ }
      this._stateEngineUnsubscribe = null;
    }

    this._stateEngine = stateEngine || null;
    if (!stateEngine) return;

    // 初始同步
    this._syncFromStateEngine();

    // 订阅 L0 变更
    if (typeof stateEngine.subscribe === "function") {
      this._stateEngineUnsubscribe = stateEngine.subscribe("L0", (_action, _prev, nextL0) => {
        this._syncFromStateEngine(nextL0);
      });
    }
  }

  /**
   * @param {any|null} [nextL0]
   * @returns {void}
   */
  _syncFromStateEngine(nextL0 = null) {
    const engine = this._stateEngine;
    if (!engine) return;

    const l0 = nextL0 || (() => {
      try {
        const snap = engine.getState?.() || engine._getStateRef?.();
        return snap?.L0 || null;
      } catch {
        return null;
      }
    })();
    if (!l0) return;

    const goal = toNonEmptyString(l0.taskGoal);
    if (goal) this._taskGoal = goal;

    const todos = Array.isArray(l0.todos) ? l0.todos : [];
    this._todos = cloneValue(todos);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MemoryStore 绑定
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * @param {any} memoryStore
   * @returns {void}
   */
  bindMemoryStore(memoryStore) {
    this._memoryStore = memoryStore || null;
    if (!memoryStore) return;

    // 初始同步
    const goal = this.taskGoal;
    if (goal && typeof memoryStore.setTaskGoal === "function") {
      try {
        memoryStore.setTaskGoal(goal);
      } catch { /* intentional */ }
    }

    if (this._todos.length > 0 && typeof memoryStore.replaceTodos === "function") {
      try {
        memoryStore.replaceTodos(cloneValue(this._todos));
      } catch { /* intentional */ }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 序列化
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * @returns {CodeSearchStateSnapshot}
   */
  buildStateSnapshot() {
    return {
      schemaVersion: this.schemaVersion,
      runId: this.runId,
      createdAt: this.createdAt,
      query: this._query,
      taskGoal: this._taskGoal,
      todos: cloneValue(this._todos),
      phase: this._phase,
      observations: cloneValue(this._observations),
      steps: cloneValue(this._steps),
      awaitUserFeedback: this.awaitUserFeedback,
      pauseReason: this.pauseReason,
      finalThought: this.finalThought,
      budgetUsage: this.budgetUsage ? cloneValue(this.budgetUsage) : null,
    };
  }

  /**
   * @returns {CodeSearchStateSnapshot}
   */
  toJSON() {
    return this.buildStateSnapshot();
  }

  /**
   * @param {CodeSearchStateSnapshot} json
   * @returns {CodeSearchState}
   */
  static fromSnapshot(json) {
    if (!isPlainObject(json)) {
      throw new TypeError("CodeSearchState.fromSnapshot: json must be an object");
    }
    return new CodeSearchState(json);
  }

  /**
   * @param {CodeSearchStateSnapshot} json
   * @returns {CodeSearchState}
   */
  static fromJSON(json) {
    return CodeSearchState.fromSnapshot(json);
  }
}

export default CodeSearchState;
