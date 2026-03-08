/**
 * CostAggregator - 跨 Agent Token 使用汇总
 *
 * 聚合多个 Agent/Stage 的 token 消耗，提供：
 * - recordUsage(agentId, usage): 记录单次 LLM 调用
 * - getAgentCost(agentId): 获取单 Agent 累计
 * - getTotalCost(): 获取全局累计
 * - getBreakdown(): 按 Agent 分组的详细报告
 * - EventBus 集成：监听 llm:complete 自动记录
 *
 * 设计原则：
 * - 纯内存，通过 getSnapshot/restore 支持持久化
 * - 与 TokenTracker 互补（Tracker 记录明细，Aggregator 汇总）
 * - 与 BudgetManager 互补（Budget 控制限额，Aggregator 只读报告）
 */

import { createLogger } from "../../shared/index.js";

const logger = createLogger("runtime/telemetry/cost-aggregator");

/** @param {unknown} v @returns {number} */
function safeInt(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** @param {unknown} v @returns {string | null} */
function str(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export class CostAggregator {
  /**
   * @param {{ eventBus?: { on?: Function, emit?: Function }, archive?: { list: (runId: string) => Promise<Array<{ id: string }>>, load: (checkpointId: string) => Promise<any>, save?: Function }, runId?: string, onPersistenceError?: (payload: { phase: "hydrate" | "persist", error: Error, runId: string }) => void }} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, object>} */
    this._agents = new Map();
    this._eventBus = options?.eventBus ?? null;
    this._unsubscribe = null;
    this.disposed = false;

    // Archive 持久化支持
    this._archive = options?.archive ?? null;
    this._runId = options?.runId ?? `cost_aggregator_${Date.now()}`;
    this._initPromise = null;
    this._onPersistenceError = typeof options?.onPersistenceError === "function" ? options.onPersistenceError : null;
    this._persistPending = Promise.resolve();
    this._persistScheduled = false;
    this._persistDirty = false;
    this._persistLastError = null;
    this._persistFailureCount = 0;
    this._persistSuccessCount = 0;

    if (this._eventBus && typeof this._eventBus.on === 'function') {
      this._unsubscribe = this._eventBus.on('llm:complete', (evt) => {
        try {
          const p = evt?.payload ?? evt;
          const agentId = str(p?.agentId) || str(p?.actor) || 'unknown';
          this.recordUsage(agentId, p);
        } catch { /* best-effort */ }
      });
    }
  }

  /**
   * @private
   * @param {"hydrate"|"persist"} phase
   * @param {unknown} error
   */
  _reportPersistenceError(phase, error) {
    const err = error instanceof Error ? error : new Error(String(error ?? "unknown"));
    logger.warn(`[CostAggregator] ${phase} failed`, { runId: this._runId, error: err.message });
    if (this._onPersistenceError) {
      try {
        this._onPersistenceError({ phase, error: err, runId: this._runId });
      } catch {
        // ignore callback errors
      }
    }
    return err;
  }

  /**
   * 初始化 CostAggregator，从 Archive 恢复数据（如果可用）
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initPromise) return this._initPromise;
    if (!this._archive) return;

    this._initPromise = (async () => {
      try {
        const checkpoints = await this._archive.list(this._runId);
        if (!Array.isArray(checkpoints) || checkpoints.length === 0) return;

        // 获取最新的检查点
        const latest = checkpoints[0];
        if (!latest?.id) return;

        const restored = await this._archive.load(latest.id);
        if (!restored) return;

        // 使用已有的 restore 方法恢复数据
        this.restore(restored);
      } catch (err) {
        this._persistLastError = this._reportPersistenceError("hydrate", err);
      }
    })();

    return this._initPromise;
  }

  /**
   * 持久化当前状态到 Archive（异步，不阻塞）
   * @private
   */
  _persistToArchive() {
    if (!this._archive) return;
    this._persistDirty = true;
    if (this._persistScheduled) return;
    this._persistScheduled = true;

    queueMicrotask(() => {
      this._persistScheduled = false;
      this._persistPending = this._persistPending
        .then(async () => {
          if (!this._archive || !this._persistDirty) return;
          this._persistDirty = false;
          try {
            const snapshot = this.getSnapshot();
            await this._archive.save(this._runId, snapshot);
            this._persistSuccessCount++;
            this._persistLastError = null;
          } catch (err) {
            this._persistFailureCount++;
            this._persistLastError = this._reportPersistenceError("persist", err);
          }
          if (this._persistDirty) {
            this._persistToArchive();
          }
        })
        .catch(() => {
          // keep chain alive
        });
    });
  }

  /**
   * Record a single LLM call's token usage for an agent.
   * @param {string} agentId
   * @param {object} usage
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  recordUsage(agentId, usage) {
    if (this.disposed) return { ok: false, error: 'Aggregator disposed' };
    const id = str(agentId);
    if (!id) return { ok: false, error: 'agentId required' };

    const prompt = safeInt(usage?.promptTokens);
    const completion = safeInt(usage?.completionTokens);
    const total = safeInt(usage?.totalTokens) || (prompt + completion);
    const latency = safeInt(usage?.latencyMs);
    const model = str(usage?.model) || 'unknown';

    let entry = this._agents.get(id);
    if (!entry) {
      entry = {
        agentId: id,
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalLatencyMs: 0,
        byModel: new Map(),
      };
      this._agents.set(id, entry);
    }

    entry.calls++;
    entry.promptTokens += prompt;
    entry.completionTokens += completion;
    entry.totalTokens += total;
    entry.totalLatencyMs += latency;

    let modelEntry = entry.byModel.get(model);
    if (!modelEntry) {
      modelEntry = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      entry.byModel.set(model, modelEntry);
    }
    modelEntry.calls++;
    modelEntry.promptTokens += prompt;
    modelEntry.completionTokens += completion;
    modelEntry.totalTokens += total;

    // 异步持久化到 Archive（不阻塞）
    this._persistToArchive();

    return { ok: true };
  }

  /**
   * Get cost summary for a single agent.
   * @param {string} agentId
   * @returns {object | null}
   */
  getAgentCost(agentId) {
    const entry = this._agents.get(agentId);
    if (!entry) return null;
    return {
      calls: entry.calls,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      totalTokens: entry.totalTokens,
      totalLatencyMs: entry.totalLatencyMs,
    };
  }

  /**
   * Get total cost across all agents.
   * @returns {object}
   */
  getTotalCost() {
    let calls = 0, prompt = 0, completion = 0, total = 0, latency = 0;
    for (const entry of this._agents.values()) {
      calls += entry.calls;
      prompt += entry.promptTokens;
      completion += entry.completionTokens;
      total += entry.totalTokens;
      latency += entry.totalLatencyMs;
    }
    return {
      agents: this._agents.size,
      calls,
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      totalLatencyMs: latency,
    };
  }

  /**
   * Get detailed breakdown by agent.
   * @returns {Array<object>}
   */
  getBreakdown() {
    const result = [];
    for (const entry of this._agents.values()) {
      const models = [];
      for (const [model, m] of entry.byModel) {
        models.push({ model, calls: m.calls, totalTokens: m.totalTokens });
      }
      result.push({
        agentId: entry.agentId,
        calls: entry.calls,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        totalTokens: entry.totalTokens,
        totalLatencyMs: entry.totalLatencyMs,
        models,
      });
    }
    return result.sort((a, b) => b.totalTokens - a.totalTokens);
  }

  /**
   * Get serializable snapshot.
   * @returns {object}
   */
  getSnapshot() {
    const agents = [];
    for (const entry of this._agents.values()) {
      agents.push({
        agentId: entry.agentId,
        calls: entry.calls,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        totalTokens: entry.totalTokens,
        totalLatencyMs: entry.totalLatencyMs,
        byModel: Array.from(entry.byModel.entries()),
      });
    }
    return { agents, ts: Date.now() };
  }

  /**
   * Restore from snapshot.
   * @param {object} snapshot
   * @returns {{ ok: true, count: number } | { ok: false, error: string }}
   */
  restore(snapshot) {
    if (this.disposed) return { ok: false, error: 'Aggregator disposed' };
    if (!snapshot || !Array.isArray(snapshot.agents)) return { ok: false, error: 'Invalid snapshot' };

    this._agents.clear();
    let count = 0;
    for (const a of snapshot.agents) {
      if (!a || !str(a.agentId)) continue;
      const entry = {
        agentId: a.agentId,
        calls: safeInt(a.calls),
        promptTokens: safeInt(a.promptTokens),
        completionTokens: safeInt(a.completionTokens),
        totalTokens: safeInt(a.totalTokens),
        totalLatencyMs: safeInt(a.totalLatencyMs),
        byModel: new Map(Array.isArray(a.byModel) ? a.byModel : []),
      };
      this._agents.set(entry.agentId, entry);
      count++;
    }
    return { ok: true, count };
  }

  getPersistenceStatus() {
    return {
      enabled: Boolean(this._archive),
      runId: this._runId,
      pending: this._persistScheduled || this._persistDirty,
      successCount: this._persistSuccessCount,
      failureCount: this._persistFailureCount,
      lastError: this._persistLastError ? this._persistLastError.message : null,
    };
  }

  /**
   * @param {{ throwOnError?: boolean }} [options]
   */
  async flush({ throwOnError = true } = {}) {
    if (!this._archive) return;
    await this.init();
    if (this._persistScheduled) {
      await Promise.resolve();
    }
    await this._persistPending;
    if (this._persistDirty) {
      this._persistToArchive();
      await Promise.resolve();
      await this._persistPending;
    }
    if (throwOnError && this._persistLastError) {
      const err = this._persistLastError;
      this._persistLastError = null;
      throw err;
    }
  }

  /** @returns {number} */
  get agentCount() { return this._agents.size; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof this._unsubscribe === 'function') {
      try { this._unsubscribe(); } catch { /* ignore */ }
    }
    this._agents.clear();
    this._eventBus = null;
  }
}
