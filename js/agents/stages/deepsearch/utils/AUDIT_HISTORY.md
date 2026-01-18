# Audit History - utils

Archived issues from security audits.

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

