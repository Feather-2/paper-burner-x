/**
 * TextFitting.js
 * 文本自适应渲染模块
 * 负责文本的自适应布局、换行、公式渲染等功能
 */

class TextFittingAdapter {
  constructor(options = {}) {
    this.textFittingEngine = null;
    this.globalFontSizeCache = new Map(); // idx -> { estimatedFontSize, bbox }
    this.hasPreprocessed = false;

    // 公式缓存
    this._formulaCache = new Map();
    this._katexWarned = false;
    this._katexUnavailableWarned = false;

    // 可配置选项
    this.options = Object.assign({
      initialScale: 1.0,
      minScale: 0.3,
      scaleStepHigh: 0.05,
      scaleStepLow: 0.1,
      lineSkipCJK: 1.5,
      lineSkipWestern: 1.3,
      minLineHeight: 1.05,
      globalFontScale: 0.85
    }, options);
  }

  /**
   * 初始化文本自适应引擎
   */
  initialize() {
    // 检查 TextFittingEngine 是否已加载
    if (typeof TextFittingEngine === 'undefined') {
      console.error('[TextFittingAdapter] TextFittingEngine 未加载！请确保 js/utils/text-fitting.js 已正确引入');
      console.error('[TextFittingAdapter] 当前可用类:', typeof TextFittingEngine, typeof PDFTextRenderer);
      return;
    }

    try {
      this.textFittingEngine = new TextFittingEngine({
        initialScale: this.options.initialScale,
        minScale: this.options.minScale,
        scaleStepHigh: this.options.scaleStepHigh,
        scaleStepLow: this.options.scaleStepLow,
        lineSkipCJK: this.options.lineSkipCJK,
        lineSkipWestern: this.options.lineSkipWestern,
        minLineHeight: this.options.minLineHeight
      });

      console.log('[TextFittingAdapter] 文本自适应引擎已启用');
    } catch (error) {
      console.error('[TextFittingAdapter] 文本自适应引擎初始化失败:', error);
    }
  }

  /**
   * 预处理：计算全局统一的字号
   * @param {Array} contentListJson - 原文内容列表
   * @param {Array} translatedContentList - 译文内容列表
   */
  preprocessGlobalFontSizes(contentListJson, translatedContentList) {
    if (this.hasPreprocessed) return;

    console.log('[TextFittingAdapter] 开始预处理全局字号...');
    const startTime = performance.now();

    const globalFontScale = this.options.globalFontScale;
    const BBOX_NORMALIZED_RANGE = 1000;

    contentListJson.forEach((item, idx) => {
      if (item.type !== 'text' || !item.bbox) return;

      const translatedItem = translatedContentList[idx];
      if (!translatedItem || !translatedItem.text) return;

      const bbox = item.bbox;
      const height = (bbox[3] - bbox[1]) / BBOX_NORMALIZED_RANGE;

      // 字号 = bbox高度 * 全局缩放因子
      const estimatedFontSize = height * globalFontScale;

      this.globalFontSizeCache.set(idx, {
        estimatedFontSize: estimatedFontSize,
        bbox: bbox
      });
    });

    console.log(`[TextFittingAdapter] 预处理完成：全局缩放=${globalFontScale}, 耗时=${(performance.now() - startTime).toFixed(0)}ms`);
    this.hasPreprocessed = true;
  }

