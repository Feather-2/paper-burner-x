# Audit History - plugins

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] async-error-handling
*Archived: 2026-01-18T21:07:14.856Z*

- **File**: js/agents/plugins/compression/watchdog.js:93
- **Description**: 定时器与事件订阅触发 checkHealth() 时未处理 rejection，若内部 await 链抛错会导致未捕获的 Promise 拒绝。
- **Suggestion**: 改为 `void checkHealth().catch(err => ctx.log.error('Watchdog check failed', err))`，订阅回调同样处理。
```
intervalId = setInterval(() => {
  void checkHealth();
}, ctx.config.checkInterval);
```

### [RESOLVED] typescript-syntax
*Archived: 2026-01-18T21:07:14.856Z*

- **File**: js/agents/plugins/compression/watchdog.js:34
- **Description**: JSDoc 中使用了 TypeScript 工具类型 `ReturnType<>`，不符合纯 JS + JSDoc 规范。
- **Suggestion**: 用 `/** @type {number | null} */` 或定义显式 typedef 替代。
```
/** @type {ReturnType<typeof setInterval> | null} */
```

### [RESOLVED] typescript-syntax
*Archived: 2026-01-18T21:07:14.856Z*

- **File**: js/agents/plugins/services/llm.js:33
- **Description**: JS 文件中存在 `@ts-ignore` 指令，属于 TS 特定语法，可能掩盖实际运行时错误。
- **Suggestion**: 用 try/catch 包裹动态 import 并给出明确错误信息，避免使用 TS 指令。
```
/** @ts-ignore - llm/index.js may not exist in all builds */
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:07:14.856Z*

- **File**: js/agents/plugins/stages/deepsearch.js:58
- **Description**: 事件名使用点号分隔（如 `stage.deepsearch.start`），不符合 `domain:action` 事件命名约定；该模式在多个插件中存在。
- **Suggestion**: 统一改为 `domain:action`（如 `stage:deepsearchStart` 或 `deepsearch:start`），并同步更新监听方。
```
ctx.events.emit('stage.deepsearch.start', { input });
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:07:14.856Z*

- **File**: js/agents/plugins/stages/deepsearch.js:37
- **Description**: 服务名 `stage:deepsearch` 非 camelCase，违反服务命名规范。
- **Suggestion**: 改为 camelCase，例如 `stageDeepsearch` 或 `deepsearchStage`。
```
ctx.registerService('stage:deepsearch', {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:07:14.856Z*

- **File**: js/agents/plugins/services/vfs.js:41
- **Description**: VFS 服务的公开方法缺少 @param/@returns 注解，降低 JSDoc 类型完整性。
- **Suggestion**: 为 install 与暴露的服务方法补充 JSDoc（参数、返回类型）。
```
async readFile(path, options) {
```

---

