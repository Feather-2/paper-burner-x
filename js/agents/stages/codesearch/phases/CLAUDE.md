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

- 规划阶段会对 LLM 输出做长度限制与 JSON/schema 校验。
- 为兼容旧模型输出，允许 `title`/`todo` 作为待办文本字段（仍会拒绝未知字段）。

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

- 执行阶段会解析 LLM 决策，并对动作数量、工具名与参数形状做上限/白名单校验。
- 内部包含默认超时与输出长度限制（见 `DEFAULT_*` / `MAX_*` 常量）。

### 工具白名单（执行阶段）

- `glob` / `grep` / `read_file` / `list_dir` / `tree`
- `index_symbols` / `find_symbol`
- `write_file` / `multi_edit`（写入能力，需确保工具层做权限与路径约束）

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

- `buildSystemPrompt()`：构建 codesearch 系统 prompt（包含工具定义与执行约束）
- `formatOpenTodos(todos)` / `isTodoOpen(todo)`：待办过滤与展示
- `buildTodoCompletionStats(todos)`：统计 todo 完成情况
