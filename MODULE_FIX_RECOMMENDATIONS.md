# 模块修复建议清单

## 🔴 高优先级 - 必须修复

### 1. TextFittingAdapter - 未定义的常量

**问题位置**: `TextFittingAdapter.js` line 71

**当前代码**:
```javascript
preprocessGlobalFontSizes(contentListJson, translatedContentList) {
  // ...
  contentListJson.forEach((item, idx) => {
    // ...
    const height = (bbox[3] - bbox[1]) / BBOX_NORMALIZED_RANGE;  // ❌ 未定义！
  });
}
```

**修复方案**:
```javascript
preprocessGlobalFontSizes(contentListJson, translatedContentList) {
  if (this.hasPreprocessed) return;

  console.log('[TextFittingAdapter] 开始预处理全局字号...');
  const startTime = performance.now();

  const globalFontScale = this.options.globalFontScale;
  const BBOX_NORMALIZED_RANGE = 1000;  // ✅ 添加这行

  contentListJson.forEach((item, idx) => {
    if (item.type !== 'text' || !item.bbox) return;

    const translatedItem = translatedContentList[idx];
    if (!translatedItem || !translatedItem.text) return;

    const bbox = item.bbox;
    const height = (bbox[3] - bbox[1]) / BBOX_NORMALIZED_RANGE;

    const estimatedFontSize = height * globalFontScale;

    this.globalFontSizeCache.set(idx, {
      estimatedFontSize: estimatedFontSize,
      bbox: bbox
    });
  });

  console.log(`[TextFittingAdapter] 预处理完成：全局缩放=${globalFontScale}, 耗时=${(performance.now() - startTime).toFixed(0)}ms`);
  this.hasPreprocessed = true;
}
```

**影响**: 🔴 严重 - 会导致运行时NaN错误

---

### 2. PDFExporter - Canvas和PDF文本高度公式不一致

**问题位置**:
- Canvas版本: `history_pdf_compare.js` line 1463-1465
- PDF版本: `PDFExporter.js` line 272-274

**当前代码对比**:

Canvas (错误):
```javascript
const totalHeight = lines.length === 1
  ? mid * 1.2  // 单行文本额外增加20%
  : (lines.length - 1) * lineHeight + mid * 1.2;
```

PDF (错误):
```javascript
const totalHeight = lines.length > 0
  ? (lines.length - 1) * lineHeight + mid  // 单行文本没有增加
  : 0;
```

**修复方案** - 统一为一致的公式:

```javascript
// 在 PDFExporter.calculatePdfTextLayout() 中修复 (line 272-274)
// 改为与 Canvas 版本一致：

const totalHeight = lines.length > 0
  ? (lines.length - 1) * lineHeight + mid * 1.2  // ✅ 与Canvas统一
  : 0;

// 同时在 drawPlainTextWithFitting() 中保持一致 (line 1463-1465)
const totalHeight = lines.length > 0
  ? (lines.length - 1) * lineHeight + mid * 1.2  // ✅ 保持一致
  : 0;
```

**说明**:
- 这个 `* 1.2` 是为了给文本留出额外的垂直空间
- Canvas 中确实使用了这个系数
- PDF 版本遗漏了，导致文本可能超出bbox

**影响**: 🔴 严重 - PDF导出的文本大小会与Canvas显示不同

---

### 3. SegmentManager - 事件监听器无法清理

**问题位置**: `SegmentManager.js` lines 216-234, 397-413

**当前代码**:
```javascript
initLazyLoadingSegments() {
  if (!this._lazyInitialized) {
    this.originalScroll.addEventListener('scroll', () => onScroll(this.originalScroll));
    this.translationScroll.addEventListener('scroll', () => onScroll(this.translationScroll));
    // ❌ 这些匿名箭头函数无法被移除
    this._lazyInitialized = true;
  }
}

destroy() {
  // 注意：由于事件监听使用了箭头函数，无法直接移除
  // 这里设置标记位，防止继续渲染
  // ❌ 这不能真正清理资源！
  this.segments = [];
  this.pageInfos = [];
}
```

**修复方案**:

