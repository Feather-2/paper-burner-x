# Audit History - state

Archived issues from security audits.

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

