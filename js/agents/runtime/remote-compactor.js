/**
 * RemoteCompactor - 远程压缩接口
 *
 * 设计思路：
 * - 优先使用快速模型（如 Gemini Flash、Claude Haiku）
 * - 回退到本地 CicadaCompressor
 * - 预留供应商专用 Compact API 扩展点
 *
 * @example
 * const compactor = new RemoteCompactor({
 *   providers: [
 *     new FastModelProvider({ modelRouter, model: 'gemini-2.0-flash' }),
 *   ],
 *   fallback: cicadaCompressor,
 * });
 *
 * const result = await compactor.compact(history, { preserveSnapshots: true });
 */

import { toNonEmptyString } from "../shared/value-utils.js";
import { CicadaCompressor } from "./cicada-compressor.js";

// 压缩策略枚举
export const CompactionStrategy = Object.freeze({
  REMOTE_API: "remote_api",      // 供应商专用 Compact API
  FAST_MODEL: "fast_model",      // 快速模型总结
  LOCAL: "local",                // 本地 CicadaCompressor
});

// 压缩结果状态
export const CompactionStatus = Object.freeze({
  SUCCESS: "success",
  FALLBACK: "fallback",
  FAILED: "failed",
});

/**
 * 远程压缩供应商接口（抽象基类）
 * @interface
 */
export class CompactProvider {
  constructor({ name, priority = 0 } = {}) {
    this.name = toNonEmptyString(name) || "unknown";
    this.priority = Number.isFinite(priority) ? priority : 0;
  }

  /**
   * 检查供应商是否可用
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return false;
  }

  /**
   * 执行压缩
   * @param {Object} params
   * @param {Array} params.history - 对话历史
   * @param {string} [params.instructions] - 系统指令
   * @param {Object} [params.options] - 压缩选项
   * @returns {Promise<CompactionResult>}
   */
  async compact({ history, instructions, options }) {
    throw new Error("CompactProvider.compact() must be implemented");
  }

  /**
   * 获取策略类型
   * @returns {string}
   */
  getStrategy() {
    return CompactionStrategy.LOCAL;
  }
}

/**
 * 快速模型供应商 - 复用 CicadaCompressor，使用快速模型
 */
export class FastModelProvider extends CompactProvider {
  /**
   * @param {Object} options
   * @param {Object} options.modelRouter - 快速模型路由器
   * @param {number} [options.maxTokens=2000] - 最大 token 数
   * @param {string[]} [options.layers] - 压缩层配置
   */
  constructor({ modelRouter, maxTokens = 2000, layers } = {}) {
    super({ name: "fast_model", priority: 50 });
    this.cicada = new CicadaCompressor({ modelRouter, maxTokens, layers });
  }

  getStrategy() {
    return CompactionStrategy.FAST_MODEL;
  }

  async isAvailable() {
    return !!(this.cicada.modelRouter && typeof this.cicada.modelRouter.call === "function");
  }

  async compact({ history, instructions, options }) {
    if (!await this.isAvailable()) {
      throw new Error("FastModelProvider: modelRouter not available");
    }

    const result = await this.cicada.compress(
      { messages: history, instructions },
      options
    );

    // 统一输出格式，复用 CicadaCompressor 的结构
    const llmSummary = result.metadata?.llmSummary || {};
    return {
      summary: llmSummary.summary || "",
      keyPoints: llmSummary.keyPoints || [],
      decisions: llmSummary.decisions || [],
      errors: llmSummary.errors || [],
      preservedMessages: result.context?.messages || [],
      originalLength: history?.length || 0,
      metadata: result.metadata,
    };
  }
}

/**
 * 本地 CicadaCompressor 适配器
 */
export class LocalCompactProvider extends CompactProvider {
  constructor({ cicada } = {}) {
    super({ name: "local", priority: 0 });
    this.cicada = cicada;
  }

  getStrategy() {
    return CompactionStrategy.LOCAL;
  }

  async isAvailable() {
    return !!(this.cicada && typeof this.cicada.compress === "function");
  }

  async compact({ history, instructions, options }) {
    if (!await this.isAvailable()) {
      throw new Error("LocalCompactProvider: cicada not available");
    }

    const result = await this.cicada.compress(
      { messages: history, instructions },
      options
    );

    // 统一输出格式
    const llmSummary = result.metadata?.llmSummary || {};
    return {
      summary: llmSummary.summary || "",
      keyPoints: llmSummary.keyPoints || [],
      decisions: llmSummary.decisions || [],
      errors: llmSummary.errors || [],
      preservedMessages: result.context?.messages || [],
      originalLength: history?.length || 0,
      metadata: result.metadata,
    };
  }
}

