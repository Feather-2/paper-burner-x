/**
 * SegmentManager.js
 * 长画布分段管理模块
 * 负责PDF连续模式的分段渲染和懒加载
 */

class SegmentManager {
  constructor(pdfDoc, options = {}) {
    this.pdfDoc = pdfDoc;
    this.totalPages = pdfDoc.numPages;
    this.scale = 1.0;
    this.dpr = window.devicePixelRatio || 1;

    // 配置选项
    this.options = Object.assign({
      maxSegmentPixels: null, // 自动根据DPR选择
      bufferRatio: 0.5,
      scrollDebounceMs: 80,
      bboxNormalizedRange: 1000
    }, options);

    // 段数据
    this.segments = [];
    this.pageInfos = [];
    this.mode = 'continuous';

    // 容器引用
    this.originalSegmentsContainer = null;
    this.translationSegmentsContainer = null;
    this.originalScroll = null;
    this.translationScroll = null;

    // 懒加载状态
    this._lazyScrollTimer = null;
    this._lazyInitialized = false;
    this._renderingVisible = false;
    this._pendingVisibleRender = false;

    // 依赖的渲染函数（由外部注入）
    this.renderPageBboxesToCtx = null;
    this.renderPageTranslationToCtx = null;
    this.clearTextInBbox = null;
    this.clearFormulaElementsForPageInWrapper = null;
    this.onOverlayClick = null;
    this.contentListJson = null;
  }

  /**
   * 设置依赖的渲染函数
   */
  setDependencies(deps) {
    Object.assign(this, deps);
  }

  /**
   * 设置容器元素
   */
  setContainers(originalSegments, translationSegments, originalScroll, translationScroll) {
    this.originalSegmentsContainer = originalSegments;
    this.translationSegmentsContainer = translationSegments;
    this.originalScroll = originalScroll;
    this.translationScroll = translationScroll;
  }

