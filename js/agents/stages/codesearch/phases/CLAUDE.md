# phases (codesearch) - 代码搜索阶段

三阶段代码搜索流程（函数式 API）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 统一导出（runPlanningPhase/runExecutionStep/runSummarizingPhase 等） |
| `planning-phase.js` | 规划阶段：生成初始 Todos + 构建系统 prompt |
| `execution-phase.js` | 执行阶段：解析决策、工具调用循环、更新/新增 Todos |
| `summarizing-phase.js` | 总结阶段 |

## Todo 数据结构（规划/执行共享）

规划阶段会接收并规范化 LLM 输出的 todo 列表；执行阶段会推进 todo 状态，并可在严格上限内追加少量新 todo。

- 字段（LLM 可提供）：
  - `text`：待办文本（必填；允许旧字段 `title`/`todo` 作为兼容输入）
  - `priority`：`low` / `medium` / `high`（可选）
  - `queryHints`：查询提示（可选字符串数组）
  - `expectedEvidence`：预期证据（可选字符串）
- 状态（运行时管理）：`pending` / `completed` / `cancelled`
- 限制（见各 phase 的 `MAX_*` 常量）：todo 数量、文本长度、hint 数量与长度、以及新增 todo 数量等均有上限

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
- 规划阶段会把 todo 规范化为统一结构（包含优先级、查询提示、预期证据等可选字段）。

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

- 执行阶段会解析 LLM 决策，并对动作数量、工具名与参数形状做上限/白名单校验（例如 `MAX_ACTIONS`、`TOOL_ARG_SCHEMA`）。
- 执行阶段会更新 todo 状态（`pending/completed/cancelled`），并允许在严格上限内追加新 todo（例如 `MAX_NEW_TODOS`）。
- 内部包含默认超时与输出长度限制（见 `DEFAULT_*` / `MAX_*` 常量）。
- `watchdogOutput` 用于调试（会对记录内容做截断，避免过长日志）。

### 工具白名单（执行阶段）

- `glob` / `grep` / `read_file` / `list_dir` / `tree`
- `index_symbols` / `find_symbol`
- `write_file` / `multi_edit`（写入能力，必须由工具层强制执行权限与路径约束，避免越权读写）

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
