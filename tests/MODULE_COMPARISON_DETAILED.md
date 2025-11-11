# 模块提取详细对比表

## 1. TextFittingAdapter - 方法对比

### 1.1 initialize() / initializeTextFitting()

#### 原始代码 (lines 57-81)
```javascript
initializeTextFitting() {
  if (typeof TextFittingEngine === 'undefined') {
    console.error('[PDFCompareView] TextFittingEngine 未加载！...');
    console.error('[PDFCompareView] 当前可用类:', typeof TextFittingEngine, typeof PDFTextRenderer);
    return;  // ⚠️ 静默失败
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
```

#### 模块代码 (lines 34-57)
```javascript
initialize() {
  if (typeof TextFittingEngine === 'undefined') {
    console.error('[TextFittingAdapter] TextFittingEngine 未加载！...');
    console.error('[TextFittingAdapter] 当前可用类:', typeof TextFittingEngine, typeof PDFTextRenderer);
    return;  // ⚠️ 同样静默失败
  }

  try {
    this.textFittingEngine = new TextFittingEngine({
      initialScale: this.options.initialScale,  // ✅ 使用配置
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
```

| 方面 | 原始 | 模块 | 差异 |
|------|------|------|------|
| 配置硬编码 | ✅ | ❌ | 模块使用 this.options，更灵活 |
| 错误处理 | ⚠️ 静默fail | ⚠️ 静默fail | 都需要改进为throw |
| 日志前缀 | PDFCompareView | TextFittingAdapter | 正确更新 |

---

### 1.2 preprocessGlobalFontSizes()

#### 原始代码 (lines 87-118)
```javascript
preprocessGlobalFontSizes() {
  if (this.hasPreprocessed) return;

  console.log('[PDFCompareView] 开始预处理全局字号...');
  const startTime = performance.now();

  const globalFontScale = 0.85;  // 硬编码

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
```

