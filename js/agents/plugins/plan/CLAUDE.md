# plan - 计划与结构化规划

运行时计划模型与结构化规划输出的构建、校验、渲染与持久化。

> **文件统计**: 3 个 JS 文件，0 个子目录

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块导出入口，汇总 `plan-store` 与 `structured-plan` API |
| `plan-store.js` | Plan/PlanStep 运行时模型、生命周期流转、步骤状态更新、工件持久化 |
| `structured-plan.js` | 结构化规划 schema（v1.0）子项构建器、结构校验、Markdown 渲染 |

## Public API

运行时计划（`plan-store`）：

- 常量：`PLAN_SCHEMA_VERSION`、`PLAN_ARTIFACT_TYPE`
- 生命周期：`PlanLifecycleStatus`、`isValidPlanLifecycleStatus`、`canTransitionPlanLifecycle`、`setPlanLifecycleStatus`
- 计划与步骤：`createPlan`、`normalizePlanStep`、`findPlanStepIndex`、`setPlanStepStatus`
- 持久化：`savePlan`

结构化规划输出（`structured-plan`）：

- 常量：`STRUCTURED_PLAN_SCHEMA_VERSION`
- 构建器：`createRequirementsAnalysis`、`createRequirement`、`createArchitecturalDecision`、`createPlanStep`、`createRisk`、`createCriticalFile`
- 组合与校验：`createStructuredPlan`、`validateStructuredPlan`
- 渲染：`structuredPlanToMarkdown`

## 关键概念

- **Plan (schema v0.1)**：运行时计划对象包含 `schemaVersion/kind/planId/runId/title/createdAt/updatedAt/lifecycleStatus/selectedStepIndex/steps`，并兼容旧字段 `status`。
- **PlanStep (runtime)**：`stepId/title/status/createdAt/updatedAt/meta`；输入兼容旧字段 `text`（作为 `title` 别名）。
- **生命周期流转**：`draft → approved → in_progress → completed|failed|cancelled`；通过 `canTransitionPlanLifecycle` 校验，并由 `setPlanLifecycleStatus` 更新。
- **输入与对象规范化**：`toNonEmptyString` 与 `isPlainObject` 用于字符串与扩展对象校验；`normalizePlanStep` 统一步骤结构并校验 `StepStatus`。
- **ID 与时间标准化**：`makeSecureTimestampedId('plan')` 生成计划 ID；`toIso()` 将时间输入标准化为 ISO 字符串用于 `createdAt/updatedAt`。
- **持久化协议**：`PLAN_ARTIFACT_TYPE = 'plan.json'`；`savePlan` 调用 `runStore.saveArtifact(...)` 保存计划工件，并支持 `plan.toJSON()` 扩展序列化。
- **StructuredPlan (schema v1.0)**：结构化输出包含 `requirements/decisions/steps/risks/criticalFiles/meta`，用于可解析规划与下游渲染。
- **同名类型区分**：`structured-plan` 中的 `PlanStep`（结构化步骤）与 `plan-store` 中的 `PlanStep`（运行时步骤）语义不同，调用层需显式区分。