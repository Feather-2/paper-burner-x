
/**
 * history_pdf_compare.js
 * MinerU 结构化翻译的 PDF 对照视图（左右对照 + 长画布 + 懒加载）
 */

class PDFCompareView {
  constructor() {
    this.pdfDoc = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.scale = 1.0;
    this.dpr = window.devicePixelRatio || 1;

    // 左右两侧画布与覆盖层（长画布）
    this.originalCanvas = null;
    this.originalContext = null;
    this.originalOverlay = null;
    this.originalOverlayContext = null;
    this.translationCanvas = null;
    this.translationContext = null;
    this.translationOverlay = null;
    this.translationOverlayContext = null;

    // 数据
    this.contentListJson = null;
    this.translatedContentList = null;
    this.layoutJson = null;

    // 连续模式 & 懒加载
    this.mode = 'continuous';
    this.pageInfos = [];
    this._lazyScrollTimer = null;
    this._lazyInitialized = false;
    this._renderingVisible = false;
    this._pendingVisibleRender = false;

    // PDF.js 渲染串行队列（避免同一 canvas 并发 render 报错）
    this._renderQueueOriginal = Promise.resolve();
    this._renderQueueTranslation = Promise.resolve();

    // PDF 文本层缓存（用于精确清除文字）
    this.pageTextLayers = new Map(); // pageNum -> textContent

    // ============ 新模块化架构 ============
    // 初始化文本自适应渲染模块
    this.textFittingAdapter = null;
    // 兼容性：保留原有属性
    this.textFittingEngine = null;
    this.globalFontSizeCache = new Map();
    this.hasPreprocessed = false;

    // 初始化PDF导出模块
    this.pdfExporter = null;

    // 初始化分段管理模块
    this.segmentManager = null;

    // 初始化模块（延迟到 initialize 方法，确保依赖加载）
    this._initializeModules();
  }

  /**
   * 初始化各个功能模块
   */
  _initializeModules() {
    try {
      // 初始化文本自适应模块
      if (typeof TextFittingAdapter !== 'undefined') {
        this.textFittingAdapter = new TextFittingAdapter({
          initialScale: 1.0,
          minScale: 0.3,
          scaleStepHigh: 0.05,
          scaleStepLow: 0.1,
          lineSkipCJK: 1.5,
          lineSkipWestern: 1.3,
          minLineHeight: 1.05,
          globalFontScale: 0.85,
          bboxNormalizedRange: 1000
        });
        console.log('[PDFCompareView] TextFittingAdapter 已初始化');
      } else {
        console.warn('[PDFCompareView] TextFittingAdapter 未加载，将使用回退方案');
      }

      // 初始化PDF导出模块
      if (typeof PDFExporter !== 'undefined') {
        this.pdfExporter = new PDFExporter({
          bboxNormalizedRange: 1000
        });
        console.log('[PDFCompareView] PDFExporter 已初始化');
      } else {
        console.warn('[PDFCompareView] PDFExporter 未加载，导出功能将不可用');
      }

      // SegmentManager 将在 renderAllPagesContinuous 中初始化，因为需要 pdfDoc
    } catch (error) {
      console.error('[PDFCompareView] 模块初始化失败:', error);
    }
  }

  /**
   * 初始化文本自适应引擎
   */
  initializeTextFitting() {
    // 优先使用新模块
    if (this.textFittingAdapter) {
      this.textFittingAdapter.initialize();
      // 兼容性：同步到旧属性
      this.textFittingEngine = this.textFittingAdapter.textFittingEngine;
      return;
    }

    // 回退：使用原有实现
    if (typeof TextFittingEngine === 'undefined') {
      console.error('[PDFCompareView] TextFittingEngine 未加载！请确保 js/utils/text-fitting.js 已正确引入');
      console.error('[PDFCompareView] 当前可用类:', typeof TextFittingEngine, typeof PDFTextRenderer);
      return;
    }

    try {
      this.textFittingEngine = new TextFittingEngine({
        initialScale: 1.0,
        minScale: 0.3,
        scaleStepHigh: 0.05,
        scaleStepLow: 0.1,
        lineSkipCJK: 1.5,
        lineSkipWestern: 1.3,
        minLineHeight: 1.05
      });

      console.log('[PDFCompareView] 文本自适应引擎已启用');
    } catch (error) {
      console.error('[PDFCompareView] 文本自适应引擎初始化失败:', error);
    }
  }

  /**
   * 预处理：计算全局统一的字号
   */
  preprocessGlobalFontSizes() {
    // 优先使用新模块
    if (this.textFittingAdapter) {
      this.textFittingAdapter.preprocessGlobalFontSizes(
        this.contentListJson,
        this.translatedContentList
      );
      // 兼容性：同步缓存
      this.globalFontSizeCache = this.textFittingAdapter.globalFontSizeCache;
      this.hasPreprocessed = this.textFittingAdapter.hasPreprocessed;
      return;
    }

    // 回退：使用原有实现
    if (this.hasPreprocessed) return;

    console.log('[PDFCompareView] 开始预处理全局字号...');
    const startTime = performance.now();

    const globalFontScale = 0.85;

    this.contentListJson.forEach((item, idx) => {
      if (item.type !== 'text' || !item.bbox) return;

      const translatedItem = this.translatedContentList[idx];
      if (!translatedItem || !translatedItem.text) return;

      const bbox = item.bbox;
      const BBOX_NORMALIZED_RANGE = 1000;
      const height = (bbox[3] - bbox[1]) / BBOX_NORMALIZED_RANGE;

      const estimatedFontSize = height * globalFontScale;

      this.globalFontSizeCache.set(idx, {
        estimatedFontSize: estimatedFontSize,
        bbox: bbox
      });
    });

    console.log(`[PDFCompareView] 预处理完成：全局缩放=${globalFontScale}, 耗时=${(performance.now() - startTime).toFixed(0)}ms`);
    this.hasPreprocessed = true;
  }

