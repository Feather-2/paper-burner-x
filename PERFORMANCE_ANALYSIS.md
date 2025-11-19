# History Detail 性能瓶颈分析报告

> **问题现象**：阅读长文件时 CPU 单线程占用 10%+，页面卡顿冻结

## 🔴 关键瓶颈识别

### 1. **同步批量 KaTeX 渲染**（最严重）

#### 位置
- `history_detail_show_tab.js:1685-1687`
- `formula_post_processor.js:64-250`

#### 问题
```javascript
// ❌ 渲染完所有 Markdown 后，同步扫描整个文档树查找公式
FormulaPostProcessor.processFormulasInElement(activeContentElement);
```

**为什么卡死**：
1. **TreeWalker 全文档扫描**（猜测实现）
   - 遍历所有 DOM 节点（长文档有 5000+ 节点）
   - 每个文本节点正则匹配 `$...$`, `$$...$$`, `\(...\)`, `\[...\]`

2. **KaTeX 同步渲染**
   ```javascript
   katex.render(formula, span, { /* 选项 */ });  // 阻塞主线程
   ```
   - 每个公式渲染耗时 5-30ms
   - 100 个公式 = 500-3000ms 的**同步阻塞**

3. **没有分批/异步**
   - 一次性处理完所有公式才释放主线程
   - 期间用户无法交互，页面冻结

---

### 2. **重复的子块分割**（次严重）

#### 位置
- `history_detail_show_tab.js:1680` (第 1 次)
- `history_detail_show_tab.js:1749` (第 2 次)

#### 问题
```javascript
// ❌ 同一个内容调用了 2 次 segmentInBatches
segmentInBatches(activeContentElement, 10, 50, () => { ... });  // Line 1680
// ... 后续代码又调用了一次
segmentInBatches(activeContentElement, 10, 50, () => { ... });  // Line 1749
```

**为什么重复**：
- 代码重构时遗留的冗余调用
- 每次调用都会：
  ```javascript
  const blocks = Array.from(containerElement.children);  // 转换 DOM 集合
  for (i = 0; i < blocks.length; i++) {
    SubBlockSegmenter.segment(el, i, true);  // 递归分割文本节点
  }
  ```

**成本**：
- 长文档 500 个段落 × 2 次 = 1000 次子块分割
- 每次分割涉及：正则匹配、`document.createElement('span')`、DOM 插入

---

### 3. **marked.lexer() 的全文解析**

#### 位置
- `history_detail_show_tab.js:1550`

#### 问题
```javascript
const tokens = marked.lexer(contentText).filter(token => [...]);
```

**为什么耗时**：
- `marked.lexer()` 是**同步解析**整个 Markdown 文本
- 长文档（10MB+ OCR 文本）解析耗时 500-2000ms
- 单线程阻塞，无法中断

**现状**：
- 代码已有分批渲染逻辑（`batchSize = 30`）
- 但 lexer 的解析仍是一次性完成

---

### 4. **分块对比模式的虚拟化失效**

#### 位置
- `chunk_compare_optimizer.js:34-51`

#### 问题
```javascript
optimizeChunkComparison(ocrChunks, translatedChunks, options = {}) {
  // ❌ 对于 < 100 块的文档，仍然一次性渲染
  const containerHTML = this.createSkeletonContainer(chunkCount);
  setTimeout(() => {
    this.scheduleProgressiveRender(ocrChunks, translatedChunks, options);
  }, 100);
}
```

**问题分析**：
1. **虚拟滚动未生效**
   - `IntersectionObserver` 设置了，但未真正用于懒加载
   - 仍然预渲染所有分块的 DOM（只是分批）

2. **对比模式的 KaTeX 公式**
   - 每个分块可能包含 5-10 个公式
   - 100 块 × 10 公式 = 1000 个 KaTeX 渲染调用

---

### 5. **批注系统的全文档扫描**

#### 位置
- `history_detail_show_tab.js:1690-1692`

#### 问题
```javascript
window.applyBlockAnnotations(activeContentElement, data.annotations, contentIdentifier);
```

**推测实现**：
- 遍历所有段落，匹配批注的位置
- 正则搜索批注文本在 DOM 中的位置
- 长文档 + 多批注 = 大量字符串比较

---

## 📊 性能数据推算

### 场景：100 页 PDF（10MB OCR 文本，500 段落，200 个公式）

| 阶段 | 操作 | 耗时估算 | 是否阻塞 |
|------|------|---------|---------|
| **1. Markdown 解析** | `marked.lexer(10MB)` | 1000-2000ms | ✅ 阻塞 |
| **2. 分批渲染 HTML** | 30个段落/批 × 17批 | 500ms | ⚠️ 分批（微卡顿） |
| **3. 子块分割 ×2** | 500段落 × 2次 | 1000ms | ✅ 阻塞（分批但慢） |
| **4. 公式后处理** | 200公式 × 15ms | **3000ms** | 🔴 **严重阻塞** |
| **5. 批注应用** | 全文档扫描 | 500ms | ✅ 阻塞 |
| **总计** | | **6000-7000ms** | |

