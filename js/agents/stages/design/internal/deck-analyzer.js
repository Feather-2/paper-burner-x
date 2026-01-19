/**
 * DeckAnalyzer - 共享分析层
 *
 * 为 Reviewer 和 Edit Agent 提供统一的分析能力：
 * - 多页截图拼接
 * - DSL 收集
 * - 风格一致性分析
 * - 元素定位
 */

import { parseSections, extractElements } from "../refiner/react-refiner-tools.js";

/**
 * @typedef {import("../refiner/react-refiner-tools.js").ExtractedElement} ExtractedElement
 */

/**
 * @typedef {object} DeckPackage
 * @property {string} deckHtmlDsl
 * @property {any[]} [slidesMeta]
 */

/**
 * @typedef {object} SlideDsl
 * @property {number} slideIndex
 * @property {string} html
 * @property {ExtractedElement[]} elements
 */

/**
 * @typedef {object} AnalyzerIssue
 * @property {string} type
 * @property {"warning"|"error"|"info"|string} severity
 * @property {string} message
 * @property {any} [details]
 */

/**
 * @typedef {object} AnalyzerStats
 * @property {number} totalSlides
 * @property {Map<string, number>} colorUsage
 * @property {Map<string, number>} fontUsage
 * @property {Map<string, number>} layoutTypes
 */

/**
 * 分析器配置（软限制，仅供参考）
 */
/** @type {{ softLimits: any, locateCandidates: number }} */
export const ANALYZER_CONFIG = {
  // 这些是软限制，最终由 AI 评判
  softLimits: {
    maxColors: 8,
    recommendedColors: { min: 5, max: 8 },
    maxFonts: 3,
    recommendedFonts: { min: 2, max: 3 },
  },
  // 元素定位候选数量
  locateCandidates: 5,
};

/**
 * 收集所有页面的 DSL
 *
 * @param {string} deckHtmlDsl
 * @returns {SlideDsl[]}
 */
export function collectAllDsl(deckHtmlDsl) {
  const sections = parseSections(deckHtmlDsl);
  return sections.map((html, index) => ({
    slideIndex: index,
    html,
    elements: extractElements(html),
  }));
}

/**
 * 提取设计令牌摘要
 *
 * @param {any} designSystem
 * @returns {{ theme?: string, colorScheme?: string, fontFamily?: string, accentColor?: string } | null}
 */
export function extractDesignTokensSummary(designSystem) {
  if (!designSystem) return null;
  const tokens = designSystem.designTokens || designSystem.tokens || designSystem;
  return {
    theme: designSystem.theme || tokens.theme,
    colorScheme: tokens.colorScheme || tokens.colors?.primary,
    fontFamily: tokens.fontFamily || tokens.typography?.bodyFont,
    accentColor: tokens.accentColor || tokens.colors?.accent,
  };
}

/**
 * 分析风格一致性
 *
 * @param {SlideDsl[]} allSlidesDsl
 * @param {any} designSystem
 * @returns {{ issues: AnalyzerIssue[], stats: AnalyzerStats }}
 */
