/**
 * Convergence Detector - 语义收敛检测
 *
 * 特性：
 * - 基于熵的收敛检测
 * - 输出多样性追踪
 * - 自动停止建议
 */

import { createLogger } from "../../shared/index.js";

const logger = createLogger("runtime/analysis/convergence-detector");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_SIZE = 5;
const DEFAULT_ENTROPY_THRESHOLD = 0.3;
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

// ─────────────────────────────────────────────────────────────────────────────
// Text Utilities
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

/**
 * 计算 n-gram
 * @param {string[]} tokens
 * @param {number} n
 * @returns {string[]}
 */
function ngrams(tokens, n = 2) {
  if (tokens.length < n) return tokens;
  const result = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    result.push(tokens.slice(i, i + n).join("_"));
  }
  return result;
}

/**
 * 计算词频
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function termFrequency(tokens) {
  const freq = new Map();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return freq;
}

/**
 * 计算信息熵
 * @param {Map<string, number>} freq
 * @returns {number}
 */
function entropy(freq) {
  const total = Array.from(freq.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  let h = 0;
  for (const count of freq.values()) {
    const p = count / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/**
 * 计算 Jaccard 相似度
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccardSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

/**
 * 计算余弦相似度
 * @param {Map<string, number>} a
 * @param {Map<string, number>} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const key of keys) {
    const va = a.get(key) || 0;
    const vb = b.get(key) || 0;
    dotProduct += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const norm = Math.sqrt(normA) * Math.sqrt(normB);
  return norm === 0 ? 0 : dotProduct / norm;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convergence Detector
// ─────────────────────────────────────────────────────────────────────────────

export class ConvergenceDetector {
  /**
   * @param {object} options
   * @param {number} [options.windowSize=5] - 滑动窗口大小
   * @param {number} [options.entropyThreshold=0.3] - 熵阈值（低于此值认为收敛）
   * @param {number} [options.similarityThreshold=0.85] - 相似度阈值
   * @param {function} [options.onConvergence] - 收敛回调
   */
  constructor({
    windowSize = DEFAULT_WINDOW_SIZE,
    entropyThreshold = DEFAULT_ENTROPY_THRESHOLD,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
    onConvergence,
  } = {}) {
    this._windowSize = Math.max(2, windowSize);
    this._entropyThreshold = entropyThreshold;
    this._similarityThreshold = similarityThreshold;
    this._onConvergence = typeof onConvergence === "function" ? onConvergence : null;

    /** @type {Array<{ text: string, tokens: string[], freq: Map<string, number>, ngrams: Set<string>, ts: number }>} */
    this._history = [];
    this._converged = false;
    this._convergenceTs = null;
  }

  /**
   * 添加输出样本
   * @param {string} text
   * @returns {{ converged: boolean, metrics: object }}
   */
  addSample(text) {
    const tokens = tokenize(text);
    const freq = termFrequency(tokens);
    const ngramSet = new Set(ngrams(tokens, 2));

    const sample = {
      text,
      tokens,
      freq,
      ngrams: ngramSet,
      ts: Date.now(),
    };

    this._history.push(sample);

    // 保持窗口大小
    while (this._history.length > this._windowSize * 2) {
      this._history.shift();
    }

    // 计算收敛指标
    const metrics = this._computeMetrics();

    // 检查收敛
    if (!this._converged && metrics.isConverged) {
      this._converged = true;
      this._convergenceTs = Date.now();
      logger.info("Convergence detected", metrics);

      if (this._onConvergence) {
        this._onConvergence(metrics);
      }
    }

    return { converged: this._converged, metrics };
  }

  /**
   * 计算收敛指标
   * @private
   * @returns {{ entropy: number, avgSimilarity: number, diversityScore: number, isConverged: boolean, sampleCount: number, vocabSize?: number }}
   */
  _computeMetrics() {
    if (this._history.length < 2) {
      return {
        entropy: 1,
        avgSimilarity: 0,
        diversityScore: 1,
        isConverged: false,
        sampleCount: this._history.length,
      };
    }

    // 计算窗口内所有样本的合并词频
    const windowSamples = this._history.slice(-this._windowSize);
    const combinedFreq = new Map();
    const allNgrams = new Set();

    for (const sample of windowSamples) {
      for (const [term, count] of sample.freq) {
        combinedFreq.set(term, (combinedFreq.get(term) || 0) + count);
      }
      for (const ng of sample.ngrams) {
        allNgrams.add(ng);
      }
    }

    // 计算熵
    const currentEntropy = entropy(combinedFreq);

    // 归一化熵（相对于词汇量）
    const vocabSize = combinedFreq.size;
    const maxEntropy = vocabSize > 0 ? Math.log2(vocabSize) : 1;
    const normalizedEntropy = maxEntropy > 0 ? currentEntropy / maxEntropy : 0;

    // 计算相邻样本相似度
    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 1; i < windowSamples.length; i++) {
      const similarity = jaccardSimilarity(
        windowSamples[i - 1].ngrams,
        windowSamples[i].ngrams
      );
      totalSimilarity += similarity;
      pairCount++;
    }

    const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 0;

    // 计算多样性分数（新词汇引入率）
    const recentSamples = windowSamples.slice(-Math.min(3, windowSamples.length));
    const oldSamples = windowSamples.slice(0, -Math.min(3, windowSamples.length));

    let diversityScore = 1;
    if (oldSamples.length > 0 && recentSamples.length > 0) {
      const oldNgrams = new Set();
      for (const s of oldSamples) {
        for (const ng of s.ngrams) oldNgrams.add(ng);
      }

      const newNgrams = new Set();
      for (const s of recentSamples) {
        for (const ng of s.ngrams) {
          if (!oldNgrams.has(ng)) newNgrams.add(ng);
        }
      }

      const totalRecent = recentSamples.reduce((a, s) => a + s.ngrams.size, 0);
      diversityScore = totalRecent > 0 ? newNgrams.size / totalRecent : 0;
    }

    // 判断是否收敛
    const isConverged =
      normalizedEntropy < this._entropyThreshold &&
      avgSimilarity > this._similarityThreshold &&
      diversityScore < 0.1;

    return {
      entropy: normalizedEntropy,
      avgSimilarity,
      diversityScore,
      isConverged,
      sampleCount: this._history.length,
      vocabSize,
    };
  }

  /**
   * 检查是否收敛
   * @returns {boolean}
   */
  isConverged() {
    return this._converged;
  }

  /**
   * 获取当前指标
   * @returns {{ entropy: number, avgSimilarity: number, diversityScore: number, isConverged: boolean, sampleCount: number, vocabSize?: number }}
   */
  getMetrics() {
    return this._computeMetrics();
  }

  /**
   * 重置检测器
   * @returns {void}
   */
  reset() {
    this._history = [];
    this._converged = false;
    this._convergenceTs = null;
  }

  /**
   * 获取建议动作
   * @returns {{ action: string, reason: string }}
   */
  getSuggestion() {
    const metrics = this._computeMetrics();

    if (metrics.isConverged) {
      return {
        action: "stop",
        reason: `Output converged (entropy=${metrics.entropy.toFixed(2)}, similarity=${metrics.avgSimilarity.toFixed(2)})`,
      };
    }

    if (metrics.avgSimilarity > 0.9 && metrics.diversityScore < 0.05) {
      return {
        action: "diversify",
        reason: "Outputs too similar, consider diversifying approach",
      };
    }

    if (metrics.entropy > 0.8) {
      return {
        action: "focus",
        reason: "High entropy suggests unfocused exploration",
      };
    }

    return {
      action: "continue",
      reason: "Not yet converged",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { tokenize, ngrams, termFrequency, entropy, jaccardSimilarity, cosineSimilarity };

export default ConvergenceDetector;
