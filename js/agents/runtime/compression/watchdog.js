/**
 * Watchdog - 健康监控器
 *
 * 职责：
 * 1. 监控 Agent 运行健康状态
 * 2. 检测异常（超时、死循环、资源耗尽）
 * 3. 检测逻辑震荡（重复输出相似内容）
 * 4. 触发干预
 *
 * 注意：子代理启动和交接文档已移至 TaskTool 和 CicadaCompressor
 */

import { WatchdogEvents } from "../events/events.js";
import { toNonEmptyString } from "../../shared/utils/value-utils.js";

/**
 * Simple fingerprint for output similarity detection.
 * Uses first/last chars + length to create a lightweight signature.
 */
function computeOutputFingerprint(text) {
  const s = typeof text === "string" ? text : String(text || "");
  const normalized = s.replace(/\s+/g, " ").trim();
  if (!normalized) return "empty";
  const len = normalized.length;
  const head = normalized.slice(0, 50);
  const tail = len > 100 ? normalized.slice(-50) : "";
  return `${len}:${head}:${tail}`;
}

/**
 * Jaccard similarity between two sets of tokens.
 */
function jaccardSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Tokenize text into a Set of n-grams for similarity comparison.
 */
function tokenize(text, n = 3) {
  const s = typeof text === "string" ? text : String(text || "");
  const normalized = s.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length < n) return new Set([normalized]);
  const tokens = new Set();
  for (let i = 0; i <= normalized.length - n; i++) {
    tokens.add(normalized.slice(i, i + n));
  }
  return tokens;
}

export class Watchdog {
  constructor({ eventBus, maxRecentOutputs = 5, oscillationThreshold = 0.85 } = {}) {
    this.eventBus = eventBus || null;
    this._observers = new Map();
    this._startTime = Date.now();
    this._iterationCount = 0;
    this._lastProgressTime = Date.now();

    // Logical oscillation detection
    this._recentOutputs = []; // Array of { fingerprint, tokens, timestamp }
    this._maxRecentOutputs = Math.max(2, Math.floor(maxRecentOutputs) || 5);
    this._oscillationThreshold = Math.min(1, Math.max(0, oscillationThreshold || 0.85));
    this._consecutiveSimilarCount = 0;
  }

  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, { actor: "watchdog", status: "info", payload });
    }
    const handlers = this._observers.get(name);
    if (handlers) {
      for (const handler of handlers) {
        handler(payload);
      }
    }
  }

  observe(eventName, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("Watchdog.observe: handler must be a function");
    }
    const name = toNonEmptyString(eventName);
    if (!name) {
      throw new Error("Watchdog.observe: eventName must be a non-empty string");
    }

    let set = this._observers.get(name);
    if (!set) {
      set = new Set();
      this._observers.set(name, set);
    }
    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0 && this._observers.get(name) === set) {
        this._observers.delete(name);
      }
    };
  }

  /**
   * 记录迭代进度
   */
  tick() {
    this._iterationCount++;
    this._lastProgressTime = Date.now();
  }

  /**
   * 记录输出内容用于逻辑震荡检测
   * @param {string} output - Agent 输出内容
   * @returns {{ similar: boolean, similarity: number }} 是否与前次输出相似
   */
  recordOutput(output) {
    const fingerprint = computeOutputFingerprint(output);
    const tokens = tokenize(output);
    const timestamp = Date.now();

    let maxSimilarity = 0;
    let isSimilar = false;

    // Compare with recent outputs
    for (const prev of this._recentOutputs) {
      // Quick check: exact fingerprint match
      if (prev.fingerprint === fingerprint) {
        maxSimilarity = 1;
        isSimilar = true;
        break;
      }
      // Detailed check: Jaccard similarity
      const sim = jaccardSimilarity(tokens, prev.tokens);
      if (sim > maxSimilarity) maxSimilarity = sim;
      if (sim >= this._oscillationThreshold) {
        isSimilar = true;
      }
    }

    // Update consecutive similar count
    if (isSimilar) {
      this._consecutiveSimilarCount++;
    } else {
      this._consecutiveSimilarCount = 0;
    }

    // Store this output
    this._recentOutputs.push({ fingerprint, tokens, timestamp });
    while (this._recentOutputs.length > this._maxRecentOutputs) {
      this._recentOutputs.shift();
    }

    return { similar: isSimilar, similarity: maxSimilarity };
  }

  /**
   * 检查健康状态
   * @param {Object} options - { maxIterations, maxTimeMs, stuckThresholdMs, oscillationConsecutiveThreshold }
   * @returns {Object} { healthy, issues }
   */
  checkHealth(options = {}) {
    const {
      maxIterations = 50,
      maxTimeMs = 600000, // 10 分钟
      stuckThresholdMs = 60000, // 1 分钟无进展
      oscillationConsecutiveThreshold = 3, // 连续 3 次相似输出视为震荡
    } = options;

    const issues = [];
    const elapsed = Date.now() - this._startTime;
    const timeSinceProgress = Date.now() - this._lastProgressTime;

    if (this._iterationCount >= maxIterations) {
      issues.push({ type: "max_iterations", value: this._iterationCount, threshold: maxIterations });
    }

    if (elapsed >= maxTimeMs) {
      issues.push({ type: "timeout", value: elapsed, threshold: maxTimeMs });
    }

    if (timeSinceProgress >= stuckThresholdMs) {
      issues.push({ type: "stuck", value: timeSinceProgress, threshold: stuckThresholdMs });
    }

    // Logical oscillation detection
    if (this._consecutiveSimilarCount >= oscillationConsecutiveThreshold) {
      issues.push({
        type: "oscillation",
        value: this._consecutiveSimilarCount,
        threshold: oscillationConsecutiveThreshold,
        message: "Agent producing repetitive similar outputs (possible logical loop)",
      });
    }

    const healthy = issues.length === 0;

    if (!healthy) {
      this._emit(WatchdogEvents.WATCHDOG_INTERVENTION || "watchdog.intervention", { issues });
    }

    return {
      healthy,
      issues,
      stats: {
        elapsed,
        iterationCount: this._iterationCount,
        timeSinceProgress,
        consecutiveSimilarOutputs: this._consecutiveSimilarCount,
      },
    };
  }

  /**
   * 触发干预
   */
  intervene(reason, options = {}) {
    const payload = { reason, options, timestamp: new Date().toISOString() };
    this._emit(WatchdogEvents.WATCHDOG_INTERVENTION || "watchdog.intervention", payload);
    return payload;
  }

  /**
   * 重置计时器和状态
   */
  reset() {
    this._startTime = Date.now();
    this._iterationCount = 0;
    this._lastProgressTime = Date.now();
    this._recentOutputs = [];
    this._consecutiveSimilarCount = 0;
  }
}

export default Watchdog;
