# Audit History - plan

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] xss
*Archived: 2026-01-20T00:13:53.721Z*

- **File**: js/agents/plugins/plan/structured-plan.js:307
- **Description**: escapeTableCell 仅转义 `|` 和换行，`reason` 字段如果来自不可信输入，生成的 Markdown 表格可能注入 HTML/Markdown，后续渲染为 DOM 时存在 XSS 风险。
- **Suggestion**: 在表格单元格输出时复用 `escapeMarkdown` 或扩展转义 `<` `>` `[` `]` `(` `)` 等字符，并在 Markdown 渲染端禁用/清洗 HTML。
```
return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
```

### [RESOLVED] jsdoc
*Archived: 2026-01-20T00:13:53.721Z*

- **File**: js/agents/plugins/plan/plan-store.js:65
- **Description**: 导出 API 的 JSDoc 多处使用 `any` 且缺少 @param/@returns 描述，违反项目规范并降低类型约束。
- **Suggestion**: 为 public API 补齐具体类型与参数/返回值描述，避免 `any`（例如 `PlanLifecycleStatus | string`、`Plan`、`PlanStep`、`Record<string, unknown>`）。
```
* @param {any} value
```

### [RESOLVED] jsdoc
*Archived: 2026-01-20T00:13:53.721Z*

- **File**: js/agents/plugins/plan/structured-plan.js:225
- **Description**: 内部函数缺少 `@private` 标记且仍使用 `any`（如 normalizeRequirementsAnalysis），不符合项目 JSDoc 约定。
- **Suggestion**: 为内部函数添加 `@private`，并用具体/unknown 类型替换 `any`，同时补齐描述。
```
* @param {any} input
```

---

