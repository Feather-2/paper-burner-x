/**
 * Auto Reviewer - Pipeline 自动审查阶段
 *
 * 生成完成后自动进行全局风格检查：
 * - 多页截图分析
 * - DSL 一致性检查
 * - 自动修复建议
 */

import { createDeckAnalyzer, collectAllDsl } from "../internal/deck-analyzer.js";
import { createDeckEditor } from "../internal/deck-editor.js";
import { createScreenshotStitcher } from "../internal/screenshot-stitcher.js";

/**
 * @typedef {object} SlideMeta
 * @property {number} [index] - Slide index
 * @property {string} [title] - Slide title
 * @property {string} [layout] - Layout type
 * @property {Record<string, unknown>} [data] - Additional metadata
 */

/**
 * @typedef {object} DeckPackage
 * @property {string} deckHtmlDsl - HTML DSL string for the deck
 * @property {SlideMeta[]} [slidesMeta] - Metadata for each slide
 */

/**
 * @typedef {object} SlideElement
 * @property {string} type - Element type (text, image, shape, etc.)
 * @property {string} [id] - Element ID
 * @property {Record<string, unknown>} [props] - Element properties
 */

/**
 * @typedef {object} SlideDsl
 * @property {number} slideIndex - Index of the slide
 * @property {string} html - HTML content of the slide
 * @property {SlideElement[]} elements - Parsed elements in the slide
 */

/**
 * @typedef {object} DesignTokens
 * @property {Record<string, string>} [colors] - Color palette
 * @property {string} [colorScheme] - Color scheme name
 * @property {string} [accentColor] - Accent color
 * @property {string} [fontFamily] - Primary font family
 * @property {{ fontFamily?: string, headingFont?: string, bodyFont?: string }} [typography] - Typography settings
 */

/**
 * @typedef {object} DesignSystem
 * @property {DesignTokens} [designTokens] - Design tokens
 * @property {DesignTokens} [tokens] - Alternative tokens location
 */

/**
 * @typedef {object} ReviewOptions
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 * @property {number} [maxColorVariants] - Override max color variants
 * @property {number} [maxFontVariants] - Override max font variants
 * @property {number} [maxLayoutVariants] - Override max layout variants
 * @property {number} [minConsistencyScore] - Override min consistency score
 * @property {boolean} [autoFixEnabled] - Enable auto-fix suggestions
 */

/**
 * @typedef {object} ReviewContext
 * @property {string} deckHtmlDsl - HTML DSL string
 * @property {SlideMeta[]} slidesMeta - Slide metadata
 * @property {SlideDsl[]} allDsl - Parsed slides
 * @property {DesignSystem} designSystem - Design system
 * @property {number} slideCount - Number of slides
 * @property {ReviewOptions} options - Review options
 * @property {typeof REVIEW_CONFIG} config - Effective review config
 */

/**
 * @typedef {object} IssueDetails
 * @property {number} [colorCount] - Number of colors found
 * @property {Array<[string, number]>} [topColors] - Top colors with usage count
 * @property {string[]} [unexpectedColors] - Colors not in design system
 * @property {number} [fontCount] - Number of fonts found
 * @property {Array<[string, number]>} [fonts] - Fonts with usage count
 * @property {Array<[string, number]>} [layouts] - Layouts with usage count
 */

/**
 * @typedef {object} ReviewIssue
 * @property {string} type - Issue type from IssueType
 * @property {"error"|"warning"|"info"} severity - Issue severity
 * @property {string} message - Human-readable message
 * @property {IssueDetails} [details] - Additional details
 */

/**
 * @typedef {object} FixSuggestion
 * @property {string[]} [primaryColors] - Suggested primary colors
 * @property {string} [primaryFont] - Suggested primary font
 */

/**
 * @typedef {object} FixEdit
 * @property {string} type - Edit type
 * @property {number} slideIndex - Target slide index
 * @property {Record<string, unknown>} changes - Changes to apply
 */

