# Design Agent Integration - Development Plan

## Overview
整合 Design Agent 真实流程，替换 mock 逻辑，实现从深度搜索到 HTML DSL 生成、UI 可视化编辑、Chatbot 智能调度的完整 PPT 生成工作流。

## Task Breakdown

### Task 1: Wire Real DesignStage into PPT Workflow
- **ID**: task-1
- **Description**: 替换 ppt_generator_workflow.js 中 line 526 的 mock 逻辑，接入真实 DesignStage.run()，输出动态生成的 HTML DSL 并更新 workflowData.deckPackage、deckHtmlDsl、sampleHTML、slides 四个核心数据字段
- **File Scope**:
  - js/ppt/generator/ppt_generator_workflow.js (line 526 附近，Design.batch mock 替换)
  - js/agents/stages/design/design-stage.js (确保输出符合 workflow 预期格式)
- **Dependencies**: None
- **Test Command**:
  ```bash
  node --test tests/ppt/workflow-paste-text.test.js \
    --experimental-test-coverage \
    --test-coverage-lines=90 \
    --test-coverage-functions=90 \
    --test-coverage-branches=85 \
    --test-coverage-include=js/ppt/generator/ppt_generator_workflow.js
  ```
- **Test Focus**:
  - Design.batch 调用成功返回 slides 数组
  - workflowData.deckHtmlDsl 包含完整 `<section>` DSL
  - workflowData.slides 每项包含 html、slideIntent 字段
  - sampleHTML 被正确更新为首页 HTML
  - 异常场景：DesignStage.run() 失败时降级为 mock 数据

### Task 2: Single-Slide Generator with Concurrency Control
- **ID**: task-2
- **Description**: 在 design-agent.js 实现单页生成逻辑，在 batch-generator.js 添加并发控制（1-4 可配置），发出 design.slide.* / design.batch.* / design.image.* 系列细粒度事件，确保事件 payload 符合 EventBus 规范
- **File Scope**:
  - js/agents/stages/design/design-agent.js (单页 prompt 构建与 Gemini 调用)
  - js/agents/stages/design/batch-generator.js (并发队列、重试逻辑、事件发射)
  - js/agents/stages/design/image-generator.js (集成图片生成，发射 design.image.* 事件)
- **Dependencies**: None
- **Test Command**:
  ```bash
  node --test tests/agents/design.test.js \
    --experimental-test-coverage \
    --test-coverage-lines=90 \
    --test-coverage-functions=90 \
    --test-coverage-branches=85 \
    --test-coverage-include=js/agents/stages/design/**/*.js
  ```
- **Test Focus**:
  - 单页生成器接受 (slideIntent, designSystem, dslRules) 返回完整 HTML
  - 并发限制：配置 batchSize=2 时，最多 2 个 Promise 同时运行
  - 事件发射：design.batch.started → N 个 design.slide.* → design.batch.completed
  - 重试机制：单页失败自动重试 1 次，发射 design.slide.retrying
  - 图片生成：imageSlot 存在时调用 ImageGenerator，发射 design.image.*

### Task 3: Design Spec UI with Preview and Batch Config
- **ID**: task-3
- **Description**: 在 Dashboard 添加 Design Spec 视图，展示 DesignSystem 色板/字体/密度，支持实时预览与编辑，添加批量配置（batch size 1/2/4）和模型选择，同步更新 workflowData.designSystem
- **File Scope**:
  - js/ppt/dashboard/ppt_generator_agent_dashboard.js (新增 DesignSpecView 模块，注册到 renderStageSpecificUI)
  - js/ppt/generator/ppt_generator_workflow.js (确保 designSystem 初始化与更新逻辑)
  - css/ppt/dashboard.css 或新建 css/ppt/design-spec.css (色板/字体预览样式)
- **Dependencies**: task-1 (依赖 workflowData.designSystem 字段已接入 DesignStage)
- **Test Command**:
  ```bash
  node --test tests/ppt/dashboard-design-spec.test.js \
    --experimental-test-coverage \
    --test-coverage-lines=90 \
    --test-coverage-functions=90 \
    --test-coverage-branches=85 \
    --test-coverage-include=js/ppt/dashboard/ppt_generator_agent_dashboard.js
  ```
- **Test Focus**:
  - 色板编辑：修改 primary 色后 workflowData.designSystem.colors.primary 更新
  - 字体配置：切换 titleFont 后预览区域立即刷新
  - 批量配置：选择 batchSize=4 后，workflowData.batchSize 同步更新
  - 模型选择：切换为 Gemini 1.5 Pro 后，designSystem.model 更新
  - UI 渲染：色板预览块正确显示当前颜色值，密度选项高亮当前选中项

### Task 4: Chatbot Intent Dispatch and DSL Sync
- **ID**: task-4
- **Description**: 替换 ppt_generator_utilities.js 的 mock handleUserMessage()，接入 IntentParser 解析用户输入，路由编辑类 intent 到 OperationPlanner，生成类 intent 到 Design Agent；在 ppt_generator_editor.js 所有编辑操作后调用 documentToHtml() 将 DOM 变更同步回 workflowData.deckHtmlDsl
- **File Scope**:
  - js/ppt/generator/ppt_generator_utilities.js (handleUserMessage 真实实现，调用 IntentParser + 路由逻辑)
  - js/ppt/generator/ppt_generator_editor.js (添加 DSL sync hook，documentToHtml() 调用点)
  - js/agents/intent-parser.js (如不存在则新建，参考 docs 中的 IntentParser 定义)
