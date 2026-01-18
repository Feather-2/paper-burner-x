# Audit History - core

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] convention
*Archived: 2026-01-18T21:13:43.564Z*

- **File**: js/agents/runtime/core/lifecycle.js:78
- **Description**: 生命周期事件名使用点号格式（`${actor}.${event}` / `${actor}.started`），不符合项目约定的 `domain:action` 命名规范，其他核心模块也沿用该格式，造成事件命名不一致。
- **Suggestion**: 将事件名统一为 `domain:action`（如 `${actor}:started`），并在过渡期同时发送旧格式以保证兼容。
```
export function lifecycleEvent(actor, event) {
  return `${actor}.${event}`;
}
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:13:43.564Z*

- **File**: js/agents/runtime/core/lifecycle.js:48
- **Description**: 导出的生命周期 payload helper 未提供 `@param/@returns` 类型注解，违反 JSDoc 类型注解完整性要求。
- **Suggestion**: 为 createEventPayload / createPhaseTransitionPayload / createStatusChangePayload / createStepPayload / lifecycleEvent 补充 `@param` 与 `@returns`。
```
export function createEventPayload(actor, status, data = {}) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:13:43.564Z*

- **File**: js/agents/runtime/core/worker-factory.js:12
- **Description**: 导出的 worker 工具缺少返回类型注解（`isWorkerSupported`, `terminateWorker`），影响类型推断与规范一致性。
- **Suggestion**: 补充 `@returns {boolean}`，并为 `terminateWorker` 添加 `@returns {Promise<void>}`。
```
export function isWorkerSupported() {
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:13:43.564Z*

- **File**: js/agents/runtime/core/python-adapter.js:107
- **Description**: Python worker 的 onmessage 处理中直接 `await request.vfs.writeFile`，若写入失败会导致未处理的 Promise 拒绝并阻塞 pending request 清理。
- **Suggestion**: 用 try/catch 包裹写入并在失败时 `request.reject(err)`/记录错误，同时确保 `pendingRequests.delete(id)` 在 finally 中执行。
```
for (const file of files) {
  await request.vfs.writeFile(file.path, file.content);
}
```

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:13:43.564Z*

- **File**: js/agents/runtime/core/config-validator.js:117
- **Description**: `structuredClone` 直接调用在部分浏览器或较旧 Node 版本中不存在，默认值处理会抛错并破坏浏览器兼容性。
- **Suggestion**: 使用 `globalThis.structuredClone` 检测并回退到安全的深拷贝方案（如 JSON clone 或本地工具函数）。
```
result[key] = typeof fieldSchema.default === "function"
  ? fieldSchema.default()
  : structuredClone(fieldSchema.default);
```

---

