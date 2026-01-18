# Audit History - formatters

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc: missing @param/@returns
*Archived: 2026-01-18T21:39:24.260Z*

- **File**: `js/agents/prompts/formatters/escape-template-delimiters.js:1`:1
- **Description**: 导出的 formatter 缺少完整 @param/@returns，违反 public API 的 JSDoc 规范。
- **Suggestion**: 补充 @param/@returns，并明确 value 的可接受类型与返回值含义。
```
/**
 * Escape `{{` and `}}` sequences inside interpolated values.
 */
export function escapeTemplateDelimiters(value) {
```

### [RESOLVED] JSDoc: missing @param/@returns
*Archived: 2026-01-18T21:39:24.260Z*

- **File**: `js/agents/prompts/formatters/format-bullets.js:1`:1
- **Description**: 导出的 formatter 缺少完整 @param/@returns，违反 public API 的 JSDoc 规范。
- **Suggestion**: 补充 @param/@returns，描述 value 与 options(bullet/indent) 的类型与用途。
```
/**
 * Format a value into a markdown-ish bullet list.
 */
export function formatBullets(value, { bullet = "- ", indent = "" } = {}) {
```

### [RESOLVED] JSDoc: missing @param/@returns
*Archived: 2026-01-18T21:39:24.260Z*

- **File**: `js/agents/prompts/formatters/format-code-block.js:1`:1
- **Description**: 导出的 formatter 缺少完整 @param/@returns，违反 public API 的 JSDoc 规范。
- **Suggestion**: 补充 @param/@returns，说明 value 与 lang 的处理规则。
```
/**
 * Format a value into a fenced markdown code block.
 */
export function formatCodeBlock(value, { lang = "" } = {}) {
```

### [RESOLVED] JSDoc: missing @param/@returns
*Archived: 2026-01-18T21:39:24.260Z*

- **File**: `js/agents/prompts/formatters/format-json.js:1`:1
- **Description**: 导出的 formatter 缺少完整 @param/@returns，违反 public API 的 JSDoc 规范。
- **Suggestion**: 补充 @param/@returns，说明 space 参数范围与默认值。
```
/**
 * Format a value as pretty JSON.
 */
export function formatJson(value, { space = 2 } = {}) {
```

### [RESOLVED] JSDoc: missing @param/@returns
*Archived: 2026-01-18T21:39:24.260Z*

- **File**: `js/agents/prompts/formatters/format-lines.js:1`:1
- **Description**: 导出的 formatter 缺少完整 @param/@returns，违反 public API 的 JSDoc 规范。
- **Suggestion**: 补充 @param/@returns，说明数组/字符串输入的输出格式。
```
/**
 * Format a value as newline-separated lines.
 */
export function formatLines(value) {
```

### [RESOLVED] Error handling: swallowed exception
*Archived: 2026-01-18T21:39:24.260Z*

- **File**: `js/agents/prompts/formatters/format-json.js:8`:8
- **Description**: JSON 序列化失败时直接吞掉异常并返回降级值，未记录或上抛，违反错误处理规范且不利于排障。
- **Suggestion**: 考虑记录错误（或通过可选回调上抛/透传），若必须降级返回也应向调用方暴露失败原因。
```
try {
  return JSON.stringify(value, null, n) ?? "";
} catch {
  return value == null ? "" : String(value);
}
```

---

