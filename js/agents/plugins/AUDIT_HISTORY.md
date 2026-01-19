# Audit History - plugins

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] console 残留
*Archived: 2026-01-19T20:50:49.520Z*

- **File**: js/agents/plugins/side-effects/side-effect-journal.js:295
- **Description**: vfsExists 捕获异常时使用 console.debug，生产环境可能泄露内部错误细节且不符合日志规范。
- **Suggestion**: 改为使用注入的 logger（ctx.log/logger 参数）并按需脱敏错误信息。
```
if (typeof console !== "undefined" && console.debug) {
  console.debug("[SideEffectJournal] vfsExists check failed:", e);
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 缺失文件引用
*Archived: 2026-01-19T20:50:42.651Z*

- **File**: js/agents/plugins/index.js:57
- **Description**: 插件注册表引用 resilience/resilience-level.js，但目录中不存在该文件，加载 resilience/level 会直接失败。
- **Suggestion**: 补齐 resilience-level.js 或修正注册表指向现有模块（如 degradation-matrix.js），并同步文档与测试。
```
'resilience/level': () => import('./resilience/resilience-level.js'),
```

---

## Archived: 2026-01-19

### [RESOLVED] SSRF
*Archived: 2026-01-19T20:50:34.598Z*

- **File**: js/agents/plugins/deps/dependency-manager.js:204
- **Description**: cacheWheel 直接 fetch(wheel.url) 仅校验 https 协议，若 wheel.url 来自外部输入，在 Node 环境可访问内网/元数据地址。
- **Suggestion**: 增加 host allowlist/denylist（阻断私有网段/metadata IP），或要求 wheel.url 仅来自可信源并强制 sha256 校验。
```
const urlObj = new URL(wheel.url);
if (urlObj.protocol !== "https:") { ... }
const resp = await fetch(wheel.url);
```

---

## Archived: 2026-01-19

### [RESOLVED] 不安全反序列化
*Archived: 2026-01-19T20:50:07.462Z*

- **File**: js/agents/plugins/transports/process-transport.js:198
- **Description**: ProcessTransport 对外部进程输出直接 JSON.parse 后进入处理逻辑，缺少 JSON-RPC schema 校验，恶意进程可注入异常结构或事件风暴。
- **Suggestion**: 在 _handleMessage 前验证 JSON-RPC 字段类型与大小（id/method/result/error），限制深度/长度并丢弃未知字段。
```
const message = JSON.parse(trimmed);
this._handleMessage(message);
```

---

## Archived: 2026-01-19

### [RESOLVED] 路径穿越
*Archived: 2026-01-19T20:49:58.537Z*

- **File**: js/agents/plugins/deps/python-skill-executor.js:115
- **Description**: Skill 元数据 entrypoint 与 path 直接拼接成文件路径，未校验 ../、绝对路径或分隔符；若 metadata 可被外部控制，可能读取任意文件。
- **Suggestion**: 对 entrypoint/path 做白名单与路径规范化（仅允许相对路径，拒绝 .. 与绝对路径），或使用已有的 sanitizeRunId/validate 函数并在 VFS 层限制根目录。
```
const entrypoint = metadata.entrypoint || "main.py";
const skillPath = `${path}/${entrypoint}`;
```

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

