# Audit History - shared

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 测试覆盖
*Archived: 2026-01-19T23:55:04.179Z*

- **File**: `js/agents/shared/utils/file-watcher.js`:141
- **Description**: FileWatcher 未发现单元测试，polling/native 逻辑、错误路径与资源清理缺少覆盖，难以满足 90% 覆盖率目标。
- **Suggestion**: 新增 `tests/unit/agents/shared/utils/file-watcher.test.js`，覆盖空路径、vfs fallback、start/stop 并发、watcher/定时器清理等边界场景。
```
export class FileWatcher extends DisposableBase {
```

---

## Archived: 2026-01-19

### [RESOLVED] 浏览器兼容性/Node-only API
*Archived: 2026-01-19T23:51:16.635Z*

- **File**: `js/agents/shared/utils/file-watcher.js`:67
- **Description**: shared 模块内动态导入 `node:fs`，即使捕获异常也可能在浏览器构建阶段被 bundler 解析失败，违反 browser-first 约束。
- **Suggestion**: 将 Node 专用实现拆到独立入口并使用 conditional exports，或在 `isNodeLike()` 判定后再引入 Node-only 文件，确保浏览器构建不会解析 `node:fs`。
```
const fsSpecifier = "node:fs";
const mod = await import(/* @vite-ignore */ fsSpecifier);
```

---

## Archived: 2026-01-19

### [RESOLVED] 日志规范/错误信息泄露
*Archived: 2026-01-19T23:50:28.981Z*

- **File**: `js/agents/shared/utils/event-emitter.js`:98
- **Description**: EventEmitter 在监听器异常时直接 console.error 输出原始错误，可能暴露内部堆栈且绕过统一日志治理（同类 console 输出在 shared 里还有多处）。
- **Suggestion**: 改用 `createLogger()` 或注入 logger，并在生产环境做错误脱敏/分级处理。
```
try {
  listener(...args);
} catch (err) {
  console.error(`[EventEmitter] Error in listener for "${key}":`, err);
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 不安全的反序列化
*Archived: 2026-01-19T23:49:05.985Z*

- **File**: `js/agents/shared/utils/stage-api.js`:259
- **Description**: createRunTool 对 modelRouter 返回的字符串直接执行 JSON.parse，没有长度限制或结构校验，属于未验证外部数据的反序列化，可能导致异常/DoS 或将非预期结构传入后续流程。
- **Suggestion**: 使用 `parseJsonStrict`/`safeJsonParse` 加入 maxChars 限制，并结合 `schema-validator` 对 toolSchemas 做结构验证；解析失败时返回可控错误或触发重试。
```
const content = result?.choices?.[0]?.message?.content || result?.content;
if (typeof content === "string") {
  return JSON.parse(content);
}
```

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:43:32.651Z*

- **File**: js/agents/shared/utils/error-classifier.js:81
- **Description**: DeepSearch/Design 错误分类相关导出缺少 @param/@returns 类型注解，违反模块 JSDoc 约定。
- **Suggestion**: 为 classifyDeepSearchError、isNonRecoverableDeepSearchError、toDeepSearchErrorMessage、isNonRetryableError 补充完整 JSDoc 类型注解。
```
export function classifyDeepSearchError(err) {
  const chain = collectCauseChain(err);
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:43:32.651Z*

- **File**: js/agents/shared/utils/safe-regex.js:69
- **Description**: safeMatch 缺少参数/返回值类型注解。
- **Suggestion**: 补充 @param/@returns，并说明 regex 类型及返回值格式。
```
export function safeMatch(text, regex, timeoutMs = DEFAULT_TIMEOUT_MS) {
  void timeoutMs;
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:43:32.651Z*

- **File**: js/agents/shared/embeddings/embedding-service.js:137
- **Description**: EmbeddingService 辅助导出 normalizeEmbeddingConfig/createEmbeddingService 缺少类型注解。
- **Suggestion**: 为 normalizeEmbeddingConfig 和 createEmbeddingService 添加 @param/@returns 类型说明。
```
export function normalizeEmbeddingConfig(raw) {
  const cfg = isPlainObject(raw) ? raw : null;
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:43:32.651Z*

- **File**: js/agents/shared/parser/tree-sitter-wasm.js:65
- **Description**: loadTreeSitterLanguage 导出缺少 JSDoc 类型注解。
- **Suggestion**: 补充 wasmFileName 与 options 的 @param 定义，以及 @returns 类型。
```
export async function loadTreeSitterLanguage(wasmFileName, { wasmBaseUrl = DEFAULT_TREE_SITTER_WASM_BASE_URL } = {}) {
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:43:32.651Z*

- **File**: js/agents/shared/utils/budget.js:148
- **Description**: createBudgetManager 缺少参数/返回值类型注解。
- **Suggestion**: 补充 userConfig 的结构与返回 BudgetManager 的类型注解。
```
export function createBudgetManager(userConfig = {}) {
  const budgetConfig = /** @type {any} */ (userConfig?.budget || {});
```

---

