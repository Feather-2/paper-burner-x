# history_pdf_compare.js 模块拆分方案

## 文件结构

原文件 (2205行) 拆分为 4 个模块：

```
js/history/
├── pdf-compare-renderer.js      (已创建 - 文本渲染引擎)
├── pdf-compare-segments.js       (待创建 - 分段和懒加载)
├── pdf-compare-ui.js             (待创建 - UI 交互)
└── history_pdf_compare.js        (简化 - 主协调类)
```

## HTML 引用顺序

```html
<!-- 1. 基础依赖 -->
<script src="../../js/utils/text-fitting.js"></script>
<script src="../../js/utils/text-fitting-integration.js"></script>

<!-- 2. PDF 对照视图模块 (按依赖顺序加载) -->
<script src="../../js/history/pdf-compare-renderer.js"></script>
<script src="../../js/history/pdf-compare-segments.js"></script>
<script src="../../js/history/pdf-compare-ui.js"></script>
<script src="../../js/history/history_pdf_compare.js"></script>

<!-- 3. 页面主逻辑 -->
<script src="../../js/history/history_detail_show_tab.js"></script>
```

## 模块职责

### 1. pdf-compare-renderer.js ✅
- 文本渲染引擎
- 白色背景绘制
- 文本自适应算法
- 换行处理
- 暴露: `window.PDFCompareRenderer`

### 2. pdf-compare-segments.js (待创建)
- 分段创建和管理
- 懒加载逻辑
- 可见区域检测
- Canvas 渲染队列
- 暴露: `window.PDFCompareSegments`

### 3. pdf-compare-ui.js (待创建)
- 事件绑定 (点击、滚动)
- 高亮显示
- 滚动同步
- bbox 交互
- 暴露: `window.PDFCompareUI`

### 4. history_pdf_compare.js (简化主类)
- 核心数据管理
- 模块协调
- PDF 初始化
- 全局字号预处理
- 暴露: `window.PDFCompareView`

## 通信方式

各模块通过主类实例通信：

```javascript
class PDFCompareView {
  constructor() {
    // ... 初始化数据 ...

    // 创建子模块实例，传入 this
    this.renderer = new PDFCompareRenderer(this);
    this.segments = new PDFCompareSegments(this);
    this.ui = new PDFCompareUI(this);
  }
}
```

子模块通过 `this.view` 访问主类数据和方法。

## 兼容性

- ✅ 不使用 ES6 模块 (import/export)
- ✅ 通过全局变量通信
- ✅ 浏览器直接可用 (file:// 协议)
- ✅ 保持原有 API 不变
