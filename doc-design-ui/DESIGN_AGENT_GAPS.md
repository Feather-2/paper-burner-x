# Design Agent 断裂点与需求清单

> 生成时间: 2024-12 讨论记录

## 一、流程断裂点

| # | 断裂点 | 当前状态 | 期望状态 |
|---|-------|---------|---------|
| 1 | TextPrep.align | mock（只发日志） | 真实调用，输出 slideIntents |
| 2 | Design.batch | mock（只发日志） | 真实调用 DesignStage |
| 3 | slides 数据来源 | 静态 sampleHTML | AI 动态生成的 HTML DSL |
| 4 | DesignSystem UI | 无展示 | 可视化预览+编辑界面 |
| 5 | 编辑→DSL回写 | 无同步 | documentToHtml() 触发 |
| 6 | 单元素AI微调 | 无工具链 | 元素提取→AI→patch |
| 7 | PPTX输入串接 | 解析有，流程断 | 布局/图片/内容进主流程 |
| 8 | ImageGenerator集成 | 存在但未调用 | 集成到 DesignStage.run() |
| 9 | **Chatbot 接设计 Agent** | mock（返回固定文本） | 接入 IntentParser → Design Agent |

## 二、Design Spec UI 需求

在 DeepSearch/TextPrep 完成后，设计系统需要可视化展示和编辑：

| 项目 | 说明 |
|-----|------|
| 色板展示/编辑 | primary/secondary/bg/text/accent |
| 字体配置 | title/body 字号、fontFamily |
| 密度选择 | 紧凑/平衡/宽松 |
| 风格参考 | 可上传参考图 |
| 批量配置 | 每批 1/2/4 页可选 |
| 模型选择 | Gemini 3 Pro 等 |

## 三、单页生成 Prompt 三要素

给 Gemini 3 Pro 的 prompt 结构：

1. **HTML DSL 规则** (~800 tokens) - 静态语法规范
2. **设计规范** (~300 tokens) - 用户确认的色板/字体/间距
3. **本页内容综述** (~200-500 tokens/页) - slideIntent

## 四、高级视觉效果 Agent 适配

### 已支持的高级能力

| 能力 | DSL 属性 | 说明 |
|-----|---------|------|
| 混合模式 | data-blend | multiply/screen/overlay 等 |
| 不透明度 | data-opacity | 0-1 |
| 边缘遮罩 | data-mask | 渐变/形状遮罩 |
| 滤镜 | data-filter | blur/brightness 等 |
| 圆角 | data-radius | 边缘圆角 |

### Brainstorm 阶段需输出

| 项目 | 说明 |
|-----|------|
| 生图提示词 | 根据页面语境自动生成，包含风格/色调/主体 |
| 图片相对位置 | 全屏背景 / 左侧配图 / 右下装饰 等布局建议 |
| 图片尺寸 | 根据位置推算 w/h 比例和像素需求 |
| 效果组合 | blend + opacity + mask 的推荐搭配 |
| 层叠关系 | z-index 和元素前后关系 |

### 期望的 ImageSlot 输出示例

```json
{
  "imageSlot": {
    "role": "hero_background",
    "position": { "x": "0%", "y": "0%", "w": "100%", "h": "100%" },
    "prompt": "abstract gradient, deep blue to purple, soft bokeh lights, 4k",
    "aspectRatio": "16:9",
    "effects": {
      "blend": "overlay",
      "opacity": 0.6,
      "mask": "linear-gradient(to bottom, black 60%, transparent)"
    },
    "z": 0
  }
}
```

## 五、流程分解 - Agent 职责

每个 agent 职责单一，prompt 简单，上下文要求低：

```
[1] SlideIntent Agent
    输入: 报告段落
    输出: title / keyPoints / visualHint
    难度: ★☆☆

[2] ImagePlanner Agent
    输入: slideIntent + designSystem
    输出: imageSlot (role/position/aspectRatio)
    难度: ★☆☆

[3] PromptBuilder Agent
    输入: imageSlot + 页面语境
    输出: 生图 prompt + 效果建议 (blend/opacity/mask)
    难度: ★☆☆

[4] DSL Generator Agent (Gemini 3 Pro)
    输入: DSL规则 + designSystem + slideIntent
    输出: <section> HTML DSL
    难度: ★★☆

[5] Image Generator
    输入: prompt + size
    输出: 图片
    难度: ★☆☆ (调 API)

[6] QA Validator
    输入: 渲染后的页面
    输出: pass / 问题列表
    难度: ★☆☆
```

