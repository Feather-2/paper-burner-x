# record-finding - 研究发现记录工具

在 DeepSearch 工具层记录 claims（论点）、gaps（信息缺口）、conflicts（矛盾点），支持批量写入并同步到 SharedContext 供主/子代理共享。

## 核心文件

| 文件 | 职责 |
|------|------|
| `handler.js` | 入口：参数校验与规范化、去重、gap 预算控制、引用格式化、关键词索引与 SharedContext 写入 |

## 类型契约（JSDoc）

| 类型 | 说明 |
|------|------|
| `FindingType` | 发现类型：`claim` / `gap` / `conflict` |
| `FindingPriority` | 优先级：`high` / `medium` / `low` |
| `FindingItem` | 输入项模型（支持单条与批量统一归一化） |
| `Finding` | 持久化后的标准发现结构（含 `id`、`ref`、`createdAt` 等） |
| `SharedContext` | 可选共享上下文接口：`hasSeen` / `markSeen` / `commit` / `search` |
| `RecordFindingContext` | Handler 运行上下文：`state`、可选 `emit`、可选 `sharedContext` |

## 关键概念

- 发现类型：`claim` / `gap` / `conflict`，分别支持 `confidence` / `priority` / `sources` 等字段。
- Priority：`high` / `medium` / `low`（可为空），用于给发现排序或筛选。
- 创建时间：`createdAt` 为毫秒时间戳（number），用于排序/追踪写入顺序。
- 引用格式：根据 `source` + `lineStart`/`lineEnd` 生成 `ref`（如 `[source:Lx-Ly]`），便于可跳转引用。
- 数值规范化：`lineStart`/`lineEnd` 以及预算相关字段会使用 `toNonNegativeInt` 规范化为非负整数，避免负数/NaN 进入索引与统计逻辑。
- 记录 ID：使用 `makeSecureTimestampedId` 生成低碰撞且不可预测的 ID；并写入 `state.L1.findingIds`，按类型追踪本次会话已记录的 finding ID。
- SharedContext：`hasSeen`/`markSeen` 去重，`commit` 写入索引项，`search` 统计各类发现数量。
- Gap 预算：读取 `state.userConfig.gaps`，支持 `maxFindingGaps`/`maxGapFindings`/`maxGaps` 与 `maxNewGapFindingsPerCall`/`maxGapGrowthPerIteration`/`maxNewGapsPerCall`，超限返回 `gap_budget_exceeded`。
- 关键词索引：从内容中抽取关键词并合并标签/类型/来源，便于后续检索。
- 事件上报：`emit("deepsearch.finding.{type}")` 供外部监听。
- 兼容降级：`emit` 与 `sharedContext` 为可选依赖，缺失时应保持主流程可执行。

## 常见任务

- 单条记录：传入 `type`、`content`，可选 `source`、`lineStart`、`lineEnd`、`confidence`、`priority`、`tags`。
- 批量记录：使用 `findings` 数组，一次写入多条并返回 `recorded/skipped/errors`。
- 记录冲突：提供 `sources` 或 `source`，用于标记冲突的多来源引用。
- 控制缺口增长：通过 `userConfig.gaps` 配置 `maxFindingGaps`/`maxGapFindings`/`maxNewGapFindingsPerCall` 等。
- 获取统计：返回 `stats`（claims/gaps/conflicts 数量）辅助监控研究进展。
