# Audit History - shared

Archived issues from security audits.

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

