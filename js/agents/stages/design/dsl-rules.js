// Auto-extracted from docs/PPT_HTML_DSL_QUICK.md
// This provides the DSL specification for AI slide generation.

export const DSL_RULES = `
# PPT HTML DSL 规范

核心理解：这不是标准 HTML，而是一套用 HTML 语法描述 PPT 幻灯片的 DSL。

## 关键规则

### 1. 只用 <section> 和 <div>
- 每个 section = 一页幻灯片
- section 必须有 data-type="freeform"
- 背景用 data-bg="#色值" 或 data-gradient="linear-gradient(...)"

### 2. 绝对定位，百分比坐标
- 不用 CSS，不用 class，不用 Flexbox/Grid
- 所有元素用 data-x, data-y, data-w, data-h 定位（0-100%）

### 3. 样式写在 data-* 属性里
错误：<div style="font-size: 24px; color: red;">
正确：<div data-el="text" data-font="24" data-color="#ef4444">

## 元素类型

| data-el | 用途 | 关键属性 |
|---------|------|----------|
| text | 文字 | data-font, data-color, data-bold, data-align, data-line-height |
| shape | 形状 | data-shape(rect/circle/rounded), data-fill, data-radius |
| image | 图片 | data-src, data-fit(cover/contain), data-radius |
| icon | 图标 | data-icon(carbon:xxx), data-size, data-color |
| line | 线条 | data-x1/y1/x2/y2, data-stroke, data-stroke-width |
| card | 卡片 | data-icon, data-title, data-subtitle, data-layout |
| table | 表格 | data-data(JSON二维数组) |
| list | 列表 | data-list-type(ul/ol), data-items(JSON数组) |

## 示例

### 文字
<div data-el="text" data-x="5%" data-y="10%" data-w="90%" data-h="auto"
     data-font="24" data-color="#0f172a" data-bold="true" data-line-height="1.5">
    标题文字
</div>

换行用 <br>，局部强调用 <span style="color:#0ea5e9;font-weight:bold">

### 形状
<div data-el="shape" data-shape="rounded"
     data-x="5%" data-y="20%" data-w="40%" data-h="30%"
     data-fill="#ffffff" data-radius="12" data-stroke="#e2e8f0"></div>

### 图标
<div data-el="icon" data-x="10%" data-y="40%"
     data-icon="carbon:rocket" data-size="32" data-color="#0ea5e9"></div>

### 线条
<div data-el="line" data-x1="10%" data-y1="50%" data-x2="40%" data-y2="50%"
     data-stroke="#0ea5e9" data-stroke-width="3"></div>

## 常用效果属性
- data-effect: shadow-sm/md/lg/xl/2xl
- data-opacity: 0-1
- data-rotate: 角度
- data-radius: px值

## 禁止
- ❌ <p>, <h1>, <span>(text内除外), <ul>, <a> 等标签
- ❌ class, style 属性（用 data-* 代替）
- ❌ CSS 变量、动画、伪类
- ❌ Flexbox、Grid 布局
- ❌ group 嵌套

## 页面模板
<section data-type="freeform" data-bg="#f8fafc">
    <!-- 头部装饰 -->
    <div data-el="shape" data-shape="rect" data-x="5%" data-y="4%" data-w="4px" data-h="4%" data-fill="#0ea5e9"></div>
    <div data-el="text" data-x="6.5%" data-y="2%" data-w="40%" data-h="auto" data-font="24" data-color="#0f172a" data-bold="true">页面标题</div>
    <!-- 内容区从 y=15% 开始 -->
</section>

一句话总结：用 data-* 属性定义位置和样式，用 data-el 指定元素类型，所有坐标用百分比。
`.trim();
