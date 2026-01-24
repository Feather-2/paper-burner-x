# phases - 设计阶段处理器

设计阶段的编排与执行单元，覆盖准备/规划/布局/生成/修复/视觉填充/评审。每个阶段负责转换状态、发事件，并写回 loop.state 供下游使用。

## 模块描述
- 统一封装设计流程的 7 个阶段，支持 UI 交互确认与黑板记录。
- 通过 `runWithPhaseSpan` 记录 trace span，`emitStage` 发出 `design.*` 进度事件。
- 布局阶段会对生成的 `layoutHtml` 做安全校验（白名单 tags/attrs + 长度上限），避免不受信任 HTML 注入渲染链路。
- 生成阶段负责页面 HTML 生成、QA 校验、降级 fallback、style lock 建立与 image planning；当存在 `imagePolicy/imageBudget` 等约束时启用预算/策略相关逻辑（含 slot 成本估算）。
- 生成/布局等长耗时步骤支持取消与超时控制，避免卡死并支持用户中断。

## 核心文件

| 文件 | 职责 |
|------|------|
| `preparation-phase.js` | 解析大纲、抽取样式、用户确认风格 |
| `planning-phase.js` | 生成计划、用户确认/编辑规划 |
| `layout-phase.js` | 生成线框布局、用户确认布局、校验 `layoutHtml` 安全性（白名单 tags/attrs，长度限制） |
| `generating-phase.js` | 生成页面 HTML、QA 校验、降级 fallback、style lock 建立、图片规划（可选预算/策略 + 成本估算）、取消/超时控制 |
| `repair-phase.js` | 聚合 QA + 评审结果，批量编排修复 |
| `visual-phase.js` | 视觉填充与生图，支持 deferred visual 与 refine |
| `review-phase.js` | 全局风格评审与结果汇总 |
| `phase-utils.js` | 共享常量与 trace span 包装 |

## 关键概念
- **Phase Span**: `runWithPhaseSpan` 统一 trace 埋点，并记录 runId/slideCount 等属性。
- **UI 事件**: `emitStage` 发送 `design.*` 事件供 UI 展示阶段进度。
- **Layout HTML Safety**: `isSafeLayoutHtml` 对布局阶段产出的 HTML 做白名单校验（tags/attrs/长度），用于阻断潜在 XSS/注入。
- **Cancellation/Timeout**: 通过 `checkCancelled` 与信号联动（如 `createLinkedSignal`）在长任务中及时中断；生成阶段包含默认 spawn 超时（例如 `DEFAULT_SPAWN_TIMEOUT_MS`）用于防止 hang。
- **Image Planning**: `ImagePlanner.plan` 产出 imageSlots，并估算成本/待生成列表；在存在 `imagePolicy/imageBudget` 时启用预算/策略相关决策。
- **QA/降级**: `validateSlide` 校验失败时回退到 safe 模板或 title-only 模板。
- **Style Lock**: 生成阶段将 designSystem 的颜色/字体锁定，供 edit mode 校验。

## 常见任务
- 在主流程中依序调用 `runPreparationPhase` -> `runPlanningPhase` -> `runLayoutPhase` -> `runGeneratingPhase` -> `runBatchRepairPhase` -> `runVisualPhase` -> `runReviewPhase`。
- 读取 `loop.state` 中的 `slideHtmls/slidesMeta/imageSlots` 等中间产物供编辑或渲染使用。
- 监听 `design.*` 事件，驱动 UI 交互（确认规划/布局/风格）。
- 若渲染布局/生成 HTML 到 DOM，必须确保经过阶段内的安全校验与转义（例如 `escapeHtml`），并在失败时走降级/提示路径。