  /**
   * 获取并缓存页面的文本层信息
   * @param {number} pageNum - 页码（1-based）
   * @returns {Promise<Array>} 文本项数组
   */
  async getPageTextLayer(pageNum) {
    // 检查缓存
    if (this.pageTextLayers.has(pageNum)) {
      return this.pageTextLayers.get(pageNum);
    }

    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();

      // 缓存结果
      this.pageTextLayers.set(pageNum, textContent.items);

      console.log(`[PDFCompareView] 页面 ${pageNum} 文本层已缓存，共 ${textContent.items.length} 个文本项`);
      return textContent.items;
    } catch (error) {
      console.error(`[PDFCompareView] 获取页面 ${pageNum} 文本层失败:`, error);
      return [];
    }
  }

  /**
   * 精确清除 bbox 内的原始文字（只清除文字，保留背景）
   * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
   * @param {number} pageNum - 页码（1-based）
   * @param {Object} bbox - 边界框 { x, y, w, h }（canvas 坐标）
   * @param {number} yOffset - Y 轴偏移（用于连续模式）
   */
  async clearTextInBbox(ctx, pageNum, bbox, yOffset = 0) {
    const textItems = await this.getPageTextLayer(pageNum);
    if (!textItems || textItems.length === 0) {
      console.warn(`[clearTextInBbox] 页面 ${pageNum} 没有文本层数据`);
      return;
    }

    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: this.scale * this.dpr });

    console.log(`[clearTextInBbox] 页面 ${pageNum}, bbox: x=${bbox.x.toFixed(1)}, y=${bbox.y.toFixed(1)}, w=${bbox.w.toFixed(1)}, h=${bbox.h.toFixed(1)}, yOffset=${yOffset.toFixed(1)}, viewport: ${viewport.width}x${viewport.height}`);

    let clearedCount = 0;
    let checkedCount = 0;

    // 遍历所有文本项，找出与 bbox 重叠的
    for (const item of textItems) {
      if (!item.transform) continue;
      checkedCount++;

      // PDF.js 文本项的坐标转换
      // transform: [scaleX, skewY, skewX, scaleY, translateX, translateY]
      const transform = item.transform;
      const tx = transform[4] * this.scale * this.dpr;
      const ty = transform[5] * this.scale * this.dpr;
      const itemWidth = item.width * this.scale * this.dpr;
      const itemHeight = item.height * this.scale * this.dpr;

      // 转换为 Canvas 坐标（考虑 Y 轴翻转）
      const textX = tx;
      const textY = viewport.height - ty - itemHeight;
      const textW = itemWidth;
      const textH = itemHeight;

      // 注意：这里的 bbox.y 已经包含了 yOffset（在调用时计算好的）
      // 所以 textY 也需要加上 yOffset 才能对齐
      const textRect = { x: textX, y: textY + yOffset, w: textW, h: textH };

      // 调试：显示前几个文本项的坐标
      if (clearedCount === 0 && checkedCount <= 3) {
        console.log(`  文本项 ${checkedCount}: str="${item.str}", textRect: x=${textRect.x.toFixed(1)}, y=${textRect.y.toFixed(1)}, w=${textRect.w.toFixed(1)}, h=${textRect.h.toFixed(1)}`);
      }

      // 检查是否与 bbox 重叠
      if (this.checkRectOverlap(textRect, bbox)) {
        // 在文本区域填充白色（略微扩大边界以确保覆盖完整）
        const padding = 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 1.0)'; // 完全不透明
        ctx.fillRect(
          textX - padding,
          textY + yOffset - padding,
          textW + padding * 2,
          textH + padding * 2
        );
        clearedCount++;

        // 调试：绘制红色边框显示清除区域（已关闭）
        if (false) {
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
          ctx.lineWidth = 2;
          ctx.strokeRect(textX - padding, textY + yOffset - padding, textW + padding * 2, textH + padding * 2);
        }

        // 调试：显示清除的文本
        if (clearedCount <= 5) {
          console.log(`  清除文本 ${clearedCount}: "${item.str}" at (${textX.toFixed(1)}, ${(textY + yOffset).toFixed(1)})`);
        }
      }
    }

    console.log(`[clearTextInBbox] 页面 ${pageNum} 检查了 ${checkedCount} 个文本项，清除了 ${clearedCount} 个`);
  }

  /**
   * 检查两个矩形是否重叠
   * @param {Object} rect1 - { x, y, w, h }
   * @param {Object} rect2 - { x, y, w, h }
   * @returns {boolean}
   */
  checkRectOverlap(rect1, rect2) {
    return !(
      rect1.x + rect1.w < rect2.x ||  // rect1 在 rect2 左边
      rect1.x > rect2.x + rect2.w ||  // rect1 在 rect2 右边
      rect1.y + rect1.h < rect2.y ||  // rect1 在 rect2 上边
      rect1.y > rect2.y + rect2.h     // rect1 在 rect2 下边
    );
  }

  /**
   * 初始化 PDF 对照视图
   * @param {string} pdfBase64 - PDF 文件的 base64 字符串
   * @param {Array} contentListJson - content_list.json 数据
   * @param {Array} translatedContentList - 翻译后的内容列表
   * @param {Object} layoutJson - layout.json 数据（包含页面真实尺寸）
   */
  async initialize(pdfBase64, contentListJson, translatedContentList, layoutJson) {
    // 初始化文本自适应引擎
    this.initializeTextFitting();

    // 保存原始PDF数据（用于导出）
    this.originalPdfBase64 = pdfBase64;

    this.contentListJson = contentListJson;
    this.translatedContentList = translatedContentList;
    this.layoutJson = layoutJson;

    // 将 base64 转换为 Uint8Array
    const pdfData = this.base64ToUint8Array(pdfBase64);

    // 加载 PDF
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    this.pdfDoc = await loadingTask.promise;
    this.totalPages = this.pdfDoc.numPages;

    console.log(`[PDFCompareView] PDF 加载成功，共 ${this.totalPages} 页`);

    // 从 layout.json 和 contentListJson 提取每页的图像尺寸
    this.pageImageSizes = {};

    // 方法1: 从 contentListJson 分析每页的 bbox 最大值（最可靠）
    if (contentListJson && Array.isArray(contentListJson)) {
      console.log('[PDFCompareView] 从 contentListJson 分析 bbox 范围...');
      contentListJson.forEach(item => {
        if (item.bbox && item.page_idx !== undefined) {
          const pageIdx = item.page_idx;
          if (!this.pageImageSizes[pageIdx]) {
            this.pageImageSizes[pageIdx] = { width: 0, height: 0 };
          }
          // bbox: [x0, y0, x1, y1]
          this.pageImageSizes[pageIdx].width = Math.max(this.pageImageSizes[pageIdx].width, item.bbox[2]);
          this.pageImageSizes[pageIdx].height = Math.max(this.pageImageSizes[pageIdx].height, item.bbox[3]);
        }
      });

      console.log('[PDFCompareView] 从 contentListJson 推断的页面尺寸:', this.pageImageSizes);
    }

    // 方法2: 从 layout.json 获取（作为补充）
    if (layoutJson) {
      console.log('[PDFCompareView] layout.json 类型:', typeof layoutJson);

      // 检查是否是 { "pdf_info": [...] } 格式
      let pdfInfoArray = null;
      if (layoutJson.pdf_info && Array.isArray(layoutJson.pdf_info)) {
        pdfInfoArray = layoutJson.pdf_info;
        console.log('[PDFCompareView] 从 layoutJson.pdf_info 获取数据，共', pdfInfoArray.length, '页');
      } else if (Array.isArray(layoutJson)) {
        pdfInfoArray = layoutJson;
        console.log('[PDFCompareView] layoutJson 直接是数组');
      }

      if (pdfInfoArray) {
        pdfInfoArray.forEach((pageData) => {
          const index = pageData.page_idx !== undefined ? pageData.page_idx : pdfInfoArray.indexOf(pageData);

          // 从 preproc_blocks 获取 bbox 最大值
          if (pageData.preproc_blocks && Array.isArray(pageData.preproc_blocks)) {
            let maxX = 0, maxY = 0;
            pageData.preproc_blocks.forEach(block => {
              if (block.bbox) {
                maxX = Math.max(maxX, block.bbox[2]);
                maxY = Math.max(maxY, block.bbox[3]);
              }
            });
            if (maxX > 0 && maxY > 0) {
              // 如果从 preproc_blocks 得到的尺寸更大，使用它
              if (!this.pageImageSizes[index] || maxX > this.pageImageSizes[index].width) {
                this.pageImageSizes[index] = { width: maxX, height: maxY };
                console.log(`[PDFCompareView] 页面 ${index} 从 preproc_blocks 获取尺寸:`, this.pageImageSizes[index]);
              }
            }
          }
        });
      }
    }

    console.log('[PDFCompareView] 最终页面图像尺寸:', this.pageImageSizes);
  }

  /**
   * Base64 转 Uint8Array
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

  /**
   * 渲染 HTML 结构
   */
  renderHTML() {
    return `
      <div class="pdf-compare-container" style="display: flex; height: 100vh; gap: 0; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: #f5f5f5; z-index: 1000;">
        <!-- 左侧：原文 PDF (50% 宽度) -->
        <div class="pdf-viewer-area pdf-original" style="flex: 1; border-right: 1px solid #e0e0e0; overflow: auto; background: #fff; position: relative; display: flex; flex-direction: column;">
          <div class="pdf-controls" style="height: 56px; background: #ffffff; padding: 0 24px; border-bottom: 1px solid #e0e0e0; z-index: 10; display: flex; gap: 12px; align-items: center; flex-shrink: 0;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <button id="pdf-prev-page" style="padding: 7px 14px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; color: #495057; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s;" onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='#f8f9fa'">← 上一页</button>
              <button id="pdf-next-page" style="padding: 7px 14px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; color: #495057; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s;" onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='#f8f9fa'">下一页 →</button>
            </div>
            <span id="pdf-page-info" style="color: #6c757d; font-size: 13px; font-weight: 500; padding: 0 8px;">第 1 页 / 共 0 页</span>
            <div style="flex: 1;"></div>
            <div style="display: flex; gap: 6px; align-items: center; background: #f8f9fa; padding: 4px; border-radius: 6px;">
              <button id="pdf-zoom-out" style="width: 32px; height: 32px; background: transparent; border: none; color: #495057; cursor: pointer; font-size: 18px; font-weight: 600; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s;" onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='transparent'">−</button>
              <span id="pdf-zoom-level" style="color: #495057; font-size: 13px; font-weight: 500; min-width: 48px; text-align: center;">100%</span>
              <button id="pdf-zoom-in" style="width: 32px; height: 32px; background: transparent; border: none; color: #495057; cursor: pointer; font-size: 18px; font-weight: 600; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.2s;" onmouseover="this.style.background='#e9ecef'" onmouseout="this.style.background='transparent'">+</button>
            </div>
            <button id="pdf-exit-fullscreen" style="padding: 7px 16px; background: #dc3545; border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s;" onmouseover="this.style.background='#c82333'" onmouseout="this.style.background='#dc3545'">退出对照</button>
          </div>
          <div class="pdf-scroll-area" id="pdf-original-scroll" style="flex: 1; overflow: auto; padding: 20px; position: relative; background: #f5f5f5;">
            <div id="pdf-original-segments" class="pdf-segments" style="position: relative; display: block;"></div>
          </div>
        </div>

        <!-- 右侧：译文 PDF (50% 宽度) -->
        <div class="pdf-viewer-area pdf-translation" style="flex: 1; overflow: auto; background: #fff; position: relative; display: flex; flex-direction: column;">
          <div class="pdf-controls" style="height: 56px; background: #ffffff; padding: 0 24px; border-bottom: 1px solid #e0e0e0; z-index: 10; display: flex; gap: 12px; align-items: center; flex-shrink: 0;">
            <div style="display: flex; align-items: center; gap: 8px; padding: 6px 16px; background: #e8f5e9; border-radius: 20px;">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;"><path d="M3 5.5C3 4.67157 3.67157 4 4.5 4H11.5C12.3284 4 13 4.67157 13 5.5V12.5C13 13.3284 12.3284 14 11.5 14H4.5C3.67157 14 3 13.3284 3 12.5V5.5Z" stroke="#2e7d32" stroke-width="1.5"/><path d="M5 7H11M5 9.5H9" stroke="#2e7d32" stroke-width="1.5" stroke-linecap="round"/></svg>
              <span style="color: #2e7d32; font-size: 13px; font-weight: 600;">译文对照</span>
            </div>
            <!-- 导出按钮（右对齐） -->
            <div style="margin-left: auto; display: flex; gap: 8px; align-items: center;">
              <button id="pdf-export-structured-translation" style="padding: 7px 16px; background: #1976d2; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; transition: all 0.2s; box-shadow: 0 2px 4px rgba(25, 118, 210, 0.2);" onmouseover="this.style.background='#1565c0'; this.style.boxShadow='0 4px 8px rgba(25, 118, 210, 0.3)'" onmouseout="this.style.background='#1976d2'; this.style.boxShadow='0 2px 4px rgba(25, 118, 210, 0.2)'" title="导出保留原格式的译文PDF">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="flex-shrink: 0;"><path d="M12 15V3M12 15L7 10M12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 17L2 19C2 20.1046 2.89543 21 4 21L20 21C21.1046 21 22 20.1046 22 19V17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                <span>导出译文PDF</span>
              </button>
            </div>
          </div>
          <div class="pdf-scroll-area" id="pdf-translation-scroll" style="flex: 1; overflow: auto; padding: 20px; position: relative; background: #f5f5f5;">
            <div id="pdf-translation-segments" class="pdf-segments" style="position: relative; display: block;"></div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 渲染页面并绑定事件
   */
  async render(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('[PDFCompareView] 容器不存在:', containerId);
      return;
    }

    container.innerHTML = this.renderHTML();

    // 隐藏所有浮动图标，只保留 chatbot
    this.hideFloatingIcons();

    // 段容器（左右）
    this.originalScroll = document.getElementById('pdf-original-scroll');
    this.translationScroll = document.getElementById('pdf-translation-scroll');
    this.originalSegmentsContainer = document.getElementById('pdf-original-segments');
    this.translationSegmentsContainer = document.getElementById('pdf-translation-segments');

    // 段列表
    this.segments = []; // 每段包含左右两侧 canvas/overlay 与段内页列表

    // 渲染所有页面（连续滚动模式）
    await this.renderAllPagesContinuous();

    // 绑定事件
    this.bindEvents();

    // 绑定滚动联动
    this.bindScrollSync();

    // 绑定 bbox 点击事件
    this.bindBboxClick();
  }

  /**
   * 连续滚动模式：懒加载渲染所有页面到一个长画布
   */
  async renderAllPagesContinuous() {
    this.mode = 'continuous';

    // 优先使用新模块
    if (typeof SegmentManager !== 'undefined') {
      // 初始化 SegmentManager
      this.segmentManager = new SegmentManager(this.pdfDoc, {
        maxSegmentPixels: this.dpr >= 2 ? 4096 : 8192,
        bufferRatio: 0.5,
        scrollDebounceMs: 80,
        bboxNormalizedRange: 1000
      });

      // 设置容器
      this.segmentManager.setContainers(
        this.originalSegmentsContainer,
        this.translationSegmentsContainer,
        document.getElementById('pdf-original-scroll'),
        document.getElementById('pdf-translation-scroll')
      );

      // 设置依赖注入
      this.segmentManager.setDependencies({
        renderPageBboxesToCtx: this.renderPageBboxesToCtx.bind(this),
        renderPageTranslationToCtx: this.renderPageTranslationToCtx.bind(this),
        clearTextInBbox: this.clearTextInBbox.bind(this),
        clearFormulaElementsForPageInWrapper: this.clearFormulaElementsForPageInWrapper.bind(this),
        onOverlayClick: this.onSegmentOverlayClick.bind(this),
        contentListJson: this.contentListJson
      });

      // 执行渲染
      await this.segmentManager.renderAllPagesContinuous();

      // 同步属性（兼容性）
      this.pageInfos = this.segmentManager.pageInfos;
      this.scale = this.segmentManager.scale;
      this.segments = this.segmentManager.segments;

      // 更新UI
      document.getElementById('pdf-page-info').textContent = `共 ${this.totalPages} 页`;
      document.getElementById('pdf-zoom-level').textContent = `${Math.round(this.scale * 100)}%`;

      return;
    }

    // 回退：使用原有实现
    // 计算自适应缩放
    const firstPage = await this.pdfDoc.getPage(1);
    const originalViewport = firstPage.getViewport({ scale: 1.0 });
    const containerWidth = document.getElementById('pdf-original-scroll').clientWidth - 40;
    this.scale = Math.min(containerWidth / originalViewport.width, 1.5);

    const dpr = this.dpr;
    console.log(`[PDF连续模式] DPR=${dpr}, scale=${this.scale}`);

    // 计算所有页面尺寸（物理像素）并分段
    this.pageInfos = [];
    let totalHeight = 0;
    for (let i = 1; i <= this.totalPages; i++) {
      const page = await this.pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: this.scale * dpr });
      const info = { pageNum: i, page, viewport, yOffset: totalHeight, width: viewport.width, height: viewport.height };
      this.pageInfos.push(info);
      totalHeight += viewport.height;
    }

    // 清空旧段容器
    this.originalSegmentsContainer.innerHTML = '';
    this.translationSegmentsContainer.innerHTML = '';
    this.segments = [];

    const MAX_SEG_PX = (dpr >= 2 ? 4096 : 8192);
    const canvasWidth = this.pageInfos.length > 0 ? this.pageInfos[0].width : Math.round(originalViewport.width * this.scale * dpr);
    let currentSeg = null;
    let currentSegHeight = 0;
    let currentSegTop = 0;

    const startNewSegment = () => {
      const segIndex = this.segments.length;
      if (currentSeg) currentSegTop += currentSegHeight;
      currentSegHeight = 0;
      const seg = {
        index: segIndex,
        topPx: currentSegTop,
        heightPx: 0,
        widthPx: canvasWidth,
        pages: [], // { pageNum, page, viewport, yInSegPx, width, height }
        left: null,
        right: null,
        rendered: false,
        rendering: false,
        textCleared: false, // 标记是否已清除文字（避免重复清除）
      };
      this.segments.push(seg);
      currentSeg = seg;
    };

    startNewSegment();
    for (const p of this.pageInfos) {
      if (currentSegHeight > 0 && (currentSegHeight + p.height) > MAX_SEG_PX) {
        currentSeg.heightPx = currentSegHeight;
        startNewSegment();
      }
      const yInSeg = currentSegHeight;
      currentSeg.pages.push({ pageNum: p.pageNum, page: p.page, viewport: p.viewport, yInSegPx: yInSeg, width: p.width, height: p.height });
      currentSegHeight += p.height;
    }
    if (currentSeg) currentSeg.heightPx = currentSegHeight;

    // 创建段 DOM
    for (const seg of this.segments) {
      this.createSegmentDom(seg, dpr);
    }

    // 初始化懒加载（按段）
    this.initLazyLoadingSegments();

    document.getElementById('pdf-page-info').textContent = `共 ${this.totalPages} 页`;
    document.getElementById('pdf-zoom-level').textContent = `${Math.round(this.scale * 100)}%`;
  }

  /**
   * 创建一个段的左右 DOM 和上下文
   */
  createSegmentDom(seg, dpr) {
    const cssWidth = seg.widthPx / dpr;
    const cssHeight = seg.heightPx / dpr;

    const buildSide = (container, side) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-segment-wrapper';
      wrapper.style.position = 'relative';
      wrapper.style.display = 'block';
      wrapper.style.width = cssWidth + 'px';
      wrapper.style.height = cssHeight + 'px';
      wrapper.style.margin = '0';

      const canvas = document.createElement('canvas');
      canvas.width = seg.widthPx;
      canvas.height = seg.heightPx;
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = cssHeight + 'px';
      const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });

      const overlay = document.createElement('canvas');
      overlay.width = seg.widthPx;
      overlay.height = seg.heightPx;
      overlay.style.width = cssWidth + 'px';
      overlay.style.height = cssHeight + 'px';
      overlay.style.position = 'absolute';
      overlay.style.left = '0';
      overlay.style.top = '0';
      const overlayCtx = overlay.getContext('2d', { willReadFrequently: true });

      wrapper.appendChild(canvas);
      wrapper.appendChild(overlay);
      container.appendChild(wrapper);

      const sideObj = { wrapper, canvas, ctx, overlay, overlayCtx };
      if (side === 'left') seg.left = sideObj; else seg.right = sideObj;

      if (side === 'left') {
        overlay.addEventListener('click', (e) => this.onSegmentOverlayClick(e, seg));
      }
    };

    buildSide(this.originalSegmentsContainer, 'left');
    buildSide(this.translationSegmentsContainer, 'right');
  }

  /**
   * 初始化懒加载：监听滚动，渲染可见区域
   */
  initLazyLoadingSegments() {
    this.originalScroll = document.getElementById('pdf-original-scroll');
    this.translationScroll = document.getElementById('pdf-translation-scroll');
    if (!this.originalScroll || !this.translationScroll) return;

    // 初始渲染可见段
    this.renderVisibleSegments(this.originalScroll);

    const onScroll = (scroller) => {
      clearTimeout(this._lazyScrollTimer);
      this._lazyScrollTimer = setTimeout(() => {
        this.renderVisibleSegments(scroller);
      }, 80);
    };

    if (!this._lazyInitialized) {
      this.originalScroll.addEventListener('scroll', () => onScroll(this.originalScroll));
      this.translationScroll.addEventListener('scroll', () => onScroll(this.translationScroll));
      this._lazyInitialized = true;
    }
  }

  /**
   * 渲染当前可见的页面（视口+缓冲区）
   */
  async renderVisibleSegments(container) {
    if (!this.segments || this.segments.length === 0 || !container) return;
    if (this._renderingVisible) { this._pendingVisibleRender = true; return; }
    this._renderingVisible = true;

    const dpr = this.dpr;
    const scrollTopCss = container.scrollTop;
    const viewportHeightCss = container.clientHeight;
    const bufferCss = viewportHeightCss * 0.5;
    const visibleStartPx = Math.max(0, (scrollTopCss - bufferCss) * dpr);
    const visibleEndPx = (scrollTopCss + viewportHeightCss + bufferCss) * dpr;

    for (const seg of this.segments) {
      const segStart = seg.topPx;
      const segEnd = seg.topPx + seg.heightPx;
      const isVisible = segEnd >= visibleStartPx && segStart <= visibleEndPx;
      // 关键：只要进入可见区且不在渲染中，就再次渲染该段
      if (isVisible && !seg.rendering) {
        try {
          seg.rendering = true;
          await this.renderSegment(seg);
          seg.rendered = true;
        } finally {
          seg.rendering = false;
        }
      }
    }

    this._renderingVisible = false;
    if (this._pendingVisibleRender) {
      this._pendingVisibleRender = false;
      this.renderVisibleSegments(container);
    }
  }

  /**
   * 在连续模式下渲染单个页面
   */
  async renderSegment(seg) {
    // 逐页渲染：先渲染到离屏小画布，再绘制到段画布，避免 pdf.js 在目标大画布上可能的清除行为
    const off = document.createElement('canvas');
    const offCtx = off.getContext('2d', { willReadFrequently: true, alpha: false });
    for (const p of seg.pages) {
      if (off.width !== p.width) off.width = p.width;
      if (off.height !== p.height) off.height = p.height;
      // 清理离屏
      offCtx.clearRect(0, 0, off.width, off.height);
      await p.page.render({ canvasContext: offCtx, viewport: p.viewport }).promise;
      // 绘制到左右段 base 画布
      seg.left.ctx.drawImage(off, 0, p.yInSegPx);
      seg.right.ctx.drawImage(off, 0, p.yInSegPx);
    }

    // 绘制 overlays（仅本段）
    // 注意：白色背景和翻译文本都在 overlay 层绘制，不会被 PDF 覆盖
    await this.renderSegmentOverlays(seg);
  }

  /**
   * 清除段内所有 bbox 的原始文字（在 base canvas 上操作）
   */
  async clearTextInSegment(seg) {
    const pageItems = this.contentListJson.filter(item => item.type === 'text');
    const BBOX_NORMALIZED_RANGE = 1000;

    for (const p of seg.pages) {
      const pageNum = p.pageNum;
      const scaleX = p.width / BBOX_NORMALIZED_RANGE;
      const scaleY = p.height / BBOX_NORMALIZED_RANGE;

      // 获取当前页的所有 bbox
      const currentPageItems = pageItems.filter(item => item.page_idx === pageNum - 1);

      for (const item of currentPageItems) {
        if (!item.bbox) continue;

        const bb = item.bbox;
        const x = bb[0] * scaleX;
        const y = bb[1] * scaleY + p.yInSegPx;
        const w = (bb[2] - bb[0]) * scaleX;
        const h = (bb[3] - bb[1]) * scaleY;

        // 在右侧 base canvas 上精确清除文字
        await this.clearTextInBbox(seg.right.ctx, pageNum, { x, y, w, h }, p.yInSegPx);
      }
    }
  }

  async renderSegmentOverlays(seg) {
    const leftCtx = seg.left.overlayCtx;
    const rightCtx = seg.right.overlayCtx;
    // 清理段 overlay
    leftCtx.clearRect(0, 0, seg.widthPx, seg.heightPx);
    rightCtx.clearRect(0, 0, seg.widthPx, seg.heightPx);
    // 清理该段所有页的公式 DOM
    for (const p of seg.pages) {
      this.clearFormulaElementsForPageInWrapper(p.pageNum, seg.right.wrapper);
    }

    // 绘制 overlays（串行执行以确保文本层正确清除）
    for (const p of seg.pages) {
      this.renderPageBboxesToCtx(leftCtx, p.pageNum, p.yInSegPx, p.width, p.height);
      await this.renderPageTranslationToCtx(rightCtx, seg.right.wrapper, p.pageNum, p.yInSegPx, p.width, p.height);
    }
  }

  /**
   * 将渲染任务加入到指定画布的串行队列，防止 PDF.js 并发渲染报错
   */
  enqueueCanvasRender(target, taskFactory) {
    const key = target === 'original' ? '_renderQueueOriginal' : '_renderQueueTranslation';
    const chain = this[key].then(() => taskFactory()).catch(err => {
      console.warn('[PDFCompareView] render task failed:', err);
    });
    // 确保后续任务接在本次后面
    this[key] = chain.then(() => undefined);
    return chain;
  }

  /**
   * 渲染单页的bbox
   */
  renderPageBboxes(pageNum, yOffset, pageWidth, pageHeight) {
    const pageItems = this.contentListJson.filter(item => item.page_idx === pageNum - 1 && item.type === 'text');

    const BBOX_NORMALIZED_RANGE = 1000;
    const scaleX = pageWidth / BBOX_NORMALIZED_RANGE;
    const scaleY = pageHeight / BBOX_NORMALIZED_RANGE;

    const ctx = this.originalOverlayContext;
    pageItems.forEach(item => {
      if (!item.bbox) return;
      const bbox = item.bbox;
      const x = bbox[0] * scaleX;
      const y = bbox[1] * scaleY + yOffset;
      const w = (bbox[2] - bbox[0]) * scaleX;
      const h = (bbox[3] - bbox[1]) * scaleY;

      ctx.strokeStyle = 'rgb(153, 0, 76)';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.strokeRect(x, y, w, h);
      ctx.globalAlpha = 1.0;
    });
  }

  /**
   * 渲染单页的翻译
   */
  renderPageTranslation(pageNum, yOffset, pageWidth, pageHeight) {
    const pageItems = this.contentListJson.filter(item => item.page_idx === pageNum - 1 && item.type === 'text');

    const BBOX_NORMALIZED_RANGE = 1000;
    const scaleX = pageWidth / BBOX_NORMALIZED_RANGE;
    const scaleY = pageHeight / BBOX_NORMALIZED_RANGE;

    const ctx = this.translationOverlayContext;
    // 清理该页区域上的历史绘制与公式 DOM
    ctx.clearRect(0, yOffset, pageWidth, pageHeight);
    this.clearFormulaElementsForPage(pageNum);

    pageItems.forEach((item, idx) => {
      const originalIdx = this.contentListJson.indexOf(item);
      const translatedItem = this.translatedContentList[originalIdx];
      if (!translatedItem || !item.bbox) return;

      const bbox = item.bbox;
      const x = bbox[0] * scaleX;
      const y = bbox[1] * scaleY + yOffset;
      const w = (bbox[2] - bbox[0]) * scaleX;
      const h = (bbox[3] - bbox[1]) * scaleY;

      // 直接使用原始 bbox（文本自适应引擎会自动处理）
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillRect(x, y, w, h);

      this.drawTextInBox(ctx, translatedItem.text, x, y, w, h, pageNum);
    });
  }

  // 分段：将 bbox 绘制到指定 ctx
  renderPageBboxesToCtx(ctx, pageNum, yOffset, pageWidth, pageHeight) {
    const pageItems = this.contentListJson.filter(item => item.page_idx === pageNum - 1 && item.type === 'text');
    const BBOX_NORMALIZED_RANGE = 1000;
    const scaleX = pageWidth / BBOX_NORMALIZED_RANGE;
    const scaleY = pageHeight / BBOX_NORMALIZED_RANGE;
    pageItems.forEach(item => {
      if (!item.bbox) return;
      const b = item.bbox;
      const x = b[0] * scaleX;
      const y = b[1] * scaleY + yOffset;
      const w = (b[2] - b[0]) * scaleX;
      const h = (b[3] - b[1]) * scaleY;
      ctx.strokeStyle = 'rgb(153, 0, 76)';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.strokeRect(x, y, w, h);
      ctx.globalAlpha = 1.0;
    });
  }

  // 分段：将译文绘制到指定 ctx，并将公式 DOM 插入到 wrapper
  async renderPageTranslationToCtx(ctx, wrapperEl, pageNum, yOffset, pageWidth, pageHeight) {
    // 确保已经完成预处理
    if (!this.hasPreprocessed) {
      this.preprocessGlobalFontSizes();
    }

    const pageItems = this.contentListJson.filter(item => item.page_idx === pageNum - 1 && item.type === 'text');
    const BBOX_NORMALIZED_RANGE = 1000;
    const scaleX = pageWidth / BBOX_NORMALIZED_RANGE;
    const scaleY = pageHeight / BBOX_NORMALIZED_RANGE;

    // 第一步：在 overlay 层绘制白色背景（覆盖原始文字）
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

    // 第二步：绘制翻译文本（在白色背景上）
    pageItems.forEach((item) => {
      const originalIdx = this.contentListJson.indexOf(item);
      const translatedItem = this.translatedContentList[originalIdx];
      if (!translatedItem || !item.bbox) return;

      const bb = item.bbox;
      const x = bb[0] * scaleX;
      const y = bb[1] * scaleY + yOffset;
      const w = (bb[2] - bb[0]) * scaleX;
      const h = (bb[3] - bb[1]) * scaleY;

      // 使用预处理的字号信息
      const cachedInfo = this.globalFontSizeCache.get(originalIdx);

      // 使用新的文本自适应引擎渲染
      this.drawTextInBox(ctx, translatedItem.text, x, y, w, h, pageNum, wrapperEl, cachedInfo);
    });
  }

  /**
   * 渲染指定页面（双PDF）
   */
  async renderPage(pageNum) {
    if (!this.pdfDoc) return;

    this.currentPage = pageNum;
    const page = await this.pdfDoc.getPage(pageNum);

    // 计算自适应缩放比例
    const originalViewport = page.getViewport({ scale: 1.0 });
    const containerWidth = document.getElementById('pdf-original-scroll').clientWidth - 40; // 减去 padding
    const autoScale = containerWidth / originalViewport.width;

    // 如果是第一次渲染，使用自适应缩放
    if (this.scale === 1.0 && pageNum === 1) {
      this.scale = Math.min(autoScale, 1.5); // 最大不超过 150%
    }

    console.log(`[PDFCompareView] 自适应缩放计算: containerWidth=${containerWidth}, pdfWidth=${originalViewport.width}, autoScale=${autoScale}, 最终scale=${this.scale}`);

    // 考虑设备像素比，提高清晰度
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: this.scale * dpr });

    // 保存页面的原始尺寸（未缩放）用于 bbox 坐标转换
    this.currentPageOriginalWidth = originalViewport.width;
    this.currentPageOriginalHeight = originalViewport.height;

    // 设置原文 canvas 尺寸（物理像素）
    this.originalCanvas.width = viewport.width;
    this.originalCanvas.height = viewport.height;
    this.originalOverlay.width = viewport.width;
    this.originalOverlay.height = viewport.height;

    // 设置 CSS 尺寸（逻辑像素）
    this.originalCanvas.style.width = viewport.width / dpr + 'px';
    this.originalCanvas.style.height = viewport.height / dpr + 'px';
    this.originalOverlay.style.width = viewport.width / dpr + 'px';
    this.originalOverlay.style.height = viewport.height / dpr + 'px';

    // 设置译文 canvas 尺寸（物理像素）
    this.translationCanvas.width = viewport.width;
    this.translationCanvas.height = viewport.height;
    this.translationOverlay.width = viewport.width;
    this.translationOverlay.height = viewport.height;

    // 设置 CSS 尺寸（逻辑像素）
    this.translationCanvas.style.width = viewport.width / dpr + 'px';
    this.translationCanvas.style.height = viewport.height / dpr + 'px';
    this.translationOverlay.style.width = viewport.width / dpr + 'px';
    this.translationOverlay.style.height = viewport.height / dpr + 'px';

    console.log(`[PDFCompareView] Canvas 尺寸设置: 物理=${viewport.width}x${viewport.height}, CSS=${viewport.width/dpr}x${viewport.height/dpr}, DPR=${dpr}`);

    // 渲染原文 PDF 页面
    const renderContext = {
      canvasContext: this.originalContext,
      viewport: viewport
    };
    await page.render(renderContext).promise;

    // 渲染译文 PDF 页面（先复制原文）
    const translationRenderContext = {
      canvasContext: this.translationContext,
      viewport: viewport
    };
    await page.render(translationRenderContext).promise;

    // 更新页码显示
    document.getElementById('pdf-page-info').textContent = `第 ${pageNum} 页 / 共 ${this.totalPages} 页`;

    console.log(`[PDFCompareView] 页面 ${pageNum} 渲染完成，原始尺寸: ${this.currentPageOriginalWidth} x ${this.currentPageOriginalHeight}, 缩放后: ${viewport.width} x ${viewport.height}`);

    // 在译文 PDF 上渲染翻译文本
    this.renderTranslationOverlay(pageNum);

    // 绘制所有 bbox（可见性激活）
    this.renderAllBboxes(pageNum);
  }

  /**
   * 渲染翻译内容列表（已废弃，改为双 PDF 模式）
   */
  renderTranslationList() {
    // 双 PDF 模式下不再需要翻译列表
  }

  /**
   * 选中翻译项，高亮对应 PDF 区域（已废弃）
   */
  selectTranslationItem(index) {
    // 双 PDF 模式下不再需要
  }

  /**
   * 在 PDF 上高亮 bbox 区域（保留用于兼容）
   */
  highlightBboxOnPDF(index) {
    // 双 PDF 模式下已废弃此功能
  }

  /**
   * 渲染译文 PDF 上的翻译文本覆盖层
   */
  renderTranslationOverlay(pageNum) {
    const currentPageIndex = pageNum - 1;
    const ctx = this.translationOverlayContext;

    console.log('[renderTranslationOverlay] 开始渲染翻译层，页码:', pageNum);

    // 清空overlay
    ctx.clearRect(0, 0, this.translationOverlay.width, this.translationOverlay.height);

    // 仅清理该页的公式 DOM 元素
    this.clearFormulaElementsForPage(pageNum);

    // 获取当前页的所有内容块（只处理文本类型）
    const pageItems = this.contentListJson.filter(item =>
      item.page_idx === currentPageIndex && item.type === 'text'
    );

    console.log('[renderTranslationOverlay] 当前页文本块数量:', pageItems.length);

    const BBOX_NORMALIZED_RANGE = 1000;
    // 使用物理像素尺寸进行计算
    const scaleX = this.translationOverlay.width / BBOX_NORMALIZED_RANGE;
    const scaleY = this.translationOverlay.height / BBOX_NORMALIZED_RANGE;

    // 转换所有 bbox 到 canvas 坐标，用于碰撞检测
    const canvasBboxes = pageItems.map(item => {
      const bbox = item.bbox;
      return {
        x: bbox[0] * scaleX,
        y: bbox[1] * scaleY,
        w: (bbox[2] - bbox[0]) * scaleX,
        h: (bbox[3] - bbox[1]) * scaleY,
        originalItem: item
      };
    });

    // 记录已绘制的文本块（用于自适应碰撞检测）
    const drawnTextBoxes = [];

    // 绘制每个文本 bbox 的背景色和翻译文字
    pageItems.forEach((item, idx) => {
      const originalIdx = this.contentListJson.indexOf(item);
      const translatedItem = this.translatedContentList[originalIdx];

      if (!translatedItem || !item.bbox) return;

      const bbox = item.bbox;
      const x = bbox[0] * scaleX;
      const y = bbox[1] * scaleY;
      const w = (bbox[2] - bbox[0]) * scaleX;
      const h = (bbox[3] - bbox[1]) * scaleY;

      // 智能扩展 bbox（针对小标题和短段落特殊处理）
      const text = translatedItem.text || '';
      const isShortText = text.length < 30; // 短文本（可能是标题，增加到30字符）
      const isVerySmallBox = w < 200 || h < 40; // 较小的 bbox（增加阈值）

      const expandedBox = this.expandBboxIfPossible(
        { x, y, w, h },
        canvasBboxes,
        idx,
        this.translationOverlay.width,
        this.translationOverlay.height,
        isShortText || isVerySmallBox // 传递标记，允许更大扩展
      );

      // 绘制白色/米色背景（覆盖原文）
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillRect(expandedBox.x, expandedBox.y, expandedBox.w, expandedBox.h);

      // 自适应绘制文字（检测并避免与已绘制文本块重叠）
      const actualBox = this.drawTextInBoxAdaptive(
        ctx,
        text,
        expandedBox.x,
        expandedBox.y,
        expandedBox.w,
        expandedBox.h,
        pageNum,
        drawnTextBoxes, // 传入已绘制的文本块
        isShortText
      );

      // 记录已绘制的区域
      if (actualBox) {
        drawnTextBoxes.push(actualBox);
      }
    });

    console.log('[renderTranslationOverlay] 翻译层渲染完成');
  }

  /**
   * 智能扩展 bbox 区域（不与其他文本冲突）
   * 针对小标题和短段落特殊处理，允许更大扩展
   */
  expandBboxIfPossible(currentBox, allBboxes, currentIndex, canvasWidth, canvasHeight, allowLargeExpansion = false) {
    const { x, y, w, h } = currentBox;

    // 检测四个方向的可用空间
    const availableSpace = {
      top: y,
      bottom: canvasHeight - (y + h),
      left: x,
      right: canvasWidth - (x + w)
    };

    const expansions = [];

    if (allowLargeExpansion) {
      // 小标题或短段落：允许大幅扩展，尽量一行显示
      // 优先向右扩展（横向扩展）
      const maxRightExpand = Math.min(availableSpace.right, canvasWidth * 0.5 - w); // 增加到50%
      for (let dw of [50, 100, 150, 200, 250, 300, 350, 400]) { // 增加更多扩展选项
        if (dw <= maxRightExpand) {
          expansions.push({ x, y, w: w + dw, h });
          // 也可以同时向下扩展一点
          expansions.push({ x, y, w: w + dw, h: h + 20 }); // 增加到20px
          expansions.push({ x, y, w: w + dw, h: h + 30 }); // 增加到30px
        }
      }

      // 也尝试向下扩展
      for (let dh of [20, 30, 40, 50, 60]) { // 增加更多选项
        if (dh <= availableSpace.bottom) {
          expansions.push({ x, y, w, h: h + dh });
        }
      }

      // 尝试双向扩展
      const dw = Math.min(150, maxRightExpand); // 增加到150
      const dh = Math.min(30, availableSpace.bottom); // 增加到30
      if (dw > 0 && dh > 0) {
        expansions.push({ x, y, w: w + dw, h: h + dh });
      }
    } else {
      // 常规段落（多行）：严格保持在 bbox 内，不扩展
      // 只使用原始 bbox
      expansions.push({ x, y, w, h });
    }

    // 始终包含原始 bbox 作为后备选项
    if (expansions.length === 0) {
      expansions.push({ x, y, w, h });
    }

    // 找到最大的不冲突扩展
    let bestExpansion = { x, y, w, h };
    let maxArea = w * h;

    for (let expanded of expansions) {
      // 检查是否与其他 bbox 冲突（增加边距检查，防止贴得太近）
      let hasCollision = false;
      const margin = allowLargeExpansion ? 5 : 2; // 小标题需要更大边距

      for (let i = 0; i < allBboxes.length; i++) {
        if (i === currentIndex) continue;

        const other = allBboxes[i];
        // 添加边距检查
        const expandedWithMargin = {
          x: expanded.x - margin,
          y: expanded.y - margin,
          w: expanded.w + margin * 2,
          h: expanded.h + margin * 2
        };

        if (this.checkBboxCollision(expandedWithMargin, other)) {
          hasCollision = true;
          break;
        }
      }

      const area = expanded.w * expanded.h;
      if (!hasCollision && area > maxArea) {
        bestExpansion = expanded;
        maxArea = area;
      }
    }

    return bestExpansion;
  }

  /**
   * 检查两个矩形是否碰撞
   */
  checkBboxCollision(box1, box2) {
    return !(
      box1.x + box1.w < box2.x ||  // box1 在 box2 左边
      box1.x > box2.x + box2.w ||  // box1 在 box2 右边
      box1.y + box1.h < box2.y ||  // box1 在 box2 上边
      box1.y > box2.y + box2.h     // box1 在 box2 下边
    );
  }

  /**
   * 自适应绘制文字（检测并避免与已绘制文本块重叠）
   * @returns {Object|null} 返回实际绘制的区域 { x, y, w, h }
   */
  drawTextInBoxAdaptive(ctx, text, x, y, width, height, pageNum, drawnTextBoxes, isShortText) {
    if (!text) return null;

    // 检查是否包含公式
    const hasBlockFormula = /\$\$[\s\S]+?\$\$/.test(text);
    const hasInlineFormula = /\$[^$]*[\\^_{}a-zA-Z][\s\S]*?\$/.test(text);
    const hasFormula = hasBlockFormula || hasInlineFormula;

    // 暂时禁用公式渲染（用于测试）
    if (false && hasFormula) {
      // 根据 bbox 高度和已绘制文本自适应选择字号
      const heightCss = height / this.dpr;
      let bestFormulaFontSize;

      // 字号候选列表（从大到小）
      const fontSizeCandidates = isShortText
        ? [18, 16, 14, 12, 10, 8, 6]
        : [13, 11, 10, 9, 8, 7, 6, 5, 4];

      for (let fs of fontSizeCandidates) {
        const lineHeight = 1.5;
        const estimatedHeight = fs * lineHeight * 2.2; // 公式可能占2-3行高度

        if (estimatedHeight <= heightCss) {
          // 检查是否与已绘制文本重叠
          const testBox = { x, y, w: width, h: estimatedHeight * this.dpr };
          let hasCollision = false;

          for (const drawn of drawnTextBoxes) {
            if (this.checkBboxCollision(testBox, drawn)) {
              hasCollision = true;
              break;
            }
          }

          if (!hasCollision) {
            bestFormulaFontSize = fs;
            break;
          }
        }
      }

      // 如果都不行，使用最小字号
      if (!bestFormulaFontSize) {
        bestFormulaFontSize = isShortText ? 6 : 4;
      }

      this.drawTextWithFormulaInBoxAdaptive(text, x, y, width, height, pageNum, null, isShortText, bestFormulaFontSize);

      // 返回保守的高度估计（公式可能占用更多空间）
      const actualHeight = Math.min(height, bestFormulaFontSize * 1.5 * 2.2 * this.dpr);
      return { x, y, w: width, h: actualHeight };
    }

    // 纯文本：尝试不同字号，找到最大的不重叠字号
    const maxFontSize = isShortText ? Math.max(width / 10, height / 3, 18) : Math.min(width / 10, height / 3);
    const minFontSize = 3; // 允许缩到 3px（除了单行小标题）

    let bestFontSize = minFontSize;
    let bestLines = [];
    let bestActualHeight = 0;

    // 从大到小尝试字号
    for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 0.5) {
      ctx.font = `${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
      const lines = this.wrapText(ctx, text, width - 4);
      const lineHeight = fontSize * 1.5; // 行间距 1.5

      // 正确计算总高度：前 n-1 行用 lineHeight，最后一行用 fontSize + 下方空间
      const actualHeight = lines.length > 1
        ? (lines.length - 1) * lineHeight + fontSize * 1.3 + 8 // 最后一行留足空间 + 上下边距
        : fontSize * 1.3 + 8; // 单行也留足空间

      // 检查1：是否在 bbox 内
      if (actualHeight > height) {
        continue; // 超出 bbox，尝试更小字号
      }

      // 检查2：是否与已绘制的文本块重叠
      const textBox = { x, y, w: width, h: actualHeight };
      let hasCollision = false;

      for (const drawn of drawnTextBoxes) {
        if (this.checkBboxCollision(textBox, drawn)) {
          hasCollision = true;
          break;
        }
      }

      if (!hasCollision) {
        // 找到了不重叠的字号
        bestFontSize = fontSize;
        bestLines = lines;
        bestActualHeight = actualHeight;
        break;
      }
    }

    // 如果所有字号都重叠，继续降低字号直到 3px（强制绘制）
    if (bestLines.length === 0) {
      bestFontSize = 3;
      ctx.font = `${bestFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
      bestLines = this.wrapText(ctx, text, width - 4);
      const lineHeight = bestFontSize * 1.5;

      // 正确计算总高度
      const totalHeight = bestLines.length > 1
        ? (bestLines.length - 1) * lineHeight + bestFontSize * 1.3 + 8
        : bestFontSize * 1.3 + 8;

      // 如果还是放不下，裁剪行数
      if (totalHeight > height) {
        const availableHeight = height - 8;
        const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
        bestLines = bestLines.slice(0, maxLines);
        bestActualHeight = bestLines.length * lineHeight + 8;
      } else {
        bestActualHeight = totalHeight;
      }
    }

    // 单行小标题最小字号限制（仅限单行）
    if (isShortText && bestLines.length === 1 && bestFontSize < 14) {
      bestFontSize = 14;
      ctx.font = `${bestFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
      bestLines = this.wrapText(ctx, text, width - 4);
      bestActualHeight = bestFontSize * 1.3 + 8;
    }

    // 绘制文字
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.font = `${bestFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
    const lineHeight = bestFontSize * 1.5; // 行间距 1.5

    bestLines.forEach((line, i) => {
      const lineY = y + 4 + i * lineHeight; // 上边距 4px
      ctx.fillText(line, x + 2, lineY);
    });

    // 返回实际绘制的区域
    return { x, y, w: width, h: bestActualHeight };
  }

  /**
   * 在指定区域内绘制自适应大小的文字
   */
  drawTextInBox(ctx, text, x, y, width, height, pageNum = null, wrapperEl = null, cachedInfo = null) {
    if (!text) return;

    // 检查是否为短文本/小标题（与 bbox 扩展判断保持一致）
    const isShortText = text.length < 30;

    // 检查是否包含公式（更严格的检测）
    // 1. $$ 包围的块公式
    // 2. $ 包围且包含数学符号的行内公式（不是简单的 $数字$）
    const hasBlockFormula = /\$\$[\s\S]+?\$\$/.test(text);
    const hasInlineFormula = /\$[^$]*[\\^_{}a-zA-Z][\s\S]*?\$/.test(text); // 必须包含 \、^、_、{、}、字母等数学符号
    const hasFormula = hasBlockFormula || hasInlineFormula;

    if (hasFormula && wrapperEl) {
      // 包含公式，使用 HTML 渲染（通过模块或回退方案）
      this.drawTextWithFormulaInBox(text, x, y, width, height, pageNum, wrapperEl, isShortText, cachedInfo);
    } else {
      // 纯文本，使用 Canvas 渲染
      this.drawPlainTextInBox(ctx, text, x, y, width, height, isShortText, cachedInfo);
    }
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
    // 多行文本使用更保守的最大字号
    let maxFontSize = Math.min(width / 10, height / 3); // 调小，从 width/8, height/2.5 改为 width/10, height/3

    // 小标题优先使用更大的字号
    if (isShortText) {
      maxFontSize = Math.max(maxFontSize, 18); // 小标题至少尝试 18px（提高可读性）
    }

    // 先尝试找到能完整放下所有文本的最大字号（从大到小）
    let foundPerfectFit = false;
    for (let fontSize = maxFontSize; fontSize >= 3; fontSize -= 0.5) { // 降到 3px
      ctx.font = `${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
      const lines = this.wrapText(ctx, text, width - 4);
      const lineHeight = fontSize * 1.5; // 行间距 1.5

      // 正确计算总高度：前 n-1 行用 lineHeight，最后一行用 fontSize + 下方空间
      const totalHeight = lines.length > 1
        ? (lines.length - 1) * lineHeight + fontSize * 1.3 + 8 // 最后一行留足空间 + 边距
        : fontSize * 1.3 + 8; // 单行也留足空间

      // 确保所有行都能完整显示（含行高）+ 额外留出缓冲空间
      if (totalHeight <= height) { // 直接比较，不再减去缓冲（已包含在计算中）
        bestFontSize = fontSize;
        bestLines = lines;
        foundPerfectFit = true;
        break;
      }
    }

    // 如果仍然找不到（极端情况），使用3px并裁剪行数
    if (!foundPerfectFit) {
      bestFontSize = 3;
      ctx.font = `${bestFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
      const allLines = this.wrapText(ctx, text, width - 4);
      const lineHeight = bestFontSize * 1.5;

      // 正确计算总高度
      const totalHeight = allLines.length > 1
        ? (allLines.length - 1) * lineHeight + bestFontSize * 1.3 + 8
        : bestFontSize * 1.3 + 8;

      // 如果还是放不下，裁剪行数
      if (totalHeight > height) {
        const availableHeight = height - 8;
        const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
        bestLines = allLines.slice(0, maxLines);
      } else {
        bestLines = allLines;
      }
    }

    // 应用小标题的最小字号限制（仅限单行情况）
    if (isShortText && bestLines.length === 1 && bestFontSize < 14) {
      // 单行小标题：强制使用至少 14px
      bestFontSize = 14;
      ctx.font = `${bestFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
      bestLines = this.wrapText(ctx, text, width - 4);
    }

    // 绘制文字（确保不超出 bbox 高度）
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.font = `${bestFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;

    const lineHeight = bestFontSize * 1.5; // 行间距 1.5

    bestLines.forEach((line, i) => {
      const lineY = y + 4 + i * lineHeight; // 上边距 4px

      // 所有已经过裁剪的行都应该绘制
      // 因为 bestLines 已经在上面被裁剪到只包含能完整显示的行
      ctx.fillText(line, x + 2, lineY);
    });
  }

  /**
   * 使用文本自适应算法绘制文本（新算法）
   * 策略：
   * 1. 尽可能保证和原来的 bbox 块高度一致
   * 2. 尽可能放下所有的内容
   * 3. 在宽度和高度之间进行平衡，从而尽可能放大字体，但在 bbox 的框架内
   * @param {number} suggestedFontSize - 可选的建议字号（来自预处理）
   */
  drawPlainTextWithFitting(ctx, text, x, y, width, height, isShortText = false, suggestedFontSize = null) {
    try {
      // 判断是否为 CJK 语言
      const isCJK = /[\u4e00-\u9fa5]/.test(text);
      const lineSkip = isCJK ? 1.5 : 1.3; // 使用统一的行距

      // 内边距：对小bbox减少padding避免裁剪
      const paddingTop = height < 20 ? 0.5 : 2;  // 小bbox（<20px）：0.5px padding
      const paddingX = 2;
      const availableHeight = height - paddingTop * 2; // 上下都留边距
      const availableWidth = width - paddingX * 2;

      // 字号范围：基于 bbox 高度估算
      // 假设单行文本，字号约为 bbox 高度的 80%
      const estimatedSingleLineFontSize = height * 0.8;

      // 最小字号：动态调整（基于bbox高度）
      // 对于小bbox（高度<20px），允许使用更小的字号以避免裁剪
      // 对于正常bbox，使用10px/8px以平衡可读性和容纳率
      let minFontSize;
      if (height < 20) {
        minFontSize = Math.max(6, height * 0.35);  // 小bbox：最小6px, 35%系数
      } else {
        minFontSize = isShortText ? 10 : 8;  // 正常bbox：10px/8px（降低阈值）
      }

      // 最大字号：不超过单行估算值的 1.5 倍
      const maxFontSize = Math.min(estimatedSingleLineFontSize * 1.5, height * 1.2);

      // 检查文本是否包含换行符
      const hasNewlines = text.includes('\n');
      const textLength = text.length;

      // console.log(`[TextFitting] 开始: "${text.substring(0, 30)}..." bbox=${width.toFixed(0)}x${height.toFixed(0)}, 字号范围=${minFontSize.toFixed(1)}-${maxFontSize.toFixed(1)}px, 文本长度=${textLength}, 有换行=${hasNewlines}`);

      // 尝试不同的宽度因子（从 1.0 开始，优先使用全宽）
      // 如果文本很短或有原始换行符，只使用全宽
      const widthFactors = (textLength < 20 || hasNewlines)
        ? [1.0]
        : [1.0, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70];

      let bestSolution = null; // { fontSize, widthFactor, lines }

      // 对每个宽度因子，使用二分查找找到最大可用字号
      for (const widthFactor of widthFactors) {
        const effectiveWidth = availableWidth * widthFactor;

        // 二分查找最大字号
        let low = minFontSize;
        let high = maxFontSize;
        let foundFontSize = null;
        let foundLines = null;

        while (high - low > 0.5) { // 精度 0.5px
          const mid = (low + high) / 2;

          // 测试这个字号是否能装下
          ctx.font = `${mid}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
          const lines = this.wrapText(ctx, text, effectiveWidth);
          const lineHeight = mid * lineSkip;

          // 计算总高度：最后一行不需要完整行高
          const totalHeight = lines.length > 0
            ? (lines.length - 1) * lineHeight + mid
            : 0;

          if (totalHeight <= availableHeight) {
            // 能装下，尝试更大的字号
            foundFontSize = mid;
            foundLines = lines;
            low = mid;
          } else {
            // 装不下，尝试更小的字号
            high = mid;
          }
        }

        // 如果找到了可行解，且比当前最优解更好（字号更大）
        if (foundFontSize && (!bestSolution || foundFontSize > bestSolution.fontSize)) {
          bestSolution = {
            fontSize: foundFontSize,
            widthFactor: widthFactor,
            lines: foundLines
          };
        }
      }

      // 如果找到了最优解，绘制
      if (bestSolution) {
        const { fontSize, widthFactor, lines } = bestSolution;
        const lineHeight = fontSize * lineSkip;

        ctx.font = `${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'top';

        // 计算水平偏移（如果使用了缩小的宽度，左对齐）
        const xOffset = 0; // 始终左对齐

        // 计算总高度并垂直居中
        const totalHeight = lines.length > 0
          ? (lines.length - 1) * lineHeight + fontSize
          : 0;
        const yOffset = (availableHeight - totalHeight) / 2;

        lines.forEach((line, i) => {
          const lineY = y + paddingTop + yOffset + i * lineHeight;
          ctx.fillText(line, x + paddingX + xOffset, lineY);
        });

        // 显示前3行内容用于调试（已注释以减少日志）
        // const previewLines = lines.slice(0, 3).map(l => `"${l}"`).join(', ');
        // console.log(`[TextFitting] ✓ 成功: "${text.substring(0, 30)}..." 字号=${fontSize.toFixed(1)}px, 行数=${lines.length}, 宽度=${(widthFactor*100).toFixed(0)}%, bbox高=${height.toFixed(1)}px, 实际高=${totalHeight.toFixed(1)}px`);
        // console.log(`[TextFitting]   前3行: ${previewLines}`);
        return;
      }

      // 如果所有方案都失败，使用最小字号强制绘制（裁剪行数）
      console.warn(`[TextFitting] ⚠ 无法找到合适字号，使用最小字号: "${text.substring(0, 30)}..."`);

      const fallbackFontSize = minFontSize;
      const fallbackLineHeight = fallbackFontSize * lineSkip;
      ctx.font = `${fallbackFontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';

      const allLines = this.wrapText(ctx, text, availableWidth);
      const maxLines = Math.floor(availableHeight / fallbackLineHeight);
      const linesToDraw = allLines.slice(0, Math.max(1, maxLines));

      linesToDraw.forEach((line, i) => {
        const lineY = y + paddingTop + i * fallbackLineHeight;
        ctx.fillText(line, x + paddingX, lineY);
      });

      console.warn(`[TextFitting] ✗ 裁剪: 字号=${fallbackFontSize.toFixed(1)}px, 绘制=${linesToDraw.length}/${allLines.length}行`);

    } catch (error) {
      console.error('[PDFCompareView] 文本自适应渲染失败:', error);
      // 最小回退渲染
      ctx.font = '8px Arial, sans-serif';
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';
      const lines = this.wrapText(ctx, text, width - 4);
      lines.forEach((line, i) => {
        const lineY = y + 4 + i * 12;
        if (lineY + 12 <= y + height) {
          ctx.fillText(line, x + 2, lineY);
        }
      });
    }
  }

  /**
   * 绘制包含公式的文本（HTML + KaTeX）- 自适应字号版本
   * @param {number} fontSize - 动态计算的字号
   */
  drawTextWithFormulaInBoxAdaptive(text, x, y, width, height, pageNum = null, wrapperEl = null, isShortText = false, fontSize = 12) {
    // 创建临时 DOM 元素来渲染公式
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    // 转换为 CSS 像素（逻辑像素）
    tempDiv.style.left = `${x / this.dpr}px`;
    tempDiv.style.top = `${y / this.dpr}px`;
    tempDiv.style.width = `${width / this.dpr}px`;
    // 设置高度限制
    const targetHeightPx = height / this.dpr;
    tempDiv.style.height = `${targetHeightPx}px`;
    tempDiv.style.maxHeight = `${targetHeightPx}px`;
    tempDiv.style.overflow = 'hidden'; // 隐藏超出部分
    tempDiv.style.wordWrap = 'break-word';
    tempDiv.style.overflowWrap = 'break-word';

    // 使用传入的自适应字号
    tempDiv.style.fontSize = `${fontSize}px`;
    tempDiv.style.lineHeight = '1.5'; // 行间距 1.5（与 Canvas 一致）
    tempDiv.style.padding = '4px 2px'; // 上下4px，左右2px
    tempDiv.style.paddingBottom = '4px'; // 确保底部也有足够空间
    tempDiv.style.boxSizing = 'border-box';
    tempDiv.style.pointerEvents = 'none';
    tempDiv.style.color = '#000';
    tempDiv.style.zIndex = '10';
    tempDiv.style.fontFamily = 'sans-serif';
    tempDiv.style.webkitFontSmoothing = 'antialiased';
    tempDiv.setAttribute('data-pdf-compare', '1');
    if (pageNum != null) tempDiv.setAttribute('data-page', String(pageNum));

    // 渲染公式
    const processedText = this.renderFormulasInText(text);
    tempDiv.innerHTML = processedText;

    // 添加到传入的段 wrapper（相对定位的容器）
    const targetWrapper = wrapperEl || this.translationSegmentsContainer || document.getElementById('pdf-translation-segments') || this.translationCanvas?.parentElement;
    if (targetWrapper) {
      targetWrapper.appendChild(tempDiv);

      // ✅ 修复公式超高问题：迭代缩小字号直到内容适配
      const minFontSize = 6; // 最小字号
      const fontSizeStep = 0.5; // 每次缩小 0.5px
      let currentFontSize = fontSize;
      let iterations = 0;
      const maxIterations = 20; // 最多尝试 20 次

      // 等待 KaTeX 渲染完成后检查高度
      setTimeout(() => {
        // 检查实际内容高度是否超出容器
        while (tempDiv.scrollHeight > targetHeightPx && currentFontSize > minFontSize && iterations < maxIterations) {
          currentFontSize -= fontSizeStep;
          tempDiv.style.fontSize = `${currentFontSize}px`;
          iterations++;
        }

        // 如果经过迭代后仍然超高，记录警告
        if (tempDiv.scrollHeight > targetHeightPx) {
          const overflowRatio = ((tempDiv.scrollHeight / targetHeightPx - 1) * 100).toFixed(1);
          console.warn(
            `[FormulaFitting] 公式内容超出bbox ${overflowRatio}%:`,
            `scrollHeight=${tempDiv.scrollHeight.toFixed(1)}px,`,
            `targetHeight=${targetHeightPx.toFixed(1)}px,`,
            `最终字号=${currentFontSize.toFixed(1)}px`,
            `(已达最小字号${minFontSize}px)`
          );
        } else if (iterations > 0) {
          // 成功缩小到合适大小，记录调试信息
          console.log(
            `[FormulaFitting] 自动缩小字号: ${fontSize.toFixed(1)}px → ${currentFontSize.toFixed(1)}px`,
            `(迭代${iterations}次)`
          );
        }
      }, 10); // 等待 10ms 让 KaTeX 渲染完成
    }
  }

  /**
   * 绘制包含公式的文本（HTML + KaTeX）- 兼容旧接口
   * @param {boolean} isShortText - 是否为短文本/小标题（会使用更大的字号）
   */
  drawTextWithFormulaInBox(text, x, y, width, height, pageNum = null, wrapperEl = null, isShortText = false) {
    // 根据 bbox 高度自适应字号（避免压住下一行）
    const heightCss = height / this.dpr;
    let fontSize;
    if (isShortText) {
      // 小标题：根据高度自适应，但最小 14px
      fontSize = Math.max(Math.min(heightCss / 2.5, 18), 14); // 14-18px，更保守的计算
    } else {
      // 常规文本：根据高度自适应，最小 6px
      fontSize = Math.max(Math.min(heightCss / 3.5, 13), 6); // 6-13px，更保守的计算
    }

    // 调用自适应版本
    this.drawTextWithFormulaInBoxAdaptive(text, x, y, width, height, pageNum, wrapperEl, isShortText, fontSize);
  }

  /**
   * 清理指定页的公式 DOM
   */
  clearFormulaElementsForPage(pageNum) {
    const wrapper = this.translationSegmentsContainer || document.getElementById('pdf-translation-segments') || this.translationCanvas?.parentElement;
    if (!wrapper) return;
    const list = wrapper.querySelectorAll('[data-pdf-compare="1"][data-page="' + String(pageNum) + '"]');
    list.forEach(el => el.remove());
  }

  /**
   * 清理所有由我们创建的公式 DOM
   */
  clearAllFormulaElements() {
    const wrapper = this.translationSegmentsContainer || document.getElementById('pdf-translation-segments') || this.translationCanvas?.parentElement;
    if (!wrapper) return;
    const list = wrapper.querySelectorAll('[data-pdf-compare="1"]');
    list.forEach(el => el.remove());
  }

  // 仅在指定 wrapper 中清理指定页的公式 DOM
  clearFormulaElementsForPageInWrapper(pageNum, wrapper) {
    if (!wrapper) return;
    const list = wrapper.querySelectorAll('[data-pdf-compare="1"][data-page="' + String(pageNum) + '"]');
    list.forEach(el => el.remove());
  }

  /**
   * 渲染文本中的公式（优化版：优先使用模块）
   */
  renderFormulasInText(text) {
    // 优先使用 TextFittingAdapter 的公式渲染
    if (this.textFittingAdapter && typeof this.textFittingAdapter.renderFormulasInText === 'function') {
      return this.textFittingAdapter.renderFormulasInText(text);
    }

    // 回退方案：使用本地实现
    if (!this._formulaCache) {
      this._formulaCache = new Map();
    }

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

        // 缓存结果（最多缓存 500 条）
        if (this._formulaCache.size < 500) {
          this._formulaCache.set(text, result);
        }

        return result;
      } catch (e) {
        // 只在首次失败时打印日志
        if (!this._katexWarned) {
          console.warn('[PDFCompareView] KaTeX 渲染失败:', e);
          this._katexWarned = true;
        }
        return text;
      }
    } else {
      // 只警告一次
      if (!this._katexUnavailableWarned) {
        console.warn('[renderFormulasInText] renderMathInElement 不可用');
        this._katexUnavailableWarned = true;
      }
      return text;
    }
  }

  /**
   * 将文字按宽度换行（智能换行，支持中英文）
   */
  wrapText(ctx, text, maxWidth) {
    if (!text) return [];

    const lines = [];
    let currentLine = '';

    // 先按自然断句分段（句号、问号、感叹号、逗号等）
    const segments = text.split(/([。？！，、；：\n])/);

    for (let segment of segments) {
      if (!segment) continue;

      // 如果是标点符号，直接加到当前行
      if (/^[。？！，、；：]$/.test(segment)) {
        currentLine += segment;
        continue;
      }

      // 如果是换行符，强制换行
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
          // 当前行已满，换行
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
   * 根据类型获取颜色
   */
  getTypeColor(type, alpha = 0.3) {
    switch (type) {
      case 'table':
        return `rgba(204, 204, 0, ${alpha})`;
      case 'image':
        return `rgba(153, 255, 51, ${alpha})`;
      case 'title':
        return `rgba(102, 102, 255, ${alpha})`;
      case 'text':
        return `rgba(153, 0, 76, ${alpha})`;
      default:
        return `rgba(255, 235, 59, ${alpha})`;
    }
  }

  /**
   * 渲染所有 bbox（激活可见性）
   */
  renderAllBboxes(pageNum) {
    const currentPageIndex = pageNum - 1;
    const ctx = this.originalOverlayContext;

    // 清空
    ctx.clearRect(0, 0, this.originalOverlay.width, this.originalOverlay.height);

    // 获取当前页的所有内容块（只显示文本类型）
    const pageItems = this.contentListJson.filter(item =>
      item.page_idx === currentPageIndex && item.type === 'text'
    );

    const BBOX_NORMALIZED_RANGE = 1000;
    const scaleX = this.originalOverlay.width / BBOX_NORMALIZED_RANGE;
    const scaleY = this.originalOverlay.height / BBOX_NORMALIZED_RANGE;

    // 绘制所有文本 bbox（紫红色边框，更明显）
    pageItems.forEach((item, idx) => {
      if (!item.bbox) return;

      const bbox = item.bbox;
      const x = bbox[0] * scaleX;
      const y = bbox[1] * scaleY;
      const w = (bbox[2] - bbox[0]) * scaleX;
      const h = (bbox[3] - bbox[1]) * scaleY;

      // 使用紫红色（text 类型的颜色），加深透明度
      ctx.strokeStyle = 'rgb(153, 0, 76)';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7; // 从 0.3 改为 0.7，更明显
      ctx.strokeRect(x, y, w, h);
      ctx.globalAlpha = 1.0;
    });
  }

  /**
   * 绑定左边 bbox 的点击事件
   */
  bindBboxClick() {
    // 事件绑定在每个段的 overlay 上（见 createSegmentDom）
  }

  /**
   * 连续模式：处理每页 overlay 的点击
   */
  /**
   * 连续模式：高亮左右对应 bbox（在长画布上，仅该页区域）
   */
  highlightBboxPairContinuous(item, pageInfo) {
    // 已改为分段高亮，保留签名以兼容但不再使用
  }

  // 段 overlay 点击命中测试并高亮左右
  async onSegmentOverlayClick(e, seg) {
    const overlay = e.currentTarget;
    const rect = overlay.getBoundingClientRect();
    const sx = overlay.width / overlay.clientWidth;
    const sy = overlay.height / overlay.clientHeight;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;

    // 找页
    const page = seg.pages.find(p => y >= p.yInSegPx && y <= p.yInSegPx + p.height);
    if (!page) return;
    const pageNum = page.pageNum;
    const items = this.contentListJson.filter(it => it.page_idx === pageNum - 1 && it.type === 'text');
    const BBOX_NORMALIZED_RANGE = 1000;
    const scaleX = page.width / BBOX_NORMALIZED_RANGE;
    const scaleY = page.height / BBOX_NORMALIZED_RANGE;

    for (const it of items) {
      if (!it.bbox) continue;
      const b = it.bbox;
      const bx = b[0] * scaleX;
      const by = b[1] * scaleY + page.yInSegPx;
      const bw = (b[2] - b[0]) * scaleX;
      const bh = (b[3] - b[1]) * scaleY;
      if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
        // 重绘本段 overlays
        await this.renderSegmentOverlays(seg);
        // 高亮左右
        const drawHL = (ctx) => {
          ctx.strokeStyle = 'rgb(255, 0, 0)';
          ctx.lineWidth = 3;
          ctx.globalAlpha = 0.8;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.globalAlpha = 1.0;
        };
        drawHL(seg.left.overlayCtx);
        drawHL(seg.right.overlayCtx);
        break;
      }
    }
  }

  /**
   * 高亮左右对应的 bbox
   */
  highlightBboxPair(index, pageItems) {
    const BBOX_NORMALIZED_RANGE = 1000;
    const scaleX = this.originalOverlay.width / BBOX_NORMALIZED_RANGE;
    const scaleY = this.originalOverlay.height / BBOX_NORMALIZED_RANGE;
    const scaleXTrans = this.translationOverlay.width / BBOX_NORMALIZED_RANGE;
    const scaleYTrans = this.translationOverlay.height / BBOX_NORMALIZED_RANGE;

    const item = pageItems[index];
    if (!item || !item.bbox) return;

    // 高亮左边原始 bbox
    const ctx = this.originalOverlayContext;
    const bbox = item.bbox;
    const x = bbox[0] * scaleX;
    const y = bbox[1] * scaleY;
    const w = (bbox[2] - bbox[0]) * scaleX;
    const h = (bbox[3] - bbox[1]) * scaleY;

    // 重绘所有 bbox（清除之前的高亮）
    this.renderAllBboxes(this.currentPage);

    // 高亮当前点击的 bbox（左边）
    ctx.strokeStyle = 'rgb(255, 0, 0)'; // 红色高亮
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;
    ctx.strokeRect(x, y, w, h);
    ctx.globalAlpha = 1.0;

    // 重新渲染右边的翻译层（这样翻译文本不会消失）
    this.renderTranslationOverlay(this.currentPage);

    // 在翻译层上叠加高亮边框
    const ctxTrans = this.translationOverlayContext;
    const xTrans = bbox[0] * scaleXTrans;
    const yTrans = bbox[1] * scaleYTrans;
    const wTrans = (bbox[2] - bbox[0]) * scaleXTrans;
    const hTrans = (bbox[3] - bbox[1]) * scaleYTrans;

    ctxTrans.strokeStyle = 'rgb(255, 0, 0)'; // 红色高亮
    ctxTrans.lineWidth = 3;
    ctxTrans.globalAlpha = 0.8;
    ctxTrans.strokeRect(xTrans, yTrans, wTrans, hTrans);
    ctxTrans.globalAlpha = 1.0;
  }

  /**
   * 获取类型的边框颜色
   */
  getTypeStrokeColor(type) {
    switch (type) {
      case 'table':
        return 'rgb(204, 204, 0)';
      case 'image':
        return 'rgb(153, 255, 51)';
      case 'title':
        return 'rgb(102, 102, 255)';
      case 'text':
        return 'rgb(153, 0, 76)';
      default:
        return 'rgb(251, 192, 45)';
    }
  }

  /**
   * 绑定滚动联动
   */
  bindScrollSync() {
    const originalScroll = document.getElementById('pdf-original-scroll');
    const translationScroll = document.getElementById('pdf-translation-scroll');

    if (!originalScroll || !translationScroll) return;

    let isSyncing = false;
    let scrollSyncRaf = null;
    let renderDebounceTimer = null;

    // 使用 requestAnimationFrame + 防抖优化滚动性能
    const syncScroll = (source, target) => {
      if (isSyncing) return;

      if (scrollSyncRaf) {
        cancelAnimationFrame(scrollSyncRaf);
      }

      scrollSyncRaf = requestAnimationFrame(() => {
        isSyncing = true;
        target.scrollTop = source.scrollTop;
        target.scrollLeft = source.scrollLeft;

        // 立即取消同步标志
        requestAnimationFrame(() => {
          isSyncing = false;
        });
      });

      // 延迟渲染可见段（防抖优化，150ms内只触发一次）
      if (this.mode === 'continuous') {
        if (renderDebounceTimer) {
          clearTimeout(renderDebounceTimer);
        }
        renderDebounceTimer = setTimeout(() => {
          this.renderVisibleSegments(source);
        }, 150);
      }
    };

    // 滚动联动（使用 passive 优化）
    originalScroll.addEventListener('scroll', () => syncScroll(originalScroll, translationScroll), { passive: true });
    translationScroll.addEventListener('scroll', () => syncScroll(translationScroll, originalScroll), { passive: true });
  }

  /**
   * 检测是否需要自动加载下一页
   */
  checkAutoLoadNextPage(scrollElement) {
    // 单页模式下才启用自动翻页加载
    if (this.mode === 'continuous') return;
    const scrollTop = scrollElement.scrollTop;
    const scrollHeight = scrollElement.scrollHeight;
    const clientHeight = scrollElement.clientHeight;

    // 滚动到距离底部 100px 以内时，自动加载下一页
    if (scrollHeight - scrollTop - clientHeight < 100) {
      if (this.currentPage < this.totalPages && !this.isLoadingPage) {
        this.isLoadingPage = true;
        setTimeout(() => {
          this.renderPage(this.currentPage + 1).then(() => {
            this.isLoadingPage = false;
          });
        }, 100);
      }
    }
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 退出全屏对照模式
    document.getElementById('pdf-exit-fullscreen')?.addEventListener('click', () => {
      // 恢复浮动图标
      this.showFloatingIcons();

      // 切换回其他标签（优先切换到 OCR 标签，避免没有翻译内容时报错）
      if (typeof window.showTab === 'function') {
        // 如果有翻译内容，切换到翻译标签；否则切换到 OCR 标签
        const hasTranslation = window.data && window.data.translation && window.data.translation.trim() !== '';
        window.showTab(hasTranslation ? 'translation' : 'ocr');
      }
    });

    // 上一页（连续模式下滚动定位；单页模式下重新渲染）
    document.getElementById('pdf-prev-page')?.addEventListener('click', () => {
      if (this.mode === 'continuous') {
        const current = this.getCurrentVisiblePageNum();
        const target = Math.max(1, current - 1);
        this.scrollToPage(target);
      } else if (this.currentPage > 1) {
        this.renderPage(this.currentPage - 1);
      }
    });

    // 下一页
    document.getElementById('pdf-next-page')?.addEventListener('click', () => {
      if (this.mode === 'continuous') {
        const current = this.getCurrentVisiblePageNum();
        const target = Math.min(this.totalPages, current + 1);
        this.scrollToPage(target);
      } else if (this.currentPage < this.totalPages) {
        this.renderPage(this.currentPage + 1);
      }
    });

    // 放大/缩小：连续模式下重建长画布；单页模式维持原逻辑
    document.getElementById('pdf-zoom-in')?.addEventListener('click', async () => {
      this.scale = Math.min(this.scale + 0.25, 3.0);
      document.getElementById('pdf-zoom-level').textContent = `${Math.round(this.scale * 100)}%`;
      if (this.mode === 'continuous') {
        await this.rebuildContinuousViewAndKeepScroll();
      } else {
        this.renderPage(this.currentPage);
      }
    });

    document.getElementById('pdf-zoom-out')?.addEventListener('click', async () => {
      this.scale = Math.max(this.scale - 0.25, 0.5);
      document.getElementById('pdf-zoom-level').textContent = `${Math.round(this.scale * 100)}%`;
      if (this.mode === 'continuous') {
        await this.rebuildContinuousViewAndKeepScroll();
      } else {
        this.renderPage(this.currentPage);
      }
    });

    // 导出保留原格式的译文PDF
    document.getElementById('pdf-export-structured-translation')?.addEventListener('click', async () => {
      await this.exportStructuredTranslation();
    });
  }

  /**
   * 重新构建连续模式视图，并尽量保持滚动位置
   */
  async rebuildContinuousViewAndKeepScroll() {
    const left = document.getElementById('pdf-original-scroll');
    const right = document.getElementById('pdf-translation-scroll');
    if (!left || !right) return;

    // 记录滚动比例，尽量保持位置
    const frac = left.scrollHeight > left.clientHeight ? left.scrollTop / (left.scrollHeight - left.clientHeight) : 0;

    // 不需要等待旧长画布队列；分段渲染按段顺序进行

    // 清空 overlay 公式 DOM
    this.clearAllFormulaElements();

    // 重建长画布
    await this.renderAllPagesContinuous();

    // 恢复滚动
    const newTop = frac * (left.scrollHeight - left.clientHeight);
    left.scrollTop = newTop;
    right.scrollTop = newTop;

    // 渲染当前可见页
    await this.renderVisibleSegments(left);
  }

  /**
   * 获取当前可见区所处的页号（连续模式）
   */
  getCurrentVisiblePageNum() {
    const scroller = document.getElementById('pdf-original-scroll');
    if (!scroller || !this.pageInfos.length) return this.currentPage || 1;
    const dpr = this.dpr;
    const scrollTop = scroller.scrollTop * dpr;
    for (const pi of this.pageInfos) {
      if (pi.yOffset + pi.height > scrollTop) {
        return pi.pageNum;
      }
    }
    return this.pageInfos[this.pageInfos.length - 1].pageNum;
  }

  /**
   * 连续模式：滚动到指定页
   */
  scrollToPage(pageNum) {
    if (!this.pageInfos || !this.pageInfos.length) return;
    const pageInfo = this.pageInfos.find(p => p.pageNum === pageNum);
    if (!pageInfo) return;
    const cssTop = pageInfo.yOffset / this.dpr;
    const originalScroll = document.getElementById('pdf-original-scroll');
    const translationScroll = document.getElementById('pdf-translation-scroll');
    if (originalScroll) originalScroll.scrollTop = cssTop;
    if (translationScroll) translationScroll.scrollTop = cssTop;
    // 进入视口后触发渲染
    this.renderVisibleSegments(originalScroll);
  }

  /**
   * 隐藏浮动图标（除了 chatbot）
   */
  hideFloatingIcons() {
    // 延迟执行，确保 DOM 已完全加载
    setTimeout(() => {
      const iconsToHide = [
        'toggle-immersive-btn',  // 沉浸式模式按钮
        'toc-float-btn'           // 目录浮动按钮
      ];

      console.log('[PDFCompareView] 🔍 开始隐藏浮动图标');
      iconsToHide.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
          console.log(`[PDFCompareView] ✅ 找到图标 ${id}，当前 display:`, element.style.display);
          element.style.setProperty('display', 'none', 'important');
          element.style.setProperty('visibility', 'hidden', 'important');
          element.style.setProperty('opacity', '0', 'important');
          element.style.setProperty('pointer-events', 'none', 'important');
          console.log(`[PDFCompareView] ✔️ 已隐藏 ${id}，新 display:`, element.style.display);
        } else {
          console.warn(`[PDFCompareView] ❌ 未找到图标 ${id}`);
        }
      });
    }, 200);
  }

  /**
   * 恢复浮动图标
   */
  showFloatingIcons() {
    const iconsToShow = [
      'toggle-immersive-btn',
      'toc-float-btn'
    ];

    iconsToShow.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.style.removeProperty('display');
        element.style.removeProperty('visibility');
        element.style.removeProperty('opacity');
        element.style.removeProperty('pointer-events');
      }
    });
  }

  /**
   * HTML 转义
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 导出保留原格式的译文PDF
   * 使用 pdf-lib 在原始PDF上覆盖翻译后的文本
   */
  async exportStructuredTranslation() {
    // 优先使用新模块
    if (this.pdfExporter) {
      await this.pdfExporter.exportStructuredTranslation(
        this.originalPdfBase64,
        this.translatedContentList,
        typeof showNotification === 'function' ? showNotification : null
      );
      return;
    }

    // 回退：使用原有实现
    try {
      // 检查是否有翻译数据
      if (!this.translatedContentList || this.translatedContentList.length === 0) {
        if (typeof showNotification === 'function') {
          showNotification('没有翻译内容可导出', 'warning');
        }
        return;
      }

      // 检查是否有原始PDF数据
      if (!this.originalPdfBase64) {
        if (typeof showNotification === 'function') {
          showNotification('原始PDF数据不可用', 'error');
        }
        return;
      }

      // 显示进度提示
      if (typeof showNotification === 'function') {
        showNotification('正在生成译文PDF，请稍候...', 'info');
      }

      // 动态加载 pdf-lib（如果尚未加载）
      if (typeof PDFLib === 'undefined') {
        console.log('[PDFCompareView] 正在加载 pdf-lib...');
        await this.loadPdfLib();
      }

      const { PDFDocument, rgb, StandardFonts } = PDFLib;

      // 加载原始PDF
      const pdfBytes = this.base64ToUint8Array(this.originalPdfBase64);
      const pdfDoc = await PDFDocument.load(pdfBytes);

      // 注册 fontkit（用于嵌入自定义字体）
      if (typeof fontkit !== 'undefined') {
        pdfDoc.registerFontkit(fontkit);
        console.log('[PDFCompareView] fontkit 已注册');
      } else {
        console.warn('[PDFCompareView] fontkit 未加载，无法嵌入自定义字体');
      }

      // 尝试嵌入中文字体（从CDN加载思源黑体）
      let font = null;
      try {
        if (typeof fontkit === 'undefined') {
          throw new Error('fontkit 未加载，无法嵌入中文字体');
        }

        console.log('[PDFCompareView] 正在加载中文字体...');
        const fontBytes = await fetch('https://gcore.jsdelivr.net/npm/source-han-sans-cn@1.0.0/SourceHanSansCN-Normal.otf').then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          return res.arrayBuffer();
        });

        font = await pdfDoc.embedFont(fontBytes);
        console.log('[PDFCompareView] 中文字体加载成功');
      } catch (fontError) {
        console.error('[PDFCompareView] 中文字体加载失败:', fontError);
        if (typeof showNotification === 'function') {
          showNotification('中文字体加载失败，无法导出PDF: ' + fontError.message, 'error');
        }
        throw fontError; // 中止导出
      }

      // 按页面分组翻译内容
      const pageContentMap = new Map();
      this.translatedContentList.forEach((item, idx) => {
        if (item.type !== 'text' || !item.text || !item.bbox) return;

        const pageIdx = item.page_idx !== undefined ? item.page_idx : 0;
        if (!pageContentMap.has(pageIdx)) {
          pageContentMap.set(pageIdx, []);
        }
        pageContentMap.get(pageIdx).push({ ...item, originalIndex: idx });
      });

      // 常量：MinerU bbox 归一化范围（固定为1000，与canvas渲染逻辑一致）
      const BBOX_NORMALIZED_RANGE = 1000;

      // 遍历每一页，覆盖翻译文本
      for (const [pageIdx, items] of pageContentMap.entries()) {
        if (pageIdx >= pdfDoc.getPageCount()) continue;

        const page = pdfDoc.getPage(pageIdx);
        const { width: pageWidth, height: pageHeight } = page.getSize();

        // 计算缩放因子（bbox归一化范围固定为1000）
        const scaleX = pageWidth / BBOX_NORMALIZED_RANGE;
        const scaleY = pageHeight / BBOX_NORMALIZED_RANGE;

        console.log(`[PDFCompareView] 页面 ${pageIdx}: PDF尺寸=${pageWidth.toFixed(2)}x${pageHeight.toFixed(2)}pt, 缩放比例=${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);

        // 先用白色矩形覆盖原文（清除原文）
        items.forEach(item => {
          const bbox = item.bbox;
          const x = bbox[0] * scaleX;
          const y = pageHeight - (bbox[3] * scaleY); // PDF坐标系从下往上
          const width = (bbox[2] - bbox[0]) * scaleX;
          const height = (bbox[3] - bbox[1]) * scaleY;

          // 绘制白色矩形覆盖原文
          page.drawRectangle({
            x: x,
            y: y,
            width: width,
            height: height,
            color: rgb(1, 1, 1), // 白色
          });
        });

        // 绘制翻译文本（使用与canvas渲染相同的文本适配算法）
        items.forEach(item => {
          const bbox = item.bbox;
          const text = item.text || '';

          if (!text.trim()) return;

          // 计算bbox在PDF坐标系中的位置和尺寸
          const x = bbox[0] * scaleX;  // 左边界
          const boxWidth = (bbox[2] - bbox[0]) * scaleX;
          const boxHeight = (bbox[3] - bbox[1]) * scaleY;
          // bbox顶部和底部在PDF坐标系中的Y坐标
          const bboxTop = pageHeight - (bbox[1] * scaleY);
          const bboxBottom = pageHeight - (bbox[3] * scaleY);

          // 判断是否为短文本（与canvas渲染一致）
          const isShortText = text.length < 30;

          // 使用与canvas相同的文本布局算法
          const layout = this.calculatePdfTextLayout(font, text, boxWidth, boxHeight, isShortText);
          const { fontSize, lines, lineHeight } = layout;

          // 内边距（与canvas渲染一致）
          const paddingTop = 2;
          const paddingX = 2;
          const availableHeight = boxHeight - paddingTop * 2;

          // 计算总高度并垂直居中（与canvas渲染一致）
          const totalHeight = lines.length > 0
            ? (lines.length - 1) * lineHeight + fontSize
            : 0;
          const yOffset = (availableHeight - totalHeight) / 2;

          // 绘制每一行
          lines.forEach((line, lineIdx) => {
            // 计算baseline Y坐标（从bbox底部开始，加上padding和居中偏移）
            const lineY = bboxBottom + paddingTop + yOffset + (lineIdx * lineHeight);

            // 确保不超出bbox范围
            if (lineY < bboxBottom || lineY > bboxTop) return;

            page.drawText(line, {
              x: x + paddingX,
              y: lineY,
              size: fontSize,
              font: font,
              color: rgb(0, 0, 0), // 黑色文本
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

      // 使用FileSaver下载
      if (typeof saveAs === 'function') {
        saveAs(blob, filename);
        if (typeof showNotification === 'function') {
          showNotification('译文PDF导出成功！', 'success');
        }
      } else {
        // 后备方案：创建下载链接
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof showNotification === 'function') {
          showNotification('译文PDF导出成功！', 'success');
        }
      }

    } catch (error) {
      console.error('[PDFCompareView] 导出PDF失败:', error);
      if (typeof showNotification === 'function') {
        showNotification('导出失败: ' + error.message, 'error');
      }
    }
  }

  /**
   * 为PDF导出计算文本布局（使用与canvas渲染相同的算法）
   * @param {Object} font - pdf-lib字体对象
   * @param {string} text - 要渲染的文本
   * @param {number} boxWidth - bbox宽度（PDF坐标）
   * @param {number} boxHeight - bbox高度（PDF坐标）
   * @param {boolean} isShortText - 是否为短文本
   * @returns {Object} { fontSize, lines, lineHeight }
   */
  calculatePdfTextLayout(font, text, boxWidth, boxHeight, isShortText = false) {
    // 判断是否为 CJK 语言
    const isCJK = /[\u4e00-\u9fa5]/.test(text);
    const lineSkip = isCJK ? 1.25 : 1.15;

    // 内边距（与canvas渲染一致）：对小bbox减少padding
    const paddingTop = boxHeight < 20 ? 0.5 : 2;
    const paddingX = 2;
    const availableHeight = boxHeight - paddingTop * 2;
    const availableWidth = boxWidth - paddingX * 2;

    // 字号范围（与canvas渲染一致）
    const estimatedSingleLineFontSize = boxHeight * 0.8;

    // 最小字号：动态调整（基于bbox高度）
    let minFontSize;
    if (boxHeight < 20) {
      minFontSize = Math.max(6, boxHeight * 0.35);  // 小bbox：最小6px
    } else {
      minFontSize = isShortText ? 10 : 8;  // 正常bbox：10px/8px
    }

    const maxFontSize = Math.min(estimatedSingleLineFontSize * 1.5, boxHeight * 1.2);

    // 检查文本是否包含换行符
    const hasNewlines = text.includes('\n');
    const textLength = text.length;

    // 尝试不同的宽度因子（与canvas渲染一致）
    const widthFactors = (textLength < 20 || hasNewlines)
      ? [1.0]
      : [1.0, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70];

    let bestSolution = null;

    // 对每个宽度因子，使用二分查找找到最大可用字号
    for (const widthFactor of widthFactors) {
      const effectiveWidth = availableWidth * widthFactor;

      // 二分查找最大字号
      let low = minFontSize;
      let high = maxFontSize;
      let foundFontSize = null;
      let foundLines = null;

      while (high - low > 0.5) {
        const mid = (low + high) / 2;

        // 使用pdf-lib的字体测量API换行
        const lines = this.wrapTextForPdf(font, text, effectiveWidth, mid);
        const lineHeight = mid * lineSkip;

        // 计算总高度（与canvas渲染一致）
        const totalHeight = lines.length > 0
          ? (lines.length - 1) * lineHeight + mid
          : 0;

        if (totalHeight <= availableHeight) {
          foundFontSize = mid;
          foundLines = lines;
          low = mid;
        } else {
          high = mid;
        }
      }

      // 如果找到了可行解，且比当前最优解更好
      if (foundFontSize && (!bestSolution || foundFontSize > bestSolution.fontSize)) {
        bestSolution = {
          fontSize: foundFontSize,
          widthFactor: widthFactor,
          lines: foundLines,
          lineHeight: foundFontSize * lineSkip
        };
      }
    }

    // 如果找到了最优解，返回
    if (bestSolution) {
      return bestSolution;
    }

    // 后备方案：使用最小字号（与canvas渲染一致）
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
   * 为PDF文本换行（使用pdf-lib字体测量）
   */
  wrapTextForPdf(font, text, maxWidth, fontSize) {
    if (!text) return [];

    const lines = [];
    let currentLine = '';

    // 先按自然断句分段（与canvas wrapText一致）
    const segments = text.split(/([。？！，、；：\n])/);

    for (let segment of segments) {
      if (!segment) continue;

      // 如果是标点符号，直接加到当前行
      if (/^[。？！，、；：]$/.test(segment)) {
        currentLine += segment;
        continue;
      }

      // 如果是换行符，强制换行
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
    // 先加载 pdf-lib
    if (typeof PDFLib === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://gcore.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
        script.onload = () => {
          console.log('[PDFCompareView] pdf-lib 加载成功');
          resolve();
        };
        script.onerror = (error) => {
          console.error('[PDFCompareView] pdf-lib 加载失败:', error);
          reject(new Error('Failed to load pdf-lib library'));
        };
        document.head.appendChild(script);
      });
    }

    // 再加载 fontkit（用于嵌入自定义字体）
    if (typeof fontkit === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://gcore.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';
        script.onload = () => {
          console.log('[PDFCompareView] fontkit 加载成功');
          resolve();
        };
        script.onerror = (error) => {
          console.warn('[PDFCompareView] fontkit 加载失败:', error);
          // fontkit加载失败不应该阻止整个流程，只是无法使用自定义字体
          resolve();
        };
        document.head.appendChild(script);
      });
    }
  }

  /**
   * 清理资源
   */
  destroy() {
    // 清理模块
    if (this.segmentManager) {
      this.segmentManager.destroy();
      this.segmentManager = null;
    }

    if (this.textFittingAdapter) {
      this.textFittingAdapter.clearCache();
    }

    if (this.pdfDoc) {
      this.pdfDoc.destroy();
      this.pdfDoc = null;
    }

    // 清理公式 DOM 元素
    if (this.formulaElements) {
      this.formulaElements.forEach(el => el.remove());
      this.formulaElements = [];
    }

    this.canvas = null;
    this.canvasContext = null;
    this.overlayCanvas = null;
    this.overlayContext = null;
    this.contentListJson = null;
    this.translatedContentList = null;
    this.selectedItemIndex = null;
  }
}

// 导出到全局
window.PDFCompareView = PDFCompareView;
