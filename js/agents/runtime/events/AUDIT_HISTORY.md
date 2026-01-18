# Audit History - events

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] Convention mismatch
*Archived: 2026-01-18T21:20:49.814Z*

- **File**: js/agents/runtime/events/events.js:22
- **Description**: 事件名值使用点分隔（如 run.started），与约定的 domain:action 格式不一致，且相关前缀/模式逻辑依赖 '.' 分隔。
- **Suggestion**: 将事件名改为 domain:action（例如 run:started）并同步调整前缀/匹配逻辑，或更新项目约定与消费者以统一接受点分隔格式。
```
RUN_STARTED: "run.started",
```

### [RESOLVED] JSDoc missing types
*Archived: 2026-01-18T21:20:49.814Z*

- **File**: js/agents/runtime/events/events.js:261
- **Description**: 导出的 getEventPrefix 缺少 @param/@returns 类型注解。
- **Suggestion**: 补充 JSDoc：@param {string} eventName 与 @returns {string|null}。
```
export function getEventPrefix(eventName) {
```

### [RESOLVED] JSDoc missing @returns
*Archived: 2026-01-18T21:20:49.814Z*

- **File**: js/agents/runtime/events/events.js:303
- **Description**: matchEventPattern 的 JSDoc 未标注返回值类型。
- **Suggestion**: 补充 @returns {boolean} 注解。
```
export function matchEventPattern(pattern, eventName) {
```

---

