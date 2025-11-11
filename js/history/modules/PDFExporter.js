/**
 * PDFExporter.js
 * PDF导出模块
 * 负责将翻译内容导出为PDF文件
 */

class PDFExporter {
  constructor(options = {}) {
    this.options = Object.assign({
      fontUrl: 'https://gcore.jsdelivr.net/npm/source-han-sans-cn@1.0.0/SourceHanSansCN-Normal.otf',
      pdfLibUrl: 'https://gcore.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
      fontkitUrl: 'https://gcore.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
      bboxNormalizedRange: 1000
    }, options);

    // 库加载状态
    this.pdfLibLoaded = false;
    this.fontkitLoaded = false;
  }

  /**
   * 导出结构化翻译PDF
   * @param {string} originalPdfBase64 - 原始PDF的Base64编码
   * @param {Array} translatedContentList - 翻译内容列表
   * @param {Function} showNotification - 通知函数
   */
  async exportStructuredTranslation(originalPdfBase64, translatedContentList, showNotification = null) {
    try {
      // 检查是否有翻译数据
      if (!translatedContentList || translatedContentList.length === 0) {
        if (showNotification) {
          showNotification('没有翻译内容可导出', 'warning');
        }
        return;
      }

      // 检查是否有原始PDF数据
      if (!originalPdfBase64) {
        if (showNotification) {
          showNotification('原始PDF数据不可用', 'error');
        }
        return;
      }

      // 显示进度提示
      if (showNotification) {
        showNotification('正在生成译文PDF，请稍候...', 'info');
      }

      // 动态加载 pdf-lib
      if (typeof PDFLib === 'undefined') {
        console.log('[PDFExporter] 正在加载 pdf-lib...');
        await this.loadPdfLib();
      }

      const { PDFDocument, rgb } = PDFLib;

      // 加载原始PDF
      const pdfBytes = this.base64ToUint8Array(originalPdfBase64);
      const pdfDoc = await PDFDocument.load(pdfBytes);

      // 注册 fontkit
      if (typeof fontkit !== 'undefined') {
        pdfDoc.registerFontkit(fontkit);
        console.log('[PDFExporter] fontkit 已注册');
      } else {
        console.warn('[PDFExporter] fontkit 未加载，无法嵌入自定义字体');
      }

      // 加载中文字体
      let font = null;
      try {
        if (typeof fontkit === 'undefined') {
          throw new Error('fontkit 未加载，无法嵌入中文字体');
        }

        console.log('[PDFExporter] 正在加载中文字体...');
        const fontBytes = await fetch(this.options.fontUrl).then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          return res.arrayBuffer();
        });

        font = await pdfDoc.embedFont(fontBytes);
        console.log('[PDFExporter] 中文字体加载成功');
      } catch (fontError) {
        console.error('[PDFExporter] 中文字体加载失败:', fontError);
        if (showNotification) {
          showNotification('中文字体加载失败，无法导出PDF: ' + fontError.message, 'error');
        }
        throw fontError;
      }

      // ✅ 预处理：计算全局字号限制（与Canvas渲染保持一致）
      const fontSizeLimits = this.preprocessPdfFontSizes(pdfDoc, font, translatedContentList);

      // 按页面分组翻译内容
      const pageContentMap = new Map();
      translatedContentList.forEach((item, idx) => {
        if (item.type !== 'text' || !item.text || !item.bbox) return;

        const pageIdx = item.page_idx !== undefined ? item.page_idx : 0;
        if (!pageContentMap.has(pageIdx)) {
          pageContentMap.set(pageIdx, []);
        }
        pageContentMap.get(pageIdx).push({ ...item, originalIndex: idx });
      });

      const BBOX_NORMALIZED_RANGE = this.options.bboxNormalizedRange;

