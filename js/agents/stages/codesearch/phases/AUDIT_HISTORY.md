# Audit History - phases

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc_private
*Archived: 2026-01-19T23:48:41.541Z*

- **File**: js/agents/stages/codesearch/phases/execution-phase.js:30
- **Description**: 文件内私有辅助函数未标记 @private，不符合约定。
- **Suggestion**: 为文件内私有函数添加 `/** @private */` 标记，便于区分公共与内部接口。
```
function safeJsonStringify(value, maxChars = 600) {
```

---

## Archived: 2026-01-19

### [RESOLVED] timeout_handling
*Archived: 2026-01-19T23:48:36.580Z*

- **File**: js/agents/stages/codesearch/phases/execution-phase.js:268
- **Description**: callModel 调用仅依赖外部 AbortSignal，未提供默认超时可能导致阶段长时间阻塞。
- **Suggestion**: 为 callModel/tools.execute 添加 Promise.race 超时或默认 AbortController，并记录超时事件。
```
response = await callModel(messages, { model: "auto", temperature: 0.3, maxTokens: 1000, signal });
```

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc_contract
*Archived: 2026-01-19T23:48:25.473Z*

- **File**: js/agents/stages/codesearch/phases/planning-phase.js:42
- **Description**: JSDoc 使用 any 类型违反项目约定，降低类型契约清晰度。
- **Suggestion**: 定义具体 payload 类型（@typedef）并替换 any；为公共 API 保持完整的类型描述。
```
@typedef {(eventName: string, payload: any) => void} EmitFn
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe_deserialization
*Archived: 2026-01-19T23:48:20.169Z*

- **File**: js/agents/stages/codesearch/phases/execution-phase.js:100
- **Description**: parseStepDecision 对 LLM 输出多次 JSON.parse，未做结构/大小验证。
- **Suggestion**: 增加最大长度限制和 schema 校验，解析失败时返回安全的默认结构并记录告警。
```
parsed = JSON.parse(jsonMatch[1]);
```

---

## Archived: 2026-01-19

### [RESOLVED] input_validation
*Archived: 2026-01-19T23:47:56.608Z*

- **File**: js/agents/stages/codesearch/phases/execution-phase.js:381
- **Description**: LLM 决策中的 action/args 直接传入 tools.execute，缺少 allowlist 与参数验证，可能触发非预期工具或危险参数。
- **Suggestion**: 在执行前校验 action 是否在允许列表中，并对 args 做类型/边界检查（尤其是路径/URL）。
```
result = await tools.execute(actionName, decision.args);
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe_deserialization
*Archived: 2026-01-19T23:47:52.196Z*

- **File**: js/agents/stages/codesearch/phases/planning-phase.js:71
- **Description**: LLM 输出直接 JSON.parse，缺少长度和 schema 校验，可能导致解析 DoS 或逻辑绕过。
- **Suggestion**: 在 JSON.parse 前限制输出长度并做 schema 校验（例如 zod），仅接受数组结构且字段类型符合预期。
```
const parsed = JSON.parse(jsonMatch[1]);
```

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