- **Dependencies**: task-1 (依赖 workflowData.deckHtmlDsl 已建立)
- **Test Command**:
  ```bash
  node --test tests/ppt/chatbot-intent.test.js tests/ppt/dsl-sync.test.js \
    --experimental-test-coverage \
    --test-coverage-lines=90 \
    --test-coverage-functions=90 \
    --test-coverage-branches=85 \
    --test-coverage-include=js/ppt/generator/ppt_generator_utilities.js,js/ppt/generator/ppt_generator_editor.js
  ```
- **Test Focus**:
  - Intent 分类："把标题改成 xxx" → edit intent → OperationPlanner
  - Intent 分类："重新设计第3页" → generation intent → Design Agent
  - DSL 同步：编辑器修改文字后，documentToHtml() 返回的 HTML 与 deckHtmlDsl 一致
  - 错误处理：IntentParser 解析失败返回友好提示，不中断流程
  - 并发保护：多个 intent 同时到达时排队执行

### Task 5: Single Element AI Styling and PPTX Import
- **ID**: task-5
- **Description**: 在 property-panel.js 添加"AI 微调"按钮，提取当前元素 → ImagePlanner + PromptBuilder → patch 回 DOM；在 ppt_generator_workflow.js 添加 PPTX 导入逻辑，解析布局/图片/内容后作为 deck 分支进入主流程，更新 workflowData.deckPackage
- **File Scope**:
  - js/ppt/editor/panels/property-panel.js (AI 微调 UI 与元素提取逻辑)
  - js/ppt/generator/ppt_generator_editor.js (applyAIStyling 方法，调用 ImagePlanner)
  - js/ppt/generator/ppt_generator_workflow.js (PPTX 导入入口，调用 pptx-parser → 转为 slideIntents)
  - js/agents/stages/design/image-planner.js (确保可接受单元素输入)
- **Dependencies**: task-4 (依赖 IntentParser + DSL sync 已建立，确保 AI 修改可回写)
- **Test Command**:
  ```bash
  node --test tests/ppt/ai-styling.test.js tests/ppt/pptx-import.test.js \
    --experimental-test-coverage \
    --test-coverage-lines=90 \
    --test-coverage-functions=90 \
    --test-coverage-branches=85 \
    --test-coverage-include=js/ppt/editor/**/*.js,js/ppt/generator/ppt_generator_workflow.js
  ```
- **Test Focus**:
  - AI 微调：选中标题 → 点击"AI 微调" → ImagePlanner 返回样式建议 → DOM 更新
  - 样式应用：blend/opacity/mask 等高级效果正确应用到元素
  - PPTX 导入：上传 .pptx → 解析为 slideIntents → 进入 DesignStage → 生成 HTML DSL
  - 布局保留：PPTX 中的图片位置、文本布局在 DSL 中保留
  - 错误处理：PPTX 解析失败时回退到手动输入流程

## Acceptance Criteria
- [ ] Design.batch 调用真实 DesignStage.run()，输出动态 HTML DSL 替换 sampleHTML
- [ ] 单页生成支持并发（1-4 可配置），发射 design.slide.* 等细粒度事件
- [ ] Design Spec UI 可视化展示并编辑 DesignSystem（色板/字体/密度/批量配置）
- [ ] Chatbot 接入 IntentParser，编辑 intent → OperationPlanner，生成 intent → Design Agent
- [ ] 编辑器所有变更通过 documentToHtml() 同步回 workflowData.deckHtmlDsl
- [ ] Property Panel 支持单元素 AI 微调（ImagePlanner + PromptBuilder → patch）
- [ ] PPTX 导入解析为 slideIntents，作为 deck 分支进入主流程
- [ ] 所有 task 单元测试通过，代码覆盖率 ≥90%（行覆盖、函数覆盖），分支覆盖 ≥85%
- [ ] 事件 payload 格式统一，符合 EventBus 记录规范（包含 slideIndex/timestamp/stage）
- [ ] ImageGenerator 集成到 DesignStage.run()，imageSlot 存在时自动生成图片

## Technical Notes
1. **单一 DSL 来源**：workflowData.deckHtmlDsl 是唯一真实来源，sampleHTML/slides[].html 均由它派生
2. **并发 = 批量**：batchSize 既是 UI 批量配置，也是并发限制数（避免 API 限流）
3. **Intent 路由规则**：
   - 编辑类（修改/删除/移动）→ OperationPlanner.plan() → editor.applyOperations()
   - 生成类（重绘/新增/风格调整）→ Design Agent → 更新 deckHtmlDsl + 重新渲染
4. **事件命名约定**：`design.{scope}.{action}`，scope 可为 batch/slide/image，action 为 started/progress/completed/failed/retrying
5. **PPTX 导入视为首类输入**：与 paste text 同级，解析后直接进入 DeepSearch/TextPrep/Design 流程，不单独处理
6. **图片生成时机**：DesignStage.run() 内部，DSL 生成后检测 imageSlot，异步调用 ImageGenerator，完成后 patch 回 HTML
7. **降级策略**：任何 AI 调用失败（Gemini/ImageGenerator）降级为 mock 数据或跳过，确保流程不中断
8. **DSL 规则**：~800 tokens 静态模板，设计规范 ~300 tokens，单页 slideIntent ~200-500 tokens，总 prompt 控制在 1500 tokens/页以内
