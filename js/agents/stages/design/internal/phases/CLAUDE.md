# phases - 设计阶段处理器

设计阶段的编排与执行单元，覆盖准备/规划/布局/生成/修复/视觉填充/评审。每个阶段负责转换状态、发事件，并写回 loop.state 供下游使用。

## 模块描述
- 统一封装设计流程的 7 个阶段，支持 UI 交互确认与黑板记录。
- 通过 runWithPhaseSpan 记录 trace span，emitStage 发出进度事件。
- 生成阶段负责 image slot 规划、QA 校验、降级 fallback，并建立 styleLock 供 edit mode 使用。
- 视觉阶段负责填充视觉资源，支持 deferred visuals 与可选 refine。

## 核心文件

| 文件 | 职责 |
|------|------|
| `preparation-phase.js` | 解析大纲、抽取样式、用户确认风格 |
| `planning-phase.js` | 生成计划、用户确认/编辑规划 |
| `layout-phase.js` | 生成线框布局、用户确认布局 |
| `generating-phase.js` | 生成页面 HTML、QA 校验、降级 fallback、style lock 建立、图片规划 |
| `repair-phase.js` | 聚合 QA + 评审结果，批量编排修复 |
| `visual-phase.js` | 视觉填充与生图，支持 deferred visual 与 refine |
| `review-phase.js` | 全局风格评审与结果汇总 |
| `phase-utils.js` | 共享常量与 trace span 包装 |

## 关键概念
- **Phase Span**: `runWithPhaseSpan` 统一 trace 埋点，并记录 runId/slideCount 等属性。
- **UI 事件**: `emitStage` 发送 `design.*` 事件供 UI 展示阶段进度。
- **Image Planning**: `ImagePlanner.plan` 产出 imageSlots，并估算成本/待生成列表。
- **QA/降级**: `validateSlide` 校验失败时回退到 safe 模板或 title-only 模板。
- **Style Lock**: 生成阶段将 designSystem 的颜色/字体锁定，供 edit mode 校验。

## 常见任务
- 在主流程中依序调用 `runPreparationPhase` -> `runPlanningPhase` -> `runLayoutPhase` -> `runGeneratingPhase` -> `runBatchRepairPhase` -> `runVisualPhase` -> `runReviewPhase`。
- 读取 `loop.state` 中的 `slideHtmls/slidesMeta/imageSlots` 等中间产物供编辑或渲染使用。
- 监听 `design.*` 事件，驱动 UI 交互（确认规划/布局/风格）。