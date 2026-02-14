# edit-mode (design) - 编辑模式

交互式幻灯片编辑阶段（Edit Mode），负责把 UI 动作规范化为编辑指令，并在执行过程中提供超时保护、工具执行约束与历史回滚。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块入口，导出编辑循环、工具与历史管理 |
| `edit-loop.js` | `EditModeAgentLoop`：会话状态机、action 规范化、意图解析、超时/安全限制 |
| `tools.js` | `EditModeTools` + `createEditToolExecutor`：工具注册、执行与错误包装 |
| `history.js` | `EditHistoryManager`：撤销/重做 + 事务批处理（transaction batching） |

## EditModeAgentLoop

```javascript
import { EditModeAgentLoop } from 'js/agents/stages/design/edit-mode';

const editAgent = new EditModeAgentLoop({ modelRouter, canvasBridge, chat, emit });

await editAgent.run(initialState, {
  actions: [
    { type: 'chat_message', message: '把第三页的标题改成蓝色' },
    { action: 'undo' },
    { type: 'exit' }
  ]
});
```

支持的 action 类型：
- `chat_message`（兼容 `message` / `text`）
- `element_selected`（兼容 `elementId` / `id`）
- `quick_action`（`undo` / `redo` / `add_slide` / `delete_slide`）
- `exit`

如果不传 `actions`，需要提供 `waitForUserAction` 回调。

### state 约定与输入校验

- `initialState` 必须是 plain object；否则抛出 `TypeError('Edit loop: initialState must be an object')`。
- 若 `initialState.slides` 不是数组，会被初始化为 `[]`（当前行为为原地修改传入对象）。
- 若 `state.editSession` 不存在，会初始化为 `{ status: EditSessionStatus.IDLE }`。
- 若 `state.editSession.status` 为空，会回填为 `EditSessionStatus.IDLE`。
- 兼容字段 `state.editSessionStatus` 会与 `state.editSession.status` 同步维护（兼容旧逻辑/选择器）。

### quick_action 简写

除显式 `type: 'quick_action'` 外，也支持仅传 `action`：

```javascript
{ action: 'undo' }
{ action: 'redo' }
```

### 意图解析与安全限制（默认值）

`edit-loop.js` 对 LLM 意图解析与工具执行提供默认限制：

- Intent JSON 最大长度：`50_000` 字符（`MAX_INTENT_JSON_CHARS`）
- Intent 最大深度：`8`（`MAX_INTENT_DEPTH`）
- Intent 最大操作数：`50`（`MAX_INTENT_OPERATIONS`）
- Model 超时：`120_000ms`（`MODEL_TIMEOUT_MS`）
- Tool 超时：`30_000ms`（`TOOL_TIMEOUT_MS`）
- Canvas 超时：`30_000ms`（`CANVAS_TIMEOUT_MS`）

意图 JSON 解析使用 `protoSafeReviver`，用于拦截 `__proto__` / `constructor` / `prototype` 等原型污染键。

### 超时错误模型

超时统一抛出 `TimeoutError`（`name: 'TimeoutError'`），并附加：
- `code: 'ETIMEDOUT'`
- `timeoutMs: number`

上层调用方应将超时错误映射为用户可理解提示，并结合 `EditHistoryManager` 执行重试或回滚策略。

### 历史回滚与事务

- `EditHistoryManager` 负责 `undo` / `redo`。
- 支持事务批处理，把一组原子编辑操作合并为一个历史节点。
- 对支持 backtrack 的阶段，建议将“意图解析 + 工具执行 + 状态提交”置于同一事务边界，避免部分成功导致状态分叉。

### 测试建议（edit-mode）

- 正常流程：`chat_message -> tool calls -> state commit`。
- 异常恢复：model/tool/canvas 超时后的错误可见性与回滚一致性。
- 边界输入：空 action、超长 message、非法 action type、深层 intent JSON。
- 并发边界：连续 `undo/redo` 与快速多次 `quick_action`。
