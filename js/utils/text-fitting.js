// utils/text-fitting.js
// 文本自适应算法 - 为 PDF 保留格式翻译优化

/**
 * 文本自适应引擎
 *
 * 核心功能：
 * 1. 自动计算最优字体大小，让翻译文本完美适配原始 bbox
 * 2. 智能换行和行距控制
 * 3. CJK 和西文混排优化
 * 4. 空间不足时自动缩放或扩展容器
 *
 * 设计原则：
 * - 渐进式缩放搜索（从 100% 开始逐步缩小）
 * - 全局一致性（使用统计方法统一字体大小）
 * - 智能空间扩展（优先向下，次选向右）
 */
class TextFittingEngine {
  constructor(options = {}) {
    // 核心参数
    this.INITIAL_SCALE = options.initialScale || 1.0;
    this.MIN_SCALE = options.minScale || 0.1;
    this.SCALE_STEP_HIGH = options.scaleStepHigh || 0.05; // >0.6 时的步长
    this.SCALE_STEP_LOW = options.scaleStepLow || 0.1;    // <0.6 时的步长
    this.EXPAND_THRESHOLD = options.expandThreshold || 0.7; // 触发空间扩展的阈值

    // 行距配置（根据排版规范优化）
    this.LINE_SKIP_CJK = options.lineSkipCJK || 1.30;  // 降低中文行距，更紧凑
    this.LINE_SKIP_WESTERN = options.lineSkipWestern || 1.20;  // 降低西文行距
    this.MIN_LINE_HEIGHT = options.minLineHeight || 1.05;

    // 间距配置
    this.CJK_SPACE_WIDTH_RATIO = options.cjkSpaceRatio || 0.5;
    this.MIXED_LANG_SPACE_RATIO = options.mixedLangSpaceRatio || 0.5;
    this.FIRST_LINE_INDENT_SPACES = options.firstLineIndent || 4;

    // 扩展边距
    this.BOTTOM_EXPAND_MARGIN = options.bottomExpandMargin || 2;
    this.RIGHT_EXPAND_MARGIN = options.rightExpandMargin || -5;

    // Canvas 上下文（用于精确测量文本宽度）
    this._measureCanvas = null;
    this._measureContext = null;
  }

  /**
   * 为单个段落计算最优缩放因子
   *
   * @param {string} text - 翻译后的文本
   * @param {Object} bbox - 边界框 [x0, y0, x1, y1]
   * @param {number} originalFontSize - 原始字体大小
   * @param {string} fontFamily - 字体族
   * @param {boolean} isCJK - 是否为 CJK 语言
   * @param {Object} options - 额外选项
   * @returns {Object} { scale, reason, fitsWithoutExpansion }
   */
  calculateOptimalScale(text, bbox, originalFontSize, fontFamily = 'Arial', isCJK = false, options = {}) {
    if (!text || !bbox || bbox.length < 4) {
      return { scale: 1.0, reason: 'invalid_input', fitsWithoutExpansion: true };
    }

    const [x0, y0, x1, y1] = bbox;
    const availableWidth = x1 - x0;
    const availableHeight = y1 - y0;

    if (availableWidth <= 0 || availableHeight <= 0) {
      return { scale: 1.0, reason: 'invalid_bbox', fitsWithoutExpansion: true };
    }

    // 获取行距倍数
    const lineSkip = isCJK ? this.LINE_SKIP_CJK : this.LINE_SKIP_WESTERN;
    let currentScale = this.INITIAL_SCALE;

    // 渐进式搜索最优缩放
    while (currentScale >= this.MIN_SCALE) {
      const scaledFontSize = originalFontSize * currentScale;
      const layout = this._layoutText(
        text,
        availableWidth,
        availableHeight,
        scaledFontSize,
        fontFamily,
        lineSkip,
        isCJK,
        options
      );

      // 如果所有文本都放得下
      if (layout.fitsCompletely) {
        return {
          scale: currentScale,
          reason: 'fits_perfectly',
          fitsWithoutExpansion: true,
          lineCount: layout.lineCount,
          actualHeight: layout.actualHeight
        };
      }

      // 减小缩放因子
      if (currentScale > 0.6) {
        currentScale -= this.SCALE_STEP_HIGH;
      } else {
        currentScale -= this.SCALE_STEP_LOW;
      }
    }

    // 无法适配，返回最小缩放
    return {
      scale: this.MIN_SCALE,
      reason: 'requires_expansion',
      fitsWithoutExpansion: false,
      requiresExpansion: true
    };
  }

