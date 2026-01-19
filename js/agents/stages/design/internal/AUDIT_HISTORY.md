# Audit History - runtime

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-incomplete
*Archived: 2026-01-18T19:33:30.854Z*

- **File**: js/agents/stages/design/runtime/deck-planner.js:165
- **Description**: planDeck/applyUserEdits/formatPlanForReview 等导出函数缺少 @param/@returns 描述，未满足公共 API JSDoc 规范。
- **Suggestion**: 补全 @param/@returns/@throws（如有）说明，保持公共 API 文档一致性。
```
export function planDeck(slideIntents, designSystem, options = {}) {
```

---

## Archived: 2026-01-18

### [RESOLVED] prototype-pollution
*Archived: 2026-01-18T19:32:10.625Z*

- **File**: js/agents/stages/design/runtime/design-blackboard.js:359
- **Description**: getAllSummaries 将来自 StateEngine/MemoryStore 的 key 直接写入普通对象，若 key 为 __proto__/constructor/prototype 可能触发原型污染。
- **Suggestion**: 使用 Object.create(null) 或 Map 存放 summaries；写入前过滤危险 key（`__proto__`/`constructor`/`prototype`）。
```
if (String(k).startsWith(DESIGN_PREFIX)) out[String(k).slice(DESIGN_PREFIX.length)] = v;
```

### [RESOLVED] timeout-handling
*Archived: 2026-01-18T19:32:10.625Z*

- **File**: js/agents/stages/design/runtime/deck-analyzer.js:232
- **Description**: createDeckOverview 对每页截图调用缺少超时/取消机制，长时间运行可能导致阶段挂起，影响回滚与恢复。
- **Suggestion**: 为 screenshotFn 增加 AbortSignal/timeout 选项，或用 Promise.race 实现 per-slide 与全局超时并返回部分结果。
```
const result = await this._screenshotFn({ slideIndex: i, scale: options.scale || 1 });
```

---

## Archived: 2026-01-18

### [RESOLVED] error-swallowed
*Archived: 2026-01-18T19:31:11.480Z*

- **File**: js/agents/stages/design/runtime/design-blackboard.js:317
- **Description**: 多处 catch 直接吞掉异常，可能隐藏 MemoryStore/StateEngine 同步失败，降低可观测性。
- **Suggestion**: 至少记录 warn 日志或暴露失败计数，必要时向调用方返回可诊断的错误状态。
```
} catch { /* intentional */ }
```

---

## Archived: 2026-01-18

### [RESOLVED] unsafe-deserialization
*Archived: 2026-01-18T19:30:47.527Z*

- **File**: js/agents/stages/design/runtime/deck-planner.js:385
- **Description**: parseFeedbackWithLLM 对 LLM 输出直接 JSON.parse，缺少 schema/类型/长度校验，外部数据可能造成意外结构或资源消耗。
- **Suggestion**: 在 parse 前限制长度，parse 后校验数组元素结构/类型/范围；过滤未知字段或使用 schema validator。
```
const parsed = JSON.parse(result.replace(/```json?\n?|\n?```/g, "").trim());
```

---

## Archived: 2026-01-18

### [RESOLVED] xss
*Archived: 2026-01-18T19:29:48.346Z*

- **File**: js/agents/stages/design/runtime/deck-editor.js:339
- **Description**: _directEditElement/_directEditSlide/replaceSlideHtml 直接将 changes.text/changes.html 拼接进 HTML DSL，若来自 UI 的输入未转义会在渲染时形成 XSS。
- **Suggestion**: 对 text 做 HTML 转义或在渲染层使用 textContent；对 html 替换做白名单/DOMPurify 清洗，并限制输入来源与长度。
```
sectionHtml = sectionHtml.replace(regex, `$1${changes.text}$2`);
```

---

