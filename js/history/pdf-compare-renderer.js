/**
 * pdf-compare-renderer.js
 * PDF 对照视图 - 文本渲染引擎模块
 * 负责：文本自适应渲染、公式处理、白色背景绘制
 */

class PDFCompareRenderer {
  constructor(view) {
    this.view = view;
    this.textFittingEngine = view.textFittingEngine;
  }

  /**
   * 绘制页面的白色背景覆盖层（覆盖原始文字）
   */
  renderPageBboxesToCtx(ctx, pageNum, yOffset, pageWidth, pageHeight) {
    const pageItems = this.view.contentListJson.filter(item => item.page_idx === pageNum - 1 && item.type === 'text');
    const BBOX_NORMALIZED_RANGE = 1000;
    const scaleX = pageWidth / BBOX_NORMALIZED_RANGE;
    const scaleY = pageHeight / BBOX_NORMALIZED_RANGE;

    pageItems.forEach((item) => {
      if (!item.bbox) return;

      const bb = item.bbox;
      const x = bb[0] * scaleX;
      const y = bb[1] * scaleY + yOffset;
      const w = (bb[2] - bb[0]) * scaleX;
      const h = (bb[3] - bb[1]) * scaleY;

      // 向上下扩展白色背景（覆盖更多原始文字）
      const verticalExpansion = h * 0.15; // 向上下各扩展 15%（配合溢出策略）
      const expandedY = y - verticalExpansion;
      const expandedH = h + verticalExpansion * 2;

      // 在 overlay 层绘制扩展后的白色背景（不透明，遮挡下层的原始文字）
      ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
      ctx.fillRect(x, expandedY, w, expandedH);
    });
  }

  /**
   * 分段：将译文绘制到指定 ctx，并将公式 DOM 插入到 wrapper
   */
  async renderPageTranslationToCtx(ctx, wrapperEl, pageNum, yOffset, pageWidth, pageHeight) {
    // 确保已经完成预处理
    if (!this.view.hasPreprocessed) {
      this.view.preprocessGlobalFontSizes();
    }

    const pageItems = this.view.contentListJson.filter(item => item.page_idx === pageNum - 1 && item.type === 'text');
    const BBOX_NORMALIZED_RANGE = 1000;
    const scaleX = pageWidth / BBOX_NORMALIZED_RANGE;
    const scaleY = pageHeight / BBOX_NORMALIZED_RANGE;

    // 第一步：在 overlay 层绘制白色背景（覆盖原始文字）
    this.renderPageBboxesToCtx(ctx, pageNum, yOffset, pageWidth, pageHeight);

    // 第二步：绘制翻译文本（在白色背景上）
    pageItems.forEach((item) => {
      const originalIdx = this.view.contentListJson.indexOf(item);
      const translatedItem = this.view.translatedContentList[originalIdx];
      if (!translatedItem || !item.bbox) return;

      const bb = item.bbox;
      const x = bb[0] * scaleX;
      const y = bb[1] * scaleY + yOffset;
      const w = (bb[2] - bb[0]) * scaleX;
      const h = (bb[3] - bb[1]) * scaleY;

      // 使用预处理的字号信息
      const cachedInfo = this.view.globalFontSizeCache.get(originalIdx);

      // 使用新的文本自适应引擎渲染
      this.drawTextInBox(ctx, translatedItem.text, x, y, w, h, pageNum, wrapperEl, cachedInfo);
    });
  }

  /**
   * 在指定区域内绘制自适应大小的文字
   */
  drawTextInBox(ctx, text, x, y, width, height, pageNum = null, wrapperEl = null, cachedInfo = null) {
    if (!text) return;

    // 检查是否为短文本/小标题（与 bbox 扩展判断保持一致）
    const isShortText = text.length < 30;

    // 暂时禁用公式渲染（用于测试）
    // 所有文本都用 Canvas 渲染

    // 使用预处理的字号信息或直接传递 cachedInfo
    const suggestedFontSize = cachedInfo ? cachedInfo.estimatedFontSize : null;
    this.drawPlainTextInBox(ctx, text, x, y, width, height, isShortText, cachedInfo);
  }

