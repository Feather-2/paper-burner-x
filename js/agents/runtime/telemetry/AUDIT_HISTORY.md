# Audit History - telemetry

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T21:22:43.358Z*

- **File**: js/agents/runtime/telemetry/token-tracker.js:374
- **Description**: 导出的便捷函数缺少 @param/@returns 类型注解（getGlobalTokenTracker、trackTokenUsage、getTokenUsageSummary、exportTokenUsageJson/Csv），与项目 JSDoc 规范不符。
- **Suggestion**: 为这些导出函数补全 @param/@returns，并复用 TokenUsageRecord/summary 的类型定义。
```
export function getGlobalTokenTracker() {
  const container = getGlobalContainer();
  ...
}
export function trackTokenUsage(params) {
  return getGlobalTokenTracker().record(params);
}
```

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T21:22:43.358Z*

- **File**: js/agents/runtime/telemetry/loop-runtime-state.js:81
- **Description**: LoopRuntimeState 的公开方法和导出函数缺少 @param/@returns 类型注解（canTransition、toJSON、fromJSON、getRuntimeState、setRuntimeState、ensureRuntimeState、clearRuntimeState）。
- **Suggestion**: 补充 signal 参数类型、返回值类型（LoopRuntimeState|null）以及状态机方法的 @returns。
```
canTransition(to) {
  const target = normalizeStatus(to);
  ...
}
export function getRuntimeState(signal) {
  ...
}
```

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T21:22:43.358Z*

- **File**: js/agents/runtime/telemetry/trace-context.js:492
- **Description**: trace-context 的导出 helper 缺少返回值类型注解（withSpan/parseTraceparent）。
- **Suggestion**: 为 withSpan 添加 @returns {Promise<any>}，为 parseTraceparent 添加 @returns {object|null}。
```
export async function withSpan(traceContext, name, fn, options = {}) {
  ...
}
export function parseTraceparent(traceparent) {
  return TraceContext.parseTraceparent(traceparent);
}
```

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T21:22:43.358Z*

- **File**: js/agents/runtime/telemetry/replay-controller.js:65
- **Description**: RunReplayController 的公开 API（state/setSpeed/play/pause/stop/seek/step）缺少 JSDoc 类型注解。
- **Suggestion**: 为公开方法补充 @param/@returns，并说明 state 的结构。
```
get state() {
  return { ... };
}
setSpeed(speed) {
  ...
}
play({ fromIndex, speed } = {}) {
  ...
}
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:22:43.358Z*

- **File**: js/agents/runtime/telemetry/runstore-telemetry.js:42
- **Description**: Todo 聚合逻辑依赖点号事件名（deepsearch.todo.created / 'todo.'），与约定的 domain:action 格式不一致；冒号格式事件将被忽略。
- **Suggestion**: 统一事件命名（如 domain:todo.created），或兼容解析 ':' 与 '.' 两种分隔符。
```
evt?.name === 'deepsearch.todo.created' || String(evt?.name || '').endsWith('.todo.created')
if (String(evt?.name || '').includes('todo.')) upsertTodo(...)
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:22:43.358Z*

- **File**: js/agents/runtime/telemetry/runstore-telemetry.js:81
- **Description**: RunStore 写入失败被吞掉，flush 永远 resolve，调用方无法感知遥测写入失败。
- **Suggestion**: 记录日志后重新抛出或暴露失败回调，让 flush 能 reject 并提示数据丢失。
```
pending = pending.then(() => store.appendEvent(runId, evt)).catch((err) => logger.warn('Telemetry append error', { error: err.message }));
```

---

