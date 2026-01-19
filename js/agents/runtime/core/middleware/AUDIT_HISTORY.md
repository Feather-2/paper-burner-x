# Audit History - middleware

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc 注解缺失
*Archived: 2026-01-18T21:44:19.648Z*

- **File**: js/agents/runtime/middleware/middleware-chain.js:133
- **Description**: 多个导出的中间件工厂函数仅有说明性注释，缺少 @param/@returns 类型注解，未满足 JSDoc 类型标注要求。
- **Suggestion**: 为各 create*Middleware 函数补充 @typedef/@param/@returns，明确 options 结构与返回的 middleware 签名。
```
export function createLoggingMiddleware(options = {}) {
```

### [RESOLVED] 事件命名规范
*Archived: 2026-01-18T21:44:19.648Z*

- **File**: js/agents/runtime/middleware/middleware-chain.js:166
- **Description**: Telemetry 事件名使用点分隔，不符合 domain:action 约定，可能导致订阅端匹配失败。
- **Suggestion**: 改为 domain:action 格式，例如 `${stageName}:middleware.started`/`...completed`/`...failed`，并同步更新消费方。
```
emitFn?.(`${stageName}.middleware.${stepName}.started`, {
```

### [RESOLVED] 异常处理
*Archived: 2026-01-18T21:44:19.648Z*

- **File**: js/agents/runtime/middleware/middleware-chain.js:225
- **Description**: 超时回调 onTimeout 在定时器内直接调用，若其抛错将导致 Promise 未正确 reject，产生未处理异常。
- **Suggestion**: 对 onTimeout 用 try/catch 包裹，确保 reject(err) 始终执行，并可将回调异常附加到 err.cause。
```
onTimeout?.(ctx, err);
```

---