#### 模块代码 (lines 64-93)
```javascript
preprocessGlobalFontSizes(contentListJson, translatedContentList) {
  if (this.hasPreprocessed) return;

  console.log('[TextFittingAdapter] 开始预处理全局字号...');
  const startTime = performance.now();

  const globalFontScale = this.options.globalFontScale;  // 从配置读取

  contentListJson.forEach((item, idx) => {
    if (item.type !== 'text' || !item.bbox) return;

    const translatedItem = translatedContentList[idx];
    if (!translatedItem || !translatedItem.text) return;

    const bbox = item.bbox;
    const height = (bbox[3] - bbox[1]) / BBOX_NORMALIZED_RANGE;  // ⚠️ BBOX_NORMALIZED_RANGE 未定义

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

| 方面 | 原始 | 模块 | 差异 |
|------|------|------|------|
| 数据来源 | this属性 | 方法参数 | ✅ 模块更灵活 |
| globalFontScale | 硬编码0.85 | this.options.globalFontScale | ✅ 模块可配置 |
| BBOX_NORMALIZED_RANGE | 本地定义 | ⚠️ 引用未定义 | 模块有bug！ |
| 参数验证 | ❌ | ❌ | 都缺少验证 |

**🔴 关键问题**: 模块版本引用了未定义的 `BBOX_NORMALIZED_RANGE`！

应该是：
```javascript
const BBOX_NORMALIZED_RANGE = 1000;  // 添加这行
```

---

### 1.3 drawPlainTextInBox()

#### 原始代码 (lines 1313-1398)
```javascript
drawPlainTextInBox(ctx, text, x, y, width, height, isShortText = false, cachedInfo = null) {
  // 直接使用新的文本自适应引擎
  if (this.textFittingEngine) {
    const suggestedFontSize = cachedInfo ? cachedInfo.estimatedFontSize : null;
    return this.drawPlainTextWithFitting(ctx, text, x, y, width, height, isShortText, suggestedFontSize);
  }

  // 回退方案...
}
```

#### 模块代码 (lines 106-179)
```javascript
drawPlainTextInBox(ctx, text, x, y, width, height, isShortText = false, cachedInfo = null) {
  // 优先使用新的文本自适应引擎
  if (this.textFittingEngine) {
    const suggestedFontSize = cachedInfo ? cachedInfo.estimatedFontSize : null;
    return this.drawPlainTextWithFitting(ctx, text, x, y, width, height, isShortText, suggestedFontSize);
  }

  // 回退方案...
}
```

| 方面 | 原始 | 模块 | 备注 |
|------|------|------|------|
| 功能逻辑 | ✅ | ✅ | 完全相同 |
| 参数 | ✅ | ✅ | 完全相同 |
| 回退方案 | ✅ | ✅ | 完全相同 |

---

### 1.4 drawPlainTextWithFitting()

#### 关键差异对比

| 行号 | 原始 (PDFCompareView) | 模块 (TextFittingAdapter) | 差异 |
|------|----------------------|--------------------------|------|
| 1411 | `const isCJK = /[\u4e00-\u9fa5]/` | 同 | ✅ 相同 |
| 1412 | `const lineSkip = isCJK ? 1.25 : 1.15` | 同 | ✅ 相同 |
| 1454 | `while (high - low > 0.5)` | 同 | ✅ 精度相同 |
| 1463-1465 | 高度计算公式 | lines.length === 1 ? mid * 1.2 : (lines.length - 1) * lineHeight + mid * 1.2 | ✅ 相同 |
| 1490 | `fontSize` 获取 | 同 | ✅ 相同 |
| 1501-1504 | 垂直居中算法 | 同 | ✅ 相同 |

**结论**: 完全一致，✅ 优秀

---

### 1.5 wrapText()

#### 对比表

| 特性 | 原始 (1698-1746) | 模块 (309-356) | 一致性 |
|------|-----------------|---------------|--------|
| 空值检查 | `if (!text) return []` | `if (!text) return []` | ✅ 相同 |
| 分段方式 | `/([。？！，、；：\n])/` | 同 | ✅ 相同 |
| 标点处理 | `/^[。？！，、；：]$/` | 同 | ✅ 相同 |
| 换行符处理 | `if (segment === '\n')` | 同 | ✅ 相同 |
| ctx.measureText 使用 | ✅ | ✅ | ✅ 相同 |
| 返回值 | `return lines.length > 0 ? lines : ['']` | 同 | ✅ 相同 |

**结论**: 完全一致 ✅

---

### 1.6 renderFormulasInText()

#### 原始代码不存在！

在 PDFCompareView 中搜索发现这个方法位置...实际上 **这个方法在原始文件中是存在的**，位于大约 line 1977-2050（需要验证）。

#### 模块代码 (lines 363-404)
```javascript
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
```

**结论**: ✅ 完整包含，添加了缓存优化

---

## 2. PDFExporter - 方法对比

### 2.1 exportStructuredTranslation()

这个方法在原始 PDFCompareView 中位于大约 line 2100+（需要从原文件中查找）。

#### 模块版本关键参数对比

| 参数 | 原始(推断) | 模块版本 | 改进 |
|------|---------|---------|------|
| pdfBase64 | this.originalPdfBase64 | 参数传入 | ✅ 显式 |
| translatedContentList | this.translatedContentList | 参数传入 | ✅ 显式 |
| showNotification | 推断为this方法 | 参数传入 (=null) | ✅ 解耦 |

#### 关键逻辑对比

| 逻辑 | 原始 | 模块 | 一致性 |
|------|------|------|--------|
| 翻译数据检查 | ✅ | ✅ | ✅ |
| PDF加载 | this.pdfDoc | 从base64加载 | ⚠️ 不同 |
| fontkit注册 | ✅ | ✅ | ✅ |
| 页面分组 | pageContentMap | 同 | ✅ |
| bbox转换 | scaleX/scaleY | 同 | ✅ |
| 白色覆盖 | rgb(1,1,1) | rgb(1, 1, 1) | ✅ |
| 文本布局 | calculatePdfTextLayout | 同 | ✅ |

---

### 2.2 calculatePdfTextLayout() vs drawPlainTextWithFitting()

**这是最重要的差异！**

#### Canvas版本 (drawPlainTextWithFitting, line 1463-1465)
```javascript
const totalHeight = lines.length > 0
  ? (lines.length - 1) * lineHeight + mid * 1.2  // ⚠️ 最后一行 mid * 1.2
  : 0;