  /**
   * 绘制纯文本（Canvas）
   * @param {boolean} isShortText - 是否为短文本/小标题（会使用更大的最小字号）
   * @param {Object} cachedInfo - 预处理的字号信息（可选）
   */
  drawPlainTextInBox(ctx, text, x, y, width, height, isShortText = false, cachedInfo = null) {
    // 直接使用新的文本自适应引擎
    if (this.textFittingEngine) {
      const suggestedFontSize = cachedInfo ? cachedInfo.estimatedFontSize : null;
      return this.drawPlainTextWithFitting(ctx, text, x, y, width, height, isShortText, suggestedFontSize);
    }

    // 回退方案：如果引擎未初始化（不应该发生）
    let bestFontSize = 8;
    let bestLines = [];

    // 从较大字号开始尝试，允许多行显示
    for (let size = 16; size >= 6; size -= 1) {
      ctx.font = `${size}px Arial, "Microsoft YaHei", "SimHei", sans-serif`;
      const lines = this.wrapText(ctx, text, width - 4);

      // 计算总高度
      const lineHeight = size * 1.3;
      const totalHeight = lines.length * lineHeight;

      if (totalHeight <= height - 4) {
        bestFontSize = size;
        bestLines = lines;
        break;
      }
    }

    // 绘制最佳结果
    ctx.font = `${bestFontSize}px Arial, "Microsoft YaHei", "SimHei", sans-serif`;
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    const lineHeight = bestFontSize * 1.3;

    bestLines.forEach((line, i) => {
      const lineY = y + 4 + i * lineHeight;
      // 所有已经过裁剪的行都应该绘制
      // 因为 bestLines 已经在上面被裁剪到只包含能完整显示的行
      ctx.fillText(line, x + 2, lineY);
    });
  }

  /**
   * 使用文本自适应算法绘制文本（新算法）
   * @param {number} suggestedFontSize - 可选的建议字号（来自预处理）
   */
  drawPlainTextWithFitting(ctx, text, x, y, width, height, isShortText = false, suggestedFontSize = null) {
    try {
      // 估算原始字体大小（基于 bbox 高度）
      const estimatedFontSize = suggestedFontSize || (height * 0.90); // 平衡字号与内容完整性

      // 判断是否为 CJK 语言（简单判断：检查文本中是否有中文字符）
      const isCJK = /[\u4e00-\u9fa5]/.test(text);

      // 使用文本自适应引擎计算最优缩放
      const result = this.textFittingEngine.calculateOptimalScale(
        text,
        [x, y, x + width, y + height], // bbox
        estimatedFontSize,
        'Arial, "Microsoft YaHei", "SimHei", sans-serif',
        isCJK,
        { firstLineIndent: false }
      );

      // 计算最终字体大小
      let finalFontSize = estimatedFontSize * result.scale;

      // 获取行距
      const lineSkip = isCJK ? this.textFittingEngine.LINE_SKIP_CJK : this.textFittingEngine.LINE_SKIP_WESTERN;

      // 动态缩放循环：不断尝试直到所有内容都装下（参考 BabelDOC）
      const minReadableFontSize = 9; // 提高最小字号到 9px，保证可读性
      const minFontSize = Math.max(estimatedFontSize * 0.2, minReadableFontSize); // 允许缩到 20%

      // 确保至少从一个合理的字号开始尝试
      if (finalFontSize < estimatedFontSize * 0.6) {
        // 如果 TextFittingEngine 给出的字号太小，忽略它，从估算字号开始
        finalFontSize = estimatedFontSize;
      }

      let attempts = 0;
      const maxAttempts = 40; // 尝试次数

      // 允许适度的底部溢出（像 BabelDOC 一样）
      const allowedBottomOverflow = height * 0.15; // 允许 15% 底部溢出

      while (finalFontSize >= minFontSize && attempts < maxAttempts) {
        attempts++;

        // 设置字体
        ctx.font = `${finalFontSize}px Arial, "Microsoft YaHei", "SimHei", sans-serif`;
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'top';

        // 分行绘制
        const lines = this.wrapText(ctx, text, width - 4);
        const lineHeight = finalFontSize * lineSkip;

        // 检查所有行是否都能装下
        let allLinesFit = true;
        let fittingLineCount = 0;

        for (let i = 0; i < lines.length; i++) {
          const lineY = y + 2 + i * lineHeight;
          // 允许适度溢出底部边界
          if (lineY + lineHeight <= y + height + allowedBottomOverflow) {
            fittingLineCount++;
          } else {
            allLinesFit = false;
            break;
          }
        }

        // 如果所有行都装下了，开始绘制
        if (allLinesFit) {
          lines.forEach((line, i) => {
            const lineY = y + 2 + i * lineHeight; // 减小顶部 padding 从 4 到 2
            ctx.fillText(line, x + 2, lineY);
          });

          // 调试信息
          if (attempts > 1) {
            console.log(`[TextFitting] 动态缩放成功: 文本="${text.substring(0, 30)}..." 尝试=${attempts}次, 最终字号=${finalFontSize.toFixed(1)}px, 行数=${lines.length}`);
          }
          return; // 成功，退出函数
        }

        // 装不下，减小字号重试
        if (finalFontSize > estimatedFontSize * 0.6) {
          finalFontSize -= estimatedFontSize * 0.04; // 减小 4%
        } else {
          finalFontSize -= estimatedFontSize * 0.08; // 加速减小 8%
        }
      }

      // 如果循环结束还是装不下，优先保证字号可读性
      // 使用最小可读字号绘制，即使会跳过部分行
      const fallbackFontSize = Math.max(finalFontSize, minReadableFontSize);
      ctx.font = `${fallbackFontSize}px Arial, "Microsoft YaHei", "SimHei", sans-serif`;
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';
      const lines = this.wrapText(ctx, text, width - 4);
      const lineHeight = fallbackFontSize * lineSkip;

      let drawnLines = 0;
      let skippedLines = 0;

      lines.forEach((line, i) => {
        const lineY = y + 2 + i * lineHeight; // 减小顶部 padding 从 4 到 2
        if (lineY + lineHeight <= y + height) {
          ctx.fillText(line, x + 2, lineY);
          drawnLines++;
        } else {
          skippedLines++;
        }
      });

      if (skippedLines > 0) {
        console.warn(`[TextFitting] 文本过长: "${text.substring(0, 30)}..." 尝试=${attempts}次, 字号=${fallbackFontSize.toFixed(1)}px, 绘制=${drawnLines}/${lines.length}行`);
      }

    } catch (error) {
      console.error('[PDFCompareView] 文本自适应渲染失败:', error);
      // 使用最小的回退渲染
      ctx.font = '8px Arial, sans-serif';
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';
      const lines = this.wrapText(ctx, text, width - 4);
      lines.forEach((line, i) => {
        const lineY = y + 4 + i * 12;
        if (lineY < y + height) {
          ctx.fillText(line, x + 2, lineY);
        }
      });
    }
  }

