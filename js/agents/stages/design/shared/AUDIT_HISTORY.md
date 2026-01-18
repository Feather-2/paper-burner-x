# Audit History - shared

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-any
*Archived: 2026-01-18T19:32:59.578Z*

- **File**: js/agents/stages/design/shared/design-utils.js:31
- **Description**: safeNumber 使用 @param {*} 等效 any，违反 JSDoc 规范。
- **Suggestion**: 替换为明确类型（如 @param {number|unknown} n 并在函数内做显式收窄，@param {number|null} [fallback=null]）。
```
* @param {*} n - value to parse
```

---

## Archived: 2026-01-18

### [RESOLVED] function-size
*Archived: 2026-01-18T19:32:18.907Z*

- **File**: js/agents/stages/design/shared/html-parser.js:10
- **Description**: parseTagAttributes 约 70 行，超过“函数不超过 50 行”的约定。
- **Suggestion**: 拆分为扫描属性名/属性值的辅助函数以降低复杂度。
```
export function parseTagAttributes(tag) {
```

---

## Archived: 2026-01-18

### [RESOLVED] prototype-pollution
*Archived: 2026-01-18T19:32:18.704Z*

- **File**: js/agents/stages/design/shared/design-utils.js:121
- **Description**: extractElements 将 HTML 属性名写入普通对象；用户可控的键可能触发原型污染。
- **Suggestion**: 将 attrs 初始化为 Object.create(null) 并跳过危险键，或改用 Map 存储属性。
```
attrs[am[1]] = am[2];
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T19:32:02.123Z*

- **File**: js/agents/stages/design/shared/design-utils.js:13
- **Description**: 多处导出函数缺少完整 JSDoc（@param/@returns），不符合公共 API 规范。
- **Suggestion**: 为 clamp/nowMs/parseSections/joinSections/extractElements/escapeHtml/hexToRgb/clearParseCache 补齐完整 JSDoc。
```
/**
 * Safely clamps a number between min and max.
 */
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-any
*Archived: 2026-01-18T19:32:01.258Z*

- **File**: js/agents/stages/design/shared/safe-emit.js:2
- **Description**: safeEmit 的 JSDoc 使用 any，违反项目“禁止 any”的规范。
- **Suggestion**: 定义明确的 payload typedef（如 Record<string, unknown> 或具体事件联合类型），并在 EmitFn/参数中使用。
```
@typedef {(name: string, event: { actor: string, status: string, payload: any }) => void} EmitFn
```

---

## Archived: 2026-01-18

### [RESOLVED] prototype-pollution
*Archived: 2026-01-18T19:32:00.399Z*

- **File**: js/agents/stages/design/shared/html-parser.js:48
- **Description**: parseTagAttributes 将属性名直接写入普通对象；若输入包含 __proto__/constructor 等键，会污染对象原型并影响下游逻辑。
- **Suggestion**: 使用 Object.create(null) 作为 attrs，且在写入前过滤 __proto__/constructor/prototype 等危险键。
```
attrs[name] = "";
```

---

