# Audit History - dsl

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] XSS/attribute injection
*Archived: 2026-01-20T00:11:33.379Z*

- **File**: js/agents/stages/design/dsl/dsl-builder.js:467
- **Description**: data-bg 直接使用 designSystem 的 colors.bg，未做转义或颜色校验；若该值来自用户输入，可能造成属性注入/XSS。该问题在 buildSlideHtml 与 buildFromLayoutJson 两处出现。
- **Suggestion**: 对 colors.bg 进行 sanitizeColor 或至少 escapeHtml；并在设计系统入口处校验 token 只允许合法颜色格式。
```
<section data-type="freeform" data-layout="${escapeHtml(layout)}" id="${escapeHtml(rawId)}" data-title="${escapeHtml(title)}" data-bg="${colors.bg}">
```

### [RESOLVED] Input validation/robustness
*Archived: 2026-01-20T00:11:33.379Z*

- **File**: js/agents/stages/design/dsl/dsl-builder.js:546
- **Description**: table/chart 分支直接 JSON.stringify(e.content)，遇到循环引用或不可序列化对象会抛异常并中断构建。
- **Suggestion**: 在 stringify 处加 try/catch 并提供安全兜底值（如 "[]"/"{}"），或预先验证数据为可序列化纯对象。
```
e.content && typeof e.content !== "string" ? JSON.stringify(e.content) : String(e.content || "").trim() || "[]";
```

---

## Archived: 2026-01-18

### [RESOLVED] security
*Archived: 2026-01-18T21:51:07.898Z*

- **File**: js/agents/stages/design/dsl/dsl-builder.js:88
- **Description**: buildFromLayoutJson 将 layoutJson.bounds/style 直接拼入 data-* 属性，未转义或严格校验；若 layoutJson 可被外部输入控制，可能造成属性注入/XSS。
- **Suggestion**: 对 x/y/w/h 及 color/fill/stroke 等属性做白名单校验（如仅允许数字+% 或安全颜色值），并在 makeTextEl/makeShapeEl 等处统一转义/规范化。
```
const attrs = [
  `data-el="text"`,
  `data-x="${x}"`,
  `data-y="${y}"`,
  `data-w="${w}"`,
  `data-h="${h}"`,
];
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:51:07.898Z*

- **File**: js/agents/stages/design/dsl/dsl-rules.js:65
- **Description**: 导出函数 clearDslRulesCache 缺少 @returns 注解，未完全满足导出 API 的 JSDoc 完整性要求。
- **Suggestion**: 为 clearDslRulesCache 添加 @returns {void} 注解。
```
/**
 * 清除缓存 (用于测试或热更新)
 */
export function clearDslRulesCache() {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:51:07.898Z*

- **File**: js/agents/stages/design/dsl/dsl-rules.js:95
- **Description**: 导出常量 DSL_RULES 缺少类型注解，外部调用难以明确其字符串语义。
- **Suggestion**: 为 DSL_RULES 添加 JSDoc 类型（例如 @type {string} 或更具体的字符串 getter 结构）。
```
export const DSL_RULES = new Proxy({}, {
  get(target, prop) {
```

---