  /**
   * 布局文本（模拟排版）
   *
   * @private
   * @param {string} text
   * @param {number} maxWidth
   * @param {number} maxHeight
   * @param {number} fontSize
   * @param {string} fontFamily
   * @param {number} lineSkip
   * @param {boolean} isCJK
   * @param {Object} options
   * @returns {Object} { fitsCompletely, lineCount, actualHeight }
   */
  _layoutText(text, maxWidth, maxHeight, fontSize, fontFamily, lineSkip, isCJK, options = {}) {
    const lines = [];
    const words = this._tokenizeText(text, isCJK);
    let currentLine = '';
    let currentWidth = 0;
    const spaceWidth = this._measureTextWidth(' ', fontSize, fontFamily);
    const cjkSpaceWidth = fontSize * this.CJK_SPACE_WIDTH_RATIO;

    // 首行缩进
    if (options.firstLineIndent) {
      currentWidth = cjkSpaceWidth * this.FIRST_LINE_INDENT_SPACES;
    }

    for (let i = 0; i < words.length; i++) {
      const word = words[i];

      // 处理换行符：强制换行（和 wrapText 保持一致）
      if (word === '\n') {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
          currentWidth = 0;
        }
        continue;
      }

      const wordWidth = this._measureTextWidth(word, fontSize, fontFamily);

      // 标点符号：直接加到当前行（和 wrapText 保持一致）
      if (isCJK && /^[。？！，、；：]$/.test(word)) {
        currentLine += word;
        currentWidth += wordWidth;
        continue;
      }

      // 中英文混排：添加间距
      const lastChar = currentLine.slice(-1);
      const needsMixedSpace = lastChar &&
                              this._isCJKChar(lastChar) !== this._isCJKChar(word[0]);
      const mixedSpaceWidth = needsMixedSpace ? (spaceWidth * this.MIXED_LANG_SPACE_RATIO) : 0;

      // 检查是否需要换行
      const totalWidth = currentWidth + mixedSpaceWidth + wordWidth;
      if (totalWidth > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = word;
        currentWidth = wordWidth;
      } else {
        if (needsMixedSpace) {
          currentWidth += mixedSpaceWidth;
        }
        currentLine += word;
        currentWidth += wordWidth;
      }
    }

    // 添加最后一行
    if (currentLine) {
      lines.push(currentLine);
    }

    // 计算总高度
    const lineHeight = fontSize * lineSkip;
    const actualHeight = lines.length * lineHeight;