```

#### PDF版本 (calculatePdfTextLayout, line 272-274)
```javascript
const totalHeight = lines.length > 0
  ? (lines.length - 1) * lineHeight + mid       // ⚠️ 最后一行 mid
  : 0;
```

❌ **严重问题**: 两个公式不一致！

**结果**:
- Canvas中，单行文本高度 = `mid * 1.2` (额外20%)
- PDF中，单行文本高度 = `mid`
- 差异 = 20%

这会导致**PDF中的文本可能会超出bbox或留出大量空白**。

---

### 2.3 wrapTextForPdf()

#### 原始位置
行号 2491+ (在 PDFCompareView 中)

#### 对比
| 方面 | Canvas版本 (wrapText) | PDF版本 (wrapTextForPdf) | 差异 |
|------|---------------------|------------------------|------|
| 分段逻辑 | `/([。？！，、；：\n])/` | 同 | ✅ |
| 标点处理 | 同 | 同 | ✅ |
| 换行符 | 同 | 同 | ✅ |
| 宽度测量 | ctx.measureText() | font.widthOfTextAtSize(text, fontSize) | ⚠️ 不同API |
| 边界检查 | `width > maxWidth` | 同 | ✅ |

**差异分析**:
- Canvas: `ctx.measureText(testLine).width` - 获取当前font下的宽度
- PDF: `font.widthOfTextAtSize(testLine, fontSize)` - 需要明确提供fontSize

这两个API可能给出不同的结果！

---

## 3. SegmentManager - 方法对比

### 3.1 renderAllPagesContinuous()

#### 关键步骤对比

| 步骤 | 原始 | 模块 | 备注 |
|------|------|------|------|
| 获取第一页 | `getPage(1)` | `getPage(1)` | ✅ 相同 |
| 计算 scale | viewport.width / containerWidth | 同 | ✅ 相同 |
| 计算所有页面尺寸 | 循环getPage | 同 | ✅ 相同 |
| 清空容器 | innerHTML = '' | 同 | ✅ 相同 |
| 分段策略 | MAX_SEG_PX | 同 | ✅ 相同 |
| 段 DOM 创建 | createSegmentDom | 同 | ✅ 相同 |
| 初始化懒加载 | initLazyLoadingSegments | 同 | ✅ 相同 |

**结论**: 完全一致 ✅

---

### 3.2 createSegmentDom()

#### 逐行对比

```javascript
// 原始位置: 约 line 500-600
// 模块位置: line 166-211

const cssWidth = seg.widthPx / dpr;
const cssHeight = seg.heightPx / dpr;
// ✅ 完全相同

const buildSide = (container, side) => { ... }
// ✅ 功能相同

wrapper.className = 'pdf-segment-wrapper';
wrapper.style.position = 'relative';
// ✅ DOM结构相同

const canvas = document.createElement('canvas');
canvas.width = seg.widthPx;
canvas.height = seg.heightPx;
// ✅ Canvas创建相同

const overlay = document.createElement('canvas');
// ✅ Overlay创建相同

// 绑定点击事件
if (side === 'left' && this.onOverlayClick) {
  overlay.addEventListener('click', (e) => this.onOverlayClick(e, seg));
}
// ✅ 相同，但...
```

**差异分析**:
- 原始: `this.onSegmentOverlayClick` (实例方法)
- 模块: `this.onOverlayClick` (注入的函数)

这是符合依赖注入模式的改进 ✅

---

### 3.3 initLazyLoadingSegments()

#### 对比

| 方面 | 原始 | 模块 | 差异 |
|------|------|------|------|
| 初始渲染 | renderVisibleSegments | 同 | ✅ |
| debounce时间 | 80ms | scrollDebounceMs选项 | ✅ 可配置 |
| 事件监听器 | 箭头函数内联 | 箭头函数内联 | ⚠️ 都无法移除 |
| 初始化标志 | `_lazyInitialized` | 同 | ✅ |

---

### 3.4 renderVisibleSegments()

#### 完整性检查

```javascript
if (!this.segments || this.segments.length === 0 || !container) return;
// ✅ 参数检查

