/**
 * Behavior Fingerprint - 行为指纹与循环检测
 *
 * 特性：
 * - 工具调用序列指纹
 * - 循环模式检测
 * - 重复行为预警
 */

import { createLogger } from "../../shared/index.js";

const logger = createLogger("runtime/analysis/behavior-fingerprint");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_HISTORY_SIZE = 100;
const DEFAULT_MIN_PATTERN_LENGTH = 2;
const DEFAULT_MAX_PATTERN_LENGTH = 10;
const DEFAULT_LOOP_THRESHOLD = 3; // 重复 3 次认为是循环

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 计算字符串哈希
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * 创建行为签名
 * @param {object} action - Action payload to fingerprint.
 * @returns {string}
 */
function createActionSignature(action) {
  const type = action.type || action.name || "unknown";
  const params = action.params || action.args || {};

  // 只保留关键参数的结构（不含具体值）
  const paramKeys = Object.keys(params).sort().join(",");

  return `${type}:${paramKeys}`;
}

/**
 * 检测重复子序列
 * @param {string[]} sequence - Sequence of action signatures.
 * @param {number} minLength - Minimum pattern length.
 * @param {number} maxLength - Maximum pattern length.
 * @returns {Array<{ pattern: string[], count: number, positions: number[] }>}
 */
function findRepeatingPatterns(sequence, minLength, maxLength) {
  const patterns = [];

  for (let len = minLength; len <= maxLength && len <= sequence.length / 2; len++) {
    const seen = new Map(); // pattern hash -> { pattern, positions }

    for (let i = 0; i <= sequence.length - len; i++) {
      const subseq = sequence.slice(i, i + len);
      const hash = hashString(subseq.join("|"));

      if (!seen.has(hash)) {
        seen.set(hash, { pattern: subseq, positions: [i] });
      } else {
        const entry = seen.get(hash);
        // 验证实际相等（避免哈希碰撞）
        if (entry.pattern.join("|") === subseq.join("|")) {
          entry.positions.push(i);
        }
      }
    }

    // 只保留重复次数 >= 2 的模式
    for (const [, entry] of seen) {
      if (entry.positions.length >= 2) {
        patterns.push({
          pattern: entry.pattern,
          count: entry.positions.length,
          positions: entry.positions,
        });
      }
    }
  }

  // 按重复次数和长度排序（优先长模式）
  patterns.sort((a, b) => {
    const countDiff = b.count - a.count;
    if (countDiff !== 0) return countDiff;
    return b.pattern.length - a.pattern.length;
  });

  return patterns;
}

/**
 * 检测连续重复（紧邻循环）
 * @param {string[]} sequence
 * @param {number} minLength
 * @param {number} maxLength
 * @returns {Array<{ pattern: string[], consecutiveCount: number, startPos: number }>}
 */
function findConsecutiveLoops(sequence, minLength, maxLength) {
  const loops = [];

  for (let len = minLength; len <= maxLength && len <= sequence.length / 2; len++) {
    let i = 0;

    while (i <= sequence.length - len * 2) {
      const pattern = sequence.slice(i, i + len);
      let consecutiveCount = 1;

      // 检查后续是否连续重复
      let j = i + len;
      while (j + len <= sequence.length) {
        const next = sequence.slice(j, j + len);
        if (pattern.join("|") === next.join("|")) {
          consecutiveCount++;
          j += len;
        } else {
          break;
        }
      }

      if (consecutiveCount >= 2) {
        loops.push({
          pattern,
          consecutiveCount,
          startPos: i,
        });
        i = j; // 跳过已匹配的部分
      } else {
        i++;
      }
    }
  }

  // 按连续次数排序
  loops.sort((a, b) => b.consecutiveCount - a.consecutiveCount);

  return loops;
}

// ─────────────────────────────────────────────────────────────────────────────
// BehaviorFingerprint
// ─────────────────────────────────────────────────────────────────────────────