      // 遍历每一页，覆盖翻译文本
      for (const [pageIdx, items] of pageContentMap.entries()) {
        if (pageIdx >= pdfDoc.getPageCount()) continue;

        const page = pdfDoc.getPage(pageIdx);
        const { width: pageWidth, height: pageHeight } = page.getSize();

        // 计算缩放因子
        const scaleX = pageWidth / BBOX_NORMALIZED_RANGE;
        const scaleY = pageHeight / BBOX_NORMALIZED_RANGE;

        console.log(`[PDFExporter] 页面 ${pageIdx}: PDF尺寸=${pageWidth.toFixed(2)}x${pageHeight.toFixed(2)}pt, 缩放比例=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);

        // 用白色矩形覆盖原文
        items.forEach(item => {
          const bbox = item.bbox;
          const x = bbox[0] * scaleX;
          const y = pageHeight - (bbox[3] * scaleY);
          const width = (bbox[2] - bbox[0]) * scaleX;
          const height = (bbox[3] - bbox[1]) * scaleY;

          page.drawRectangle({
            x: x,
            y: y,
            width: width,
            height: height,
            color: rgb(1, 1, 1),
          });
        });

        // 绘制翻译文本
        items.forEach(item => {
          const bbox = item.bbox;
          const text = item.text || '';

          if (!text.trim()) return;

          // 计算bbox在PDF坐标系中的位置
          const x = bbox[0] * scaleX;
          const boxWidth = (bbox[2] - bbox[0]) * scaleX;
          const boxHeight = (bbox[3] - bbox[1]) * scaleY;
          const bboxTop = pageHeight - (bbox[1] * scaleY);
          const bboxBottom = pageHeight - (bbox[3] * scaleY);

          // 判断是否为短文本（与TextFittingAdapter保持一致）
          const isShortText = text.length < 50 || (/\n/.test(text) && text.length < 80);

          // 使用文本布局算法（应用全局字号限制）
          const layout = this.calculatePdfTextLayout(font, text, boxWidth, boxHeight, isShortText, fontSizeLimits);
          const { fontSize, lines, lineHeight } = layout;

          const paddingTop = 2;
          const paddingX = 2;
          const availableHeight = boxHeight - paddingTop * 2;

          // 计算总高度并垂直居中
          const totalHeight = lines.length > 0
            ? (lines.length - 1) * lineHeight + fontSize
            : 0;
          const yOffset = (availableHeight - totalHeight) / 2;

          // 绘制每一行（PDF坐标系：Y轴从下往上，所以从顶部开始往下绘制）
          lines.forEach((line, lineIdx) => {
            // 从顶部开始，每一行往下偏移
            const lineY = bboxTop - paddingTop - yOffset - (lineIdx * lineHeight);

            if (lineY < bboxBottom || lineY > bboxTop) return;

            page.drawText(line, {
              x: x + paddingX,
              y: lineY,
              size: fontSize,
              font: font,
              color: rgb(0, 0, 0),
            });
          });
        });
      }

      // 生成PDF
      const modifiedPdfBytes = await pdfDoc.save();

      // 创建Blob并下载
      const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const filename = `translated_${timestamp}.pdf`;

      // 下载文件
      if (typeof saveAs === 'function') {
        saveAs(blob, filename);
        if (showNotification) {
          showNotification('译文PDF导出成功！', 'success');
        }
      } else {
        // 后备方案
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (showNotification) {
          showNotification('译文PDF导出成功！', 'success');
        }
      }

    } catch (error) {
      console.error('[PDFExporter] 导出PDF失败:', error);
      if (showNotification) {
        showNotification('导出失败: ' + error.message, 'error');
      }
    }
  }

  /**
   * 预处理PDF字号：计算全局字号限制（与TextFittingAdapter算法一致）
   * @param {Object} pdfDoc - pdf-lib文档对象
   * @param {Object} font - pdf-lib字体对象
   * @param {Array} translatedContentList - 翻译内容列表
   * @returns {Object} { shortTextLimit, longTextLimit } 字号限制（单位：pt）
   */
  preprocessPdfFontSizes(pdfDoc, font, translatedContentList) {
    console.log('[PDFExporter] 开始预处理全局字号（计算百分位数限制）...');
    const startTime = performance.now();

    const BBOX_NORMALIZED_RANGE = this.options.bboxNormalizedRange;
    const allScales = [];
    const allBboxHeights = [];

    // 收集所有段落的最优缩放因子和bbox高度
    translatedContentList.forEach((item, idx) => {
      if (item.type !== 'text' || !item.text || !item.bbox) return;

      const bbox = item.bbox;
      const pageIdx = item.page_idx !== undefined ? item.page_idx : 0;

      if (pageIdx >= pdfDoc.getPageCount()) return;

      const page = pdfDoc.getPage(pageIdx);
      const { width: pageWidth, height: pageHeight } = page.getSize();

      const scaleX = pageWidth / BBOX_NORMALIZED_RANGE;
      const scaleY = pageHeight / BBOX_NORMALIZED_RANGE;

      const boxWidth = (bbox[2] - bbox[0]) * scaleX;
      const boxHeight = (bbox[3] - bbox[1]) * scaleY;
      const text = item.text;

      // 收集bbox高度（用于计算平均值）
      allBboxHeights.push(boxHeight);

      // 检测公式和短文本
      const hasFormula = /\$\$?[\s\S]*?\$\$?/.test(text);
      const isShortText = text.length < 50 || (/\n/.test(text) && text.length < 80);

      // 计算最优缩放（字号/bbox高度）
      const optimalScale = this._calculateOptimalScaleForPdf(font, text, boxWidth, boxHeight, hasFormula);

      // 按字符数加权采样
      const unitCount = Math.max(1, Math.floor(text.length / 10));
      for (let i = 0; i < unitCount; i++) {
        allScales.push(optimalScale);
      }
    });

    // 计算百分位数（缩放因子的百分位数，不是字号）
    const percentile60 = this._calculatePercentile(allScales, 0.60);
    const percentile80 = this._calculatePercentile(allScales, 0.80);

    const result = {
      shortTextLimitScale: percentile80,  // 短文本缩放因子上限（80%百分位）
      longTextLimitScale: percentile60    // 长文本缩放因子上限（60%百分位）
    };

    console.log(`[PDFExporter] 预处理完成: 样本数=${allScales.length}`);
    console.log(`[PDFExporter] 百分位数: 60%=${percentile60.toFixed(3)}, 80%=${percentile80.toFixed(3)}, 耗时=${(performance.now() - startTime).toFixed(0)}ms`);
    console.log(`[PDFExporter] 缩放因子限制: 短文本≤${result.shortTextLimitScale.toFixed(3)} (80%分位), 长文本≤${result.longTextLimitScale.toFixed(3)} (60%分位)`);

    return result;
  }

  /**
   * 计算单个段落的最优缩放因子（PDF版本）
   * @private
   */
  _calculateOptimalScaleForPdf(font, text, boxWidth, boxHeight, hasFormula = false) {
    if (hasFormula) return 0.5; // 公式使用保守缩放

    const isCJK = /[\u4e00-\u9fa5]/.test(text);
    const hasNewlines = /\n/.test(text);
    const textLength = text.length;
    const initialLineSkip = isCJK ? 1.5 : 1.3;

    // 迭代尝试不同缩放因子
    for (const scale of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]) {
      const fontSize = boxHeight * scale;
      const estimatedCharWidth = fontSize * (isCJK ? 1.0 : 0.6);
      const effectiveWidth = boxWidth * 0.9;
      const charsPerLine = Math.max(1, Math.floor(effectiveWidth / estimatedCharWidth));
      const estimatedLines = hasNewlines ? text.split('\n').length : Math.ceil(textLength / charsPerLine);

      const lineHeight = fontSize * initialLineSkip;
      const totalHeight = estimatedLines === 1 ? fontSize * 1.2 : (estimatedLines - 1) * lineHeight + fontSize * 1.2;

      if (totalHeight <= boxHeight) {
        return scale; // 找到第一个可行的缩放
      }
    }

    return 0.3; // 最小缩放
  }

  /**
   * 计算百分位数（线性插值法）
   * @private
   */
  _calculatePercentile(arr, percentile) {
    if (arr.length === 0) return 0.85; // 默认值

    const sorted = [...arr].sort((a, b) => a - b);
    const index = percentile * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;

    if (lower === upper) {
      return sorted[lower];
    }
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * 计算PDF文本布局（与Canvas渲染算法一致）
   * @param {Object} font - pdf-lib字体对象
   * @param {string} text - 文本内容
   * @param {number} boxWidth - 区域宽度
   * @param {number} boxHeight - 区域高度
   * @param {boolean} isShortText - 是否为短文本
   * @param {Object} fontSizeLimits - 全局字号限制 { shortTextLimit, longTextLimit }
   * @returns {Object} { fontSize, lines, lineHeight }
   */
  calculatePdfTextLayout(font, text, boxWidth, boxHeight, isShortText = false, fontSizeLimits = null) {
    // 判断是否为 CJK 语言
    const isCJK = /[\u4e00-\u9fa5]/.test(text);
    // ✅ 使用与Canvas渲染一致的初始行距
    const lineSkip = isCJK ? 1.5 : 1.3;

    // 内边距：对小bbox减少padding避免裁剪
    const paddingTop = boxHeight < 20 ? 0.5 : 2;
    const paddingX = 2;
    const availableHeight = boxHeight - paddingTop * 2;
    const availableWidth = boxWidth - paddingX * 2;

    // 字号范围
    const estimatedSingleLineFontSize = boxHeight * 0.8;

    // 最小字号：动态调整（基于bbox高度）
    let minFontSize;
    if (boxHeight < 20) {
      minFontSize = Math.max(6, boxHeight * 0.35);  // 小bbox：最小6px
    } else {
      minFontSize = isShortText ? 10 : 8;  // 正常bbox：10px/8px
    }

    let maxFontSize = Math.min(estimatedSingleLineFontSize * 1.5, boxHeight * 1.2);

    // ✅ 应用全局缩放因子限制（与Canvas渲染保持一致）
    if (fontSizeLimits) {
      const limitScale = isShortText ? fontSizeLimits.shortTextLimitScale : fontSizeLimits.longTextLimitScale;
      const limitFontSize = boxHeight * limitScale;  // 缩放因子 × bbox高度 = 字号上限
      maxFontSize = Math.min(maxFontSize, limitFontSize);
    }

    const hasNewlines = text.includes('\n');
    const textLength = text.length;

    // 宽度因子
    const widthFactors = (textLength < 20 || hasNewlines)
      ? [1.0]
      : [1.0, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70];

    let bestSolution = null;

    // 二分查找最大可用字号
    for (const widthFactor of widthFactors) {
      const effectiveWidth = availableWidth * widthFactor;

      let low = minFontSize;
      let high = maxFontSize;
      let foundFontSize = null;
      let foundLines = null;

      while (high - low > 0.5) {
        const mid = (low + high) / 2;

        const lines = this.wrapTextForPdf(font, text, effectiveWidth, mid);
        const lineHeight = mid * lineSkip;

        // 与Canvas渲染保持一致：最后一行使用 mid * 1.2 留出垂直空间
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

      if (foundFontSize && (!bestSolution || foundFontSize > bestSolution.fontSize)) {
        bestSolution = {
          fontSize: foundFontSize,
          widthFactor: widthFactor,
          lines: foundLines,
          lineHeight: foundFontSize * lineSkip
        };
      }
    }

    // 返回最优解
    if (bestSolution) {
      return bestSolution;
    }

    // 后备方案
    const fallbackFontSize = minFontSize;
    const fallbackLineHeight = fallbackFontSize * lineSkip;
    const allLines = this.wrapTextForPdf(font, text, availableWidth, fallbackFontSize);
    const maxLines = Math.floor(availableHeight / fallbackLineHeight);
    const linesToDraw = allLines.slice(0, Math.max(1, maxLines));

    return {
      fontSize: fallbackFontSize,
      lines: linesToDraw,
      lineHeight: fallbackLineHeight,
      widthFactor: 1.0
    };
  }

  /**
   * PDF文本换行（使用pdf-lib字体测量）
   * @param {Object} font - pdf-lib字体对象
   * @param {string} text - 文本内容
   * @param {number} maxWidth - 最大宽度
   * @param {number} fontSize - 字号
   * @returns {Array} 换行后的文本数组
   */
  wrapTextForPdf(font, text, maxWidth, fontSize) {
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
        const width = font.widthOfTextAtSize(testLine, fontSize);

        if (width > maxWidth && currentLine.length > 0) {
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
   * 动态加载 pdf-lib 库和 fontkit
   */
  async loadPdfLib() {
    // 加载 pdf-lib
    if (typeof PDFLib === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = this.options.pdfLibUrl;
        script.onload = () => {
          console.log('[PDFExporter] pdf-lib 加载成功');
          this.pdfLibLoaded = true;
          resolve();
        };
        script.onerror = (error) => {
          console.error('[PDFExporter] pdf-lib 加载失败:', error);
          reject(new Error('Failed to load pdf-lib library'));
        };
        document.head.appendChild(script);
      });
    }

    // 加载 fontkit
    if (typeof fontkit === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = this.options.fontkitUrl;
        script.onload = () => {
          console.log('[PDFExporter] fontkit 加载成功');
          this.fontkitLoaded = true;
          resolve();
        };
        script.onerror = (error) => {
          console.warn('[PDFExporter] fontkit 加载失败:', error);
          resolve(); // fontkit失败不阻止流程
        };
        document.head.appendChild(script);
      });
    }
  }

  /**
   * Base64 转 Uint8Array
   * @param {string} base64 - Base64编码字符串
   * @returns {Uint8Array} 字节数组
   */
  base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PDFExporter;
}
