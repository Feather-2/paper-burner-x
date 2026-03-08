import { cryptoRandomHex } from "../../shared/index.js";
import { toNonNegativeInt } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";
import { getGlobalContainer } from "../../core/di/global-container.js";

const MAX_RECORDS = 500;
const logger = createLogger("runtime/telemetry/token-tracker");

/**
 * Token Tracker - LLM 调用 Token 使用率实时追踪
 *
 * P4.3: 每次 LLM 调用记录详细 Token 开销
 *
 * 功能：
 * - 记录 promptTokens, completionTokens, totalTokens, latencyMs
 * - 支持导出 CSV/JSON
 * - 按模型/用途统计聚合
 *
 * 浏览器友好，无 Node.js 依赖。
 */

/**
 * @typedef {Object} TokenUsageRecord
 * @property {string} id - 记录 ID
 * @property {number} timestamp - Unix 时间戳 (ms)
 * @property {string} model - 模型 ID
 * @property {string} provider - 提供商 ID
 * @property {string} usage - 用途 (worker, planner, analyst, writer, vision)
 * @property {number} promptTokens - 输入 token 数
 * @property {number} completionTokens - 输出 token 数
 * @property {number} totalTokens - 总 token 数
 * @property {number} latencyMs - 延迟 (ms)
 * @property {boolean} success - 是否成功
 * @property {string} [error] - 错误信息（如果失败）
 * @property {boolean} [usageMissing] - 是否缺失 usage 标签
 */

function generateId() {
  const ts = Date.now().toString(36);
  const rand = cryptoRandomHex(3);
  return `tok_${ts}_${rand}`;
}

export class TokenTracker {
  /**
   * @param {object} options
   * @param {number} [options.maxRecords=500] - 最大记录数
   * @param {function} [options.onRecord] - 记录回调
   * @param {{ list: (runId: string) => Promise<Array<{ id: string }>>, load: (checkpointId: string) => Promise<any>, save?: Function }} [options.archive] - Archive 实例（可选）
   * @param {string} [options.runId] - 运行 ID（可选）
   * @param {(payload: { phase: "hydrate" | "persist", error: Error, runId: string }) => void} [options.onPersistenceError] - 持久化错误回调
   */
  constructor({ maxRecords = MAX_RECORDS, onRecord = null, archive = null, runId = null, onPersistenceError = null } = {}) {
    this.maxRecords = Math.min(toNonNegativeInt(maxRecords, MAX_RECORDS), MAX_RECORDS);
    this.onRecord = typeof onRecord === "function" ? onRecord : null;

    /** @type {Array<TokenUsageRecord | undefined>} */
    this._records = this.maxRecords > 0 ? new Array(this.maxRecords) : [];
    this._head = 0;
    this._size = 0;

    // 聚合统计
    this._stats = {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalLatencyMs: 0,
      byModel: new Map(),
      byUsage: new Map(),
      byProvider: new Map(),
    };

    // Archive 持久化支持
    this._archive = archive || null;
    this._runId = runId || `token_tracker_${Date.now()}`;
    this._initPromise = null;
    this._onPersistenceError = typeof onPersistenceError === "function" ? onPersistenceError : null;
    this._persistPending = Promise.resolve();
    this._persistScheduled = false;
    this._persistDirty = false;
    this._persistLastError = null;
    this._persistFailureCount = 0;
    this._persistSuccessCount = 0;
  }