export class BehaviorFingerprint {
  /**
   * @param {object} options
   * @param {number} [options.historySize=100] - 历史记录大小
   * @param {number} [options.minPatternLength=2] - 最小模式长度
   * @param {number} [options.maxPatternLength=10] - 最大模式长度
   * @param {number} [options.loopThreshold=3] - 循环阈值
   * @param {function} [options.onLoopDetected] - 循环检测回调
   */
  constructor({
    historySize = DEFAULT_HISTORY_SIZE,
    minPatternLength = DEFAULT_MIN_PATTERN_LENGTH,
    maxPatternLength = DEFAULT_MAX_PATTERN_LENGTH,
    loopThreshold = DEFAULT_LOOP_THRESHOLD,
    onLoopDetected,
  } = {}) {
    this._historySize = Math.max(10, historySize);
    this._minPatternLength = Math.max(2, minPatternLength);
    this._maxPatternLength = Math.max(minPatternLength, maxPatternLength);
    this._loopThreshold = Math.max(2, loopThreshold);
    this._onLoopDetected = typeof onLoopDetected === "function" ? onLoopDetected : null;

    /** @type {Array<{ signature: string, action: object, ts: number }>} */
    this._history = [];
    this._loopCount = 0;
    this._lastLoopPattern = null;
  }

  /**
   * 记录行为
   * @param {object} action
   * @returns {{ loopDetected: boolean, loopInfo: object|null }}
   */
  recordAction(action) {
    const safeAction = action && typeof action === "object" ? action : {};
    const signature = createActionSignature(safeAction);

    this._history.push({
      signature,
      action: safeAction,
      ts: Date.now(),
    });

    // 保持历史大小
    while (this._history.length > this._historySize) {
      this._history.shift();
    }

    // 检测循环
    return this._detectLoop();
  }

  /**
   * 检测循环
   * @private
   */
  _detectLoop() {
    const signatures = this._history.map((h) => h.signature);

    // 检测连续循环
    const consecutiveLoops = findConsecutiveLoops(
      signatures,
      this._minPatternLength,
      this._maxPatternLength
    );

    // 找到超过阈值的循环
    const criticalLoop = consecutiveLoops.find(
      (loop) => loop.consecutiveCount >= this._loopThreshold
    );

    if (criticalLoop) {
      this._loopCount++;
      this._lastLoopPattern = criticalLoop;

      const loopInfo = {
        pattern: criticalLoop.pattern,
        count: criticalLoop.consecutiveCount,
        startPosition: criticalLoop.startPos,
        totalLoopsDetected: this._loopCount,
      };

      logger.warn("Loop detected", loopInfo);

      if (this._onLoopDetected) {
        this._onLoopDetected(loopInfo);
      }

      return { loopDetected: true, loopInfo };
    }

    return { loopDetected: false, loopInfo: null };
  }

  /**
   * 获取行为分析
   * @returns {{ totalActions: number, uniqueActions: number, diversityScore: number, actionFrequency: Record<string, number>, repeatingPatterns: Array<{ pattern: string[], count: number, positions: number[] }>, consecutiveLoops: Array<{ pattern: string[], consecutiveCount: number, startPos: number }>, loopCount: number, lastLoopPattern: object|null }}
   */
  getAnalysis() {
    const signatures = this._history.map((h) => h.signature);

    // 统计各行为频率
    const actionFreq = new Map();
    for (const sig of signatures) {
      actionFreq.set(sig, (actionFreq.get(sig) || 0) + 1);
    }

    // 找到重复模式
    const patterns = findRepeatingPatterns(
      signatures,
      this._minPatternLength,
      this._maxPatternLength
    );

    // 找到连续循环
    const loops = findConsecutiveLoops(
      signatures,
      this._minPatternLength,
      this._maxPatternLength
    );

    // 计算多样性分数
    const uniqueActions = actionFreq.size;
    const totalActions = signatures.length;
    const diversityScore = totalActions > 0 ? uniqueActions / totalActions : 1;

    return {
      totalActions,
      uniqueActions,
      diversityScore,
      actionFrequency: Object.fromEntries(actionFreq),
      repeatingPatterns: patterns.slice(0, 5), // 前 5 个
      consecutiveLoops: loops.slice(0, 5),
      loopCount: this._loopCount,
      lastLoopPattern: this._lastLoopPattern,
    };
  }

