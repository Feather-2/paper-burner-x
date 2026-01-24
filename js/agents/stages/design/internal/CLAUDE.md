# internal - 设计内部运行时（规划/分析/编辑/渲染）

设计阶段的运行时工具集，覆盖规划、阶段编排、编辑与视觉填充。

> **文件统计**: 21 个 JS 文件

## 模块描述
- 为 DesignAgentLoop 提供可复用的运行时能力：规划、阶段执行、视觉渲染、分析与编辑。
- 面向 Reviewer/Edit Agent 共享分析/编辑层，支持截图拼接与风格一致性检查。
- 规划输出支持 review 文本与对话卡片，并可通过 LLM 解析用户反馈。
- 提供状态保存/回滚与断点续跑，支持 watchdog 监控设计流程健康度。
- 提供可配置的分析/编辑软限制（config），用于一致性评估与安全边界控制。

## 核心文件

| 文件 | 职责 |
|------|------|
| `phases/` | 阶段处理器（准备/规划/布局/生成/修复/视觉/评审） |
| `design-phases.js` | 阶段处理器兼容导出（转发至 `phases/`） |
| `design-loop-types.js` | DesignAgentLoop 的 JSDoc 类型定义 |
| `deck-planner.js` | 规划生成与用户反馈解析（review/dialog 格式化、LLM 解析） |
| `design-context.js` | 设计状态上下文（slideIntents/designSystem/输出） |
| `design-blackboard.js` | 黑板：summary/signal/decision/版本管理，支持 MemoryStore/StateEngine |
| `state-manager.js` | 状态机、版本快照、回滚与断点续跑 |
| `deck-operations.js` | VisualHandler 封装、watchdog 管理、deck 更新事件；在渲染时将 `visualSlots` 写入 loop state 以支撑回滚/续跑 |
| `tool-handler.js` | 工具注册与恢复模式的 tool executor |
| `deck-analyzer.js` | DSL 收集、风格一致性分析、元素定位、截图概览；提供 `ANALYZER_CONFIG`（软限制与定位候选数） |
| `deck-editor.js` | 元素/页面编辑、批量修复、历史记录；提供 `EDITOR_CONFIG` 与 HTML/样式安全处理（XSS 规避） |
| `visual-handler.js` | 设计系统初始化、视觉槽位构建与渲染 |
| `screenshot-stitcher.js` | 跨环境截图拼接与概览生成 |

## 关键概念
- **DeckPackage/DSL**: `deckHtmlDsl + slidesMeta`，通过 `parseSections/joinSections` 切分与合并页面。
- **SlideIntent/Plan**: 每页规划信息（layoutHint/visualIntent/sellingPoint），支持用户反馈修正。
- **Feedback Parsing**: `parseSimpleFeedback/parseFeedbackWithLLM` 将用户反馈转为 edits，配合 `applyUserEdits` 合并。
- **Blackboard**: 设计阶段共享状态（summaries/signals/decisions/versions），可同步 L1/L2。
- **Checkpoint/Backtrack**: `saveVersion/backtrackTo` 保存版本并触发回滚，`resumeDesignAgentLoop` 支持断点续跑。
- **Watchdog & Deck Updates**: `initWatchdogManager/createDeckUpdateEmitter` 监控循环健康度并发出 deck 更新事件。
- **Analyzer Config**: `ANALYZER_CONFIG` 定义分析软限制（颜色/字体等）与元素定位候选数量，用于一致性评估与提示生成。
- **Editor Safety**: 编辑侧对用户输入进行 HTML 转义与样式白名单过滤，避免将未信任内容直接注入 DOM。
- **Visual Slots**: 视觉槽位（ai-image/svg/asset），缺少图片能力时可回退为 SVG；渲染阶段会将槽位快照写入 state 以支撑回滚。
- **Phase Runner**: `runPreparation/Planning/Layout/Generating/BatchRepair/Visual/Review` 统一阶段执行与事件发射。

## 常见任务
- 生成规划并格式化给用户确认：`planDeck()` + `formatPlanForReview()` / `formatPlanForDialog()`。
- 解析用户反馈并应用规划修正：`parseSimpleFeedback()` / `parseFeedbackWithLLM()` + `applyUserEdits()`。
- 分析风格一致性并定位元素：`DeckAnalyzer.analyzeStyleConsistency()` / `locateElement()`。
- 触发回滚与断点续跑：`saveVersion()` / `backtrackTo()` / `resumeDesignAgentLoop()`。
- 监控运行健康度与 deck 更新：`initWatchdogManager()` / `createDeckUpdateEmitter()`。
