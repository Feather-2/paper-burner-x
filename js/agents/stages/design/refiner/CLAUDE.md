# refiner (design) - 精调

QA 验证、ReAct 精调与自动修复编排。

## 核心文件

| 文件 | 职责 |
|------|------|
| `qa-validator.js` | `validateSlide` - 质量验证 |
| `react-refiner.js` | `runReactRefiner` - ReAct 精调循环（可选 `systemPromptOverride` / `onStep`） |
| `react-refiner-tools.js` | `createToolExecutor` / `TOOL_SCHEMAS` / `sanitizeHtmlFragment` - 精调工具适配与 HTML 片段清理 |
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

> 注意：`systemPromptOverride` 需要 `react-refiner.js` 显式接入；如不生效，相关上游（如 `runBatchRepair`）将退化为默认 Prompt。

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

默认配置（`design-repair.js`）：
- `maxRetries`: 3
- `maxStepsPerRetry`: 5
- `qualityThreshold`: 6

## 批量修复编排

批量修复以“整套 Deck 一致性”为目标，通常先 `screenshotAll` 获取全局视图，再按轮次修复 QA 问题与风格一致性问题。

```javascript
import { runBatchRepair } from 'js/agents/stages/design/refiner/batch-repair-agent.js';

const result = await runBatchRepair(
  {
    deckPackage,
    qaIssues,
    styleIssues,
    designSystem,
  },
  {
    runContext,
    stageApi,
    aiApiService,
    modelRouter,
  }
);

const { finalDeck, steps, qualityScore, toolCalls, terminationReason } = result;
```

输入约定：
- `qaIssues`: 来自 `qa-validator` 的问题列表（建议先做去重、截断、长度限制）
- `styleIssues`: 来自风格审计/auto-reviewer 的问题列表（建议同上）
- `designSystem`: 设计系统/主题约束（颜色、字体、间距等）

输出约定：
- `steps`: ReAct 过程的结构化步骤（用于回放与审计）
- `toolCalls`: 工具调用记录（用于追踪副作用）
- `terminationReason`: 终止原因（如 hard limit / finish 等）

## 安全与输入

- 来自 UI 或外部的字符串（问题描述、设计系统片段、HTML 片段）必须视为不可信：进入 LLM 之前做长度限制与结构化封装（建议 JSON），进入 DOM 之前必须经 `sanitizeHtmlFragment` 或等价清理。
- 长流程建议透传 `AbortSignal` 并为工具调用设置超时，避免卡死在单次 screenshot/edit 上。