  /**
   * 绘制纯文本到指定区域（带回退方案）
   * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
   * @param {string} text - 文本内容
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {number} width - 区域宽度
   * @param {number} height - 区域高度
   * @param {boolean} isShortText - 是否为短文本（如标题）
   * @param {Object} cachedInfo - 预处理的字号信息
   */
  drawPlainTextInBox(ctx, text, x, y, width, height, isShortText = false, cachedInfo = null) {
    // 优先使用新的文本自适应引擎
    if (this.textFittingEngine) {
      const suggestedFontSize = cachedInfo ? cachedInfo.estimatedFontSize : null;
      return this.drawPlainTextWithFitting(ctx, text, x, y, width, height, isShortText, suggestedFontSize);
    }

    // 回退方案：如果引擎未初始化
    let bestFontSize = 8;
    let bestLines = [];

    let maxFontSize = Math.min(width / 10, height / 3);
    if (isShortText) {
      maxFontSize = Math.max(maxFontSize, 18);
    }

    // 从大到小寻找最佳字号
    let foundPerfectFit = false;
    for (let fontSize = maxFontSize; fontSize >= 3; fontSize -= 0.5) {
      ctx.font = `${fontSize}px sans-serif`;
      const lines = this.wrapText(ctx, text, width - 4);
      const lineHeight = fontSize * 1.5;

      const totalHeight = lines.length > 1
        ? (lines.length - 1) * lineHeight + fontSize * 1.3 + 8
        : fontSize * 1.3 + 8;

      if (totalHeight <= height) {
        bestFontSize = fontSize;
        bestLines = lines;
        foundPerfectFit = true;
        break;
      }
    }

    // 极端情况处理
    if (!foundPerfectFit) {
      bestFontSize = 3;
      ctx.font = `${bestFontSize}px sans-serif`;
      const allLines = this.wrapText(ctx, text, width - 4);
      const lineHeight = bestFontSize * 1.5;

      const totalHeight = allLines.length > 1
        ? (allLines.length - 1) * lineHeight + bestFontSize * 1.3 + 8
        : bestFontSize * 1.3 + 8;

      if (totalHeight > height) {
        const availableHeight = height - 8;
        const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
        bestLines = allLines.slice(0, maxLines);
      } else {
        bestLines = allLines;
      }
    }

    // 短文本最小字号限制
    if (isShortText && bestLines.length === 1 && bestFontSize < 14) {
      bestFontSize = 14;
      ctx.font = `${bestFontSize}px sans-serif`;
      bestLines = this.wrapText(ctx, text, width - 4);
    }

    // 绘制文字
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.font = `${bestFontSize}px sans-serif`;

    const lineHeight = bestFontSize * 1.5;

    bestLines.forEach((line, i) => {
      const lineY = y + 4 + i * lineHeight;
      ctx.fillText(line, x + 2, lineY);
    });
  }

  /**
   * 使用文本自适应算法绘制文本（优化版）
   * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
   * @param {string} text - 文本内容
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {number} width - 区域宽度
   * @param {number} height - 区域高度
   * @param {boolean} isShortText - 是否为短文本
   * @param {number} suggestedFontSize - 建议字号（来自预处理）
   */
  drawPlainTextWithFitting(ctx, text, x, y, width, height, isShortText = false, suggestedFontSize = null) {
    try {
      // 判断是否为 CJK 语言
      const isCJK = /[\u4e00-\u9fa5]/.test(text);
      const lineSkip = isCJK ? 1.25 : 1.15;

      // 内边距
      const paddingTop = 2;
      const paddingX = 2;
      const availableHeight = height - paddingTop * 2;
      const availableWidth = width - paddingX * 2;

      // 字号范围估算
      const estimatedSingleLineFontSize = height * 0.8;
      const minFontSize = isShortText ? 10 : 6;
      const maxFontSize = Math.min(estimatedSingleLineFontSize * 1.5, height * 1.2);

      const hasNewlines = text.includes('\n');
      const textLength = text.length;

      console.log(`[TextFitting] 开始: "${text.substring(0, 30)}..." bbox=${width.toFixed(0)}x${height.toFixed(0)}, 字号范围=${minFontSize.toFixed(1)}-${maxFontSize.toFixed(1)}px, 文本长度=${textLength}, 有换行=${hasNewlines}`);

      // 宽度因子（优先使用全宽）
      const widthFactors = (textLength < 20 || hasNewlines)
        ? [1.0]
        : [1.0, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70];

      let bestSolution = null;

      // 对每个宽度因子，使用二分查找找到最大可用字号
      for (const widthFactor of widthFactors) {
        const effectiveWidth = availableWidth * widthFactor;

        let low = minFontSize;
        let high = maxFontSize;
        let foundFontSize = null;
        let foundLines = null;

        while (high - low > 0.5) {
          const mid = (low + high) / 2;

          ctx.font = `${mid}px Arial, "Microsoft YaHei", "SimHei", sans-serif`;
          const lines = this.wrapText(ctx, text, effectiveWidth);
          const lineHeight = mid * lineSkip;

          const totalHeight = lines.length === 1
            ? mid * 1.2
            : (lines.length - 1) * lineHeight + mid * 1.2;

          if (totalHeight <= availableHeight) {
            foundFontSize = mid;
            foundLines = lines;
            low = mid;
          } else {
            high = mid;
          }
        }

        if (foundFontSize) {
          if (!bestSolution || foundFontSize > bestSolution.fontSize) {
            bestSolution = { fontSize: foundFontSize, widthFactor, lines: foundLines };
          }
        }
      }

      // 没找到合适方案，使用最小字号
      if (!bestSolution) {
        ctx.font = `${minFontSize}px Arial, "Microsoft YaHei", "SimHei", sans-serif`;
        const lines = this.wrapText(ctx, text, availableWidth);
        const lineHeight = minFontSize * lineSkip;
        const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
        bestSolution = {
          fontSize: minFontSize,
          widthFactor: 1.0,
          lines: lines.slice(0, maxLines)
        };
      }

      // 绘制文字
      const { fontSize, lines } = bestSolution;
      const lineHeight = fontSize * lineSkip;

      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';
      ctx.font = `${fontSize}px Arial, "Microsoft YaHei", "SimHei", sans-serif`;

      const totalTextHeight = lines.length === 1
        ? fontSize
        : (lines.length - 1) * lineHeight + fontSize;

      const startY = y + paddingTop + (availableHeight - totalTextHeight) / 2;

      lines.forEach((line, i) => {
        const lineY = startY + i * lineHeight;
        const lineWidth = ctx.measureText(line).width;
        const lineX = x + paddingX + (availableWidth - lineWidth) / 2;
        ctx.fillText(line, lineX, lineY);
      });

      console.log(`[TextFitting] 完成: 字号=${fontSize.toFixed(1)}px, 行数=${lines.length}, 宽度因子=${bestSolution.widthFactor}`);

    } catch (error) {
      console.error('[TextFitting] 渲染失败:', error);
      // 回退到简单绘制
      ctx.fillStyle = '#000';
      ctx.font = '12px sans-serif';
      ctx.fillText(text.substring(0, 50), x + 2, y + 2);
    }
  }

