/**
 * MessageManager - 消息和压缩管理
 *
 * 从 BaseAgentLoop 提取的职责：
 * - 消息存储和访问
 * - Token 计数
 * - 压缩调度和执行
 */

import { estimateTokensCached } from "../../shared/utils/token-cache.js";
import { createLogger } from "../../shared/utils/logger.js";
import { getGlobalTokenCounter } from "../../shared/tokenizers/adaptive-token-counter.js";
import { CompressionCoordinator } from "../compression/coordinator.js";
import { DEFAULT_CONTEXT_CONFIG } from "./context-config.js";
import { wrapPersistedOutput, cleanOldPersistedOutputs, KEEP_RECENT_OUTPUTS } from "./persisted-output.js";

const fallbackLogger = createLogger("runtime/core/message-manager");

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
 * @typedef {{ role?: string, content?: any, [key: string]: any }} ChatMessage
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
 */

/**
 * @param {unknown} text
 * @param {TokenCounterLike | null | undefined} tokenCounter
 * @returns {number}
 */
function estimateTokens(text, tokenCounter) {
  if (text === null || text === undefined) return 0;
  let rawText = "";
  if (typeof text === "string") {
    rawText = text;
  } else {
    try {
      rawText = JSON.stringify(text);
    } catch {
      rawText = String(text);
    }
  }
  return estimateTokensCached(rawText, tokenCounter);
}

export class MessageManager {
  /**
   * @param {MessageManagerOptions} [options]
   */
  constructor(options = {}) {
    this._messages = [];
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
    this._logger = options.logger || null;
    this._emit = options.emit || null;
    this._stageName = options.stageName || "agent";
    this._actor = options.actor || "agent";
  }

  /** @returns {ChatMessage[]} */
  get messages() {
    return this._messages;
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
    this._messages.push(message);
    const messageTokens = estimateTokens(message.content, this._tokenCounter);
    this._tokenUsage.input += messageTokens;
    this._tokenUsage.total += messageTokens;

    if (this._shouldCompress()) {
      this._scheduleCompression();
    }

    return message;
  }

  /** @param {ChatMessage[]} messages */
  addMessages(messages) {
    let addedTokens = 0;
    for (const msg of messages) {
      this._messages.push(msg);
      addedTokens += estimateTokens(msg.content, this._tokenCounter);
    }
    this._tokenUsage.input += addedTokens;
    this._tokenUsage.total += addedTokens;

    if (this._shouldCompress()) {
      this._scheduleCompression();
    }
  }

  /** @param {{ clearCompressionHistory?: boolean } | null | undefined} [options] */
  async reset(options = {}) {
    const clearHistory = options?.clearCompressionHistory !== false;

    try {
      await this.flushCompression({ maxRounds: 0 });
    } catch {
      // ignore
    }

    this._clearCooldownTimer();
    this._messages = [];
    this._tokenUsage = { input: 0, output: 0, total: 0 };
    this._compressionPending = false;
    this._compressionPromise = null;
    this._lastCompressionAtMs = 0;
    if (clearHistory) this._compressionHistory = [];
  }

  /** @returns {void} */
  _recalculateTokenUsage() {
    let total = 0;
    for (const msg of this._messages) {
      total += estimateTokens(msg.content, this._tokenCounter);
    }
    this._tokenUsage.input = total;
    this._tokenUsage.total = total;
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

  /** @param {{ force?: boolean } | null | undefined} [options] */
  _scheduleCompression({ force = false } = {}) {
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
            if (this._shouldCompress()) this._scheduleCompression({ force: true });
          }, waitMs);
          const maybeTimer = /** @type {any} */ (t);
          if (maybeTimer && typeof maybeTimer.unref === "function") {
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
    const maxRoundsRaw = typeof options?.maxRounds === "number" && Number.isFinite(options.maxRounds) ? options.maxRounds : 2;
    const maxRounds = Math.max(0, Math.floor(maxRoundsRaw));

    if (this._compressionPromise) {
      try {
        await this._compressionPromise;
      } catch { /* intentional: ignore previous compression errors */ }
    }

    this._clearCooldownTimer();
    let rounds = 0;
    while (this._shouldCompress() && rounds < maxRounds) {
      rounds += 1;
      this._compressionPending = true;
      const p = Promise.resolve()
        .then(() => this._compress())
        .catch((err) => {
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
    const beforeCount = this._messages.length;
    const beforeTokens = this._tokenUsage.total;
    if (!this._compressionCoordinator || typeof this._compressionCoordinator.maybeCompress !== "function") {
      return;
    }

    const result = await this._compressionCoordinator.maybeCompress(this._messages);
    if (result && Array.isArray(result.messages)) {
      this._messages = result.messages;
    }

    this._recalculateTokenUsage();
    this._recordCompression(beforeCount, beforeTokens);
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
  }
}

export default MessageManager;