/**
 * @typedef {object} ReviewFix
 * @property {string} issueType - Related issue type
 * @property {string} description - Fix description
 * @property {boolean} autoFixable - Whether fix can be auto-applied
 * @property {FixSuggestion} [suggestion] - Suggested fix values
 * @property {FixEdit[]} [edits] - Edits to apply
 */

/**
 * @typedef {object} ReviewSummary
 * @property {string} status - Status string (优秀/良好/一般/需要改进)
 * @property {number} score - Score as percentage (0-100)
 * @property {number} slideCount - Number of slides reviewed
 * @property {{ error: number, warning: number, info: number }} issueBreakdown - Issue counts by severity
 * @property {string} message - Summary message
 */

/**
 * @typedef {object} AutoReviewResult
 * @property {boolean} success - Whether review completed successfully
 * @property {string} [error] - Error message if failed
 * @property {ReviewIssue[]} issues - Found issues
 * @property {ReviewFix[]} fixes - Suggested fixes
 * @property {number} score - Consistency score (0-1)
 * @property {ReviewSummary} [summary] - Review summary
 * @property {number} [slideCount] - Number of slides reviewed
 * @property {boolean} [pass] - Whether deck passes consistency threshold
 */

/**
 * @typedef {object} DeckAnalyzer
 * @property {function(string): SlideDsl[]} collectAllDsl - Parse DSL string
 */

/**
 * @typedef {object} DeckEditor
 * @property {function(DeckPackage): void} setDeckPackage - Set deck to edit
 * @property {function(FixEdit[]): Promise<{ success: boolean }>} batchEdit - Apply edits
 * @property {function(): string} getDeckHtmlDsl - Get current DSL
 */

/**
 * @typedef {object} ScreenshotStitcher
 * @property {function(string[]): Promise<string>} stitch - Stitch screenshots
 */

/**
 * @typedef {object} AutoReviewerOptions
 * @property {DeckAnalyzer} [analyzer] - Custom deck analyzer
 * @property {DeckEditor} [editor] - Custom deck editor
 * @property {ScreenshotStitcher} [stitcher] - Custom screenshot stitcher
 * @property {Partial<typeof REVIEW_CONFIG>} [config] - Config overrides
 */

/**
 * 审查配置
 *
 * @type {{
 *   maxColorVariants: number,
 *   maxFontVariants: number,
 *   maxLayoutVariants: number,
 *   minSlidesForLayoutCheck: number,
 *   minConsistencyScore: number,
 *   autoFixEnabled: boolean,
 *   scoring: { errorPenalty: number, warningPenalty: number, infoPenalty: number },
 *   thresholds: { unexpectedColorWarning: number, topColorsToShow: number, topColorsForFix: number, unexpectedColorsToShow: number },
 *   statusThresholds: { poor: number, fair: number, good: number }
 * }}
 */
export const REVIEW_CONFIG = {
  maxColorVariants: 8,
  maxFontVariants: 3,
  maxLayoutVariants: 5,
  minSlidesForLayoutCheck: 8,
  minConsistencyScore: 0.7,
  autoFixEnabled: true,
  // 评分扣分权重
  scoring: {
    errorPenalty: 0.2,
    warningPenalty: 0.1,
    infoPenalty: 0.05,
  },
  // 阈值
  thresholds: {
    unexpectedColorWarning: 3,
    topColorsToShow: 10,
    topColorsForFix: 3,
    unexpectedColorsToShow: 5,
  },
  // 状态评级
  statusThresholds: {
    poor: 0.5,
    fair: 0.7,
    good: 0.9,
  },
};

/**
 * Resolve effective review config from overrides.
 *
 * @param {ReviewOptions & { config?: Partial<typeof REVIEW_CONFIG> }} [options={}]
 * @returns {typeof REVIEW_CONFIG}
 */
