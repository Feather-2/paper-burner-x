# PPT 模块架构文档

> 最后更新: 2024-12-03

## 📁 文件结构概览

```
js/ppt/
├── core/                        # 核心系统
│   ├── slide-system.js          # 统一入口，注册全局对象
│   ├── slide-parser.js          # 幻灯片 HTML 解析器 (15KB)
│   ├── slide-parser-pptx.js     # PPTX 解析器
│   ├── slide-styles.js          # 预定义样式和主题 (20KB)
│   ├── slide-constants.js       # 元素类型与常量
│   └── math-converter.js        # LaTeX → OMML 转换 (13KB)
│
├── renderers/                   # 渲染器
│   ├── slide-renderer-html.js   # HTML 预览渲染 (39KB)
│   ├── slide-renderer-pptx.js   # PPTX 导出渲染核心 (37KB)
│   └── slide-renderer-pptx-freeform.js  # PPTX Freeform 渲染 Mixin (26KB)
│
├── generator/                   # PPT 生成器 (Mixin 架构)
│   ├── ppt_generation.js        # 初始化入口
│   ├── ppt_generator_core.js    # 核心类定义 (5KB)
│   ├── ppt_generator_presentation.js  # 演示界面 UI (48KB)
│   ├── ppt_generator_navigation.js    # 幻灯片导航 (28KB)
│   ├── ppt_generator_workflow.js      # AI 工作流 (16KB)
│   ├── ppt_generator_utilities.js     # 工具函数 (7KB)
│   ├── ppt_generator_deletion.js      # 删除逻辑 (4KB)
│   ├── ppt_generator_editor.js        # 编辑器集成
│   └── export/                  # 导出模块 (按依赖顺序加载)
│       ├── ppt_generator_export_image.js   # 图片处理、Mask烘焙、Canvas截图 (20KB)
│       ├── ppt_generator_export_baking.js  # 特效检测、分层烘焙 (24KB)
│       ├── ppt_generator_export_formats.js # PDF/HTML/图片导出 (18KB)
│       └── ppt_generator_export_core.js    # UI进度、选项、PPTX核心 (15KB)
│
├── dashboard/                   # Dashboard 与可视化
│   ├── ppt_ui_flow_config.js    # UI 流程配置
│   ├── ppt_dashboard_*.js       # 各步骤 UI 模块
│   ├── ppt_generator_agent_dashboard.js   # 兼容加载器
│   ├── deepsearch-flow-visualizer.js      # Flow 可视化
│   ├── report-review-panel.js   # 报告审阅面板
│   ├── vditor_adapter.js        # Vditor 适配器
│   └── ui-event-adapter.js      # UI 事件适配器
│
├── model-config/                # 模型配置模块
│   ├── ppt_model_config_constants.js
│   ├── ppt_model_config_utils.js
│   ├── ppt_model_config_styles.js
│   ├── ppt_model_config_sources.js
│   ├── ppt_model_config_roles.js
│   ├── ppt_model_config_tabs.js
│   ├── ppt_model_config_table.js
│   ├── ppt_model_config_advanced.js
│   ├── ppt_model_config_core.js
│   └── ppt_model_config_modal.js
│
├── design/                      # 设计偏好与阶段配置
│   ├── design-preferences.js
│   └── design-phases-config.js
│
├── storage/                     # 存储
│   ├── ppt_storage.js           # 项目存储 (4KB)
│   └── checkpoint-manager.js    # 检查点管理
│
├── data/                        # 示例数据
│   ├── ppt_generator.sample.js  # 示例数据 (96KB)
│   ├── ppt_landing_sample.js
│   └── ppt_landing_sample_mk.js
│
├── editor/                      # 编辑器子系统
├── workflow/                    # 工作流子系统
├── dsl/                         # DSL 工具
└── vision/                      # 视觉转 DSL
```

---

## 🔄 数据流

```
用户输入/AI生成 HTML
        ↓
   SlideParser.parse()
        ↓
   Slide[] 数据结构
        ↓
   ┌─────────────┬──────────────┐
   ↓             ↓              ↓
HTMLRenderer  PPTXRenderer   Preview
 (预览)        (导出)        (缩略图)
```

---

## 🎯 核心模块详解

### 1. SlideParser (`slide-parser.js`)

将 HTML 字符串解析为结构化的 Slide 数组。

**支持的元素类型:**
- `text` - 文本框（支持 CSS style 属性）
- `image` - 图片（支持遮罩）
- `shape` - 形状（矩形、圆形、椭圆等）
- `icon` - Iconify 图标
- `svg` - 内联 SVG
- `chart` - 图表（bar/line/pie/doughnut）
- `formula` - LaTeX 公式
- `table` - 表格

**关键特性:**
- CSS style 属性优先于 data-* 属性
- 支持 `data-mask` 图片遮罩
- 支持 `data-blend` 混合模式
- 支持 `data-filter` CSS 滤镜

