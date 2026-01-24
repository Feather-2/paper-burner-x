# write-report - DeepSearch 报告写作工具

用于生成、增量编辑并提交 DeepSearch 研究报告。

## 模块描述

- DeepSearch 阶段的报告写入与提交处理器，支持分阶段写作与最终提交校验。
- 维护 `state.L1.report`（markdown、draftMarkdown、sections、citations、history、version、submitted、validation 等），并与 `state.L0.sources`（可回溯源文档）协同工作。
- 提供进度提示、重复内容审查、引用原文回溯、发现回顾等辅助能力。
- 写入前执行分析门槛校验：默认阈值由模块内 `DEFAULT_ANALYSIS_GATES` 提供（quick/wider/deeper），并允许被 `state.globalConfig.analysisGates[mode]` 覆盖。

## 核心文件

| 文件 | 说明 |
|------|------|
| `handler.js` | write-report 主处理器：动作分发、门槛校验、报告状态更新 |
| `report-citations.js` | 引用与溯源：`get-source` 原文截取、引用同步（sync） |
| `report-formatting.js` | 报告格式化：大纲构建、章节渲染、内容统计辅助 |
| `report-template.js` | 模板渲染：生成必需章节的报告骨架 |
| `SKILL.md` | 工具能力与使用时机说明 |

## 关键概念

- **动作(action)**：`create`/`direct`/`append`/`section`/`sections`/`update`/`patch`/`fill-section`/`full`/`get-content`/`get-outline`/`get-findings`/`get-source`/`review`/`submit`
- **分析门槛(analysis gates)**：
  - 默认阈值（模块内常量）：`quick {minIterations:3,minDocsRead:1,minGaps:0}`，`wider {8,3,2}`，`deeper {15,5,3}`
  - 覆盖方式：`state.globalConfig.analysisGates[mode]` 以“按字段合并”的方式覆盖默认值
  - 校验信号：通常基于 `state.iteration`、读文档数量、gap 数等；不满足时返回可读的 issues 列表供 UI/上层决策（警告或阻断）
- **前置条件**：待办完成率、发现数量、分析门槛等不足时给出明确提示；`submit` 应强制阻断不达标提交
- **发现回顾**：`get-findings` 支持 `type`/`keyword`/`minConfidence`/`limit` 过滤，并返回 blackboard 摘要
- **引用溯源(get-source)**：
  - 数据来源：优先使用 `context.sourceManager`；否则从 `state.L0.sources` 构建并同步
  - 无 `sourceId`：返回 `available` 列表（`{sourceId,name,length}`）并提示如何选择
  - 有 `sourceId`：支持 `start`/`maxLength` 截取原文（默认 `maxLength=5000`，最大 `10000`），并返回 `totalLength`/`truncated`
- **引用同步**：写入/更新报告后可通过 `syncReportCitations` 让 `state.L1.report.citations` 与引用标记保持一致
- **报告质量**：`reportTemplate` 定义必需章节与学术规范；`prepareReportForSubmit` 与 `getReportProgress` 做校验与进度提示
- **章节填充**：`fill-section` 按 `args.minWords` 或 `state.reportConfig.sectionWordLimits` 校验
- **变更历史**：`recordHistory` 记录最近 20 次修改并递增版本号
- **事件通知**：emit `deepsearch.report.generated`/`deepsearch.report.written`/`deepsearch.draft.*`/`deepsearch.section.*`/`deepsearch.report.submitted`

## 常见任务

- 追加内容：`action=append`，自动更新进度并避免重复追加
- 构建章节框架：`action=sections` + `action=fill-section`
- 更新或修补：`action=update` / `action=patch`
- 读取大纲或全文：`action=get-outline` / `action=get-content`
- 回顾发现与引用：`action=get-findings` / `action=get-source`（可用 `start`/`maxLength` 分段读取原文）
- 自动生成完整报告：`action=full`（基于 claims/evidence/todos/sources）
- 质量审查与提交：`action=review` -> `action=submit`（提交前会做门槛与格式校验）
