# Audit History - routing

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] Style:magic-number
*Archived: 2026-01-20T04:20:21.811Z*

- **File**: js/agents/plugins/routing/performance-router.js:403
- **Description**: estimateComplexity 中使用 4/100/500 作为阈值，属于魔法数字，违反风格约定。
- **Suggestion**: 提取为命名常量（例如 TOKEN_CHAR_PER_TOKEN、SIMPLE_THRESHOLD、MODERATE_THRESHOLD）并集中管理。
```
  const tokenEstimate = Math.ceil(text.length / 4);
```

---

## Archived: 2026-01-20

### [RESOLVED] JSDoc
*Archived: 2026-01-20T04:20:09.602Z*

- **File**: js/agents/plugins/routing/performance-router.js:70
- **Description**: EwmaTracker.record 的 @param 缺少描述，不符合 JSDoc 规范要求。
- **Suggestion**: 补充参数描述，例如 `@param {number} sample - 新的延迟样本(ms)`。
```
   * @param {number} sample
```

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

