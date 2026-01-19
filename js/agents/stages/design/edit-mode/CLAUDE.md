# edit-mode (design) - 编辑模式

交互式幻灯片编辑。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口，导出所有 |
| `edit-loop.js` | EditModeAgentLoop |
| `tools.js` | EditModeTools + createEditToolExecutor |
| `history.js` | EditHistoryManager - 撤销/重做 |

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

## 编辑工具

```javascript
import { EditModeTools } from 'js/agents/stages/design/edit-mode';
import { EditOperationType } from 'js/agents/stages/design/constants.js';

EditModeTools[EditOperationType.ADD_SLIDE];
EditModeTools[EditOperationType.EDIT_ELEMENT];
EditModeTools.screenshot_current;
EditModeTools.parse_canvas_state;
```

## 工具执行器

```javascript
import { createEditToolExecutor, EditHistoryManager } from 'js/agents/stages/design/edit-mode';
import { EditOperationType } from 'js/agents/stages/design/constants.js';

const history = new EditHistoryManager();
const toolExecutor = createEditToolExecutor({ state: initialState, historyManager: history, canvasBridge });

await toolExecutor(EditOperationType.ADD_SLIDE, { afterIndex: 0 });
```

## 历史管理

```javascript
import { EditHistoryManager } from 'js/agents/stages/design/edit-mode';

const history = new EditHistoryManager();
history.push(operation);

// 撤销
const previous = history.undo();

// 重做
const next = history.redo();
```
