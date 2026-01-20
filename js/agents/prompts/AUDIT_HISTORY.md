# Audit History - prompts

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] error-handling
*Archived: 2026-01-20T00:22:28.990Z*

- **File**: js/agents/prompts/prompt-loader.js:413
- **Description**: 加载 manifest 时的异常被静默忽略，失败原因不可见，违反“不要吞掉异常”的约定，可能导致提示词加载异常难以排查。
- **Suggestion**: 记录日志或通过回调/返回值暴露失败原因；如需降级，可用 debug 级别日志。
```
      } catch {
        // continue
      }
```

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:39:52.315Z*

- **File**: js/agents/prompts/prompt-template.js:139
- **Description**: 导出函数 renderPromptTemplate 缺少 @param/@returns 类型注解，JSDoc 覆盖不足。
- **Suggestion**: 为 template/options 增加 @param 注解，并补充 @returns {string}。
```
export function renderPromptTemplate(
  template,
  /** @type {RenderPromptTemplateOptions} */ {
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:39:52.315Z*

- **File**: js/agents/prompts/prompt-loader.js:843
- **Description**: prompt-loader.js 的 renderPromptTemplate 对外导出但缺少 @param/@returns 类型注解。
- **Suggestion**: 补充 @param {string} template、@param {RenderPromptTemplateOptions} [options]、@returns {string}。
```
export function renderPromptTemplate(
  template,
  /** @type {RenderPromptTemplateOptions} */ {
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:39:52.315Z*

- **File**: js/agents/prompts/formatters/format-bullets.js:8
- **Description**: formatters 下导出函数缺少 @param/@returns JSDoc 类型注解（format-bullets 等）。
- **Suggestion**: 为 formatters/* 导出函数添加 @param/@returns，并为 options 增加 @typedef。
```
export function formatBullets(value, { bullet = "- ", indent = "" } = {}) {
```

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:39:52.315Z*

- **File**: js/agents/prompts/formatters/escape-template-delimiters.js:11
- **Description**: 使用 String.prototype.replaceAll；若需兼容旧版浏览器可能不可用（prompt-loader.js 中同样使用该 API）。
- **Suggestion**: 改用正则替换或 split/join，或在浏览器支持矩阵中声明仅支持现代浏览器。
```
return s.replaceAll("{{", `{\u200B{`).replaceAll("}}", `}\u200B}`);
```

---

