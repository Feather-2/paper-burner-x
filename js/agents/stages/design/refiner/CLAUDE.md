# refiner (design) - 精调

QA 验证、ReAct 精调与自动修复编排。

## 核心文件

| 文件 | 职责 |
|------|------|
| `qa-validator.js` | validateSlide - 质量验证 |
| `react-refiner.js` | runReactRefiner - ReAct 精调循环（支持 systemPromptOverride / onStep） |
| `react-refiner-tools.js` | createToolExecutor / TOOL_SCHEMAS / sanitizeHtmlFragment - 精调工具适配与 HTML 片段清理 |
| `design-repair.js` | runAutomatedRepair / repairSlides / integrateRepairIntoGeneration - QA 闭环自动修复（重试/步数/阈值可配置） |
| `batch-repair-agent.js` | runBatchRepair / runSingleSlideRepair - 批量/单页修复（批量感知 Prompt + 风格对齐） |

## QA 验证

```javascript
import { validateSlide } from 'js/agents/stages/design/refiner/qa-validator.js';

const result = validateSlide(slideHtml);

if (!result.pass) {
  console.log('Issues found:', result.issues);
}
```

## ReAct 精调

```javascript
import { runReactRefiner } from 'js/agents/stages/design/refiner/react-refiner.js';
import { createToolExecutor } from 'js/agents/stages/design/refiner/react-refiner-tools.js';

const toolExecutor = createToolExecutor({
  deckPackage,
  contentPackage,
  stageApi,
});

const refined = await runReactRefiner(
  deckPackage,
  { stageApi, runContext },
  {
    toolExecutor,
    mode: 'generation',
    recommendedSteps: 5,
    hardLimit: 15,

    // 可选：覆盖默认 System Prompt（例如批量修复编排时注入“全局视图/分轮次计划”指令）
    systemPromptOverride: undefined,

    // 可选：步骤回调（用于日志、观测、或外部中断）
    onStep: undefined,
  }
);
```

> 注意：`systemPromptOverride` 需由 `react-refiner.js` 显式支持；如不生效请先确认该选项已接入。

## 自动修复（QA 闭环）

```javascript
import { integrateRepairIntoGeneration } from 'js/agents/stages/design/refiner/design-repair.js';

const { slideHtmls, slidesMeta, repaired, repairSummary } =
  await integrateRepairIntoGeneration(slideHtmls, slidesMeta, slideIntents, {
    aiApiService,
    emit,
    signal,

    // 可选：覆盖修复闭环配置
    // maxRetries,
    // maxStepsPerRetry,
    // qualityThreshold,
  });
```

## 批量修复编排

批量修复会以“整套 Deck 一致性”为目标，通常先 `screenshotAll` 获取全局视图，再分轮次修复 QA 问题与风格一致性问题。

```javascript
import { runBatchRepair } from 'js/agents/stages/design/refiner/batch-repair-agent.js';

const result = await runBatchRepair(
  { deckPackage, qaIssues, styleIssues, designSystem },
  { stageApi, runContext, aiApiService, modelRouter }
);

// result: { finalDeck, steps, qualityScore, toolCalls, terminationReason }
```

## HTML 安全清理

Refiner 可能会生成/编辑 HTML 片段。对来自模型输出或工具返回的 HTML，必须在写入/渲染前做清理，避免 XSS。

```javascript
import { sanitizeHtmlFragment } from 'js/agents/stages/design/refiner/react-refiner-tools.js';

const safeHtml = sanitizeHtmlFragment(unsafeHtml);
```

## 单页快速修复

```javascript
import { runSingleSlideRepair } from 'js/agents/stages/design/refiner/batch-repair-agent.js';

const fixedHtml = await runSingleSlideRepair(
  { slideHtml, qaIssues, styleIssues, designSystem },
  { stageApi, runContext, aiApiService, modelRouter }
);
```