  /**
   * @private
   * @param {"hydrate"|"persist"} phase
   * @param {unknown} error
   */
  _reportPersistenceError(phase, error) {
    const err = error instanceof Error ? error : new Error(String(error ?? "unknown"));
    logger.warn(`[TokenTracker] ${phase} failed`, { runId: this._runId, error: err.message });
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
   * @private
   */
  _buildArchiveSnapshot() {
    return {
      records: this.getAllRecords(),
      head: this._head,
      size: this._size,
      stats: {
        totalCalls: this._stats.totalCalls,
        successCalls: this._stats.successCalls,
        failedCalls: this._stats.failedCalls,
        totalPromptTokens: this._stats.totalPromptTokens,
        totalCompletionTokens: this._stats.totalCompletionTokens,
        totalTokens: this._stats.totalTokens,
        totalLatencyMs: this._stats.totalLatencyMs,
        byModel: Object.fromEntries(this._stats.byModel),
        byUsage: Object.fromEntries(this._stats.byUsage),
        byProvider: Object.fromEntries(this._stats.byProvider),
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 初始化 TokenTracker，从 Archive 恢复数据（如果可用）
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

        // 恢复 ring buffer 状态
        if (Array.isArray(restored.records)) {
          this._records = restored.records.slice(0, this.maxRecords);
          this._head = typeof restored.head === 'number' ? restored.head : 0;
          this._size = typeof restored.size === 'number' ? restored.size : 0;
        }

        // 恢复聚合统计
        if (restored.stats && typeof restored.stats === 'object') {
          const s = restored.stats;
          this._stats.totalCalls = typeof s.totalCalls === 'number' ? s.totalCalls : 0;
          this._stats.successCalls = typeof s.successCalls === 'number' ? s.successCalls : 0;
          this._stats.failedCalls = typeof s.failedCalls === 'number' ? s.failedCalls : 0;
          this._stats.totalPromptTokens = typeof s.totalPromptTokens === 'number' ? s.totalPromptTokens : 0;
          this._stats.totalCompletionTokens = typeof s.totalCompletionTokens === 'number' ? s.totalCompletionTokens : 0;
          this._stats.totalTokens = typeof s.totalTokens === 'number' ? s.totalTokens : 0;
          this._stats.totalLatencyMs = typeof s.totalLatencyMs === 'number' ? s.totalLatencyMs : 0;

          // 恢复 Map 对象
          if (s.byModel && typeof s.byModel === 'object') {
            this._stats.byModel = new Map(Object.entries(s.byModel));
          }
          if (s.byUsage && typeof s.byUsage === 'object') {
            this._stats.byUsage = new Map(Object.entries(s.byUsage));
          }
          if (s.byProvider && typeof s.byProvider === 'object') {
            this._stats.byProvider = new Map(Object.entries(s.byProvider));
          }
        }
      } catch (err) {
        this._persistLastError = this._reportPersistenceError("hydrate", err);
      }
    })();

    return this._initPromise;
  }

  /**
   * 持久化当前状态到 Archive（异步调度，可通过 flush() 强制落盘）
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
            const snapshot = this._buildArchiveSnapshot();
            await this._archive.save(this._runId, snapshot);
            this._persistSuccessCount++;
            this._persistLastError = null;
          } catch (err) {
            this._persistFailureCount++;
            this._persistLastError = this._reportPersistenceError("persist", err);
          }

          // Flush once more if updates arrived while persisting.
          if (this._persistDirty) {
            this._persistToArchive();
          }
        })
        .catch(() => {
          // _persistPending should never reject to keep chain alive.
        });
    });
  }

  /**
   * 记录一次 LLM 调用
   * @param {object} params
   * @param {string} params.model
   * @param {string} params.provider
   * @param {string} params.usage
   * @param {number} params.promptTokens
   * @param {number} params.completionTokens
   * @param {number} params.latencyMs
   * @param {boolean} [params.success=true]
   * @param {string} [params.error]
   * @returns {TokenUsageRecord}
   */
  record({
    model,
    provider,
    usage,
    promptTokens,
    completionTokens,
    latencyMs,
    success = true,
    error,
  }) {
    const pt = toNonNegativeInt(promptTokens, 0);
    const ct = toNonNegativeInt(completionTokens, 0);
    const tt = pt + ct;
    const lat = toNonNegativeInt(latencyMs, 0);

    const record = {
      id: generateId(),
      timestamp: Date.now(),
      model: String(model || "unknown"),
      provider: String(provider || "unknown"),
      usage: String(usage || "unknown"),
      promptTokens: pt,
      completionTokens: ct,
      totalTokens: tt,
      latencyMs: lat,
      success: Boolean(success),
      ...(error ? { error: String(error) } : {}),
    };

    // 添加到记录列表
    this._pushRecord(record);

    // 更新聚合统计
    this._updateStats(record);

    // 触发回调
    if (this.onRecord) {
      this.onRecord(record);
    }

    // 异步持久化到 Archive（不阻塞）
    this._persistToArchive();

    return record;
  }

  /**
   * Ring buffer push (overwrites oldest when full).
   * @param {TokenUsageRecord} record
   */
  _pushRecord(record) {
    if (this.maxRecords <= 0) return;

    this._records[this._head] = record;
    this._head = (this._head + 1) % this.maxRecords;
    if (this._size < this.maxRecords) this._size++;
  }

