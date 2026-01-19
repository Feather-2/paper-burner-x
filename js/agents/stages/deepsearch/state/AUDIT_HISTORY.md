# Audit History - state

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] error-handling
*Archived: 2026-01-19T20:48:06.772Z*

- **File**: js/agents/stages/deepsearch/state/task-state.js:27
- **Description**: taskGoal getter/setter 的 catch 块吞掉异常，违反错误处理规范，可能掩盖 StateEngine 故障。
- **Suggestion**: 在 catch 中记录日志或重新抛出带 cause 的 Error，避免静默失败。
```
try {
  const snap = typeof engine._getStateRef === "function" ? engine._getStateRef() : engine.getState?.();
  const goal = toNonEmptyString(snap?.L0?.taskGoal);
  if (goal) return goal;
} catch {
  // fall back below
}
```

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc-any
*Archived: 2026-01-19T20:47:59.163Z*

- **File**: js/agents/stages/deepsearch/state/serializer.js:11
- **Description**: serializer.js 中多个 @typedef 使用 `any`，违反“禁止 any 类型”规范。
- **Suggestion**: 将 `any` 替换为更具体类型或收敛为 Record/union，并补充必要的 @typedef。
```
* @property {any=} strategy
* @property {any=} metrics
* @property {any=} stateSnapshot
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype-pollution
*Archived: 2026-01-19T20:47:59.111Z*

- **File**: js/agents/stages/deepsearch/state/memory-methods.js:78
- **Description**: setScratchpad 允许 Object.assign/动态 key 写入 scratchpad；若 key 来自可控输入，可利用 __proto__/constructor 污染原型。
- **Suggestion**: 过滤危险键并仅拷贝允许字段；或将 scratchpad 初始化为 `Object.create(null)` 并拒绝 `__proto__/prototype/constructor`。
```
if (isPlainObject(key) && value === undefined) Object.assign(this.L2.scratchpad, key);
else this.L2.scratchpad[/** @type {string} */ (key)] = value;
```

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-19T20:47:39.650Z*

- **File**: js/agents/stages/deepsearch/state/state-methods.js:22
- **Description**: stateMethods 导出对象的多个方法缺少 JSDoc（如 addTokenUsage/getBudgetConfig/addTodo/replaceTodos/updateTodo/removeTodo），与 public API 规范不符。
- **Suggestion**: 为每个导出方法补充 @param/@returns 描述，或标注 @private 并从公共导出中移除。
```
export const stateMethods = {
  addTokenUsage(usage) {
```

---

## Archived: 2026-01-19

### [RESOLVED] error-handling
*Archived: 2026-01-19T20:47:39.598Z*

- **File**: js/agents/stages/deepsearch/state/memory-methods.js:95
- **Description**: bindMemoryStore 内多处空 catch（含同步/替换/defineProperty）吞异常，可能导致同步失败却无告警。
- **Suggestion**: 至少记录 debug 日志或返回错误状态；若确需忽略，集中封装并标明可接受失败条件。
```
try {
  this._syncFromStateEngine();
} catch { /* intentional */ }
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-19T20:47:39.548Z*

- **File**: js/agents/stages/deepsearch/state/serialization-methods.js:76
- **Description**: deserialize 仅做长度/类型检查后直接 JSON.parse 并传给 fromJSON；若 text 来自 UI/外部存储，缺少结构校验可能导入意外字段或原型键。
- **Suggestion**: 在 deserialize 中增加 schema/shape 校验并清理危险键；确保 fromJSON 仅读取允许字段。
```
parsed = JSON.parse(text);
return this.fromJSON(parsed);
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype-pollution
*Archived: 2026-01-19T20:47:39.499Z*

- **File**: js/agents/stages/deepsearch/state/state-methods.js:112
- **Description**: updateTodo 将 updates 中的任意键写入 todo/draft；若输入包含 __proto__/constructor/prototype 可污染对象原型并影响后续状态处理。
- **Suggestion**: 对可写字段做白名单过滤，显式拒绝 `__proto__`/`prototype`/`constructor`；必要时用 `Object.create(null)` 作为容器并在写入前校验自有属性。
```
for (const [k, v] of Object.entries(patch)) {
  if (k === "text" || k === "content" || k === "title" || k === "status") continue;
  draft[k] = v;
}
```

---

## Archived: 2026-01-18

### [RESOLVED] style-oversize-function
*Archived: 2026-01-18T20:47:53.691Z*

- **File**: js/agents/stages/deepsearch/state/checkpoint-methods.js:73
- **Description**: restoreCheckpoint 体量与嵌套逻辑超过风格约束（>50 行且多层嵌套），降低可读性与可测试性。
- **Suggestion**: 拆分为策略解析、快照还原、LITE/MINIMAL 修复等小函数以降低嵌套与长度。
```
restoreCheckpoint(checkpointId) {
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-any
*Archived: 2026-01-18T20:47:43.569Z*

- **File**: js/agents/stages/deepsearch/state/checkpoint-methods.js:20
- **Description**: saveCheckpoint 的 JSDoc 使用 any 且缺少参数描述，违反 JSDoc 规范与“禁止 any 类型”的约定。
- **Suggestion**: 为 metrics/strategy 定义具体 @typedef，并补充 @param/@returns 的描述信息。
```
* @param {{ checkpointId?: string, timestamp?: string, metrics?: any, strategy?: any, record?: boolean }=} options
```

---

## Archived: 2026-01-18

### [RESOLVED] event-name-format
*Archived: 2026-01-18T20:42:53.943Z*

- **File**: js/agents/stages/deepsearch/state/checkpoint-methods.js:176
- **Description**: 事件名未遵循 domain:action 格式约定，可能影响事件过滤或一致性。
- **Suggestion**: 改为 domain:action 格式，例如 "deepsearch:checkpointRestored"。
```
this.addTimeline({ name: "deepsearch.checkpoint.restored", status: "info", payload: { checkpointId: id, iteration: this.iteration } });
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-any
*Archived: 2026-01-18T20:42:34.638Z*

- **File**: js/agents/stages/deepsearch/state/iteration-state.js:6
- **Description**: IterationStateRoot 的 JSDoc 使用 any[]，违反“禁止 any 类型”的约定。
- **Suggestion**: 为 gap/chunk 定义明确的 @typedef 并在 L1/L2 引用具体类型。
```
* @property {{ gaps?: any[] }=} L1
```

---

## Archived: 2026-01-18

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-18T20:40:14.875Z*

- **File**: js/agents/stages/deepsearch/state/serialization-methods.js:63
- **Description**: deserialize() 直接对传入文本执行 JSON.parse，缺少输入校验/结构验证；若该入口接收 UI 或外部存储数据，可能导致畸形负载或触发不受控的 fromJSON 行为。
- **Suggestion**: 在 parse 前做类型/长度限制，parse 后使用 schema 校验；用 try/catch 包裹并抛出自定义错误或返回友好错误。
```
const parsed = JSON.parse(String(text || ""));
```

---