**用户体验**：
- 切换标签页后 **6-7 秒页面冻结**
- 期间滚动、点击、输入全部无响应
- CPU 单核占用 15-20%

---

## 🎯 优化建议（按优先级排序）

### Priority 1: KaTeX 公式异步渲染 🔥

**方案 A：使用 Web Worker**
```javascript
// 创建 katex-worker.js
self.onmessage = function(e) {
  const { formula, options } = e.data;
  try {
    const html = katex.renderToString(formula, options);
    self.postMessage({ success: true, html });
  } catch (err) {
    self.postMessage({ success: false, error: err.message });
  }
};

// 主线程
const worker = new Worker('katex-worker.js');
formulas.forEach(f => {
  worker.postMessage({ formula: f.text, options: { displayMode: f.isBlock } });
});
```

**效果**：
- CPU 不再阻塞主线程
- 用户可继续交互
- 公式逐步渲染（渐进式加载）

---

**方案 B：分片 + requestIdleCallback**
```javascript
function processFormulasAsync(rootElement) {
  const formulas = findAllFormulas(rootElement);  // 一次性找到所有公式
  let index = 0;

  function processChunk() {
    const deadline = performance.now() + 16;  // 每帧最多 16ms
    while (index < formulas.length && performance.now() < deadline) {
      renderOneFormula(formulas[index]);
      index++;
    }
    if (index < formulas.length) {
      requestIdleCallback(processChunk);  // 空闲时继续
    }
  }

  requestIdleCallback(processChunk);
}
```

**效果**：
- 利用浏览器空闲时间
- 不阻塞用户交互
- 公式渲染时间分摊到多帧

---

### Priority 2: 移除重复的 segmentInBatches 调用

**问题代码**：
```javascript
// history_detail_show_tab.js

// ❌ Line 1680 - 第一次调用
segmentInBatches(activeContentElement, 10, 50, () => {
  FormulaPostProcessor.processFormulasInElement(activeContentElement);
  // ...
});

// ❌ Line 1749 - 第二次调用（冗余）
segmentInBatches(activeContentElement, 10, 50, () => {
  FormulaPostProcessor.processFormulasInElement(activeContentElement);
  // ...
});
```

**修复**：
```javascript
// ✅ 只保留一次调用
segmentInBatches(activeContentElement, 10, 50, () => {
  FormulaPostProcessor.processFormulasInElement(activeContentElement);
  if (data && data.annotations) {
    window.applyBlockAnnotations(activeContentElement, data.annotations, contentIdentifier);
  }
  window.DockLogic.updateStats(window.data, currentVisibleTabId);
  window.refreshTocList();
  renderingTab = null;
  window.contentReady = true;
});
```

**效果**：
- 减少 50% 的子块分割时间
- 从 1000ms → 500ms

---

### Priority 3: marked.lexer() 异步化

**方案 A：使用 Web Worker**
```javascript
// markdown-worker.js
importScripts('marked.min.js');
self.onmessage = function(e) {
  const tokens = marked.lexer(e.data);
  self.postMessage(tokens);
};

// 主线程
const worker = new Worker('markdown-worker.js');
worker.postMessage(contentText);
worker.onmessage = (e) => {
  const tokens = e.data;
  renderBatch(0, tokens);
};
```

**方案 B：分片解析（如果不使用 Worker）**
```javascript
function lexInChunks(text, chunkSize = 50000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  let allTokens = [];
  function processChunk(index) {
    if (index >= chunks.length) {
      renderBatch(0, allTokens);
      return;
    }
    const tokens = marked.lexer(chunks[index]);
    allTokens = allTokens.concat(tokens);
    setTimeout(() => processChunk(index + 1), 0);
  }
  processChunk(0);
}
```

---

### Priority 4: 分块对比的真·虚拟滚动

**当前实现**：
```javascript
// chunk_compare_optimizer.js:34
// ❌ 仍然渲染所有 DOM，只是用了骨架屏
optimizeChunkComparison(ocrChunks, translatedChunks, options) {
  // 所有分块的 DOM 都创建了，只是分批显示
}
```

**改进方案**：
```javascript
class VirtualChunkRenderer {
  constructor(container, chunks, chunkHeight = 300) {
    this.container = container;
    this.chunks = chunks;
    this.chunkHeight = chunkHeight;
    this.visibleRange = { start: 0, end: 10 };
    this.setupScrollListener();
  }

  setupScrollListener() {
    this.container.addEventListener('scroll', () => {
      const scrollTop = this.container.scrollTop;
      const start = Math.floor(scrollTop / this.chunkHeight);
      const end = start + 10;  // 可见区域 + 缓冲
      if (start !== this.visibleRange.start) {
        this.updateVisibleRange(start, end);
      }
    });
  }

  updateVisibleRange(start, end) {
    // 只渲染可见区域的分块
    this.visibleRange = { start, end };
    this.render();
  }

  render() {
    // 移除不可见的分块 DOM
    // 渲染新进入可见区域的分块
    // 使用 CSS transform 定位
  }
}
```

