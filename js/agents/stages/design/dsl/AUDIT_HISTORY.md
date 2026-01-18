# Audit History - dsl

Archived issues from security audits.

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

