/**
 * ProactiveCompressor - 主动压缩协调器
 *
 * 整合 ContextPredictor + AdaptiveZoneManager + 预算分配，
 * 实现基于回归预测的主动上下文管理。
 *
 * 核心特性：
 * 1. 90% 填充率触发压缩（可配置）
 * 2. 一次压到 30%，避免反复压缩导致 KV cache 失效
 * 3. 动态预算分配：原文/摘要/归档 三级决策
 * 4. 异步摘要预生成，压缩时直接使用
 * 5. 完整内容存 L3 Archive，支持按需 Recall
 *
 * @module runtime/compression/proactive-compressor
 */

import { ContextPredictor } from "./context-predictor.js";
import { AdaptiveZoneManager } from "./adaptive-zone-manager.js";
import { estimateTokensCached } from "../../shared/utils/token-cache.js";
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/compression/proactive-compressor");

// ============================================================================
// 类型定义
// ============================================================================

/**
 * @typedef {Object} ProactiveCompressorOptions
 * @property {number} [contextWindow] - 上下文窗口大小
 * @property {number} [compressThreshold] - 压缩触发阈值 (0-1)，默认 0.9
 * @property {number} [targetFillRatio] - 压缩后目标填充率，默认 0.3
 * @property {number} [keepLastTurns] - 保留最后 N 轮完整消息，默认 6
 * @property {string} [preset] - 预设模式: aggressive | balanced | conservative
 * @property {any} [eventBus]
 * @property {any} [memoryStore] - 用于 L3 归档
 * @property {any} [modelRouter] - 用于 LLM 摘要
 */

/**
 * @typedef {Object} BudgetDecision
 * @property {object} msg - 原始消息
 * @property {'keep'|'summarize'|'archive'} strategy - 压缩策略
 * @property {number} tokens - 该策略占用的 tokens
 */

/**
 * @typedef {Object} CompressionResult
 * @property {Array} messages - 压缩后的消息
 * @property {string|null} sessionSummary - 累积会话摘要
 * @property {object} stats - 压缩统计
 * @property {boolean} compressed - 是否进行了压缩
 * @property {string[]} [archivedIds] - 归档到 L3 的 ID 列表
 */

// ============================================================================
// 常量与预设
// ============================================================================

const DEFAULT_COMPRESS_THRESHOLD = 0.90;
const DEFAULT_TARGET_FILL_RATIO = 0.30;
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_KEEP_LAST_TURNS = 6;
const DEFAULT_SUMMARY_RATIO = 0.15; // 摘要约为原文的 15%

/**
 * 预设模式
 */
const PRESETS = Object.freeze({
  /** 激进模式：小窗口或紧急情况 */
  aggressive: Object.freeze({
    targetFillRatio: 0.20,
    keepLastTurns: 4,
    compressThreshold: 0.85,
  }),
  /** 平衡模式：默认推荐 */
  balanced: Object.freeze({
    targetFillRatio: 0.30,
    keepLastTurns: 6,
    compressThreshold: 0.90,
  }),
  /** 保守模式：大窗口或重要对话 */
  conservative: Object.freeze({
    targetFillRatio: 0.50,
    keepLastTurns: 10,
    compressThreshold: 0.92,
  }),
});

/**
 * 根据上下文窗口大小自动选择预设
 * @param {number} contextWindow
 * @returns {'aggressive'|'balanced'|'conservative'}
 */
function autoSelectPreset(contextWindow) {
  if (contextWindow < 16000) return "aggressive";
  if (contextWindow < 64000) return "balanced";
  return "conservative";
}

// ============================================================================
// 主类
// ============================================================================

