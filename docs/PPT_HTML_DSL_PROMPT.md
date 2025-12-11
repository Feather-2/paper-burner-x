# Paper Burner PPT HTML DSL 参考手册

> 本文档定义了一套用于生成演示文稿的 HTML DSL 语法规范。

---

## 基础结构

```html
<section data-type="freeform" id="slide-1" data-gradient="linear-gradient(135deg, #0F172A 0%, #1e1b4b 100%)">
    <!-- 元素从这里开始 -->
</section>
```

| 属性 | 说明 | 示例 |
|-----|------|------|
| `data-type` | 固定为 `freeform` | `data-type="freeform"` |
| `data-gradient` | 渐变背景 | `linear-gradient(135deg, #020617, #1e1b4b)` |
| `data-bg` | 纯色背景 | `data-bg="#0F172A"` |

---

## 元素类型速查

### 1. 文本 `text`

```html
<div data-el="text" 
     data-x="8%" data-y="20%" data-w="84%" data-h="auto"
     data-font="48" data-color="#F8FAFC" 
     data-bold="true" data-italic="true"
     data-align="center" data-line-height="1.5"
     data-letter-spacing="2">
    标题文字
</div>
```

| 属性 | 类型 | 说明 |
|-----|------|------|
| `data-x`, `data-y` | 百分比 | 位置 |
| `data-w`, `data-h` | 百分比/`auto` | 尺寸 |
| `data-font` | 数字 | 字号(px) |
| `data-color` | 颜色 | 文字颜色 |
| `data-bold` | bool | 粗体 |
| `data-italic` | bool | 斜体 |
| `data-underline` | bool | 下划线 |
| `data-strike` | bool | 删除线 |
| `data-align` | `left`/`center`/`right` | 对齐 |
| `data-valign` | `top`/`middle`/`bottom` | 垂直对齐 |
| `data-line-height` | 数字 | 行高倍数 |
| `data-font-family` | 字符串 | 字体名称 |
| `data-letter-spacing` | 数字 | 字符间距(px) |
| `data-superscript` | bool | 上标 |
| `data-subscript` | bool | 下标 |
| `data-bg-color` | 颜色 | 文字背景色 |

**换行**：使用 `<br>` 标签

---

### 2. 形状 `shape`

```html
<div data-el="shape" data-shape="circle"
     data-x="50%" data-y="50%" data-w="40%" data-h="40%"
     data-fill="#06B6D4" data-opacity="0.5" 
     data-filter="blur(20px)"></div>

<div data-el="shape" data-shape="rounded"
     data-x="10%" data-y="20%" data-w="30%" data-h="40%"
     data-fill="#1e293b" data-radius="16" 
     data-stroke="#334155" data-stroke-width="2"></div>
```

| `data-shape` | 说明 |
|--------------|------|
| `circle` | 圆/椭圆 |
| `rect` | 矩形 |
| `rounded` | 圆角矩形 |

| 属性 | 说明 |
|-----|------|
| `data-fill` | 填充色，支持 `linear-gradient(...)` |
| | ⚠️ 渐变中避免使用 `transparent`，建议用 `rgba(r,g,b,0)` |
| `data-stroke` | 边框色 |
| `data-radius` | 圆角(px) |
| `data-opacity` | 透明度 0-1 |
| `data-filter` | CSS 滤镜如 `blur(60px)` |

---

### 3. 卡片 `card` ⭐

一体化组件，包含 icon + 标题 + 副标题

```html
<div data-el="card" 
     data-x="8%" data-y="70%" data-w="18%" data-h="16%"
     data-layout="vertical"
     data-fill="#0f172a" data-radius="12" data-stroke="#334155"
     data-icon="carbon:chip" data-icon-color="#22d3ee" data-icon-bg="#0f172a" data-icon-size="32"
     data-title="1000+ Qubits" data-title-color="#f8fafc" data-title-size="14"
     data-subtitle="by 2025" data-subtitle-color="#64748b" data-subtitle-size="11"
     data-shadow="true">
</div>
```

| 属性 | 说明 |
|-----|------|
| `data-layout` | `vertical` 竖排 / `horizontal` 横排 |
| `data-icon` | Carbon 图标名，如 `carbon:chip` |
| `data-title` / `data-subtitle` | 标题/副标题文字 |
| `data-shadow` | 是否显示阴影 |

---

### 4. 图标 `icon`

```html
<div data-el="icon" 
     data-x="88%" data-y="92%" 
     data-icon="carbon:logo-github" 
     data-size="24" data-color="#475569"></div>
```

