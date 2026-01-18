# Audit History - constants

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:39:14.454Z*

- **File**: js/agents/runtime/constants/timeouts.js:69
- **Description**: getTimeout 的 JSDoc 缺少 key 与返回值描述，未满足 @param/@returns 必须带描述的规范。
- **Suggestion**: 为 key 参数与返回值补充描述，例如 `@param ... - 常量键名`、`@returns {number} 超时（毫秒）`。
```
/**
 * 根据场景获取超时时间
 * @param {keyof typeof TIMEOUTS} key
 * @param {number} [override] - 覆盖值
 * @returns {number}
 */
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:39:14.454Z*

- **File**: js/agents/runtime/constants/limits.js:89
- **Description**: getLimit 的 JSDoc 缺少 key/override/返回值描述，未满足项目 JSDoc 规范。
- **Suggestion**: 为 key、override 和返回值补充描述，说明键名与覆盖值的含义。
```
/**
 * 根据场景获取限制值
 * @param {keyof typeof LIMITS} key
 * @param {number} [override]
 * @returns {number}
 */
```

### [RESOLVED] JSDoc
*Archived: 2026-01-18T21:39:14.454Z*

- **File**: js/agents/runtime/constants/thresholds.js:70
- **Description**: getThreshold 的 JSDoc 缺少 key/override/返回值描述，未满足项目 JSDoc 规范。
- **Suggestion**: 为 key、override 和返回值补充描述，说明阈值键名与覆盖值的含义。
```
/**
 * 根据场景获取阈值
 * @param {keyof typeof THRESHOLDS} key
 * @param {number} [override]
 * @returns {number}
 */
```

---

