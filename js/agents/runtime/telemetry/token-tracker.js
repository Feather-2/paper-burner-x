import { cryptoRandomHex } from "../../shared/utils/secure-id.js";
import { toNonNegativeInt } from "../../shared/utils/value-utils.js";

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
 */

function generateId() {
  const ts = Date.now().toString(36);
  const rand = cryptoRandomHex(3);
  return `tok_${ts}_${rand}`;
}

export class TokenTracker {
  /**
   * @param {object} options
   * @param {number} [options.maxRecords=10000] - 最大记录数
   * @param {function} [options.onRecord] - 记录回调
   */
  constructor({ maxRecords = 10000, onRecord = null } = {}) {
    this.maxRecords = toNonNegativeInt(maxRecords, 10000);
    this.onRecord = typeof onRecord === "function" ? onRecord : null;

    /** @type {TokenUsageRecord[]} */
    this._records = [];

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
    this._records.push(record);

    // 限制记录数
    if (this._records.length > this.maxRecords) {
      this._records.shift();
    }

    // 更新聚合统计
    this._updateStats(record);

    // 触发回调
    if (this.onRecord) {
      this.onRecord(record);
    }

    return record;
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
    };
  }

  /**
   * 获取最近的记录
   * @param {number} [limit=100]
   */
  getRecentRecords(limit = 100) {
    const n = Math.min(toNonNegativeInt(limit, 100), this._records.length);
    return this._records.slice(-n);
  }

  /**
   * 获取所有记录
   */
  getAllRecords() {
    return this._records.slice();
  }

  /**
   * 导出为 JSON
   */
  exportJson() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      summary: this.getSummary(),
      records: this._records,
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

    for (const r of this._records) {
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
    this._records = [];
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
    return this._records.filter(
      (r) => r.timestamp >= startMs && r.timestamp <= endMs
    );
  }

  /**
   * 按模型过滤记录
   */
  getRecordsByModel(model) {
    const m = String(model).toLowerCase();
    return this._records.filter((r) => r.model.toLowerCase() === m);
  }

  /**
   * 按用途过滤记录
   */
  getRecordsByUsage(usage) {
    const u = String(usage).toLowerCase();
    return this._records.filter((r) => r.usage.toLowerCase() === u);
  }
}

// 全局默认 tracker
let _globalTracker = null;

export function getGlobalTokenTracker() {
  if (!_globalTracker) {
    _globalTracker = new TokenTracker();
  }
  return _globalTracker;
}

/**
 * 便捷函数：记录 token 使用
 */
export function trackTokenUsage(params) {
  return getGlobalTokenTracker().record(params);
}

/**
 * 便捷函数：获取统计摘要
 */
export function getTokenUsageSummary() {
  return getGlobalTokenTracker().getSummary();
}

/**
 * 便捷函数：导出 JSON
 */
export function exportTokenUsageJson() {
  return getGlobalTokenTracker().exportJson();
}

/**
 * 便捷函数：导出 CSV
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
