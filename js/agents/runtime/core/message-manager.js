/**
 * MessageManager - 消息和压缩管理
 *
 * 从 BaseAgentLoop 提取的职责：
 * - 消息存储和访问
 * - Token 计数
 * - 压缩调度和执行
 * - 异步摘要预生成（用于主动压缩）
 */

import { createLogger } from "../../shared/index.js";
import { getGlobalTokenCounter } from "../../shared/index.js";
import { CompressionCoordinator } from "../../plugins/compression/index.js";
import { DEFAULT_CONTEXT_CONFIG } from "./context-config.js";
import { wrapPersistedOutput, cleanOldPersistedOutputs, KEEP_RECENT_OUTPUTS } from "./persisted-output.js";
import { createScopedReporter, ErrorCategory } from "./errors/silent-error-reporter.js";
import {
  estimateTokens,
  computeContentHash,
  isAbortError,
  shouldGenerateSummary,
  isThinkingMessage,
  generateBuiltinSummary,
} from "./message-manager-helpers.js";

const fallbackLogger = createLogger("runtime/core/message-manager");
const silentReporter = createScopedReporter("MessageManager");

/**
 * @typedef {Record<string, any>} AnyRecord
 *
 * @typedef {{ warn?: (...args: any[]) => void, info?: (...args: any[]) => void, error?: (...args: any[]) => void, debug?: (...args: any[]) => void }} LoggerLike
 *
 * @typedef {(eventName: string, record: { actor?: string, status?: string, payload?: any }) => void} EmitFn
 *
 * @typedef {{ count: (text: string) => number }} TokenCounterLike
 *
 * @typedef {object} ContextConfig
 * @property {number} contextWindow
 * @property {number} compressThreshold
 * @property {number} [compressCooldownMs]
 * @property {TokenCounterLike | null} [tokenCounter]
 *
 * @typedef {"minor"|"major"|"critical"} DMailSeverity
 *
 * @typedef {object} DMailSupersedeRange
 * @property {number|null} from
 * @property {number|null} to
 *
 * @typedef {object} DMailSignal
 * @property {string} correction
 * @property {DMailSupersedeRange|null} supersedeRange
 * @property {DMailSeverity} severity
 * @property {number} timestamp
 *
 * @typedef {{ role?: string, content?: any, type?: string, _dmail?: DMailSignal, _superseded?: boolean, _supersededBy?: string, [key: string]: any }} ChatMessage
 *
 * @typedef {object} DMailCorrectionMessage
 * @property {"system"} role
 * @property {"dmail_correction"} type
 * @property {string} content
 * @property {DMailSignal} _dmail
 *
 * @typedef {object} ActiveMessageOptions
 * @property {boolean} [includeSuperseded]
 *
 * @typedef {{ input: number, output: number, total: number }} TokenUsage
 *
 * @typedef {object} CompressionRecord
 * @property {number} timestamp
 * @property {number} beforeCount
 * @property {number} afterCount
 * @property {number} beforeTokens
 * @property {number} afterTokens
 *
 * @typedef {object} MessageManagerOptions
 * @property {Partial<ContextConfig> | null} [contextConfig]
 * @property {TokenCounterLike | null} [tokenCounter]
 * @property {LoggerLike | null} [logger]
 * @property {EmitFn | null} [emit]
 * @property {string} [stageName]
 * @property {string} [actor]
 * @property {boolean} [asyncSummaryEnabled] - 是否启用异步摘要预生成
 * @property {(message: ChatMessage) => Promise<string|null>} [summaryGenerator] - 自定义摘要生成器
 */

export class MessageManager {
  /**
   * @param {MessageManagerOptions} [options]
   */
  constructor(options = {}) {
    this._messages = [];
    this._disposed = false;
    this._contextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...options.contextConfig };
    this._tokenCounter = options.tokenCounter === null ? null : options.tokenCounter || getGlobalTokenCounter();
    /** @type {TokenUsage} */
    this._tokenUsage = { input: 0, output: 0, total: 0 };
    this._compressionCoordinator = new CompressionCoordinator({
      getContextConfig: () => this._contextConfig,
      getTokenUsage: () => this._tokenUsage,
      logger: options.logger,
    });
    this._compressionPending = false;
    this._compressionPromise = null;
    this._compressionHistory = [];
    this._lastCompressionAtMs = 0;
    this._compressionCooldownTimer = null;
    this._compressionAbortController = null;
    this._logger = options.logger || null;
    this._emit = options.emit || null;
    this._stageName = options.stageName || "agent";
    this._actor = options.actor || "agent";