export class ProactiveCompressor {
  /**
   * @param {ProactiveCompressorOptions} [options]
   */
  constructor({
    contextWindow = DEFAULT_CONTEXT_WINDOW,
    compressThreshold = DEFAULT_COMPRESS_THRESHOLD,
    targetFillRatio = DEFAULT_TARGET_FILL_RATIO,
    keepLastTurns = DEFAULT_KEEP_LAST_TURNS,
    preset = null,
    eventBus = null,
    memoryStore = null,
    modelRouter = null,
  } = {}) {
    // 如果指定了 preset，应用预设值
    const presetConfig = preset && PRESETS[preset] ? PRESETS[preset] : null;

    this._contextWindow = contextWindow;
    this._compressThreshold = Math.min(0.95, Math.max(0.5,
      presetConfig?.compressThreshold ?? compressThreshold
    ));
    this._targetFillRatio = Math.min(0.70, Math.max(0.15,
      presetConfig?.targetFillRatio ?? targetFillRatio
    ));
    this._keepLastTurns = Math.max(2, Math.floor(
      presetConfig?.keepLastTurns ?? keepLastTurns
    ));

    this._eventBus = eventBus;
    this._memoryStore = memoryStore;
    this._modelRouter = modelRouter;

    this._predictor = new ContextPredictor({ contextWindow });
    this._zoneManager = new AdaptiveZoneManager();

    /** @type {string|null} 累积的会话摘要（只追加，不修改） */
    this._sessionSummary = null;

    /** @type {Array<{summary: string, timestamp: number, messageRange: number[]}>} 归档记录 */
    this._archives = [];

    /** @type {number} 上次压缩的时间戳 */
    this._lastCompressTs = 0;
  }

  // ==========================================================================
  // 公开 API
  // ==========================================================================

  /**
   * 检查是否应该压缩
   * @param {number} [currentTokens]
   * @returns {{ shouldCompress: boolean, fillRatio: number, zone: string, prediction: object }}
   */
  shouldCompress(currentTokens) {
    const prediction = this._predictor.predict(currentTokens, {
      compressThreshold: this._compressThreshold,
    });

    return {
      shouldCompress: prediction.shouldCompress,
      fillRatio: prediction.fillRatio,
      zone: prediction.zone,
      prediction,
    };
  }

  /**
   * 记录新消息（用于跟踪和预测）
   * @param {string|object} message
   * @returns {number} 该消息的 token 数
   */
  recordMessage(message) {
    return this._predictor.record(message);
  }

  /**
   * 执行主动压缩 - 核心方法
   *
   * 使用预算分配策略，一次压缩到目标比例（默认 30%）。
   * 决策顺序：从最老消息开始，依次决定 keep/summarize/archive。
   *
   * @param {Array} messages - 消息数组
   * @param {object} [options]
   * @param {boolean} [options.force] - 强制压缩
   * @returns {Promise<CompressionResult>}
   */
  async compress(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return this._emptyResult();
    }

    // 计算当前 tokens
    const messageTokens = this._computeMessageTokens(messages);
    const totalTokens = messageTokens.reduce((sum, t) => sum + t, 0);

    const { shouldCompress, fillRatio, zone } = this.shouldCompress(totalTokens);

    if (!shouldCompress && !options.force) {
      return {
        messages,
        sessionSummary: this._sessionSummary,
        stats: { fillRatio, zone, skipped: true },
        compressed: false,
      };
    }

    logger.info(`[ProactiveCompressor] Compressing at ${(fillRatio * 100).toFixed(1)}% → target ${(this._targetFillRatio * 100).toFixed(0)}%`);

    // 执行预算分配
    const { decisions, activeMessages, activeTokens } = this._allocateBudget(
      messages,
      messageTokens,
      totalTokens
    );

    // 构建结果
    const result = await this._buildCompressedResult(decisions, activeMessages, {
      fillRatio,
      zone,
      totalTokens,
      activeTokens,
    });

    this._lastCompressTs = Date.now();
    this._emit("compression:complete", result.stats);

