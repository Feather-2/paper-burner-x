# Audit History - middleware

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc-compliance
*Archived: 2026-01-19T23:44:09.332Z*

- **File**: js/agents/runtime/core/middleware/middleware-chain.js:51
- **Description**: 多处 JSDoc 参数缺少描述且使用 any 类型，违反规范（@param 必须描述、禁止 any）。
- **Suggestion**: 补全所有 @param 描述，并将 any 替换为更具体的类型或 @typedef。
```
* @param {Function[]} middlewares
```

---

## Archived: 2026-01-19

### [RESOLVED] hook-exception-isolation
*Archived: 2026-01-19T23:43:52.829Z*

- **File**: js/agents/runtime/core/middleware/middleware-chain.js:364
- **Description**: getShadowHints 异常会中断主流程；该回调相当于前置钩子，需隔离异常以保证链路完整。
- **Suggestion**: 为回调增加 try/catch，失败时记录并继续 next()。
```
const hints = await getShadowHints(ctx);
```

---

## Archived: 2026-01-19

### [RESOLVED] input-validation
*Archived: 2026-01-19T23:43:35.079Z*

- **File**: js/agents/runtime/core/middleware/middleware-chain.js:244
- **Description**: timeout 允许来自 ctx.timeout，未验证数值和边界，可能导致 NaN/负数/极大值引发超时逻辑失效或异常延迟。
- **Suggestion**: 校验为有限正数并设定合理上下限，非法值回退到默认 timeout。
```
const stepTimeout = ctx.timeout || timeout;
```

---

## Archived: 2026-01-19

### [RESOLVED] hook-exception-isolation
*Archived: 2026-01-19T23:43:31.045Z*

- **File**: js/agents/runtime/core/middleware/middleware-chain.js:334
- **Description**: onBeforeSnapshot/onAfterSnapshot 回调抛错会中断中间件链，违背“pre/post hooks 异常不应中断主流程”的要求。
- **Suggestion**: 用 try/catch 包裹回调，记录错误并继续执行，必要时把错误挂到 ctx 供后续处理。
```
ctx._beforeSnapshot = await onBeforeSnapshot(ctx);
```

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