## 六、编辑器已有能力（无需重复建设）

| 项目 | 实现位置 |
|-----|---------|
| 区域重绘 | regionSelectAndGenerate() |
| 截图定位 | _captureRegion() |
| 以图生图 | 参考图机制 |
| Intent→Operation | IntentParser + OperationPlanner |
| 图层编辑 | layer-editor/ |

## 七、并发生成过程展示 & 埋点

### 需求

- 设计阶段是**并发**生成多页，不是串行
- UI 需要展示**每页级别**的生成状态
- 需要细粒度的事件埋点支持

### 每页状态

```
pending → generating → completed
                    ↘ failed → retrying
```

### 需要的事件埋点

| 事件 | 时机 | payload |
|-----|------|---------|
| `design.batch.started` | 批次开始 | { batchIndex, slideIndexes } |
| `design.slide.started` | 单页开始 | { slideIndex, slideIntent } |
| `design.slide.progress` | 单页进度 | { slideIndex, step, msg } |
| `design.slide.completed` | 单页完成 | { slideIndex, html, duration } |
| `design.slide.failed` | 单页失败 | { slideIndex, error } |
| `design.slide.retrying` | 单页重试 | { slideIndex, attempt } |
| `design.image.started` | 图片生成开始 | { slideIndex, slotId, prompt } |
| `design.image.completed` | 图片生成完成 | { slideIndex, slotId, url } |
| `design.batch.completed` | 批次完成 | { batchIndex, results } |

### UI 展示形态

```
┌─────────────────────────────────────────┐
│  设计生成中 (4/12 页)                    │
├─────────────────────────────────────────┤
│  [✓] 第1页 - 封面            0.8s       │
│  [✓] 第2页 - 目录            1.2s       │
│  [◐] 第3页 - 市场分析        生成中...  │
│  [◐] 第4页 - 竞品对比        生成中...  │
│  [○] 第5页 - 技术架构        等待       │
│  [○] 第6页 - 实施计划        等待       │
│  ...                                    │
└─────────────────────────────────────────┘
```

并发时多个 [◐] 同时转动，完成后变 [✓]。

## 八、Chatbot → Design Agent 接入

### 当前状态

`handleUserMessage()` 只返回固定文本，没有调用任何 agent。

### 期望流程

```
用户输入 → IntentParser.parse() → Intent
                                    ↓
              ┌─────────────────────┴─────────────────────┐
              ↓                                           ↓
      编辑类 Intent                               生成类 Intent
   (修改/删除/移动元素)                        (重绘/新增/AI微调)
              ↓                                           ↓
    OperationPlanner.plan()                      Design Agent
              ↓                                           ↓
    editor.applyOperations()                   生成新 HTML DSL
              ↓                                           ↓
         即时更新 UI                            更新 slides + 渲染
```

### 支持的交互场景

| 场景 | 示例输入 | 处理方 |
|-----|---------|-------|
| 修改文字 | "把标题改成xxx" | IntentParser → OperationPlanner |
| 删除元素 | "删掉这个图片" | IntentParser → OperationPlanner |
| 重绘页面 | "重新设计第3页" | Design Agent (单页重生成) |
| 风格调整 | "换成深色主题" | Design Agent (更新 DesignSystem) |
| 添加内容 | "加一页关于xxx" | Design Agent (新页生成) |
| 图片生成 | "给这页配一张科技感的图" | ImagePlanner + ImageGenerator |

## 九、设计流程可视化方案

### 产品参考

| 产品 | 可视化方式 | 特点 |
|------|-----------|------|
| Gamma.app | 侧边栏步骤流 + 实时预览 | 每页生成时高亮对应缩略图 |
| Figma AI | 底部进度条 + 骨架屏 | 生成中显示占位框架 |
| Midjourney | 渐进式图像显示 | 从模糊到清晰的过渡 |
| Vercel v0 | 代码流式输出 + 实时预览 | 左代码右渲染同步 |