  /**
   * 获取建议
   * @returns {{ action: string, severity: string, reason: string, suggestion: string|null }}
   */
  getSuggestion() {
    const analysis = this.getAnalysis();

    if (analysis.consecutiveLoops.length > 0) {
      const topLoop = analysis.consecutiveLoops[0];
      if (topLoop.consecutiveCount >= this._loopThreshold) {
        return {
          action: "break_loop",
          severity: "high",
          reason: `Detected ${topLoop.consecutiveCount}x loop of pattern: ${topLoop.pattern.join(" -> ")}`,
          suggestion: "Consider changing approach or stopping iteration",
        };
      }
    }

    if (analysis.diversityScore < 0.1 && analysis.totalActions > 10) {
      return {
        action: "diversify",
        severity: "medium",
        reason: `Low action diversity (${(analysis.diversityScore * 100).toFixed(1)}%)`,
        suggestion: "Agent may be stuck in repetitive behavior",
      };
    }

    if (analysis.repeatingPatterns.length > 3) {
      return {
        action: "review",
        severity: "low",
        reason: `Multiple repeating patterns detected (${analysis.repeatingPatterns.length})`,
        suggestion: "Review if patterns are intentional",
      };
    }

    return {
      action: "continue",
      severity: "none",
      reason: "No concerning patterns detected",
      suggestion: null,
    };
  }

  /**
   * 检查是否在循环中
   * @returns {boolean}
   */
  isInLoop() {
    const analysis = this.getAnalysis();
    return analysis.consecutiveLoops.some(
      (loop) => loop.consecutiveCount >= this._loopThreshold
    );
  }

  /**
   * 获取最近的行为序列
   * @param {number} count
   * @returns {Array<{ signature: string, ts: number }>}
   */
  getRecentActions(count = 10) {
    return this._history.slice(-count).map((h) => ({
      signature: h.signature,
      ts: h.ts,
    }));
  }

  /**
   * 重置
   * @returns {void}
   */
  reset() {
    this._history = [];
    this._loopCount = 0;
    this._lastLoopPattern = null;
  }

