# phases (codesearch) - 代码搜索阶段

三阶段代码搜索流程（函数式 API）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 统一导出（runPlanningPhase/runExecutionStep/runSummarizingPhase 等） |
| `planning-phase.js` | 规划阶段 |
| `execution-phase.js` | 执行阶段 |
| `summarizing-phase.js` | 总结阶段 |

## 规划阶段

```javascript
import { runPlanningPhase } from 'js/agents/stages/codesearch/phases';

const result = await runPlanningPhase({
  state,
  callModel,
  budgetManager,
  emit,
  signal,
});
// → { success, todos, error }
```

## 执行阶段

```javascript
import { runExecutionStep, buildSystemPrompt } from 'js/agents/stages/codesearch/phases';

const systemPrompt = buildSystemPrompt();
const stepResult = await runExecutionStep({
  state,
  step: 1,
  maxSteps: 6,
  systemPrompt,
  callModel,
  tools,
  budgetManager,
  emit,
  signal,
});
// → { done, reason?, error?, watchdogOutput? }
```

## 总结阶段

```javascript
import { runSummarizingPhase } from 'js/agents/stages/codesearch/phases';

const summaryResult = await runSummarizingPhase({
  state,
  callModel,
  budgetManager,
  emit,
  signal,
});
// → { summary, todoStats, budgetUsage }
```

## 辅助函数

- `buildSystemPrompt()`：构建 codesearch 系统 prompt（包含工具定义）
- `formatOpenTodos(todos)` / `isTodoOpen(todo)`：待办过滤与展示
- `buildTodoCompletionStats(todos)`：统计 todo 完成情况
