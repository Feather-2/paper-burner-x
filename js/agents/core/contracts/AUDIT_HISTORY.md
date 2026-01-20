# Audit History - contracts

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] 错误信息泄露
*Archived: 2026-01-20T00:10:39.457Z*

- **File**: js/agents/core/contracts/tool-result.js:95
- **Description**: normalizeToolResult 在处理 Error 时把 stack 放入 meta，若 ToolResult 直接返回给用户会泄露内部路径/调用栈信息。
- **Suggestion**: 仅在内部日志保留 stack，或通过 debug 标志控制；对外返回只保留友好消息/错误码。
```
if (raw instanceof Error) {
  return {
    ok: false,
    success: false,
    error: raw.message,
    data: undefined,
    meta: { stack: raw.stack },
  };
}
```

---

## Archived: 2026-01-18

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:24:51.966Z*

- **File**: js/agents/shared/contracts/disposable.js:43
- **Description**: safeDispose 在 onError 回调抛错时会向上传播异常，违背“异常不抛出”的契约，可能中断清理流程。
- **Suggestion**: 为 onError 包裹 try/catch 并吞掉回调异常（可记录日志），保持 safeDispose 永不抛错。
```
options.onError(error);
```

### [RESOLVED] contract-validation
*Archived: 2026-01-18T21:24:51.966Z*

- **File**: js/agents/shared/contracts/rpc-message.js:48
- **Description**: RPC 请求 type 只校验非空字符串，未强制 domain:action 事件名格式，可能放行不符合约定的消息。
- **Suggestion**: 增加格式校验，例如 `const isValid = /^[a-z][a-zA-Z0-9]*:[a-z][a-zA-Z0-9]*$/.test(type);` 并在失败时返回错误。
```
if (typeof type !== "string" || !type.trim()) {
```

### [RESOLVED] jsdoc-type
*Archived: 2026-01-18T21:24:51.966Z*

- **File**: js/agents/shared/contracts/disposable.js:96
- **Description**: createCompositeDisposable 返回对象包含 add 方法，但返回类型标注为 Disposable，导致类型提示不完整。
- **Suggestion**: 新增 `@typedef CompositeDisposable`（包含 add）并将返回类型改为 CompositeDisposable。
```
* @returns {Disposable}
```

### [RESOLVED] jsdoc-type
*Archived: 2026-01-18T21:24:51.966Z*

- **File**: js/agents/shared/contracts/tool-result.js:51
- **Description**: ToolResult.meta 仅判断为 object，会接受数组，与 `Record<string, unknown>` 注解不一致（normalizeToolResult 中也有同样判断）。
- **Suggestion**: 校验时排除数组：`obj.meta && typeof obj.meta === "object" && !Array.isArray(obj.meta)`，并在 normalizeToolResult 的 meta 处理处同步修正。
```
meta: typeof obj.meta === "object" && obj.meta !== null
```

---

