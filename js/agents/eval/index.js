/**
 * Evaluate Stage - 可扩展内容质量评估框架
 *
 * 插件化设计，支持自定义评估器注册。
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
 * @typedef {Object} EvaluatorResult
 * @property {number} score - 维度得分 (0-1)
 * @property {EvaluationIssue[]} [issues] - 该维度发现的问题
 */

/**
 * @callback Evaluator
 * @param {string} content - 待评估内容
 * @param {EvaluationInput} input - 完整输入
 * @param {EvaluatorConfig} config - 评估器配置
 * @returns {EvaluatorResult | Promise<EvaluatorResult>}
 */

/**
 * @typedef {Object} EvaluatorConfig
 * @property {number} [weight=1] - 权重
 * @property {Record<string, unknown>} [options] - 评估器特定选项
 */

/**
 * @typedef {Object} EvaluateStageOptions
 * @property {number} [passThreshold=0.6] - 通过阈值
 * @property {boolean} [strict=false] - 严格模式（有 error 级别问题即不通过）
 * @property {string[]} [dimensions] - 启用的评估维度（默认全部）
 * @property {Record<string, EvaluatorConfig>} [dimensionConfig] - 各维度配置
 */

/**
 * 内置评估器：完整性
 * @type {Evaluator}
 */
const completenessEvaluator = (content, input, config) => {
  const issues = [];
  let score = 1.0;

  const contentType = input?.context?.type ?? 'text';
  const minLength = config.options?.minLength ?? (contentType === 'report' ? 200 : 50);

  if (content.length < minLength) {
    score -= 0.3;
    issues.push({
      type: 'too_short',
      severity: 'warning',
      message: `Content is shorter than expected (${content.length} < ${minLength} chars)`,
    });
  }

  if (contentType === 'report' && !content.includes('#')) {
    score -= 0.2;
    issues.push({
      type: 'missing_structure',
      severity: 'info',
      message: 'Report lacks heading structure',
    });
  }

  return { score: Math.max(0, score), issues };
};

/**
 * 内置评估器：准确性
 * @type {Evaluator}
 */
const accuracyEvaluator = (content, _input, config) => {
  const issues = [];
  let score = 1.0;

  const placeholderPattern = config.options?.placeholderPattern
    ?? /\[TODO\]|\[TBD\]|\[PLACEHOLDER\]|\{\{.*?\}\}/gi;

  const placeholders = content.match(placeholderPattern);
  if (placeholders?.length > 0) {
    score -= 0.1 * Math.min(placeholders.length, 5);
    issues.push({
      type: 'placeholder_found',
      severity: 'warning',
      message: `Found ${placeholders.length} placeholder(s) in content`,
    });
  }

  if (/\.{3,}$|…$/m.test(content)) {
    score -= 0.1;
    issues.push({
      type: 'incomplete_sentence',
      severity: 'info',
      message: 'Content may contain incomplete sentences',
    });
  }

  return { score: Math.max(0, score), issues };
};

/**
 * 内置评估器：清晰度
 * @type {Evaluator}
 */
const clarityEvaluator = (content, _input, config) => {
  const issues = [];
  let score = 1.0;

  const maxParagraphLength = config.options?.maxParagraphLength ?? 1000;
  const paragraphs = content.split(/\n\n+/);
  const longParagraphs = paragraphs.filter(p => p.length > maxParagraphLength);

  if (longParagraphs.length > 0) {
    score -= 0.1 * Math.min(longParagraphs.length, 3);
    issues.push({
      type: 'long_paragraphs',
      severity: 'info',
      message: `${longParagraphs.length} paragraph(s) exceed ${maxParagraphLength} characters`,
    });
  }

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

  return { score: Math.max(0, score), issues };
};

/**
 * 内置评估器：相关性
 * @type {Evaluator}
 */
const relevanceEvaluator = (content, input, config) => {
  const issues = [];
  const original = input?.original;

  if (!original) {
    return { score: 1.0, issues };
  }

  const minWordLength = config.options?.minWordLength ?? 3;
  const originalWords = new Set(
    original.toLowerCase().split(/\W+/).filter(w => w.length > minWordLength)
  );
  const contentWords = content.toLowerCase().split(/\W+/).filter(w => w.length > minWordLength);

  if (originalWords.size === 0) {
    return { score: 1.0, issues };
  }

  const overlap = contentWords.filter(w => originalWords.has(w)).length;
  const overlapRatio = overlap / Math.max(originalWords.size, 1);

  if (overlapRatio < 0.1) {
    issues.push({
      type: 'low_relevance',
      severity: 'warning',
      message: 'Content may not be relevant to the original input',
    });
  }

  return { score: Math.min(1, overlapRatio * 2), issues };
};

