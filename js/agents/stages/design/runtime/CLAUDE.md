# runtime - 设计运行时（规划/分析/编辑/渲染）

设计阶段的运行时工具集，覆盖规划、阶段编排、编辑与视觉填充。

> **文件统计**: 8 个 JS 文件

## 模块描述
- 为 DesignAgentLoop 提供可复用的运行时能力：规划、阶段执行、视觉渲染、分析与编辑。
- 面向 Reviewer/Edit Agent 共享分析/编辑层，支持截图拼接与风格一致性检查。
- 规划输出支持 review 文本与对话卡片，并可通过 LLM 解析用户反馈。

## 核心文件

| 文件 | 职责 |
|------|------|
| `design-phases.js` | 阶段编排（准备/规划/布局/生成/修复/视觉/评审） |
| `deck-planner.js` | 规划生成与用户反馈解析（review/dialog 格式化、LLM 解析） |
| `design-context.js` | 设计状态上下文（slideIntents/designSystem/输出） |
| `design-blackboard.js` | 黑板：summary/signal/decision/版本管理，支持 MemoryStore/StateEngine |
| `deck-analyzer.js` | DSL 收集、风格一致性分析、元素定位、截图概览 |
| `deck-editor.js` | 元素/页面编辑、批量修复、历史记录 |
| `visual-handler.js` | 设计系统初始化、视觉槽位构建与渲染 |
| `screenshot-stitcher.js` | 跨环境截图拼接与概览生成 |

## 关键概念
- **DeckPackage/DSL**: `deckHtmlDsl + slidesMeta`，通过 `parseSections/joinSections` 切分与合并页面。
- **SlideIntent/Plan**: 每页规划信息（layoutHint/visualIntent/sellingPoint），支持用户反馈修正。
- **Feedback Parsing**: `parseSimpleFeedback/parseFeedbackWithLLM` 将用户反馈转为 edits，配合 `applyUserEdits` 合并。
- **Blackboard**: 设计阶段共享状态（summaries/signals/decisions/versions），可同步 L1/L2。
- **Visual Slots**: 视觉槽位（ai-image/svg/asset），缺少图片能力时可回退为 SVG。
- **Phase Runner**: `runPreparation/Planning/Layout/Generating/BatchRepair/Visual/Review` 统一阶段执行与事件发射。

## 常见任务
- 生成规划并格式化给用户确认：`planDeck()` + `formatPlanForReview()` / `formatPlanForDialog()`。
- 解析用户反馈并应用规划修正：`parseSimpleFeedback()` / `parseFeedbackWithLLM()` + `applyUserEdits()`。
- 分析风格一致性并定位元素：`DeckAnalyzer.analyzeStyleConsistency()` / `locateElement()`。
- 批量修复或直接编辑：`DeckEditor.applyStyleFix()` / `editElement()`，支持 `undo/redo`。
- 拼接截图形成概览：`createDeckOverview()`（需要 browser 或 `canvas`）。
- 在完整流水线中执行阶段：调用 `run*Phase()` 组装设计流程。