  /**
   * 渲染所有页面（连续模式）
   */
  async renderAllPagesContinuous() {
    this.mode = 'continuous';

    // 计算自适应缩放
    const firstPage = await this.pdfDoc.getPage(1);
    const originalViewport = firstPage.getViewport({ scale: 1.0 });
    const containerWidth = this.originalScroll.clientWidth - 40;
    this.scale = Math.min(containerWidth / originalViewport.width, 1.5);

    const dpr = this.dpr;
    console.log(`[SegmentManager] DPR=${dpr}, scale=${this.scale}`);

    // 计算所有页面尺寸（物理像素）
    this.pageInfos = [];
    let totalHeight = 0;
    for (let i = 1; i <= this.totalPages; i++) {
      const page = await this.pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: this.scale * dpr });
      const info = {
        pageNum: i,
        page,
        viewport,
        yOffset: totalHeight,
        width: viewport.width,
        height: viewport.height
      };
      this.pageInfos.push(info);
      totalHeight += viewport.height;
    }

    // 清空旧段容器
    this.originalSegmentsContainer.innerHTML = '';
    this.translationSegmentsContainer.innerHTML = '';
    this.segments = [];

    // 分段策略
    const MAX_SEG_PX = this.options.maxSegmentPixels || (dpr >= 2 ? 4096 : 8192);
    const canvasWidth = this.pageInfos.length > 0
      ? this.pageInfos[0].width
      : Math.round(originalViewport.width * this.scale * dpr);

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
        pages: [],
        left: null,
        right: null,
        rendered: false,
        rendering: false,
        textCleared: false,
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
      currentSeg.pages.push({
        pageNum: p.pageNum,
        page: p.page,
        viewport: p.viewport,
        yInSegPx: yInSeg,
        width: p.width,
        height: p.height
      });
      currentSegHeight += p.height;
    }
    if (currentSeg) currentSeg.heightPx = currentSegHeight;

    // 创建段 DOM
    for (const seg of this.segments) {
      this.createSegmentDom(seg, dpr);
    }

    // 初始化懒加载
    this.initLazyLoadingSegments();

    console.log(`[SegmentManager] 已创建 ${this.segments.length} 个段`);
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

      // 绑定点击事件
      if (side === 'left' && this.onOverlayClick) {
        overlay.addEventListener('click', (e) => this.onOverlayClick(e, seg));
      }
    };

    buildSide(this.originalSegmentsContainer, 'left');
    buildSide(this.translationSegmentsContainer, 'right');
  }

  /**
   * 初始化懒加载：监听滚动，渲染可见区域
   */
  initLazyLoadingSegments() {
    if (!this.originalScroll || !this.translationScroll) return;

    // 初始渲染可见段
    this.renderVisibleSegments(this.originalScroll);

    const onScroll = (scroller) => {
      clearTimeout(this._lazyScrollTimer);
      this._lazyScrollTimer = setTimeout(() => {
        this.renderVisibleSegments(scroller);
      }, this.options.scrollDebounceMs);
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
    if (this._renderingVisible) {
      this._pendingVisibleRender = true;
      return;
    }
    this._renderingVisible = true;

    const dpr = this.dpr;
    const scrollTopCss = container.scrollTop;
    const viewportHeightCss = container.clientHeight;
    const bufferCss = viewportHeightCss * this.options.bufferRatio;
    const visibleStartPx = Math.max(0, (scrollTopCss - bufferCss) * dpr);
    const visibleEndPx = (scrollTopCss + viewportHeightCss + bufferCss) * dpr;

    for (const seg of this.segments) {
      const segStart = seg.topPx;
      const segEnd = seg.topPx + seg.heightPx;
      const isVisible = segEnd >= visibleStartPx && segStart <= visibleEndPx;

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
   * 渲染单个段
   */
  async renderSegment(seg) {
    // 使用离屏画布避免 PDF.js 清除问题
    const off = document.createElement('canvas');
    const offCtx = off.getContext('2d', { willReadFrequently: true, alpha: false });

    for (const p of seg.pages) {
      if (off.width !== p.width) off.width = p.width;
      if (off.height !== p.height) off.height = p.height;

      offCtx.clearRect(0, 0, off.width, off.height);
      await p.page.render({ canvasContext: offCtx, viewport: p.viewport }).promise;

      // 绘制到左右段画布
      seg.left.ctx.drawImage(off, 0, p.yInSegPx);
      seg.right.ctx.drawImage(off, 0, p.yInSegPx);
    }

    // 绘制 overlays
    await this.renderSegmentOverlays(seg);
  }

  /**
   * 渲染段的覆盖层（bbox和翻译）
   */
  async renderSegmentOverlays(seg) {
    if (!this.renderPageBboxesToCtx || !this.renderPageTranslationToCtx) {
      console.warn('[SegmentManager] 缺少渲染函数依赖');
      return;
    }

    const leftCtx = seg.left.overlayCtx;
    const rightCtx = seg.right.overlayCtx;

    // 清理段 overlay
    leftCtx.clearRect(0, 0, seg.widthPx, seg.heightPx);
    rightCtx.clearRect(0, 0, seg.widthPx, seg.heightPx);

    // 清理公式 DOM
    if (this.clearFormulaElementsForPageInWrapper) {
      for (const p of seg.pages) {
        this.clearFormulaElementsForPageInWrapper(p.pageNum, seg.right.wrapper);
      }
    }

    // 绘制 overlays（串行执行）
    for (const p of seg.pages) {
      this.renderPageBboxesToCtx(leftCtx, p.pageNum, p.yInSegPx, p.width, p.height);
      await this.renderPageTranslationToCtx(rightCtx, seg.right.wrapper, p.pageNum, p.yInSegPx, p.width, p.height);
    }
  }

  /**
   * 清除段内所有 bbox 的原始文字
   */
  async clearTextInSegment(seg) {
    if (!this.contentListJson || !this.clearTextInBbox) {
      console.warn('[SegmentManager] 缺少清除文字依赖');
      return;
    }

    const pageItems = this.contentListJson.filter(item => item.type === 'text');
    const BBOX_NORMALIZED_RANGE = this.options.bboxNormalizedRange;

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

        // 精确清除文字
        await this.clearTextInBbox(seg.right.ctx, pageNum, { x, y, w, h }, p.yInSegPx);
      }
    }
  }

  /**
   * 获取当前可见的页码
   */
  getCurrentVisiblePageNum(container) {
    if (!container || !this.pageInfos || this.pageInfos.length === 0) return 1;

    const scrollTopCss = container.scrollTop;
    const scrollTopPx = scrollTopCss * this.dpr;

    for (const info of this.pageInfos) {
      if (scrollTopPx >= info.yOffset && scrollTopPx < info.yOffset + info.height) {
        return info.pageNum;
      }
    }
    return 1;
  }

  /**
   * 滚动到指定页面
   */
  scrollToPage(pageNum, container) {
    if (!container || pageNum < 1 || pageNum > this.pageInfos.length) return;

    const info = this.pageInfos[pageNum - 1];
    const scrollTopCss = info.yOffset / this.dpr;
    container.scrollTop = scrollTopCss;
  }

  /**
   * 清理资源
   */
  destroy() {
    // 移除事件监听
    if (this._lazyInitialized && this.originalScroll && this.translationScroll) {
      // 注意：由于事件监听使用了箭头函数，无法直接移除
      // 这里设置标记位，防止继续渲染
      this.segments = [];
      this.pageInfos = [];
    }

    // 清空 DOM
    if (this.originalSegmentsContainer) {
      this.originalSegmentsContainer.innerHTML = '';
    }
    if (this.translationSegmentsContainer) {
      this.translationSegmentsContainer.innerHTML = '';
    }
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SegmentManager;
}
