/**
 * Auto Reviewer - Pipeline 自动审查阶段
 *
 * 生成完成后自动进行全局风格检查：
 * - 多页截图分析
 * - DSL 一致性检查
 * - 自动修复建议
 */

import { createDeckAnalyzer, analyzeStyleConsistency, collectAllDsl } from "../runtime/deck-analyzer.js";
import { createDeckEditor } from "../runtime/deck-editor.js";
import { createScreenshotStitcher } from "../runtime/screenshot-stitcher.js";

/**
 * @typedef {object} DeckPackage
 * @property {string} deckHtmlDsl
 * @property {any[]} [slidesMeta]
 */

/**
 * @typedef {object} SlideDsl
 * @property {number} slideIndex
 * @property {string} html
 * @property {any[]} elements
 */

/**
 * @typedef {object} ReviewContext
 * @property {string} deckHtmlDsl
 * @property {any[]} slidesMeta
 * @property {SlideDsl[]} allDsl
 * @property {any} designSystem
 * @property {number} slideCount
 * @property {any} options
 */

/**
 * @typedef {object} ReviewIssue
 * @property {string} type
 * @property {"error"|"warning"|"info"|string} severity
 * @property {string} message
 * @property {any} [details]
 */

/**
 * @typedef {object} ReviewFix
 * @property {string} issueType
 * @property {string} description
 * @property {boolean} autoFixable
 * @property {any} [suggestion]
 * @property {any} [edits]
 */

/**
 * @typedef {object} ReviewSummary
 * @property {string} status
 * @property {number} score
 * @property {number} slideCount
 * @property {{ error: number, warning: number, info: number }} issueBreakdown
 * @property {string} message
 */

/**
 * @typedef {object} AutoReviewResult
 * @property {boolean} success
 * @property {string} [error]
 * @property {ReviewIssue[]} issues
 * @property {ReviewFix[]} fixes
 * @property {number} score
 * @property {ReviewSummary} [summary]
 * @property {number} [slideCount]
 * @property {boolean} [pass]
 */

/**
 * @typedef {object} AutoReviewerOptions
 * @property {any} [analyzer]
 * @property {any} [editor]
 * @property {any} [stitcher]
 * @property {any} [config]
 */

/**
 * 审查配置
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
 * 审查问题类型
 */
export const IssueType = {
  COLOR_INCONSISTENCY: "color_inconsistency",
  FONT_INCONSISTENCY: "font_inconsistency",
  LAYOUT_MISMATCH: "layout_mismatch",
  VISUAL_IMBALANCE: "visual_imbalance",
  MISSING_ELEMENT: "missing_element",
  STYLE_DEVIATION: "style_deviation",
};

/**
 * 问题严重程度
 */
export const IssueSeverity = {
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
};

/**
 * 构建审查上下文
 *
 * @param {DeckPackage} deckPackage
 * @param {any} designSystem
 * @param {any} [options={}]
 * @returns {ReviewContext}
 */
export function buildReviewContext(deckPackage, designSystem, options = {}) {
  const allDsl = collectAllDsl(deckPackage?.deckHtmlDsl || "");
  return {
    deckHtmlDsl: deckPackage?.deckHtmlDsl || "",
    slidesMeta: deckPackage?.slidesMeta || [],
    allDsl,
    designSystem,
    slideCount: allDsl.length,
    options,
  };
}

/**
 * 检查配色一致性
 */
function checkColorConsistency(context) {
  const issues = [];
  const { allDsl, designSystem } = context;

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
  if (colorUsage.size > REVIEW_CONFIG.maxColorVariants) {
    issues.push({
      type: IssueType.COLOR_INCONSISTENCY,
      severity: IssueSeverity.WARNING,
      message: `使用了 ${colorUsage.size} 种颜色，超过建议的 ${REVIEW_CONFIG.maxColorVariants} 种`,
      details: {
        colorCount: colorUsage.size,
        topColors: [...colorUsage.entries()].sort((a, b) => b[1] - a[1]).slice(0, REVIEW_CONFIG.thresholds.topColorsToShow),
      },
    });
  }

  // 检查是否有偏离设计系统的颜色
  if (expectedColors.size > 0) {
    const unexpectedColors = [...colorUsage.keys()].filter((c) => !expectedColors.has(c));
    if (unexpectedColors.length > REVIEW_CONFIG.thresholds.unexpectedColorWarning) {
      issues.push({
        type: IssueType.STYLE_DEVIATION,
        severity: IssueSeverity.INFO,
        message: `发现 ${unexpectedColors.length} 种未在设计系统中定义的颜色`,
        details: { unexpectedColors: unexpectedColors.slice(0, REVIEW_CONFIG.thresholds.unexpectedColorsToShow) },
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
  const { allDsl, designSystem } = context;

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

  if (fontUsage.size > REVIEW_CONFIG.maxFontVariants) {
    issues.push({
      type: IssueType.FONT_INCONSISTENCY,
      severity: IssueSeverity.WARNING,
      message: `使用了 ${fontUsage.size} 种字体，超过建议的 ${REVIEW_CONFIG.maxFontVariants} 种`,
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
  const { allDsl } = context;

  const layoutUsage = new Map();

  for (const slide of allDsl) {
    const layoutMatch = slide.html.match(/data-layout="([^"]+)"/);
    const layout = layoutMatch ? layoutMatch[1] : "unknown";
    layoutUsage.set(layout, (layoutUsage.get(layout) || 0) + 1);
  }

  // 检查是否有过多的布局类型
  if (layoutUsage.size > REVIEW_CONFIG.maxLayoutVariants && allDsl.length > REVIEW_CONFIG.minSlidesForLayoutCheck) {
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

  for (const issue of issues) {
    if (issue.type === IssueType.COLOR_INCONSISTENCY && issue.details?.topColors) {
      // 建议统一到最常用的颜色
      const topColors = issue.details.topColors.slice(0, REVIEW_CONFIG.thresholds.topColorsForFix);
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
 * @param {DeckPackage} deckPackage
 * @param {any} designSystem
 * @param {any} [options={}]
 * @returns {Promise<AutoReviewResult>}
 */
export async function runAutoReview(deckPackage, designSystem, options = {}) {
  const context = buildReviewContext(deckPackage, designSystem, options);

  if (context.slideCount === 0) {
    return {
      success: false,
      error: "No slides to review",
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

  // 生成修复建议
  const fixes = generateFixes(issues, context);

  // 计算一致性分数
  const score = calculateConsistencyScore(issues);

  // 生成摘要
  const summary = buildReviewSummary(issues, score, context);

  return {
    success: true,
    issues,
    fixes,
    score,
    summary,
    slideCount: context.slideCount,
    pass: score >= REVIEW_CONFIG.minConsistencyScore,
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
