// utils/text-fitting-integration.js
// PDF 文本自适应集成模块 - 连接 text-fitting.js 和 PDF 渲染器

/**
 * PDF 文本渲染器（带自适应缩放）
 *
 * 使用方法：
 * 1. 在 MinerU 结构化翻译完成后调用
 * 2. 自动计算最优字体大小
 * 3. 在 Canvas 上渲染格式保留的译文
 */
class PDFTextRenderer {
  constructor(options = {}) {
    this.fittingEngine = new TextFittingEngine(options.fittingConfig || {});
    this.defaultFontFamily = options.fontFamily || 'Arial, "Microsoft YaHei", "SimHei", sans-serif';
    this.defaultFontColor = options.fontColor || '#000000';
    this.showDebugBorders = options.debugMode || false;
  }

  /**
   * 渲染翻译后的文本到 Canvas
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
   * @param {Array<Object>} translatedItems - 翻译后的 content_list 数据
   * @param {Object} pageInfo - 页面信息 { width, height, pageIndex }
   * @param {string} targetLang - 目标语言
   */
  renderTranslatedText(ctx, translatedItems, pageInfo, targetLang = 'zh-CN') {
    if (!ctx || !translatedItems || !Array.isArray(translatedItems)) {
      console.error('[PDFTextRenderer] 无效的输入参数');
      return;
    }

    // 过滤当前页的文本项
    const pageItems = translatedItems.filter(item =>
      item.page_idx === pageInfo.pageIndex &&
      item.type === 'text' &&
      item.text &&
      item.bbox
    );

    if (pageItems.length === 0) {
      console.log(`[PDFTextRenderer] 页面 ${pageInfo.pageIndex} 没有可渲染的文本`);
      return;
    }

    // 第一步：批量计算全局最优缩放（保持字体一致性）
    const { globalScale, itemScales } = this.fittingEngine.calculateGlobalScale(
      pageItems,
      this.defaultFontFamily,
      targetLang
    );

    console.log(`[PDFTextRenderer] 页面 ${pageInfo.pageIndex} 全局缩放: ${globalScale.toFixed(2)}`);

    // 第二步：逐项渲染
    pageItems.forEach((item, index) => {
      const scaleInfo = itemScales[index];
      if (!scaleInfo) return;

      this._renderTextItem(ctx, item, scaleInfo, pageInfo, targetLang);
    });
  }

  /**
   * 渲染单个文本项
   *
   * @private
   */
  _renderTextItem(ctx, item, scaleInfo, pageInfo, targetLang) {
    const [x0, y0, x1, y1] = item.bbox;
    const bboxWidth = x1 - x0;
    const bboxHeight = y1 - y0;

    // 估算原始字体大小
    const originalFontSize = bboxHeight * 0.8;
    const scaledFontSize = originalFontSize * scaleInfo.scale;

    // 判断是否为 CJK 语言
    const isCJK = this._isTargetLangCJK(targetLang);
    const lineSkip = isCJK ? this.fittingEngine.LINE_SKIP_CJK : this.fittingEngine.LINE_SKIP_WESTERN;

    // 设置字体
    ctx.font = `${scaledFontSize}px ${this.defaultFontFamily}`;
    ctx.fillStyle = this.defaultFontColor;
    ctx.textBaseline = 'top';

    // 调试模式：绘制 bbox 边框
    if (this.showDebugBorders) {
      ctx.strokeStyle = scaleInfo.fitsWithoutExpansion ? '#00ff00' : '#ff0000';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, bboxWidth, bboxHeight);
    }

    // 布局并渲染文本
    const layout = this._layoutTextForRender(
      item.text,
      bboxWidth,
      bboxHeight,
      scaledFontSize,
      ctx,
      lineSkip,
      isCJK
    );

    let currentY = y0;
    const lineHeight = scaledFontSize * lineSkip;