| 属性 | 说明 |
|-----|------|
| `data-x`, `data-y` | 位置（**左上角**，非中心） |
| `data-icon` | Carbon 图标名 |
| `data-size` | 图标尺寸(px) |
| `data-color` | 图标颜色 |

**居中对齐技巧**：icon 的 x 定义的是左边缘位置。要让 icon 与居中文字对齐：
```
x = 50% - (iconSize / 2 / 容器宽度 × 100%)
```

图标库：[Carbon Icons](https://carbondesignsystem.com/guidelines/icons/library/)

---

### 5. 线条 `line`

```html
<div data-el="line" 
     data-x1="8%" data-y1="52%" data-x2="40%" data-y2="52%"
     data-stroke="#22D3EE" data-stroke-width="4"></div>
```

---

### 6. 图片 `image`

```html
<div data-el="image" 
     data-x="10%" data-y="15%" data-w="80%" data-h="70%"
     data-src="https://example.com/image.png"
     data-fit="cover"
     data-radius="12"
     data-rotate="-2"
     data-opacity="0.85"
     data-effect="shadow-xl"
     data-blend="multiply"
     data-mask="fade-bottom"
     data-filter="grayscale(100%)">
</div>
```

| 属性 | 说明 |
|-----|------|
| `data-src` | 图片 URL 或 data URI |
| `data-fit` | `cover`（填满裁切）/ `contain`（完整显示） |
| `data-radius` | 圆角半径(px)，PPTX 导出时会预处理为圆角图片 |
| `data-rotate` | 旋转角度(度) |
| `data-effect` | 阴影效果：`shadow-sm` / `shadow` / `shadow-md` / `shadow-lg` / `shadow-xl` |
| `data-opacity` | 透明度 0-1 |
| `data-blend` | 混合模式：`multiply`, `screen`, `overlay`, `color-dodge`, `difference` |
| `data-mask` | 遮罩效果：`fade-bottom`, `fade-left`, `fade-right`, `circle`, `spotlight`, `vignette` |
| `data-filter` | CSS 滤镜：`blur(10px)`, `grayscale(100%)`, `brightness(1.2)` 等 |
| `data-stroke` | 边框颜色 |

**圆角技巧**：
- 小圆角（8-12px）：卡片内图片
- 中圆角（16-24px）：独立展示图片
- 圆形头像：`data-radius="50"` + 正方形容器（`data-w` = `data-h`）

**导出注意**：带 `blur`/`blend`/`mask` 的图片会自动烘焙为静态图

---

### 7. 表格 `table`

```html
<div data-el="table" 
     data-x="5%" data-y="30%" data-w="90%" data-h="40%"
     data-data='[["列1","列2","列3"],["A","B","C"],["D","E","F"]]'
     data-header-bg="#4f46e5" data-header-color="#ffffff"
     data-row-bg="#1e293b" data-alt-row-bg="#0f172a"
     data-cell-color="#e2e8f0" data-border-color="#334155"
     data-font-size="12" data-radius="8">
</div>
```

**`data-data`**：JSON 二维数组，第一行为表头

---

### 8. 图表 `chart`

```html
<div data-el="chart" 
     data-x="5%" data-y="20%" data-w="50%" data-h="45%"
     data-chart-type="line"
     data-chart-data="2020:0.7,2021:1.4,2022:2.3,2023:3.8"
     data-colors="#06B6D4"
     data-labels="单位(亿)">
</div>
```

| `data-chart-type` | 说明 |
|-------------------|------|
| `line` | 折线图 |
| `bar` | 柱状图 |

**`data-chart-data`** 格式：`标签:值,标签:值,...`

---

### 9. 公式 `formula` (LaTeX)

```html
<div data-el="formula" 
     data-x="10%" data-y="50%" data-w="80%" data-h="10%"
     data-font="24" data-color="#22d3ee"
     data-latex="E = mc^2">
</div>
```

**注意**：LaTeX 中的 `\` 需要转义为 `\\`

---

### 10. SVG `svg`

```html
<div data-el="svg" 
     data-x="5%" data-y="20%" data-w="90%" data-h="60%"
     data-opacity="0.8" data-bg-color="#1e293b" data-radius="12">
    <svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="100" r="50" fill="#22d3ee"/>
        <rect x="200" y="50" width="100" height="100" rx="8" fill="#8b5cf6"/>
        <path d="M400 100 L500 50 L500 150 Z" fill="#f472b6"/>
        <text x="600" y="110" fill="#f8fafc" font-size="14">Label</text>
    </svg>
</div>
```

---

### 11. 分组 `group`

将多个元素组合，子元素坐标相对于 group 容器：

```html
<div data-el="group" data-x="10%" data-y="25%" data-w="80%" data-h="60%">
    <div data-el="icon" data-x="46%" data-y="0%" data-icon="carbon:warning-alt" data-size="64" data-color="#ef4444"></div>
    <div data-el="text" data-x="10%" data-y="45%" data-w="80%" data-h="auto" data-align="center">标题文字</div>
</div>
```

| 属性 | 说明 |
|-----|------|
| `data-x`, `data-y`, `data-w`, `data-h` | group 在幻灯片中的位置和尺寸 |
| 子元素坐标 | 相对于 group 的百分比 |

**注意**：禁止 group 嵌套，group 内只能放基础元素。

**典型用法**：将图片 + 标题 + 描述组成可复用单元

```html
<!-- 图文卡片 group -->
<div data-el="group" data-x="8%" data-y="35%" data-w="26%" data-h="55%">
    <div data-el="image" data-x="0%" data-y="0%" data-w="100%" data-h="70%" 
         data-src="..." data-radius="8" data-fit="cover"></div>
    <div data-el="text" data-x="0%" data-y="75%" data-w="100%" data-h="auto" 
         data-font="20" data-bold="true" data-align="center">标题</div>
    <div data-el="text" data-x="0%" data-y="85%" data-w="100%" data-h="auto" 
         data-font="14" data-color="#64748b" data-align="center">描述文字</div>
</div>
```

---

### 12. 列表 `list`

```html
<div data-el="list" 
     data-x="5%" data-y="30%" data-w="40%" data-h="auto"
     data-list-type="ul"
     data-items='["第一项", "第二项", "第三项"]'
     data-font="16" data-color="#333333"
     data-bullet-color="#4f46e5"
     data-line-height="1.6">
</div>
```

| 属性 | 说明 |
|-----|------|
| `data-list-type` | `ul`（无序）/ `ol`（有序） |
| `data-items` | JSON 数组，如 `'["A", "B", "C"]'` |
| `data-font` | 字号(px) |
| `data-color` | 文字颜色 |
| `data-bullet-color` | 项目符号颜色 |
| `data-line-height` | 行高倍数 |
| `data-indent` | 缩进(px) |

---

## 完整属性参考

### 通用属性（所有元素）

| 属性 | 说明 |
|-----|------|
| `data-x`, `data-y` | 位置（百分比） |
| `data-w`, `data-h` | 尺寸（百分比/`auto`） |
| `data-z` | 层级（数字，越大越靠前） |
| `data-rotate` | 旋转角度（度） |
| `data-opacity` | 透明度（0-1） |
| `data-blend` | 混合模式 |
| `data-filter` | CSS 滤镜 |
| `data-mask` | 遮罩效果 |
| `data-effect` | 预设阴影效果 |

### 阴影效果 `data-effect`

| 值 | 效果 |
|-----|------|
| `shadow-sm` | 小阴影 |
| `shadow` | 普通阴影 |
| `shadow-md` | 中等阴影 |
| `shadow-lg` | 大阴影 |
| `shadow-xl` | 超大阴影 |
| `shadow-2xl` | 最大阴影 |

### 混合模式 `data-blend`

`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`

### 遮罩效果 `data-mask`

| 值 | 效果 |
|-----|------|
| `fade-left` | 左侧淡出 |
| `fade-right` | 右侧淡出 |
| `fade-top` | 顶部淡出 |
| `fade-bottom` | 底部淡出 |
| `fade-center` | 中心发散 |
| `spotlight` | 聚光灯效果 |
| `vignette` | 暗角效果 |
| `fade-edges` | 两侧淡出 |
| `circle` | 圆形裁切 |
| `circle(50%)` | 自定义圆形 |
| `ellipse(50% 40%)` | 椭圆裁切 |
| `polygon(...)` | 多边形裁切 |
| `inset(10%)` | 内边距裁切 |
| `linear-gradient(...)` | 自定义渐变遮罩 |
| `radial-gradient(...)` | 自定义径向遮罩 |

### CSS 滤镜 `data-filter`

| 函数 | 示例 |
|-----|------|
| `blur()` | `blur(10px)` |
| `brightness()` | `brightness(1.2)` |
| `contrast()` | `contrast(1.5)` |
| `grayscale()` | `grayscale(100%)` |
| `sepia()` | `sepia(0.5)` |
| `saturate()` | `saturate(2)` |
| `hue-rotate()` | `hue-rotate(90deg)` |
| `invert()` | `invert(100%)` |
| `drop-shadow()` | `drop-shadow(2px 2px 4px rgba(0,0,0,0.5))` |

可组合使用：`data-filter="blur(5px) brightness(1.1)"`

---

## 不支持的 HTML 功能

本 DSL 不是标准 HTML，以下功能**不受支持**：

### 标签类
- ✗ `<p>`, `<h1>`-`<h6>`, `<span>` 等语义标签
- ✗ `<ul>`, `<ol>`, `<li>` 列表标签
- ✗ `<a>` 链接标签
- ✗ `<video>`, `<audio>` 媒体标签
- ✗ `<iframe>`, `<embed>` 嵌入标签
- ✗ `<form>`, `<input>`, `<button>` 表单标签
- ✗ `<table>` 原生表格（请使用 `data-el="table"`）

### 样式类
- ✗ `class` 属性（不支持引用外部 CSS）
- ✗ `<style>` 标签
- ✗ CSS 变量 `var(--xxx)`
- ✗ `@media`, `@keyframes` 等规则
- ✗ `position: fixed/sticky`
- ✗ CSS Grid 布局
- ✗ Flexbox（内部实现，不可直接使用）
- ✗ `transition`, `animation` 动画
- ✗ `:hover`, `:active` 伪类
- ✗ `::before`, `::after` 伪元素

### 属性类
- ✗ `onclick` 等事件属性
- ✗ `contenteditable`（内部使用）
- ✗ `draggable`

### 文字样式
- ✗ `text-shadow`
- ✗ `text-transform`
- ✗ `word-spacing`
- ✗ 富文本混排（同一文本框内不同样式）

### 图片类
- ✗ `srcset`, `sizes` 响应式图片
- ✗ `<picture>` 标签
- ✗ 本地文件路径（需使用 URL 或 data URI）

---

## PPTX 导出注意事项

| 效果 | 导出行为 |
|-----|---------|
| `blur()` / `blend` / `mask` | 自动烘焙为图片 |
| `gradient` | 原生支持 |
| SVG | 转为 Freeform 形状 |
| LaTeX | 渲染为图片 |

**提示**：将文字元素放在带效果元素**之后**，可保持文字在 PPTX 中可编辑。

---

## 设计规范

### 字号层级

| 用途 | 字号 |
|------|------|
| 大标题 | 48-80px |
| 页面标题 | 24-32px |
| 副标题/英文 | 11-14px |
| 正文 | 14-18px |
| 辅助说明 | 12px |

### 边距规范

| 区域 | 最小值 |
|------|--------|
| 页面左右边距 | ≥ 5% |
| 页面顶部边距 | ≥ 2% |
| 内容区起始 y | ≥ 15% |
| 元素间横向间距 | ≥ 2% |

### 页面头部模板

标准内容页头部（占 12% 高度）：
- 标题 `y=2%`，字号 24px
- 副标题 `y=7.5%`，字号 11-12px
- 装饰条 `x=5%`，`y=4%`，宽 4px，高 4%

---

## 布局注意事项

### 排版四原则 (CRAP)

1. **对比 (Contrast)** - 标题/正文字号差异明显，颜色层次分明
2. **重复 (Repetition)** - 统一的配色、字体、间距，保持风格一致
3. **对齐 (Alignment)** - 元素沿隐形网格线对齐，避免随意摆放
4. **亲密性 (Proximity)** - 相关内容靠近，无关内容拉开距离

### 文字间距规则

**避免文字重叠**：相邻文字元素的 y 坐标间距计算公式：

```
最小间距(%) = 字号(px) × 0.22 + 0.2
```

| 字号 | 最小间距 | 计算 |
|------|----------|------|
| 12px | 2.8% | 12 × 0.22 + 0.2 |
| 16px | 3.7% | 16 × 0.22 + 0.2 |
| 24px | 5.5% | 24 × 0.22 + 0.2 |
| 32px | 7.2% | 32 × 0.22 + 0.2 |
| 48px | 10.8% | 48 × 0.22 + 0.2 |

示例：24px 标题在 `y=2%`，副标题应在 `y ≥ 2% + 5.5% = 7.5%`

---

## 实用技巧

### 统一页面头部

内容页推荐使用统一的头部结构（占 12% 高度）：

```html
<!-- 头部背景 -->
<div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="12%" data-fill="#f8fafc"></div>
<!-- 分隔线 -->
<div data-el="shape" data-shape="rect" data-x="0%" data-y="12%" data-w="100%" data-h="1px" data-fill="#e2e8f0"></div>
<!-- 左侧装饰条 -->
<div data-el="shape" data-shape="rect" data-x="5%" data-y="4%" data-w="4px" data-h="4%" data-fill="#0ea5e9" data-radius="2"></div>
<!-- 主标题 -->
<div data-el="text" data-x="6.5%" data-y="2%" data-w="40%" data-h="auto" data-font="24" data-color="#0f172a" data-bold="true">页面标题</div>
<!-- 英文副标题 -->
<div data-el="text" data-x="6.5%" data-y="7.5%" data-w="40%" data-h="auto" data-font="12" data-color="#64748b" data-letter-spacing="1">ENGLISH SUBTITLE</div>
```

### 文字局部强调

在 `text` 元素内使用 `<span>` 做局部样式：

```html
<div data-el="text" ...>
    普通文字 <span style="color:#0ea5e9;font-weight:bold">强调文字</span> 普通文字
</div>
```

支持的内联样式：`color`, `font-weight`, `font-size`, `border-bottom`（下划线效果）

### 装饰线元素

```html
<!-- 短横线装饰 -->
<div data-el="line" data-x1="8%" data-y1="50%" data-x2="15%" data-y2="50%" 
     data-stroke="#0ea5e9" data-stroke-width="4"></div>

<!-- 虚线分隔 -->
<div data-el="line" data-x1="10%" data-y1="50%" data-x2="90%" data-y2="50%" 
     data-stroke="#e2e8f0" data-stroke-width="1" data-stroke-dasharray="5,5"></div>

<!-- 用 shape 做细分隔线 -->
<div data-el="shape" data-shape="rect" data-x="45%" data-y="52%" 
     data-w="10%" data-h="4px" data-fill="#0ea5e9" data-radius="2"></div>
```

### SVG 内嵌图表

用 `svg` 元素绘制自定义图表，可定义渐变和阴影：

```html
<div data-el="svg" data-x="5%" data-y="20%" data-w="40%" data-h="50%">
    <svg viewBox="0 0 400 250">
        <defs>
            <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.1"/></filter>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#0ea5e9"/>
                <stop offset="100%" style="stop-color:#0284c7"/>
            </linearGradient>
        </defs>
        <!-- 网格线 -->
        <line x1="40" y1="200" x2="360" y2="200" stroke="#e2e8f0" stroke-width="1"/>
        <!-- 折线 -->
        <polyline points="60,180 135,150 210,120 285,90" fill="none" stroke="url(#grad)" stroke-width="2"/>
        <!-- 数据点 -->
        <circle cx="60" cy="180" r="4" fill="#fff" stroke="#0ea5e9" stroke-width="2"/>
        <!-- 标签 -->
        <text x="60" y="220" text-anchor="middle" font-size="10" fill="#64748b">2020</text>
    </svg>
</div>
```

### 卡片式布局

用 `shape` + 内容元素组合成卡片：

```html
<!-- 卡片容器 -->
<div data-el="shape" data-shape="rounded" data-x="5%" data-y="20%" data-w="40%" data-h="60%" 
     data-fill="#ffffff" data-stroke="#e2e8f0" data-radius="12" data-effect="shadow-md"></div>
<!-- 顶部彩色装饰条 -->
<div data-el="shape" data-shape="rect" data-x="5%" data-y="20%" data-w="40%" data-h="3px" 
     data-fill="#0ea5e9" data-radius="12 12 0 0"></div>
<!-- 卡片内容 -->
<div data-el="text" data-x="7%" data-y="25%" ...>标题</div>
```

---

## 技术约束

1. **坐标使用百分比** - 确保响应式布局
2. **字号使用像素值** - 有效范围 8-120
3. **颜色使用 HEX 格式** - 如 `#FFFFFF`，也支持 `rgba()`
4. **图层顺序由声明顺序决定** - 后声明的元素显示在上层，或使用 `data-z` 显式指定
5. **每页元素建议不超过 30 个** - 避免渲染性能问题
6. **带 `blur/blend/mask` 的元素导出时会烘焙为图片** - 其上层文字需放在效果元素之后声明以保持可编辑
7. **文本换行使用 `<br>` 标签** - 不支持其他换行方式
8. **图片使用 URL 或 data URI** - 不支持本地文件路径
9. **禁止 group 嵌套** - group 内只能放基础元素，不能嵌套 group