```javascript
constructor(pdfDoc, options = {}) {
  // ... 其他初始化 ...

  this._destroyed = false;  // ✅ 添加销毁标志
  this._scrollHandler = null;  // ✅ 保存事件处理函数引用
}

initLazyLoadingSegments() {
  if (!this.originalScroll || !this.translationScroll) return;

  // 初始渲染可见段
  this.renderVisibleSegments(this.originalScroll);

  const onScroll = (scroller) => {
    clearTimeout(this._lazyScrollTimer);
    this._lazyScrollTimer = setTimeout(() => {
      if (!this._destroyed) {  // ✅ 检查销毁标志
        this.renderVisibleSegments(scroller);
      }
    }, this.options.scrollDebounceMs);
  };

  if (!this._lazyInitialized) {
    // ✅ 保存事件处理函数引用以便后续移除
    this._scrollHandler = onScroll;

    const originalScrollHandler = () => onScroll(this.originalScroll);
    const translationScrollHandler = () => onScroll(this.translationScroll);

    // ✅ 保存处理函数引用
    this._originalScrollHandler = originalScrollHandler;
    this._translationScrollHandler = translationScrollHandler;

    this.originalScroll.addEventListener('scroll', originalScrollHandler);
    this.translationScroll.addEventListener('scroll', translationScrollHandler);
    this._lazyInitialized = true;
  }
}

destroy() {
  this._destroyed = true;  // ✅ 设置销毁标志

  // ✅ 正确移除事件监听器
  if (this._lazyInitialized && this.originalScroll && this.translationScroll) {
    if (this._originalScrollHandler) {
      this.originalScroll.removeEventListener('scroll', this._originalScrollHandler);
    }
    if (this._translationScrollHandler) {
      this.translationScroll.removeEventListener('scroll', this._translationScrollHandler);
    }
  }

  // ✅ 清除定时器
  if (this._lazyScrollTimer) {
    clearTimeout(this._lazyScrollTimer);
    this._lazyScrollTimer = null;
  }

  // ✅ 清空 DOM
  if (this.originalSegmentsContainer) {
    this.originalSegmentsContainer.innerHTML = '';
  }
  if (this.translationSegmentsContainer) {
    this.translationSegmentsContainer.innerHTML = '';
  }

  this.segments = [];
  this.pageInfos = [];
}
```

**影响**: 🔴 严重 - 内存泄漏，事件处理器持续执行

---

## 🟡 中优先级 - 应该改进

### 4. TextFittingAdapter - 缺少错误处理改进

**问题位置**: `TextFittingAdapter.js` line 34-57

**当前代码**:
```javascript
initialize() {
  if (typeof TextFittingEngine === 'undefined') {
    console.error('[TextFittingAdapter] TextFittingEngine 未加载！...');
    return;  // ❌ 静默失败
  }
  // ...
}
```

**修复方案**:

```javascript
initialize() {
  // ✅ 改为throw，更容易被发现
  if (typeof TextFittingEngine === 'undefined') {
    throw new Error('[TextFittingAdapter] TextFittingEngine 未加载！请确保 js/utils/text-fitting.js 已正确引入');
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
    throw error;  // ✅ 将错误传播给调用者
  }
}
```

**使用方式**:
```javascript
try {
  const textFitter = new TextFittingAdapter();
  textFitter.initialize();
} catch (error) {
  console.error('初始化失败，将使用回退方案');
  // 处理回退...
}
```

**影响**: 🟡 中等 - 便于发现问题

---

### 5. TextFittingAdapter - 添加参数验证

**问题位置**: `TextFittingAdapter.js` line 64-93

**当前代码**:
```javascript
preprocessGlobalFontSizes(contentListJson, translatedContentList) {
  // ❌ 没有验证参数
  if (this.hasPreprocessed) return;

  const globalFontScale = this.options.globalFontScale;

  contentListJson.forEach((item, idx) => {  // ❌ 可能不是数组
    // ...
  });
}
```

**修复方案**:

```javascript
preprocessGlobalFontSizes(contentListJson, translatedContentList) {
  if (this.hasPreprocessed) return;

  // ✅ 添加参数验证
  if (!contentListJson || !Array.isArray(contentListJson)) {
    console.warn('[TextFittingAdapter] 无效的 contentListJson，跳过预处理');
    return;
  }

  if (!translatedContentList || !Array.isArray(translatedContentList)) {
    console.warn('[TextFittingAdapter] 无效的 translatedContentList，跳过预处理');
    return;
  }

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

    const estimatedFontSize = height * globalFontScale;

    this.globalFontSizeCache.set(idx, {
      estimatedFontSize: estimatedFontSize,
      bbox: bbox
    });
  });

  console.log(`[TextFittingAdapter] 预处理完成：全局缩放=${globalFontScale}, 耗时=${(performance.now() - startTime).toFixed(0)}ms`);
  this.hasPreprocessed = true;
}
```

**影响**: 🟡 中等 - 防止崩溃

---

### 6. TextFittingAdapter - 添加ctx验证

**问题位置**: `TextFittingAdapter.js` line 309

**当前代码**:
```javascript
wrapText(ctx, text, maxWidth) {
  if (!text) return [];

  const lines = [];
  let currentLine = '';

  // ...
  const metrics = ctx.measureText(testLine);  // ❌ ctx 可能无效
}
```

**修复方案**:

```javascript
wrapText(ctx, text, maxWidth) {
  // ✅ 添加验证
  if (!text) return [];

  if (!ctx || typeof ctx.measureText !== 'function') {
    console.warn('[TextFittingAdapter] 无效的 canvas context');
    // 返回简单分割
    return text.split('\n').length > 0 ? text.split('\n') : [''];
  }

  if (typeof maxWidth !== 'number' || maxWidth <= 0) {
    console.warn('[TextFittingAdapter] 无效的 maxWidth');
    return text.split('\n');
  }

  const lines = [];
  let currentLine = '';

  const segments = text.split(/([。？！，、；：\n])/);

  for (let segment of segments) {
    if (!segment) continue;

    if (/^[。？！，、；：]$/.test(segment)) {
      currentLine += segment;
      continue;
    }

    if (segment === '\n') {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      continue;
    }

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
```

**影响**: 🟡 中等 - 防止崩溃

---

### 7. PDFExporter - 改进fontkit失败处理

**问题位置**: `PDFExporter.js` line 73-90, 395-410

**当前代码**:
```javascript
let font = null;
try {
  if (typeof fontkit === 'undefined') {
    throw new Error('fontkit 未加载，无法嵌入中文字体');
  }
  // ...
  font = await pdfDoc.embedFont(fontBytes);
} catch (fontError) {
  console.error('[PDFExporter] 中文字体加载失败:', fontError);
  if (showNotification) {
    showNotification('中文字体加载失败，无法导出PDF: ' + fontError.message, 'error');
  }
  throw fontError;  // ❌ 中断流程
}

// 但下面又有：
if (typeof fontkit === 'undefined') {
  await new Promise((resolve, reject) => {
    // ...
    script.onerror = (error) => {
      console.warn('[PDFExporter] fontkit 加载失败:', error);
      resolve();  // ❌ 失败也继续！
    };
  });
}
```

**修复方案**:

```javascript
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

  // 加载 fontkit （可选，失败不中断）
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
        console.warn('[PDFExporter] fontkit 加载失败，中文字体可能无法正确显示:', error);
        this.fontkitLoaded = false;
        resolve();  // 不中断流程，但记录失败
      };
      document.head.appendChild(script);
    });
  }
}

async exportStructuredTranslation(originalPdfBase64, translatedContentList, showNotification = null) {
  try {
    // ... 前面的检查 ...

    // ✅ 改进字体加载
    let font = null;
    if (!this.fontkitLoaded) {
      console.warn('[PDFExporter] fontkit 未成功加载，中文字体可能无法正确显示');
      if (showNotification) {
        showNotification('警告：中文字体可能无法正确显示', 'warning');
      }
    } else {
      try {
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
          showNotification('警告：中文字体加载失败，将使用默认字体', 'warning');
        }
        // ✅ 不中断流程，继续使用默认字体
      }
    }

    // 如果没有字体，使用默认字体
    if (!font) {
      console.warn('[PDFExporter] 使用PDF默认字体，中文可能显示为空');
      // 可以选择使用内置字体或继续
    }

    // ... 后续处理 ...
  } catch (error) {
    // ...
  }
}
```

