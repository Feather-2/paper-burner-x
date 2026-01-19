# Audit History - refiner

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc
*Archived: 2026-01-19T20:48:12.416Z*

- **File**: js/agents/stages/design/refiner/react-refiner-tools.js:17
- **Description**: 公共 typedef 使用 any（ToolResult/ToolExecutor/ToolContext），违反 no-any 规则，降低类型约束和审计可读性。
- **Suggestion**: 将 any 改为具体结构/联合类型（例如 ToolResultData、ToolParams、contentPackage 结构），并在 typedef 中引用。
```
@typedef {{ success: boolean, data?: any, error?: string }} ToolResult\n@typedef {(toolName: string, params: any) => Promise<ToolResult>} ToolExecutor
```

---

## Archived: 2026-01-19

### [RESOLVED] XSS
*Archived: 2026-01-19T20:48:02.777Z*

- **File**: js/agents/stages/design/refiner/batch-repair-agent.js:115
- **Description**: runSingleSlideRepair 仅移除 <script>/on*，未过滤 href/src 的 javascript: 或危险 style；修复后的 HTML 若直接渲染会导致 XSS。
- **Suggestion**: 复用 react-refiner-tools 的 sanitizeHtmlFragment/DOMPurify，对 href/src/xlink:href 等 URL 和 style 进行过滤；或在返回前执行安全属性白名单。
```
// Sanitize LLM output to prevent XSS (strip script/on* handlers)\nfixed = fixed\n  .replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, \"\")\n  .replace(/\\s+on\\w+\\s*=\\s*[\"'][^\"']*[\"']/gi, \"\")
```

---

## Archived: 2026-01-19

### [RESOLVED] Timeout
*Archived: 2026-01-19T20:47:43.428Z*

- **File**: js/agents/stages/design/refiner/react-refiner.js:319
- **Description**: runReactRefiner 的 aiApiService.chat 调用未传入 AbortSignal/超时，长时间阻塞时无法中断，影响回滚/取消。
- **Suggestion**: 为 aiApiService.chat 传入 stageApi.signal 或 per-step AbortController，并加超时（Promise.race + setTimeout），确保可中断。
```
modelResp = await aiApiService.chat({\n  messages: hintedMessages,\n  temperature: 0.2,\n  maxTokens: 8000,\n});
```

---

## Archived: 2026-01-19

### [RESOLVED] XSS
*Archived: 2026-01-19T20:47:38.816Z*

- **File**: js/agents/stages/design/refiner/react-refiner-tools.js:673
- **Description**: editElement 将 changes.style 直接写入 DOM，绕过 isDangerousStyle 过滤；输入可控时可通过 CSS url(javascript:...) 或 expression 注入脚本。
- **Suggestion**: 在设置 style 前调用 isDangerousStyle 校验，或只允许白名单 CSS 属性；不安全时拒绝/清空。也可改为通过 applyAttrChanges 设置 style 以统一过滤。
```
const style = changes.style !== undefined ? String(changes.style) : null;\nif (style !== null) el.setAttribute(\"style\", style);
```

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

