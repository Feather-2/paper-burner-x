# plan - 计划与结构化规划

运行时计划模型与结构化规划输出的构建、校验与持久化。

> **文件统计**: 3 个 JS 文件，0 个子目录

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块导出入口，汇总 plan-store 与 structured-plan API |
| `plan-store.js` | Plan/PlanStep 模型、生命周期流转、步骤状态更新、保存到 runStore |
| `structured-plan.js` | 结构化计划类型与子项构建、校验规则、Markdown 渲染 |

## 关键概念

- **Plan (schema v0.1)**: `schemaVersion/kind/planId/runId/title/createdAt/updatedAt/steps/selectedStepIndex/lifecycleStatus` 组成的运行计划对象，兼容 `status` 旧字段。
- **PlanStep**: `stepId/title/status/createdAt/updatedAt/meta`，状态来自 `StepStatus`（`core/agent-status`）。
- **生命周期**: `draft → approved → in_progress → completed/failed/cancelled`，通过 `canTransitionPlanLifecycle` 校验。
- **StructuredPlan (schema v1.0)**: `schemaVersion/planId/title/summary/createdAt/requirements/decisions/steps/risks/criticalFiles/meta`。
- **结构化子项构建器**: `createRequirementsAnalysis/createRequirement/createArchitecturalDecision/createPlanStep/createRisk/createCriticalFile` 用于拼装计划子项。
- **计划工件**: `PLAN_ARTIFACT_TYPE = plan.json`，`savePlan` 依赖 `runStore.saveArtifact`。

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

生成结构化计划并输出 Markdown：

```javascript
import { createStructuredPlan, validateStructuredPlan, structuredPlanToMarkdown } from 'js/agents/plugins/plan';

const structured = createStructuredPlan({
  title: 'Implementation Plan',
  steps: [{ title: '实现 API', description: '新增接口与测试' }],
});

const { valid, errors } = validateStructuredPlan(structured);
if (valid) console.log(structuredPlanToMarkdown(structured));
else console.error(errors);
```

使用子项构建器组装结构化计划：

```javascript
import {
  createRequirement,
  createArchitecturalDecision,
  createPlanStep,
  createStructuredPlan,
} from 'js/agents/plugins/plan';

const structured = createStructuredPlan({
  title: 'Implementation Plan',
  requirements: {
    functional: [
      createRequirement({ description: '支持导出结构化计划', priority: 'must_have' }),
    ],
  },
  decisions: [
    createArchitecturalDecision({ title: 'Markdown 输出', decision: '使用 structuredPlanToMarkdown' }),
  ],
  steps: [createPlanStep({ title: '实现 API', description: '补齐校验与测试' })],
});
```