---

### 2. HTMLSlideRenderer (`slide-renderer-html.js`)

渲染 HTML 预览，用于实时展示和缩略图生成。

**图表渲染 (SVG):**
- `renderBarChart()` - 柱状图
- `renderLineChart()` - 折线图
- `renderPieChart()` - 饼图/环形图

**SVG 图表特性:**
- 使用 viewBox 保持响应式
- 所有文字使用 `<text>` 元素（可提取编辑）
- 支持 `text-anchor`: start/middle/end
- Y 轴标签支持 `transform="rotate(-90)"`

---

### 3. PPTXSlideRenderer (`slide-renderer-pptx.js` + `freeform.js`)

导出 PPTX 文件，使用 PptxGenJS 库。

**架构:** Freeform-only（已移除模板渲染）

**公式处理模式:**
| 模式 | 方法 | 特性 |
|------|------|------|
| `unicode` | Unicode 符号 | 兼容性好，不可编辑 |
| `omml` | Office Math ML | 可编辑，可能需修复 |
| `image` | 图片渲染 | 最佳还原，不可编辑 |

**SVG 分层渲染:**
```
SVG 内容
    ↓
_extractSvgTexts()
    ↓
┌───────────────┬────────────────┐
↓               ↓                ↓
图形层        文字层          旋转文字
(PNG图片)    (PPTX文本框)    (考虑transform)
```

**关键调优参数:**
- 字号系数: `fontSize * 0.82` (px→pt 视觉匹配)
- 字符宽度: `fontPt * 0.02` (英寸/字符)
- 基线偏移: `scaledFontSize * 0.85`

---

### 4. 导出系统 (`ppt_generator_export_core.js`)

**导出选项:**
```javascript
exportOptions: {
    formula: 'unicode' | 'omml' | 'image',
    chart: 'native' | 'svg'
}
```

**图表导出模式:**
| 模式 | 说明 |
|------|------|
| `native` | 使用 PPTX 原生图表 API |
| `svg` | 转换为 SVG，文字可编辑 |

**烘焙流程 (`_bakeEffectsForPPTX`):**
1. 检测需要烘焙的特效（blend/filter/mask）
2. 如果 chartMode=svg，调用 `_convertChartsToSvg()`
3. 使用 html2canvas 渲染特效区域
4. 替换为 Base64 图片

---

## 🔧 关键调优点

### SVG 文字提取 (`_extractSvgTexts`)

```javascript
// preserveAspectRatio="xMidYMid meet" 处理
const scale = Math.min(containerW/vbWidth, containerH/vbHeight);
const offsetX = (containerW - vbWidth * scale) / 2;
const offsetY = (containerH - vbHeight * scale) / 2;

// 坐标转换
xPx = offsetX + (x - vbX) * scale;
yPx = offsetY + (y - vbY) * scale;

// Y 轴基线修正
yPx -= scaledFontSize * 0.85;
```

### PPTX 文字框对齐 (`renderFreeformSvgPPTX`)

```javascript
// 根据 text-anchor 调整位置
if (txt.textAnchor === 'middle') {
    finalX = textX - estTextW / 2;
    align = 'center';
} else if (txt.textAnchor === 'end') {
    finalX = textX - estTextW;
    align = 'right';
}
```

---

## 📊 模块依赖关系

```
slide-system.js
    ├── slide-parser.js
    ├── slide-styles.js
    ├── slide-renderer-html.js
    └── slide-renderer-pptx.js
            └── slide-renderer-pptx-freeform.js (Mixin)

ppt_generator_core.js (PPTGenerator 类)
    ├── ppt_generator_presentation.js (Mixin)
    ├── ppt_generator_export_core.js (Mixin entry)
    ├── ppt_generator_navigation.js (Mixin)
    ├── ppt_generator_workflow.js (Mixin)
    ├── ppt_generator_utilities.js (Mixin)
    └── ppt_generator_deletion.js (Mixin)
```

---

## 🎨 CSS 样式文件

```
css/ppt/
├── ppt_generation.css          # 主样式
├── ppt_generation_chat.css     # 聊天界面
├── ppt_generation_components.css  # 组件样式（含导出选项）
├── ppt_generation_presentation.css  # 演示模式
├── ppt_generation_slides.css   # 幻灯片样式
└── ppt_generation_todo.css     # 任务列表
```

---

## 🚀 待优化项

1. **`ppt_generator_export_core.js` 过大 (107KB)**
   - 可拆分：烘焙逻辑、图片处理、PDF 导出

2. **已清理文件：**
- ~~`slide-renderer-pptx-new.js`~~ (已删除)
- ~~`ppt_generator_export_legacy.js`~~ (已删除)

3. **SVG 文字位置精度**
   - 当前使用数学估算，可考虑 Canvas 测量实际宽度
