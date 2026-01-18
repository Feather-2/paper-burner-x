# Audit History - retrieval

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] security
*Archived: 2026-01-18T21:39:49.511Z*

- **File**: js/agents/retrieval/grep.js:4
- **Description**: 当调用方传入 RegExp 实例时会绕过安全正则校验，若该 RegExp 来自不可信输入，可能触发 ReDoS（灾难性回溯）导致浏览器卡死。
- **Suggestion**: 若 RegExp 可能来源于用户输入，建议对 pattern.source 走同样的安全校验（或只接受字符串并统一走 createSafeRegex），并在校验失败时拒绝执行。
```
function compileRegex(pattern, caseSensitive) {
  if (pattern instanceof RegExp) {
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    const wantI = !caseSensitive;
    const hasI = flags.includes("i");
    const outFlags = wantI && !hasI ? flags + "i" : !wantI && hasI ? flags.replace(/i/g, "") : flags;
    return new RegExp(pattern.source, outFlags);
  }
  const src = String(pattern || "");
  const flags = caseSensitive ? "gu" : "giu";
  return createSafeRegex(src, flags);
}
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:39:49.511Z*

- **File**: js/agents/retrieval/tool-chain.js:396
- **Description**: search 的 JSDoc 返回类型与实际返回不匹配：校验失败时返回 createValidationError，但文档未声明错误返回结构，容易误用。
- **Suggestion**: 将 @returns 改为联合类型（成功结果 | ValidationError），或统一返回带 ok 标记的结构以与 JSDoc 一致。
```
/**
 * @returns {Promise<{results: Array, stats: object, strategy: string, fallbackReason?: string}>}
 */
export async function search(chunks, query = {}, tools = {}) {
  // Fail-fast: schema validation
  const chunksValidation = validateChunks(chunks, { allowEmpty: false, maxErrors: 5 });
  if (!chunksValidation.ok) {
    return createValidationError(
      ValidationErrorCode.INVALID_CHUNKS,
      "Invalid chunks structure",
      { errors: chunksValidation.errors }
    );
  }
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:39:49.511Z*

- **File**: js/agents/retrieval/retrieval-router.js:423
- **Description**: 导出的 retrieveAsync 缺少 @param/@returns 类型注解，JSDoc 覆盖不完整。
- **Suggestion**: 补充 @param/@returns（或 @see retrieve + 引用相同类型定义）以满足模块 JSDoc 注解完整性要求。
```
/**
 * Backward-compatible alias for async-only retrieval.
 */
export async function retrieveAsync(sourceIndex, gaps, config = {}) {
  return retrieve(sourceIndex, gaps, config);
}
```

---

