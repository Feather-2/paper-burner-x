# Audit History - routing

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] JSDoc Completeness
*Archived: 2026-01-18T19:33:12.736Z*

- **File**: js/agents/runtime/routing/performance-router.js:187
- **Description**: 多个 public API 的 JSDoc 缺少参数说明或返回类型过于宽泛（如 `@param {object} options`、`@returns {string}`）。
- **Suggestion**: 为 public API 补充参数说明、精确类型（如 `TaskComplexityType`）和返回值描述。
```
/**
 * @param {object} options
 * @param {number} [options.latencyThresholdMs=1000] - 延迟阈值
 * @param {boolean} [options.preferFastTier=true] - 优先快速层
 * @param {function} [options.onRouteDecision] - 路由决策回调
 */
```

---

## Archived: 2026-01-18

### [RESOLVED] Input Validation
*Archived: 2026-01-18T19:30:34.340Z*

- **File**: js/agents/runtime/routing/performance-router.js:210
- **Description**: registerEndpoint 直接写入 tier/weight，缺少合法性校验，可能导致评分为 NaN 或路由异常；recordResult 也未校验 latencyMs 类型与范围。
- **Suggestion**: 校验 tier 必须属于 ModelTier；weight 必须为有限数值并 clamp；对 latencyMs/endpointId 做类型与边界检查。
```
registerEndpoint(endpointId, { tier = ModelTier.POWER, weight = 1.0 } = {}) {
  if (!this._endpoints.has(endpointId)) {
    const stats = new EndpointStats(endpointId);
    stats.tier = tier;
    stats.weight = weight;
    this._endpoints.set(endpointId, stats);
  }
  return this;
}
```

---

## Archived: 2026-01-18

### [RESOLVED] Dead Config
*Archived: 2026-01-18T19:29:27.174Z*

- **File**: js/agents/runtime/routing/performance-router.js:193
- **Description**: `latencyThresholdMs` 仅保存到 `_latencyThreshold`，但未在任何路由逻辑中使用，可能是遗留或未完成实现。
- **Suggestion**: 若需要该阈值，请在评分/选择逻辑中使用；否则移除配置并同步文档。
```
constructor({
  latencyThresholdMs = DEFAULT_LATENCY_THRESHOLD_MS,
  preferFastTier = true,
  onRouteDecision,
} = {}) {
  this._latencyThreshold = latencyThresholdMs;
  this._preferFastTier = preferFastTier;
  this._onRouteDecision = typeof onRouteDecision === "function" ? onRouteDecision : null;
}
```

---

## Archived: 2026-01-18

### [RESOLVED] Prototype Pollution
*Archived: 2026-01-18T19:28:57.272Z*

- **File**: js/agents/runtime/routing/performance-router.js:301
- **Description**: getAllStats 使用普通对象并以 endpointId 作为键写入，若 endpointId 可控且为 `__proto__`/`constructor` 等特殊值，可能触发原型污染。
- **Suggestion**: 改用 `Object.create(null)`、`Map` 或数组返回；或在写入前过滤 `__proto__`/`constructor`/`prototype` 等危险键。
```
const result = {};
for (const [id, stats] of this._endpoints) {
  result[id] = stats.toJSON();
}
```

---

