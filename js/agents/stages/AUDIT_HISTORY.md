# Audit History - stages

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] browser-compatibility
*Archived: 2026-01-18T21:44:25.359Z*

- **File**: js/agents/stages/textprep/normalize.js:22
- **Description**: normalizeText 在 TextEncoder 缺失时回退到 Buffer.from；旧浏览器无 Buffer 会直接抛错，违反“无 Node-only API”约束。
- **Suggestion**: 在 fallback 前检查 `typeof Buffer !== "undefined"`，或引入 TextEncoder polyfill/手写 UTF-8 编码，确保浏览器无 Buffer 时仍可运行。
```
const msg = enc ? enc.encode(str) : Uint8Array.from(Buffer.from(String(str), "utf8"));
```

### [RESOLVED] event-naming
*Archived: 2026-01-18T21:44:25.359Z*

- **File**: js/agents/stages/textprep/index.js:331
- **Description**: 事件名使用点分隔（如 textprep.normalize.completed），不符合约定的 domain:action 格式，可能导致监听器匹配失败。
- **Suggestion**: 统一改为 `textprep:normalizeCompleted` 或 `textprep:normalize.completed` 之类的 domain:action 形式，并同步更新事件监听端。
```
emit("textprep.normalize.completed", {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:44:25.359Z*

- **File**: js/agents/stages/deepsearch/stage-utils.js:13
- **Description**: 导出函数缺少 @param/@returns 注解（例如 makeStageEmitter、checkCancelled），影响 JSDoc 类型完整性。
- **Suggestion**: 为导出函数补充 `@param`/`@returns`，并明确 stageApi/actor/getContext 的类型。
```
export function makeStageEmitter(stageApi, actor = "deepsearch", getContext) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:44:25.359Z*

- **File**: js/agents/stages/textprep/constants.js:45
- **Description**: isValidPageType 缺少参数/返回值类型注解。
- **Suggestion**: 补充 `@param {unknown} value` 与 `@returns {boolean}`。
```
export function isValidPageType(value) {
```

### [RESOLVED] console-usage
*Archived: 2026-01-18T21:44:25.359Z*

- **File**: js/agents/stages/deepsearch/tools/task/handler.js:20
- **Description**: 生产代码中仍保留 console.warn，按规范应使用 logger 以避免噪声与一致性问题。
- **Suggestion**: 改为 createLogger 或注入的 logger（例如 stageApi.logger?.warn），保留上下文信息。
```
console.warn("[task/handler] subagents registration failed:", e);
```

### [RESOLVED] node-only-api
*Archived: 2026-01-18T21:44:25.359Z*

- **File**: js/agents/stages/codesearch/test.js:19
- **Description**: 测试文件直接导入 node:fs/node:url/node:path；若被打包进浏览器构建会失败（test-agent-loop.js 也有同样用法）。
- **Suggestion**: 确保测试文件不参与浏览器打包，或将其移动到 tests/ 并在构建中排除。
```
const { readFile, readdir, stat } = await import("node:fs/promises");
```

---