export function analyzeStyleConsistency(allSlidesDsl, designSystem) {
  const issues = [];
  const stats = {
    totalSlides: allSlidesDsl.length,
    colorUsage: new Map(),
    fontUsage: new Map(),
    layoutTypes: new Map(),
  };

  for (const slide of allSlidesDsl) {
    // 提取布局类型
    const layoutMatch = slide.html.match(/data-layout="([^"]+)"/);
    if (layoutMatch) {
      const layout = layoutMatch[1];
      stats.layoutTypes.set(layout, (stats.layoutTypes.get(layout) || 0) + 1);
    }

    // 提取颜色使用
    const colorMatches = slide.html.matchAll(/(?:color|background):\s*([#\w]+)/gi);
    for (const m of colorMatches) {
      const color = m[1].toLowerCase();
      stats.colorUsage.set(color, (stats.colorUsage.get(color) || 0) + 1);
    }

    // 提取字体使用
    const fontMatches = slide.html.matchAll(/font-family:\s*([^;'"]+)/gi);
    for (const m of fontMatches) {
      const font = m[1].trim().toLowerCase();
      stats.fontUsage.set(font, (stats.fontUsage.get(font) || 0) + 1);
    }
  }

  // 检查颜色一致性（软限制）
  const { softLimits } = ANALYZER_CONFIG;
  if (stats.colorUsage.size > softLimits.maxColors) {
    issues.push({
      type: "color_inconsistency",
      severity: "warning",
      message: `使用了 ${stats.colorUsage.size} 种颜色，建议控制在 ${softLimits.recommendedColors.min}-${softLimits.recommendedColors.max} 种以内`,
      details: { colorCount: stats.colorUsage.size, softLimit: softLimits.maxColors },
    });
  }

  // 检查字体一致性（软限制）
  if (stats.fontUsage.size > softLimits.maxFonts) {
    issues.push({
      type: "font_inconsistency",
      severity: "warning",
      message: `使用了 ${stats.fontUsage.size} 种字体，建议控制在 ${softLimits.recommendedFonts.min}-${softLimits.recommendedFonts.max} 种以内`,
      details: { fontCount: stats.fontUsage.size, softLimit: softLimits.maxFonts },
    });
  }

  return { issues, stats };
}

/**
 * 定位元素（自然语言 → selector）
 *
 * @param {string} slideHtml
 * @param {string} description
 * @returns {{ found: boolean, element: ExtractedElement|null, selector: string|null, candidates?: ExtractedElement[] }}
 */
export function locateElement(slideHtml, description) {
  const elements = extractElements(slideHtml);
  const descLower = description.toLowerCase();

  // 简单匹配策略
  for (const el of elements) {
    const elText = (el.textPreview || "").toLowerCase();
    const elId = (el.elementId || "").toLowerCase();
    const elClass = (el.class || "").toLowerCase();

    if (elText.includes(descLower) || elId.includes(descLower) || elClass.includes(descLower)) {
      return { found: true, element: el, selector: `[data-el="${el.elementId}"]` };
    }
  }

  // 按标签类型匹配
  const tagKeywords = {
    标题: ["h1", "h2", "h3"],
    图片: ["img"],
    图表: ["svg", "canvas"],
    文本: ["p", "span", "div"],
    列表: ["ul", "ol", "li"],
  };

  for (const [keyword, tags] of Object.entries(tagKeywords)) {
    if (descLower.includes(keyword)) {
      const match = elements.find((el) => tags.includes(el.tag));
      if (match) {
        return { found: true, element: match, selector: `[data-el="${match.elementId}"]` };
      }
    }
  }

  return { found: false, element: null, selector: null, candidates: elements.slice(0, ANALYZER_CONFIG.locateCandidates) };
}

/**
 * DeckAnalyzer 类
 */
export class DeckAnalyzer {
  /**
   * @param {{ screenshotFn?: Function, stitcher?: any }} [options={}]
   */
  constructor(options = {}) {
    this._screenshotFn = options.screenshotFn;
    this._stitcher = options.stitcher;
  }

  /**
   * 创建 deck 概览（多页截图拼接）
   *
   * @param {DeckPackage} deckPackage
   * @param {{ scale?: number, includeScreenshots?: boolean, timeoutMs?: number, slideTimeoutMs?: number } & Record<string, any>} [options={}]
   * @returns {Promise<{ success: boolean, error?: string, data?: any }>}
   */
  async createDeckOverview(deckPackage, options = {}) {
    if (!this._screenshotFn) {
      return { success: false, error: "screenshotFn not provided" };
    }

    const deckHtmlDsl = deckPackage?.deckHtmlDsl || "";
    const sections = parseSections(deckHtmlDsl);
    if (!sections.length) {
      return { success: false, error: "No slides found" };
    }

    const slideTimeoutMs = options.slideTimeoutMs ?? 10000; // 每页超时 10s
    const totalTimeoutMs = options.timeoutMs ?? 60000; // 总超时 60s
    const startTime = Date.now();

    // 带超时的截图辅助函数
    const takeScreenshotWithTimeout = async (slideIndex, scale) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), slideTimeoutMs);

      try {
        const result = await Promise.race([
          this._screenshotFn({ slideIndex, scale, signal: controller.signal }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Slide ${slideIndex} screenshot timeout`)), slideTimeoutMs)
          ),
        ]);
        return result?.data?.base64 || null;
      } catch {
        return null; // 超时或错误，返回 null
      } finally {
        clearTimeout(timeoutId);
      }
    };

    // 获取所有截图，带总超时检查
    const screenshots = [];
    for (let i = 0; i < sections.length; i++) {
      if (Date.now() - startTime > totalTimeoutMs) {
        // 超过总超时，返回部分结果
        return {
          success: true,
          data: {
            screenshots,
            slideCount: sections.length,
            partial: true,
            completedSlides: i,
          },
        };
      }
      const base64 = await takeScreenshotWithTimeout(i, options.scale || 1);
      screenshots.push(base64);
    }

    // 如果有 stitcher，拼接截图
    if (this._stitcher && typeof this._stitcher.createDeckOverview === "function") {
      const stitched = await this._stitcher.createDeckOverview(screenshots, options);
      return { success: true, data: { overview: stitched, slideCount: sections.length } };
    }

    return { success: true, data: { screenshots, slideCount: sections.length } };
  }

  /**
   * 收集所有页面 DSL
   *
   * @param {DeckPackage} deckPackage
   * @returns {SlideDsl[]}
   */
  collectAllDsl(deckPackage) {
    return collectAllDsl(deckPackage?.deckHtmlDsl || "");
  }

  /**
   * 风格一致性分析
   *
   * @param {DeckPackage} deckPackage
   * @param {any} designSystem
   * @returns {{ issues: AnalyzerIssue[], stats: AnalyzerStats }}
   */
  analyzeStyleConsistency(deckPackage, designSystem) {
    const allDsl = this.collectAllDsl(deckPackage);
    return analyzeStyleConsistency(allDsl, designSystem);
  }

  /**
   * 定位元素
   *
   * @param {string} slideHtml
   * @param {string} description
   * @returns {{ found: boolean, element: ExtractedElement|null, selector: string|null, candidates?: ExtractedElement[] }}
   */
  locateElement(slideHtml, description) {
    return locateElement(slideHtml, description);
  }

  /**
   * 综合分析
   *
   * @param {DeckPackage} deckPackage
   * @param {any} designSystem
   * @param {{ includeScreenshots?: boolean } & Record<string, any>} [options={}]
   * @returns {Promise<{ slideCount: number, allDsl: SlideDsl[], styleAnalysis: { issues: AnalyzerIssue[], stats: AnalyzerStats }, tokensSummary: any, overview: any }>}
   */
  async analyze(deckPackage, designSystem, options = {}) {
    const allDsl = this.collectAllDsl(deckPackage);
    const styleAnalysis = analyzeStyleConsistency(allDsl, designSystem);
    const tokensSummary = extractDesignTokensSummary(designSystem);

    let overview = null;
    if (options.includeScreenshots !== false && this._screenshotFn) {
      const overviewResult = await this.createDeckOverview(deckPackage, options);
      if (overviewResult.success) {
        overview = overviewResult.data;
      }
    }

    return {
      slideCount: allDsl.length,
      allDsl,
      styleAnalysis,
      tokensSummary,
      overview,
    };
  }
}

/**
 * @param {{ screenshotFn?: Function, stitcher?: any } & Record<string, any>} [options={}]
 * @returns {DeckAnalyzer}
 */
export function createDeckAnalyzer(options = {}) {
  return new DeckAnalyzer(options);
}
