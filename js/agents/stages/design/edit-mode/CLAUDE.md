# edit-mode (design) - 编辑模式

交互式幻灯片编辑。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口，导出所有 |
| `edit-loop.js` | EditModeAgentLoop：会话状态机 + action 规范化 + 超时/安全限制 |
| `tools.js` | EditModeTools + createEditToolExecutor（工具注册与执行） |
| `history.js` | EditHistoryManager：撤销/重做 + 事务批处理（transaction batching） |

## EditModeAgentLoop

```javascript
import { EditModeAgentLoop } from 'js/agents/stages/design/edit-mode';

const editAgent = new EditModeAgentLoop({ modelRouter, canvasBridge, chat, emit });

await editAgent.run(initialState, {
  actions: [
    { type: 'chat_message', message: '把第三页的标题改成蓝色' },
    { type: 'exit' },
  ],
});
```

支持的 action 类型：
- `chat_message` (message/text)
- `element_selected` (elementId/id)
- `quick_action` (action/name: undo/redo/add_slide/delete_slide)
- `exit`

如果不传 `actions`，需要提供 `waitForUserAction` 回调。

### state 约定与输入校验

- `initialState` 必须是 plain object；否则会抛出 `TypeError('Edit loop: initialState must be an object')`。
- 若 `initialState.slides` 不是数组，会被初始化为 `[]`（会修改传入对象）。
- 会话字段：若 `state.editSession` 不存在，会被初始化为 `{ status: EditSessionStatus.IDLE }`；并同步写入 `state.editSessionStatus`（用于兼容旧逻辑/选择器）。

### quick_action 简写

除了显式 `type: 'quick_action'`，也支持仅提供 `action` 字段来触发 quick_action：

```javascript
{ action: 'undo' }
{ action: 'redo' }
```

### 超时与安全限制（默认值）

`edit-loop.js` 对 LLM 意图解析与工具执行提供了默认的安全限制（避免超长/过深 JSON 与长时间挂起）：

- Intent JSON 最大长度：`50_000` 字符（`MAX_INTENT_JSON_CHARS`）
- Intent 最大深度：`8`（`MAX_INTENT_DEPTH`）
- Intent 最大操作数：`50`（`MAX_INTENT_OPERATIONS`）
- Model 超时：`120_000ms`（`MODEL_TIMEOUT_MS`）
- Tool 超时：`30_000ms`（`TOOL_TIMEOUT_MS`）
- Canvas 超时：`30_000ms`（`CANVAS_TIMEOUT_MS`）

超时会抛出 `TimeoutError`（`name: 'TimeoutError'`, `code: 'ETIMEDOUT'`, `timeoutMs`）。

建议调用方：捕获并转换为用户友好提示（不要把详细堆栈直接暴露到 UI）。

## 编辑工具

```javascript
import { EditModeTools } from 'js/agents/stages/design/edit-mode';
import { EditOperationType } from 'js/agents/stages/design/constants.js';

EditModeTools[EditOperationType.ADD_SLIDE];
EditModeTools[EditOperationType.EDIT_ELEMENT];
EditModeTools[EditOperationType.CHANGE_COLOR_SCHEME];
EditModeTools.screenshot_current;
EditModeTools.parse_canvas_state;
```

支持的 EditOperationType：
- `add_slide`
- `delete_slide`
- `reorder_slides`
- `duplicate_slide`
- `change_color_scheme`
- `change_font`
- `apply_theme`
- `edit_element`
- `delete_element`
- `add_element`
- `move_element`
- `resize_element`
- `undo`
- `redo`

## EditHistoryManager

撤销/重做栈与事务批处理（transaction batching）。

```javascript
import { EditHistoryManager } from 'js/agents/stages/design/edit-mode';

const history = new EditHistoryManager(50, {
  onUndo(op) {},
  onRedo(op) {},
});

history.push({
  undo() {},
  redo() {},
});

history.beginTransaction();
// 在事务中 push 的多个 operation 会被合并成一个 entry
```

说明：
- `maxHistory` 会被归一化为正整数（默认 `50`）。
- `onUndo`/`onRedo` 为可选回调（用于埋点或外部同步）。