### 技术方案选型

```
┌─────────────────────────────────────────────────┐
│  当前已有的事件埋点                               │
│  design.batch.started → design.slide.* → ...    │
└─────────────────────────────────────────────────┘
                    ↓ 订阅
┌─────────────────────────────────────────────────┐
│  可视化层选项：                                   │
│  A) 缩略图高亮 - 生成中的页加 loading spinner    │
│  B) 时间线面板 - 类似 Chrome DevTools Network   │
│  C) 流程图 DAG - XState/React Flow 渲染状态机   │
│  D) 终端日志流 - 现有 processLogs 增强样式      │
└─────────────────────────────────────────────────┘
```

### 推荐方案：缩略图联动 + 进度 Badge

基于现有 Dashboard 缩略图列表，监听 `design.slide.*` 事件：

| 事件 | UI 响应 |
|------|---------|
| `design.slide.started` | 对应缩略图加 `.generating` 类（脉冲动画） |
| `design.slide.progress` | 更新进度百分比 badge |
| `design.slide.completed` | 替换缩略图内容，移除动画，显示 ✓ |
| `design.slide.failed` | 红色边框 + 重试按钮 |
| `design.slide.retrying` | 黄色边框 + 重试次数 badge |

### 视觉效果示意

```css
/* 生成中脉冲动画 */
.slide-thumb.generating {
  animation: pulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 0 2px var(--primary);
}

/* 进度 badge */
.slide-thumb .progress-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 10px;
  background: rgba(0,0,0,0.7);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
}

/* 失败状态 */
.slide-thumb.failed {
  border: 2px solid var(--error);
}
```

### 扩展方案（可选）

1. **时间线面板**：类似 DevTools Network，展示每页生成耗时、重试次数、图片下载等
2. **DAG 流程图**：用 React Flow / XState 渲染完整状态机，适合调试复杂流程
3. **骨架屏预览**：生成前显示页面布局骨架，完成后渐变过渡到真实内容

### 实现优先级

1. ★★★ 缩略图脉冲动画（最小改动，直接复用现有 UI）
2. ★★☆ 进度百分比 badge（需要 `design.slide.progress` 提供步骤信息）
3. ★☆☆ 时间线面板（独立组件，可后续迭代）

## 十、参考图风格提取

### 需求背景

用户在设计系统阶段可上传参考图（Dribbble 截图、品牌设计稿、竞品 PPT 等），AI 提取风格词后应用到整个 PPT 生成流程。

### 技术流程

```
用户上传参考图（1-3张）
           ↓
    Gemini Vision / GPT-4V 分析
           ↓
    结构化风格描述 (StyleReference)
    {
      colorTone: "深蓝+金色点缀，科技感",
      mood: "专业、简洁、现代",
      layoutStyle: "大留白、左图右文为主",
      typography: "无衬线、标题加粗、正文轻量",
      effects: "微妙渐变、圆角卡片、轻阴影"
    }
           ↓
    存入 designSystem.styleReference
           ↓
    Brainstorm / DSL Generator 阶段作为 prompt 上下文
```

### 两种用法

| 用法 | 说明 | 存储位置 |
|------|------|---------|
| 全局参考 | 1-3张图定整体风格，影响所有页 | `designSystem.styleReference` |
| 单页参考 | 某页单独指定参考，覆盖全局 | `slideIntent.styleOverride` |

### UI 入口

- Design Spec 面板增加「上传风格参考」区域
- 支持拖拽 / 粘贴截图 / 文件选择
- 上传后显示缩略图 + 提取的风格词
- 风格词可手动微调或追加

### StyleReference 输出示例

```json
{
  "styleReference": {
    "images": ["ref1.png", "ref2.png"],
    "extracted": {
      "colorTone": "深蓝渐变到紫色，科技感强",
      "mood": "专业、未来感、简洁",
      "layoutStyle": "卡片式布局，大标题居中",
      "typography": "无衬线粗体标题，细体正文",
      "effects": "玻璃拟态、微光、圆角16px"
    },
    "userNotes": "参考 Apple 发布会风格"
  }
}
```

