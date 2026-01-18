# Audit History - plan

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc any types
*Archived: 2026-01-18T21:44:08.013Z*

- **File**: js/agents/runtime/plan/plan-store.js:13
- **Description**: Plan/PlanStep schema 使用 Record<string, any>，违反禁止 any 的规范并模糊 meta 结构。
- **Suggestion**: 定义具体 meta 类型或使用 Record<string, unknown> 并补充字段说明。
```
* @property {Record<string, any>} [meta]
```

### [RESOLVED] JSDoc any types
*Archived: 2026-01-18T21:44:08.013Z*

- **File**: js/agents/runtime/plan/structured-plan.js:84
- **Description**: StructuredPlan meta 使用 Record<string, any>，同样违反禁止 any 的规范。
- **Suggestion**: 替换为明确的 meta typedef 或 Record<string, unknown>。
```
* @property {Record<string, any>} [meta] - 元数据
```

### [RESOLVED] JSDoc missing descriptions
*Archived: 2026-01-18T21:44:08.013Z*

- **File**: js/agents/runtime/plan/plan-store.js:33
- **Description**: @param/@returns 缺少描述（示例：toIso），不符合 JSDoc 描述要求。
- **Suggestion**: 为参数与返回值补充描述，并确保对外 API 具备完整 JSDoc。
```
* @param {string | number | Date | null} [timestamp]
 * @returns {string}
```

### [RESOLVED] Private helper not marked
*Archived: 2026-01-18T21:44:08.013Z*

- **File**: js/agents/runtime/plan/plan-store.js:36
- **Description**: 内部辅助函数未标注 /** @private */（例如 toIso），不符合约定。
- **Suggestion**: 为内部函数添加 @private 标记或改为显式导出。
```
function toIso(timestamp) {
```

### [RESOLVED] Function too long
*Archived: 2026-01-18T21:44:08.013Z*

- **File**: js/agents/runtime/plan/structured-plan.js:287
- **Description**: structuredPlanToMarkdown 超过 50 行且包含多层分支，违背单一职责与长度约束。
- **Suggestion**: 拆分为 requirements/decisions/steps/risks/criticalFiles 等子渲染函数。
```
export function structuredPlanToMarkdown(plan) {
```

### [RESOLVED] Potential XSS via Markdown
*Archived: 2026-01-18T21:44:08.013Z*

- **File**: js/agents/runtime/plan/structured-plan.js:308
- **Description**: 用户输入直接插入 Markdown（如需求描述），若后续在浏览器中以不安全方式渲染为 HTML，可能导致 XSS。
- **Suggestion**: 渲染前进行转义/净化，或确保 Markdown 渲染器启用安全模式。
```
lines.push(`- **[${r.priority}]** ${r.description}`);
```

---