    return result;
  }

  /**
   * 更新配置
   * @param {Partial<ProactiveCompressorOptions>} options
   */
  configure(options = {}) {
    // 支持 preset
    if (typeof options.preset === "string" && PRESETS[options.preset]) {
      const presetConfig = PRESETS[options.preset];
      this._targetFillRatio = presetConfig.targetFillRatio;
      this._keepLastTurns = presetConfig.keepLastTurns;
      this._compressThreshold = presetConfig.compressThreshold;
    }

    // 支持 auto preset
    if (options.preset === "auto" && typeof options.contextWindow === "number") {
      const autoPreset = autoSelectPreset(options.contextWindow);
      const presetConfig = PRESETS[autoPreset];
      this._targetFillRatio = presetConfig.targetFillRatio;
      this._keepLastTurns = presetConfig.keepLastTurns;
      this._compressThreshold = presetConfig.compressThreshold;
    }

    // 单独配置项
    if (typeof options.contextWindow === "number") {
      this._contextWindow = options.contextWindow;
      this._predictor.setContextWindow(options.contextWindow);
    }
    if (typeof options.compressThreshold === "number") {
      this._compressThreshold = Math.min(0.95, Math.max(0.5, options.compressThreshold));
    }
    if (typeof options.targetFillRatio === "number") {
      this._targetFillRatio = Math.min(0.70, Math.max(0.15, options.targetFillRatio));
    }
    if (typeof options.keepLastTurns === "number") {
      this._keepLastTurns = Math.max(2, Math.floor(options.keepLastTurns));
    }
    if (options.memoryStore !== undefined) {
      this._memoryStore = options.memoryStore;
    }
  }

  /**
   * 获取统计信息
   * @returns {object}
   */
  getStats() {
    return {
      predictor: this._predictor.getStats(),
      boundaries: this._zoneManager.getBoundaries(),
      archiveCount: this._archives.length,
      hasSessionSummary: !!this._sessionSummary,
      config: {
        compressThreshold: this._compressThreshold,
        targetFillRatio: this._targetFillRatio,
        keepLastTurns: this._keepLastTurns,
      },
    };
  }

  /**
   * 获取累积摘要
   * @returns {string|null}
   */
  getSessionSummary() {
    return this._sessionSummary;
  }

  /**
   * 重置状态
   */
  reset() {
    this._predictor.reset();
    this._zoneManager.reset();
    this._sessionSummary = null;
    this._archives = [];
    this._lastCompressTs = 0;
  }

  // ==========================================================================
  // 预算分配 - 核心算法
  // ==========================================================================

  /**
   * 动态预算分配
   *
   * 从最老消息开始，依次决定每条消息的策略：
   * 1. budget 够放原文 → keep
   * 2. budget 够放摘要 → summarize
   * 3. budget 不够 → archive (存 L3)
   *
   * @private
   * @param {Array} messages
   * @param {number[]} messageTokens - 每条消息的 token 数
   * @param {number} totalTokens
   * @returns {{ decisions: BudgetDecision[], activeMessages: object[], activeTokens: number }}
   */
  _allocateBudget(messages, messageTokens, totalTokens) {
    const targetTokens = this._contextWindow * this._targetFillRatio;
    const keepLastN = Math.min(this._keepLastTurns, messages.length);

    // Step 1: 分离活跃区（最后 N 轮，必须完整保留）
    const activeMessages = messages.slice(-keepLastN);
    const activeTokens = messageTokens.slice(-keepLastN).reduce((a, b) => a + b, 0);

    // Step 2: 计算剩余预算
    let budget = Math.max(0, targetTokens - activeTokens);

    // Step 3: 从最老开始，决定每条的策略
    const olderMessages = messages.slice(0, -keepLastN);
    const olderTokens = messageTokens.slice(0, -keepLastN);

    /** @type {BudgetDecision[]} */
    const decisions = [];

    for (let i = 0; i < olderMessages.length; i++) {
      const msg = olderMessages[i];
      const originalTokens = olderTokens[i];
      const summaryTokens = this._estimateSummaryTokens(msg, originalTokens);

      if (budget >= originalTokens) {
        // 预算充足 → 保留原文
        decisions.push({ msg, strategy: "keep", tokens: originalTokens });
        budget -= originalTokens;
      } else if (budget >= summaryTokens && this._hasSummary(msg)) {
        // 预算够放摘要 → 用摘要
        decisions.push({ msg, strategy: "summarize", tokens: summaryTokens });
        budget -= summaryTokens;
      } else if (budget >= summaryTokens) {
        // 没有预生成摘要，但预算够 → 即时生成摘要
        decisions.push({ msg, strategy: "summarize", tokens: summaryTokens });
        budget -= summaryTokens;
      } else {
        // 预算不够 → 归档到 L3
        decisions.push({ msg, strategy: "archive", tokens: 0 });
      }
    }

    return { decisions, activeMessages, activeTokens };
  }

  /**
   * 构建压缩后的结果
   * @private
   */
  async _buildCompressedResult(decisions, activeMessages, meta) {
    const result = {
      messages: [],
      sessionSummary: this._sessionSummary,
      stats: {
        fillRatio: meta.fillRatio,
        zone: meta.zone,
        totalTokensBefore: meta.totalTokens,
        activeTokens: meta.activeTokens,
        kept: 0,
        summarized: 0,
        archived: 0,
      },
      compressed: true,
      archivedIds: [],
    };

    // 收集需要归档的消息
    const toArchive = [];

    for (const decision of decisions) {
      switch (decision.strategy) {
        case "keep":
          result.messages.push(decision.msg);
          result.stats.kept++;
          break;

        case "summarize": {
          const summarized = this._toSummaryMessage(decision.msg);
          result.messages.push(summarized);
          result.stats.summarized++;
          break;
        }

        case "archive":
          toArchive.push(decision.msg);
          result.stats.archived++;
          break;
      }
    }

    // 添加活跃消息（完整保留）
    result.messages.push(...activeMessages);

    // 归档到 L3
    if (toArchive.length > 0) {
      const archiveResult = await this._archiveMessages(toArchive);
      if (archiveResult) {
        result.archivedIds.push(archiveResult.id);
        // 更新累积摘要
        this._appendToSessionSummary(archiveResult.summary);
      }
    }

    result.sessionSummary = this._sessionSummary;

    // 计算压缩后 tokens
    let afterTokens = 0;
    for (const msg of result.messages) {
      afterTokens += this._estimateTokens(msg);
    }
    result.stats.totalTokensAfter = afterTokens;
    result.stats.compressionRatio = meta.totalTokens > 0
      ? (afterTokens / meta.totalTokens).toFixed(2)
      : "N/A";

    return result;
  }

  // ==========================================================================
  // 摘要与归档
  // ==========================================================================

  /**
   * 检查消息是否有预生成的摘要
   * @private
   */
  _hasSummary(msg) {
    return !!(msg && msg._summary);
  }

  /**
   * 预估摘要 tokens
   * @private
   */
  _estimateSummaryTokens(msg, originalTokens) {
    if (msg && msg._summaryTokens) {
      return msg._summaryTokens;
    }
    // 默认摘要为原文的 15%
    return Math.max(20, Math.floor(originalTokens * DEFAULT_SUMMARY_RATIO));
  }

  /**
   * 将消息转换为摘要形式
   * @private
   */
  _toSummaryMessage(msg) {
    // 优先使用预生成的摘要
    if (msg._summary) {
      return {
        ...msg,
        content: msg._summary,
        _compressed: true,
        _originalTokens: msg._tokens || this._estimateTokens(msg),
      };
    }

    // 即时生成摘要
    const isThinking = this._isThinkingMessage(msg);
    if (isThinking) {
      return this._summarizeThinking(msg);
    }

    // 普通消息：截断
    return this._truncateMessage(msg, 200);
  }

  /**
   * 归档消息到 L3
   * @private
   */
  async _archiveMessages(messages) {
    if (!messages || messages.length === 0) return null;

    // 生成归档摘要
    const summary = this._generateArchiveSummary(messages);
    const timestamp = Date.now();
    const messageRange = [0, messages.length - 1];

    // 记录到本地
    this._archives.push({ summary, timestamp, messageRange });

    // 如果有 memoryStore，存入 L3
    if (this._memoryStore && typeof this._memoryStore.archive === "function") {
      try {
        const id = await this._memoryStore.archive(
          `proactive-${timestamp}`,
          {
            messages,
            summary,
            timestamp,
            messageCount: messages.length,
          },
          this._extractKeywords(messages)
        );
        return { id, summary };
      } catch (err) {
        logger.warn("[ProactiveCompressor] Failed to archive to L3:", err?.message);
      }
    }

    return { id: `local-${timestamp}`, summary };
  }

  /**
   * 生成归档摘要
   * @private
   */
  _generateArchiveSummary(messages) {
    const lines = [];
    for (const msg of messages.slice(0, 10)) {
      const role = msg.role || "unknown";
      const content = String(msg.content || msg.text || "").replace(/\s+/g, " ").trim();
      if (content) {
        const snippet = content.length > 60 ? content.slice(0, 60) + "..." : content;
        lines.push(`[${role}] ${snippet}`);
      }
    }

    const count = messages.length;
    const moreIndicator = count > 10 ? `\n... and ${count - 10} more` : "";
    return `[Archived ${count} messages]\n${lines.join("\n")}${moreIndicator}`;
  }

  /**
   * 追加到累积摘要（只追加，不修改已有内容）
   * @private
   */
  _appendToSessionSummary(newSummary) {
    if (!newSummary) return;

    const timestamp = new Date().toISOString().slice(11, 19);
    const entry = `[${timestamp}] ${newSummary}`;

    if (this._sessionSummary) {
      this._sessionSummary = `${this._sessionSummary}\n---\n${entry}`;
    } else {
      this._sessionSummary = entry;
    }
  }

  /**
   * 提取关键词（用于 L3 索引）
   * @private
   */
  _extractKeywords(messages) {
    const keywords = new Set();
    for (const msg of messages) {
      const content = String(msg.content || msg.text || "");
      // 简单提取：英文单词 + 中文词
      const words = content.match(/\b[a-zA-Z]{4,}\b/g) || [];
      const chinese = content.match(/[\u4e00-\u9fff]{2,4}/g) || [];
      for (const w of [...words.slice(0, 10), ...chinese.slice(0, 10)]) {
        keywords.add(w.toLowerCase());
      }
    }
    return Array.from(keywords).slice(0, 20);
  }

  // ==========================================================================
  // 辅助方法
  // ==========================================================================

  /**
   * 计算每条消息的 tokens
   * @private
   */
  _computeMessageTokens(messages) {
    return messages.map(msg => {
      if (msg._tokens) return msg._tokens;
      const content = typeof msg === "string" ? msg : String(msg?.content || msg?.text || "");
      return estimateTokensCached(content);
    });
  }

  /**
   * 估算单条消息 tokens
   * @private
   */
  _estimateTokens(msg) {
    if (msg._tokens) return msg._tokens;
    const content = typeof msg === "string" ? msg : String(msg?.content || msg?.text || "");
    return estimateTokensCached(content);
  }

  /**
   * 检测是否为 thinking 消息
   * @private
   */
  _isThinkingMessage(message) {
    if (!message || typeof message !== "object") return false;
    if (message.thinking === true || message.internal === true) return true;
    if (message.type === "thinking") return true;
    if (message.meta && message.meta.type === "thinking") return true;
    const content = String(message.content || message.text || "").trim();
    if (!content) return false;
    return /^<(think|analysis)>/i.test(content) || /^(thoughts?|analysis|internal):/i.test(content);
  }

  /**
   * 摘要 thinking 消息
   * @private
   */
  _summarizeThinking(msg) {
    const content = String(msg.content || msg.text || "");

    // 提取关键决策点
    const decisions = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(决定|选择|确定|采用|使用|将|要|需要|应该|因此|所以|结论)/i.test(trimmed) ||
          /^(decide|choose|will|should|therefore|conclusion|plan to)/i.test(trimmed)) {
        decisions.push(trimmed.slice(0, 80));
      }
    }

    const summary = decisions.length > 0
      ? `[决策] ${decisions.slice(0, 3).join("; ")}`
      : `[Thinking] ${content.slice(0, 80)}...`;

    return {
      ...msg,
      content: summary,
      _originalLength: content.length,
      _compressed: true,
      _thinkingSummarized: true,
    };
  }

  /**
   * 截断消息
   * @private
   */
  _truncateMessage(msg, maxChars) {
    const content = String(msg.content || msg.text || "");
    if (content.length <= maxChars) return msg;

    const head = Math.floor(maxChars * 0.7);
    const tail = Math.max(0, maxChars - head - 5);
    const truncated = content.slice(0, head) + " ... " + (tail > 0 ? content.slice(-tail) : "");

    return {
      ...msg,
      content: truncated,
      _originalLength: content.length,
      _truncated: true,
    };
  }

  /**
   * 空结果
   * @private
   */
  _emptyResult() {
    return {
      messages: [],
      sessionSummary: this._sessionSummary,
      stats: { skipped: true },
      compressed: false,
    };
  }

  /**
   * 发送事件
   * @private
   */
  _emit(name, payload) {
    if (this._eventBus && typeof this._eventBus.emit === "function") {
      this._eventBus.emit(name, { actor: "proactive-compressor", payload });
    }
  }
}

// ============================================================================
// 导出
// ============================================================================

export { PRESETS, autoSelectPreset };
export default ProactiveCompressor;
