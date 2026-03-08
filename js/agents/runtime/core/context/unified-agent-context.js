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

import { makeSecureTimestampedId, toNonEmptyString } from "../../../shared/index.js";
import { deepClone } from "../../../shared/utils/value-utils.js";
import { createLogger } from "../../../shared/index.js";

const logger = createLogger("runtime/context/unified-agent-context");

/**
 * 轻量 async mutex，串行化 SharedContext 写操作，
 * 防止并行 Stage 的 async 读-改-写交织导致数据丢失。
 */
class AsyncMutex {
  constructor() {
    /** @type {Promise<void>} */
    this._lock = Promise.resolve();
  }
  /**
   * @returns {Promise<() => void>} release 函数
   */
  async acquire() {
    /** @type {() => void} */
    let release;
    const next = new Promise((resolve) => { release = /** @type {() => void} */ (resolve); });
    const prev = this._lock;
    this._lock = next;
    await prev;
    return /** @type {() => void} */ (release);
  }
}

export class UnifiedAgentContext {
  constructor(options = {}) {
    const providedRunId = toNonEmptyString(options.runId);
    if (providedRunId) {
      this.runId = providedRunId;
    } else {
      const runIdFactory = typeof options.runIdFactory === "function" ? options.runIdFactory : null;
      if (runIdFactory) {
        try {
          const custom = toNonEmptyString(runIdFactory({ prefix: "ctx", timestamp: Date.now() }));
          if (custom) {
            this.runId = custom;
          } else {
            this.runId = makeSecureTimestampedId("ctx", { allowInsecureFallback: true });
          }
        } catch {
          this.runId = makeSecureTimestampedId("ctx", { allowInsecureFallback: true });
        }
      } else {
        this.runId = makeSecureTimestampedId("ctx", { allowInsecureFallback: true });
      }
    }
    this.eventBus = options.eventBus || null;

    // 委托层：持有底层组件引用
    this._state = options.state || null;           // DeepSearchState
    this._memory = options.memory || null;         // MemoryStore
    this._sharedContext = options.sharedContext || null; // SharedContext

    // 同步标志
    this._syncEnabled = true;

    // 写操作互斥锁，串行化 SharedContext 并发写入 (AUDIT A1)
    this._writeMutex = new AsyncMutex();
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
        logger.warn(msg);
      }
    }

    // Keep MemoryStore aware of SharedContext where available.
    if (this._memory?.bind && this._sharedContext) {
      try {
        this._memory.bind({ sharedContext: this._sharedContext });
      } catch (err) {
        const msg = `UnifiedAgentContext.bind: memory.bind failed: ${err?.message || err}`;
        errors.push(msg);
        logger.warn(msg);
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

  /**
   * 设置任务目标
   * @param {string} goal - 任务目标描述
   * @returns {void}
   */
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

  /**
   * 添加待办事项
   * @param {object} todo - 待办事项对象
   * @returns {object|null} 添加结果或 null
   */
  addTodo(todo) {
    // Prefer state.addTodo() to preserve DeepSearch business rules (sync-to-shared, IDs, etc).
    if (this._state?.addTodo) return this._state.addTodo(todo);
    if (this._memory?.addTodo) return this._memory.addTodo(todo);
    return null;
  }

  /**
   * 更新待办事项
   * @param {string} id - 待办事项 ID
   * @param {object} updates - 更新内容
   * @returns {object|null} 更新结果或 null
   */
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

  /**
   * 添加消息
   * @param {object} msg - 消息对象
   * @returns {void}
   */
  addMessage(msg) {
    if (this._memory?.addMessage) this._memory.addMessage(msg);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Claims / Findings (统一入口)
  // ─────────────────────────────────────────────────────────────────────────────

  get claims() {
    return this._memory?.L2?.claims || this._state?.L1?.claims || [];
  }

  /**
   * 添加 claim/发现
   * @param {object} claim - claim 对象，包含 text/content/source/confidence/verified
   * @returns {Promise<void>}
   */
  async addClaim(claim) {
    // 校验 claim 为有效对象
    if (!claim || typeof claim !== "object") {
      logger.warn("UnifiedAgentContext.addClaim: invalid claim (null or non-object)");
      return;
    }
    const release = await this._writeMutex.acquire();
    try {
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
          logger.warn(`UnifiedAgentContext.addClaim: memory.addClaim failed: ${err?.message || err}`);
        }
      }
      if (this._sharedContext?.addFinding) {
        try {
          this._sharedContext.addFinding({
            type: "claim",
            content: claim?.text || claim?.content || "",
            source: claim?.source,
            confidence: claim?.confidence,
          });
        } catch (err) {
          logger.warn(`UnifiedAgentContext.addClaim: sharedContext.addFinding failed: ${err?.message || err}`);
        }
      }
    } finally {
      release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Signals (跨阶段通信)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 发送跨阶段信号
   * @param {string} type - 信号类型
   * @param {unknown} payload - 信号载荷
   * @returns {Promise<void>}
   */
  async signal(type, payload) {
    // D3: validate payload is serializable (prevent circular refs crashing checkpoint)
    let safePayload = payload;
    if (payload !== null && typeof payload === "object") {
      // Detect circular references before attempting serialization
      if (this._hasCircularRef(payload)) {
        logger.warn("UnifiedAgentContext.signal: payload has circular reference, truncating");
        safePayload = { _error: "circular_reference_detected", _truncated: true };
      } else {
        try {
          JSON.stringify(payload);
        } catch (err) {
          logger.warn(`UnifiedAgentContext.signal: payload serialization failed: ${err?.message || err}`);
          safePayload = { _error: "serialization_failed", _truncated: true };
        }
      }
    }
    const release = await this._writeMutex.acquire();
    try {
      if (this._sharedContext?.signal) {
        this._sharedContext.signal(type, safePayload);
      }
    } finally {
      release();
    }
  }

  /**
   * 检测对象是否包含循环引用
   * @param {unknown} obj - 待检测对象
   * @param {WeakSet<object>} [seen] - 已访问对象集合
   * @returns {boolean} 是否包含循环引用
   * @private
   */
  _hasCircularRef(obj, seen = new WeakSet()) {
    if (obj === null || typeof obj !== "object") return false;
    if (seen.has(obj)) return true;
    seen.add(obj);

    try {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (this._hasCircularRef(obj[key], seen)) return true;
        }
      }
    } catch {
      // Getter 抛出异常时视为安全
      return false;
    }
    return false;
  }

  /**
   * 获取信号列表
   * @param {object} [filter] - 过滤条件
   * @returns {Array<object>} 信号列表
   */
  getSignals(filter) {
    if (this._sharedContext?.getSignals) {
      return this._sharedContext.getSignals(filter);
    }
    return [];
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Decisions (决策记录)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 记录决策
   * @param {object} decision - 决策对象
   * @returns {Promise<void>}
   */
  async recordDecision(decision) {
    const release = await this._writeMutex.acquire();
    try {
      if (this._memory?.recordDecision) this._memory.recordDecision(decision);
      if (this._sharedContext?.recordDecision) this._sharedContext.recordDecision(decision);
    } finally {
      release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Scratchpad (Memory 2.0)
  // ─────────────────────────────────────────────────────────────────────────────

  get scratchpad() {
    return this._memory?.getScratchpad?.() || {};
  }

  /**
   * 设置 scratchpad 键值
   * @param {string} key - 键名
   * @param {unknown} value - 值
   * @returns {void}
   */
  setScratchpad(key, value) {
    if (this._memory?.setScratchpad) this._memory.setScratchpad(key, value);
  }

  /**
   * 清空 scratchpad
   * @returns {void}
   */
  clearScratchpad() {
    if (this._memory?.clearScratchpad) this._memory.clearScratchpad();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Feedback Flags (Memory 2.0)
  // ─────────────────────────────────────────────────────────────────────────────

  get feedbackFlags() {
    return this._memory?.getFlags?.() || { awaitUserFeedback: false, taskImpossible: false };
  }

  /**
   * 设置反馈标志
   * @param {string} name - 标志名称
   * @param {boolean} value - 标志值
   * @returns {void}
   */
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

  /**
   * 设置报告
   * @param {object} report - 报告对象
   * @returns {void}
   */
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

  /**
   * 保存检查点
   * @param {object} [options] - 选项
   * @param {boolean} [options.includeMemoryL3] - 是否包含 L3 记忆
   * @param {boolean} [options.incremental] - 是否使用增量快照
   * @param {string} [options.stateStrategy] - 状态策略
   * @param {string} [options.strategy] - 状态策略（兼容旧字段）
   * @returns {Promise<object>} 检查点对象
   */
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
          logger.warn(`UnifiedAgentContext.saveCheckpoint: state.saveCheckpoint failed: ${err?.message || err}`);
          stateSnapshot = null;
        }
      }

      if (stateSnapshot === null && typeof this._state.toSnapshot === "function") {
        try {
          // Best-effort: at least avoid nested checkpoint snapshots.
          stateSnapshot = this._state.toSnapshot({ includeCheckpoints: false });
        } catch (err) {
          logger.warn(`UnifiedAgentContext.saveCheckpoint: state.toSnapshot failed: ${err?.message || err}`);
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
      // P2.3: 支持增量快照，减少 checkpoint 开销
      memory: this._memory?.toSnapshot ? this._memory.toSnapshot({
        includeL3: Boolean(options?.includeMemoryL3),
        incremental: Boolean(options?.incremental),
      }) : this._memory ? {
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

  /**
   * 恢复检查点
   * @param {object} checkpoint - 检查点对象
   * @returns {Promise<boolean>} 恢复是否成功
   */
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

  /**
   * 获取上下文状态信息
   * @returns {object} 状态摘要
   */
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

  /**
   * 序列化上下文为普通对象
   * @returns {object} 序列化结果
   */
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