  /**
   * 获取统计信息
   * @returns {{ historySize: number, maxHistorySize: number, loopCount: number, hasActiveLoop: boolean }}
   */
  get stats() {
    return {
      historySize: this._history.length,
      maxHistorySize: this._historySize,
      loopCount: this._loopCount,
      hasActiveLoop: this.isInLoop(),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Distiller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 上下文蒸馏器 - 为子代理提取相关上下文
 */
export class ContextDistiller {
  /**
   * @param {object} options
   * @param {number} [options.maxTokens=2000] - 最大输出 token 数
   * @param {number} [options.relevanceThreshold=0.3] - 相关性阈值
   */
  constructor({ maxTokens = 2000, relevanceThreshold = 0.3 } = {}) {
    this._maxTokens = maxTokens;
    this._relevanceThreshold = relevanceThreshold;
  }

  /**
   * 蒸馏上下文
   * @param {object} parentContext - 父级上下文 (L0)
   * @param {string} childTask - 子任务描述
   * @returns {object} - 蒸馏后的上下文
   */
  distill(parentContext, childTask) {
    if (!parentContext || !childTask) {
      return {};
    }

    const taskTokens = new Set(tokenize(childTask));
    const distilled = {};

    // 提取任务目标
    if (parentContext.taskGoal) {
      distilled.parentGoal = this._truncate(parentContext.taskGoal, 200);
    }

    // 提取相关的发现
    if (parentContext.discoveries && Array.isArray(parentContext.discoveries)) {
      distilled.relevantDiscoveries = this._filterRelevant(
        parentContext.discoveries,
        taskTokens,
        5
      );
    }

    // 提取相关的约束
    if (parentContext.constraints && Array.isArray(parentContext.constraints)) {
      distilled.constraints = parentContext.constraints.slice(0, 3);
    }

    // 提取工具使用历史的摘要
    if (parentContext.toolHistory && Array.isArray(parentContext.toolHistory)) {
      distilled.toolSummary = this._summarizeTools(parentContext.toolHistory);
    }

    // 提取关键决策
    if (parentContext.decisions && Array.isArray(parentContext.decisions)) {
      distilled.keyDecisions = this._filterRelevant(
        parentContext.decisions,
        taskTokens,
        3
      );
    }

    // 添加子任务
    distilled.childTask = childTask;
    distilled.distilledAt = Date.now();

    // 按 token 预算截断
    return this._enforceTokenLimit(distilled);
  }

  /**
   * 强制执行 token 限制
   * @private
   * @param {object} distilled
   * @returns {object}
   */
  _enforceTokenLimit(distilled) {
    const serialized = JSON.stringify(distilled);
    // 粗略估算：4 字符约 1 token
    const estimatedTokens = Math.ceil(serialized.length / 4);

    if (estimatedTokens <= this._maxTokens) {
      return distilled;
    }

    // 按优先级裁剪字段
    const result = { ...distilled };
    const ratio = this._maxTokens / estimatedTokens;

    // 裁剪 relevantDiscoveries
    if (result.relevantDiscoveries && result.relevantDiscoveries.length > 0) {
      const keepCount = Math.max(1, Math.floor(result.relevantDiscoveries.length * ratio));
      result.relevantDiscoveries = result.relevantDiscoveries.slice(0, keepCount);
    }

    // 裁剪 keyDecisions
    if (result.keyDecisions && result.keyDecisions.length > 0) {
      const keepCount = Math.max(1, Math.floor(result.keyDecisions.length * ratio));
      result.keyDecisions = result.keyDecisions.slice(0, keepCount);
    }

    // 裁剪 constraints
    if (result.constraints && result.constraints.length > 0) {
      const keepCount = Math.max(1, Math.floor(result.constraints.length * ratio));
      result.constraints = result.constraints.slice(0, keepCount);
    }

    // 如果仍超限，截断 parentGoal
    const recheck = JSON.stringify(result);
    if (Math.ceil(recheck.length / 4) > this._maxTokens && result.parentGoal) {
      const goalLimit = Math.max(50, Math.floor(result.parentGoal.length * ratio));
      result.parentGoal = this._truncate(result.parentGoal, goalLimit);
    }

    return result;
  }

  /**
   * 过滤相关内容
   * @private
   */
  _filterRelevant(items, taskTokens, maxCount) {
    if (!items || items.length === 0) return [];

    const scored = items.map((item) => {
      const text = typeof item === "string" ? item : JSON.stringify(item);
      const itemTokens = new Set(tokenize(text));

      // 计算 Jaccard 相似度
      const intersection = [...taskTokens].filter((t) => itemTokens.has(t));
      const union = new Set([...taskTokens, ...itemTokens]);
      const similarity = union.size > 0 ? intersection.length / union.size : 0;

      return { item, similarity };
    });

    return scored
      .filter((s) => s.similarity >= this._relevanceThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxCount)
      .map((s) => s.item);
  }

  /**
   * 截断文本
   * @private
   */
  _truncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + "...";
  }

  /**
   * 总结工具使用
   * @private
   */
  _summarizeTools(toolHistory) {
    const toolCounts = new Map();
    for (const entry of toolHistory) {
      const name = entry.name || entry.tool || "unknown";
      toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
    }

    return Object.fromEntries(toolCounts);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper - tokenize for distiller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 检测是否支持 Unicode 属性转义
 * @returns {boolean}
 */
const supportsUnicodeProperty = (() => {
  try {
    new RegExp("\\p{L}", "u");
    return true;
  } catch {
    return false;
  }
})();

/**
 * 简单分词（兼容旧浏览器）
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  // 降级正则：移除非字母数字空格字符
  const pattern = supportsUnicodeProperty
    ? /[^\p{L}\p{N}\s]/gu
    : /[^a-zA-Z0-9\u00C0-\u024F\u4E00-\u9FFF\s]/g;
  return text
    .toLowerCase()
    .replace(pattern, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { createActionSignature, findRepeatingPatterns, findConsecutiveLoops };

export default BehaviorFingerprint;
