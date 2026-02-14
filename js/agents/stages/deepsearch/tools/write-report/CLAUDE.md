# write-report - DeepSearch 报告写作工具

用于生成、增量编辑并提交 DeepSearch 研究报告。

## 模块描述

- DeepSearch 阶段的报告写入与提交处理器，支持分阶段写作与最终提交校验。
- 维护 `state.L1.report`（`markdown`、`draftMarkdown`、`sections`、`citations`、`history`、`version`、`submitted`、`validation` 等），并与 `state.L0.sources`（可回溯源文档）协同工作。
- 提供进度提示、重复内容审查、引用原文回溯、发现回顾等辅助能力。
- 写入前执行分析门槛校验：默认阈值由 `handler-helpers.js` 中 `DEFAULT_ANALYSIS_GATES` 提供（quick/wider/deeper），并允许 `state.globalConfig.analysisGates[mode]` 按字段覆盖。

## 核心文件

| 文件 | 说明 |
|------|------|
| `handler.js` | write-report 主处理器：action 分发、门槛校验、报告状态更新与提交 |
| `handler-helpers.js` | 通用辅助：分析门槛读取/校验、report 初始化、历史记录维护 |
| `report-citations.js` | 引用与溯源：`get-source` 原文截取、引用同步（sync） |
| `report-formatting.js` | 报告格式化：大纲构建、章节渲染、内容统计辅助 |
| `report-template.js` | 模板渲染：生成必需章节的报告骨架 |
| `SKILL.md` | 工具能力与使用时机说明 |

## 关键概念

- **动作(action)**：`create` / `direct` / `append` / `section` / `sections` / `update` / `patch` / `fill-section` / `full` / `get-content` / `get-outline` / `get-findings` / `get-source` / `review` / `submit`
- **分析门槛(analysis gates)**：
  - 默认阈值：`quick {minIterations:3,minDocsRead:1,minGaps:0}`，`wider {8,3,2}`，`deeper {15,5,3}`
  - 配置覆盖：`getAnalysisGates(state, mode)` 以默认值为基准，合并 `state.globalConfig.analysisGates[mode]`
  - 校验输出：`checkAnalysisGates(...)` 返回 `passed` / `issues` / `current` / `required`
- **门槛策略**：
  - 写入阶段（`create`/`append`/`update`/...）：返回不足提示但不强制阻断写入
  - 提交阶段（`submit`）：严格校验，不达标拒绝提交
- **发现回顾**：`get-findings` 支持 `type` / `keyword` / `minConfidence` / `limit` 过滤，并返回 blackboard 摘要
- **引用溯源(`get-source`)**：
  - 数据来源优先 `context.sourceManager`，缺失时回退 `state.L0.sources`
  - 未提供 `sourceId` 时返回 `available` 列表（`{sourceId,name,length}`）
  - 提供 `sourceId` 时支持 `start` / `maxLength` 截取（默认 `5000`，上限 `10000`），并返回 `totalLength` / `truncated`
- **引用同步**：写入/更新报告后可调用 `syncReportCitations`，保持 `state.L1.report.citations` 与正文引用标记一致
- **报告质量**：`reportTemplate` 定义必需章节；`prepareReportForSubmit` 与 `getReportProgress` 负责提交校验与进度提示
- **章节填充**：`fill-section` 按 `args.minWords` 或 `state.reportConfig.sectionWordLimits` 校验最小字数
- **变更历史**：`recordHistory` 记录最近 20 次修改并递增版本号

## 状态与事件

- **核心状态**：`state.iteration`、`state.L1.readDocIds`、`state.L1.gaps`、`state.L1.report`
- **事件通知**：`deepsearch.report.generated` / `deepsearch.report.written` / `deepsearch.draft.*` / `deepsearch.section.*`（以 `handler.js` 实际 emit 为准）
- **命名约定**：事件名遵循 `domain:action`，服务名使用 camelCase

## 开发注意事项

- 对 `mode`、`sectionId`、`sourceId` 等输入做显式校验，避免无效值影响门槛与状态更新。
- 提交前保证门槛校验、结构校验、引用校验三者均已执行。
- 保持写入逻辑幂等，避免重复调用导致版本与历史不一致。