# plan - 计划与结构化规划

运行时计划模型与结构化规划输出的构建、校验、渲染与持久化。

> **文件统计**: 3 个 JS 文件，0 个子目录

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块导出入口，汇总 plan-store 与 structured-plan API |
| `plan-store.js` | Plan/PlanStep 模型、生命周期流转、步骤状态更新、保存到 runStore |
| `structured-plan.js` | 结构化计划类型与子项构建、校验规则、Markdown 渲染 |

## Public API

运行时计划（plan-store）：

- 常量：`PLAN_SCHEMA_VERSION`、`PLAN_ARTIFACT_TYPE`
- 生命周期：`PlanLifecycleStatus`、`isValidPlanLifecycleStatus`、`canTransitionPlanLifecycle`、`setPlanLifecycleStatus`
- 计划与步骤：`createPlan`、`normalizePlanStep`、`findPlanStepIndex`、`setPlanStepStatus`
- 持久化：`savePlan`

结构化规划输出（structured-plan）：

- 常量：`STRUCTURED_PLAN_SCHEMA_VERSION`
- 构建器：`createRequirementsAnalysis`、`createRequirement`、`createArchitecturalDecision`、`createPlanStep`、`createRisk`、`createCriticalFile`
- 组合与校验：`createStructuredPlan`、`validateStructuredPlan`
- 渲染：`structuredPlanToMarkdown`

## 关键概念

- **Plan (schema v0.1)**: `schemaVersion/kind/planId/runId/title/createdAt/updatedAt/steps/selectedStepIndex/lifecycleStatus` 组成的运行计划对象，兼容 `status` 旧字段。
- **PlanStep (runtime)**: `stepId/title/status/createdAt/updatedAt/meta`，其中 `status` 来自 `StepStatus`（`runtime/core/agent-status`）。
- **计划 ID 生成**: `makeSecureTimestampedId('plan')` 生成带 `plan_` 前缀的唯一 ID（用于 `planId` 等）。
- **时间字段标准化**: `toIso()` 将时间输入（字符串/毫秒/Date）标准化为 ISO 8601 字符串，用于 `createdAt/updatedAt`。
- **生命周期**: `draft → approved → in_progress → completed/failed/cancelled`，通过 `canTransitionPlanLifecycle` 校验；`isValidPlanLifecycleStatus` 用于值检查。
- **StructuredPlan (schema v1.0)**: `schemaVersion/planId/title/summary/createdAt/requirements/decisions/steps/risks/criticalFiles/meta`，用于可解析的规划输出。
- **结构化步骤类型**: 结构化规划中的步骤在代码中也命名为 `PlanStep`（schema），字段为 `stepId/title/description/status/dependencies`，与运行时 `PlanStep` 不同；需要在调用层面区分数据结构。
- **结构化子项构建器**: `createRequirementsAnalysis/createRequirement/createArchitecturalDecision/createPlanStep/createRisk/createCriticalFile` 用于拼装结构化子项。
- **计划工件**: `PLAN_ARTIFACT_TYPE = 'plan.json'`，`savePlan` 依赖 `runStore.saveArtifact(runId, type, payload, options)` 持久化。

## 常见任务

创建并规范化计划：

```javascript
import { createPlan } from 'js/agents/plugins/plan';

const plan = createPlan({
  runId: 'run_123',
  title: 'Refactor Pipeline',
  steps: [{ title: '分析现状' }, { title: '调整接口' }],
});
```

更新步骤状态并选中当前步骤：

```javascript
import { setPlanStepStatus } from 'js/agents/plugins/plan';

const next = setPlanStepStatus(plan, 0, 'in_progress');
```

推进生命周期并保存：

```javascript
import { setPlanLifecycleStatus, savePlan } from 'js/agents/plugins/plan';

const inProgress = setPlanLifecycleStatus(plan, 'in_progress');
await savePlan({ runStore, plan: inProgress });
```

生成结构化计划并渲染 Markdown：

```javascript
import {
  createStructuredPlan,
  createRequirementsAnalysis,
  createRequirement,
  createArchitecturalDecision,
  createPlanStep,
  validateStructuredPlan,
  structuredPlanToMarkdown,
} from 'js/agents/plugins/plan';

const requirements = createRequirementsAnalysis({
  functional: [
    createRequirement({
      id: 'req_1',
      type: 'functional',
      description: '支持输出结构化规划 JSON',
      priority: 'must_have',
      acceptanceCriteria: ['validateStructuredPlan 通过', '可渲染为 Markdown'],
    }),
  ],
  nonFunctional: [
    createRequirement({
      id: 'req_2',
      type: 'non_functional',
      description: '输出可在浏览器与 Node 环境运行',
      priority: 'should_have',
    }),
  ],
  assumptions: [],
  clarifications: [],
  outOfScope: [],
});

const structuredPlan = createStructuredPlan({
  planId: plan.planId,
  title: plan.title,
  summary: '把目标拆分为可执行步骤并给出风险与关键文件',
  requirements,
  decisions: [
    createArchitecturalDecision({
      id: 'dec_1',
      title: '输出格式',
      context: '需要人类可读 + 机器可解析',
      decision: '以 JSON schema 作为主存储，并提供 Markdown 渲染',
      rationale: '便于落盘与展示',
      alternatives: [],
      tradeoffs: [],
      consequences: [],
    }),
  ],
  steps: [
    createPlanStep({
      stepId: 'sp_1',
      title: '补充校验',
      description: '为关键字段补充校验与错误提示',
      status: 'pending',
      dependencies: [],
    }),
  ],
});

validateStructuredPlan(structuredPlan);
const md = structuredPlanToMarkdown(structuredPlan);
```
