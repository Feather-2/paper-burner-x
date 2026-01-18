# Audit History - policy

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T21:22:00.141Z*

- **File**: js/agents/runtime/policy/manager.js:80
- **Description**: defaultDeriveRuleFromRequest 未校验 type/tool/resource 是否为空，审批“记住”时可能生成过宽 allow 规则（缺少 type 会匹配所有类型）。
- **Suggestion**: 在派生规则前强制要求 type（或至少 type/tool/resource 之一）有效；若缺失则返回 null 或抛错，避免写入过宽规则。
```
function defaultDeriveRuleFromRequest(req) {
  const type = toNonEmptyString(req?.type);
  const tool = toNonEmptyString(req?.tool);
  const resource = toNonEmptyString(req?.resource);
  const rule = {
    ruleId: makeSecureTimestampedId("rule"),
    effect: "allow",
    type,
    ...(tool ? { tool: tool } : {}),
    ...(resource ? { resource: resource } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    enabled: true,
    priority: 0,
  };
  return rule;
}
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:22:00.141Z*

- **File**: js/agents/runtime/policy/engine.js:10
- **Description**: JSDoc 使用 any 类型，违反“禁止 any”约定，降低类型约束。
- **Suggestion**: 改为显式字段类型或使用 Record<string, unknown> 并补充字段说明。
```
* @typedef {Record<string, any>} PolicyRuleInput
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:22:00.141Z*

- **File**: js/agents/runtime/policy/store.js:4
- **Description**: JSDoc 使用 any 类型，违反“禁止 any”约定，降低类型约束。
- **Suggestion**: 改为显式字段类型或使用 Record<string, unknown> 并补充字段说明。
```
* @typedef {Record<string, any>} PolicyRule
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:22:00.141Z*

- **File**: js/agents/runtime/policy/manager.js:149
- **Description**: JSDoc 使用 any 类型，违反“禁止 any”约定，降低类型约束。
- **Suggestion**: 为 ruleStore/engine/runStore 定义明确接口类型（如 PolicyRuleStore、PolicyEngine、RunStoreLike）。
```
* @param {any} [options.ruleStore]
* @param {any} [options.engine]
* @param {any} [options.runStore]
```

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:22:00.141Z*

- **File**: js/agents/runtime/policy/manager.js:68
- **Description**: sha256OfJson 捕获异常后直接返回 null，错误被吞掉，难以发现哈希失败原因。
- **Suggestion**: 记录错误或重新抛出；如需降级，至少在日志中保留原因。
```
async function sha256OfJson(value) {
  try {
    return await computeSha256(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}
```

---