  /**
   * 文本换行（根据宽度）
   */
  wrapText(ctx, text, maxWidth) {
    const words = [];

    // 对于中文，按字符分割；对于英文，按空格和标点分割
    const isCJK = /[\u4e00-\u9fa5]/.test(text);

    if (isCJK) {
      // 中文按字符分割，保留标点
      const segments = text.split(/([。？！，、；：\n])/);

      for (let segment of segments) {
        if (!segment) continue;

        // 如果是单个标点符号，作为独立 token
        if (/^[。？！，、；：]$/.test(segment)) {
          words.push(segment);
        } else if (segment === '\n') {
          words.push('\n');
        } else {
          // 普通字符，逐字分割
          words.push(...segment.split(''));
        }
      }
    } else {
      // 英文按空格和标点分割
      const tokens = text.match(/\S+|\s+/g) || [];
      words.push(...tokens);
    }

    const lines = [];
    let currentLine = '';
    let currentWidth = 0;

    for (let word of words) {
      // 处理换行符
      if (word === '\n') {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
          currentWidth = 0;
        }
        continue;
      }

      // 中文标点：尝试添加到当前行，允许略微超出
      if (isCJK && /^[。？！，、；：]$/.test(word)) {
        currentLine += word;
        currentWidth += ctx.measureText(word).width;
        continue;
      }

      const wordWidth = ctx.measureText(word).width;

      // 检查是否需要换行
      if (currentWidth + wordWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
        currentWidth = wordWidth;
      } else {
        currentLine += word;
        currentWidth += wordWidth;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }
}

// 暴露到全局
if (typeof window !== 'undefined') {
  window.PDFCompareRenderer = PDFCompareRenderer;
}