**效果**：
- 100 块文档只渲染 10-15 块 DOM
- 内存占用减少 80%
- 初始渲染时间从 3000ms → 300ms

---

### Priority 5: 批注系统按需匹配

**当前实现**（推测）：
```javascript
function applyBlockAnnotations(container, annotations, identifier) {
  annotations.forEach(ann => {
    // ❌ 遍历所有段落，查找匹配
    const blocks = container.querySelectorAll('[data-block-index]');
    blocks.forEach(block => {
      if (block.textContent.includes(ann.text)) {
        // 高亮逻辑
      }
    });
  });
}
```

**优化方案**：
```javascript
function applyBlockAnnotationsOptimized(container, annotations, identifier) {
  // 1. 建立 blockIndex -> annotation 的映射
  const annMap = new Map();
  annotations.forEach(ann => {
    if (!annMap.has(ann.blockIndex)) {
      annMap.set(ann.blockIndex, []);
    }
    annMap.get(ann.blockIndex).push(ann);
  });

  // 2. 只处理有批注的段落
  annMap.forEach((anns, blockIndex) => {
    const block = container.querySelector(`[data-block-index="${blockIndex}"]`);
    if (block) {
      applyAnnotationsToBlock(block, anns);
    }
  });
}
```

**效果**：
- 从 O(n × m) → O(m)
- n=500段落, m=50批注：从 25000 次查找 → 50 次

---

## 🧪 快速验证方法

### 1. 确认 KaTeX 是主要瓶颈

在浏览器 Console 运行：
```javascript
// 临时禁用 KaTeX 后处理
FormulaPostProcessor.processFormulasInElement = () => console.log('KaTeX disabled');

// 切换标签页，观察是否还卡顿
```

如果不再卡顿 → **确认 KaTeX 是主因**

---

### 2. 确认 segmentInBatches 重复调用

在 `history_detail_show_tab.js:1680` 添加：
```javascript
console.trace('[DEBUG] segmentInBatches called');
```

查看 Console，如果有 2 个 stack trace → **确认重复调用**

---

### 3. 测量实际耗时

```javascript
// 在 history_detail_show_tab.js 中添加
console.time('Total Render');
console.time('Lexer');
const tokens = marked.lexer(contentText);
console.timeEnd('Lexer');

console.time('Batch Render');
renderBatch(0, () => {
  console.timeEnd('Batch Render');

  console.time('Segmentation');
  segmentInBatches(activeContentElement, 10, 50, () => {
    console.timeEnd('Segmentation');

    console.time('KaTeX');
    FormulaPostProcessor.processFormulasInElement(activeContentElement);
    console.timeEnd('KaTeX');

    console.timeEnd('Total Render');
  });
});
```

---

## 📝 实施计划

### Phase 1 - 快速修复（1-2 小时）
1. ✅ 移除重复的 `segmentInBatches` 调用（立即见效）
2. ✅ 添加性能测量日志（确认瓶颈）

### Phase 2 - 异步公式渲染（半天）
1. 实现 `requestIdleCallback` 版本的 `FormulaPostProcessor`
2. 添加"公式渲染中..."加载指示器
3. 测试长文档性能

### Phase 3 - Worker 优化（1 天）
1. 创建 `katex-worker.js`
2. 修改 `FormulaPostProcessor` 使用 Worker
3. 添加 Worker 降级方案（老浏览器）

### Phase 4 - 虚拟滚动（2 天）
1. 实现 `VirtualChunkRenderer`
2. 替换 `chunk_compare_optimizer.js` 的渲染逻辑
3. 测试大型文档（200+ 分块）

---

## 🎬 总结

**根本原因**：
- ❌ 同步公式渲染（3000ms+ 阻塞）
- ❌ 重复的子块分割（2× 性能损失）
- ❌ 全文档一次性解析（2000ms+ 阻塞）

**预期改善**：
- Phase 1: 减少 50% 卡顿时间（移除重复调用）
- Phase 2: 减少 70% 卡顿时间（异步公式渲染）
- Phase 3+4: 减少 90% 卡顿时间（Worker + 虚拟滚动）

**长文档性能对比**：

| 优化阶段 | 渲染时间 | 主线程阻塞 | 用户体验 |
|---------|---------|-----------|---------|
| **当前** | 7000ms | 6000ms | 页面冻结 6 秒 |
| **Phase 1** | 6000ms | 3000ms | 冻结 3 秒 |
| **Phase 2** | 3000ms | 500ms | 轻微卡顿 |
| **Phase 3** | 2000ms | 200ms | 流畅 ✅ |
