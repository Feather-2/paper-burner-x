# Audit History - report

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] input-validation
*Archived: 2026-01-19T20:40:56.841Z*

- **File**: js/agents/stages/deepsearch/report/report-postprocess.js:85
- **Description**: getReportConfig 合并 globalConfig/stateConfig 后未验证 requiredSections/recommendedSections 类型，若配置被污染为非数组会导致校验逻辑失真或异常。
- **Suggestion**: 对 merged.requiredSections/recommendedSections 使用 Array.isArray 校验，不符合时回退到 base；必要时深拷贝/归一化。
```
const merged = { ...base, ...(isPlainObject(globalConfig) ? globalConfig : {}), ...(isPlainObject(stateConfig) ? stateConfig : {}) };
return {
  minWords: merged.minWords ?? base.minWords,
  minReferences: merged.minReferences ?? base.minReferences,
  requiredSections: merged.requiredSections ?? base.requiredSections,
  recommendedSections: merged.recommendedSections ?? base.recommendedSections,
  sectionWordLimits: merged.sectionWordLimits || {},
};
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype-pollution
*Archived: 2026-01-19T20:40:45.041Z*

- **File**: js/agents/stages/deepsearch/report/report-postprocess.js:181
- **Description**: reviewReportMarkdown 使用用户可控的标题字符串作为对象键写入，可能触发 __proto__/constructor 等键导致原型污染或异常计数行为。
- **Suggestion**: 改用 Map 或 Object.create(null) 做计数，并在读取/写入时使用 get/set；或过滤危险键名。
```
const headingCounts = {};
for (const h of headings) headingCounts[h] = (headingCounts[h] || 0) + 1;
```

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