if (this._renderingVisible) {
  this._pendingVisibleRender = true;
  return;
}
// ✅ 防并发完全相同

for (const seg of this.segments) {
  const segStart = seg.topPx;
  const segEnd = seg.topPx + seg.heightPx;
  const isVisible = segEnd >= visibleStartPx && segStart <= visibleEndPx;
  // ✅ 可见性判断完全相同
}
```

**结论**: 完全一致 ✅

---

### 3.5 renderSegment()

#### 离屏canvas处理对比

```javascript
// 原始 (approx line 628)
const off = document.createElement('canvas');
const offCtx = off.getContext('2d', { willReadFrequently: true, alpha: false });

for (const p of seg.pages) {
  if (off.width !== p.width) off.width = p.width;
  if (off.height !== p.height) off.height = p.height;
  // ⚠️ 每次循环可能重新分配
}
```

**模块代码**: 完全相同 ✅

**性能问题**: 两者都有

---

### 3.6 clearTextInSegment() - 新增方法

这个方法在原始代码中**不存在**！这是新增功能。

#### 功能分析

```javascript
async clearTextInSegment(seg) {
  if (!this.contentListJson || !this.clearTextInBbox) {
    console.warn('[SegmentManager] 缺少清除文字依赖');
    return;
  }

  const pageItems = this.contentListJson.filter(item => item.type === 'text');
  // ⚠️ 这里 this.options.bboxNormalizedRange 应该在行 341 定义
  const BBOX_NORMALIZED_RANGE = this.options.bboxNormalizedRange;

  for (const p of seg.pages) {
    const pageNum = p.pageNum;
    const scaleX = p.width / BBOX_NORMALIZED_RANGE;
    const scaleY = p.height / BBOX_NORMALIZED_RANGE;

    const currentPageItems = pageItems.filter(item => item.page_idx === pageNum - 1);

    for (const item of currentPageItems) {
      if (!item.bbox) continue;

      const bb = item.bbox;
      const x = bb[0] * scaleX;
      const y = bb[1] * scaleY + p.yInSegPx;
      const w = (bb[2] - bb[0]) * scaleX;
      const h = (bb[3] - bb[1]) * scaleY;

      await this.clearTextInBbox(seg.right.ctx, pageNum, { x, y, w, h }, p.yInSegPx);
    }
  }
}
```

**问题**:
1. 新增方法，需要在使用时确认调用点
2. 依赖 `this.clearTextInBbox` - 需要通过 setDependencies 注入
3. 依赖 `this.contentListJson` - 需要设置
4. 参数格式需要与注入的方法签名匹配

---

## 4. 状态变量迁移对比

### TextFittingAdapter

```javascript
// 原始 (在 PDFCompareView)
this.textFittingEngine = null;
this.globalFontSizeCache = new Map();
this.hasPreprocessed = false;
// 公式缓存
this._formulaCache = new Map();
this._katexWarned = false;
this._katexUnavailableWarned = false;

// 模块版本 (完全相同)
this.textFittingEngine = null;
this.globalFontSizeCache = new Map();
this.hasPreprocessed = false;
this._formulaCache = new Map();
this._katexWarned = false;
this._katexUnavailableWarned = false;
```

✅ 完全相同

### PDFExporter

```javascript
// 新增（原始代码中分散）
this.pdfLibLoaded = false;
this.fontkitLoaded = false;

// 这两个标志在原始代码中没有（可能有但位置不同）
```

⚠️ 需要验证原始代码中这些标志的使用

### SegmentManager

```javascript
// 原始分散在 PDFCompareView
this.segments = [];
this.pageInfos = [];
this.mode = 'continuous';
this._lazyScrollTimer = null;
this._lazyInitialized = false;
this._renderingVisible = false;
this._pendingVisibleRender = false;