  /**
   * 更新聚合统计
   */
  _updateStats(record) {
    const s = this._stats;

    s.totalCalls++;
    if (record.success) {
      s.successCalls++;
    } else {
      s.failedCalls++;
    }

    s.totalPromptTokens += record.promptTokens;
    s.totalCompletionTokens += record.completionTokens;
    s.totalTokens += record.totalTokens;
    s.totalLatencyMs += record.latencyMs;

    // 按模型
    const modelStats = s.byModel.get(record.model) || {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
    };
    modelStats.calls++;
    modelStats.promptTokens += record.promptTokens;
    modelStats.completionTokens += record.completionTokens;
    modelStats.totalTokens += record.totalTokens;
    modelStats.latencyMs += record.latencyMs;
    s.byModel.set(record.model, modelStats);

    // 按用途
    const usageStats = s.byUsage.get(record.usage) || {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
    };
    usageStats.calls++;
    usageStats.promptTokens += record.promptTokens;
    usageStats.completionTokens += record.completionTokens;
    usageStats.totalTokens += record.totalTokens;
    usageStats.latencyMs += record.latencyMs;
    s.byUsage.set(record.usage, usageStats);

    // 按提供商
    const providerStats = s.byProvider.get(record.provider) || {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
    };
    providerStats.calls++;
    providerStats.promptTokens += record.promptTokens;
    providerStats.completionTokens += record.completionTokens;
    providerStats.totalTokens += record.totalTokens;
    providerStats.latencyMs += record.latencyMs;
    s.byProvider.set(record.provider, providerStats);
  }

  /**
   * 获取统计摘要
   */
  getSummary() {
    const s = this._stats;
    return {
      totalCalls: s.totalCalls,
      successCalls: s.successCalls,
      failedCalls: s.failedCalls,
      successRate: s.totalCalls > 0 ? s.successCalls / s.totalCalls : 0,
      totalPromptTokens: s.totalPromptTokens,
      totalCompletionTokens: s.totalCompletionTokens,
      totalTokens: s.totalTokens,
      totalLatencyMs: s.totalLatencyMs,
      avgLatencyMs: s.totalCalls > 0 ? s.totalLatencyMs / s.totalCalls : 0,
      avgTokensPerCall: s.totalCalls > 0 ? s.totalTokens / s.totalCalls : 0,
      byModel: Object.fromEntries(s.byModel),
      byUsage: Object.fromEntries(s.byUsage),
      byProvider: Object.fromEntries(s.byProvider),
      persistence: this.getPersistenceStatus(),
    };
  }

  /**
   * 获取持久化状态
   */
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
   * 强制刷新 Archive 持久化队列
   * @param {{ throwOnError?: boolean }} [options]
   * @returns {Promise<void>}
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

  /**
   * 获取最近的记录
   * @param {number} [limit=100]
   */
  getRecentRecords(limit = 100) {
    const n = Math.min(toNonNegativeInt(limit, 100), this._size);
    if (n <= 0 || this.maxRecords <= 0) return [];

    const out = new Array(n);
    const start = (this._head - n + this.maxRecords) % this.maxRecords;
    for (let i = 0; i < n; i++) {
      out[i] = this._records[(start + i) % this.maxRecords];
    }
    return out;
  }

  /**
   * 获取所有记录
   */
  getAllRecords() {
    if (this._size === 0 || this.maxRecords <= 0) return [];

    const out = new Array(this._size);
    const start = (this._head - this._size + this.maxRecords) % this.maxRecords;
    for (let i = 0; i < this._size; i++) out[i] = this._records[(start + i) % this.maxRecords];
    return out;
  }

  /**
   * Compatibility alias.
   */
  getRecords() {
    return this.getAllRecords();
  }

  /**
   * Compatibility alias.
   */
  getTotalTokens() {
    return this._stats.totalTokens;
  }

