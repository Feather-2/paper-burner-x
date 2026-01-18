# deepsearch/utils - 深度搜索工具函数

深度搜索阶段的工具函数与适配层，覆盖 stageApi 注入、预算与事件规范、输出清洗、token 成本估算，以及 TODO 归一化处理。

## 核心文件

| 文件 | 职责 |
|------|------|
| `stage-api.js` | stageApi 规范与工厂封装（create/validate/extract/merge/child），复用 shared/utils 的实现 |
| `state-utils.js` | Token 使用量与成本归一化、预算配置合并、模型价格默认值、事件常量、文本清洗与 JSON 提取 |
| `todo-utils.js` | TODO schema、归一化/校验、状态迁移、旧 gap 记录迁移 |

## 关键概念

- StageApi：阶段注入点，包含模型调用、事件、取消信号、外部服务等；通过封装接口保持一致性。
- BudgetConfig：预算上限与预警策略（maxTokens/maxCostUSD/warnAt/action/prices）。
- TokenUsageWithCost：标准化 token 统计（input/output/total）与 estimatedCostUSD。
- ModelPriceEntry / 默认价格表：用于预算估算的 per-1K token 价格配置，可由 userConfig 覆盖。
- EventStatus & EVENT_SCHEMA_VERSION：深度搜索事件状态与版本标识。
- DeepSearchTodo：包含优先级/状态/来源/历史记录的任务实体，可从旧 gap 记录迁移。
- 输出清洗：移除 `<think>` 块与提取可解析 JSON 的片段。

## 常见任务

- 创建与组合 stageApi：`createStageApi`、`mergeStageApis`、`createChildApi`。
- 安全提取服务句柄：`extractServices(stageApi)`。
- 预算与计费归一化：`normalizeBudgetConfig`、`ensureTokenUsage`、`normalizeTokenUsage`。
- 清洗模型输出：`stripThinkingTags`、`extractJsonCandidate`。
- TODO 流程：`createTodo`、`validateTodo`、`transitionTodoStatus`、`migrateGapToTodo`。
