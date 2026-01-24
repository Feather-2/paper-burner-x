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

## 工具执行器

```javascript
import { createEditToolExecutor, EditHistoryManager } from 'js/agents/stages/design/edit-mode';
import { EditOperationType } from 'js/agents/stages/design/constants.js';

const history = new EditHistoryManager();
const toolExecutor = createEditToolExecutor({ state: initialState, historyManager: history, canvasBridge });

await toolExecutor(EditOperationType.ADD_SLIDE, { afterIndex: 0 });
```

### 超时与错误

编辑循环包含超时保护（模型调用 / 工具执行 / 画布调用）。超时会抛出 `TimeoutError`：

- `err.name === 'TimeoutError'`
- `err.code === 'ETIMEDOUT'`
- `err.timeoutMs` 为本次超时阈值

上层（UI / chat）应捕获并向用户展示友好消息（不要直接展示 stack）。

### 安全限制（防止模型输出失控）

实现中对“模型意图/操作序列”设置了硬限制（用于避免超大 JSON、过深嵌套或过多操作导致卡死）：

- intent JSON 最大长度：50,000 chars
- 最大嵌套深度：8
- 最大操作数：50
- 默认超时：模型 120,000ms；工具 30,000ms；画布 30,000ms

## EditHistoryManager

`EditHistoryManager` 提供撤销/重做，并支持事务批处理（transaction batching）以便将多步编辑合并成一次历史记录。

```javascript
import { EditHistoryManager } from 'js/agents/stages/design/edit-mode';

const history = new EditHistoryManager(50, {
  onUndo(op) {
    // 可选：在 undo 时同步 UI/指标
  },
  onRedo(op) {
    // 可选：在 redo 时同步 UI/指标
  },
});
```

- `push(operation)`：写入一条操作（需要 plain object；否则返回 `false`）。
- `beginTransaction()`：开启事务；事务期间 `push()` 会累积到同一个历史条目中（事务结束/提交方式以 `history.js` 实现为准）。

## 样式锁定警告

当 `state.designSystem.styleLock` 存在时，`change_color_scheme` 会校验颜色并通过 `emit('edit:style.deviation', ...)` 发送偏离警告（不阻断操作）。
