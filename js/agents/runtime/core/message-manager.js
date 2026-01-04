/**
 * MessageManager - 消息和压缩管理
 *
 * 从 BaseAgentLoop 提取的职责：
 * - 消息存储和访问
 * - Token 计数
 * - 压缩调度和执行
 */

import { estimateTokenCount } from "../../shared/utils/value-utils.js";
import { getGlobalTokenCounter } from "../../shared/tokenizers/adaptive-token-counter.js";
import { CompressionCoordinator } from "../compression/coordinator.js";

// 默认上下文配置
const DEFAULT_CONTEXT_CONFIG = Object.freeze({
  contextWindow: 128000,
  maxOutputTokens: 4096,
  compressThreshold: 0.9,
  compressCooldownMs: 5000,
  keepLastTurns: 6,
  userMessageBuffer: 20000,
  titleOnlySummaryThreshold: 0.8,
  titleOnlySummaryMaxWords: 10,
  titleOnlySummaryMaxChars: 80,
  maxKeptMessageChars: 16000,
  useCompressionWorker: true,
  workerThresholdMessages: 50,
});

function estimateTokens(text, tokenCounter) {
  if (!text) return 0;
  if (tokenCounter && typeof tokenCounter.count === "function") {
    try {
      return tokenCounter.count(text);
    } catch {
      // fall back
    }
  }
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
  return estimateTokenCount(rawText);
}

export class MessageManager {
  constructor(options = {}) {
    this._messages = [];
    this._contextConfig = { ...DEFAULT_CONTEXT_CONFIG, ...options.contextConfig };
    this._tokenCounter = options.tokenCounter === null ? null : options.tokenCounter || getGlobalTokenCounter();
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

  get messages() {
    return this._messages;
  }

  get tokenUsage() {
    return { ...this._tokenUsage };
  }

  get contextConfig() {
    return { ...this._contextConfig };
  }

  setContextConfig(config) {
    this._contextConfig = { ...this._contextConfig, ...config };
    if (config && typeof config === "object" && Object.prototype.hasOwnProperty.call(config, "tokenCounter")) {
      const tc = config.tokenCounter;
      this._tokenCounter = tc === null ? null : tc || this._tokenCounter;
    }
  }

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

  _recalculateTokenUsage() {
    let total = 0;
    for (const msg of this._messages) {
      total += estimateTokens(msg.content, this._tokenCounter);
    }
    this._tokenUsage.input = total;
    this._tokenUsage.total = total;
  }

  _shouldCompress() {
    if (this._compressionCoordinator && typeof this._compressionCoordinator.shouldCompress === "function") {
      return this._compressionCoordinator.shouldCompress();
    }
    const { contextWindow, compressThreshold } = this._contextConfig;
    const threshold = contextWindow * compressThreshold;
    return this._tokenUsage.total >= threshold;
  }

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
          if (t && typeof t.unref === "function") {
            try {
              t.unref();
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
        .catch(() => {})
        .finally(() => {
          this._lastCompressionAtMs = Date.now();
          this._compressionPending = false;
          if (this._compressionPromise === done) this._compressionPromise = null;
          resolve?.();
        });
    });
  }

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
        .catch(() => {})
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

  _recordCompression(beforeCount, beforeTokens) {
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
}

export default MessageManager;
