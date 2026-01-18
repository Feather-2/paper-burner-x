# Audit History - memory

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] TypeScriptSyntax
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/memory-store.js:10
- **Description**: JSDoc 使用了 TypeScript 工具类型 `ConstructorParameters<...>`，属于 TS 语法混入，可能影响纯 JSDoc 解析器或非 TS 工具链。
- **Suggestion**: 改为显式 JSDoc typedef（例如定义 MemoryStoreOptions 并引用），或使用更通用的对象类型，避免 TS utility type。
```
@param {ConstructorParameters<typeof import("./memory-store.impl.js").MemoryStore>[0]} [options]
```

### [RESOLVED] EventNaming
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/state-engine.js:998
- **Description**: StateEngine 事件名使用点和下划线分隔（state.changed/state.batch_changed），不符合 domain:action 规范与 camelCase action 约定。
- **Suggestion**: 改为 `state:changed` 与 `state:batchChanged`（或统一命名规则），并同步更新订阅方。
```
this._eventBus.emit("state.changed", {
```

### [RESOLVED] EventNaming
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/memory-store.impl.js:744
- **Description**: MemoryStore 事件名使用点分隔（memory.archived/memory.compressed/memory.updated），不符合 domain:action 规范，且会影响订阅方一致性。
- **Suggestion**: 改为 `memory:archived` / `memory:compressed` / `memory:updated`，并更新所有订阅端（含 RetrievalEngine）。
```
this._emit("memory.archived", { id, stageKey: entry.stageKey, summary: entry.summary, ts: entry.ts });
```

### [RESOLVED] EventNaming
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/unified-memory-store.js:629
- **Description**: UnifiedMemoryStore 同样发出 memory.archived/memory.compressed/memory.updated，事件命名与规范不一致。
- **Suggestion**: 与 MemoryStore 统一为 `memory:archived` / `memory:compressed` / `memory:updated`。
```
this._emit("memory.archived", { id, stageKey: entry.stageKey, summary: entry.summary, ts: entry.ts });
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/state-engine.js:83
- **Description**: 导出的 createInitialState / rootReducer / reduceL* 缺少 @param/@returns 等类型注解，不符合项目 JSDoc 规范。
- **Suggestion**: 为导出函数补充完整 JSDoc 类型注解；或将 reducer 标记为 @private 并停止导出。
```
export function createInitialState(options = {}) {
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/action-types.js:112
- **Description**: Action creators 与校验函数未提供 JSDoc 类型注解（例如 setSystemPrompt/isValidActionType 等）。
- **Suggestion**: 为各导出函数添加 @param/@returns，或定义统一 ActionCreator typedef 并在导出上标注。
```
export const setSystemPrompt = (prompt) => createAction(L0_SET_SYSTEM_PROMPT, { prompt });
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/todo-normalize.js:8
- **Description**: todo-normalize 的导出函数缺少 JSDoc 类型注解；normalizeTodoEntry 未注明 @returns。
- **Suggestion**: 为 normalizeTodoStatus/normalizeTodoPriority/normalizeTodoInPlace 添加 @param/@returns，并补充 normalizeTodoEntry 的 @returns。
```
export function normalizeTodoStatus(value) {
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/retrieval-engine.js:506
- **Description**: RetrievalEngine 的 keywordRecall 缺少 JSDoc，semanticRecall/hybridRecall 缺少 @returns 类型注解。
- **Suggestion**: 为 recall 系列方法补充 @param/@returns（异步方法注明 Promise 返回类型）。
```
keywordRecall(query, { limit = 3 } = {}) {
```

### [RESOLVED] ErrorHandling
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/retrieval-engine.js:383
- **Description**: 索引任务超过重试次数后被静默丢弃，失败不可观测，可能导致检索覆盖率下降但无诊断。
- **Suggestion**: 在失败时 emit 事件或记录日志并计入统计（例如 retrieval:indexFailed），便于监控与回溯。
```
// 超过重试次数则静默丢弃
```

### [RESOLVED] ErrorHandling
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/retrieval-engine.js:565
- **Description**: semanticRecall 对 ensureIndexed/embed 未做 try/catch；若 embed 抛错会直接中断，fallback 逻辑不会执行。
- **Suggestion**: 用 try/catch 捕获异常，并在 fallback=true 时回退到 keywordRecall，同时可 emit 错误事件。
```
const vectors = await svc.embed([q], { ...(timeoutMs ? { timeoutMs } : {}) });
```

### [RESOLVED] Security
*Archived: 2026-01-18T21:46:06.052Z*

- **File**: js/agents/runtime/memory/l3-storage.js:260
- **Description**: L3Storage 直接将 runId 拼入路径，若 runId 可控可能产生路径穿越（../）并写入非预期目录。
- **Suggestion**: 对 runId 做白名单校验（如仅允许 [A-Za-z0-9_-]），或在拼接前进行路径段清理。
```
this._basePath = `.agents/runs/${runId}/l3`;
```

---

