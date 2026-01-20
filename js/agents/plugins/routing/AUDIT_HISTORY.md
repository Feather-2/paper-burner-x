# Audit History - routing

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] InputValidation
*Archived: 2026-01-20T00:09:45.982Z*

- **File**: js/agents/plugins/routing/performance-router.js:346
- **Description**: setWeight 未验证 weight 是否为有限数字，非数字会导致权重为 NaN 并影响评分排序。
- **Suggestion**: 像 registerEndpoint 一样校验 Number.isFinite(weight)，无效时保持原值或回退到默认值。
```
      stats.weight = Math.max(0, Math.min(10, weight));
```

---

