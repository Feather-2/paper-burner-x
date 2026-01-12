/**
 * Evaluate Stage - 内容质量评估
 *
 * 提供生成内容的质量评估能力，支持多维度评分。
 *
 * @module eval
 */

/**
 * @typedef {Object} EvaluationResult
 * @property {boolean} passed - 是否通过评估
 * @property {number} score - 总分 (0-1)
 * @property {EvaluationIssue[]} issues - 发现的问题
 * @property {Record<string, number>} [dimensions] - 各维度得分
 */

/**
 * @typedef {Object} EvaluationIssue
 * @property {string} type - 问题类型
 * @property {string} severity - 严重程度: 'error' | 'warning' | 'info'
 * @property {string} message - 问题描述
 * @property {string} [location] - 问题位置
 */

/**
 * @typedef {Object} EvaluationContext
 * @property {string} [type] - 内容类型: 'report' | 'slide' | 'code' | 'text'
 * @property {Record<string, unknown>} [metadata] - 额外元数据
 */

/**
 * @typedef {Object} EvaluationInput
 * @property {string} content - 待评估内容
 * @property {string} [original] - 原始输入（用于相关性评估）
 * @property {EvaluationContext} [context] - 评估上下文
 */

/**
 * @typedef {Object} EvaluateStageOptions
 * @property {number} [passThreshold=0.6] - 通过阈值
 * @property {boolean} [strict=false] - 严格模式（有 error 级别问题即不通过）
 * @property {string[]} [dimensions] - 评估维度
 */

/** 默认评估维度 */
const DEFAULT_DIMENSIONS = ['completeness', 'accuracy', 'clarity', 'relevance'];

/**
 * 内容质量评估器
 */
export class EvaluateStage {
  /**
   * @param {EvaluateStageOptions} [options]
   */
  constructor(options = {}) {
    this.passThreshold = options.passThreshold ?? 0.6;
    this.strict = options.strict ?? false;
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
  }

  /**
   * 执行评估
   * @param {unknown} ctx - 运行上下文
   * @param {EvaluationInput} input - 评估输入
   * @returns {Promise<EvaluationResult>}
   */
  async run(ctx, input) {
    const issues = [];
    const dimensionScores = {};

    const content = input?.content ?? '';
    const contentType = input?.context?.type ?? 'text';

    // 基础检查
    if (!content || typeof content !== 'string') {
      issues.push({
        type: 'missing_content',
        severity: 'error',
        message: 'Content is empty or invalid',
      });
      return { passed: false, score: 0, issues, dimensions: {} };
    }

    // 完整性评估
    dimensionScores.completeness = this._evaluateCompleteness(content, contentType, issues);

    // 准确性评估（基础检查）
    dimensionScores.accuracy = this._evaluateAccuracy(content, issues);

    // 清晰度评估
    dimensionScores.clarity = this._evaluateClarity(content, issues);

    // 相关性评估
    if (input?.original) {
      dimensionScores.relevance = this._evaluateRelevance(content, input.original, issues);
    } else {
      dimensionScores.relevance = 1.0; // 无原始输入时默认满分
    }

    // 计算总分
    const activeScores = this.dimensions
      .filter(d => dimensionScores[d] !== undefined)
      .map(d => dimensionScores[d]);
    const score = activeScores.length > 0
      ? activeScores.reduce((a, b) => a + b, 0) / activeScores.length
      : 0;

    // 判断是否通过
    const hasError = issues.some(i => i.severity === 'error');
    const passed = this.strict
      ? !hasError && score >= this.passThreshold
      : score >= this.passThreshold;

    return {
      passed,
      score: Math.round(score * 100) / 100,
      issues,
      dimensions: dimensionScores,
    };
  }

  /**
   * 评估完整性
   * @param {string} content
   * @param {string} contentType
   * @param {EvaluationIssue[]} issues
   * @returns {number}
   */
  _evaluateCompleteness(content, contentType, issues) {
    let score = 1.0;

    // 内容长度检查
    const minLength = contentType === 'report' ? 200 : 50;
    if (content.length < minLength) {
      score -= 0.3;
      issues.push({
        type: 'too_short',
        severity: 'warning',
        message: `Content is shorter than expected (${content.length} < ${minLength} chars)`,
      });
    }

    // 结构完整性（针对报告类型）
    if (contentType === 'report') {
      if (!content.includes('#') && !content.includes('##')) {
        score -= 0.2;
        issues.push({
          type: 'missing_structure',
          severity: 'info',
          message: 'Report lacks heading structure',
        });
      }
    }

    return Math.max(0, score);
  }

  /**
   * 评估准确性
   * @param {string} content
   * @param {EvaluationIssue[]} issues
   * @returns {number}
   */
  _evaluateAccuracy(content, issues) {
    let score = 1.0;

    // 检测占位符残留
    const placeholders = content.match(/\[TODO\]|\[TBD\]|\[PLACEHOLDER\]|\{\{.*?\}\}/gi);
    if (placeholders && placeholders.length > 0) {
      score -= 0.1 * Math.min(placeholders.length, 5);
      issues.push({
        type: 'placeholder_found',
        severity: 'warning',
        message: `Found ${placeholders.length} placeholder(s) in content`,
      });
    }

    // 检测不完整的句子
    const incompletePatterns = /\.{3,}$|…$/m;
    if (incompletePatterns.test(content)) {
      score -= 0.1;
      issues.push({
        type: 'incomplete_sentence',
        severity: 'info',
        message: 'Content may contain incomplete sentences',
      });
    }

    return Math.max(0, score);
  }

  /**
   * 评估清晰度
   * @param {string} content
   * @param {EvaluationIssue[]} issues
   * @returns {number}
   */
  _evaluateClarity(content, issues) {
    let score = 1.0;

    // 检测过长段落
    const paragraphs = content.split(/\n\n+/);
    const longParagraphs = paragraphs.filter(p => p.length > 1000);
    if (longParagraphs.length > 0) {
      score -= 0.1 * Math.min(longParagraphs.length, 3);
      issues.push({
        type: 'long_paragraphs',
        severity: 'info',
        message: `${longParagraphs.length} paragraph(s) exceed 1000 characters`,
      });
    }

    // 检测重复内容
    const sentences = content.split(/[.!?。！？]+/).filter(s => s.trim().length > 20);
    const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
    if (sentences.length > 3 && uniqueSentences.size < sentences.length * 0.8) {
      score -= 0.2;
      issues.push({
        type: 'repetitive_content',
        severity: 'warning',
        message: 'Content contains significant repetition',
      });
    }

    return Math.max(0, score);
  }

  /**
   * 评估相关性
   * @param {string} content
   * @param {string} original
   * @param {EvaluationIssue[]} issues
   * @returns {number}
   */
  _evaluateRelevance(content, original, issues) {
    // 简单的关键词重叠检查
    const originalWords = new Set(
      original.toLowerCase().split(/\W+/).filter(w => w.length > 3)
    );
    const contentWords = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);

    if (originalWords.size === 0) return 1.0;

    const overlap = contentWords.filter(w => originalWords.has(w)).length;
    const overlapRatio = overlap / Math.max(originalWords.size, 1);

    if (overlapRatio < 0.1) {
      issues.push({
        type: 'low_relevance',
        severity: 'warning',
        message: 'Content may not be relevant to the original input',
      });
    }

    return Math.min(1, overlapRatio * 2); // 50% 重叠即满分
  }
}

export default EvaluateStage;
