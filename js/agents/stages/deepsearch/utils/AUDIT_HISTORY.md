# Audit History - utils

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] JSDoc type safety
*Archived: 2026-01-20T00:26:53.779Z*

- **File**: `js/agents/stages/deepsearch/utils/stage-api.js`:55
- **Description**: Public API JSDoc 使用 `any`/`Record<string, any>` 且缺少参数描述，违反规范并削弱类型约束。
- **Suggestion**: 将 `any` 替换为 `unknown`/明确类型，并补全 `@param ... - 描述`。
```
@param {any} api
```

### [RESOLVED] JSDoc type safety
*Archived: 2026-01-20T00:26:53.779Z*

- **File**: `js/agents/stages/deepsearch/utils/state-utils.js`:7
- **Description**: 公共导出的 JSDoc 参数类型为 `any` 且缺少描述，不符合 JSDoc 规范要求。
- **Suggestion**: 为 `normalizeTokenUsage`/`ensureTokenUsage`/`normalizeBudgetConfig`/`stripThinkingTags` 标注具体类型并补全描述。
```
@param {any} usage
```

### [RESOLVED] JSDoc type safety
*Archived: 2026-01-20T00:26:53.779Z*

- **File**: `js/agents/stages/deepsearch/utils/todo-utils.js`:109
- **Description**: 公共 API 仍使用 `any`，且参数说明缺失，降低类型可读性与约束。
- **Suggestion**: 将 `any` 替换为具体类型/`unknown`，并补全 public API 的参数描述。
```
@param {Partial<DeepSearchTodo> & Record<string, any>} [params]
```

### [RESOLVED] JSDoc @private missing
*Archived: 2026-01-20T00:26:53.779Z*

- **File**: `js/agents/stages/deepsearch/utils/state-utils.js`:71
- **Description**: 内部 helper 未标记 `/** @private */`，不符合私有函数标注要求。
- **Suggestion**: 在 `normalizeBudgetAction`、`normalizeModelPrices` 前添加 `/** @private */`。
```
function normalizeBudgetAction(v) {
```

### [RESOLVED] JSDoc @private missing
*Archived: 2026-01-20T00:26:53.779Z*

- **File**: `js/agents/stages/deepsearch/utils/todo-utils.js`:47
- **Description**: 多个内部 helper 未标记 `/** @private */`。
- **Suggestion**: 为 `normalizeStringArray`/`normalizePriority`/`normalizeSource`/`normalizeStatus`/`isIsoString`/`deriveTodoIdFromGapId` 添加 `/** @private */`。
```
function normalizeStringArray(value) {
```

### [RESOLVED] Function size
*Archived: 2026-01-20T00:26:53.779Z*

- **File**: `js/agents/stages/deepsearch/utils/todo-utils.js`:107
- **Description**: `createTodo` 超过 50 行且涵盖多个职责，违反函数长度与单一职责要求。
- **Suggestion**: 拆分为若干私有 helper（如 buildTodoId/buildHistory/normalizeFields），保持每个函数 <= 50 行。
```
export function createTodo(params = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-any
*Archived: 2026-01-18T19:31:14.892Z*

- **File**: js/agents/stages/deepsearch/utils/stage-api.js:25
- **Description**: StageApi 及相关公共 API 的 JSDoc 使用 `any`，违反“禁止 any 类型”的规范，降低接口契约清晰度。
- **Suggestion**: 为事件 payload、模型调用参数等定义具体 typedef，并替换 `any`/`Record<string, any>`。
```
* @property {(eventName:string, payload:any)=>void} emit
```

---

## Archived: 2026-01-18

### [RESOLVED] event-name-format
*Archived: 2026-01-18T19:30:47.140Z*

- **File**: js/agents/stages/deepsearch/utils/todo-utils.js:234
- **Description**: 事件名使用点分隔格式，不符合项目要求的 `domain:action` 事件命名规范。
- **Suggestion**: 改为 `domain:action` 风格（如 `deepsearch:todo.status.changed`），并同步更新对应监听方。
```
emit?.("deepsearch.todo.status.changed", {
```

---

## Archived: 2026-01-18

### [RESOLVED] sensitive-data-logging
*Archived: 2026-01-18T19:30:10.335Z*

- **File**: js/agents/stages/deepsearch/utils/todo-utils.js:120
- **Description**: 当 text 为空时记录原始输入的 JSON 字符串，若输入包含敏感字段可能泄露到日志。
- **Suggestion**: 仅记录元数据（如 todoId、字段存在性），或对敏感字段进行脱敏/白名单化。
```
logger.warn(`[createTodo] Creating todo ${todoId} with empty text:`, { raw: JSON.stringify(raw).slice(0, 200) });
```

---

## Archived: 2026-01-18

### [RESOLVED] prototype-pollution
*Archived: 2026-01-18T19:29:55.849Z*

- **File**: js/agents/stages/deepsearch/utils/state-utils.js:87
- **Description**: normalizeModelPrices 使用用户可控的 modelId 作为对象键写入普通对象，若传入 `__proto__`/`constructor` 等键可导致原型污染，且后续会合并到价格表。
- **Suggestion**: 将容器改为 `Object.create(null)` 或 `new Map()`，并显式拒绝 `__proto__`/`constructor`/`prototype` 等危险键后再赋值，再进行合并。
```
out[String(modelId)] = { ...(input !== null ? { input: Math.max(0, input) } : {}), ...(output !== null ? { output: Math.max(0, output) } : {}), };
```

---

