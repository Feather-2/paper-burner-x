# Audit History - model

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] JSDoc incomplete
*Archived: 2026-01-20T00:27:10.733Z*

- **File**: js/agents/stages/deepsearch/model/caller.js:33
- **Description**: 公开 API `buildBaseCaller` 的 JSDoc 缺少参数/返回值描述，违反 JSDoc 规范要求。
- **Suggestion**: 为 @param/@returns 补充描述，必要时补充 @throws。
```
* @param {StageApiLike} stageApi
```

### [RESOLVED] JSDoc any type
*Archived: 2026-01-20T00:27:10.733Z*

- **File**: js/agents/stages/deepsearch/model/usage.js:17
- **Description**: 使用 @param {any} 违反“禁止 any 类型”的约定，导致输入约束不清晰。
- **Suggestion**: 定义 `@typedef TokenUsagePayload` 并用具体类型替代 any。
```
* @param {any} usage - Raw usage object from model provider
```

### [RESOLVED] Missing JSDoc
*Archived: 2026-01-20T00:27:10.733Z*

- **File**: js/agents/stages/deepsearch/model/pricing.js:8
- **Description**: 导出函数 `resolveModelPricing` 缺少完整 JSDoc，公共 API 未被文档化。
- **Suggestion**: 补充 JSDoc，明确 modelId/prices/返回值及错误条件。
```
export function resolveModelPricing(modelId, prices) {
```

### [RESOLVED] JSDoc incomplete
*Archived: 2026-01-20T00:27:10.733Z*

- **File**: js/agents/stages/deepsearch/model/pricing.js:30
- **Description**: `estimateCostUSDDelta` 的 @param 使用内联 object 且缺少描述，`prices?:object` 类型过于宽泛。
- **Suggestion**: 抽出 @typedef（如 EstimateCostParams/PricingTable），并为 @param/@returns 添加描述。
```
* @param {{model?:string, usage?:{input?:number,output?:number}, prices?:object}=} params
```

### [RESOLVED] Magic number
*Archived: 2026-01-20T00:27:10.733Z*

- **File**: js/agents/stages/deepsearch/model/pricing.js:45
- **Description**: 成本计算中直接使用 `1000`，与“避免魔法数字”约定冲突。
- **Suggestion**: 引入常量（如 TOKENS_PER_1K = 1000）并替换。
```
(Math.max(0, inputTokens) / 1000) * Math.max(0, inputPer1K)
```

### [RESOLVED] Event naming
*Archived: 2026-01-20T00:27:10.733Z*

- **File**: js/agents/stages/deepsearch/model/budget.js:109
- **Description**: 预算事件名使用点号格式，不符合约定的 `domain:action` 格式。
- **Suggestion**: 如无兼容性约束，改为 domain:action 风格；否则在文档中声明例外。
```
emit?.("deepsearch.budget.warning", {
```

### [RESOLVED] Function length
*Archived: 2026-01-20T00:27:10.733Z*

- **File**: js/agents/stages/deepsearch/model/budget.js:76
- **Description**: `emitBudgetEvents` 超过 50 行，违反单一职责/长度约定，后续维护风险增加。
- **Suggestion**: 拆分预算解析/阈值判断/事件发送为多个小函数。
```
export function emitBudgetEvents({ emit, state, budget, totalTokens, totalCostUSD } = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] input-validation
*Archived: 2026-01-18T21:31:58.636Z*

- **File**: js/agents/stages/deepsearch/model/budget.js:31
- **Description**: budget 输入仅做数字转换，没有范围校验，允许负值或 warnAt > 1，可能导致预警/超额逻辑失效或过早触发。
- **Suggestion**: 对 maxTokens/maxCostUSD 进行 >=0 校验，并将 warnAt clamp 到 [0,1]；非法配置时回退到默认值或记录告警。
```
const maxTokens = safeInt(budget?.maxTokens);\nconst maxCostUSD = safeNumber(budget?.maxCostUSD);\nconst warnAt = safeNumber(budget?.warnAt) ?? 0.8;
```

### [RESOLVED] style-magic-number
*Archived: 2026-01-18T21:31:58.636Z*

- **File**: js/agents/stages/deepsearch/model/budget.js:33
- **Description**: warnAt 默认值直接使用 0.8，违反避免魔法数字的约定，可读性不足。
- **Suggestion**: 提取为命名常量如 DEFAULT_WARN_AT，并在文件顶部集中定义。
```
const warnAt = safeNumber(budget?.warnAt) ?? 0.8;
```

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T21:31:58.636Z*

- **File**: js/agents/stages/deepsearch/model/budget.js:8
- **Description**: export 的 ensureBudgetState 缺少完整 JSDoc（@param/@returns），不符合公共 API 规范。
- **Suggestion**: 为 ensureBudgetState 添加 JSDoc，明确 state 类型与返回值（可为 null）。
```
export function ensureBudgetState(state) {
```

### [RESOLVED] jsdoc-type
*Archived: 2026-01-18T21:31:58.636Z*

- **File**: js/agents/stages/deepsearch/model/budget.js:24
- **Description**: emitBudgetEvents 的 @param 无描述且使用泛型 Function/object，违反 JSDoc 规范与“禁止 any 类型”的约定。
- **Suggestion**: 定义 EmitFn/Budget 等 @typedef，并在 @param 后补充简要描述。
```
* @param {{emit?:Function,state?:object,budget?:object,totalTokens?:number,totalCostUSD?:number}=} params
```

### [RESOLVED] jsdoc-any
*Archived: 2026-01-18T21:31:58.636Z*

- **File**: js/agents/stages/deepsearch/model/caller.js:36
- **Description**: 使用 `@type {any}` 绕过类型约束，违反禁止 any 的约定。
- **Suggestion**: 为 opts 定义具体类型（如 Record<string, unknown>）或使用更窄的类型断言。
```
const forwardOpts = /** @type {any} */ (opts && typeof opts === "object" ? opts : {});
```

---

