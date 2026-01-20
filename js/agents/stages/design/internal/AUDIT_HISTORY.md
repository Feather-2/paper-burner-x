# Audit History - runtime

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] ErrorHandling
*Archived: 2026-01-19T23:50:50.487Z*

- **File**: js/agents/stages/design/internal/deck-planner.js:428
- **Description**: parseFeedbackWithLLM 捕获所有异常后静默降级，未记录错误或透传，违反错误处理规范且不利于排查 LLM 输出异常。
- **Suggestion**: 至少记录告警/埋点（含 runId/反馈摘要），或将错误包装后返回给调用方。
```
} catch { return parseSimpleFeedback(feedback, plans); }
```

---

## Archived: 2026-01-19

### [RESOLVED] StateRollback
*Archived: 2026-01-19T23:50:46.332Z*

- **File**: js/agents/stages/design/internal/deck-editor.js:406
- **Description**: direct 编辑路径在变更后调用 _pushHistory，导致 prevDeckHtmlDsl 记录为新状态，undo 无法回滚；redo 依赖的 nextDeckHtmlDsl 从未设置，回放不完整。
- **Suggestion**: 在修改前捕获 prev 状态并传入 _pushHistory，修改后保存 next 状态；或让 _pushHistory 接收 { prev, next }。
```
this._deckPackage.deckHtmlDsl = joinSections(sections);
this._pushHistory("editSlide", { slideIndex, changes });
```

---

## Archived: 2026-01-19

### [RESOLVED] XSS
*Archived: 2026-01-19T23:50:37.405Z*

- **File**: js/agents/stages/design/internal/deck-editor.js:396
- **Description**: direct editSlide/replaceSlideHtml 接受并写入任意 HTML，仅做长度校验；若输入来自 UI/LLM，可插入 <script> 或事件处理器导致 XSS。
- **Suggestion**: 对 HTML 做白名单清洗（如 DOMPurify）或仅允许受控模板；在 API 上区分可信/不可信输入。
```
sections[slideIndex] = changes.html;
```

---

## Archived: 2026-01-19

### [RESOLVED] SSRF
*Archived: 2026-01-19T23:50:17.026Z*

- **File**: js/agents/stages/design/internal/screenshot-stitcher.js:103
- **Description**: loadImageCrossEnv 在 Node 环境把 base64DataUrl 直接交给 canvas.loadImage；若截图列表可被用户控制，可能加载远程 URL 或本地文件，触发 SSRF/本地文件读取。
- **Suggestion**: 校验仅允许 data:image/*;base64, 前缀并限制长度；拒绝 http(s)/file/相对路径。
```
return nc.loadImage(base64DataUrl);
```

---

## Archived: 2026-01-19

### [RESOLVED] XSS
*Archived: 2026-01-19T23:50:12.582Z*

- **File**: js/agents/stages/design/internal/deck-editor.js:368
- **Description**: DeckEditor 在 direct edit 路径将 changes.style 原样插入 style 属性，未做转义/白名单；若来自 UI/LLM 输入，可能通过引号或 url() 注入导致脚本执行。
- **Suggestion**: 对 style 做白名单过滤并转义引号；或用 CSS 解析器构建安全 style 串，拒绝 url()/expression 等危险值。
```
sectionHtml = sectionHtml.replace(regex, `$1${changes.style}"`);
```

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

