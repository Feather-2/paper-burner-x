# deepsearch/utils - 深度搜索工具函数

深度搜索阶段的工具函数与适配层，覆盖 stageApi 注入、预算与事件规范、输出清洗、token 成本估算，以及 TODO 归一化处理。

## 核心文件

| 文件 | 职责 |
|------|------|
| `stage-api.js` | stageApi 规范与工厂封装（create/validate/extract/merge/child），复用 shared/utils 的实现；补充 DeepSearch 侧 JSDoc 类型（StageApi / ModelCallOptions / ModelCallResult / EventPayload 等） |
| `state-utils.js` | Token 使用量与成本归一化、预算配置合并、模型价格默认值、事件常量（EVENT_SCHEMA_VERSION / EventStatus）、文本清洗与 JSON 提取 |
| `todo-utils.js` | TODO schema、归一化/校验、状态迁移、旧 gap 记录迁移 |

## 关键概念

- StageApi：阶段注入点，包含取消信号与检查、事件发射、模型调用与外部服务句柄；常见可选注入包括 `eventBus`、`modelRouter`、`aiApiService`、`localRetriever`、`externalSearchProvider`、`logger`，以及统一工具执行入口 `runTool`（如存在需由上层做 allowlist/隔离）。
- ModelCallOptions / ModelCallResult：模型调用统一参数与返回结构（如 `modelRouter.call()` / `aiApiService.chat()`），用于对齐消息格式与 token usage 归一化入口。
- BudgetConfig：预算上限与预警策略（maxTokens/maxCostUSD/warnAt/action/prices）。
- TokenUsageWithCost：标准化 token 统计（input/output/total）与 estimatedCostUSD。
- ModelPriceEntry / 默认价格表：用于预算估算的 per-1K token 价格配置，可由 userConfig 覆盖（注意合并时需要防 prototype pollution；默认值为 placeholder，仅用于估算）。
- EventStatus & EVENT_SCHEMA_VERSION：深度搜索事件状态与版本标识（`deepsearch.event.v1`；started/progress/completed/failed/warning/info）。
- DeepSearchTodo：包含优先级/状态/来源/历史记录的任务实体，可从旧 gap 记录迁移。
- 输出清洗：移除 `<think>` 块与提取可解析 JSON 的片段。

## 常见任务

- 创建与组合 stageApi：`createStageApi`、`mergeStageApis`、`createChildApi`。
- 安全提取服务句柄：`extractServices(stageApi)`。
- 工具调用（如启用）：`stageApi.runTool(toolName, args)`；建议仅允许受控 toolName，并对 args 做 schema 校验/深拷贝以避免越权与原型污染风险。
- 预算与计费归一化：`normalizeBudgetConfig`、`ensureTokenUsage`、`normalizeTokenUsage`。
- 事件上报：使用 `EVENT_SCHEMA_VERSION` 与 `EventStatus` 统一事件状态与兼容策略。
- 清洗模型输出：`stripThinkingTags`、`extractJsonCandidate`。
- TODO 流程：`createTodo`、`validateTodo`、`transitionTodoStatus`、`migrateGapToTodo`。