/** 内置评估器注册表 */
const BUILTIN_EVALUATORS = {
  completeness: completenessEvaluator,
  accuracy: accuracyEvaluator,
  clarity: clarityEvaluator,
  relevance: relevanceEvaluator,
};

/**
 * 可扩展的内容质量评估器
 *
 * @example
 * // 基础用法
 * const stage = new EvaluateStage();
 * const result = await stage.run(ctx, { content: 'Hello world' });
 *
 * @example
 * // 自定义评估器
 * const stage = new EvaluateStage();
 * stage.registerEvaluator('security', (content) => ({
 *   score: content.includes('password') ? 0.5 : 1.0,
 *   issues: content.includes('password')
 *     ? [{ type: 'sensitive_data', severity: 'error', message: 'Contains password' }]
 *     : [],
 * }));
 *
 * @example
 * // 配置权重
 * const stage = new EvaluateStage({
 *   dimensionConfig: {
 *     accuracy: { weight: 2 },  // 准确性权重翻倍
 *     clarity: { weight: 0.5 }, // 清晰度权重减半
 *   },
 * });
 */
export class EvaluateStage {
  /**
   * @param {EvaluateStageOptions} [options]
   */
  constructor(options = {}) {
    this.passThreshold = options.passThreshold ?? 0.6;
    this.strict = options.strict ?? false;
    this.enabledDimensions = options.dimensions ?? null; // null = all
    this.dimensionConfig = options.dimensionConfig ?? {};

    /** @type {Map<string, Evaluator>} */
    this._evaluators = new Map(Object.entries(BUILTIN_EVALUATORS));
  }

  /**
   * 注册自定义评估器
   * @param {string} name - 维度名称
   * @param {Evaluator} evaluator - 评估函数
   * @param {EvaluatorConfig} [config] - 默认配置
   */
  registerEvaluator(name, evaluator, config = {}) {
    this._evaluators.set(name, evaluator);
    if (Object.keys(config).length > 0) {
      this.dimensionConfig[name] = { ...this.dimensionConfig[name], ...config };
    }
    return this;
  }

  /**
   * 移除评估器
   * @param {string} name
   */
  unregisterEvaluator(name) {
    this._evaluators.delete(name);
    return this;
  }

  /**
   * 获取所有已注册的评估器名称
   * @returns {string[]}
   */
  getEvaluatorNames() {
    return [...this._evaluators.keys()];
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

    // 基础检查
    if (!content || typeof content !== 'string') {
      issues.push({
        type: 'missing_content',
        severity: 'error',
        message: 'Content is empty or invalid',
      });
      return { passed: false, score: 0, issues, dimensions: {} };
    }

    // 确定要运行的评估器
    const evaluatorNames = this.enabledDimensions
      ?? [...this._evaluators.keys()];

    // 并行执行所有评估器
    const evaluatorPromises = evaluatorNames
      .filter(name => this._evaluators.has(name))
      .map(async name => {
        const evaluator = this._evaluators.get(name);
        const config = {
          weight: 1,
          options: {},
          ...this.dimensionConfig[name],
        };

        try {
          const result = await evaluator(content, input, config);
          return { name, result, config };
        } catch (err) {
          issues.push({
            type: 'evaluator_error',
            severity: 'warning',
            message: `Evaluator "${name}" failed: ${err?.message ?? err}`,
          });
          return { name, result: { score: 1.0, issues: [] }, config };
        }
      });

    const evaluatorResults = await Promise.all(evaluatorPromises);

    // 聚合结果
    let totalWeight = 0;
    let weightedScore = 0;

    for (const { name, result, config } of evaluatorResults) {
      dimensionScores[name] = result.score;
      if (result.issues?.length > 0) {
        issues.push(...result.issues);
      }
      weightedScore += result.score * config.weight;
      totalWeight += config.weight;
    }

    const score = totalWeight > 0 ? weightedScore / totalWeight : 0;

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
}

export default EvaluateStage;
