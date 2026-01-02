/**
 * UnifiedAgentContext - 统一状态管理门面
 *
 * P1.2: 纯只读门面模式
 * - getter 不产生任何 Write 副作用
 * - 所有变更通过显式 set/add 方法
 * - 支持可选的 StateEngine 作为 SSOT
 *
 * 目标：
 * - 单源真理 (SSOT)
 * - 纯只读 getter
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
   * @returns {{success: boolean, errors: string[]}} 绑定结果
   */
  bind({ state, memory, sharedContext }) {
    const errors = [];

    if (state) this._state = state;
    if (memory) this._memory = memory;
    if (sharedContext) this._sharedContext = sharedContext;

    // Best-effort SSOT wiring: keep DeepSearchState.todos pointing at MemoryStore.L0.todos when possible.
    if (this._state?.bindMemoryStore && this._memory) {
      try {
        this._state.bindMemoryStore(this._memory);
      } catch (err) {
        const msg = `UnifiedAgentContext.bind: state.bindMemoryStore failed: ${err?.message || err}`;
        errors.push(msg);
        console.warn(msg);
      }
    }

    // Keep MemoryStore aware of SharedContext where available.
    if (this._memory?.bind && this._sharedContext) {
      try {
        this._memory.bind({ sharedContext: this._sharedContext });
      } catch (err) {
        const msg = `UnifiedAgentContext.bind: memory.bind failed: ${err?.message || err}`;
        errors.push(msg);
        console.warn(msg);
      }
    }

    return { success: errors.length === 0, errors };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Task Goal (统一入口)
  // P1.2: 纯只读 getter，优先从 MemoryStore 读取
  // ─────────────────────────────────────────────────────────────────────────────

  get taskGoal() {
    // 优先级: MemoryStore > DeepSearchState
    const mem = toNonEmptyString(this._memory?.L0?.taskGoal);
    if (mem) return mem;

    const st = toNonEmptyString(this._state?.taskGoal);
    return st || "";
  }

  setTaskGoal(goal) {
    const normalized = toNonEmptyString(goal) || "";
    if (this._state) this._state.taskGoal = normalized;
    if (this._memory) this._memory.setTaskGoal(normalized);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Todos (统一入口)
  // P1.2: 纯只读 getter，优先从 MemoryStore 读取
  // ─────────────────────────────────────────────────────────────────────────────

  get todos() {
    // 优先级: MemoryStore > DeepSearchState
    const mem = Array.isArray(this._memory?.L0?.todos) ? this._memory.L0.todos : null;
    if (mem) return mem;

    const st = Array.isArray(this._state?.todos) ? this._state.todos : null;
    return st || [];
  }

  addTodo(todo) {
    // Prefer state.addTodo() to preserve DeepSearch business rules (sync-to-shared, IDs, etc).
    if (this._state?.addTodo) return this._state.addTodo(todo);
    if (this._memory?.addTodo) return this._memory.addTodo(todo);
    return null;
  }

  updateTodo(id, updates) {
    const sharedTodos =
      this._state &&
      this._memory &&
      Array.isArray(this._state.todos) &&
      Array.isArray(this._memory?.L0?.todos) &&
      this._state.todos === this._memory.L0.todos;

    let out = null;
    if (this._state?.updateTodo) out = this._state.updateTodo(id, updates);
    if (this._memory?.updateTodo && (!this._state?.updateTodo || !sharedTodos)) out = this._memory.updateTodo(id, updates);
    return out;
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
    return this._memory?.L2?.claims || this._state?.L1?.claims || [];
  }

  addClaim(claim) {
    if (this._state?.addClaim) this._state.addClaim(claim);
    if (this._memory?.addClaim) {
      try {
        this._memory.addClaim({
          content: claim?.text || claim?.content || "",
          source: claim?.source,
          confidence: claim?.confidence,
          verified: claim?.verified,
        });
      } catch (err) {
        console.warn(`UnifiedAgentContext.addClaim: memory.addClaim failed: ${err?.message || err}`);
      }
    }
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
  // Scratchpad (Memory 2.0)
  // ─────────────────────────────────────────────────────────────────────────────

  get scratchpad() {
    return this._memory?.getScratchpad?.() || {};
  }

  setScratchpad(key, value) {
    if (this._memory?.setScratchpad) this._memory.setScratchpad(key, value);
  }

  clearScratchpad() {
    if (this._memory?.clearScratchpad) this._memory.clearScratchpad();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Feedback Flags (Memory 2.0)
  // ─────────────────────────────────────────────────────────────────────────────

  get feedbackFlags() {
    return this._memory?.getFlags?.() || { awaitUserFeedback: false, taskImpossible: false };
  }

  setFeedbackFlag(name, value) {
    if (this._memory?.setFlag) this._memory.setFlag(name, value);
  }

  get awaitUserFeedback() {
    return this._memory?.awaitUserFeedback || false;
  }

  set awaitUserFeedback(value) {
    if (this._memory) this._memory.awaitUserFeedback = value;
  }

  get taskImpossible() {
    return this._memory?.taskImpossible || false;
  }

  set taskImpossible(value) {
    if (this._memory) this._memory.taskImpossible = value;
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
    const checkpointTimestamp = new Date().toISOString();
    const stateStrategy = options?.stateStrategy ?? options?.strategy;

    let stateSnapshot = null;
    if (this._state) {
      // Prefer lightweight checkpoint snapshots (avoid full deepClone/toSnapshot on UI thread).
      if (typeof this._state.saveCheckpoint === "function") {
        try {
          const cp = this._state.saveCheckpoint({
            timestamp: checkpointTimestamp,
            ...(stateStrategy !== undefined ? { strategy: stateStrategy } : {}),
            // DeepSearchState supports this; other implementations will ignore.
            record: false,
          });
          if (cp && typeof cp === "object" && "stateSnapshot" in cp) {
            stateSnapshot = cp.stateSnapshot;
          } else {
            stateSnapshot = cp;
          }
        } catch (err) {
          console.warn(`UnifiedAgentContext.saveCheckpoint: state.saveCheckpoint failed: ${err?.message || err}`);
          stateSnapshot = null;
        }
      }

      if (stateSnapshot === null && typeof this._state.toSnapshot === "function") {
        try {
          // Best-effort: at least avoid nested checkpoint snapshots.
          stateSnapshot = this._state.toSnapshot({ includeCheckpoints: false });
        } catch (err) {
          console.warn(`UnifiedAgentContext.saveCheckpoint: state.toSnapshot failed: ${err?.message || err}`);
          stateSnapshot = null;
        }
      }

      if (stateSnapshot === null) {
        stateSnapshot = this._state;
      }
    }

    const checkpoint = {
      runId: this.runId,
      timestamp: checkpointTimestamp,
      state: stateSnapshot,
      memory: this._memory?.toSnapshot ? this._memory.toSnapshot({ includeL3: Boolean(options?.includeMemoryL3) }) : this._memory ? {
        // Backward compatibility: old MemoryStore versions without toSnapshot()
        L0: deepClone(this._memory.L0),
        L1: {
          messages: [...this._memory.L1.messages],
          decisions: [...this._memory.L1.decisions],
          signals: [...this._memory.L1.signals],
          syncTable: {
            discoveries: Array.from(this._memory.L1.syncTable.discoveries.entries()),
            subagents: Array.from(this._memory.L1.syncTable.subagents.entries()),
          },
          scratchpad: deepClone(this._memory.L1.scratchpad || {}),
          flags: { ...this._memory.L1.flags },
        },
        L2: {
          historySummary: this._memory.L2.historySummary,
          claims: [...this._memory.L2.claims],
          stageSummaries: Array.from(this._memory.L2.stageSummaries.entries()),
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
      if (typeof this._memory.fromSnapshot === "function") {
        this._memory.fromSnapshot(checkpoint.memory);
      }
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
