# refiner (design) - 精调

QA 验证、ReAct 精调、自动修复与批量编排修复。

## 核心文件

| 文件 | 职责 |
|------|------|
| `qa-validator.js` | `validateSlide` - 质量验证 |
| `react-refiner.js` | `runReactRefiner` - ReAct 精调循环（支持 `systemPromptOverride` / `onStep`） |
| `react-refiner-tools.js` | `createToolExecutor` / `TOOL_SCHEMAS` / `sanitizeHtmlFragment` - 工具适配与 HTML 片段清理 |
| `design-repair.js` | `runAutomatedRepair` / `repairSlides` / `integrateRepairIntoGeneration` - QA 闭环自动修复（重试/步数/阈值可配置） |
| `batch-repair-agent.js` | `runBatchRepair` / `runSingleSlideRepair` - 批量/单页修复（先全局视图，再分轮次修复 QA 与风格一致性） |

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

const toolExecutor = createToolExecutor({ deckPackage, contentPackage, stageApi });

const refined = await runReactRefiner(
  deckPackage,
  { stageApi, runContext },
  {
    toolExecutor,
    mode: 'generation',
    recommendedSteps: 5,
    hardLimit: 15,
    systemPromptOverride: undefined,
    onStep: undefined,
  }
);
```

> 注意：`systemPromptOverride` 需要 `react-refiner.js` 显式接入；如不生效，上游（如 `runBatchRepair`）会退化为默认 Prompt。

## 批量编排修复

```javascript
import { runBatchRepair } from 'js/agents/stages/design/refiner/batch-repair-agent.js';

const result = await runBatchRepair(
  { deckPackage, qaIssues, styleIssues, designSystem },
  { stageApi, runContext, aiApiService, modelRouter }
);

const { finalDeck, steps, qualityScore, toolCalls, terminationReason } = result;
```

批量修复策略：
- 先用 `screenshotAll` 建立全局视图
- 按轮次修复（风格一致性优先）
- 每轮后截图复核，最终再 `finish`

## 自动修复（QA 闭环）

```javascript
import { integrateRepairIntoGeneration } from 'js/agents/stages/design/refiner/design-repair.js';

const { slideHtmls, slidesMeta, repaired, repairSummary } =
  await integrateRepairIntoGeneration(slideHtmls, slidesMeta, slideIntents, {
    aiApiService,
    emit,
    signal,
    // maxRetries,
    // maxStepsPerRetry,
    // qualityThreshold,
  });
```

默认配置（`design-repair.js`）：
- `maxRetries`: 3
- `maxStepsPerRetry`: 5
- `qualityThreshold`: 6

默认配置（`batch-repair-agent.js`）：
- `mode`: `'edit'`
- `recommendedSteps`: 8
- `hardLimit`: 20

## 约束与建议

- 模型产出的 HTML 在落盘/渲染前应统一走 `sanitizeHtmlFragment`
- 长任务建议透传 `AbortSignal` 并增加超时上限
- UI 入参（`qaIssues`、`styleIssues`、`designSystem`）应先做结构化校验