### 在 Prompt 中的使用

```
# DSL Generator Prompt 片段

## 风格参考（用户提供）
- 色调：{styleReference.extracted.colorTone}
- 氛围：{styleReference.extracted.mood}
- 布局：{styleReference.extracted.layoutStyle}
- 字体：{styleReference.extracted.typography}
- 效果：{styleReference.extracted.effects}
- 备注：{styleReference.userNotes}

请基于以上风格参考生成本页 HTML DSL...
```

## 十一、关键结论

1. **组件大多存在，关键是流程串起来 + 数据格式对齐**
2. **分解到每个 agent，每步都不难**
3. **Design Spec UI 是用户交互的关键入口，需优先实现**
4. **Gemini 3 Pro 做 DSL 生成，每批 1-4 页可配置**
5. **流程可视化优先用缩略图联动，改动最小，复用现有结构**
6. **参考图风格提取可显著提升设计一致性，推荐作为 Design Spec 的扩展功能**

## 十二、Design Agent 埋点增强路线（后续迭代）

> 当前埋点已覆盖基本生命周期，以下为对标 DeepSearch Agent 的增强方向。

### 现状

| 文件 | 已有事件 |
|------|----------|
| `design-agent.js` | `design.started/ended`, `design.tokens.ended`, `design.image.planning.completed`, `design.qa.ended`, `design.degraded` |
| `batch-generator.js` | `design.batch.started/completed`, `design.slide.started/progress/completed/failed/retrying` |
| `image-generator.js` | `design.image.generate.started/succeeded/failed/skipped`, `design.image.fill.completed` |

### 增强方向

| # | 增强项 | 说明 | 参考 DeepSearch |
|---|--------|------|-----------------|
| 1 | **引入 EmitTap** | 支持通配符监听 `on("*")`，方便 Dashboard 统一订阅所有 design.* 事件 | `index.js:22-54` createEmitTap |
| 2 | **统一 Progress 格式** | 加 `phase`、`progress` 百分比、`detail` 字段，便于进度条渲染 | `gaps.js:53-67` emitGapProgress |
| 3 | **Timeline 持久化** | 在 DeckPackage 中加 `timeline[]` 字段，记录关键事件供回放/调试 | `state.addTimeline()` |
| 4 | **Checkpoint 机制** | 支持中断恢复，对长 PPT（20+ 页）生成有意义 | `index.js:216-232` saveErrorCheckpoint |
| 5 | **Budget 监控** | 扩展 `estimatedCostUSD`，加 `design.budget.warning/exceeded` 事件 | `index.js:184-207` budget 响应机制 |

### 统一 Progress 格式示例

```javascript
// 当前
safeEmit(emit, "design.slide.progress", "progress", { slideIndex, step, msg });

// 增强后
safeEmit(emit, "design.slide.progress", "progress", {
  phase: "slide",           // batch | slide | image
  slideIndex,
  step,                     // llm | fallback | qa
  current: slideIndex + 1,
  total: totalSlides,
  progress: (slideIndex + 1) / totalSlides,  // 0-1
  msg,
  detail: { attempt: 1 }
});
```

### Timeline 持久化示例

```javascript
// DeckPackage 输出增加 timeline 字段
return {
  schemaVersion: "0.1",
  runId,
  designSystem,
  deckHtmlDsl,
  slidesMeta,
  imageSlots,
  imageReport,
  timeline: [  // 新增
    { ts: "...", name: "design.started", status: "started", payload: {...} },
    { ts: "...", name: "design.slide.completed", status: "completed", payload: {...} },
    // ...
  ],
};
```

### 优先级

1. ★★★ 统一 Progress 格式（对 UI 进度条最有价值）
2. ★★☆ Timeline 持久化（调试/回放需要）
3. ★★☆ EmitTap 通配符（Dashboard 统一订阅）
4. ★☆☆ Checkpoint 机制（长 PPT 场景）
5. ★☆☆ Budget 监控（图片成本控制）
