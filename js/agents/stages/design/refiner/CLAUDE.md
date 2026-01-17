# refiner (design) - 精调

QA 验证、ReAct 精调与自动修复编排。

## 核心文件

| 文件 | 职责 |
|------|------|
| `qa-validator.js` | validateSlide - 质量验证 |
| `react-refiner.js` | runReactRefiner - ReAct 精调循环 |
| `react-refiner-tools.js` | createToolExecutor / TOOL_SCHEMAS - 精调工具适配 |
| `design-repair.js` | runAutomatedRepair / repairSlides / integrateRepairIntoGeneration |
| `batch-repair-agent.js` | runBatchRepair / runSingleSlideRepair - 批量/单页修复 |

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
  }
);
```

## 自动修复（QA 闭环）

```javascript
import { integrateRepairIntoGeneration } from 'js/agents/stages/design/refiner/design-repair.js';

const { slideHtmls, slidesMeta, repaired, repairSummary } =
  await integrateRepairIntoGeneration(slideHtmls, slidesMeta, slideIntents, {
    aiApiService,
    emit,
    signal,
  });
```

## 批量修复编排

```javascript
import { runBatchRepair } from 'js/agents/stages/design/refiner/batch-repair-agent.js';

const result = await runBatchRepair(
  { deckPackage, qaIssues, styleIssues, designSystem },
  { stageApi, runContext, aiApiService, modelRouter }
);
```

## 单页快速修复

```javascript
import { runSingleSlideRepair } from 'js/agents/stages/design/refiner/batch-repair-agent.js';

const fixedHtml = await runSingleSlideRepair(
  { slideIndex, currentHtml, issues, designSystem },
  { aiApiService, modelRouter, signal }
);
```