function resolveReviewConfig(options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const configOverrides = safeOptions.config && typeof safeOptions.config === "object" ? safeOptions.config : {};

  const optionScoring = safeOptions.scoring && typeof safeOptions.scoring === "object" ? safeOptions.scoring : {};
  const optionThresholds = safeOptions.thresholds && typeof safeOptions.thresholds === "object" ? safeOptions.thresholds : {};
  const optionStatusThresholds = safeOptions.statusThresholds && typeof safeOptions.statusThresholds === "object"
    ? safeOptions.statusThresholds
    : {};

  const overrideScoring = configOverrides.scoring && typeof configOverrides.scoring === "object" ? configOverrides.scoring : {};
  const overrideThresholds = configOverrides.thresholds && typeof configOverrides.thresholds === "object"
    ? configOverrides.thresholds
    : {};
  const overrideStatusThresholds = configOverrides.statusThresholds && typeof configOverrides.statusThresholds === "object"
    ? configOverrides.statusThresholds
    : {};

  const merged = { ...REVIEW_CONFIG, ...configOverrides };
  for (const key of Object.keys(REVIEW_CONFIG)) {
    if (Object.prototype.hasOwnProperty.call(safeOptions, key)) {
      merged[key] = safeOptions[key];
    }
  }

  merged.scoring = {
    ...REVIEW_CONFIG.scoring,
    ...overrideScoring,
    ...optionScoring,
  };
  merged.thresholds = {
    ...REVIEW_CONFIG.thresholds,
    ...overrideThresholds,
    ...optionThresholds,
  };
  merged.statusThresholds = {
    ...REVIEW_CONFIG.statusThresholds,
    ...overrideStatusThresholds,
    ...optionStatusThresholds,
  };

  return merged;
}

/**
 * 审查问题类型枚举
 *
 * @type {{
 *   COLOR_INCONSISTENCY: "color_inconsistency",
 *   FONT_INCONSISTENCY: "font_inconsistency",
 *   LAYOUT_MISMATCH: "layout_mismatch",
 *   VISUAL_IMBALANCE: "visual_imbalance",
 *   MISSING_ELEMENT: "missing_element",
 *   STYLE_DEVIATION: "style_deviation"
 * }}
 */
export const IssueType = {
  /** 颜色使用不一致 */
  COLOR_INCONSISTENCY: "color_inconsistency",
  /** 字体使用不一致 */
  FONT_INCONSISTENCY: "font_inconsistency",
  /** 布局类型不匹配 */
  LAYOUT_MISMATCH: "layout_mismatch",
  /** 视觉不平衡 */
  VISUAL_IMBALANCE: "visual_imbalance",
  /** 缺少必要元素 */
  MISSING_ELEMENT: "missing_element",
  /** 偏离设计系统 */
  STYLE_DEVIATION: "style_deviation",
};

/**
 * 问题严重程度枚举
 *
 * @type {{
 *   ERROR: "error",
 *   WARNING: "warning",
 *   INFO: "info"
 * }}
 */
export const IssueSeverity = {
  /** 错误级别，需要修复 */
  ERROR: "error",
  /** 警告级别，建议修复 */
  WARNING: "warning",
  /** 信息级别，仅供参考 */
  INFO: "info",
};

/**
 * 输入验证错误
 */
export class ReviewInputError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "ReviewInputError";
  }
}

/**
 * 构建审查上下文
 *
 * @param {DeckPackage} deckPackage - Deck package to review
 * @param {DesignSystem} designSystem - Design system for consistency check
 * @param {ReviewOptions} [options={}] - Review options
 * @returns {ReviewContext}
 * @throws {ReviewInputError} When deckHtmlDsl is not a string or slidesMeta is not an array
 */