**影响**: 🟡 中等 - 提高鲁棒性

---

### 8. PDFExporter - 添加showNotification类型检查

**问题位置**: `PDFExporter.js` 多处

**当前代码**:
```javascript
if (showNotification) {
  showNotification('没有翻译内容可导出', 'warning');  // ❌ 未检查是否为函数
}
```

**修复方案**:

```javascript
// 在类中添加辅助方法
_notify(message, type = 'info') {
  if (typeof this._showNotification === 'function') {
    this._showNotification(message, type);
  } else if (!this._notificationDisabled) {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

constructor(options = {}, showNotification = null) {
  this.options = Object.assign({
    fontUrl: 'https://...',
    pdfLibUrl: 'https://...',
    fontkitUrl: 'https://...',
    bboxNormalizedRange: 1000
  }, options);

  this._showNotification = typeof showNotification === 'function' ? showNotification : null;
  this.pdfLibLoaded = false;
  this.fontkitLoaded = false;
}

async exportStructuredTranslation(originalPdfBase64, translatedContentList, showNotification = null) {
  // ✅ 更新 showNotification
  if (typeof showNotification === 'function') {
    this._showNotification = showNotification;
  }

  try {
    if (!translatedContentList || translatedContentList.length === 0) {
      this._notify('没有翻译内容可导出', 'warning');
      return;
    }

    if (!originalPdfBase64) {
      this._notify('原始PDF数据不可用', 'error');
      return;
    }

    this._notify('正在生成译文PDF，请稍候...', 'info');

    // ... 后续代码 ...
  } catch (error) {
    this._notify('导出失败: ' + error.message, 'error');
  }
}
```

**影响**: 🟡 中等 - 提高健壮性

---

### 9. SegmentManager - 改进离屏canvas重用

**问题位置**: `SegmentManager.js` line 280-299

**当前代码**:
```javascript
async renderSegment(seg) {
  const off = document.createElement('canvas');  // ❌ 每次创建
  const offCtx = off.getContext('2d', { willReadFrequently: true, alpha: false });

  for (const p of seg.pages) {
    if (off.width !== p.width) off.width = p.width;  // ❌ 频繁重新分配
    if (off.height !== p.height) off.height = p.height;
    // ...
  }
  // ❌ canvas 没有被清理，垃圾回收等待
}
```

**修复方案**:

```javascript
constructor(pdfDoc, options = {}) {
  // ... 其他初始化 ...
  this._offscreenCanvas = null;  // ✅ 缓存离屏canvas
  this._offscreenCtx = null;      // ✅ 缓存context
  this._maxOffscreenSize = { width: 0, height: 0 };  // ✅ 追踪最大尺寸
}

_getOffscreenCanvas(width, height) {
  // ✅ 复用或创建离屏canvas
  if (!this._offscreenCanvas) {
    this._offscreenCanvas = document.createElement('canvas');
    this._offscreenCtx = this._offscreenCanvas.getContext('2d', {
      willReadFrequently: true,
      alpha: false
    });
  }

  // ✅ 只在需要时扩大（不缩小，避免频繁分配）
  if (width > this._maxOffscreenSize.width || height > this._maxOffscreenSize.height) {
    this._offscreenCanvas.width = Math.max(width, this._maxOffscreenSize.width);
    this._offscreenCanvas.height = Math.max(height, this._maxOffscreenSize.height);
    this._maxOffscreenSize.width = this._offscreenCanvas.width;
    this._maxOffscreenSize.height = this._offscreenCanvas.height;
    console.log(`[SegmentManager] 离屏canvas扩展为 ${this._offscreenCanvas.width}x${this._offscreenCanvas.height}`);
  }

  return { canvas: this._offscreenCanvas, ctx: this._offscreenCtx };
}

async renderSegment(seg) {
  for (const p of seg.pages) {
    const { canvas: off, ctx: offCtx } = this._getOffscreenCanvas(p.width, p.height);

    // ✅ 重新设置尺寸为当前page的尺寸（只是清除，不重新分配）
    off.width = p.width;
    off.height = p.height;

    offCtx.clearRect(0, 0, off.width, off.height);
    await p.page.render({ canvasContext: offCtx, viewport: p.viewport }).promise;

    // 绘制到左右段画布
    seg.left.ctx.drawImage(off, 0, p.yInSegPx);
    seg.right.ctx.drawImage(off, 0, p.yInSegPx);
  }

  // 绘制 overlays
  await this.renderSegmentOverlays(seg);
}

destroy() {
  // ... 其他清理 ...

  // ✅ 清理离屏canvas
  this._offscreenCanvas = null;
  this._offscreenCtx = null;
  this._maxOffscreenSize = { width: 0, height: 0 };

  this.segments = [];
  this.pageInfos = [];
}
```