/**
 * 压缩结果（复用 CicadaCompressor 结构）
 * @typedef {Object} CompactionResult
 * @property {string} summary - 压缩摘要
 * @property {string[]} keyPoints - 关键要点
 * @property {string[]} decisions - 关键决策
 * @property {string[]} errors - 错误信息
 * @property {Array} preservedMessages - 保留的消息
 * @property {Array} [snapshots] - 状态快照
 * @property {number} originalLength - 原始历史长度
 */

/**
 * RemoteCompactor - 远程压缩协调器
 */
export class RemoteCompactor {
  /**
   * @param {Object} options
   * @param {CompactProvider[]} [options.providers] - 压缩供应商列表（按优先级排序）
   * @param {Object} [options.fallback] - 回退压缩器（CicadaCompressor）
   * @param {Object} [options.eventBus] - 事件总线
   */
  constructor({ providers = [], fallback, eventBus } = {}) {
    this.providers = [...providers].sort((a, b) => b.priority - a.priority);
    this.fallback = fallback;
    this.eventBus = eventBus;

    // 如果有 fallback，添加为最低优先级 provider
    if (fallback && !this.providers.some(p => p.name === "local")) {
      this.providers.push(new LocalCompactProvider({ cicada: fallback }));
    }
  }

  /**
   * 执行压缩（自动选择最优供应商）
   * @param {Array} history - 对话历史
   * @param {Object} [options]
   * @param {string} [options.instructions] - 系统指令
   * @param {boolean} [options.preserveSnapshots=true] - 保留状态快照
   * @param {Function} [options.extractSnapshots] - 快照提取函数
   * @returns {Promise<{ result: CompactionResult, status: string, provider: string }>}
   */
  async compact(history, options = {}) {
    const { instructions, preserveSnapshots = true, extractSnapshots } = options;

    // 1. 提取快照（用于 undo 等功能恢复）
    let snapshots = [];
    if (preserveSnapshots && typeof extractSnapshots === "function") {
      try {
        snapshots = extractSnapshots(history);
      } catch (err) {
        console.warn("[RemoteCompactor] extractSnapshots failed:", err.message);
      }
    }

    // 2. 尝试各供应商
    let lastError = null;
    for (const provider of this.providers) {
      try {
        const available = await provider.isAvailable();
        if (!available) continue;

        this._emit("compact.attempt", { provider: provider.name });

        const result = await provider.compact({ history, instructions, options });

        // 附加快照
        if (snapshots.length > 0) {
          result.snapshots = snapshots;
        }

        this._emit("compact.success", {
          provider: provider.name,
          strategy: provider.getStrategy(),
          originalLength: history?.length || 0,
          compressedLength: result.preservedMessages?.length || 0,
        });

        return {
          result,
          status: CompactionStatus.SUCCESS,
          provider: provider.name,
          strategy: provider.getStrategy(),
        };
      } catch (err) {
        lastError = err;
        this._emit("compact.error", { provider: provider.name, error: err.message });
      }
    }

    // 3. 全部失败
    this._emit("compact.failed", { error: lastError?.message });
    return {
      result: {
        summary: "",
        keyPoints: [],
        decisions: [],
        errors: [lastError?.message || "All providers failed"],
        preservedMessages: history || [],
        snapshots,
        originalLength: history?.length || 0,
      },
      status: CompactionStatus.FAILED,
      provider: null,
      error: lastError,
    };
  }

  /**
   * 替换历史
   * @param {Object} session - 会话对象
   * @param {CompactionResult} compactResult - 压缩结果
   * @returns {Array} 新的历史
   */
  replaceHistory(session, compactResult) {
    const { summary, preservedMessages, snapshots } = compactResult;

    // 构建压缩后的历史
    const newHistory = [];

    // 1. 添加摘要作为系统消息
    if (summary) {
      newHistory.push({
        role: "system",
        content: `[Compacted History]\n${summary}`,
        _compacted: true,
      });
    }

    // 2. 添加保留的消息
    if (Array.isArray(preservedMessages)) {
      newHistory.push(...preservedMessages);
    }

    // 3. 附加快照（用于 undo 等功能）
    if (Array.isArray(snapshots) && snapshots.length > 0) {
      newHistory._snapshots = snapshots;
    }

    return newHistory;
  }

  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, { actor: "remote_compactor", ...payload });
    }
  }
}

export default RemoteCompactor;