    for (const line of layout.lines) {
      if (currentY + scaledFontSize > y1) {
        // 超出边界，停止渲染（理论上不应该发生）
        console.warn(`[PDFTextRenderer] 文本超出边界: ${item.text.substring(0, 20)}...`);
        break;
      }

      ctx.fillText(line, x0, currentY);
      currentY += lineHeight;
    }
  }

  /**
   * 布局文本并返回行数组
   *
   * @private
   */
  _layoutTextForRender(text, maxWidth, maxHeight, fontSize, ctx, lineSkip, isCJK) {
    const lines = [];
    const words = isCJK ? text.split('') : text.match(/\S+|\s+/g) || [];
    let currentLine = '';
    let currentWidth = 0;

    for (const word of words) {
      const wordWidth = ctx.measureText(word).width;
      const totalWidth = currentWidth + wordWidth;

      if (totalWidth > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = word;
        currentWidth = wordWidth;
      } else {
        currentLine += word;
        currentWidth = totalWidth;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return { lines };
  }

  /**
   * 判断目标语言是否为 CJK
   *
   * @private
   */
  _isTargetLangCJK(targetLang) {
    if (!targetLang) return false;
    const upper = targetLang.toUpperCase();
    return upper.includes('ZH') ||
           upper.includes('JA') ||
           upper.includes('JP') ||
           upper.includes('KO') ||
           upper.includes('KR');
  }

  /**
   * 导出渲染配置（用于调试）
   *
   * @param {Array<Object>} translatedItems
   * @param {string} targetLang
   * @returns {Object}
   */
  exportRenderConfig(translatedItems, targetLang = 'zh-CN') {
    const { globalScale, itemScales } = this.fittingEngine.calculateGlobalScale(
      translatedItems,
      this.defaultFontFamily,
      targetLang
    );

    return {
      globalScale,
      itemCount: translatedItems.length,
      scaleDistribution: this._analyzeScaleDistribution(itemScales),
      recommendations: this._generateRecommendations(itemScales)
    };
  }

  /**
   * 分析缩放分布
   *
   * @private
   */
  _analyzeScaleDistribution(itemScales) {
    const scales = itemScales.filter(s => s != null).map(s => s.scale);
    const min = Math.min(...scales);
    const max = Math.max(...scales);
    const avg = scales.reduce((a, b) => a + b, 0) / scales.length;

    return { min, max, avg, count: scales.length };
  }

  /**
   * 生成优化建议
   *
   * @private
   */
  _generateRecommendations(itemScales) {
    const recommendations = [];
    const needsExpansion = itemScales.filter(s => s && s.requiresExpansion).length;

    if (needsExpansion > 0) {
      recommendations.push({
        type: 'warning',
        message: `有 ${needsExpansion} 个文本块需要扩展容器才能完整显示`
      });
    }

    const lowScaleCount = itemScales.filter(s => s && s.scale < 0.5).length;
    if (lowScaleCount > 0) {
      recommendations.push({
        type: 'info',
        message: `有 ${lowScaleCount} 个文本块的字体被缩小到 50% 以下，可能影响可读性`
      });
    }

    return recommendations;
  }
}

/**
 * 与 history_pdf_compare.js 的集成示例
 *
 * 在 PDFCompareView 类中使用：
 */
class PDFCompareViewEnhanced {
  constructor() {
    // ... 原有代码 ...

    // 初始化文本渲染器
    this.textRenderer = new PDFTextRenderer({
      fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
      fontColor: '#000000',
      debugMode: false, // 设置为 true 可显示 bbox 边框
      fittingConfig: {
        // 自定义配置（可选）
        initialScale: 1.0,
        minScale: 0.3,
        lineSkipCJK: 1.5,
        lineSkipWestern: 1.3
      }
    });
  }

  /**
   * 渲染翻译侧的页面（增强版）
   */
  async renderTranslationPage(pageIndex) {
    // ... 获取 Canvas 上下文 ...
    const ctx = this.translationContext;

    // 渲染原始 PDF 背景
    await this.renderOriginalPDFPage(ctx, pageIndex);

    // 渲染翻译文本（带自适应缩放）
    this.textRenderer.renderTranslatedText(
      ctx,
      this.translatedContentList, // 来自 mineru-structured-translation.js
      {
        width: this.pageImageSizes[pageIndex]?.width || 595,
        height: this.pageImageSizes[pageIndex]?.height || 842,
        pageIndex: pageIndex
      },
      this.targetLang || 'zh-CN'
    );

    console.log('[PDFCompareView] 翻译页面渲染完成:', pageIndex);
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.PDFTextRenderer = PDFTextRenderer;
  window.PDFCompareViewEnhanced = PDFCompareViewEnhanced;
}

// 模块化导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PDFTextRenderer, PDFCompareViewEnhanced };
}