**影响**: 🟡 中等 - 性能优化

---

### 10. SegmentManager - 添加容器验证

**问题位置**: `SegmentManager.js` line 209-210

**当前代码**:
```javascript
createSegmentDom(seg, dpr) {
  // ...
  buildSide(this.originalSegmentsContainer, 'left');  // ❌ 容器可能为null
  buildSide(this.translationSegmentsContainer, 'right');
}

const buildSide = (container, side) => {
  // ...
  container.appendChild(wrapper);  // ❌ 如果container为null会崩溃
};
```

**修复方案**:

```javascript
createSegmentDom(seg, dpr) {
  // ✅ 验证容器
  if (!this.originalSegmentsContainer || !this.translationSegmentsContainer) {
    console.error('[SegmentManager] 容器未初始化，无法创建段DOM');
    return false;
  }

  const cssWidth = seg.widthPx / dpr;
  const cssHeight = seg.heightPx / dpr;

  const buildSide = (container, side) => {
    if (!container) {
      console.error(`[SegmentManager] ${side} 容器为null`);
      return;
    }

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
    if (side === 'left') seg.left = sideObj;
    else seg.right = sideObj;

    // 绑定点击事件
    if (side === 'left' && this.onOverlayClick) {
      overlay.addEventListener('click', (e) => this.onOverlayClick(e, seg));
    }
  };

  buildSide(this.originalSegmentsContainer, 'left');
  buildSide(this.translationSegmentsContainer, 'right');

  return true;
}
```

**影响**: 🟡 中等 - 防止崩溃

---

## 🟢 低优先级 - 可选改进

### 11. SegmentManager - 添加BBOX_NORMALIZED_RANGE验证

**问题位置**: `SegmentManager.js` line 334-365

**当前代码**:
```javascript
const BBOX_NORMALIZED_RANGE = this.options.bboxNormalizedRange;
// ...
const scaleX = p.width / BBOX_NORMALIZED_RANGE;  // ❌ 如果为0会导致Infinity
```

**修复方案**:

```javascript
async clearTextInSegment(seg) {
  if (!this.contentListJson || !this.clearTextInBbox) {
    console.warn('[SegmentManager] 缺少清除文字依赖');
    return;
  }

  const BBOX_NORMALIZED_RANGE = this.options.bboxNormalizedRange;

  // ✅ 添加验证
  if (!BBOX_NORMALIZED_RANGE || BBOX_NORMALIZED_RANGE <= 0) {
    console.error('[SegmentManager] 无效的 bboxNormalizedRange:', BBOX_NORMALIZED_RANGE);
    return;
  }

  // ... 后续代码 ...
}
```

**影响**: 🟢 低 - 防止数值错误

---

### 12. PDFExporter - 改进rgb色值处理

**问题位置**: `PDFExporter.js` line 133

**当前代码**:
```javascript
page.drawRectangle({
  x: x,
  y: y,
  width: width,
  height: height,
  color: rgb(1, 1, 1),  // ⚠️ 这在pdf-lib中是正确的（0-1范围）
});
```

**说明**: 实际上这是正确的，pdf-lib使用0-1范围的RGB值。但建议添加注释：

```javascript
page.drawRectangle({
  x: x,
  y: y,
  width: width,
  height: height,
  color: rgb(1, 1, 1),  // ✅ pdf-lib使用0-1范围（不是0-255）
});
```

**影响**: 🟢 低 - 文档优化

---

## 修复优先级排序

### Phase 1 - 立即修复 (必须在测试前)
1. ✅ TextFittingAdapter - 添加 BBOX_NORMALIZED_RANGE 定义
2. ✅ PDFExporter - 统一Canvas和PDF文本高度公式
3. ✅ SegmentManager - 修复事件监听器清理

