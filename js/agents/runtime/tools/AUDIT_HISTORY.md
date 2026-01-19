# Audit History - tools

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] export-mismatch
*Archived: 2026-01-19T20:48:19.589Z*

- **File**: js/agents/runtime/tools/index.js:20
- **Description**: index.js 导出了不存在的 validateToolSchema，运行时会导致模块导入失败。
- **Suggestion**: 改为导出已存在的 validateArgs/normalizeSchema，或在 schema-validator.js 中添加 validateToolSchema 别名。
```
export { validateToolSchema } from './schema-validator.js';
```

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc-any
*Archived: 2026-01-19T20:48:06.558Z*

- **File**: js/agents/runtime/tools/tool-executor.js:21
- **Description**: JSDoc 使用 any（如 AnyRecord/ToolResult.data），违反“禁止 any 类型”的项目约定。
- **Suggestion**: 用具体结构或 unknown 替代 any，并在 JSDoc 中描述期望字段。
```
@typedef {Record<string, any>} AnyRecord
```

---

## Archived: 2026-01-19

### [RESOLVED] ssrf
*Archived: 2026-01-19T20:47:53.771Z*

- **File**: js/agents/runtime/tools/python-runtime-worker.js:610
- **Description**: payload.indexUrl 直接传入 loadPyodide，缺少同源/白名单校验，可能触发对任意 URL 的网络请求（SSRF/远程加载）。
- **Suggestion**: 对 indexUrl（以及 wheel URLs）做 allowlist/same-origin 校验，或仅允许预置版本的 CDN 地址。
```
await initPyodide(payload.indexUrl);
```

---

## Archived: 2026-01-19

### [RESOLVED] input-validation
*Archived: 2026-01-19T20:47:29.110Z*

- **File**: js/agents/runtime/tools/schema-validator.js:27
- **Description**: validateArgs 假定 args 为对象；当调用方传入 null/primitive 时会抛错，导致 ToolExecutor 无法返回结构化错误。
- **Suggestion**: 在 validateArgs 起始处校验 args 类型并回退到 {}，或在 ToolExecutor 进入验证前对 args 做规范化。
```
if (args[field] === undefined || args[field] === null) {
```

---

## Archived: 2026-01-19

### [RESOLVED] code-injection
*Archived: 2026-01-19T20:47:22.184Z*

- **File**: js/agents/runtime/tools/python-runtime-worker.js:620
- **Description**: legacy preload 路径通过 AsyncFunction 执行 payload.loadScript；若 payload 可控会导致任意 JS 执行（代码注入）。
- **Suggestion**: 移除 legacy loadScript 路径或仅允许签名/白名单脚本；保持 allowLegacyLoadScript 默认关闭并对调用方做强信任校验。
```
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
```

---

## Archived: 2026-01-18

### [RESOLVED] security/path-traversal
*Archived: 2026-01-18T21:22:48.466Z*

- **File**: js/agents/runtime/tools/platform/node.js:46
- **Description**: Node 平台的安全路径检查使用字符串前缀判断，/base 与 /base-escape 会被误判为同一路径，导致读写越界。
- **Suggestion**: 改用 path.relative 校验边界（例如 const rel = path.relative(basePath, resolvedPath); return !rel.startsWith('..') && !path.isAbsolute(rel);），或确保前缀比较带路径分隔符。
```
return normalized.startsWith(path.normalize(basePath));
```

### [RESOLVED] convention/event-naming
*Archived: 2026-01-18T21:22:48.466Z*

- **File**: js/agents/runtime/tools/tool-executor.js:415
- **Description**: ToolExecutor 发射事件使用 dot 风格，不符合 domain:action 约定。
- **Suggestion**: 改为 tool:validationFailed/tool:denied/tool:completed/tool:failed 等，并同步更新监听方。
```
this._emit("tool.validation.failed", { tool: name, args, errors });
```

### [RESOLVED] convention/event-naming
*Archived: 2026-01-18T21:22:48.466Z*

- **File**: js/agents/runtime/tools/TaskTool.js:172
- **Description**: TaskTool/BacktrackTool/DMailTool 使用 subagent.* / agent.* 事件名，未遵循 domain:action 约定。
- **Suggestion**: 统一为 subagent:started/subagent:completed/subagent:failed、agent:backtrackRequested/agent:dmailSent 等，并同步更新监听方。
```
emit("subagent.started", { type: subagent_type, prompt, context_mode });
```

### [RESOLVED] quality/async-error-handling
*Archived: 2026-01-18T21:22:48.466Z*

- **File**: js/agents/runtime/tools/BacktrackTool.js:40
- **Description**: backtrackHandler 未对 prepareBacktrack 的异常做本地处理，异常会直接向上传播且缺少日志/事件上下文。
- **Suggestion**: 在 handler 内部加 try/catch，记录 logger/emit 失败事件并返回结构化错误。
```
const result = await backtrackManager.prepareBacktrack(checkpoint_id);
```

### [RESOLVED] quality/jsdoc-coverage
*Archived: 2026-01-18T21:22:48.466Z*

- **File**: js/agents/runtime/tools/schema-validator.js:135
- **Description**: 多个导出 API 缺少 @param/@returns 类型注解（normalizeSchema/createValidationHook、createToolExecutor/executeTool、createToolContract、createToolExecutorHandler）。
- **Suggestion**: 为上述导出函数补齐 @param/@returns 的 JSDoc 类型注解，保持与实际参数一致。
```
export function normalizeSchema(schema) {
```

### [RESOLVED] quality/unused-import
*Archived: 2026-01-18T21:22:48.466Z*

- **File**: js/agents/runtime/tools/RecallTool.js:7
- **Description**: normalizeToolResult 在 RecallTool/BacktrackTool 中引入但未使用。
- **Suggestion**: 删除未使用的 import，或改为实际使用统一返回结构。
```
import { normalizeToolResult } from "../../shared/contracts/index.js";
```

---