  /**
   * 文本换行算法
   * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
   * @param {string} text - 文本内容
   * @param {number} maxWidth - 最大宽度
   * @returns {Array} 换行后的文本数组
   */
  wrapText(ctx, text, maxWidth) {
    if (!text) return [];

    const lines = [];
    let currentLine = '';

    // 按自然断句分段
    const segments = text.split(/([。？！，、；：\n])/);

    for (let segment of segments) {
      if (!segment) continue;

      // 标点符号直接加到当前行
      if (/^[。？！，、；：]$/.test(segment)) {
        currentLine += segment;
        continue;
      }

      // 换行符强制换行
      if (segment === '\n') {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        continue;
      }

      // 按字符逐个添加
      for (let i = 0; i < segment.length; i++) {
        const char = segment[i];
        const testLine = currentLine + char;
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLine.length > 0) {
          lines.push(currentLine);
          currentLine = char;
        } else {
          currentLine = testLine;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  }

  /**
   * 渲染文本中的数学公式（KaTeX）
   * @param {string} text - 包含公式的文本
   * @returns {string} 渲染后的 HTML
   */
  renderFormulasInText(text) {
    // 使用缓存避免重复渲染
    if (this._formulaCache.has(text)) {
      return this._formulaCache.get(text);
    }

    if (typeof window.renderMathInElement === 'function') {
      const tempContainer = document.createElement('div');
      tempContainer.textContent = text;

      try {
        window.renderMathInElement(tempContainer, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ],
          throwOnError: false,
          strict: false
        });
        const result = tempContainer.innerHTML;

        // 缓存结果（最多 500 条）
        if (this._formulaCache.size < 500) {
          this._formulaCache.set(text, result);
        }

        return result;
      } catch (e) {
        if (!this._katexWarned) {
          console.warn('[TextFittingAdapter] KaTeX 渲染失败:', e);
          this._katexWarned = true;
        }
        return text;
      }
    } else {
      if (!this._katexUnavailableWarned) {
        console.warn('[TextFittingAdapter] renderMathInElement 不可用');
        this._katexUnavailableWarned = true;
      }
      return text;
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.globalFontSizeCache.clear();
    this._formulaCache.clear();
    this.hasPreprocessed = false;
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextFittingAdapter;
}