    return {
      fitsCompletely: actualHeight <= maxHeight,
      lineCount: lines.length,
      actualHeight: actualHeight,
      lines: lines
    };
  }

  /**
   * 分词（支持 CJK 和西文）
   *
   * 重要：这个方法的分词逻辑必须和 history_pdf_compare.js 中的 wrapText() 保持一致！
   *
   * @private
   * @param {string} text
   * @param {boolean} isCJK
   * @returns {Array<string>}
   */
  _tokenizeText(text, isCJK) {
    if (!text) return [];

    if (isCJK) {
      // CJK：按标点符号分段，然后每个字符作为一个单元
      // 这和 wrapText() 的逻辑保持一致
      const tokens = [];
      const segments = text.split(/([。？！，、；：\n])/);

      for (let segment of segments) {
        if (!segment) continue;

        // 标点符号作为独立 token
        if (/^[。？！，、；：]$/.test(segment)) {
          tokens.push(segment);
        } else if (segment === '\n') {
          tokens.push('\n'); // 换行符作为独立 token
        } else {
          // 其他字符逐个分割
          tokens.push(...segment.split(''));
        }
      }

      return tokens;
    } else {
      // 西文：按空格和标点分词
      return text.match(/\S+|\s+/g) || [];
    }
  }

  /**
   * 判断是否为 CJK 字符
   *
   * @private
   * @param {string} char
   * @returns {boolean}
   */
  _isCJKChar(char) {
    if (!char || char.length === 0) return false;
    const code = char.charCodeAt(0);
    return (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Extension A
      (code >= 0x20000 && code <= 0x2A6DF) || // CJK Extension B
      (code >= 0x3000 && code <= 0x303F) ||   // CJK Symbols and Punctuation
      (code >= 0xFF00 && code <= 0xFFEF) ||   // Fullwidth Forms
      (code >= 0xAC00 && code <= 0xD7AF) ||   // Hangul Syllables
      (code >= 0x3040 && code <= 0x309F) ||   // Hiragana
      (code >= 0x30A0 && code <= 0x30FF)      // Katakana
    );
  }

  /**
   * 测量文本宽度（使用 Canvas）
   *
   * @private
   * @param {string} text
   * @param {number} fontSize
   * @param {string} fontFamily
   * @returns {number}
   */
  _measureTextWidth(text, fontSize, fontFamily) {
    if (!this._measureContext) {
      this._measureCanvas = document.createElement('canvas');
      this._measureContext = this._measureCanvas.getContext('2d');
    }

    this._measureContext.font = `${fontSize}px ${fontFamily}`;
    return this._measureContext.measureText(text).width;
  }

  /**
   * 批量计算最优缩放（全局一致性）
   *
   * 实现策略：
   * 1. 计算每个段落的最优缩放
   * 2. 使用众数作为全局缩放
   * 3. 统一所有段落的缩放
   *
   * @param {Array<Object>} items - content_list.json 的项数组
   * @param {string} fontFamily
   * @param {string} targetLang
   * @returns {Object} { globalScale, itemScales }
   */
  calculateGlobalScale(items, fontFamily = 'Arial', targetLang = 'zh-CN') {
    const isCJK = this._isTargetLangCJK(targetLang);
    const scales = [];
    const itemScales = [];

    for (const item of items) {
      if (item.type !== 'text' || !item.text || !item.bbox) {
        itemScales.push(null);
        continue;
      }

      // 估算原始字体大小（基于 bbox 高度）
      const bboxHeight = item.bbox[3] - item.bbox[1];
      const estimatedFontSize = bboxHeight * 0.8; // 经验值：bbox 高度的 80%

      const result = this.calculateOptimalScale(
        item.text,
        item.bbox,
        estimatedFontSize,
        fontFamily,
        isCJK
      );

      scales.push(result.scale);
      itemScales.push(result);
    }

    // 计算众数（最常见的缩放因子）
    const globalScale = this._calculateMode(scales);

    // 统一所有段落的缩放（大于众数的降为众数）
    for (let i = 0; i < itemScales.length; i++) {
      if (itemScales[i] && itemScales[i].scale > globalScale) {
        itemScales[i].scale = globalScale;
        itemScales[i].reason = 'global_consistency';
      }
    }

    return { globalScale, itemScales };
  }

  /**
   * 计算众数
   *
   * @private
   * @param {Array<number>} values
   * @returns {number}
   */
  _calculateMode(values) {
    if (!values || values.length === 0) return 1.0;

    const frequency = {};
    let maxFreq = 0;
    let mode = values[0];

    for (const value of values) {
      if (value == null) continue;
      const rounded = Math.round(value * 100) / 100; // 保留两位小数
      frequency[rounded] = (frequency[rounded] || 0) + 1;

      if (frequency[rounded] > maxFreq) {
        maxFreq = frequency[rounded];
        mode = rounded;
      }
    }

    return mode;
  }

  /**
   * 判断目标语言是否为 CJK
   *
   * @private
   * @param {string} targetLang
   * @returns {boolean}
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
   * 智能扩展 bbox（当缩放无法解决时）
   *
   * @param {Array} bbox - [x0, y0, x1, y1]
   * @param {Array<Object>} allItems - 所有段落项（用于检测障碍物）
   * @param {number} pageWidth
   * @param {number} pageHeight
   * @returns {Array} 扩展后的 bbox
   */
  expandBbox(bbox, allItems, pageWidth, pageHeight) {
    const [x0, y0, x1, y1] = bbox;
    let expandedBbox = [...bbox];
    let expanded = false;

    // 策略1：向下扩展
    const bottomSpace = this._getMaxBottomSpace(bbox, allItems, pageHeight);
    if (bottomSpace > y0) {
      expandedBbox[1] = bottomSpace + this.BOTTOM_EXPAND_MARGIN;
      expanded = true;
      console.log(`[TextFitting] 向下扩展: ${y0} -> ${expandedBbox[1]}`);
    }

    // 策略2：向右扩展（如果向下不够）
    if (!expanded) {
      const rightSpace = this._getMaxRightSpace(bbox, allItems, pageWidth);
      if (rightSpace > x1) {
        expandedBbox[2] = rightSpace + this.RIGHT_EXPAND_MARGIN;
        expanded = true;
        console.log(`[TextFitting] 向右扩展: ${x1} -> ${expandedBbox[2]}`);
      }
    }

    return expandedBbox;
  }

  /**
   * 获取下方最大可用空间
   *
   * @private
   */
  _getMaxBottomSpace(bbox, allItems, pageHeight) {
    const [x0, y0, x1, y1] = bbox;
    let minY = pageHeight * 0.1; // 页面底部 10% 作为最小限制

    for (const item of allItems) {
      if (!item.bbox || item.bbox === bbox) continue;
      const [ix0, iy0, ix1, iy1] = item.bbox;

      // 检查是否在当前 bbox 下方且有水平重叠
      const hasHorizontalOverlap = !(ix1 <= x0 || ix0 >= x1);
      if (iy1 < y0 && hasHorizontalOverlap) {
        minY = Math.max(minY, iy1);
      }
    }

    return minY;
  }

  /**
   * 获取右侧最大可用空间
   *
   * @private
   */
  _getMaxRightSpace(bbox, allItems, pageWidth) {
    const [x0, y0, x1, y1] = bbox;
    let maxX = pageWidth * 0.9; // 页面右侧 10% 作为最大限制

    for (const item of allItems) {
      if (!item.bbox || item.bbox === bbox) continue;
      const [ix0, iy0, ix1, iy1] = item.bbox;

      // 检查是否在当前 bbox 右侧且有垂直重叠
      const hasVerticalOverlap = !(iy1 <= y0 || iy0 >= y1);
      if (ix0 > x0 && hasVerticalOverlap) {
        maxX = Math.min(maxX, ix0);
      }
    }

    return maxX;
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.TextFittingEngine = TextFittingEngine;
}

// 模块化导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextFittingEngine;
}