export function buildReviewContext(deckPackage, designSystem, options = {}) {
  // Input validation
  const dsl = deckPackage?.deckHtmlDsl;
  if (dsl !== undefined && dsl !== null && typeof dsl !== "string") {
    throw new ReviewInputError("deckHtmlDsl must be a string");
  }
  const meta = deckPackage?.slidesMeta;
  if (meta !== undefined && meta !== null && !Array.isArray(meta)) {
    throw new ReviewInputError("slidesMeta must be an array");
  }

  const allDsl = collectAllDsl(dsl || "");
  return {
    deckHtmlDsl: dsl || "",
    slidesMeta: meta || [],
    allDsl,
    designSystem: designSystem || {},
    slideCount: allDsl.length,
    options,
  };
}

/**
 * 检查配色一致性
 */
function checkColorConsistency(context) {
  const issues = [];
  const { allDsl, designSystem, config } = context;

  const colorUsage = new Map();
  const expectedColors = new Set();

  // 收集设计系统中的预期颜色
  const tokens = designSystem?.designTokens || designSystem?.tokens || designSystem || {};
  if (tokens.colors) {
    Object.values(tokens.colors).forEach((c) => {
      if (typeof c === "string") expectedColors.add(c.toLowerCase());
    });
  }
  if (tokens.colorScheme) expectedColors.add(tokens.colorScheme.toLowerCase());
  if (tokens.accentColor) expectedColors.add(tokens.accentColor.toLowerCase());

  // 分析实际使用的颜色
  for (const slide of allDsl) {
    const colorMatches = slide.html.matchAll(/(?:color|background(?:-color)?|border-color|fill|stroke):\s*([#\w(),.]+)/gi);
    for (const m of colorMatches) {
      const color = m[1].toLowerCase().trim();
      if (color && !color.startsWith("var(") && color !== "transparent" && color !== "inherit") {
        colorUsage.set(color, (colorUsage.get(color) || 0) + 1);
      }
    }
  }

  // 检查颜色数量
  if (colorUsage.size > config.maxColorVariants) {
    issues.push({
      type: IssueType.COLOR_INCONSISTENCY,
      severity: IssueSeverity.WARNING,
      message: `使用了 ${colorUsage.size} 种颜色，超过建议的 ${config.maxColorVariants} 种`,
      details: {
        colorCount: colorUsage.size,
        topColors: [...colorUsage.entries()].sort((a, b) => b[1] - a[1]).slice(0, config.thresholds.topColorsToShow),
      },
    });
  }

  // 检查是否有偏离设计系统的颜色
  if (expectedColors.size > 0) {
    const unexpectedColors = [...colorUsage.keys()].filter((c) => !expectedColors.has(c));
    if (unexpectedColors.length > config.thresholds.unexpectedColorWarning) {
      issues.push({
        type: IssueType.STYLE_DEVIATION,
        severity: IssueSeverity.INFO,
        message: `发现 ${unexpectedColors.length} 种未在设计系统中定义的颜色`,
        details: { unexpectedColors: unexpectedColors.slice(0, config.thresholds.unexpectedColorsToShow) },
      });
    }
  }

  return issues;
}

/**
 * 检查字体一致性
 */
function checkFontConsistency(context) {
  const issues = [];
  const { allDsl, designSystem, config } = context;

  const fontUsage = new Map();
  const tokens = designSystem?.designTokens || designSystem?.tokens || designSystem || {};
  const expectedFonts = new Set();

  const addExpectedFont = (v) => {
    if (typeof v !== "string") return;
    const s = v.trim();
    if (!s) return;
    expectedFonts.add(s.toLowerCase());
  };

  addExpectedFont(tokens.fontFamily);
  addExpectedFont(tokens.typography?.fontFamily);
  addExpectedFont(tokens.typography?.headingFont);
  addExpectedFont(tokens.typography?.bodyFont);

  for (const slide of allDsl) {
    const fontMatches = slide.html.matchAll(/font-family:\s*([^;'"]+)/gi);
    for (const m of fontMatches) {
      const font = m[1].trim().toLowerCase().split(",")[0].trim();
      if (font && !font.startsWith("var(")) {
        fontUsage.set(font, (fontUsage.get(font) || 0) + 1);
      }
    }
  }

  if (fontUsage.size > config.maxFontVariants) {
    issues.push({
      type: IssueType.FONT_INCONSISTENCY,
      severity: IssueSeverity.WARNING,
      message: `使用了 ${fontUsage.size} 种字体，超过建议的 ${config.maxFontVariants} 种`,
      details: {
        fontCount: fontUsage.size,
        fonts: [...fontUsage.entries()],
      },
    });
  }

  return issues;
}

/**
 * 检查布局一致性
 */
function checkLayoutConsistency(context) {
  const issues = [];
  const { allDsl, config } = context;

  const layoutUsage = new Map();

  for (const slide of allDsl) {
    const layoutMatch = slide.html.match(/data-layout="([^"]+)"/);
    const layout = layoutMatch ? layoutMatch[1] : "unknown";
    layoutUsage.set(layout, (layoutUsage.get(layout) || 0) + 1);
  }

  // 检查是否有过多的布局类型
  if (layoutUsage.size > config.maxLayoutVariants && allDsl.length > config.minSlidesForLayoutCheck) {
    issues.push({
      type: IssueType.LAYOUT_MISMATCH,
      severity: IssueSeverity.INFO,
      message: `使用了 ${layoutUsage.size} 种布局，可能影响视觉统一性`,
      details: { layouts: [...layoutUsage.entries()] },
    });
  }

  return issues;
}

/**
 * 生成修复建议
 */
function generateFixes(issues, context) {
  const fixes = [];
  const { config } = context;

  for (const issue of issues) {
    if (issue.type === IssueType.COLOR_INCONSISTENCY && issue.details?.topColors) {
      // 建议统一到最常用的颜色
      const topColors = issue.details.topColors.slice(0, config.thresholds.topColorsForFix);
      fixes.push({
        issueType: issue.type,
        description: `建议将颜色统一到主要的 ${topColors.length} 种`,
        autoFixable: false,
        suggestion: { primaryColors: topColors.map((c) => c[0]) },
      });
    }

    if (issue.type === IssueType.FONT_INCONSISTENCY && issue.details?.fonts) {
      const topFont = issue.details.fonts[0]?.[0];
      if (topFont) {
        fixes.push({
          issueType: issue.type,
          description: `建议统一使用 ${topFont} 字体`,
          autoFixable: false,
          suggestion: { primaryFont: topFont },
        });
      }
    }
  }

  return fixes;
}

/**
 * 计算一致性分数
 */
function calculateConsistencyScore(issues, config = REVIEW_CONFIG) {
  let score = 1.0;
  const { scoring } = config;

  for (const issue of issues) {
    if (issue.severity === IssueSeverity.ERROR) score -= scoring.errorPenalty;
    else if (issue.severity === IssueSeverity.WARNING) score -= scoring.warningPenalty;
    else if (issue.severity === IssueSeverity.INFO) score -= scoring.infoPenalty;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * 运行自动审查
 *
 * @param {DeckPackage} deckPackage - Deck package to review
 * @param {DesignSystem} designSystem - Design system for consistency check
 * @param {ReviewOptions} [options={}] - Review options including optional abort signal
 * @returns {Promise<AutoReviewResult>}
 * @throws {ReviewInputError} When input validation fails
 */
export async function runAutoReview(deckPackage, designSystem, options = {}) {
  // Check for abort signal before starting
  if (options.signal?.aborted) {
    return {
      success: false,
      error: "Review aborted",
      issues: [],
      fixes: [],
      score: 0,
    };
  }

  const config = resolveReviewConfig(options);
  const context = { ...buildReviewContext(deckPackage, designSystem, options), config };

  if (context.slideCount === 0) {
    return {
      success: false,
      error: "No slides to review",
      issues: [],
      fixes: [],
      score: 0,
    };
  }

  // Check abort signal before consistency checks
  if (options.signal?.aborted) {
    return {
      success: false,
      error: "Review aborted",
      issues: [],
      fixes: [],
      score: 0,
    };
  }

  // 收集所有问题
  const issues = [
    ...checkColorConsistency(context),
    ...checkFontConsistency(context),
    ...checkLayoutConsistency(context),
  ];

  // Check abort signal after analysis
  if (options.signal?.aborted) {
    return {
      success: false,
      error: "Review aborted",
      issues,
      fixes: [],
      score: 0,
    };
  }

  // 生成修复建议
  const fixes = generateFixes(issues, context);

  // 计算一致性分数
  const score = calculateConsistencyScore(issues, config);

  // 生成摘要
  const summary = buildReviewSummary(issues, score, context, config);

  return {
    success: true,
    issues,
    fixes,
    score,
    summary,
    slideCount: context.slideCount,
    pass: score >= config.minConsistencyScore,
  };
}

/**
 * 构建审查摘要
 */
function buildReviewSummary(issues, score, context, config = REVIEW_CONFIG) {
  const errorCount = issues.filter((i) => i.severity === IssueSeverity.ERROR).length;
  const warningCount = issues.filter((i) => i.severity === IssueSeverity.WARNING).length;
  const infoCount = issues.filter((i) => i.severity === IssueSeverity.INFO).length;
  const { statusThresholds } = config;

  let status = "优秀";
  if (score < statusThresholds.poor) status = "需要改进";
  else if (score < statusThresholds.fair) status = "一般";
  else if (score < statusThresholds.good) status = "良好";

  return {
    status,
    score: Math.round(score * 100),
    slideCount: context.slideCount,
    issueBreakdown: { error: errorCount, warning: warningCount, info: infoCount },
    message: `审查完成：${context.slideCount} 页幻灯片，一致性评分 ${Math.round(score * 100)}%，发现 ${issues.length} 个问题`,
  };
}

/**
 * AutoReviewer 类
 */
export class AutoReviewer {
  /**
   * @param {AutoReviewerOptions} [options={}]
   */
  constructor(options = {}) {
    this._analyzer = options.analyzer || createDeckAnalyzer(options);
    this._editor = options.editor || createDeckEditor(options);
    this._stitcher = options.stitcher || createScreenshotStitcher(options);
    this._config = { ...REVIEW_CONFIG, ...options.config };
  }

  /**
   * 运行审查
   *
   * @param {DeckPackage} deckPackage
   * @param {any} designSystem
   * @param {any} [options={}]
   * @returns {Promise<AutoReviewResult>}
   */
  async review(deckPackage, designSystem, options = {}) {
    return runAutoReview(deckPackage, designSystem, { ...this._config, ...options });
  }

  /**
   * 应用修复
   *
   * @param {DeckPackage} deckPackage
   * @param {ReviewFix[]} fixes
   * @returns {Promise<{ fixedDeckHtmlDsl: string, appliedFixes: Array<any> }>}
   */
  async applyFixes(deckPackage, fixes) {
    this._editor.setDeckPackage(deckPackage);

    const appliedFixes = [];
    for (const fix of fixes) {
      if (fix.autoFixable && fix.edits) {
        const result = await this._editor.batchEdit(fix.edits);
        appliedFixes.push({ fix, result });
      }
    }

    return {
      fixedDeckHtmlDsl: this._editor.getDeckHtmlDsl(),
      appliedFixes,
    };
  }

  /**
   * 获取配置
   *
   * @returns {any}
   */
  getConfig() {
    return { ...this._config };
  }
}

/**
 * @param {AutoReviewerOptions} [options={}]
 * @returns {AutoReviewer}
 */
export function createAutoReviewer(options = {}) {
  return new AutoReviewer(options);
}
