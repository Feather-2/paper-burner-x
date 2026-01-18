# Audit History - refiner

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] security:xss
*Archived: 2026-01-18T22:04:11.447Z*

- **File**: js/agents/stages/design/refiner/react-refiner-tools.js:520
- **Description**: applyAttrChanges 直接写入任意属性，调用方可设置 on* 事件或 javascript: URL，浏览器渲染时可能触发 XSS。
- **Suggestion**: 对白名单属性（data-* / class / id / aria-*）放行，拦截 on* / href / src / style 或校验其值（复用 isDangerousUrl/isDangerousStyle），必要时在应用后运行 sanitizeElementTree。
```
if (v === null || v === undefined) el.removeAttribute(key); else el.setAttribute(key, String(v));
```

### [RESOLVED] security:xss
*Archived: 2026-01-18T22:04:11.447Z*

- **File**: js/agents/stages/design/refiner/batch-repair-agent.js:111
- **Description**: runSingleSlideRepair 仅去除代码围栏后直接返回模型 HTML，可能注入 script/事件属性并进入渲染链路。
- **Suggestion**: 返回前使用 sanitizeHtmlFragment/DOMPurify 净化，或改为通过 editSlide/editElement 工具链应用变更。
```
let fixed = (response.text || "").replace(/```html/g, "").replace(/```/g, "").trim(); return fixed.includes("<section") ? fixed : currentHtml;
```

### [RESOLVED] quality:event-naming
*Archived: 2026-01-18T22:04:11.447Z*

- **File**: js/agents/stages/design/refiner/react-refiner.js:326
- **Description**: 事件名使用点号/下划线（如 design.refine.step），不符合约定的 domain:action 格式。
- **Suggestion**: 统一改为 domain:action（如 design:refine.step/design:repair.progress/design:batchRepair.step），并同步更新订阅方。
```
emit?.("design.refine.step", { stepIndex, error: String(err?.message || err), phase: "model_call" }, { status: "error" });
```

### [RESOLVED] quality:jsdoc
*Archived: 2026-01-18T22:04:11.447Z*

- **File**: js/agents/stages/design/refiner/batch-repair-agent.js:14
- **Description**: runBatchRepair 的 JSDoc 缺少 @returns，类型信息不完整。
- **Suggestion**: 补充 @returns {Promise<{ finalDeck: object, steps: object[], qualityScore: number, toolCalls: object[], terminationReason: string }>}（或对实际返回结构建模）。
```
* @param {object} params - { deckPackage, qaIssues, styleIssues, designSystem }
```

### [RESOLVED] quality:api-contract
*Archived: 2026-01-18T22:04:11.447Z*

- **File**: js/agents/stages/design/refiner/batch-repair-agent.js:111
- **Description**: runSingleSlideRepair 只读取 response.text，但其他调用使用 response.content；若 provider 只返回 content，将导致修复结果为空。
- **Suggestion**: 兼容两种字段：const raw = response.content || response.text || ""，或在 aiApiService 统一规范返回格式。
```
let fixed = (response.text || "").replace(/```html/g, "").replace(/```/g, "").trim();
```

### [RESOLVED] compatibility:node-only
*Archived: 2026-01-18T22:04:11.447Z*

- **File**: js/agents/stages/design/refiner/react-refiner-tools.js:236
- **Description**: 模块内包含 linkedom 动态导入与 Node-only 依赖路径，浏览器打包时可能引入不兼容依赖。
- **Suggestion**: 将 Node-only 逻辑拆分到独立模块或确保构建时 externalize linkedom；保持浏览器路径不依赖 Node-only 包。
```
const mod = await import("linkedom");
```

---

