/**
 * UnifiedAgentContext - 统一状态管理门面
 *
 * 渐进式重构：阶段 1 - 门面模式
 * 内部委托给现有三个类，对外提供统一接口
 *
 * 目标：
 * - 单源真理 (SSOT)
 * - 自动同步
 * - 统一 Checkpoint
 */

import { isPlainObject, toNonEmptyString, deepClone } from "../../shared/utils/value-utils.js";

export class UnifiedAgentContext {
  constructor(options = {}) {
    this.runId = toNonEmptyString(options.runId) || `ctx_${Date.now()}`;
    this.eventBus = options.eventBus || null;

    // 委托层：持有底层组件引用
    this._state = options.state || null;           // DeepSearchState
    this._memory = options.memory || null;         // MemoryStore
    this._sharedContext = options.sharedContext || null; // SharedContext

    // 同步标志
    this._syncEnabled = true;
  }

  /**
   * 绑定底层组件（延迟绑定）
   */
  bind({ state, memory, sharedContext }) {
    if (state) this._state = state;
    if (memory) this._memory = memory;
    if (sharedContext) this._sharedContext = sharedContext;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Task Goal (统一入口)
  // ─────────────────────────────────────────────────────────────────────────────

  get taskGoal() {
    return this._state?.taskGoal || this._memory?.L0?.taskGoal || "";
  }

  setTaskGoal(goal) {
    const normalized = toNonEmptyString(goal) || "";
    if (this._state) this._state.taskGoal = normalized;
    if (this._memory) this._memory.setTaskGoal(normalized);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Todos (统一入口)
  // ─────────────────────────────────────────────────────────────────────────────

  get todos() {
    return this._state?.todos || this._memory?.L0?.todos || [];
  }

  addTodo(todo) {
    if (this._state?.addTodo) this._state.addTodo(todo);
    if (this._memory?.addTodo) this._memory.addTodo(todo);
  }

  updateTodo(id, updates) {
    if (this._state?.updateTodo) this._state.updateTodo(id, updates);
    if (this._memory?.updateTodo) this._memory.updateTodo(id, updates);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Messages (统一入口)
  // ─────────────────────────────────────────────────────────────────────────────

  get messages() {
    return this._memory?.L1?.messages || [];
  }

  addMessage(msg) {
    if (this._memory?.addMessage) this._memory.addMessage(msg);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Claims / Findings (统一入口)
  // ─────────────────────────────────────────────────────────────────────────────

  get claims() {
    return this._state?.L1?.claims || this._memory?.L2?.claims || [];
  }

  addClaim(claim) {
    if (this._state?.addClaim) this._state.addClaim(claim);
    if (this._sharedContext?.addFinding) {
      this._sharedContext.addFinding({
        type: "claim",
        content: claim.text || claim.content || "",
        source: claim.source,
        confidence: claim.confidence,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Signals (跨阶段通信)
  // ─────────────────────────────────────────────────────────────────────────────

  signal(type, payload) {
    if (this._sharedContext?.signal) {
      this._sharedContext.signal(type, payload);
    }
  }

  getSignals(filter) {
    if (this._sharedContext?.getSignals) {
      return this._sharedContext.getSignals(filter);
    }
    return [];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Decisions (决策记录)
  // ─────────────────────────────────────────────────────────────────────────────

  recordDecision(decision) {
    if (this._memory?.recordDecision) this._memory.recordDecision(decision);
    if (this._sharedContext?.recordDecision) this._sharedContext.recordDecision(decision);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Report (统一入口)
  // ─────────────────────────────────────────────────────────────────────────────

  get report() {
    return this._state?.L1?.report || null;
  }

  setReport(report) {
    if (this._state) {
      if (!this._state.L1) this._state.L1 = {};
      this._state.L1.report = report;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Iteration (统一入口)
  // ─────────────────────────────────────────────────────────────────────────────

  get iteration() {
    return this._state?.iteration || 0;
  }

  set iteration(value) {
    if (this._state) this._state.iteration = value;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Checkpoint (统一入口)
  // ─────────────────────────────────────────────────────────────────────────────

  async saveCheckpoint(options = {}) {
    const checkpoint = {
      runId: this.runId,
      timestamp: new Date().toISOString(),
      state: this._state?.toSnapshot?.() || this._state,
      memory: this._memory ? {
        L0: deepClone(this._memory.L0),
        L1: {
          messages: [...this._memory.L1.messages],
          decisions: [...this._memory.L1.decisions],
        },
        L2: {
          historySummary: this._memory.L2.historySummary,
          claims: [...this._memory.L2.claims],
        },
      } : null,
      sharedContext: this._sharedContext?.serialize?.() || null,
    };

    if (this._memory?.archiveAdapter?.save) {
      await this._memory.archiveAdapter.save(checkpoint.runId, checkpoint);
    }

    return checkpoint;
  }

  async restoreCheckpoint(checkpoint) {
    if (!checkpoint) return false;

    if (checkpoint.state && this._state?.fromSnapshot) {
      this._state.fromSnapshot(checkpoint.state);
    }

    if (checkpoint.memory && this._memory) {
      Object.assign(this._memory.L0, checkpoint.memory.L0 || {});
      this._memory.L1.messages = checkpoint.memory.L1?.messages || [];
      this._memory.L1.decisions = checkpoint.memory.L1?.decisions || [];
      this._memory.L2.historySummary = checkpoint.memory.L2?.historySummary || "";
      this._memory.L2.claims = checkpoint.memory.L2?.claims || [];
    }

    if (checkpoint.sharedContext && this._sharedContext?.deserialize) {
      this._sharedContext.deserialize(checkpoint.sharedContext);
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Context Status (统一入口)
  // ─────────────────────────────────────────────────────────────────────────────

  getContextStatus() {
    const memoryStatus = this._memory?.getContextStatus?.() || {};
    return {
      runId: this.runId,
      iteration: this.iteration,
      todoCount: this.todos.length,
      claimCount: this.claims.length,
      messageCount: this.messages.length,
      ...memoryStatus,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  serialize() {
    return {
      runId: this.runId,
      taskGoal: this.taskGoal,
      iteration: this.iteration,
      todos: this.todos,
      claims: this.claims,
      report: this.report,
    };
  }
}

export default UnifiedAgentContext;
