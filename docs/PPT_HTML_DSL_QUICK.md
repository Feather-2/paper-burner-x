# PPT HTML DSL 快速指南

> **核心理解**：这不是标准 HTML，而是一套用 HTML 语法描述 PPT 幻灯片的 DSL。

---

## 与普通 HTML 的关键区别

### 1. 只用 `<section>` 和 `<div>`

```html
<!-- 每个 section = 一页幻灯片 -->
<section data-type="freeform" data-bg="#f8fafc">
    <div data-el="text" ...>文字</div>
</section>

<!-- 渐变背景 -->
<section data-type="freeform" data-gradient="linear-gradient(135deg, #0f172a, #1e3a5f)">
    ...
</section>
```

### 2. 绝对定位，百分比坐标

**不用** CSS，**不用** class，**不用** Flexbox/Grid。

所有元素用 `data-x`, `data-y`, `data-w`, `data-h` 定位：

```html
<div data-el="text" data-x="10%" data-y="20%" data-w="80%" data-h="auto">
    内容
</div>
```

### 3. 样式写在 data-* 属性里

```html
<!-- ❌ 不要这样 -->
<div style="font-size: 24px; color: red;">

<!-- ✅ 要这样 -->
<div data-el="text" data-font="24" data-color="#ef4444">
```

---

## 元素类型速查

| `data-el` | 用途 | 关键属性 |
|-----------|------|----------|
| `text` | 文字 | `data-font`, `data-color`, `data-bold`, `data-align`, `data-line-height` |
| `shape` | 形状 | `data-shape`(rect/circle/rounded), `data-fill`, `data-radius` |
| `image` | 图片 | `data-src`, `data-fit`(cover/contain), `data-radius` |
| `icon` | 图标 | `data-icon`(carbon:xxx), `data-size`, `data-color` |
| `line` | 线条 | `data-x1/y1/x2/y2`, `data-stroke`, `data-stroke-width` |
| `card` | 卡片组件 | `data-icon`, `data-title`, `data-subtitle`, `data-layout` |
| `table` | 表格 | `data-data`(JSON二维数组) |
| `chart` | 图表 | `data-chart-type`(line/bar), `data-chart-data` |
| `list` | 列表 | `data-list-type`(ul/ol), `data-items`(JSON数组) |
| `formula` | 公式 | `data-latex` |
| `svg` | 内嵌SVG | 直接写 `<svg>` 子元素 |
| `group` | 分组 | 子元素坐标相对于 group |

---

## 最常用模式

### 文字

```html
<div data-el="text" data-x="5%" data-y="10%" data-w="90%" data-h="auto"
     data-font="24" data-color="#0f172a" data-bold="true" data-line-height="1.5">
    标题文字
</div>
```

**换行**：用 `<br>` 标签
```html
<div data-el="text" ...>第一行<br>第二行</div>
```

**局部强调**：用 `<span>`
```html
<div data-el="text" ...>
    普通文字 <span style="color:#0ea5e9;font-weight:bold">强调</span> 普通
</div>
```

### 形状

```html
<!-- 圆角矩形 -->
<div data-el="shape" data-shape="rounded" 
     data-x="5%" data-y="20%" data-w="40%" data-h="30%"
     data-fill="#ffffff" data-radius="12" data-stroke="#e2e8f0"></div>

<!-- 圆形 -->
<div data-el="shape" data-shape="circle"
     data-x="80%" data-y="10%" data-w="15%" data-h="30%"
     data-fill="#e0f2fe" data-opacity="0.5"></div>
```

### 图片

```html
<div data-el="image" data-x="50%" data-y="15%" data-w="45%" data-h="70%"
     data-src="https://..." data-fit="cover" data-radius="16"></div>
```

### 图标

```html
<div data-el="icon" data-x="10%" data-y="40%" 
     data-icon="carbon:rocket" data-size="32" data-color="#0ea5e9"></div>
```

### 线条

```html
<!-- 实线 -->
<div data-el="line" data-x1="10%" data-y1="50%" data-x2="40%" data-y2="50%"
     data-stroke="#0ea5e9" data-stroke-width="3"></div>

<!-- 虚线 -->
<div data-el="line" data-x1="10%" data-y1="60%" data-x2="90%" data-y2="60%"
     data-stroke="#e2e8f0" data-stroke-width="1" data-stroke-dasharray="5,5"></div>
```

### 分组

```html
<div data-el="group" data-x="10%" data-y="30%" data-w="25%" data-h="50%">
    <!-- 子元素坐标相对于 group -->
    <div data-el="image" data-x="0%" data-y="0%" data-w="100%" data-h="60%" ...></div>
    <div data-el="text" data-x="0%" data-y="70%" data-w="100%" data-h="auto" ...>标题</div>
</div>
```

---

## 常用效果

| 属性 | 值 | 说明 |
|------|-----|------|
| `data-effect` | `shadow-sm/md/lg/xl/2xl` | 阴影 |
| `data-opacity` | `0-1` | 透明度 |
| `data-rotate` | 角度 | 旋转 |
| `data-radius` | px值 | 圆角 |
| `data-filter` | `blur(10px)` | 模糊（会烘焙为图片） |
| `data-blend` | `multiply/screen/overlay` | 混合模式（会烘焙） |
| `data-mask` | `fade-bottom/circle/vignette` | 遮罩（会烘焙） |

---

## 禁止事项

- ❌ `<p>`, `<h1>`, `<span>`（除了 text 内的局部强调）, `<ul>`, `<a>` 等标签
- ❌ `class`, `style` 属性（用 data-* 代替）
- ❌ CSS 变量、动画、伪类
- ❌ Flexbox、Grid 布局
- ❌ group 嵌套

---

## 页面模板

```html
<section data-type="freeform" data-bg="#f8fafc">
    <!-- 头部（占 12% 高度） -->
    <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="100%" data-h="12%" data-fill="#f8fafc"></div>
    <div data-el="shape" data-shape="rect" data-x="0%" data-y="12%" data-w="100%" data-h="1px" data-fill="#e2e8f0"></div>
    <div data-el="shape" data-shape="rect" data-x="5%" data-y="4%" data-w="4px" data-h="4%" data-fill="#0ea5e9"></div>
    <div data-el="text" data-x="6.5%" data-y="2%" data-w="40%" data-h="auto" data-font="24" data-color="#0f172a" data-bold="true">页面标题</div>
    <div data-el="text" data-x="6.5%" data-y="7.5%" data-w="40%" data-h="auto" data-font="12" data-color="#64748b">SUBTITLE</div>
    
    <!-- 内容区从 y=15% 开始 -->
</section>
```

---

## 一句话总结

**用 data-* 属性定义位置和样式，用 data-el 指定元素类型，所有坐标用百分比。**
