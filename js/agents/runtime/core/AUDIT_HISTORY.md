# Audit History - core

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] browser compatibility
*Archived: 2026-01-19T20:59:24.656Z*

- **File**: js/agents/runtime/core/exec/index.js:10
- **Description**: exec 入口默认导出 Node 实现；若构建未正确替换为 browser 版本，会在浏览器中直接崩溃。
- **Suggestion**: 提供明确的条件导出或运行时检测，浏览器环境下默认使用 stub 实现。
```
// 默认导出 Node 版本；浏览器构建应替换为 .browser.js
export { exec, execShell, execSimple, commandExists } from './command-executor.node.js';
```

---

## Archived: 2026-01-19

### [RESOLVED] input validation
*Archived: 2026-01-19T20:59:17.999Z*

- **File**: js/agents/runtime/core/tool-registry.js:382
- **Description**: 工具调用时 params 直接传入 executor/工具函数，缺少统一参数校验，易造成未验证输入流入工具实现。
- **Suggestion**: 为每个工具引入参数 schema（JSON schema/JSDoc + config-validator），在执行前验证并拒绝非法字段。
```
const executor = resolveToolExecutor(context);
result = normalizeToolResult(await executor(name, finalParams, context));
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe deserialization
*Archived: 2026-01-19T20:59:11.175Z*

- **File**: js/agents/runtime/core/vfs-proxy-client.js:274
- **Description**: VFS 响应 JSON 直接 parse，缺少结构校验；若响应被篡改会导致类型混淆或逻辑错误。
- **Suggestion**: 在 JSON.parse 后做 schema 校验或最小字段白名单校验，异常时返回受控错误。
```
const text = new TextDecoder().decode(bytes);
return JSON.parse(text);
```

---

## Archived: 2026-01-19

### [RESOLVED] error info leakage
*Archived: 2026-01-19T20:58:50.904Z*

- **File**: js/agents/runtime/core/stage-errors.js:150
- **Description**: 错误 payload 默认包含完整 stack；若对用户可见或外部日志暴露，可能泄露内部路径/实现细节。
- **Suggestion**: 用户可见场景默认 includeStack=false，或仅保留截断/脱敏后的 stack。
```
export function toErrorPayload(err, { includeStack = true } = {}) {
  // 保留堆栈信息（默认启用）
  if (includeStack && typeof err.stack === "string" && err.stack) {
    payload.stack = err.stack;
  }
}
```

---

## Archived: 2026-01-19

### [RESOLVED] unsafe deserialization
*Archived: 2026-01-19T20:58:44.200Z*

- **File**: js/agents/runtime/core/vfs-proxy.js:283
- **Description**: VfsProxy.statSync/readdirSync 对共享内存返回值直接 JSON.parse，缺少形状验证。
- **Suggestion**: 添加字段/类型校验，必要时用 config-validator 或手写断言。
```
const text = new TextDecoder().decode(bytes);
return JSON.parse(text);
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype pollution
*Archived: 2026-01-19T20:58:34.914Z*

- **File**: js/agents/runtime/core/tool-registry.js:250
- **Description**: ToolRegistry 用普通对象保存工具并按名称写入；若工具名来自外部清单，__proto__/constructor 等键可污染原型。
- **Suggestion**: 改用 Object.create(null) 或 Map，并显式拒绝 __proto__/constructor/prototype 等危险键。
```
this._tools[name] = fn;
```

---

## Archived: 2026-01-19

### [RESOLVED] path traversal
*Archived: 2026-01-19T20:57:51.475Z*

- **File**: js/agents/runtime/core/vfs-proxy-host.js:209
- **Description**: VFS 请求路径仅去掉前导斜杠，未校验 .. 等片段；若 worker/调用方可控，可能越权访问宿主文件。
- **Suggestion**: 对路径做规范化并拒绝包含 ".." 或反斜杠的输入，或强制在允许的根目录内解析。
```
const vfsPath = stripLeadingSlashes(path);
const bytes = await vfs.readFile(vfsPath);
```

---

## Archived: 2026-01-19

### [RESOLVED] code injection
*Archived: 2026-01-19T20:57:45.179Z*

- **File**: js/agents/runtime/core/js-adapter.js:439
- **Description**: 主线程回退路径用 new Function + with 执行动态代码；若不可信输入进入该分支，会导致任意代码执行与沙箱逃逸。
- **Suggestion**: 对不可信输入禁用 main-thread fallback；仅允许显式 trusted 标记且失败即终止，默认强制走 Worker 沙箱。
```
const fn = new Function('sandbox', `
  return (async function () {
    with (sandbox) {
      ${code}
    }
  }).call(sandbox);
`);
```

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

