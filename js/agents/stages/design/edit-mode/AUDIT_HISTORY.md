# Audit History - edit-mode

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 未验证的输入
*Archived: 2026-01-19T23:49:01.659Z*

- **File**: js/agents/stages/design/edit-mode/edit-loop.js:373
- **Description**: 模型返回的 operations 未经 schema 校验直接驱动工具执行，params 仍可能包含异常字段或越界值，影响业务状态一致性。
- **Suggestion**: 为 intent/operations 建立明确 schema（工具名白名单 + params 字段与范围），执行前校验并过滤未知字段，必要时拒绝非法操作。
```
const operations = Array.isArray(intent?.operations) ? intent.operations : [];
for (const op of operations) {
  const result = await toolExecutor(op.tool, op.params || {});
  if (!result?.success) {
    throw new Error(result?.error || `Tool failed: ${op.tool}`);
  }
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 超时处理缺失
*Archived: 2026-01-19T23:48:44.113Z*

- **File**: js/agents/stages/design/edit-mode/edit-loop.js:312
- **Description**: modelRouter.chat 与后续工具调用缺少超时/取消机制，长时间阻塞会卡住 edit loop（特别关注项）。
- **Suggestion**: 为模型调用与 toolExecutor/CanvasBridge 包装超时与 AbortController，超时后回滚并返回友好提示。
```
const aiResponse = await modelRouter.chat([{ role: "user", content }], { vision: Boolean(screenshot) });
```

---

## Archived: 2026-01-19

### [RESOLVED] 不安全的反序列化
*Archived: 2026-01-19T23:48:39.418Z*

- **File**: js/agents/stages/design/edit-mode/edit-loop.js:39
- **Description**: 模型返回内容被直接 JSON.parse，未做 schema/长度校验，属于外部数据反序列化风险（可能导致异常或资源消耗）。
- **Suggestion**: 对模型响应先做长度限制与结构校验（JSON Schema/手写校验），拒绝非对象或超长输入；必要时采用流式解析与超时保护。
```
return JSON.parse(value);
```

---

## Archived: 2026-01-18

### [RESOLVED] async-error-handling
*Archived: 2026-01-18T21:50:21.305Z*

- **File**: js/agents/stages/design/edit-mode/edit-loop.js:302
- **Description**: _captureCanvasContext 和 _interpretIntent 在 try/catch 之外；若 modelRouter.chat/intentParser 抛错或解析失败，会导致异常冒泡并留下 session 停留在 PROCESSING。
- **Suggestion**: 把上述 await 包在 try/catch 中，失败时切回 AWAITING_INPUT 并向用户反馈错误（可带上 cause）。
```
const { currentDsl, screenshot } = await this._captureCanvasContext({ state, canvasBridge, toolExecutor });
const intent = await this._interpretIntent({
```

### [RESOLVED] event-naming
*Archived: 2026-01-18T21:50:21.305Z*

- **File**: js/agents/stages/design/edit-mode/edit-loop.js:123
- **Description**: 事件名使用点号分隔（edit.element.selected/edit.session.transition），不符合 domain:action 约定，监听方可能收不到事件。
- **Suggestion**: 改为 domain:action 命名（如 "edit:element.selected"/"edit:session:transition"），并同步更新监听端。
```
if (typeof emit === "function") emit("edit.element.selected", { elementId: selectedElement });
```

### [RESOLVED] event-naming
*Archived: 2026-01-18T21:50:21.305Z*

- **File**: js/agents/stages/design/edit-mode/tools.js:149
- **Description**: 样式偏差告警事件同样使用点号分隔，违反 domain:action 约定。
- **Suggestion**: 改为 domain:action 命名（如 "edit:style.deviation"）并同步更新订阅方。
```
emit('edit.style.deviation', {
```

### [RESOLVED] jsdoc-coverage
*Archived: 2026-01-18T21:50:21.305Z*

- **File**: js/agents/stages/design/edit-mode/edit-loop.js:50
- **Description**: 导出类 EditModeAgentLoop 的 constructor/run 缺少 @param/@returns 注解，不符合 JSDoc 类型要求。
- **Suggestion**: 为 constructor/run 补充 JSDoc，标注 options、initialState、context 以及返回值类型。
```
export class EditModeAgentLoop {
  constructor(options = {}) {
    this.tools = options.tools || EditModeTools;
  }

  async run(initialState, context = {}) {
```

### [RESOLVED] jsdoc-coverage
*Archived: 2026-01-18T21:50:21.305Z*

- **File**: js/agents/stages/design/edit-mode/tools.js:664
- **Description**: createEditToolExecutor 为导出函数但缺少 JSDoc 类型注解。
- **Suggestion**: 添加 @param/@returns，说明 context 结构与执行器签名。
```
export function createEditToolExecutor(context = {}) {
```

---

