# record-finding - 研究发现记录工具

在 DeepSearch 工具层记录 claims（论点）、gaps（信息缺口）、conflicts（矛盾点），支持批量写入并同步到 SharedContext 供主/子代理共享。

## 核心文件

| 文件 | 职责 |
|------|------|
| `handler.js` | 入口：参数校验、去重、gap 预算控制、引用格式化、关键词索引与 SharedContext 写入 |

## 关键概念

- 发现类型：`claim` / `gap` / `conflict`，分别支持 `confidence` / `priority` / `sources` 等字段。
- 引用格式：根据 `source` + `lineStart`/`lineEnd` 生成 `[source:Lx-Ly]`，便于可跳转引用。
- SharedContext：`hasSeen`/`markSeen` 去重，`commit` 写入索引项，`search` 统计各类发现数量。
- Gap 预算：读取 `state.userConfig.gaps`，支持 `maxFindingGaps`/`maxGapFindings`/`maxGaps` 与 `maxNewGapFindingsPerCall`/`maxGapGrowthPerIteration`/`maxNewGapsPerCall`，超限返回 `gap_budget_exceeded`。
- 关键词索引：从内容中抽取关键词并合并标签/类型/来源，便于后续检索。
- 记录 ID：写入 `state.L1.findingIds`，按类型追踪本次会话已记录的 finding ID。
- 事件上报：`emit("deepsearch.finding.{type}")` 供外部监听。

## 常见任务

- 单条记录：传入 `type`、`content`，可选 `source`、`lineStart`、`lineEnd`、`confidence`、`priority`、`tags`。
- 批量记录：使用 `findings` 数组，一次写入多条并返回 `recorded/skipped/errors`。
- 记录冲突：提供 `sources` 或 `source`，用于标记冲突的多来源引用。
- 控制缺口增长：通过 `userConfig.gaps` 配置 `maxFindingGaps`/`maxGapFindings`/`maxNewGapFindingsPerCall` 等。
- 获取统计：返回 `stats`（claims/gaps/conflicts 数量）辅助监控研究进展。