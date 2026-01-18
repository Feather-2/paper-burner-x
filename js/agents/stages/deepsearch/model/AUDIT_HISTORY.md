# Audit History - model

Archived issues from security audits.

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

