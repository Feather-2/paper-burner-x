# Audit History - retrieval

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] Unsafe deserialization
*Archived: 2026-01-19T23:43:42.470Z*

- **File**: js/agents/retrieval/retrieval-router.js:120
- **Description**: 从持久化 store 读取的字符串未经大小/结构校验即 JSON.parse；若存储可被外部篡改，可能引发 DoS 或异常数据进入流程。
- **Suggestion**: 在解析前限制长度并校验 schema/version；解析失败时记录日志或返回诊断信息。
```
const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
```

---

## Archived: 2026-01-19

### [RESOLVED] Error handling
*Archived: 2026-01-19T23:43:11.504Z*

- **File**: js/agents/retrieval/hybrid-retrieval.js:122
- **Description**: hybridSearch 在 fallback=true 时吞掉检索异常，缺少日志/诊断信息，不利于排查检索质量问题。
- **Suggestion**: 在 fallback 分支记录错误（可注入 logger）或返回可选的诊断字段。
```
} catch {
  if (!fallback) throw new Error("hybridSearch: bm25 failed");
}
```

---

## Archived: 2026-01-19

### [RESOLVED] SSRF
*Archived: 2026-01-19T23:42:37.948Z*

- **File**: js/agents/retrieval/embeddings/embedding-service.js:262
- **Description**: EmbeddingService 直接对配置中的 endpoint 发起 fetch；若配置可被用户输入影响，在 Node 环境可能被用于访问内网/本机地址。
- **Suggestion**: 对 endpoint 做协议/主机 allowlist 校验或仅允许预配置服务；在 Node 环境拒绝内网/本地地址。
```
const endpoint = cfg.endpoint;
const res = await this._fetch(endpoint, {
  method: "POST",
```

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