    // 异步摘要预生成配置
    this._asyncSummaryEnabled = options.asyncSummaryEnabled !== false;
    this._summaryGenerator = options.summaryGenerator || null;
    /** @type {WeakSet<ChatMessage>} 已触发异步摘要的消息 */
    this._pendingSummaries = new WeakSet();
    /** @type {Map<string, Promise<void>>} 进行中的摘要 Promise，用于压缩前等待 */
    this._pendingSummaryPromises = new Map();
    /** @type {AbortController|null} 摘要生成的取消控制器 */
    this._summaryAbortController = null;
    /** @type {number} 摘要 ID 计数器 */
    this._summaryIdCounter = 0;
    /** @type {number} superseded message count */
    this._supersededCount = 0;
  }

  /** @returns {ChatMessage[]} */
  get messages() {
    return this._messages;
  }

  /** @returns {number} */
  get supersededCount() {
    return this._supersededCount;
  }

  /** @returns {TokenUsage} */
  get tokenUsage() {
    return { ...this._tokenUsage };
  }

  /** @returns {ContextConfig} */
  get contextConfig() {
    return { ...this._contextConfig };
  }

  /** @param {Partial<ContextConfig>} config */
  setContextConfig(config) {
    this._contextConfig = { ...this._contextConfig, ...config };
    if (config && typeof config === "object" && Object.prototype.hasOwnProperty.call(config, "tokenCounter")) {
      const tc = config.tokenCounter;
      this._tokenCounter = tc === null ? null : tc || this._tokenCounter;
    }
  }

  /** @param {ChatMessage} message @returns {ChatMessage} */
  addMessage(message) {
    if (this._disposed) return message;
    this._messages.push(message);
    if (message && typeof message === "object" && message._superseded === true) {
      this._supersededCount += 1;
    }
    const messageTokens = estimateTokens(message.content, this._tokenCounter);
    this._cacheTokenCount(message, messageTokens); // 缓存 token 数 + hash
    this._tokenUsage.input += messageTokens;
    this._tokenUsage.total += messageTokens;

    // 异步摘要预生成（不阻塞主流程）
    if (this._asyncSummaryEnabled && this._shouldGenerateSummary(message)) {
      this._scheduleAsyncSummary(message);
    }

    if (this._shouldCompress()) {
      this._scheduleCompression();
    }

    return message;
  }

  /** @param {ChatMessage[]} messages */
  addMessages(messages) {
    if (this._disposed) return;
    let addedTokens = 0;
    let addedSuperseded = 0;
    for (const msg of messages) {
      this._messages.push(msg);
      if (msg && typeof msg === "object" && msg._superseded === true) {
        addedSuperseded += 1;
      }
      addedTokens += estimateTokens(msg.content, this._tokenCounter);
    }
    this._tokenUsage.input += addedTokens;
    this._tokenUsage.total += addedTokens;
    this._supersededCount += addedSuperseded;

    if (this._shouldCompress()) {
      this._scheduleCompression();
    }
  }

  /**
   * Mark a range of messages as superseded (inclusive).
   * @param {number} fromIndex
   * @param {number} toIndex
   * @param {string} correction
   * @returns {number} count of newly superseded messages
   */
  markAsSuperseded(fromIndex, toIndex, correction) {
    if (this._disposed) return 0;
    const correctionText = typeof correction === "string" ? correction : "";
    if (correctionText.trim().length === 0) {
      const logger = this._logger && typeof this._logger.warn === "function" ? this._logger : fallbackLogger;
      logger.warn("markAsSuperseded called with empty correction");
      return 0;
    }

    const total = this._messages.length;
    if (total === 0) return 0;

    const startRaw = Number.isFinite(fromIndex) ? Math.floor(fromIndex) : null;
    const endRaw = Number.isFinite(toIndex) ? Math.floor(toIndex) : startRaw;
    if (startRaw === null || endRaw === null) return 0;

    let start = Math.min(startRaw, endRaw);
    let end = Math.max(startRaw, endRaw);

    if (end < 0 || start >= total) return 0;
    if (start < 0) start = 0;
    if (end >= total) end = total - 1;

    let marked = 0;
    for (let i = start; i <= end; i += 1) {
      const msg = this._messages[i];
      if (!msg || typeof msg !== "object") continue;
      if (msg._superseded === true) {
        if (msg._supersededBy === undefined) msg._supersededBy = correctionText;
        continue;
      }
      msg._superseded = true;
      msg._supersededBy = correctionText;
      marked += 1;
    }

    this._supersededCount += marked;
    return marked;
  }

  /**
   * Insert a D-Mail correction message into history.
   * @param {DMailSignal} dmailSignal
   * @returns {ChatMessage}
   */
  insertCorrectionMessage(dmailSignal) {
    const correction = dmailSignal && typeof dmailSignal.correction === "string"
      ? dmailSignal.correction
      : String(dmailSignal?.correction ?? "");
    /** @type {DMailCorrectionMessage} */
    const message = {
      role: "system",
      type: "dmail_correction",
      content: correction,
      _dmail: dmailSignal,
    };
    return this.addMessage(message);
  }

  /**
   * Get messages for prompt building, optionally including superseded ones.
   * @param {ActiveMessageOptions} [options]
   * @returns {ChatMessage[]}
   */
  getActiveMessages(options = {}) {
    const includeSuperseded = options?.includeSuperseded === true;
    if (includeSuperseded) return this._messages.slice();
    return this._messages.filter((msg) => !(msg && typeof msg === "object" && msg._superseded === true));
  }

  /** @param {{ clearCompressionHistory?: boolean } | null | undefined} [options] */
  async reset(options = {}) {
    const clearHistory = options?.clearCompressionHistory !== false;

    try {
      await this.flushCompression({ maxRounds: 0 });
    } catch (e) {
      silentReporter.report(e, "reset.flushCompression");
    }

    this._clearCooldownTimer();
    this._messages = [];
    this._tokenUsage = { input: 0, output: 0, total: 0 };
    this._supersededCount = 0;
    this._compressionPending = false;
    this._compressionPromise = null;
    this._lastCompressionAtMs = 0;
    if (clearHistory) this._compressionHistory = [];

    // 清理摘要追踪（不取消，等待自然完成后 Map 自动清空）
    this._abortPendingSummaries("reset");
    this._pendingSummaries = new WeakSet();
  }

  /** @returns {void} */
  _recalculateTokenUsage() {
    let total = 0;
    for (const msg of this._messages) {
      // 优先使用缓存（带 hash 验证），未命中则重新计算
      const cached = this._getCachedTokenCount(msg);
      if (cached !== undefined) {
        total += cached;
      } else {
        const tokens = estimateTokens(msg.content, this._tokenCounter);
        this._cacheTokenCount(msg, tokens);
        total += tokens;
      }
    }
    this._tokenUsage.input = total;
    this._tokenUsage.total = total;
  }

  /** @returns {void} */
  _recalculateSupersededCount() {
    let count = 0;
    for (const msg of this._messages) {
      if (msg && typeof msg === "object" && msg._superseded === true) {
        count += 1;
      }
    }
    this._supersededCount = count;
  }

  // ==========================================================================
  // Token 缓存（基于内容 hash 的失效机制）
  // ==========================================================================

  /** @private @param {unknown} content @returns {number} */
  _computeContentHash(content) {
    return computeContentHash(content);
  }

  /**
   * 缓存消息的 token 计数，附带内容 hash
   * @private
   * @param {ChatMessage} message
   * @param {number} count
   */
  _cacheTokenCount(message, count) {
    message._tokens = count;
    message._contentHash = this._computeContentHash(message.content);
  }

  /**
   * 获取缓存的 token 计数（验证 hash 是否匹配）
   * @private
   * @param {ChatMessage} message
   * @returns {number | undefined} - 缓存有效返回 token 数，否则 undefined
   */
  _getCachedTokenCount(message) {
    if (message._tokens !== undefined && message._contentHash !== undefined) {
      const currentHash = this._computeContentHash(message.content);
      if (currentHash === message._contentHash) {
        return message._tokens;
      }
    }
    return undefined;
  }

  /** @returns {boolean} */
  _shouldCompress() {
    if (this._compressionCoordinator && typeof this._compressionCoordinator.shouldCompress === "function") {
      return this._compressionCoordinator.shouldCompress();
    }
    const { contextWindow, compressThreshold } = this._contextConfig;
    const threshold = contextWindow * compressThreshold;
    return this._tokenUsage.total >= threshold;
  }

  /** @returns {void} */
  _clearCooldownTimer() {
    if (!this._compressionCooldownTimer) return;
    try {
      clearTimeout(this._compressionCooldownTimer);
    } catch {
      // ignore
    } finally {
      this._compressionCooldownTimer = null;
    }
  }

  /** @param {string} [reason] */
  _abortActiveCompression(reason = "aborted") {
    const controller = this._compressionAbortController;
    if (!controller) return;
    try {
      controller.abort(reason);
    } catch {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    } finally {
      if (this._compressionAbortController === controller) {
        this._compressionAbortController = null;
      }
    }
  }

  /** @param {any} err @returns {boolean} */
  _isAbortError(err) {
    return isAbortError(err);
  }

  /** @param {{ force?: boolean } | null | undefined} [options] */
  _scheduleCompression({ force = false } = {}) {
    if (this._disposed) return;
    if (this._compressionPending) return;

    const cooldownRaw = this._contextConfig?.compressCooldownMs;
    const cooldownMs = Number.isFinite(Number(cooldownRaw)) ? Math.max(0, Math.floor(Number(cooldownRaw))) : 0;
    const now = Date.now();
    if (!force && cooldownMs > 0 && this._lastCompressionAtMs > 0) {
      const elapsed = now - this._lastCompressionAtMs;
      if (elapsed >= 0 && elapsed < cooldownMs) {
        if (!this._compressionCooldownTimer) {
          const waitMs = Math.max(0, cooldownMs - elapsed);
          const t = setTimeout(() => {
            this._compressionCooldownTimer = null;
            if (this._disposed) return;
            if (this._shouldCompress()) this._scheduleCompression({ force: true });
          }, waitMs);
          const maybeTimer = /** @type {number | { unref?: () => void }} */ (t);
          if (typeof maybeTimer === "object" && maybeTimer && typeof maybeTimer.unref === "function") {
            try {
              maybeTimer.unref();
            } catch {
              // ignore
            }
          }
          this._compressionCooldownTimer = t;
        }
        return;
      }
    }

    this._clearCooldownTimer();
    this._compressionPending = true;

    let resolve = null;
    const done = new Promise((r) => {
      resolve = r;
    });
    this._compressionPromise = done;

    queueMicrotask(() => {
      Promise.resolve()
        .then(() => this._compress())
        .catch((err) => {
          if (this._disposed || this._isAbortError(err)) return;
          const logger = this._logger && typeof this._logger.warn === "function" ? this._logger : fallbackLogger;
          logger.warn("Message compression error", { error: String(err?.message || err) });
        })
        .finally(() => {
          this._lastCompressionAtMs = Date.now();
          this._compressionPending = false;
          if (this._compressionPromise === done) this._compressionPromise = null;
          resolve?.();
        });
    });
  }

  /** @param {{ maxRounds?: number } | null | undefined} [options] */
  async flushCompression(options = {}) {
    if (this._disposed) return;
    const maxRoundsRaw = typeof options?.maxRounds === "number" && Number.isFinite(options.maxRounds) ? options.maxRounds : 2;
    const maxRounds = Math.max(0, Math.floor(maxRoundsRaw));

    if (this._compressionPromise) {
      try {
        await this._compressionPromise;
      } catch { /* intentional: ignore previous compression errors */ }
    }

    this._clearCooldownTimer();
    let rounds = 0;
    while (!this._disposed && this._shouldCompress() && rounds < maxRounds) {
      rounds += 1;
      this._compressionPending = true;
      const p = Promise.resolve()
        .then(() => this._compress())
        .catch((err) => {
          if (this._disposed || this._isAbortError(err)) return;
          const logger = this._logger && typeof this._logger.warn === "function" ? this._logger : fallbackLogger;
          logger.warn("Message compression error", { error: String(err?.message || err) });
        })
        .finally(() => {
          this._lastCompressionAtMs = Date.now();
          this._compressionPending = false;
        });
      this._compressionPromise = p;
      try {
        await p;
      } catch { /* intentional: compression errors handled in finally */ }
      if (this._compressionPromise === p) this._compressionPromise = null;
    }
  }

  /** @returns {Promise<void>} */
  async _compress() {
    this._clearCooldownTimer();
    if (this._disposed) return;

    // 等待所有进行中的摘要完成，确保压缩时摘要已生成
    await this._waitForPendingSummaries();

    if (this._disposed) return;
    const beforeCount = this._messages.length;
    const beforeTokens = this._tokenUsage.total;
    if (!this._compressionCoordinator || typeof this._compressionCoordinator.maybeCompress !== "function") {
      return;
    }

    this._abortActiveCompression("superseded");
    const controller = new AbortController();
    this._compressionAbortController = controller;
    try {
      const result = await this._compressionCoordinator.maybeCompress(this._messages, { signal: controller.signal });
      if (this._disposed || controller.signal.aborted) return;
      if (result && Array.isArray(result.messages)) {
        this._messages = result.messages;
      }

      this._recalculateTokenUsage();
      this._recalculateSupersededCount();
      this._recordCompression(beforeCount, beforeTokens);
    } finally {
      if (this._compressionAbortController === controller) {
        this._compressionAbortController = null;
      }
    }
  }

  /**
   * 等待所有进行中的摘要生成完成
   * @private
   * @returns {Promise<void>}
   */
  async _waitForPendingSummaries() {
    if (this._pendingSummaryPromises.size === 0) return;
    const promises = Array.from(this._pendingSummaryPromises.values());
    try {
      await Promise.all(promises);
    } catch (e) {
      silentReporter.report(e, "_waitForPendingSummaries");
    }
  }

  /**
   * @param {number} beforeCount
   * @param {number} beforeTokens
   */
  _recordCompression(beforeCount, beforeTokens) {
    /** @type {CompressionRecord} */
    const record = {
      timestamp: Date.now(),
      beforeCount,
      afterCount: this._messages.length,
      beforeTokens,
      afterTokens: this._tokenUsage.total,
    };
    this._compressionHistory.push(record);

    if (typeof this._emit === "function") {
      this._emit(`${this._stageName}.context.compressed`, {
        actor: this._actor,
        status: "info",
        payload: record,
      });
    }
  }

  /** @returns {AnyRecord} */
  getStatus() {
    const { contextWindow, compressThreshold } = this._contextConfig;
    return {
      messageCount: this._messages.length,
      tokenUsage: { ...this._tokenUsage },
      contextWindow,
      fillRatio: this._tokenUsage.total / contextWindow,
      compressThreshold,
      needsCompression: this._shouldCompress(),
      compressionPending: !!this._compressionPending,
      compressionCount: this._compressionHistory.length,
    };
  }

  /**
   * 处理工具输出，大输出自动包装为持久化格式
   * @param {string} content - 工具输出内容
   * @param {object} [options]
   * @param {number} [options.threshold] - 大小阈值
   * @returns {string} - 处理后的内容
   */
  wrapToolOutput(content, options) {
    return wrapPersistedOutput(content, options);
  }

  /**
   * 清理旧的持久化输出，保留最近 N 个
   * @param {number} [keepRecent] - 保留数量
   */
  cleanOldOutputs(keepRecent = KEEP_RECENT_OUTPUTS) {
    this._messages = cleanOldPersistedOutputs(this._messages, keepRecent);
    this._recalculateTokenUsage();
    this._recalculateSupersededCount();
  }

  // ==========================================================================
  // 异步摘要预生成
  // ==========================================================================

  /**
   * 判断消息是否需要预生成摘要
   * @private
   * @param {ChatMessage} message
   * @returns {boolean}
   */
  _shouldGenerateSummary(message) {
    return shouldGenerateSummary(message, this._pendingSummaries, this._isThinkingMessage.bind(this));
  }

  /**
   * 检测是否为 thinking 消息
   * @private
   * @param {ChatMessage} message
   * @returns {boolean}
   */
  _isThinkingMessage(message) {
    return isThinkingMessage(message);
  }

  /**
   * 异步生成摘要（不阻塞主流程）
   * @private
   * @param {ChatMessage} message
   */
  _scheduleAsyncSummary(message) {
    if (this._disposed) return;
    this._pendingSummaries.add(message);

    // 生成唯一 ID 用于追踪
    const summaryId = String(++this._summaryIdCounter);

    // 确保有 AbortController
    if (!this._summaryAbortController) {
      this._summaryAbortController = new AbortController();
    }
    const signal = this._summaryAbortController.signal;

    // 创建可追踪的 Promise
    const summaryPromise = Promise.resolve().then(async () => {
      if (this._disposed || signal.aborted) return;
      try {
        await this._generateSummaryAsync(message, signal);
      } catch (e) {
        silentReporter.report(e, "_scheduleSummaryGeneration");
      } finally {
        // 完成后从 Map 移除
        this._pendingSummaryPromises.delete(summaryId);
      }
    });

    this._pendingSummaryPromises.set(summaryId, summaryPromise);
  }

  /**
   * 异步生成摘要
   * @private
   * @param {ChatMessage} message
   * @param {AbortSignal} [signal]
   * @returns {Promise<void>}
   */
  async _generateSummaryAsync(message, signal) {
    if (this._disposed || message._summary || signal?.aborted) return;

    const startMs = Date.now();
    const messageHash = computeContentHash(message);

    // P1: Emit summary start event
    if (this._emit) {
      try {
        this._emit("context:summary:start", {
          actor: this._actor,
          status: "started",
          payload: { messageHash, stageName: this._stageName },
        });
      } catch {
        // ignore
      }
    }

    try {
      let summary = null;

      // 优先使用自定义生成器
      if (typeof this._summaryGenerator === "function") {
        summary = await this._summaryGenerator(message);
        if (signal?.aborted) return; // 生成后检查是否已取消
      } else {
        // 内置摘要生成
        summary = this._generateBuiltinSummary(message);
      }

      if (summary && !message._summary && !signal?.aborted) {
        message._summary = summary;
        message._summaryTokens = estimateTokens(summary, this._tokenCounter);

        // P1: Emit summary success event
        if (this._emit) {
          try {
            const durationMs = Date.now() - startMs;
            this._emit("context:summary:success", {
              actor: this._actor,
              status: "completed",
              payload: { messageHash, durationMs, stageName: this._stageName },
            });
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      // P1: Emit summary failure event
      if (this._emit) {
        try {
          const durationMs = Date.now() - startMs;
          this._emit("context:summary:failed", {
            actor: this._actor,
            status: "failed",
            payload: { messageHash, durationMs, error: e?.message || String(e), stageName: this._stageName },
          });
        } catch {
          // ignore
        }
      }
      silentReporter.report(e, "_generateSummaryAsync");
    }
  }

  /**
   * 内置摘要生成（快速，无 LLM 调用）
   * @private
   * @param {ChatMessage} message
   * @returns {string|null}
   */
  _generateBuiltinSummary(message) {
    return generateBuiltinSummary(message, this._isThinkingMessage.bind(this));
  }

  /**
   * 设置自定义摘要生成器
   * @param {(message: ChatMessage) => Promise<string|null>} generator
   */
  setSummaryGenerator(generator) {
    this._summaryGenerator = generator;
  }

  /**
   * 启用/禁用异步摘要
   * @param {boolean} enabled
   */
  setAsyncSummaryEnabled(enabled) {
    this._asyncSummaryEnabled = enabled;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    this._clearCooldownTimer();
    this._abortActiveCompression("disposed");
    this._abortPendingSummaries("disposed");
    this._compressionPending = false;
  }

  /**
   * 取消所有进行中的摘要生成
   * @private
   * @param {string} [reason]
   */
  _abortPendingSummaries(reason = "aborted") {
    // 取消摘要生成
    if (this._summaryAbortController) {
      try {
        this._summaryAbortController.abort(reason);
      } catch {
        try {
          this._summaryAbortController.abort();
        } catch {
          // ignore
        }
      }
      this._summaryAbortController = null;
    }
    // 清空追踪 Map（Promise 会自行完成或被取消）
    this._pendingSummaryPromises.clear();
  }
}

export default MessageManager;
