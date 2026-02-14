# phases - 设计阶段处理器

设计阶段的编排与执行单元，覆盖准备/规划/布局/生成/修复/视觉填充/评审。每个阶段负责转换状态、发事件，并写回 `loop.state` 供下游使用。

## 模块描述
- 统一封装设计流程的 7 个阶段，支持 UI 交互确认与黑板记录。
- 通过 `runWithPhaseSpan` 记录 trace span，`emitStage` 发出 `design.*` 进度事件。
- 布局阶段会对生成的 `layoutHtml` 做安全校验（白名单 tags：`section/div/span/ul/li`；attrs：`class/data-type/data-slide-id/data-placeholder-type`；长度上限 `MAX_LAYOUT_HTML_LENGTH=20000`），避免不受信任 HTML 注入渲染链路。
- 生成阶段负责页面 HTML 生成、QA 校验、降级 fallback、style lock 建立与 image planning；当存在 `imagePolicy` 或 `imageBudget` 约束时启用预算/策略相关逻辑（含 slot 成本估算）。
- 生成阶段通过 `startExecution/finishExecution` 封装 step 执行生命周期，便于埋点、上下文传递与错误归因。
- 生成/布局等长耗时步骤支持取消与超时控制（`checkCancelled` + `createLinkedSignal`），避免卡死并支持用户中断。

## 核心文件

| 文件 | 职责 |
|------|------|
| `preparation-phase.js` | 解析大纲、抽取样式、用户确认风格 |
| `planning-phase.js` | 生成计划、用户确认/编辑规划 |
| `layout-phase.js` | 生成线框布局、用户确认布局、校验 `layoutHtml` 安全性（白名单 tags/attrs，长度限制） |
| `generating-phase.js` | 生成页面 HTML、QA 校验、降级 fallback、style lock 建立、图片规划（可选预算/策略 + 成本估算）、取消/超时控制、step 执行钩子（`startExecution/finishExecution`） |
| `repair-phase.js` | 聚合 QA + 评审结果，批量编排修复 |
| `visual-phase.js` | 视觉填充与生图，支持 deferred visual 与 refine |
| `review-phase.js` | 全局风格评审与结果汇总 |
| `phase-utils.js` | 共享常量、默认配置与 trace span 包装 |
| `index.js` | phases 统一导出入口 |

## 关键概念
- **Phase Span**: `runWithPhaseSpan` 统一 trace 埋点，并记录 `runId/slideCount` 等属性。
- **UI 事件**: `emitStage` 发送 `design.*` 事件供 UI 展示阶段进度。
- **Execution Hooks**: `startExecution/finishExecution` 用于围绕关键 step（如按 slide 生成/QA/降级）封装执行生命周期，统一收集 step context/loopIteration 并在结束时落盘或上报。
- **Layout HTML Safety**: `isSafeLayoutHtml` 对布局阶段产出的 HTML 做白名单校验（tags/attrs/长度 + 禁止 `script/style/iframe/object/embed/link/meta`）。
- **Cancellation/Timeout**: 通过 `checkCancelled` 与信号联动（如 `createLinkedSignal`）在长任务中及时中断；生成阶段包含默认 spawn 超时（`DEFAULT_SPAWN_TIMEOUT_MS = 10 * 60 * 1000`）用于防止 hang。
- **Image Planning**: `ImagePlanner.plan` 产出 `imageSlots`，并按 slot 风格估算成本；仅在 `constraints` 显式包含 `imagePolicy` 或 `imageBudget` 时启用预算/策略分支。
- **QA/降级**: `validateSlide` 校验失败时回退到 safe 模板或 title-only 模板，并对回退文本执行 `escapeHtml`。
- **Style Lock**: 生成阶段将 `designSystem` 的颜色/字体锁定，供 edit mode 校验。

## 常见任务
- 在主流程中依序调用 `runPreparationPhase -> runPlanningPhase -> runLayoutPhase -> runGeneratingPhase -> runBatchRepairPhase -> runVisualPhase -> runReviewPhase`。
- 若要新增阶段，先在 `index.js` 导出，再在主 loop 串联并补齐 `emitStage` 事件。
- 若要增强生成质量，优先在 `generating-phase.js` 的 QA/降级分支扩展，不要绕过 `validateSlide`。
- 若要接入图片预算策略，优先扩展 `constraints.imagePolicy/imageBudget` 与 `estimateSlotCostUSD` 的映射规则。
- 若要调整安全策略，统一修改 `layout-phase.js` 白名单常量，并补充边界测试（空值、超长、恶意标签/属性）。

## 调试建议
- 观察 `design.*` 事件流，确认阶段切换与用户确认点是否一致。
- 结合 phase span 查看单阶段耗时，优先定位生成与视觉填充瓶颈。
- 遇到中断/卡死，先检查取消信号是否联动，再检查 timeout 是否生效。