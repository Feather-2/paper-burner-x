# Audit History - phases

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] async-error-handling
*Archived: 2026-01-18T21:31:58.852Z*

- **File**: js/agents/stages/codesearch/phases/execution-phase.js:235
- **Description**: runExecutionStep 调用 callModel 未捕获异常，模型请求失败会直接抛出并中断流程，违反 async/await 错误处理要求。
- **Suggestion**: 为 callModel 包裹 try/catch，记录日志并返回可恢复错误（例如 { done: false, error: "model_error" }）。
```
const response = await callModel(messages, {
```

### [RESOLVED] parsing-robustness
*Archived: 2026-01-18T21:31:58.852Z*

- **File**: js/agents/stages/codesearch/phases/execution-phase.js:116
- **Description**: parseStepDecision 的 fallback 分支直接 JSON.parse argsMatch，若片段不是合法 JSON 会抛异常导致步骤崩溃。
- **Suggestion**: 为 argsMatch 解析加 try/catch 并在失败时回退 {}，或使用安全 JSON 解析函数。
```
args: argsMatch ? JSON.parse(argsMatch[1]) : {},
```

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T21:31:58.852Z*

- **File**: js/agents/stages/codesearch/phases/execution-phase.js:198
- **Description**: runExecutionStep 缺少 @typedef/@param/@returns，执行阶段入参/返回值的 JSDoc 类型注解不完整。
- **Suggestion**: 补充 RunExecutionStepArgs/RunExecutionStepResult 的 @typedef，并为函数添加 @param/@returns。
```
export async function runExecutionStep({
```

### [RESOLVED] jsdoc-contract
*Archived: 2026-01-18T21:31:58.852Z*

- **File**: js/agents/stages/codesearch/phases/planning-phase.js:170
- **Description**: CodeSearchStateLike 将 addTodo/addObservation 标记为可选，但实现中直接调用，JSDoc 与真实依赖不一致。
- **Suggestion**: 若为必填，移除 JSDoc 的可选标记；否则在调用处使用可选链或提供默认实现。
```
state.addTodo(normalized);
```

### [RESOLVED] jsdoc-contract
*Archived: 2026-01-18T21:31:58.852Z*

- **File**: js/agents/stages/codesearch/phases/summarizing-phase.js:83
- **Description**: summarizing-phase 将 observations/steps/todos 标记为可选，但代码中直接访问/调用，类型契约不一致且可能引发运行时错误。
- **Suggestion**: 将 observations/steps/todos 标记为必填，或在访问前设置默认值并加 guard。
```
emit?.("codesearch.summarizing.started", { steps: state.steps.length });
```

### [RESOLVED] event-naming
*Archived: 2026-01-18T21:31:58.852Z*

- **File**: js/agents/stages/codesearch/phases/planning-phase.js:127
- **Description**: 事件名使用 dots（codesearch.planning.started 等），不符合 domain:action 约定。
- **Suggestion**: 统一改为 domain:action，例如 codesearch:planning_started / codesearch:step_started / codesearch:summarizing_completed。
```
emit?.("codesearch.planning.started", { query });
```

---

