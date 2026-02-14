# internal - 设计内部运行时（规划/分析/编辑/渲染）

Design Stage 的内部运行时工具集，覆盖规划、阶段执行、视觉渲染、分析、编辑、回滚与续跑。

> **文件统计**: 21 个 JS 文件（以当前目录快照为准）

## 模块描述
- 为 `DesignAgentLoop` 提供可复用运行时能力：规划、阶段编排、视觉渲染、分析与编辑。
- 面向 Reviewer/Edit Agent 共享分析与编辑层，支持截图拼接与风格一致性检查。
- 规划输出支持 review 文本与对话卡片，并可通过 LLM 解析用户反馈后合并编辑指令。
- 提供状态保存/回滚与断点续跑，支持 watchdog 健康监控与超时保护。
- 提供可配置的分析/编辑软限制（`ANALYZER_CONFIG` / `EDITOR_CONFIG`），用于一致性评估与安全边界控制。

## 核心文件

| 文件 | 职责 |
|------|------|
| `phases/` | 阶段处理器（prepare/plan/layout/generate/fix/visual/review） |
| `design-phases.js` | 阶段处理器兼容导出（转发到 `phases/`） |
| `design-loop-types.js` | `DesignAgentLoop` 的 JSDoc 类型定义 |
| `deck-planner.js` | 规划生成、review/dialog 格式化、用户反馈解析 |
| `design-context.js` | 设计状态上下文（`slideIntents` / `designSystem` / `outputs`） |
| `design-blackboard.js` | 黑板状态：`summary` / `signal` / `decision` / `version` 管理 |
| `state-manager.js` | 状态机、版本快照、回滚与断点续跑 |
| `deck-operations.js` | `VisualHandler` 封装、watchdog 生命周期、deck 更新与状态快照 |
| `tool-handler.js` | 工具注册、恢复模式 tool executor 绑定 |
| `deck-analyzer.js` | DSL 收集、元素定位、风格一致性分析、统计与问题输出 |
| `deck-editor.js` | 元素/页面编辑、批量修复、历史记录与安全过滤 |
| `visual-handler.js` | 设计系统初始化、视觉槽位构建与渲染 |
| `screenshot-stitcher.js` | 跨环境截图拼接与概览图生成 |

## 运行时主链路
1. **准备阶段**：初始化上下文、黑板、工具执行器与 watchdog。
2. **规划阶段**：根据意图生成 `SlidePlan`，并吸收用户反馈生成 edits。
3. **生成阶段**：布局/生成/修复，产出 `DeckPackage` 与中间版本。
4. **视觉阶段**：构建并渲染 `visualSlots`，写入 loop state 以支撑回滚与续跑。
5. **评审阶段**：分析一致性问题、形成 review 结果并驱动后续编辑。

## 关键概念
- **DeckPackage/DSL**: `deckHtmlDsl + slidesMeta`，通过 `parseSections` / `joinSections` 切分与合并页面。
- **SlideDsl**: `{ slideIndex, html, elements }`，`elements` 由 `extractElements` 提取，用于定位与编辑。
- **AnalyzerIssue/AnalyzerStats**: 一致性问题与统计信息（颜色/字体/布局频次）。
- **SlideIntent/SlidePlan**: 每页规划输入输出（`layoutHint` / `visualIntent` / `sellingPoint`）。
- **Blackboard**: 跨阶段共享 `summaries` / `signals` / `decisions` / `versions`。
- **Checkpoint/Backtrack**: `saveVersion` / `backtrackTo` / `resumeDesignAgentLoop` 支持回滚与断点续跑。
- **Watchdog**: 监控长流程阶段，负责超时告警、取消与恢复协作。

## 安全与质量边界
- 编辑链路对文本执行 `escapeHtml`，并对内联样式执行属性白名单与长度限制（降低 XSS/CSS 注入风险）。
- 分析结果用于 UI/日志/持久化时，优先输出可序列化结构，避免直接暴露 `Map` 等内部对象。
- 用户反馈（尤其 LLM 解析结果）进入编辑前应执行结构校验与字段约束，避免脏数据污染状态。
- 长耗时阶段必须绑定 watchdog；异常路径需记录并可回滚，避免半完成状态泄漏。
- 来自 UI 的输入（页数、索引、编辑指令）需做边界检查，避免越界编辑与空对象写入。

## 与上层契约
- 对上游（Agent Loop）暴露：阶段处理器、状态快照、回滚接口、分析与编辑能力。
- 对下游（UI/持久化）输出：可序列化的 plan/review/analyzer/editor 结果。
- 事件命名遵循 `domain:action`，服务命名遵循 camelCase，与微内核约定保持一致。