  /**
   * 导出为 JSON
   */
  exportJson() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      summary: this.getSummary(),
      records: this.getAllRecords(),
    }, null, 2);
  }

  /**
   * 导出为 CSV
   */
  exportCsv() {
    const headers = [
      "id",
      "timestamp",
      "model",
      "provider",
      "usage",
      "promptTokens",
      "completionTokens",
      "totalTokens",
      "latencyMs",
      "success",
      "error",
    ];

    const rows = [headers.join(",")];

    for (const r of this.getAllRecords()) {
      const row = [
        r.id,
        new Date(r.timestamp).toISOString(),
        `"${r.model}"`,
        `"${r.provider}"`,
        `"${r.usage}"`,
        r.promptTokens,
        r.completionTokens,
        r.totalTokens,
        r.latencyMs,
        r.success,
        r.error ? `"${r.error.replace(/"/g, '""')}"` : "",
      ];
      rows.push(row.join(","));
    }

    return rows.join("\n");
  }

  /**
   * 清空所有记录和统计
   */
  clear() {
    this._records = this.maxRecords > 0 ? new Array(this.maxRecords) : [];
    this._head = 0;
    this._size = 0;
    this._stats = {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalLatencyMs: 0,
      byModel: new Map(),
      byUsage: new Map(),
      byProvider: new Map(),
    };
  }

  /**
   * 获取特定时间范围内的记录
   * @param {number} startMs - 开始时间 (Unix ms)
   * @param {number} endMs - 结束时间 (Unix ms)
   */
  getRecordsInRange(startMs, endMs) {
    return this.getAllRecords().filter(
      (r) => r.timestamp >= startMs && r.timestamp <= endMs
    );
  }

  /**
   * 按模型过滤记录
   */
  getRecordsByModel(model) {
    const m = String(model).toLowerCase();
    return this.getAllRecords().filter((r) => r.model.toLowerCase() === m);
  }

  /**
   * 按用途过滤记录
   */
  getRecordsByUsage(usage) {
    const u = String(usage).toLowerCase();
    return this.getAllRecords().filter((r) => r.usage.toLowerCase() === u);
  }
}

const TOKEN_TRACKER_SERVICE_ID = "tokenTracker";

/**
 * @typedef {object} TokenUsageSummary
 * @property {number} totalCalls
 * @property {number} successCalls
 * @property {number} failedCalls
 * @property {number} successRate
 * @property {number} totalPromptTokens
 * @property {number} totalCompletionTokens
 * @property {number} totalTokens
 * @property {number} totalLatencyMs
 * @property {number} avgLatencyMs
 * @property {number} avgTokensPerCall
 * @property {Object<string, object>} byModel
 * @property {Object<string, object>} byUsage
 * @property {Object<string, object>} byProvider
 */

/**
 * Global token tracker singleton (compatibility layer).
 *
 * @deprecated Prefer resolving via DI container (`ServiceId.TOKEN_TRACKER`) or passing an explicit tracker instance.
 * @returns {TokenTracker} The global TokenTracker instance.
 */
export function getGlobalTokenTracker() {
  const container = getGlobalContainer();
  if (!container.has(TOKEN_TRACKER_SERVICE_ID)) {
    container.register(TOKEN_TRACKER_SERVICE_ID, () => new TokenTracker());
  }
  return container.get(TOKEN_TRACKER_SERVICE_ID);
}

/**
 * 便捷函数：记录 token 使用
 * @param {object} params
 * @param {string} params.model - 模型 ID
 * @param {string} params.provider - 提供商 ID
 * @param {string} params.usage - 用途
 * @param {number} params.promptTokens - 输入 token 数
 * @param {number} params.completionTokens - 输出 token 数
 * @param {number} params.latencyMs - 延迟 (ms)
 * @param {boolean} [params.success=true] - 是否成功
 * @param {string} [params.error] - 错误信息
 * @returns {TokenUsageRecord} 新创建的记录
 */
export function trackTokenUsage(params) {
  return getGlobalTokenTracker().record(params);
}

/**
 * 便捷函数：获取统计摘要
 * @returns {TokenUsageSummary} Token 使用统计摘要
 */
export function getTokenUsageSummary() {
  return getGlobalTokenTracker().getSummary();
}

/**
 * 便捷函数：导出 JSON
 * @returns {string} JSON 格式的导出数据
 */
export function exportTokenUsageJson() {
  return getGlobalTokenTracker().exportJson();
}

/**
 * 便捷函数：导出 CSV
 * @returns {string} CSV 格式的导出数据
 */
export function exportTokenUsageCsv() {
  return getGlobalTokenTracker().exportCsv();
}

export default {
  TokenTracker,
  getGlobalTokenTracker,
  trackTokenUsage,
  getTokenUsageSummary,
  exportTokenUsageJson,
  exportTokenUsageCsv,
};