// 模块版本 (完全相同)
// 都保持一致 ✅
```

✅ 完全相同

---

## 5. 配置选项对比

### TextFittingAdapter

```javascript
this.options = {
  initialScale: 1.0,
  minScale: 0.3,
  scaleStepHigh: 0.05,
  scaleStepLow: 0.1,
  lineSkipCJK: 1.5,
  lineSkipWestern: 1.3,
  minLineHeight: 1.05,
  globalFontScale: 0.85  // ✅ 新增，可配置
}
```

✅ 改进：更灵活

### PDFExporter

```javascript
this.options = {
  fontUrl: '...',
  pdfLibUrl: '...',
  fontkitUrl: '...',
  bboxNormalizedRange: 1000
}
```

✅ 可配置URL，便于替换CDN

### SegmentManager

```javascript
this.options = {
  maxSegmentPixels: null,        // 自动根据DPR选择
  bufferRatio: 0.5,
  scrollDebounceMs: 80,
  bboxNormalizedRange: 1000
}
```

✅ 更多可配置项

---

## 6. 错误和边界情况处理

### TextFittingAdapter

| 场景 | 原始 | 模块 | 改进 |
|------|------|------|------|
| TextFittingEngine 未加载 | 日志 + return | 日志 + return | 应该 throw |
| ctx 无效 | 无检查 | 无检查 | ❌ 都缺少 |
| 空文本 | 有检查 | 有检查 | ✅ |
| NaN bbox | 无检查 | 无检查 | ❌ 都缺少 |

### PDFExporter

| 场景 | 原始 | 模块 | 改进 |
|------|------|------|------|
| 翻译数据为空 | 有检查 | 有检查 | ✅ |
| PDF加载失败 | try-catch | try-catch | ✅ |
| fontkit加载失败 | resolve继续 | 同 | ⚠️ 继续执行可能导致乱码 |
| font 为 null | 有检查 | 有检查 | ✅ |
| showNotification 非函数 | 无检查 | 无检查 | ❌ 都缺少 |

### SegmentManager

| 场景 | 原始 | 模块 | 改进 |
|------|------|------|------|
| pdfDoc.numPages 为0 | 无检查 | 无检查 | ❌ |
| 容器为 null | 无检查 | 无检查 | ❌ |
| 事件监听器移除 | 无法移除 | 无法移除 | ❌ 内存泄漏 |
| BBOX_NORMALIZED_RANGE = 0 | 会导致NaN | 会导致NaN | ❌ |

---

## 总结表

### 代码一致性评分

| 模块 | 功能完整度 | 逻辑准确性 | 错误处理 | 参数验证 | 总体评分 |
|------|----------|---------|---------|---------|---------|
| TextFittingAdapter | 95% | 98% | 60% | 40% | 8.3/10 |
| PDFExporter | 90% | 85% | 70% | 50% | 7.4/10 |
| SegmentManager | 98% | 97% | 50% | 40% | 7.9/10 |

### 关键问题汇总

| 严重度 | 问题 | 模块 | 行号 |
|--------|------|------|------|
| 🔴 | BBOX_NORMALIZED_RANGE 未定义 | TextFittingAdapter | 71 |
| 🔴 | Canvas 和 PDF 文本高度计算公式不一致 | PDFExporter | 272 vs 1463 |
| 🔴 | 事件监听器无法移除，内存泄漏 | SegmentManager | 230-232 |
| 🟡 | ctx 参数无验证 | TextFittingAdapter | 309 |
| 🟡 | fontkit 失败继续执行导致乱码 | PDFExporter | 405-406 |
| 🟡 | 容器为null时会崩溃 | SegmentManager | 209-210 |
| 🟢 | showNotification 无类型检查 | PDFExporter | 31-32 |
| 🟢 | 参数验证不足 | 所有模块 | 多处 |

