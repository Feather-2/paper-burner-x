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
      globalFontScale: 0.85,
      bboxNormalizedRange: 1000
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
   * 预处理：使用众数统计计算全局统一的字号
   * @param {Array} contentListJson - 原文内容列表
   * @param {Array} translatedContentList - 译文内容列表
   */
  preprocessGlobalFontSizes(contentListJson, translatedContentList) {
    if (this.hasPreprocessed) return;

    console.log('[TextFittingAdapter] 开始预处理全局字号（使用众数统计）...');
    const startTime = performance.now();

    const BBOX_NORMALIZED_RANGE = this.options.bboxNormalizedRange || 1000;

    // 第一步：收集所有段落的最优缩放因子
    const allScales = [];
    const tempCache = new Map(); // 临时存储每个段落的最优缩放

    contentListJson.forEach((item, idx) => {
      if (item.type !== 'text' || !item.bbox) return;

      const translatedItem = translatedContentList[idx];
      if (!translatedItem || !translatedItem.text) return;

      const bbox = item.bbox;
      const bboxHeight = (bbox[3] - bbox[1]) / BBOX_NORMALIZED_RANGE;
      const bboxWidth = (bbox[2] - bbox[0]) / BBOX_NORMALIZED_RANGE;
      const text = translatedItem.text;

      // 检测是否包含公式
      const hasFormula = /\$\$?[\s\S]*?\$\$?/.test(text);

      // 判断是否为短文本（标题、图注等）
      // 短文本定义：字符数 < 50（更宽松），或者包含换行符且总字符数 < 80
      const isShortText = text.length < 50 || (/\n/.test(text) && text.length < 80);

      // 计算该段落的最优缩放因子（模拟实际渲染）
      const optimalScale = this._calculateOptimalScale(text, bboxWidth, bboxHeight);

      // 根据文本单元数量加权（字符数越多，权重越大）
      const unitCount = Math.max(1, Math.floor(text.length / 10));
      for (let i = 0; i < unitCount; i++) {
        allScales.push(optimalScale);
      }

      tempCache.set(idx, {
        optimalScale: optimalScale,
        bbox: bbox,
        bboxHeight: bboxHeight,
        hasFormula: hasFormula,  // 保存公式标记
        isShortText: isShortText  // 保存短文本标记
      });
    });

    // 第二步：计算众数和关键百分位数
    const modeScale = this._calculateMode(allScales);
    const percentile50 = this._calculatePercentile(allScales, 0.50); // 中位数
    const percentile60 = this._calculatePercentile(allScales, 0.60);
    const percentile70 = this._calculatePercentile(allScales, 0.70);
    const percentile80 = this._calculatePercentile(allScales, 0.80);

    // ✅ 使用分层限制策略：短文本用80%分位，长文本用60%分位
    const shortTextLimitScale = percentile80;  // 短文本（标题、图注等）使用更宽松的限制
    const longTextLimitScale = percentile60;   // 长文本（正文）使用更严格的限制

    // 统计公式段落数量
    let formulaCount = 0;
    let shortTextCount = 0;
    tempCache.forEach((data) => {
      if (data.hasFormula) formulaCount++;
      if (data.isShortText) shortTextCount++;
    });

    console.log(`[TextFittingAdapter] 收集了 ${allScales.length} 个缩放样本，其中 ${formulaCount} 个包含公式，${shortTextCount} 个短文本`);
    console.log(`[TextFittingAdapter] 50%分位=${percentile50.toFixed(3)}, 60%分位=${percentile60.toFixed(3)}, 70%分位=${percentile70.toFixed(3)}, 80%分位=${percentile80.toFixed(3)}, 众数=${modeScale.toFixed(3)}`);
    console.log(`[TextFittingAdapter] 短文本上限=${shortTextLimitScale.toFixed(3)} (80%分位), 长文本上限=${longTextLimitScale.toFixed(3)} (60%分位)`);

    // 第三步：应用分层分位数限制，避免字号过大
    tempCache.forEach((data, idx) => {
      // 根据文本长度选择不同的上限
      const limitScale = data.isShortText ? shortTextLimitScale : longTextLimitScale;
      const finalScale = Math.min(data.optimalScale, limitScale);
      const estimatedFontSize = data.bboxHeight * finalScale;

      this.globalFontSizeCache.set(idx, {
        estimatedFontSize: estimatedFontSize,
        bbox: data.bbox,
        scale: finalScale
      });
    });

    console.log(`[TextFittingAdapter] 预处理完成：众数=${modeScale.toFixed(3)}, 短文本限制=${shortTextLimitScale.toFixed(3)}, 长文本限制=${longTextLimitScale.toFixed(3)}, 耗时=${(performance.now() - startTime).toFixed(0)}ms`);
    this.hasPreprocessed = true;
  }

  /**
   * 计算单个段落的最优缩放因子
   * ⚠️ 必须与 drawPlainTextWithFitting 使用相同的参数，避免估算偏差
   * @private
   */
  _calculateOptimalScale(text, bboxWidth, bboxHeight) {
    const textLength = text.length;
    const isCJK = /[\u4e00-\u9fa5]/.test(text);
    const hasNewlines = /\n/.test(text);

    // ✅ 检测公式：如果有公式，使用更保守的估算
    const hasFormula = /\$\$?[\s\S]*?\$\$?/.test(text);
    if (hasFormula) {
      // 公式通常占用更多垂直空间，使用保守的缩放
      return 0.5; // 固定返回较小的缩放因子
    }

    // ✅ 使用与实际渲染相同的初始行距（关键修复！）
    const initialLineSkip = isCJK ? 1.5 : 1.3;

    // 估算：假设使用 bboxHeight * 某个缩放因子作为字号
    // 从一个合理的缩放因子开始迭代（0.7 是常见的中等值）
    let testScale = 0.7;
    let bestScale = 0.3; // 最小值

    // 简化迭代：尝试几个典型缩放值
    for (const scale of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
      const fontSize = bboxHeight * scale;

      // 估算字符宽度（基于字号）
      const estimatedCharWidth = fontSize * (isCJK ? 1.0 : 0.6);

      // 估算每行字符数（考虑90%的可用宽度）
      const effectiveWidth = bboxWidth * 0.9;
      const charsPerLine = Math.max(1, Math.floor(effectiveWidth / estimatedCharWidth));

      // 估算行数
      const estimatedLines = hasNewlines
        ? text.split('\n').length
        : Math.ceil(textLength / charsPerLine);

      // 计算总高度（使用初始行距，与实际渲染一致）
      const lineHeight = fontSize * initialLineSkip;
      const totalHeight = estimatedLines === 1
        ? fontSize * 1.2
        : (estimatedLines - 1) * lineHeight + fontSize * 1.2;

      // 如果能放下，这就是一个可行的缩放
      if (totalHeight <= bboxHeight) {
        bestScale = scale;
        break; // 找到第一个可行的（最大的）缩放就停止
      }
    }

    return bestScale;
  }

  /**
   * 计算数组的众数（mode）
   * @private
   */
  _calculateMode(arr) {
    if (arr.length === 0) return this.options.globalFontScale; // 回退到默认值

    // 将连续值离散化（四舍五入到0.05精度）
    const rounded = arr.map(v => Math.round(v * 20) / 20);

    // 统计频率
    const frequency = new Map();
    rounded.forEach(val => {
      frequency.set(val, (frequency.get(val) || 0) + 1);
    });

    // 找到出现次数最多的值
    let maxCount = 0;
    let modeValue = this.options.globalFontScale;

    frequency.forEach((count, value) => {
      if (count > maxCount) {
        maxCount = count;
        modeValue = value;
      }
    });

    return modeValue;
  }

  /**
   * 计算百分位数
   * @param {number[]} arr - 数值数组
   * @param {number} percentile - 百分位 (0-1)，如 0.70 表示 70% 分位数
   * @returns {number} 百分位数值
   * @private
   */
  _calculatePercentile(arr, percentile) {
    if (arr.length === 0) return this.options.globalFontScale;
    if (percentile < 0 || percentile > 1) {
      console.warn('[TextFittingAdapter] 百分位参数超出范围，使用默认值');
      return this.options.globalFontScale;
    }

    // 排序数组（升序）
    const sorted = [...arr].sort((a, b) => a - b);

    // 计算百分位位置
    const index = percentile * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    // 线性插值
    if (lower === upper) {
      return sorted[lower];
    }
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
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
      ctx.font = `${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
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
      ctx.font = `${bestFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
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
      ctx.font = `${bestFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
      bestLines = this.wrapText(ctx, text, width - 4);
    }

    // 绘制文字
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.font = `${bestFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;

    const lineHeight = bestFontSize * 1.5;

    bestLines.forEach((line, i) => {
      const lineY = y + 4 + i * lineHeight;
      ctx.fillText(line, x + 2, lineY);
    });
  }

  /**
   * 使用文本自适应算法绘制文本（优化版，支持动态行距调整）
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

      // 内边距：对小bbox减少padding避免裁剪
      const paddingTop = height < 20 ? 0.5 : 2;
      const paddingX = 2;
      const availableHeight = height - paddingTop * 2;
      const availableWidth = width - paddingX * 2;

      // 字号范围估算
      const estimatedSingleLineFontSize = height * 0.8;

      // 最小字号：动态调整（基于bbox高度）
      let minFontSize;
      if (height < 20) {
        minFontSize = Math.max(6, height * 0.35);  // 小bbox：最小6px
      } else {
        minFontSize = isShortText ? 10 : 8;  // 正常bbox：10px/8px
      }

      const maxFontSize = Math.min(estimatedSingleLineFontSize * 1.5, height * 1.2);

      const hasNewlines = text.includes('\n');
      const textLength = text.length;

      console.log(`[TextFitting] 开始: "${text.substring(0, 30)}..." bbox=${width.toFixed(0)}x${height.toFixed(0)}, 字号范围=${minFontSize.toFixed(1)}-${maxFontSize.toFixed(1)}px, 文本长度=${textLength}, 有换行=${hasNewlines}`);

      // 宽度因子（优先使用全宽）
      const widthFactors = (textLength < 20 || hasNewlines)
        ? [1.0]
        : [1.0, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70];

      let bestSolution = null;

      // 动态行距策略：初始值 → 逐步缩小
      const initialLineSkip = isCJK ? 1.5 : 1.3;
      const lineSkipStep = 0.1;
      const minLineSkip = 1.1; // 最小行距

      // 对每个宽度因子和行距组合，使用二分查找找到最大可用字号
      for (const widthFactor of widthFactors) {
        const effectiveWidth = availableWidth * widthFactor;

        // 尝试不同的行距
        for (let currentLineSkip = initialLineSkip; currentLineSkip >= minLineSkip; currentLineSkip -= lineSkipStep) {
          let low = minFontSize;
          let high = maxFontSize;
          let foundFontSize = null;
          let foundLines = null;

          while (high - low > 0.5) {
            const mid = (low + high) / 2;

            ctx.font = `${mid}px Arial, "Microsoft YaHei", "SimHei", sans-serif`;
            const lines = this.wrapText(ctx, text, effectiveWidth);
            const lineHeight = mid * currentLineSkip;

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
            // 找到可行方案，优先选择字号大、行距大的方案
            const quality = foundFontSize * currentLineSkip; // 综合质量评分
            if (!bestSolution || quality > (bestSolution.fontSize * bestSolution.lineSkip)) {
              bestSolution = {
                fontSize: foundFontSize,
                widthFactor,
                lines: foundLines,
                lineSkip: currentLineSkip
              };
            }
            break; // 找到可行方案后，不需要继续缩小行距
          }
        }
      }

      // 没找到合适方案，使用最小字号和最小行距
      if (!bestSolution) {
        ctx.font = `${minFontSize}px Arial, "Microsoft YaHei", "SimHei", sans-serif`;
        const lines = this.wrapText(ctx, text, availableWidth);
        const lineHeight = minFontSize * minLineSkip;
        const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
        bestSolution = {
          fontSize: minFontSize,
          widthFactor: 1.0,
          lines: lines.slice(0, maxLines),
          lineSkip: minLineSkip
        };
      }

      // 绘制文字
      const { fontSize, lines, lineSkip } = bestSolution;
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

      console.log(`[TextFitting] 完成: 字号=${fontSize.toFixed(1)}px, 行数=${lines.length}, 行距=${lineSkip.toFixed(2)}, 宽度因子=${bestSolution.widthFactor}`);

    } catch (error) {
      console.error('[TextFitting] 渲染失败:', error);
      // 回退到简单绘制
      ctx.fillStyle = '#000';
      ctx.font = '12px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
      ctx.fillText(text.substring(0, 50), x + 2, y + 2);
    }
  }

  /**
   * 文本换行算法（支持中英文混排间距）
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

        // 计算宽度时考虑中英文混排间距
        const lineWidth = this._measureTextWithCJKSpacing(ctx, testLine);

        if (lineWidth > maxWidth && currentLine.length > 0) {
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
   * 测量文本宽度（考虑中英文混排间距）
   * @private
   */
  _measureTextWithCJKSpacing(ctx, text) {
    if (!text) return 0;

    let totalWidth = ctx.measureText(text).width;
    let spacingCount = 0;

    // 计算需要添加间距的位置数量
    for (let i = 0; i < text.length - 1; i++) {
      if (this._needsCJKWesternSpacing(text[i], text[i + 1])) {
        spacingCount++;
      }
    }

    // 每个间距添加0.5个字符宽度
    const avgCharWidth = ctx.measureText('中').width; // 使用CJK字符宽度作为基准
    totalWidth += spacingCount * avgCharWidth * 0.5;

    return totalWidth;
  }

  /**
   * 判断两个字符之间是否需要添加间距
   * @private
   */
  _needsCJKWesternSpacing(char1, char2) {
    // 黑名单：这些字符不需要添加间距
    // 包括：中文标点、数学公式标记符号($)、括号等
    const punctuationBlacklist = /[，。、；：！？""''（）《》【】…—$]/;

    if (punctuationBlacklist.test(char1) || punctuationBlacklist.test(char2)) {
      return false;
    }

    const isCJK1 = /[\u4e00-\u9fa5]/.test(char1);
    const isCJK2 = /[\u4e00-\u9fa5]/.test(char2);
    const isWestern1 = /[a-zA-Z0-9]/.test(char1);
    const isWestern2 = /[a-zA-Z0-9]/.test(char2);

    // CJK → Western 或 Western → CJK 需要间距
    return (isCJK1 && isWestern2) || (isWestern1 && isCJK2);
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
      // 预处理公式：修复常见的非标准LaTeX命令
      let processedText = text;
      // 将 \plus 替换为 +（\plus 不是标准LaTeX命令）
      processedText = processedText.replace(/\\plus(?![a-zA-Z])/g, '+');

      const tempContainer = document.createElement('div');
      tempContainer.textContent = processedText;

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