### Phase 2 - 尽快修复 (本周内)
4. ✅ TextFittingAdapter - 改进错误处理
5. ✅ TextFittingAdapter - 添加参数验证
6. ✅ TextFittingAdapter - 添加ctx验证
7. ✅ PDFExporter - 改进fontkit失败处理
8. ✅ PDFExporter - 添加showNotification类型检查

### Phase 3 - 后续优化 (下周)
9. ✅ SegmentManager - 改进离屏canvas重用
10. ✅ SegmentManager - 添加容器验证
11. ✅ SegmentManager - 添加BBOX_NORMALIZED_RANGE验证
12. ✅ PDFExporter - 改进rgb色值注释

---

## 测试检查清单

修复完成后，按以下顺序测试：

- [ ] TextFittingAdapter.initialize() 失败时是否正确抛出错误
- [ ] preprocessGlobalFontSizes() 接收无效参数时是否正确处理
- [ ] wrapText() 接收无效ctx时是否降级处理
- [ ] PDFExporter 导出的PDF文本大小是否与Canvas显示一致
- [ ] PDFExporter fontkit加载失败时是否继续导出（可能带警告）
- [ ] SegmentManager 滚动时是否继续渲染，销毁后是否停止
- [ ] SegmentManager destroy() 调用后内存是否释放
- [ ] SegmentManager setContainers(null, ...) 时是否正确处理
- [ ] 长PDF (100+页) 是否能正确分段和渲染
- [ ] 切换PDF后旧的事件监听器是否被清理

---

## 集成测试示例

```javascript
// 完整的集成测试
async function testModuleIntegration() {
  console.log('开始模块集成测试...');

  // 1. 测试TextFittingAdapter
  console.log('\n1. 测试 TextFittingAdapter');
  try {
    const textFitter = new TextFittingAdapter({
      globalFontScale: 0.9
    });

    // 应该throw而不是静默失败
    try {
      textFitter.initialize();
      console.warn('⚠️ initialize() 应该检查TextFittingEngine');
    } catch (e) {
      console.log('✅ initialize() 正确抛出错误');
    }

    // 测试参数验证
    textFitter.preprocessGlobalFontSizes(null, null);
    console.log('✅ preprocessGlobalFontSizes() 接受无效参数');

    // 测试wrapText验证
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const lines = textFitter.wrapText(null, 'test', 100);  // 应该降级
    console.log('✅ wrapText() 接受无效ctx，返回:', lines);

  } catch (error) {
    console.error('❌ TextFittingAdapter测试失败:', error);
  }

  // 2. 测试PDFExporter
  console.log('\n2. 测试 PDFExporter');
  try {
    const exporter = new PDFExporter();

    // 测试没有翻译数据
    await exporter.exportStructuredTranslation('', [], (msg, type) => {
      console.log(`[${type}] ${msg}`);
    });
    console.log('✅ 空翻译数据处理正确');

  } catch (error) {
    console.error('❌ PDFExporter测试失败:', error);
  }

  // 3. 测试SegmentManager
  console.log('\n3. 测试 SegmentManager');
  try {
    // 模拟pdfDoc
    const mockPdfDoc = {
      numPages: 10,
      getPage: async (n) => ({
        getViewport: ({ scale }) => ({ width: 612, height: 792, scale }),
        render: async ({ canvasContext, viewport }) => ({ promise: Promise.resolve() })
      })
    };

    const manager = new SegmentManager(mockPdfDoc);

    // 设置依赖和容器
    const origContainer = document.createElement('div');
    const transContainer = document.createElement('div');

    manager.setContainers(origContainer, transContainer, window, window);

    // 测试setContainers(null)
    manager.setContainers(null, null, null, null);
    console.log('✅ setContainers() 接受null，createSegmentDom应该降级');

    // 测试destroy
    manager.destroy();
    console.log('✅ destroy() 执行成功');

  } catch (error) {
    console.error('❌ SegmentManager测试失败:', error);
  }

  console.log('\n✅ 模块集成测试完成');
}

// 运行测试
testModuleIntegration();
```

