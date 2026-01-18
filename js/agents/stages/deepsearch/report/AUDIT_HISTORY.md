# Audit History - report

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] 质量-正则状态
*Archived: 2026-01-18T20:45:22.588Z*

- **File**: `js/agents/stages/deepsearch/report/citations.js:35`:35
- **Description**: 全局 /g 正则在 extractEvidenceIdsFromMarkdownCitations 中未重置 lastIndex；跨调用可能跳过匹配，导致引用 ID 丢失。
- **Suggestion**: 在循环前设置 `CITE_REGEX.lastIndex = 0`，或改用 `for (const m of src.matchAll(/.../g))` 避免共享状态。
```
while ((m = CITE_REGEX.exec(src))) {
```

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc规范
*Archived: 2026-01-18T20:41:56.491Z*

- **File**: `js/agents/stages/deepsearch/report/citations.js:11`:11
- **Description**: 导出函数的 JSDoc 不完整且存在 `any`：例如 formatQuoteForCitation 缺少注解，且 report-generator/citations 的类型声明含 any（如 #L120、#L47）。
- **Suggestion**: 为公开函数补齐 @param/@returns，并用 @typedef 明确 EvidenceRow/SourceRow/TodoItem/PlaceholderReport，替换 any。
```
export function formatQuoteForCitation(quote, { maxLen = 200 } = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] 不安全的反序列化
*Archived: 2026-01-18T20:41:05.632Z*

- **File**: `js/agents/stages/deepsearch/report/report-generator.js:532`:532
- **Description**: LLM 返回内容直接 JSON.parse，未做 schema/大小校验；同类解析还出现在 TOC 与章节解析分支（约 #L607、#L718）。
- **Suggestion**: 改用 `safeJsonParse` 并设定 maxChars；随后用显式类型守卫/结构校验（只保留允许字段），避免超大或畸形结构影响流程。
```
parsed = JSON.parse(candidate);
```

---

